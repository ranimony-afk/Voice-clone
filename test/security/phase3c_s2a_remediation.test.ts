/**
 * Phase 3C-S2A: Critical Security Remediation Regression Suite
 *
 * Covers:
 * 1. P0 — Private audio revocation, voice deletion, completed-job cancellation,
 *    fail-closed active-consent enforcement on GET /api/v1/tts/jobs, authoritative
 *    signed-URL/artifact invalidation, cross-tenant denial, idempotency, and
 *    fail-closed cleanup-failure handling without leaking audio, paths, or credentials.
 * 2. P1 — Strict Authorization: Bearer <token> extraction, removal of ?token=...
 *    query authentication, rejection of empty/whitespace/raw-JWT/x-session-token
 *    headers, and non-downgrade of invalid/revoked credentials on optionalAuth routes.
 * 3. P1 — Fail-closed restricted-environment secret enforcement (VOICEFORGE_STORAGE_SECRET
 *    and VOICEFORGE_CONSENT_SECRET) across development, test, staging, and production,
 *    including fresh module initialization and zero secret logging.
 */

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import express from 'express';

import { apiRouter } from '../../server/routes/api.ts';
import { AuthService, DurableRevocationStore, PRELOADED_USERS } from '../../server/auth/auth.ts';
import {
  PrivateStorageService,
  LocalStorageProvider,
  StorageProvider,
} from '../../server/storage/privateStorage.ts';
import { ConsentVerificationEngine } from '../../server/engine/audio/consent.ts';
import { globalStore } from '../../server/middleware/rateLimiter.ts';
import { memoryStore } from '../../server/db/index.ts';

function generateSpeechWavBuffer(durationSec: number, baseFreq: number, phaseOffset: number = 0): Buffer {
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const burst = Math.sin(2 * Math.PI * 3.0 * t + phaseOffset) > -0.3 ? 1.0 : 0.05;
    const f1 = Math.sin(2 * Math.PI * baseFreq * t + phaseOffset);
    const f2 = 0.5 * Math.sin(2 * Math.PI * baseFreq * 2 * t);
    const f3 = 0.25 * Math.sin(2 * Math.PI * baseFreq * 3 * t);
    const sample = Math.max(-0.95, Math.min(0.95, (f1 + f2 + f3) * 0.4 * burst));
    buffer.writeInt16LE(Math.floor(sample * 32767), 44 + i * 2);
  }

  return buffer;
}

