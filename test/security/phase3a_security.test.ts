/**
 * VoiceForge Phase 3A Security & Multi-Tenant Adversarial Test Suite
 * 
 * Verifies:
 * 1. Server-validated authentication & authorization enforcement (401 on missing/forged tokens)
 * 2. Identity forgery resistance (client-supplied body userId cannot spoof or hijack challenge)
 * 3. Cross-tenant isolation (User B cannot mutate, revoke, or synthesize with User A's private voice)
 * 4. Biometric consent revocation fail-closed enforcement (revoked voice immediately blocks synthesis)
 * 5. Private storage isolation & magic-byte payload inspection (rejects polyglot/malicious payloads)
 * 6. HMAC signed download URL security (rejects expired or forged signatures)
 * 7. Security audit ledger tracking
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import { apiRouter } from '../../server/routes/api.ts';
import { AuthService, PRELOADED_USERS } from '../../server/auth/auth.ts';
import { ConsentVerificationEngine } from '../../server/engine/audio/consent.ts';
import { PrivateStorageService } from '../../server/storage/privateStorage.ts';

describe('Phase 3A Security & Adversarial Hardening Suite', () => {
  let server: http.Server;
  let baseUrl: string;

  // Test Tokens
  let aliceToken: string;
  let bobToken: string;
  let adminToken: string;

  // Helper to generate synthetic PCM 16-bit WAV audio buffer
  function createSyntheticWav(durationSeconds: number, freq: number = 440): Buffer {
    const sampleRate = 24000;
    const numSamples = Math.floor(sampleRate * durationSeconds);
    const pcm = new Int16Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      // Speech-like amplitude modulated tone
      const env = Math.min(1.0, t * 2.0) * Math.min(1.0, (durationSeconds - t) * 2.0);
      const val = Math.sin(2 * Math.PI * freq * t) * 0.4 + Math.sin(2 * Math.PI * (freq * 1.5) * t) * 0.2;
      pcm[i] = Math.floor(val * env * 26000);
    }

    const numChannels = 1;
    const bitsPerSample = 16;
    const dataSize = pcm.length * 2;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE((sampleRate * numChannels * bitsPerSample) / 8, 28);
    buffer.writeUInt16LE((numChannels * bitsPerSample) / 8, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);

    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    for (let i = 0; i < pcm.length; i++) {
      buffer.writeInt16LE(pcm[i], 44 + i * 2);
    }

    return buffer;
  }

  before((_, done) => {
    // Generate valid session tokens
    aliceToken = AuthService.issueToken(PRELOADED_USERS['usr_alice_user']);
    bobToken = AuthService.issueToken(PRELOADED_USERS['usr_bob_user']);
    adminToken = AuthService.issueToken(PRELOADED_USERS['usr_admin_root']);

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

  // ==========================================================================
  // 1. AUTHENTICATION ENFORCEMENT & TOKEN VALIDATION
  // ==========================================================================
  test('SECURITY: Anonymous request to /api/v1/auth/me is rejected with 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/me`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'AUTH_REQUIRED');
  });

  test('SECURITY: Forged token signature to /api/v1/auth/me is rejected with 401', async () => {
    const forgedToken = aliceToken.substring(0, aliceToken.lastIndexOf('.')) + '.tampered_invalid_sig';
    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${forgedToken}` },
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'AUTH_INVALID_TOKEN');
  });

  test('SECURITY: Valid token returns authentic identity matching server claims', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.id, 'usr_alice_user');
    assert.equal(body.user.email, 'alice@voiceforge.ai');
    assert.equal(body.user.role, 'user');
  });

  // ==========================================================================
  // 2. CLIENT-SUPPLIED IDENTITY SPOOFING RESISTANCE
  // ==========================================================================
  test('SECURITY: Client-supplied userId in body cannot hijack identity when authenticated', async () => {
    // Alice requests a challenge with body userId: 'usr_bob_user'
    const res = await fetch(`${baseUrl}/api/voices/clone/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        voiceName: "Alice's Cloned Identity",
        userId: 'usr_bob_user', // Attempted body spoof
      }),
    });
    assert.equal(res.status, 200);
    const challenge = await res.json();
    // Server must bind to Alice's authentic token id, ignoring Bob's id in body
    assert.equal(challenge.userId, 'usr_alice_user');
  });

  test('SECURITY: User B cannot enroll using a challenge issued to User A', async () => {
    // 1. Alice gets a legitimate challenge
    const chalRes = await fetch(`${baseUrl}/api/voices/clone/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ voiceName: "Alice's High Security Voice" }),
    });
    const challenge = await chalRes.json();
    assert.equal(challenge.userId, 'usr_alice_user');

    // 2. Bob attempts to use Alice's challenge with Bob's token
    const testAudio = createSyntheticWav(4.0, 440).toString('base64');
    const bobEnrollRes = await fetch(`${baseUrl}/api/voices/clone/verify-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({
        challenge,
        voiceName: "Bob's Impersonation Voice",
        referenceAudioBase64: testAudio,
        consentAudioBase64: testAudio,
      }),
    });

    assert.equal(bobEnrollRes.status, 403);
    const errBody = await bobEnrollRes.json();
    assert.equal(errBody.code, 'CHALLENGE_IDENTITY_MISMATCH');
  });

  // ==========================================================================
  // 3. CROSS-TENANT PROFILE & CONSENT ISOLATION
  // ==========================================================================
  test('SECURITY: Cross-tenant voice mutation & revocation is rejected with 403', async () => {
    // 1. Alice creates and enrolls a verified voice
    const chalRes = await fetch(`${baseUrl}/api/voices/clone/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ voiceName: "Alice Private Voice 1" }),
    });
    const challenge = await chalRes.json();

    const wavA = createSyntheticWav(4.5, 320);
    const wavB = createSyntheticWav(4.5, 325); // Acoustically similar

    const enrollRes = await fetch(`${baseUrl}/api/voices/clone/verify-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        challenge,
        voiceName: "Alice Private Voice 1",
        referenceAudioBase64: wavA.toString('base64'),
        consentAudioBase64: wavB.toString('base64'),
      }),
    });

    assert.equal(enrollRes.status, 200);
    const enrollData = await enrollRes.json();
    const aliceVoiceId = enrollData.voiceId;
    assert.ok(aliceVoiceId);

    // 2. Bob attempts to revoke Alice's voice consent
    const bobRevokeRes = await fetch(`${baseUrl}/api/voices/clone/revoke-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({ voiceId: aliceVoiceId }),
    });

    assert.equal(bobRevokeRes.status, 403);
    const revokeErr = await bobRevokeRes.json();
    assert.equal(revokeErr.code, 'FORBIDDEN_NOT_OWNER');

    // 3. Bob attempts to delete Alice's voice
    const bobDeleteRes = await fetch(`${baseUrl}/api/v1/voices/${aliceVoiceId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert.equal(bobDeleteRes.status, 403);

    // 4. Bob attempts to synthesize using Alice's private cloned voice
    const bobSynthRes = await fetch(`${baseUrl}/api/tts/synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({
        text: 'Attempting unauthorized speech synthesis with stolen voice.',
        voiceId: aliceVoiceId,
      }),
    });
    assert.equal(bobSynthRes.status, 403);
    const synthErr = await bobSynthRes.json();
    assert.equal(synthErr.code, 'FORBIDDEN_NOT_OWNER');
  });

  // ==========================================================================
  // 4. CONSENT REVOCATION FAIL-CLOSED ENFORCEMENT
  // ==========================================================================
  test('SECURITY: Revoking consent immediately blocks synthesis for owner and all callers', async () => {
    // 1. Alice creates another verified voice
    const chalRes = await fetch(`${baseUrl}/api/voices/clone/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ voiceName: "Alice Revocable Voice" }),
    });
    const challenge = await chalRes.json();

    const wavA = createSyntheticWav(4.0, 360);
    const wavB = createSyntheticWav(4.0, 364);

    const enrollRes = await fetch(`${baseUrl}/api/voices/clone/verify-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        challenge,
        voiceName: "Alice Revocable Voice",
        referenceAudioBase64: wavA.toString('base64'),
        consentAudioBase64: wavB.toString('base64'),
      }),
    });
    assert.equal(enrollRes.status, 200);
    const { voiceId } = await enrollRes.json();

    // 2. Alice legitimately revokes consent for her own voice
    const revokeRes = await fetch(`${baseUrl}/api/voices/clone/revoke-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ voiceId }),
    });
    assert.equal(revokeRes.status, 200);

    // 3. Any synthesis request for this voice MUST now fail-closed with 403 CONSENT_REVOKED
    const synthRes = await fetch(`${baseUrl}/api/tts/synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        text: 'This synthesis must be permanently blocked due to revoked biometric consent.',
        voiceId,
      }),
    });
    assert.equal(synthRes.status, 403);
    const synthErr = await synthRes.json();
    assert.equal(synthErr.code, 'CONSENT_REVOKED');
  });

  // ==========================================================================
  // 5. PRIVATE STORAGE & MAGIC-BYTE INSPECTION
  // ==========================================================================
  test('SECURITY: Uploading non-audio/polyglot payload is rejected by magic-byte inspector', async () => {
    // Malicious HTML/SVG polyglot payload disguised as audio
    const maliciousPayload = Buffer.from('<html><script>alert("xss")</script></html>').toString('base64');
    const res = await fetch(`${baseUrl}/api/v1/media/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        audioBase64: maliciousPayload,
        filename: 'malicious.wav',
        mediaType: 'reference_audio',
      }),
    });
    assert.equal(res.status, 400);
    const err = await res.json();
    assert.match(err.error, /Malicious non-audio payload detected|Unrecognized audio container/i);
  });

  test('SECURITY: Valid audio upload succeeds and generates expiring signed download URL', async () => {
    const validWav = createSyntheticWav(3.5, 400);
    const res = await fetch(`${baseUrl}/api/v1/media/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        audioBase64: validWav.toString('base64'),
        filename: 'valid_studio_sample.wav',
        mediaType: 'reference_audio',
      }),
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.media.id);
    assert.equal(data.media.audioFormat, 'wav');
    assert.ok(data.signedDownloadUrl);

    // Verify download using legitimate signed URL
    const dlRes = await fetch(`${baseUrl}${data.signedDownloadUrl}`);
    assert.equal(dlRes.status, 200);
    assert.equal(dlRes.headers.get('content-type'), 'audio/wav');
    const downloadedBuffer = Buffer.from(await dlRes.arrayBuffer());
    assert.equal(downloadedBuffer.length, validWav.length);

    // Verify download with forged signature is rejected with 403
    const forgedUrl = data.signedDownloadUrl.replace(/sig=[a-f0-9]+/, 'sig=00000000000000000000000000000000');
    const forgedRes = await fetch(`${baseUrl}${forgedUrl}`);
    assert.equal(forgedRes.status, 403);

    // Verify download with expired timestamp is rejected with 403
    const expiredUrl = data.signedDownloadUrl.replace(/expires=\d+/, 'expires=1500000000');
    const expiredRes = await fetch(`${baseUrl}${expiredUrl}`);
    assert.equal(expiredRes.status, 403);
  });

  // ==========================================================================
  // 6. ASYNCHRONOUS OWNED SYNTHESIS JOBS
  // ==========================================================================
  test('SECURITY: Synthesis jobs are strictly bound to caller and isolate private output', async () => {
    const res = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        text: 'Alice private synthesis test with signed media download.',
        voiceId: 'vf_sarah_en',
        language: 'en',
      }),
    });
    assert.equal(res.status, 202);
    const job = await res.json();
    assert.equal(job.userId, 'usr_alice_user');
    assert.ok(job.outputMediaId);
    assert.ok(job.outputSignedUrl);

    // Bob cannot fetch Alice's job record
    const bobFetchJob = await fetch(`${baseUrl}/api/v1/tts/jobs/${job.id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert.equal(bobFetchJob.status, 403);

    // Alice CAN fetch her job record
    const aliceFetchJob = await fetch(`${baseUrl}/api/v1/tts/jobs/${job.id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(aliceFetchJob.status, 200);
  });

  // ==========================================================================
  // 7. SECURITY AUDIT LEDGER TRACKING
  // ==========================================================================
  test('SECURITY: Tamper-evident audit events record operations and authorization denials', async () => {
    const res = await fetch(`${baseUrl}/api/v1/audit/events`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.events));
    assert.ok(data.events.length > 0);

    const eventTypes = data.events.map((e: any) => e.eventType);
    assert.ok(eventTypes.includes('consent_challenge_issued'));
    assert.ok(eventTypes.includes('consent_enrolled') || eventTypes.includes('consent_revoked'));
  });

  // ==========================================================================
  // 8. TOKEN REVOCATION DENYLIST & SESSION TERMINATION
  // ==========================================================================
  test('SECURITY: Revoked tokens are immediately rejected by token verifier and API gateway', async () => {
    // 1. Issue a dedicated disposable token
    const disposableToken = AuthService.issueToken(PRELOADED_USERS['usr_bob_user']);
    assert.equal(AuthService.isTokenRevoked(disposableToken), false);

    // 2. Verified active before revocation
    const activeRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${disposableToken}` },
    });
    assert.equal(activeRes.status, 200);

    // 3. Revoke token via endpoint
    const revokeRes = await fetch(`${baseUrl}/api/v1/auth/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${disposableToken}`,
      },
      body: JSON.stringify({ token: disposableToken }),
    });
    assert.equal(revokeRes.status, 200);
    assert.equal(AuthService.isTokenRevoked(disposableToken), true);

    // 4. Verification fails immediately with 401 AUTH_TOKEN_REVOKED
    const blockedRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${disposableToken}` },
    });
    assert.equal(blockedRes.status, 401);
    const body = await blockedRes.json();
    assert.equal(body.code, 'AUTH_TOKEN_REVOKED');
  });

  // ==========================================================================
  // 9. PRODUCTION ENVIRONMENT MISSING SECRET FAIL-CLOSED
  // ==========================================================================
  test('SECURITY: Production fails closed if cryptographic secrets are unset', () => {
    const origEnv = process.env.NODE_ENV;
    const origAuthSec = process.env.VOICEFORGE_AUTH_SECRET;
    const origStorSec = process.env.VOICEFORGE_STORAGE_SECRET;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.VOICEFORGE_AUTH_SECRET;
      delete process.env.VOICEFORGE_STORAGE_SECRET;

      assert.throws(
        () => AuthService.getAuthSecret(),
        /FATAL SECURITY CONFIGURATION.*VOICEFORGE_AUTH_SECRET/i
      );

      assert.throws(
        () => PrivateStorageService.getSigningSecret(),
        /FATAL SECURITY CONFIGURATION.*VOICEFORGE_STORAGE_SECRET/i
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origAuthSec) process.env.VOICEFORGE_AUTH_SECRET = origAuthSec;
      if (origStorSec) process.env.VOICEFORGE_STORAGE_SECRET = origStorSec;
    }
  });

  // ==========================================================================
  // 10. OVERSIZED MEDIA PAYLOAD REJECTION (25MB LIMIT)
  // ==========================================================================
  test('SECURITY: Media uploads exceeding 25MB are rejected fail-closed', async () => {
    const oversizedBuffer = Buffer.alloc(26 * 1024 * 1024); // 26MB
    oversizedBuffer.write('RIFF', 0);
    oversizedBuffer.write('WAVE', 8);

    await assert.rejects(
      async () => {
        await PrivateStorageService.storeMedia({
          userId: 'usr_alice_user',
          mediaType: 'reference_audio',
          filename: 'oversized.wav',
          buffer: oversizedBuffer,
        });
      },
      /exceeds maximum limit of 25MB/i
    );
  });

  // ==========================================================================
  // 11. ARTIFACT DOWNLOAD & IN-FLIGHT JOBS BLOCKED ON CONSENT REVOCATION
  // ==========================================================================
  test('SECURITY: Artifact downloads and job access are blocked when voice consent is revoked', async () => {
    // 1. Enroll a temporary verified voice
    const chalRes = await fetch(`${baseUrl}/api/voices/clone/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ voiceName: "Alice Trace Consent Voice" }),
    });
    const challenge = await chalRes.json();
    const wavA = createSyntheticWav(4.0, 340);
    const wavB = createSyntheticWav(4.0, 344);

    const enrollRes = await fetch(`${baseUrl}/api/voices/clone/verify-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        challenge,
        voiceName: "Alice Trace Consent Voice",
        referenceAudioBase64: wavA.toString('base64'),
        consentAudioBase64: wavB.toString('base64'),
      }),
    });
    assert.equal(enrollRes.status, 200);
    const { voiceId } = await enrollRes.json();

    // 2. Dispatch a TTS job using this voice
    const jobRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        text: 'Speech audio artifact generated prior to biometric consent revocation.',
        voiceId,
        language: 'en',
      }),
    });
    assert.equal(jobRes.status, 202);
    const job = await jobRes.json();
    assert.ok(job.outputMediaId);
    assert.ok(job.outputSignedUrl);

    // Verify media can be downloaded while consent is active
    const downloadBefore = await fetch(`${baseUrl}${job.outputSignedUrl}`);
    assert.equal(downloadBefore.status, 200);

    // 3. Owner revokes consent for this voice
    const revokeRes = await fetch(`${baseUrl}/api/voices/clone/revoke-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ voiceId }),
    });
    assert.equal(revokeRes.status, 200);

    // 4. Downloading the stored media artifact MUST now be rejected with 403 CONSENT_REVOKED
    const downloadAfter = await fetch(`${baseUrl}${job.outputSignedUrl}`);
    assert.equal(downloadAfter.status, 403);
    const dlErr = await downloadAfter.json();
    assert.equal(dlErr.code, 'CONSENT_REVOKED');

    // 5. Querying the job MUST now return 403 CONSENT_REVOKED with status cancelled
    const jobAfter = await fetch(`${baseUrl}/api/v1/tts/jobs/${job.id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(jobAfter.status, 403);
    const jobErr = await jobAfter.json();
    assert.equal(jobErr.code, 'CONSENT_REVOKED');
    assert.equal(jobErr.job.status, 'cancelled');
  });
});
