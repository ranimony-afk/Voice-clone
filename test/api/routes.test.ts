import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import { apiRouter } from '../../server/routes/api.ts';

describe('Express API Integration Tests', () => {
  let server: http.Server;
  let baseUrl: string;

  before((_, done) => {
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use('/api', apiRouter);

    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  after((_, done) => {
    server.close(done);
  });

  test('GET /api/health returns 200 with service status', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'healthy');
    assert.ok(Array.isArray(data.supportedLanguages));
  });

  test('GET /api/voices returns default catalogue', async () => {
    const res = await fetch(`${baseUrl}/api/voices`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.voices));
    assert.ok(data.voices.length >= 5);
  });

  test('POST /api/frontend/analyze normalizes text and generates IPA', async () => {
    const res = await fetch(`${baseUrl}/api/frontend/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello VoiceForge world', language: 'en' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.originalText, 'Hello VoiceForge world');
    assert.ok(data.unifiedIpa.length > 0);
  });

  test('POST /api/voices/clone/challenge issues valid expiring challenge', async () => {
    const res = await fetch(`${baseUrl}/api/voices/clone/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceName: 'Test Voice 1', userId: 'user_unit' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.challengeId);
    assert.ok(data.nonce);
    assert.ok(data.signature);
  });

  test('POST /api/voices/clone/verify-consent fails closed without challenge', async () => {
    const res = await fetch(`${baseUrl}/api/voices/clone/verify-consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceName: 'Unverified Voice' }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.verified, false);
    assert.match(data.error, /Missing mandatory consent challenge/i);
  });

  test('POST /api/tts/synthesize produces WAV with signed provenance token', async () => {
    const res = await fetch(`${baseUrl}/api/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Production synthesis verification test.',
        voiceId: 'vf_sarah_en',
        language: 'en',
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.audioBase64.length > 100);
    assert.equal(data.format, 'wav');
    assert.ok(data.watermarkSignature.length === 64);
    assert.ok(data.engineUsed);
  });

  test('POST /api/audio/verify-watermark rejects arbitrary strings', async () => {
    const res = await fetch(`${baseUrl}/api/audio/verify-watermark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature: 'random_unauthenticated_string_val' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.isValid, false);
  });
});