function sendRawHttpRequest(
  port: number,
  reqPath: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; bodyText: string; json: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: reqPath,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const bodyText = Buffer.concat(chunks).toString('utf8');
          let json: any = null;
          try {
            json = JSON.parse(bodyText);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 0, bodyText, json });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function signCustomJwt(headerObj: Record<string, unknown>, payloadObj: Record<string, unknown>, secret: string): string {
  const h = Buffer.from(JSON.stringify(headerObj)).toString('base64url');
  const p = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

describe('Phase 3C-S2A: Critical Security Remediation Regression Suite', () => {
  let server: http.Server;
  let port = 0;
  let baseUrl = '';
  let tempStorageDir = '';
  let tempRevocationFile = '';
  let originalProvider: StorageProvider;

  let origNodeEnv: string | undefined;
  let origAuthSecret: string | undefined;
  let origStorageSecret: string | undefined;
  let origConsentSecret: string | undefined;
  let origRevocationPath: string | undefined;

  let aliceToken = '';
  let bobToken = '';
  let adminToken = '';

  const TEST_AUTH_SECRET = 's2a_test_auth_secret_99a8b7c6d5e4f3a2b1c0';
  const TEST_STORAGE_SECRET = 's2a_test_storage_secret_11223344556677889900';
  const TEST_CONSENT_SECRET = 's2a_test_consent_secret_aabbccddeeff00112233';

  async function enrollClonedVoiceForUser(token: string, voiceName: string, freqHz: number): Promise<string> {
    const chRes = await fetch(`${baseUrl}/api/voices/clone/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ voiceName }),
    });
    assert.equal(chRes.status, 200, 'Challenge issuance should succeed');
    const challenge = await chRes.json();

    const refWav = generateSpeechWavBuffer(4.0, freqHz, 0);
    const conWav = generateSpeechWavBuffer(4.2, freqHz, 0.08);

    const verRes = await fetch(`${baseUrl}/api/voices/clone/verify-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        challenge,
        voiceName,
        referenceAudioBase64: refWav.toString('base64'),
        consentAudioBase64: conWav.toString('base64'),
        gender: 'female',
        primaryLanguage: 'en',
      }),
    });
    assert.equal(verRes.status, 200, 'Biometric consent enrollment should succeed');
    const verJson = await verRes.json();
    assert.equal(verJson.verified, true);
    assert.ok(verJson.voiceId);
    return verJson.voiceId as string;
  }

  before(async () => {
    origNodeEnv = process.env.NODE_ENV;
    origAuthSecret = process.env.VOICEFORGE_AUTH_SECRET;
    origStorageSecret = process.env.VOICEFORGE_STORAGE_SECRET;
    origConsentSecret = process.env.VOICEFORGE_CONSENT_SECRET;
    origRevocationPath = process.env.VOICEFORGE_REVOCATION_FILE;

    tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-s2a-storage-'));
    tempRevocationFile = path.join(tempStorageDir, 'revoked_tokens_s2a.json');

    process.env.NODE_ENV = 'test';
    process.env.VOICEFORGE_AUTH_SECRET = TEST_AUTH_SECRET;
    process.env.VOICEFORGE_STORAGE_SECRET = TEST_STORAGE_SECRET;
    process.env.VOICEFORGE_CONSENT_SECRET = TEST_CONSENT_SECRET;
    process.env.VOICEFORGE_REVOCATION_FILE = tempRevocationFile;

    AuthService.resetUserStoreForTesting();
    DurableRevocationStore.resetForTesting();

    originalProvider = PrivateStorageService.getProvider();
    PrivateStorageService.setProvider(new LocalStorageProvider(tempStorageDir));

    aliceToken = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
    bobToken = AuthService.issueToken(PRELOADED_USERS.usr_bob_user);
    adminToken = AuthService.issueToken(PRELOADED_USERS.usr_admin_root);

    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use('/api', apiRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          port = addr.port;
          baseUrl = `http://127.0.0.1:${port}`;
        }
        resolve();
      });
    });
  });

  beforeEach(() => {
    globalStore.resetForTesting();
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    PrivateStorageService.setProvider(originalProvider);

    if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
    else delete process.env.NODE_ENV;

    if (origAuthSecret !== undefined) process.env.VOICEFORGE_AUTH_SECRET = origAuthSecret;
    else delete process.env.VOICEFORGE_AUTH_SECRET;

    if (origStorageSecret !== undefined) process.env.VOICEFORGE_STORAGE_SECRET = origStorageSecret;
    else delete process.env.VOICEFORGE_STORAGE_SECRET;

    if (origConsentSecret !== undefined) process.env.VOICEFORGE_CONSENT_SECRET = origConsentSecret;
    else delete process.env.VOICEFORGE_CONSENT_SECRET;

    if (origRevocationPath !== undefined) process.env.VOICEFORGE_REVOCATION_FILE = origRevocationPath;
    else delete process.env.VOICEFORGE_REVOCATION_FILE;

    AuthService.resetUserStoreForTesting();
    DurableRevocationStore.resetForTesting();

    if (tempStorageDir && fs.existsSync(tempStorageDir)) {
      fs.rmSync(tempStorageDir, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // OBJECTIVE 1 (P0): PRIVATE AUDIO REVOCATION, DELETION, AND CANCELLATION
  // ==========================================================================

  test('P0-1: Active consent allows authorized access; revoking consent eagerly scrubs jobs, deletes artifacts, and blocks job list, job detail, Bearer download, and prior signed URLs', async () => {
    const voiceId = await enrollClonedVoiceForUser(aliceToken, 'Alice S2A Revoke Voice', 215);

    // Upload voice-linked reference audio artifact
    const refSample = generateSpeechWavBuffer(2.5, 215, 0.1);
    const upRes = await fetch(`${baseUrl}/api/v1/media/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        audioBase64: refSample.toString('base64'),
        filename: 'alice_ref_linked.wav',
        mediaType: 'reference_audio',
        voiceId,
      }),
    });
    assert.equal(upRes.status, 201);
    const upJson = await upRes.json();
    const refMediaId = upJson.media.id as string;
    const refStorageKey = upJson.media.storageKey as string;
    const refSignedUrl = upJson.signedDownloadUrl as string;

    // Synthesize stateful TTS job with cloned voice
    const jobRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        text: 'Confidential speech synthesis output before consent revocation.',
        voiceId,
        language: 'en',
      }),
    });
    assert.equal(jobRes.status, 202);
    const createdJob = await jobRes.json();
    const jobId = createdJob.id as string;
    const ttsMediaId = createdJob.outputMediaId as string;
    const priorSignedUrl = createdJob.outputSignedUrl as string;
    const priorAudioBase64 = createdJob.result.audioBase64 as string;
    assert.ok(priorAudioBase64.length > 100);

    const ttsMetaBefore = memoryStore.privateMedia.find((m: any) => m.id === ttsMediaId);
    assert.ok(ttsMetaBefore, 'TTS output metadata must exist in privateMedia before revocation');
    const ttsStorageKey = ttsMetaBefore.storageKey as string;
    assert.equal(await PrivateStorageService.getProvider().exists(ttsStorageKey), true);
    assert.equal(await PrivateStorageService.getProvider().exists(refStorageKey), true);

    // Authorized active-consent access succeeds across list, detail, signed URL, and Bearer download
    const listBefore = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(listBefore.status, 200);
    const listBeforeJson = await listBefore.json();
    const listedBefore = listBeforeJson.jobs.find((j: any) => j.id === jobId);
    assert.equal(listedBefore.status, 'completed');
    assert.equal(listedBefore.result.audioBase64, priorAudioBase64);

    const dlSignedBefore = await fetch(`${baseUrl}${priorSignedUrl}`);
    assert.equal(dlSignedBefore.status, 200);
    const signedBytesBefore = Buffer.from(await dlSignedBefore.arrayBuffer());
    assert.equal(signedBytesBefore.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(signedBytesBefore.equals(Buffer.from(priorAudioBase64, 'base64')), true);

    const dlBearerBefore = await fetch(`${baseUrl}/api/v1/media/download/${ttsMediaId}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(dlBearerBefore.status, 200);

    // Now revoke biometric consent
    const revRes = await fetch(`${baseUrl}/api/voices/clone/revoke-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ voiceId }),
    });
    assert.equal(revRes.status, 200);

    // Underlying storage artifacts are physically deleted and removed from active privateMedia
    assert.equal(await PrivateStorageService.getProvider().exists(ttsStorageKey), false);
    assert.equal(await PrivateStorageService.getProvider().exists(refStorageKey), false);
    assert.equal(memoryStore.privateMedia.some((m: any) => m.id === ttsMediaId), false);
    assert.equal(memoryStore.privateMedia.some((m: any) => m.id === refMediaId), false);

    // 1. Job list no longer returns audioBase64, outputSignedUrl, or outputMediaId
    const listAfter = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(listAfter.status, 200);
    const listAfterText = await listAfter.text();
    assert.equal(listAfterText.includes(priorAudioBase64.slice(0, 64)), false);
    assert.equal(listAfterText.includes(priorSignedUrl), false);
    assert.equal(listAfterText.includes(ttsMediaId), false);
    const listAfterJson = JSON.parse(listAfterText);
    const listedAfter = listAfterJson.jobs.find((j: any) => j.id === jobId);
    assert.ok(listedAfter);
    assert.equal(listedAfter.status, 'cancelled');
    assert.equal(listedAfter.result, undefined);
    assert.equal(listedAfter.outputSignedUrl, undefined);
    assert.equal(listedAfter.outputMediaId, undefined);

    // 2. Both job detail routes (/v1/tts/jobs/:id and /v1/jobs/:id) deny access with 403 CONSENT_REVOKED and no audio
    for (const detailPath of [`/api/v1/tts/jobs/${jobId}`, `/api/v1/jobs/${jobId}`]) {
      const detailRes = await fetch(`${baseUrl}${detailPath}`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      assert.equal(detailRes.status, 403);
      const detailText = await detailRes.text();
      assert.equal(detailText.includes('UklGR'), false);
      assert.equal(detailText.includes(priorSignedUrl), false);
      const detailJson = JSON.parse(detailText);
      assert.equal(detailJson.code, 'CONSENT_REVOKED');
    }

    // 3. Previously issued signed URLs for both TTS output and voice-linked reference audio fail closed with 403 CONSENT_REVOKED
    for (const url of [priorSignedUrl, refSignedUrl]) {
      const signedAfter = await fetch(`${baseUrl}${url}`);
      assert.equal(signedAfter.status, 403);
      const bodyBuf = Buffer.from(await signedAfter.arrayBuffer());
      assert.equal(bodyBuf.subarray(0, 4).toString('ascii') !== 'RIFF', true);
      const errJson = JSON.parse(bodyBuf.toString('utf8'));
      assert.equal(errJson.code, 'CONSENT_REVOKED');
    }

    // 4. Direct Bearer download also fails closed with 403 CONSENT_REVOKED
    const bearerAfter = await fetch(`${baseUrl}/api/v1/media/download/${ttsMediaId}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(bearerAfter.status, 403);
    assert.equal((await bearerAfter.json()).code, 'CONSENT_REVOKED');
  });

  test('P0-2: Out-of-band consent revocation is enforced fail-closed in GET /api/v1/tts/jobs before serialization', async () => {
    const voiceId = await enrollClonedVoiceForUser(aliceToken, 'Alice OutOfBand Revoke', 235);
    const jobRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        text: 'Testing out-of-band consent revocation in job list endpoint.',
        voiceId,
        language: 'en',
      }),
    });
    assert.equal(jobRes.status, 202);
    const job = await jobRes.json();

    // Revoke directly on ConsentVerificationEngine without calling HTTP revoke-consent
    const revoked = ConsentVerificationEngine.revokeConsent(voiceId, 'usr_alice_user');
    assert.equal(revoked, true);

    const listRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    const target = listJson.jobs.find((j: any) => j.id === job.id);
    assert.ok(target);
    assert.equal(target.status, 'cancelled');
    assert.equal(target.result, undefined);
    assert.equal(target.outputSignedUrl, undefined);
    assert.equal(target.outputMediaId, undefined);

    // Artifact was also invalidated when GET /api/v1/tts/jobs scrubbed the revoked job
    const signedProbe = await fetch(`${baseUrl}${job.outputSignedUrl}`);
    assert.equal(signedProbe.status, 403);
    assert.equal((await signedProbe.json()).code, 'CONSENT_REVOKED');
  });

  test('P0-3: Cancelling a completed job scrubs job outputs, deletes underlying media, and blocks job list, job detail, Bearer download, and prior signed URL', async () => {
    // Create two jobs on premade voice so we verify cancelling job 1 leaves job 2 untouched
    const keepRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        text: 'Uncancelled control synthesis job.',
        voiceId: 'vf_sarah_en',
        language: 'en',
      }),
    });
    assert.equal(keepRes.status, 202);
    const keepJob = await keepRes.json();

    const cancelTargetRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        text: 'Completed synthesis job that will be cancelled.',
        voiceId: 'vf_sarah_en',
        language: 'en',
        idempotencyKey: 'idem_s2a_cancel_target',
      }),
    });
    assert.equal(cancelTargetRes.status, 202);
    const targetJob = await cancelTargetRes.json();
    const targetJobId = targetJob.id as string;
    const targetMediaId = targetJob.outputMediaId as string;
    const targetSignedUrl = targetJob.outputSignedUrl as string;
    const targetAudioPrefix = (targetJob.result.audioBase64 as string).slice(0, 64);

    const mediaMeta = memoryStore.privateMedia.find((m: any) => m.id === targetMediaId);
    assert.ok(mediaMeta);
    const storageKey = mediaMeta.storageKey as string;
    assert.equal(await PrivateStorageService.getProvider().exists(storageKey), true);

    // Cancel the completed job
    const cancelRes = await fetch(`${baseUrl}/api/v1/jobs/${targetJobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(cancelRes.status, 200);
    const cancelJson = await cancelRes.json();
    assert.equal(cancelJson.success, true);
    assert.equal(cancelJson.job.status, 'cancelled');
    assert.equal(cancelJson.job.result, undefined);
    assert.equal(cancelJson.job.outputSignedUrl, undefined);
    assert.equal(cancelJson.job.outputMediaId, undefined);

    // Underlying file deleted from disk
    assert.equal(await PrivateStorageService.getProvider().exists(storageKey), false);

    // Job detail routes return cancelled status with zero audio/URLs
    for (const detailPath of [`/api/v1/tts/jobs/${targetJobId}`, `/api/v1/jobs/${targetJobId}`]) {
      const detailRes = await fetch(`${baseUrl}${detailPath}`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      assert.equal(detailRes.status, 200);
      const detailText = await detailRes.text();
      assert.equal(detailText.includes(targetAudioPrefix), false);
      assert.equal(detailText.includes(targetSignedUrl), false);
      const detailJson = JSON.parse(detailText);
      const jobObj = detailJson.job || detailJson;
      assert.equal(jobObj.status, 'cancelled');
      assert.equal(jobObj.result, undefined);
      assert.equal(jobObj.outputSignedUrl, undefined);
      assert.equal(jobObj.outputMediaId, undefined);
    }

    // Job list scrubs the cancelled job while preserving the uncancelled control job
    const listRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    const cancelledInList = listJson.jobs.find((j: any) => j.id === targetJobId);
    const keptInList = listJson.jobs.find((j: any) => j.id === keepJob.id);
    assert.equal(cancelledInList.status, 'cancelled');
    assert.equal(cancelledInList.result, undefined);
    assert.equal(cancelledInList.outputSignedUrl, undefined);
    assert.equal(keptInList.status, 'completed');
    assert.ok(keptInList.result?.audioBase64);

    // Direct Bearer media download fails closed (403 MEDIA_ARTIFACT_INVALIDATED)
    const bearerDl = await fetch(`${baseUrl}/api/v1/media/download/${targetMediaId}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(bearerDl.status, 403);
    assert.equal((await bearerDl.json()).code, 'MEDIA_ARTIFACT_INVALIDATED');

    // Previously issued signed URL fails closed (403 MEDIA_ARTIFACT_INVALIDATED)
    const signedDl = await fetch(`${baseUrl}${targetSignedUrl}`);
    assert.equal(signedDl.status, 403);
    const signedBody = Buffer.from(await signedDl.arrayBuffer());
    assert.notEqual(signedBody.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(JSON.parse(signedBody.toString('utf8')).code, 'MEDIA_ARTIFACT_INVALIDATED');
  });

  test('P0-4: Deleting a voice via DELETE /api/voices/:id and DELETE /api/v1/voices/:id scrubs job outputs and invalidates/deletes private media', async () => {
    for (const deleteRoutePrefix of ['/api/voices', '/api/v1/voices']) {
      const createVoiceRes = await fetch(`${baseUrl}/api/v1/voices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          name: `Deletable Voice ${deleteRoutePrefix}`,
          category: 'designed',
          gender: 'female',
          primaryLanguage: 'en',
        }),
      });
      assert.equal(createVoiceRes.status, 201);
      const { voice } = await createVoiceRes.json();

      const synthRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          text: `Audio generated for ${deleteRoutePrefix} deletion test.`,
          voiceId: voice.id,
          language: 'en',
        }),
      });
      assert.equal(synthRes.status, 202);
      const job = await synthRes.json();
      const mediaMeta = memoryStore.privateMedia.find((m: any) => m.id === job.outputMediaId);
      assert.ok(mediaMeta);

      const delRes = await fetch(`${baseUrl}${deleteRoutePrefix}/${voice.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      assert.equal(delRes.status, 200);

      assert.equal(await PrivateStorageService.getProvider().exists(mediaMeta.storageKey), false);

      const listRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      const listJson = await listRes.json();
      const afterJob = listJson.jobs.find((j: any) => j.id === job.id);
      assert.equal(afterJob.status, 'cancelled');
      assert.equal(afterJob.result, undefined);
      assert.equal(afterJob.outputSignedUrl, undefined);

      const signedAfter = await fetch(`${baseUrl}${job.outputSignedUrl}`);
      assert.equal(signedAfter.status, 403);

      const bearerAfter = await fetch(`${baseUrl}/api/v1/media/download/${job.outputMediaId}`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      assert.equal(bearerAfter.status, 403);
    }
  });

  test("P0-5: Cross-tenant callers cannot revoke, delete, cancel, or invalidate another user's voice, job, or media", async () => {
    const aliceVoiceId = await enrollClonedVoiceForUser(aliceToken, 'Alice Tenant Guard Voice', 215);
    const jobRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        text: 'Alice protected audio artifact.',
        voiceId: aliceVoiceId,
        language: 'en',
      }),
    });
    assert.equal(jobRes.status, 202);
    const aliceJob = await jobRes.json();

    // Bob cannot revoke consent
    const bobRevoke = await fetch(`${baseUrl}/api/voices/clone/revoke-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({ voiceId: aliceVoiceId }),
    });
    assert.equal(bobRevoke.status, 403);

    // Bob cannot delete Alice's voice on either route
    for (const prefix of ['/api/voices', '/api/v1/voices']) {
      const bobDel = await fetch(`${baseUrl}${prefix}/${aliceVoiceId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${bobToken}` },
      });
      assert.equal(bobDel.status, 403);
    }

    // Bob cannot cancel Alice's job
    const bobCancel = await fetch(`${baseUrl}/api/v1/jobs/${aliceJob.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert.equal(bobCancel.status, 403);

    // Bob cannot directly invalidate Alice's media in PrivateStorageService
    await assert.rejects(
      () =>
        PrivateStorageService.invalidateAndDeleteMedia({
          mediaId: aliceJob.outputMediaId,
          requestingUserId: 'usr_bob_user',
          isAdmin: false,
          reason: 'manual_delete',
        }),
      /Forbidden/i
    );

    // Alice's job and artifact remain completely intact and accessible to Alice
    const aliceDl = await fetch(`${baseUrl}${aliceJob.outputSignedUrl}`);
    assert.equal(aliceDl.status, 200);
    const wavBuf = Buffer.from(await aliceDl.arrayBuffer());
    assert.equal(wavBuf.subarray(0, 4).toString('ascii'), 'RIFF');
  });

  test('P0-6: Repeated revocation/cancellation and already-removed underlying artifacts behave safely and idempotently', async () => {
    const voiceId = await enrollClonedVoiceForUser(aliceToken, 'Alice Idempotent Voice', 220);
    const jobRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        text: 'Idempotent cleanup verification.',
        voiceId,
        language: 'en',
      }),
    });
    assert.equal(jobRes.status, 202);
    const job = await jobRes.json();

    // Manually remove the underlying disk blob BEFORE cancelling to simulate an already-removed file
    const mediaMeta = memoryStore.privateMedia.find((m: any) => m.id === job.outputMediaId);
    assert.ok(mediaMeta);
    await PrivateStorageService.getProvider().delete(mediaMeta.storageKey);
    assert.equal(await PrivateStorageService.getProvider().exists(mediaMeta.storageKey), false);

    // First cancel succeeds cleanly even though disk file was already absent
    const cancel1 = await fetch(`${baseUrl}/api/v1/jobs/${job.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(cancel1.status, 200);
    const cancel1Json = await cancel1.json();
    assert.equal(cancel1Json.cleanupFailed, false);

    // Second cancel is idempotent
    const cancel2 = await fetch(`${baseUrl}/api/v1/jobs/${job.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(cancel2.status, 200);
    assert.equal((await cancel2.json()).alreadyCancelled, true);

    // First and second consent revocations both succeed idempotently for Alice while still rejecting Bob with 403
    const rev1 = await fetch(`${baseUrl}/api/voices/clone/revoke-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ voiceId }),
    });
    assert.equal(rev1.status, 200);

    const rev2 = await fetch(`${baseUrl}/api/voices/clone/revoke-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ voiceId }),
    });
    assert.equal(rev2.status, 200);

    const bobRevAfter = await fetch(`${baseUrl}/api/voices/clone/revoke-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({ voiceId }),
    });
    assert.equal(bobRevAfter.status, 403);
  });

  test('P0-7: Storage cleanup failure leaves artifact permanently inaccessible and records sanitized failure without leaking audio, paths, or credentials', async () => {
    const voiceId = await enrollClonedVoiceForUser(aliceToken, 'Alice Failing Cleanup Voice', 272);

    const revokeJobRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        text: 'Audio whose provider.delete throws an exception containing sensitive strings.',
        voiceId,
        language: 'en',
      }),
    });
    assert.equal(revokeJobRes.status, 202);
    const revokeJob = await revokeJobRes.json();

    const cancelJobRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        text: 'Audio whose provider.delete returns false while bytes remain on disk.',
        voiceId: 'vf_sarah_en',
        language: 'en',
      }),
    });
    assert.equal(cancelJobRes.status, 202);
    const cancelJob = await cancelJobRes.json();

    const realLocalProvider = PrivateStorageService.getProvider();
    let retrieveCallsAfterInvalidation = 0;
    const SENSITIVE_CREDENTIAL_MARKER = 'AWS_SECRET_ACCESS_KEY=FAKE_CANARY_CREDENTIAL_998877';

    let mode: 'throw' | 'return_false' = 'throw';
    const faultyDeleteProvider: StorageProvider = {
      name: 'faulty_delete_provider',
      isAvailable: () => realLocalProvider.isAvailable(),
      store: (key, buf) => realLocalProvider.store(key, buf),
      retrieve: async (key) => {
        retrieveCallsAfterInvalidation++;
        return realLocalProvider.retrieve(key);
      },
      exists: (key) => realLocalProvider.exists(key),
      delete: async (key) => {
        if (mode === 'throw') {
          throw new Error(`Disk unlink failed for /secret/internal/path/${key} (${SENSITIVE_CREDENTIAL_MARKER})`);
        }
        return false; // Leave underlying file intact on disk!
      },
    };

    try {
      PrivateStorageService.setProvider(faultyDeleteProvider);

      // Case A: provider.delete() throws during consent revocation
      mode = 'throw';
      const revRes = await fetch(`${baseUrl}/api/voices/clone/revoke-consent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ voiceId }),
      });
      assert.equal(revRes.status, 200);
      const revText = await revRes.text();
      assert.equal(revText.includes(SENSITIVE_CREDENTIAL_MARKER), false);
      assert.equal(revText.includes('/secret/internal/path'), false);
      assert.equal(JSON.parse(revText).cleanupFailed, true);

      // Case B: provider.delete() returns false during job cancellation while file still exists on disk
      mode = 'return_false';
      const canRes = await fetch(`${baseUrl}/api/v1/jobs/${cancelJob.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      assert.equal(canRes.status, 200);
      assert.equal((await canRes.json()).cleanupFailed, true);

      // Even though bytes remain on disk, ALL access paths fail closed without calling provider.retrieve()!
      for (const item of [
        { mediaId: revokeJob.outputMediaId, signedUrl: revokeJob.outputSignedUrl },
        { mediaId: cancelJob.outputMediaId, signedUrl: cancelJob.outputSignedUrl },
      ]) {
        const sRes = await fetch(`${baseUrl}${item.signedUrl}`);
        assert.equal(sRes.status, 403);
        const bRes = await fetch(`${baseUrl}/api/v1/media/download/${item.mediaId}`, {
          headers: { Authorization: `Bearer ${aliceToken}` },
        });
        assert.equal(bRes.status, 403);

        await assert.rejects(
          () => PrivateStorageService.getMedia(item.mediaId, 'usr_alice_user', true),
          /invalidated/i
        );
      }
      assert.equal(retrieveCallsAfterInvalidation, 0, 'provider.retrieve must never be called for invalidated artifacts');

      // Audit events recorded failure safely without leaking credentials, paths, or audio
      const auditRes = await fetch(`${baseUrl}/api/v1/audit/events`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      assert.equal(auditRes.status, 200);
      const auditText = await auditRes.text();
      assert.equal(auditText.includes(SENSITIVE_CREDENTIAL_MARKER), false);
      assert.equal(auditText.includes('/secret/internal/path'), false);
      assert.equal(auditText.includes('UklGR'), false);
      const auditJson = JSON.parse(auditText);
      const cleanupEvents = auditJson.events.filter((e: any) => e.eventType === 'media_artifact_cleanup_failed');
      assert.ok(cleanupEvents.length >= 2);
      assert.equal(cleanupEvents[0].details.artifactRemainsInvalidated, true);
    } finally {
      PrivateStorageService.setProvider(realLocalProvider);
    }
  });

  // ==========================================================================
  // OBJECTIVE 2 (P1): STRICT TOKEN EXTRACTION & OPTIONAL-AUTH FAILURE HANDLING
  // ==========================================================================

  test('P1-Auth-1: Query-parameter tokens (?token=whitespace, empty, invalid, or valid JWT) are rejected with 401 and never downgrade to anonymous', async () => {
    const queryVariants = [
      `?token=%20%20%20`,
      `?token=`,
      `?token=not_a_valid_jwt`,
      `?token=${encodeURIComponent(aliceToken)}`,
    ];

    for (const q of queryVariants) {
      // Optional-auth routes
      const voicesOpt = await fetch(`${baseUrl}/api/v1/voices${q}`);
      assert.equal(voicesOpt.status, 401, `GET /api/v1/voices${q} must fail closed with 401`);
      assert.equal((await voicesOpt.json()).code, 'UNSUPPORTED_AUTH_TRANSPORT');

      const legacyVoicesOpt = await fetch(`${baseUrl}/api/voices${q}`);
      assert.equal(legacyVoicesOpt.status, 401, `GET /api/voices${q} must fail closed with 401`);

      // Required-auth routes
      const meReq = await fetch(`${baseUrl}/api/v1/auth/me${q}`);
      assert.equal(meReq.status, 401, `GET /api/v1/auth/me${q} must fail closed with 401`);
    }

    // Even when a valid Bearer header is sent alongside ?token=..., dual transport is rejected with 401
    const dualRes = await fetch(`${baseUrl}/api/v1/voices?token=${encodeURIComponent(aliceToken)}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(dualRes.status, 401);

    // Non-auth operational routes remain unaffected
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
  });

  test('P1-Auth-2: Whitespace Authorization, raw JWT Authorization, malformed Bearer headers, and x-session-token are rejected with 401', async () => {
    const headerCases: Array<{ label: string; headers: Record<string, string>; expectedCode: string }> = [
      { label: 'whitespace-only Authorization', headers: { Authorization: '    ' }, expectedCode: 'MALFORMED_AUTH_HEADER' },
      { label: 'empty Authorization', headers: { Authorization: '' }, expectedCode: 'MALFORMED_AUTH_HEADER' },
      { label: 'raw valid JWT in Authorization', headers: { Authorization: aliceToken }, expectedCode: 'MALFORMED_AUTH_HEADER' },
      { label: 'Bearer without space/token', headers: { Authorization: 'Bearer' }, expectedCode: 'MALFORMED_AUTH_HEADER' },
      { label: 'Bearer with whitespace-only token', headers: { Authorization: 'Bearer     ' }, expectedCode: 'MALFORMED_AUTH_HEADER' },
      { label: 'Bearer with embedded token whitespace', headers: { Authorization: `Bearer ${aliceToken} trailing` }, expectedCode: 'MALFORMED_AUTH_HEADER' },
      { label: 'lowercase bearer scheme', headers: { Authorization: `bearer ${aliceToken}` }, expectedCode: 'MALFORMED_AUTH_HEADER' },
      { label: 'Basic auth scheme', headers: { Authorization: 'Basic YWxpY2U6cGFzcw==' }, expectedCode: 'MALFORMED_AUTH_HEADER' },
      { label: 'x-session-token with valid JWT', headers: { 'x-session-token': aliceToken }, expectedCode: 'UNSUPPORTED_AUTH_TRANSPORT' },
      { label: 'x-session-token with whitespace', headers: { 'x-session-token': '   ' }, expectedCode: 'UNSUPPORTED_AUTH_TRANSPORT' },
    ];

    for (const tc of headerCases) {
      for (const routePath of ['/api/v1/voices', '/api/v1/auth/me']) {
        const res = await sendRawHttpRequest(port, routePath, { headers: tc.headers });
        assert.equal(res.status, 401, `${tc.label} on ${routePath} expected 401, got ${res.status}`);
        assert.equal(res.json?.code, tc.expectedCode, `${tc.label} on ${routePath} code mismatch`);
      }
    }
  });

  test('P1-Auth-3: Malformed, forged, expired, missing-exp, alg:none, and revoked Bearer tokens fail closed with 401 on optionalAuth, while omitted and valid Bearer preserve 200/401/403 contracts', async () => {
    const now = Math.floor(Date.now() / 1000);
    const forgedJwt = signCustomJwt(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'usr_alice_user', email: 'alice@voiceforge.ai', role: 'user', iat: now, exp: now + 3600 },
      'wrong_signing_secret_0000000000000000'
    );
    const expiredJwt = signCustomJwt(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'usr_alice_user', email: 'alice@voiceforge.ai', role: 'user', iat: now - 7200, exp: now - 60 },
      TEST_AUTH_SECRET
    );
    const missingExpJwt = signCustomJwt(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'usr_alice_user', email: 'alice@voiceforge.ai', role: 'user', iat: now },
      TEST_AUTH_SECRET
    );
    const algNoneJwt = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(
      JSON.stringify({ sub: 'usr_alice_user', exp: now + 3600 })
    ).toString('base64url')}.`;

    const tempRevocableToken = AuthService.issueToken(PRELOADED_USERS.usr_bob_user);
    AuthService.revokeToken(tempRevocableToken);

    for (const badBearer of [forgedJwt, expiredJwt, missingExpJwt, algNoneJwt, 'not.a.jwt', tempRevocableToken]) {
      const optRes = await fetch(`${baseUrl}/api/v1/voices`, {
        headers: { Authorization: `Bearer ${badBearer}` },
      });
      assert.equal(optRes.status, 401, 'Invalid/revoked Bearer token must never downgrade to anonymous on optionalAuth');
    }

    // Create a private voice for Alice to confirm anonymous vs valid Bearer behavior
    const privRes = await fetch(`${baseUrl}/api/v1/voices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ name: 'Alice Strict Bearer Private Voice', category: 'designed' }),
    });
    assert.equal(privRes.status, 201);
    const { voice: alicePrivVoice } = await privRes.json();

    // Genuinely omitted credentials remain anonymous on intentionally public optionalAuth route
    const anonVoices = await fetch(`${baseUrl}/api/v1/voices`);
    assert.equal(anonVoices.status, 200);
    const anonList = (await anonVoices.json()).voices as any[];
    assert.equal(anonList.some((v) => v.id === alicePrivVoice.id), false);

    // Genuinely omitted credentials get 401 on protected routes
    const anonJobs = await fetch(`${baseUrl}/api/v1/tts/jobs`);
    assert.equal(anonJobs.status, 401);

    // Valid Bearer gets 200 for own tenant and 403 for admin-only endpoint
    const aliceVoices = await fetch(`${baseUrl}/api/v1/voices`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(aliceVoices.status, 200);
    assert.equal(
      ((await aliceVoices.json()).voices as any[]).some((v) => v.id === alicePrivVoice.id),
      true
    );

    const aliceAuditForbidden = await fetch(`${baseUrl}/api/v1/audit/events`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(aliceAuditForbidden.status, 403);
  });

  // ==========================================================================
  // OBJECTIVE 3 (P1): RESTRICTED-ENVIRONMENT SECRET ENFORCEMENT
  // ==========================================================================

  test('P1-Secrets-1: PrivateStorageService and ConsentVerificationEngine fail closed on missing/invalid secrets in staging and production, work in dev/test, do not leak dev/test fallbacks into staging/prod, and never log secrets', async () => {
    const savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      VOICEFORGE_STORAGE_SECRET: process.env.VOICEFORGE_STORAGE_SECRET,
      VOICEFORGE_CONSENT_SECRET: process.env.VOICEFORGE_CONSENT_SECRET,
    };

    const capturedLogs: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origErr = console.error;
    console.log = (...args: any[]) => capturedLogs.push(args.map(String).join(' '));
    console.warn = (...args: any[]) => capturedLogs.push(args.map(String).join(' '));
    console.error = (...args: any[]) => capturedLogs.push(args.map(String).join(' '));

    const CANARY_STORAGE_SEC = 'canary_storage_secret_prod_778899aabbccddeeff';
    const CANARY_CONSENT_SEC = 'canary_consent_secret_prod_112233445566778899';

    try {
      // 1. Development and test allow unset secrets for local/test compatibility
      for (const permissiveEnv of ['development', 'test']) {
        process.env.NODE_ENV = permissiveEnv;
        delete process.env.VOICEFORGE_STORAGE_SECRET;
        delete process.env.VOICEFORGE_CONSENT_SECRET;

        const signedUrl = PrivateStorageService.generateSignedDownloadUrl('med_dev_1', 'usr_alice_user', 300);
        const parsed = new URL(`http://localhost${signedUrl}`);
        assert.equal(
          PrivateStorageService.verifySignedUrl(
            'med_dev_1',
            'usr_alice_user',
            Number(parsed.searchParams.get('expires')),
            parsed.searchParams.get('sig')!
          ),
          true
        );

        const ch = ConsentVerificationEngine.issueChallenge('usr_alice_user', `Voice_${permissiveEnv}`);
        const refWav = generateSpeechWavBuffer(3.8, 205, 0);
        const conWav = generateSpeechWavBuffer(4.0, 205, 0.4);
        const enrolled = ConsentVerificationEngine.verifyEnrollment({
          challenge: ch,
          voiceName: `Voice_${permissiveEnv}`,
          referenceAudio: refWav,
          consentAudio: conWav,
          userId: 'usr_alice_user',
        });
        assert.equal(enrolled.verified, true);
        assert.equal(ConsentVerificationEngine.isConsentActive(enrolled.voiceId!), true);

        // Switching to staging or production immediately invalidates dev/test fallback URLs, challenges, and enrollments!
        for (const restrictedEnv of ['staging', 'production']) {
          process.env.NODE_ENV = restrictedEnv;
          assert.equal(
            PrivateStorageService.verifySignedUrl(
              'med_dev_1',
              'usr_alice_user',
              Number(parsed.searchParams.get('expires')),
              parsed.searchParams.get('sig')!
            ),
            false,
            `Dev/test signed URL must fail closed in ${restrictedEnv}`
          );
          assert.equal(
            ConsentVerificationEngine.isConsentActive(enrolled.voiceId!),
            false,
            `Dev/test fallback consent audit record must fail closed in ${restrictedEnv}`
          );
        }
      }

      // 2. Missing, empty, whitespace, short, and fallback secrets fail closed in staging, production, and unknown NODE_ENV
      const invalidSecretValues: Array<string | undefined> = [
        undefined,
        '',
        '    ',
        'short_12345',
        'vf_storage_sec_sig_p3a_88a91',
        'vf_consent_sec_prod_99f2a87b1c4e6',
      ];

      for (const restrictedEnv of ['staging', 'production', 'unrecognized_env']) {
        process.env.NODE_ENV = restrictedEnv;

        for (const badVal of invalidSecretValues) {
          if (badVal === undefined) {
            delete process.env.VOICEFORGE_STORAGE_SECRET;
            delete process.env.VOICEFORGE_CONSENT_SECRET;
          } else {
            process.env.VOICEFORGE_STORAGE_SECRET = badVal;
            process.env.VOICEFORGE_CONSENT_SECRET = badVal;
          }

          if (badVal !== 'vf_consent_sec_prod_99f2a87b1c4e6') {
            assert.throws(
              () => PrivateStorageService.getSigningSecret(),
              /FATAL SECURITY CONFIGURATION.*VOICEFORGE_STORAGE_SECRET/i,
              `Expected getSigningSecret to fail closed in ${restrictedEnv} for value=${String(badVal)}`
            );
            assert.throws(
              () => PrivateStorageService.generateSignedDownloadUrl('med_x', 'usr_alice_user'),
              /FATAL SECURITY CONFIGURATION.*VOICEFORGE_STORAGE_SECRET/i
            );
          }

          if (badVal !== 'vf_storage_sec_sig_p3a_88a91') {
            assert.throws(
              () => ConsentVerificationEngine.getConsentSecret(),
              /FATAL SECURITY CONFIGURATION.*VOICEFORGE_CONSENT_SECRET/i,
              `Expected getConsentSecret to fail closed in ${restrictedEnv} for value=${String(badVal)}`
            );
            assert.throws(
              () => ConsentVerificationEngine.issueChallenge('usr_alice_user', 'StagingVoice'),
              /FATAL SECURITY CONFIGURATION.*VOICEFORGE_CONSENT_SECRET/i
            );
          }
        }

        // HTTP challenge route in restricted environment with missing secret fails closed without leaking internals
        delete process.env.VOICEFORGE_CONSENT_SECRET;
        const chHttpRes = await fetch(`${baseUrl}/api/voices/clone/challenge`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aliceToken}`,
          },
          body: JSON.stringify({ voiceName: 'RestrictedChallengeProbe' }),
        });
        assert.equal(chHttpRes.status, 500);
      }

      // 3. Valid strong secrets succeed across development, test, staging, and production without logging secrets
      for (const envName of ['development', 'test', 'staging', 'production']) {
        process.env.NODE_ENV = envName;
        process.env.VOICEFORGE_STORAGE_SECRET = CANARY_STORAGE_SEC;
        process.env.VOICEFORGE_CONSENT_SECRET = CANARY_CONSENT_SEC;

        const url = PrivateStorageService.generateSignedDownloadUrl(`med_ok_${envName}`, 'usr_alice_user', 300);
        const parsed = new URL(`http://localhost${url}`);
        assert.equal(
          PrivateStorageService.verifySignedUrl(
            `med_ok_${envName}`,
            'usr_alice_user',
            Number(parsed.searchParams.get('expires')),
            parsed.searchParams.get('sig')!
          ),
          true
        );

        const ch = ConsentVerificationEngine.issueChallenge('usr_alice_user', `Valid_${envName}`);
        const refWav = generateSpeechWavBuffer(3.9, 225, 0.05);
        const conWav = generateSpeechWavBuffer(4.1, 225, 0.5);
        const outcome = ConsentVerificationEngine.verifyEnrollment({
          challenge: ch,
          voiceName: `Valid_${envName}`,
          referenceAudio: refWav,
          consentAudio: conWav,
          userId: 'usr_alice_user',
        });
        assert.equal(outcome.verified, true);
        assert.equal(ConsentVerificationEngine.isConsentActive(outcome.voiceId!), true);
      }

      const allLogOutput = capturedLogs.join('\n');
      assert.equal(allLogOutput.includes(CANARY_STORAGE_SEC), false, 'Storage secret must never be logged');
      assert.equal(allLogOutput.includes(CANARY_CONSENT_SEC), false, 'Consent secret must never be logged');
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origErr;

      if (savedEnv.NODE_ENV !== undefined) process.env.NODE_ENV = savedEnv.NODE_ENV;
      else delete process.env.NODE_ENV;
      if (savedEnv.VOICEFORGE_STORAGE_SECRET !== undefined) {
        process.env.VOICEFORGE_STORAGE_SECRET = savedEnv.VOICEFORGE_STORAGE_SECRET;
      } else {
        delete process.env.VOICEFORGE_STORAGE_SECRET;
      }
      if (savedEnv.VOICEFORGE_CONSENT_SECRET !== undefined) {
        process.env.VOICEFORGE_CONSENT_SECRET = savedEnv.VOICEFORGE_CONSENT_SECRET;
      } else {
        delete process.env.VOICEFORGE_CONSENT_SECRET;
      }
    }
  });

  test('P1-Secrets-2: Fresh module initialization in isolated staging and production subprocesses never caches static fallback secrets', () => {
    const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
    const probeScript = `
      import assert from 'node:assert/strict';
      import { PrivateStorageService } from './server/storage/privateStorage.ts';
      import { ConsentVerificationEngine } from './server/engine/audio/consent.ts';

      assert.throws(() => PrivateStorageService.getSigningSecret(), /FATAL SECURITY CONFIGURATION.*VOICEFORGE_STORAGE_SECRET/i);
      assert.throws(() => ConsentVerificationEngine.getConsentSecret(), /FATAL SECURITY CONFIGURATION.*VOICEFORGE_CONSENT_SECRET/i);
      assert.throws(() => ConsentVerificationEngine.issueChallenge('usr_alice_user', 'ColdBoot'), /FATAL SECURITY CONFIGURATION.*VOICEFORGE_CONSENT_SECRET/i);
      process.stdout.write('COLD_BOOT_FAIL_CLOSED_OK');
    `;

    for (const restrictedEnv of ['staging', 'production']) {
      const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: restrictedEnv };
      delete childEnv.VOICEFORGE_STORAGE_SECRET;
      delete childEnv.VOICEFORGE_CONSENT_SECRET;

      const stdout = execFileSync(tsxBin, ['--input-type=module', '-e', probeScript], {
        cwd: process.cwd(),
        env: childEnv,
        encoding: 'utf8',
      });
      assert.match(stdout, /COLD_BOOT_FAIL_CLOSED_OK/);
    }
  });
});
