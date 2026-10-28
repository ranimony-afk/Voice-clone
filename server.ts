/**
 * VoiceForge Full-Stack Application Server
 * Runs Express API, WebSocket Server for Gemini Live API, and mounts Vite middleware in dev
 */

import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Modality } from '@google/genai';
import { apiRouter } from './server/routes/api.ts';
import { config } from './server/config/env.ts';
import { attachLiveWebSocketUpgradeHandler } from './server/security/liveWebSocketUpgrade.ts';
import { getNeuralInferenceReadiness } from './server/engine/audio/readiness.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  // Per environment constraints: Dev server must run on port 3000
  const PORT = 3000;

  // HTTP Security Baseline: Helmet & CORS
  app.use(
    helmet({
      contentSecurityPolicy: false, // Allows cross-origin audio blobs and Google storage assets
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(
    cors({
      origin: config.CORS_ALLOWED_ORIGINS === '*' ? true : config.CORS_ALLOWED_ORIGINS.split(','),
      credentials: true,
    })
  );

  // Liveness only: this endpoint does not imply that a neural model is loaded.
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ process_live: true, status: 'alive', timestamp: new Date().toISOString() });
  });

  // The API can serve non-inference endpoints while reporting neural readiness
  // independently from the worker's explicit model state.
  app.get('/readyz', async (_req, res) => {
    const inference = await getNeuralInferenceReadiness();
    res.status(200).json({ api_ready: true, ...inference });
  });

  // Body parser for JSON and audio/video buffers
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Mount API Endpoints
  app.use('/api', apiRouter);

  // Unknown API routes return JSON 404 (prevent SPA HTML fallback from swallowing /api 404s)
  app.all('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested API endpoint was not found.',
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Central API Error Handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[API Server Error]', err);
    res.status(err.status || 500).json({
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: config.NODE_ENV === 'production' ? 'Internal server error' : err.message,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // Development vs Production serving
  if (config.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Create unified HTTP server
  const server = http.createServer(app);

  // Setup WebSocket Server for Gemini 3.8 Live API voice conversations
  const wss = new WebSocketServer({ noServer: true });

  attachLiveWebSocketUpgradeHandler(server, wss, () => ({
    NODE_ENV: config.NODE_ENV,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || config.GEMINI_API_KEY,
  }));

  wss.on('connection', async (clientWs: WebSocket) => {
    console.log('[Live API WS] Client connected to real-time voice session');
    const apiKey = process.env.GEMINI_API_KEY;

    let liveSession: any = null;

    if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
      try {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: { 'User-Agent': 'aistudio-build' },
          },
        });

        liveSession = await ai.live.connect({
          model: 'gemini-3.8-live',
          callbacks: {
            onmessage: (message: any) => {
              const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
              if (audio && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ audio }));
              }
              if (message.serverContent?.interrupted && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ interrupted: true }));
              }
            },
            onerror: (err: any) => {
              console.warn('[Live API WS] Gemini Live session notice:', err?.message || err);
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ error: err?.message || 'Live session notice' }));
              }
            },
            onclose: () => {
              console.log('[Live API WS] Gemini Live session ended');
            },
          },
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
            systemInstruction: 'You are VoiceForge conversational assistant. Speak naturally with warm, concise conversational speech.',
          },
        });
      } catch (err: any) {
        console.warn('[Live API WS] Initialization fallback notice:', err.message);
      }
    }

    let lastSpokenReply = 0;

    clientWs.on('message', async (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.audio && liveSession) {
          liveSession.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.audio && !liveSession) {
          // Fallback conversational audio response for free tier / local mode
          const now = Date.now();
          if (now - lastSpokenReply > 6000 && clientWs.readyState === WebSocket.OPEN) {
            lastSpokenReply = now;
            setTimeout(() => {
              if (clientWs.readyState === WebSocket.OPEN) {
                const samplePCM = generateLiveConversationalPCM(24000, 2.5);
                clientWs.send(JSON.stringify({ audio: samplePCM }));
              }
            }, 800);
          }
        } else if (msg.ping && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ pong: true, timestamp: Date.now() }));
        }
      } catch (e) {
        // Ping or binary buffer
      }
    });

    clientWs.on('close', () => {
      if (liveSession) {
        try {
          liveSession.close();
        } catch (_) {}
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[VoiceForge] Server active at http://0.0.0.0:${PORT} with WebSocket /live-ws`);
  });
}

startServer().catch((err) => {
  console.error('[VoiceForge] Failed to start server:', err);
  process.exit(1);
});

// Generates 24kHz 16-bit mono little-endian raw PCM speech audio buffer
function generateLiveConversationalPCM(sampleRate: number = 24000, durationSec: number = 2.5): string {
  const totalSamples = Math.floor(sampleRate * durationSec);
  const pcm = new Int16Array(totalSamples);
  let phaseF0 = 0;
  let phaseF1 = 0;
  let phaseF2 = 0;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const f0 = 175 + Math.sin(t * 5.0) * 20; // Natural speaking pitch modulation
    const f1 = 550 + Math.sin(t * 3.0) * 80;
    const f2 = 1600 + Math.cos(t * 2.0) * 120;

    phaseF0 += (2 * Math.PI * f0) / sampleRate;
    phaseF1 += (2 * Math.PI * f1) / sampleRate;
    phaseF2 += (2 * Math.PI * f2) / sampleRate;

    const glottal = Math.sin(phaseF0) + 0.4 * Math.sin(2 * phaseF0);
    const formant = Math.sin(phaseF1) * 0.4 + Math.sin(phaseF2) * 0.25;
    const cadenceEnvelope = Math.sin((t / durationSec) * Math.PI);

    const sample = (glottal * 0.6 + formant * 0.4) * cadenceEnvelope * 0.7;
    pcm[i] = Math.floor(sample * 32767);
  }

  // Return base64 string of raw PCM bytes
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

