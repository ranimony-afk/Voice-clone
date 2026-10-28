/**
 * VoiceForge Phase 3B — Consent & Asynchronous Job Race Condition Suite
 * 
 * Tests the 7 critical lifecycle scenarios:
 * 1. Consent is revoked before job submission -> rejected at submission with 403 CONSENT_REVOKED.
 * 2. Consent is revoked after job submission but before worker execution -> worker aborts job with status 'cancelled'.
 * 3. Consent is revoked while a job is running -> worker detects revocation and cancels completion.
 * 4. Consent is revoked after synthesis but before artifact access -> artifact access blocked with 403 CONSENT_REVOKED.
 * 5. A worker receives a job belonging to another user -> worker tenant validation aborts execution with TENANT_MISMATCH.
 * 6. A user attempts to fetch another user's completed artifact -> rejected with 403 FORBIDDEN_MEDIA_ACCESS.
 * 7. The storage/database becomes unavailable during a security-critical operation -> fails closed safely.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import { apiRouter } from '../../server/routes/api.ts';
import { AuthService, PRELOADED_USERS } from '../../server/auth/auth.ts';
import { ConsentVerificationEngine } from '../../server/engine/audio/consent.ts';
import { SynthesisJobWorker, SynthesisJobRecord } from '../../server/engine/audio/jobWorker.ts';
import { PrivateStorageService, StorageUnavailableError } from '../../server/storage/privateStorage.ts';
import { DEFAULT_VOICES } from '../../server/data/voices.ts';

describe('Phase 3B: Consent & Asynchronous Job Race Condition Suite', () => {
  let server: http.Server;
  let baseUrl: string;
  let aliceToken: string;
  let bobToken: string;
  const worker = new SynthesisJobWorker();

  // Synthetic WAV generator
  function createSyntheticWav(durationSeconds: number, freq: number = 440): Buffer {
    const sampleRate = 24000;
    const numSamples = Math.floor(sampleRate * durationSeconds);
    const pcm = new Int16Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      pcm[i] = Math.floor(Math.sin(2 * Math.PI * freq * t) * 20000);
    }
    const dataSize = pcm.length * 2;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // Mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < pcm.length; i++) {
      buffer.writeInt16LE(pcm[i], 44 + i * 2);
    }
    return buffer;
  }

  before((_, done) => {
    aliceToken = AuthService.issueToken(PRELOADED_USERS['usr_alice_user']);
    bobToken = AuthService.issueToken(PRELOADED_USERS['usr_bob_user']);

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

  // Helper: Enroll a verified cloned voice for Alice
  async function enrollVoice(voiceName: string): Promise<string> {
    const chalRes = await fetch(`${baseUrl}/api/voices/clone/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ voiceName }),
    });
    const challenge = await chalRes.json();
    const wavA = createSyntheticWav(4.0, 310);
    const wavB = createSyntheticWav(4.0, 314);

    const enrollRes = await fetch(`${baseUrl}/api/voices/clone/verify-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        challenge,
        voiceName,
        referenceAudioBase64: wavA.toString('base64'),
        consentAudioBase64: wavB.toString('base64'),
      }),
    });
    const data = await enrollRes.json();
    return data.voiceId;
  }

  // SCENARIO 1: Consent revoked before job submission
  test('RACE 1: Consent revoked before job submission is rejected immediately with 403', async () => {
    const voiceId = await enrollVoice('Voice Revoked Before Submission');

    // Revoke consent
    ConsentVerificationEngine.revokeConsent(voiceId, 'usr_alice_user');

    // Attempt job submission
    const res = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        text: 'This submission must be rejected because consent is revoked.',
        voiceId,
        language: 'en',
      }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'CONSENT_REVOKED');
  });

  // SCENARIO 2: Consent revoked after submission but before worker execution
  test('RACE 2: Consent revoked after job submission but before worker execution cancels job', async () => {
    const voiceId = await enrollVoice('Voice Revoked Pre-Worker');
    const voice = DEFAULT_VOICES[0];

    const queuedJob: SynthesisJobRecord = {
      id: `job_race2_${Date.now()}`,
      userId: 'usr_alice_user',
      voiceId,
      status: 'pending',
      executionMode: 'DEMO',
      inputText: 'Queued text waiting for worker pickup.',
      language: 'en',
      creditsCharged: 0,
      createdAt: new Date().toISOString(),
    };

    // Owner revokes consent while job is queued in pending state
    ConsentVerificationEngine.revokeConsent(voiceId, 'usr_alice_user');

    // Worker picks up job
    const result = await worker.executeJob(queuedJob, voice, 'usr_alice_user');

    assert.equal(result.status, 'cancelled');
    assert.match(result.errorMessage || '', /consent.*revoked prior to execution/i);
    assert.equal(result.outputMediaId, undefined, 'No output media must be generated');
  });

  // SCENARIO 3: Consent revoked while synthesis job is actively executing
  test('RACE 3: Consent revoked during active synthesis aborts completion and discards output', async () => {
    const voiceId = await enrollVoice('Voice Revoked Mid-Flight');
    const voice = DEFAULT_VOICES[0];

    const activeJob: SynthesisJobRecord = {
      id: `job_race3_${Date.now()}`,
      userId: 'usr_alice_user',
      voiceId,
      status: 'pending',
      executionMode: 'DEMO',
      inputText: 'Text being synthesized by worker.',
      language: 'en',
      creditsCharged: 0,
      createdAt: new Date().toISOString(),
    };

    // Hook: When worker starts processing, simulate asynchronous consent revocation
    const result = await worker.executeJob(
      activeJob,
      voice,
      'usr_alice_user',
      (stage) => {
        if (stage === 'processing_started') {
          ConsentVerificationEngine.revokeConsent(voiceId, 'usr_alice_user');
        }
      }
    );

    assert.equal(result.status, 'cancelled');
    assert.match(result.errorMessage || '', /consent.*revoked during synthesis/i);
    assert.equal(result.outputMediaId, undefined, 'Output media must not be committed');
  });

  // SCENARIO 4: Consent revoked after synthesis but before artifact access
  test('RACE 4: Consent revoked after synthesis blocks subsequent artifact download', async () => {
    const voiceId = await enrollVoice('Voice Revoked Pre-Download');

    // 1. Submit and complete job
    const jobRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        text: 'Speech synthesized while consent was active.',
        voiceId,
        language: 'en',
      }),
    });
    assert.equal(jobRes.status, 202);
    const job = await jobRes.json();
    assert.ok(job.outputSignedUrl);

    // Download succeeds while consent is active
    const dlBefore = await fetch(`${baseUrl}${job.outputSignedUrl}`);
    assert.equal(dlBefore.status, 200);

    // 2. Revoke consent
    ConsentVerificationEngine.revokeConsent(voiceId, 'usr_alice_user');

    // 3. Artifact download must now fail closed with 403
    const dlAfter = await fetch(`${baseUrl}${job.outputSignedUrl}`);
    assert.equal(dlAfter.status, 403);
    const err = await dlAfter.json();
    assert.equal(err.code, 'CONSENT_REVOKED');
  });

  // SCENARIO 5: Worker receives a job belonging to another user
  test('RACE 5: Worker tenant mismatch aborts execution with security violation', async () => {
    const foreignJob: SynthesisJobRecord = {
      id: `job_tenant_mismatch_${Date.now()}`,
      userId: 'usr_alice_user',
      voiceId: 'vf_sarah_en',
      status: 'pending',
      executionMode: 'DEMO',
      inputText: 'Foreign job dispatch test.',
      language: 'en',
      creditsCharged: 0,
      createdAt: new Date().toISOString(),
    };

    // Bob's worker process attempts to execute Alice's job
    const result = await worker.executeJob(foreignJob, DEFAULT_VOICES[0], 'usr_bob_user');

    assert.equal(result.status, 'failed');
    assert.match(result.errorMessage || '', /Worker tenant mismatch/i);
  });

  // SCENARIO 6: User attempts to fetch another user's completed artifact
  test("RACE 6: User B cannot download User A's private media artifact", async () => {
    const validWav = createSyntheticWav(3.0, 440);
    const uploadRes = await fetch(`${baseUrl}/api/v1/media/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        audioBase64: validWav.toString('base64'),
        filename: 'alice_private.wav',
        mediaType: 'reference_audio',
      }),
    });
    assert.equal(uploadRes.status, 201);
    const { media } = await uploadRes.json();

    // Bob attempts to download Alice's media via Bearer token without valid signed URL
    const bobDlRes = await fetch(`${baseUrl}/api/v1/media/download/${media.id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert.equal(bobDlRes.status, 403);
    const err = await bobDlRes.json();
    assert.equal(err.code, 'FORBIDDEN_MEDIA_ACCESS');
  });

  // SCENARIO 7: Storage unavailable fails closed safely
  test('RACE 7: Storage backend outage returns HTTP 503 without leaking data', async () => {
    const validWav = createSyntheticWav(3.0, 440);
    const uploadRes = await fetch(`${baseUrl}/api/v1/media/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        audioBase64: validWav.toString('base64'),
        filename: 'alice_outage_test.wav',
      }),
    });
    const { media } = await uploadRes.json();

    // Temporarily replace storage provider with one that simulates disk outage
    const realProvider = PrivateStorageService.getProvider();
    const failingProvider = {
      name: 'simulated_failing_storage',
      isAvailable: async () => false,
      store: async () => { throw new StorageUnavailableError('Simulated disk partition failure'); },
      retrieve: async () => { throw new StorageUnavailableError('Simulated disk read I/O error'); },
      delete: async () => false,
      exists: async () => false,
    };

    try {
      PrivateStorageService.setProvider(failingProvider);

      const downloadRes = await fetch(`${baseUrl}/api/v1/media/download/${media.id}`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      });

      assert.equal(downloadRes.status, 503, 'Must return 503 Service Unavailable');
      const err = await downloadRes.json();
      assert.equal(err.code, 'STORAGE_UNAVAILABLE');
    } finally {
      PrivateStorageService.setProvider(realProvider);
    }
  });
});
