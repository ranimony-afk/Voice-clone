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
    assert.ok(['NEURAL', 'DEMO', 'UNAVAILABLE'].includes(data.executionMode));
  });

  test('GET /api/engine/status returns truthful execution mode and engine identity', async () => {
    const res = await fetch(`${baseUrl}/api/engine/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(['NEURAL', 'DEMO', 'UNAVAILABLE'].includes(data.executionMode));
    assert.ok(typeof data.isNeural === 'boolean');
    assert.ok(data.primaryEngine);
    assert.ok(data.details);
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

  test('GET /api/v1/health/live and ready return active service status', async () => {
    const liveRes = await fetch(`${baseUrl}/api/v1/health/live`);
    assert.equal(liveRes.status, 200);
    const liveData = await liveRes.json();
    assert.equal(liveData.status, 'live');

    const readyRes = await fetch(`${baseUrl}/api/v1/health/ready`);
    assert.equal(readyRes.status, 200);
    const readyData = await readyRes.json();
    assert.equal(readyData.status, 'ready');
    assert.equal(readyData.primaryEngine, 'k2-fsa/OmniVoice-v0.2.1');
  });

  test('GET /api/v1/voices returns voice catalogue', async () => {
    const res = await fetch(`${baseUrl}/api/v1/voices`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.voices));
    assert.ok(data.voices.length >= 5);
  });

  test('POST /api/v1/tts/jobs queues and completes synthesis job', async () => {
    const res = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Automated test of v1 asynchronous job runner.',
        voiceId: 'vf_sarah_en',
        language: 'en',
      }),
    });
    assert.equal(res.status, 202);
    const job = await res.json();
    assert.ok(job.jobId);
    assert.equal(job.status, 'completed');
    assert.ok(job.result);
    assert.ok(job.result.audioBase64);

    // Verify polling endpoint
    const pollRes = await fetch(`${baseUrl}/api/v1/jobs/${job.jobId}`);
    assert.equal(pollRes.status, 200);
    const polledJob = await pollRes.json();
    assert.equal(polledJob.jobId, job.jobId);
  });

  test('POST /api/v1/projects creates a multi-scene project', async () => {
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Documentary Audio Project',
        targetLanguages: ['en', 'ta'],
        scenes: 3,
      }),
    });
    assert.equal(res.status, 201);
    const proj = await res.json();
    assert.ok(proj.id);
    assert.equal(proj.title, 'Documentary Audio Project');

    const listRes = await fetch(`${baseUrl}/api/v1/projects`);
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.ok(listData.projects.some((p: any) => p.id === proj.id));
  });

  test('POST /api/v1/visuals/render executes motion graphics render job', async () => {
    const res = await fetch(`${baseUrl}/api/v1/visuals/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: 'kinetic_typography',
        audioDurationSec: 8.5,
        resolution: '1080p',
        format: 'mp4',
      }),
    });
    assert.equal(res.status, 200);
    const renderRecord = await res.json();
    assert.ok(renderRecord.jobId);
    assert.equal(renderRecord.status, 'completed');
    assert.equal(renderRecord.result.templateId, 'kinetic_typography');
    assert.ok(renderRecord.result.renderPipeline);
  });
});
