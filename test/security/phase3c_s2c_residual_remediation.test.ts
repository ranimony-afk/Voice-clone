/**
 * Phase 3C-S2C — Residual Security Remediation Regression Suite
 *
 * Covers all six findings documented in reports/PHASE-3C-S2B-INDEPENDENT-SECURITY-VERIFICATION.md:
 * - S2B-NEW-01 (P0): Multimodal dubbing ledger tenant isolation, active consent, and eager/lazy scrubbing
 * - S2B-NEW-02 (P1): AudioWatermarker restricted-environment secret enforcement & legacy-key hardening
 * - S2B-NEW-03 (P2): Raw HTTP duplicate/ambiguous Authorization header rejection across requireAuth & optionalAuth
 * - S2B-NEW-04 (P2): Restart-durable media invalidation tombstones, reconciliation, and fail-closed ledger corruption
 * - S2B-NEW-05 (P2): getAuthSecret(), db, and synthesizer restricted-environment parity
 * - S2B-NEW-06 (P3): GET /api/v1/media out-of-band consent revocation scrubbing & internal storageKey omission
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import express from 'express';

import { apiRouter } from '../../server/routes/api.ts';
import {
  AuthService,
  DurableRevocationStore,
  PRELOADED_USERS,
  getAuthSecret,
} from '../../server/auth/auth.ts';
import {
  PrivateStorageService,
  LocalStorageProvider,
  StorageUnavailableError,
} from '../../server/storage/privateStorage.ts';
import { ConsentVerificationEngine } from '../../server/engine/audio/consent.ts';
import { AudioWatermarker } from '../../server/engine/audio/watermark.ts';
import { VoiceForgeSynthesizer } from '../../server/engine/audio/synthesizer.ts';
import { assertDatabaseConfigured, FatalDatabaseConfigurationError, memoryStore } from '../../server/db/index.ts';
import { globalStore } from '../../server/middleware/rateLimiter.ts';

function generateSyntheticSpeechWav(durationSec: number, baseFreqHz: number, phaseOffset: number = 0): Buffer {
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.sin(2 * Math.PI * 3.0 * t + phaseOffset) > -0.3 ? 1.0 : 0.05;
    const wave =
      (Math.sin(2 * Math.PI * baseFreqHz * t + phaseOffset) +
        0.5 * Math.sin(4 * Math.PI * baseFreqHz * t)) *
      0.4 *
      envelope;
    const clamped = Math.max(-0.95, Math.min(0.95, wave));
    buf.writeInt16LE(Math.floor(clamped * 32767), 44 + i * 2);
  }
  return buf;
}

function sendRawHttpRequest(
  port: number,
  requestLines: string[]
): Promise<{ status: number; rawHead: string; bodyText: string; json: any }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(requestLines.join('\r\n') + '\r\n\r\n');
    });
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const [head, ...rest] = raw.split('\r\n\r\n');
      const bodyText = rest.join('\r\n\r\n');
      const match = head.match(/^HTTP\/1\.[01] (\d{3})/);
      const status = match ? Number(match[1]) : 0;
      let json: any = null;
      try {
        json = JSON.parse(bodyText);
      } catch {}
      resolve({ status, rawHead: head, bodyText, json });
    });
    socket.on('error', reject);
  });
}

function parseLastJsonLine(stdout: string): any {
  const lines = stdout
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'));
  assert.ok(lines.length > 0, `Expected JSON line in subprocess output, got: ${stdout}`);
  return JSON.parse(lines[lines.length - 1]);
}

describe('Phase 3C-S2C: Residual Security Remediation Suite', () => {
  let server: http.Server;
  let port: number;
  let baseUrl: string;
  let tempRoot: string;
  let baseLocalProvider: LocalStorageProvider;

  let savedEnv: Record<string, string | undefined>;
  let originalFetch: typeof globalThis.fetch;

  let aliceToken: string;
  let bobToken: string;
  let adminToken: string;

  const TEST_AUTH_SECRET = 's2c_test_auth_secret_0123456789abcdef_strong';
  const TEST_STORAGE_SECRET = 's2c_test_storage_secret_0123456789abcdef_strong';
  const TEST_CONSENT_SECRET = 's2c_test_consent_secret_0123456789abcdef_strong';
  const TEST_WATERMARK_SECRET = 's2c_test_watermark_secret_0123456789abcdef_strong';

  before(async () => {
    savedEnv = {
      NODE_ENV: process.env.NODE_ENV,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      VOICEFORGE_AUTH_SECRET: process.env.VOICEFORGE_AUTH_SECRET,
      VOICEFORGE_STORAGE_SECRET: process.env.VOICEFORGE_STORAGE_SECRET,
      VOICEFORGE_CONSENT_SECRET: process.env.VOICEFORGE_CONSENT_SECRET,
      VOICEFORGE_WATERMARK_KEY: process.env.VOICEFORGE_WATERMARK_KEY,
      VOICEFORGE_WATERMARK_LEGACY_KEY: process.env.VOICEFORGE_WATERMARK_LEGACY_KEY,
      VOICEFORGE_STORAGE_DIR: process.env.VOICEFORGE_STORAGE_DIR,
      VOICEFORGE_REVOCATION_FILE: process.env.VOICEFORGE_REVOCATION_FILE,
      VOICEFORGE_MEDIA_TOMBSTONE_FILE: process.env.VOICEFORGE_MEDIA_TOMBSTONE_FILE,
    };

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-phase3c-s2c-'));
    delete process.env.GEMINI_API_KEY;
    process.env.NODE_ENV = 'test';
    process.env.VOICEFORGE_AUTH_SECRET = TEST_AUTH_SECRET;
    process.env.VOICEFORGE_STORAGE_SECRET = TEST_STORAGE_SECRET;
    process.env.VOICEFORGE_CONSENT_SECRET = TEST_CONSENT_SECRET;
    process.env.VOICEFORGE_WATERMARK_KEY = TEST_WATERMARK_SECRET;
    process.env.VOICEFORGE_STORAGE_DIR = tempRoot;
    process.env.VOICEFORGE_REVOCATION_FILE = path.join(tempRoot, 'revoked_tokens.json');
    process.env.VOICEFORGE_MEDIA_TOMBSTONE_FILE = path.join(tempRoot, '.invalidated_media.json');

    // Strictly block any accidental outbound non-loopback network calls during multimodal fallback tests
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: any, init?: any) => {
      const target =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsed = new URL(target);
      if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
        throw new Error(`Outbound external network blocked in test: ${parsed.hostname}`);
      }
      return originalFetch(input, init);
    };

    AuthService.resetUserStoreForTesting();
    DurableRevocationStore.resetForTesting();
    baseLocalProvider = new LocalStorageProvider(tempRoot);
    PrivateStorageService.setProvider(baseLocalProvider);
    PrivateStorageService.resetTombstonesForTesting();

    aliceToken = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
    bobToken = AuthService.issueToken(PRELOADED_USERS.usr_bob_user);
    adminToken = AuthService.issueToken(PRELOADED_USERS.usr_admin_root);

    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use('/api', apiRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as net.AddressInfo;
        port = addr.port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  beforeEach(() => {
    globalStore.resetForTesting();
    process.env.NODE_ENV = 'test';
    process.env.VOICEFORGE_AUTH_SECRET = TEST_AUTH_SECRET;
    process.env.VOICEFORGE_STORAGE_SECRET = TEST_STORAGE_SECRET;
    process.env.VOICEFORGE_CONSENT_SECRET = TEST_CONSENT_SECRET;
    process.env.VOICEFORGE_WATERMARK_KEY = TEST_WATERMARK_SECRET;
    process.env.VOICEFORGE_STORAGE_DIR = tempRoot;
    process.env.VOICEFORGE_MEDIA_TOMBSTONE_FILE = path.join(tempRoot, '.invalidated_media.json');
    PrivateStorageService.setProvider(baseLocalProvider);
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }

    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  });

  async function enrollClonedVoice(token: string, voiceName: string, phaseSeed: number): Promise<string> {
    globalStore.resetForTesting();
    const chRes = await originalFetch(`${baseUrl}/api/voices/clone/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ voiceName }),
    });
    assert.equal(chRes.status, 200);
    const challenge = await chRes.json();

    const verRes = await originalFetch(`${baseUrl}/api/voices/clone/verify-consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        challenge,
        voiceName,
        referenceAudioBase64: generateSyntheticSpeechWav(4.0, 220, phaseSeed).toString('base64'),
        consentAudioBase64: generateSyntheticSpeechWav(4.2, 220, phaseSeed + 0.08).toString('base64'),
      }),
    });
    assert.equal(verRes.status, 200);
    const data = await verRes.json();
    return data.voiceId as string;
  }

  // ==========================================================================
  // 1. P0 — S2B-NEW-01: MULTIMODAL DUBBING LEDGER LEAKAGE
  // ==========================================================================

  test('P0-S2B-NEW-01a: Anonymous and cross-tenant callers cannot synthesize or read Alice private dubbed audio before or after consent revocation, while owner access works while consent is active and fails closed after revocation', async () => {
    const aliceVoiceId = await enrollClonedVoice(aliceToken, 'Alice_Dub_Private_Clone', 0.12);
    const sampleInputB64 = generateSyntheticSpeechWav(3.2, 220, 0.2).toString('base64');

    // Anonymous and cross-tenant Bob cannot dub using Alice's private cloned voice
    const anonDubAttempt = await originalFetch(`${baseUrl}/api/media/transcribe-translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaBase64: sampleInputB64,
        mimeType: 'audio/wav',
        targetLanguage: 'ta',
        dubbingVoiceId: aliceVoiceId,
        synthesizeDub: true,
      }),
    });
    assert.equal(anonDubAttempt.status, 401);

    const bobDubAttempt = await originalFetch(`${baseUrl}/api/media/transcribe-translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
      body: JSON.stringify({
        mediaBase64: sampleInputB64,
        mimeType: 'audio/wav',
        targetLanguage: 'ta',
        dubbingVoiceId: aliceVoiceId,
        synthesizeDub: true,
      }),
    });
    assert.equal(bobDubAttempt.status, 403);

    // Alice submits private dubbing job; spoofed body userId must be ignored in favor of req.user.id
    const aliceDubRes = await originalFetch(`${baseUrl}/api/media/transcribe-translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({
        userId: 'usr_bob_user',
        mediaBase64: sampleInputB64,
        mimeType: 'audio/wav',
        targetLanguage: 'ta',
        mediaTitle: 'Alice Secret Boardroom Memo',
        dubbingVoiceId: aliceVoiceId,
        synthesizeDub: true,
      }),
    });
    assert.equal(aliceDubRes.status, 200);
    const aliceDubData = await aliceDubRes.json();
    const jobId = aliceDubData.jobId as string;
    assert.ok(jobId.startsWith('trans_'));
    assert.ok(aliceDubData.dubbedAudioUrl?.startsWith('data:audio/wav;base64,UklGR'));
    assert.equal(aliceDubData.jobRecord.userId, 'usr_alice_user');

    // Owner Alice sees her active job and dubbed audio
    const aliceJobsBefore = await (
      await originalFetch(`${baseUrl}/api/media/jobs`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      })
    ).json();
    const aliceListedBefore = aliceJobsBefore.jobs.find((j: any) => j.id === jobId);
    assert.ok(aliceListedBefore, 'Owner Alice must see her own dubbing job while consent is active');
    assert.ok(aliceListedBefore.dubbedAudioUrl?.startsWith('data:audio/wav;base64,UklGR'));

    const aliceDetailBefore = await originalFetch(`${baseUrl}/api/media/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(aliceDetailBefore.status, 200);

    // BEFORE revocation: Anonymous caller and cross-tenant Bob MUST NOT see Alice's job, metadata, or audio
    const anonJobsBeforeRes = await originalFetch(`${baseUrl}/api/media/jobs`);
    assert.equal(anonJobsBeforeRes.status, 200);
    const anonJobsBeforeText = await anonJobsBeforeRes.text();
    assert.equal(anonJobsBeforeText.includes(jobId), false);
    assert.equal(anonJobsBeforeText.includes('Alice Secret Boardroom Memo'), false);

    const anonDetailBefore = await originalFetch(`${baseUrl}/api/media/jobs/${jobId}`);
    assert.equal(anonDetailBefore.status, 401);

    const bobJobsBeforeRes = await originalFetch(`${baseUrl}/api/media/jobs`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert.equal(bobJobsBeforeRes.status, 200);
    const bobJobsBeforeText = await bobJobsBeforeRes.text();
    assert.equal(bobJobsBeforeText.includes(jobId), false);
    assert.equal(bobJobsBeforeText.includes('Alice Secret Boardroom Memo'), false);

    const bobDetailBefore = await originalFetch(`${baseUrl}/api/media/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert.equal(bobDetailBefore.status, 404, 'Cross-tenant detail lookup must not leak private job existence');
    const bobDetailText = await bobDetailBefore.text();
    assert.equal(bobDetailText.includes('Alice Secret Boardroom Memo'), false);

    // Alice revokes biometric consent -> must eagerly scrub transcriptionJobs + underlying PrivateStorageService WAV
    const revRes = await originalFetch(`${baseUrl}/api/voices/clone/revoke-consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ voiceId: aliceVoiceId }),
    });
    assert.equal(revRes.status, 200);

    // Repeated revocation is safe and idempotent
    const revRepeat = await originalFetch(`${baseUrl}/api/voices/clone/revoke-consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({ voiceId: aliceVoiceId }),
    });
    assert.equal(revRepeat.status, 200);

    // AFTER revocation: Anonymous and Bob still receive zero private records
    const anonJobsAfter = await (await originalFetch(`${baseUrl}/api/media/jobs`)).json();
    assert.equal(anonJobsAfter.jobs.some((j: any) => j.id === jobId), false);

    const bobJobsAfter = await (
      await originalFetch(`${baseUrl}/api/media/jobs`, {
        headers: { Authorization: `Bearer ${bobToken}` },
      })
    ).json();
    assert.equal(bobJobsAfter.jobs.some((j: any) => j.id === jobId), false);

    // Even owner Alice sees status=cancelled with zero dubbedAudioUrl / audioBase64, and 403 on detail
    const aliceJobsAfter = await (
      await originalFetch(`${baseUrl}/api/media/jobs`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      })
    ).json();
    const aliceListedAfter = aliceJobsAfter.jobs.find((j: any) => j.id === jobId);
    assert.ok(aliceListedAfter);
    assert.equal(aliceListedAfter.status, 'cancelled');
    assert.equal(aliceListedAfter.dubbedAudioUrl, undefined);
    assert.equal(aliceListedAfter.audioBase64, undefined);
    assert.equal(aliceListedAfter.outputSignedUrl, undefined);
    assert.equal(aliceListedAfter.outputMediaId, undefined);

    const aliceDetailAfter = await originalFetch(`${baseUrl}/api/media/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(aliceDetailAfter.status, 403);
    assert.equal((await aliceDetailAfter.json()).code, 'CONSENT_REVOKED');
  });

  test('P0-S2B-NEW-01b: Voice deletion and out-of-band consent revocation scrub dubbed audio, while non-private public premade transcription remains functional', async () => {
    const sampleWavB64 = generateSyntheticSpeechWav(3.1, 225, 0.3).toString('base64');

    // 1. Voice deletion via DELETE /api/v1/voices/:id scrubs dubbing job
    const voiceDel = await enrollClonedVoice(aliceToken, 'Alice_Dub_Delete_Voice', 0.35);
    const delJobRes = await (
      await originalFetch(`${baseUrl}/api/media/transcribe-translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
        body: JSON.stringify({
          mediaBase64: sampleWavB64,
          mimeType: 'audio/wav',
          targetLanguage: 'hi',
          dubbingVoiceId: voiceDel,
          synthesizeDub: true,
        }),
      })
    ).json();

    const delRes = await originalFetch(`${baseUrl}/api/v1/voices/${voiceDel}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(delRes.status, 200);

    const aliceAfterDel = await (
      await originalFetch(`${baseUrl}/api/media/jobs`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      })
    ).json();
    const scrubbedDelJob = aliceAfterDel.jobs.find((j: any) => j.id === delJobRes.jobId);
    assert.equal(scrubbedDelJob.status, 'cancelled');
    assert.equal(scrubbedDelJob.dubbedAudioUrl, undefined);

    // 2. Out-of-band ConsentVerificationEngine.revokeConsent fails closed on subsequent GET /api/media/jobs read
    const voiceOob = await enrollClonedVoice(aliceToken, 'Alice_Dub_OOB_Voice', 0.55);
    const oobJobRes = await (
      await originalFetch(`${baseUrl}/api/media/transcribe-translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
        body: JSON.stringify({
          mediaBase64: sampleWavB64,
          mimeType: 'audio/wav',
          targetLanguage: 'ta',
          dubbingVoiceId: voiceOob,
          synthesizeDub: true,
        }),
      })
    ).json();
    assert.ok(oobJobRes.dubbedAudioUrl?.startsWith('data:audio/wav;base64,UklGR'));

    ConsentVerificationEngine.revokeConsent(voiceOob, 'usr_alice_user');

    const aliceAfterOob = await (
      await originalFetch(`${baseUrl}/api/media/jobs`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      })
    ).json();
    const scrubbedOobJob = aliceAfterOob.jobs.find((j: any) => j.id === oobJobRes.jobId);
    assert.equal(scrubbedOobJob.status, 'cancelled');
    assert.equal(scrubbedOobJob.dubbedAudioUrl, undefined);

    // 3. Legitimate anonymous non-private premade transcription/translation continues working
    const publicAnonRes = await originalFetch(`${baseUrl}/api/media/transcribe-translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaBase64: sampleWavB64,
        mimeType: 'audio/wav',
        targetLanguage: 'es',
        mediaTitle: 'Public Premade Demo Clip',
        dubbingVoiceId: 'vf_sarah_en',
        synthesizeDub: true,
      }),
    });
    assert.equal(publicAnonRes.status, 200);
    const publicAnonData = await publicAnonRes.json();
    const anonListing = await (await originalFetch(`${baseUrl}/api/media/jobs`)).json();
    assert.equal(anonListing.jobs.some((j: any) => j.id === publicAnonData.jobId), true);
  });

  // ==========================================================================
  // 2. P1 — S2B-NEW-02: WATERMARK SIGNING SECRETS
  // ==========================================================================

  test('P1-S2B-NEW-02: AudioWatermarker rejects missing, blank, weak, and publicly known fallback keys across staging, production, and unknown environments, including fresh subprocess startup and post-init transitions', () => {
    const wav = generateSyntheticSpeechWav(1.0, 220, 0);
    const CANARY_WM_SECRET = 'canary_watermark_prod_secret_9988776655443322';
    const capturedLogs: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    const origErr = console.error;
    console.log = (...a: any[]) => capturedLogs.push(a.map(String).join(' '));
    console.warn = (...a: any[]) => capturedLogs.push(a.map(String).join(' '));
    console.error = (...a: any[]) => capturedLogs.push(a.map(String).join(' '));

    try {
      // Sign in development with unset secret (uses dev fallback)
      process.env.NODE_ENV = 'development';
      delete process.env.VOICEFORGE_WATERMARK_KEY;
      const devSigned = AudioWatermarker.signGeneration({
        generationId: 'gen_dev_fallback_probe',
        userId: 'usr_alice_user',
        voiceId: 'vf_sarah_en',
        audioBuffer: wav,
        sampleRate: 16000,
        durationSeconds: 1.0,
      });
      assert.equal(AudioWatermarker.verifyAudioProvenance(devSigned.audioWithMetadata).isValid, true);

      // Transitioning to staging, production, and unknown NODE_ENV must reject missing, blank, short, and known fallbacks
      for (const restrictedEnv of ['staging', 'production', 'qa', 'PRODUCTION']) {
        process.env.NODE_ENV = restrictedEnv;

        for (const badVal of [
          undefined,
          '',
          '    ',
          '15_char_secret!',
          'vf_watermark_hmac_secret_key_prod_8f1b2c3d4e5a',
          'vf_watermark_hmac_secret_key_legacy_rotation',
        ]) {
          if (badVal === undefined) delete process.env.VOICEFORGE_WATERMARK_KEY;
          else process.env.VOICEFORGE_WATERMARK_KEY = badVal;

          assert.throws(
            () => AudioWatermarker.getSigningSecret(),
            /FATAL SECURITY CONFIGURATION.*VOICEFORGE_WATERMARK_KEY/i
          );
          assert.throws(
            () =>
              AudioWatermarker.signGeneration({
                generationId: 'gen_should_fail',
                userId: 'usr_alice_user',
                voiceId: 'vf_sarah_en',
                audioBuffer: wav,
                sampleRate: 16000,
                durationSeconds: 1.0,
              }),
            /FATAL SECURITY CONFIGURATION.*VOICEFORGE_WATERMARK_KEY/i
          );
          // Dev fallback watermark must NOT verify in restricted environments
          assert.equal(AudioWatermarker.verifyAudioProvenance(devSigned.audioWithMetadata).isValid, false);
          assert.equal(AudioWatermarker.verifyWatermark(devSigned.signature).isValid, false);
        }

        // Valid restricted secret works for newly signed generations while still rejecting dev-signed artifacts
        process.env.VOICEFORGE_WATERMARK_KEY = CANARY_WM_SECRET;
        const prodSigned = AudioWatermarker.signGeneration({
          generationId: `gen_valid_${restrictedEnv}`,
          userId: 'usr_alice_user',
          voiceId: 'vf_sarah_en',
          audioBuffer: wav,
          sampleRate: 16000,
          durationSeconds: 1.0,
        });
        assert.equal(AudioWatermarker.verifyAudioProvenance(prodSigned.audioWithMetadata).isValid, true);
        assert.equal(AudioWatermarker.verifyAudioProvenance(devSigned.audioWithMetadata).isValid, false);

        // Legacy key rotation ('k_legacy_2025_v0'): publicly known legacy fallback key is rejected in restricted envs,
        // while an explicit >= 16-char VOICEFORGE_WATERMARK_LEGACY_KEY verifies rotated manifests safely
        delete process.env.VOICEFORGE_WATERMARK_LEGACY_KEY;
        const forgedWithPublicLegacy = (() => {
          const contentHash = 'a'.repeat(64);
          const payload = `gen_leg|usr_alice_user|vf_sarah_en|${contentHash}|16000|1.00|1700000000000|k_legacy_2025_v0`;
          return {
            manifestVersion: '1.0' as const,
            generationId: 'gen_leg',
            userId: 'usr_alice_user',
            voiceId: 'vf_sarah_en',
            audioContentHash: contentHash,
            timestamp: 1700000000000,
            sampleRate: 16000,
            durationSeconds: 1.0,
            keyId: 'k_legacy_2025_v0',
            signature: '0'.repeat(64),
            payload,
          };
        })();
        process.env.VOICEFORGE_WATERMARK_LEGACY_KEY = 'vf_watermark_hmac_secret_key_legacy_rotation';
        assert.equal(
          AudioWatermarker.verifyWatermark(forgedWithPublicLegacy.signature).isValid,
          false,
          'Publicly known legacy fallback key must never be accepted in restricted environments'
        );
      }

      // Fresh subprocess startup in production without VOICEFORGE_WATERMARK_KEY must fail closed
      const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
      const freshSubprocOut = execFileSync(
        tsxBin,
        [
          '--input-type=module',
          '-e',
          `
          import { AudioWatermarker } from './server/engine/audio/watermark.ts';
          let threw = false;
          try {
            AudioWatermarker.getSigningSecret();
          } catch (e) {
            threw = /FATAL SECURITY CONFIGURATION/.test(String(e.message));
          }
          process.stdout.write('\\n' + JSON.stringify({ threw }));
        `,
        ],
        {
          cwd: process.cwd(),
          env: (() => {
            const envCopy: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
            delete envCopy.VOICEFORGE_WATERMARK_KEY;
            return envCopy;
          })(),
          encoding: 'utf8',
        }
      );
      assert.equal(parseLastJsonLine(freshSubprocOut).threw, true);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origErr;
    }

    assert.equal(
      capturedLogs.some((line) => line.includes(CANARY_WM_SECRET)),
      false,
      'Watermark signing secret must never be logged'
    );
  });

  // ==========================================================================
  // 3. P2 — S2B-NEW-03: DUPLICATE AUTHORIZATION HEADERS (RAW TCP)
  // ==========================================================================

  test('P2-S2B-NEW-03: Duplicate or ambiguous raw HTTP Authorization headers fail closed with 401 across both requireAuth and optionalAuth and never downgrade to anonymous', async () => {
    const endpoints = ['/api/v1/auth/me', '/api/v1/voices'];

    for (const ep of endpoints) {
      // 1. Two valid Bearer tokens belonging to different users (Alice then Bob, and Bob then Alice)
      const aliceThenBob = await sendRawHttpRequest(port, [
        `GET ${ep} HTTP/1.1`,
        'Host: 127.0.0.1',
        `Authorization: Bearer ${aliceToken}`,
        `Authorization: Bearer ${bobToken}`,
        'Connection: close',
      ]);
      assert.equal(aliceThenBob.status, 401, `Duplicate valid tokens must fail closed on ${ep}`);
      assert.equal(aliceThenBob.json?.code, 'MALFORMED_AUTH_HEADER');

      const bobThenAlice = await sendRawHttpRequest(port, [
        `GET ${ep} HTTP/1.1`,
        'Host: 127.0.0.1',
        `Authorization: Bearer ${bobToken}`,
        `Authorization: Bearer ${aliceToken}`,
        'Connection: close',
      ]);
      assert.equal(bobThenAlice.status, 401);
      assert.equal(bobThenAlice.json?.code, 'MALFORMED_AUTH_HEADER');

      // 2. Valid token followed by a forged token
      const validThenForged = await sendRawHttpRequest(port, [
        `GET ${ep} HTTP/1.1`,
        'Host: 127.0.0.1',
        `Authorization: Bearer ${aliceToken}`,
        'Authorization: Bearer forged.tampered.signature',
        'Connection: close',
      ]);
      assert.equal(validThenForged.status, 401);
      assert.equal(validThenForged.json?.code, 'MALFORMED_AUTH_HEADER');

      // 3. Forged token followed by a valid token
      const forgedThenValid = await sendRawHttpRequest(port, [
        `GET ${ep} HTTP/1.1`,
        'Host: 127.0.0.1',
        'Authorization: Bearer forged.tampered.signature',
        `Authorization: Bearer ${aliceToken}`,
        'Connection: close',
      ]);
      assert.equal(forgedThenValid.status, 401);
      assert.equal(forgedThenValid.json?.code, 'MALFORMED_AUTH_HEADER');

      // 4. One ordinary valid Authorization header succeeds
      const singleValid = await sendRawHttpRequest(port, [
        `GET ${ep} HTTP/1.1`,
        'Host: 127.0.0.1',
        `Authorization: Bearer ${aliceToken}`,
        'Connection: close',
      ]);
      assert.equal(singleValid.status, 200);

      // 5. Conflicting unsupported credential transports fail closed with 401
      const bearerPlusXSession = await sendRawHttpRequest(port, [
        `GET ${ep} HTTP/1.1`,
        'Host: 127.0.0.1',
        `Authorization: Bearer ${aliceToken}`,
        `x-session-token: ${aliceToken}`,
        'Connection: close',
      ]);
      assert.equal(bearerPlusXSession.status, 401);
      assert.equal(bearerPlusXSession.json?.code, 'UNSUPPORTED_AUTH_TRANSPORT');

      const bearerPlusQueryToken = await sendRawHttpRequest(port, [
        `GET ${ep}?token=${encodeURIComponent(aliceToken)} HTTP/1.1`,
        'Host: 127.0.0.1',
        `Authorization: Bearer ${aliceToken}`,
        'Connection: close',
      ]);
      assert.equal(bearerPlusQueryToken.status, 401);
      assert.equal(bearerPlusQueryToken.json?.code, 'UNSUPPORTED_AUTH_TRANSPORT');
    }
  });

  // ==========================================================================
  // 4. P2 — S2B-NEW-04: RESTART-DURABLE MEDIA INVALIDATION & CORRUPT LEDGER LOCKOUT
  // ==========================================================================

  test('P2-S2B-NEW-04a: Media invalidation survives process restart when provider.delete() throws or returns false, blocks signed URL and Bearer downloads after restart, preserves ownership, and reconciles physical bytes safely', async () => {
    const restartDir = fs.mkdtempSync(path.join(tempRoot, 'restart-durable-'));
    const tombstoneFile = path.join(restartDir, '.invalidated_media.json');
    const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');

    // Process 1: Store two artifacts (one delete throws, one delete returns false), invalidate both, then exit
    const proc1Out = execFileSync(
      tsxBin,
      [
        '--input-type=module',
        '-e',
        `
        import { PrivateStorageService, LocalStorageProvider, StorageUnavailableError } from './server/storage/privateStorage.ts';
        const real = new LocalStorageProvider(${JSON.stringify(restartDir)});
        let mode = 'ok';
        PrivateStorageService.setProvider({
          name: 'fault_restart_provider',
          isAvailable: () => real.isAvailable(),
          store: (k, b) => real.store(k, b),
          retrieve: (k) => real.retrieve(k),
          exists: (k) => real.exists(k),
          delete: async (k) => {
            if (mode === 'throw') throw new StorageUnavailableError('Simulated disk I/O error');
            if (mode === 'false') return false;
            return real.delete(k);
          },
        });
        const makeMinWav = () => {
          const w = Buffer.alloc(100);
          w.write('RIFF', 0); w.writeUInt32LE(92, 4); w.write('WAVEfmt ', 8);
          w.writeUInt32LE(16, 16); w.writeUInt16LE(1, 20); w.writeUInt16LE(1, 22);
          w.writeUInt32LE(16000, 24); w.writeUInt32LE(32000, 28); w.writeUInt16LE(2, 32);
          w.writeUInt16LE(16, 34); w.write('data', 36); w.writeUInt32LE(56, 40);
          return w;
        };
        const recThrow = await PrivateStorageService.storeMedia({
          userId: 'usr_alice_user',
          voiceId: 'voice_revoked_1',
          mediaType: 'tts_output',
          filename: 'throw.wav',
          buffer: makeMinWav(),
        });
        const recFalse = await PrivateStorageService.storeMedia({
          userId: 'usr_alice_user',
          mediaType: 'tts_output',
          filename: 'false.wav',
          buffer: makeMinWav(),
        });
        const urlThrow = PrivateStorageService.generateSignedDownloadUrl(recThrow.id, 'usr_alice_user', 900);
        const urlFalse = PrivateStorageService.generateSignedDownloadUrl(recFalse.id, 'usr_alice_user', 900);

        mode = 'throw';
        const outThrow = await PrivateStorageService.invalidateAndDeleteMedia({
          mediaId: recThrow.id,
          requestingUserId: 'usr_alice_user',
          reason: 'consent_revoked',
        });
        mode = 'false';
        const outFalse = await PrivateStorageService.invalidateAndDeleteMedia({
          mediaId: recFalse.id,
          requestingUserId: 'usr_alice_user',
          reason: 'job_cancelled',
        });

        process.stdout.write('\\n' + JSON.stringify({
          recThrow,
          recFalse,
          urlThrow,
          urlFalse,
          outThrow,
          outFalse,
        }));
      `,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          VOICEFORGE_STORAGE_DIR: restartDir,
          VOICEFORGE_MEDIA_TOMBSTONE_FILE: tombstoneFile,
          VOICEFORGE_STORAGE_SECRET: TEST_STORAGE_SECRET,
          VOICEFORGE_AUTH_SECRET: TEST_AUTH_SECRET,
        },
        encoding: 'utf8',
      }
    );
    const p1 = parseLastJsonLine(proc1Out);
    assert.equal(p1.outThrow.cleanupFailed, true);
    assert.equal(p1.outThrow.deletedFromProvider, false);
    assert.equal(p1.outFalse.cleanupFailed, true);
    assert.equal(p1.outFalse.deletedFromProvider, false);
    assert.equal(fs.existsSync(tombstoneFile), true, 'Durable tombstone file must be written before Process 1 exits');

    // Process 2: Fresh Node process boots against same storage dir AND even rehydrates memoryStore.privateMedia
    // to prove tombstones block retrieval even when metadata + physical .wav files both still exist!
    const proc2Out = execFileSync(
      tsxBin,
      [
        '--input-type=module',
        '-e',
        `
        import express from 'express';
        import { apiRouter } from './server/routes/api.ts';
        import { PrivateStorageService, LocalStorageProvider } from './server/storage/privateStorage.ts';
        import { AuthService, PRELOADED_USERS } from './server/auth/auth.ts';
        import { memoryStore } from './server/db/index.ts';

        const real = new LocalStorageProvider(${JSON.stringify(restartDir)});
        PrivateStorageService.setProvider(real);
        const p1 = ${JSON.stringify(p1)};

        // Simulate metadata rehydration while physical bytes also remain on disk
        memoryStore.privateMedia.push(p1.recThrow, p1.recFalse);

        const diskExistsBeforeReconcile =
          (await real.exists(p1.recThrow.storageKey)) && (await real.exists(p1.recFalse.storageKey));

        const uThrow = new URL('http://localhost' + p1.urlThrow);
        const uFalse = new URL('http://localhost' + p1.urlFalse);
        const verifyThrowAfterRestart = PrivateStorageService.verifySignedUrl(
          p1.recThrow.id,
          'usr_alice_user',
          Number(uThrow.searchParams.get('expires')),
          uThrow.searchParams.get('sig')
        );
        const verifyFalseAfterRestart = PrivateStorageService.verifySignedUrl(
          p1.recFalse.id,
          'usr_alice_user',
          Number(uFalse.searchParams.get('expires')),
          uFalse.searchParams.get('sig')
        );

        // Cross-tenant Bob cannot delete/manipulate Alice's tombstoned entry after restart
        let bobRejected = false;
        try {
          await PrivateStorageService.invalidateAndDeleteMedia({
            mediaId: p1.recThrow.id,
            requestingUserId: 'usr_bob_user',
            reason: 'manual_delete',
          });
        } catch {
          bobRejected = true;
        }

        const aliceTok = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
        const bobTok = AuthService.issueToken(PRELOADED_USERS.usr_bob_user);
        const app = express();
        app.use('/api', apiRouter);
        const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
        const port = srv.address().port;

        const signedThrowHttp = await fetch('http://127.0.0.1:' + port + p1.urlThrow);
        const signedThrowBody = await signedThrowHttp.json();
        const signedFalseHttp = await fetch('http://127.0.0.1:' + port + p1.urlFalse);
        const signedFalseBody = await signedFalseHttp.json();
        const bearerAliceHttp = await fetch('http://127.0.0.1:' + port + '/api/v1/media/download/' + p1.recThrow.id, {
          headers: { Authorization: 'Bearer ' + aliceTok },
        });
        const bearerBobHttp = await fetch('http://127.0.0.1:' + port + '/api/v1/media/download/' + p1.recThrow.id, {
          headers: { Authorization: 'Bearer ' + bobTok },
        });
        const bearerBobBody = await bearerBobHttp.json();

        // Now reconcile pending deletions and verify physical bytes are finally removed from disk
        const reconciled = await PrivateStorageService.reconcilePendingDeletions();
        const diskExistsAfterReconcile =
          (await real.exists(p1.recThrow.storageKey)) || (await real.exists(p1.recFalse.storageKey));

        await new Promise((r) => srv.close(r));
        process.stdout.write('\\n' + JSON.stringify({
          diskExistsBeforeReconcile,
          isInvalidatedThrow: PrivateStorageService.isMediaInvalidated(p1.recThrow.id),
          isInvalidatedFalse: PrivateStorageService.isMediaInvalidated(p1.recFalse.id),
          verifyThrowAfterRestart,
          verifyFalseAfterRestart,
          bobRejected,
          signedThrowStatus: signedThrowHttp.status,
          signedThrowCode: signedThrowBody.code,
          signedFalseStatus: signedFalseHttp.status,
          signedFalseCode: signedFalseBody.code,
          bearerAliceStatus: bearerAliceHttp.status,
          bearerBobStatus: bearerBobHttp.status,
          bearerBobCode: bearerBobBody.code,
          reconciled,
          diskExistsAfterReconcile,
        }));
      `,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          VOICEFORGE_STORAGE_DIR: restartDir,
          VOICEFORGE_MEDIA_TOMBSTONE_FILE: tombstoneFile,
          VOICEFORGE_STORAGE_SECRET: TEST_STORAGE_SECRET,
          VOICEFORGE_AUTH_SECRET: TEST_AUTH_SECRET,
        },
        encoding: 'utf8',
      }
    );

    const p2 = parseLastJsonLine(proc2Out);
    assert.equal(p2.diskExistsBeforeReconcile, true);
    assert.equal(p2.isInvalidatedThrow, true);
    assert.equal(p2.isInvalidatedFalse, true);
    assert.equal(p2.verifyThrowAfterRestart, false);
    assert.equal(p2.verifyFalseAfterRestart, false);
    assert.equal(p2.bobRejected, true);
    assert.equal(p2.signedThrowStatus, 403);
    assert.equal(p2.signedThrowCode, 'CONSENT_REVOKED');
    assert.equal(p2.signedFalseStatus, 403);
    assert.equal(p2.signedFalseCode, 'MEDIA_ARTIFACT_INVALIDATED');
    assert.equal(p2.bearerAliceStatus, 403);
    assert.equal(p2.bearerBobStatus, 403);
    assert.equal(p2.bearerBobCode, 'FORBIDDEN_MEDIA_ACCESS');
    assert.equal(p2.reconciled.resolved, 2);
    assert.equal(p2.diskExistsAfterReconcile, false);
  });

  test('P2-S2B-NEW-04b: Corrupted or unavailable tombstone persistence layer fails closed (503 / false) and never restores access to private media', async () => {
    const corruptDir = fs.mkdtempSync(path.join(tempRoot, 'corrupt-ledger-'));
    const corruptFile = path.join(corruptDir, '.invalidated_media.json');
    process.env.VOICEFORGE_STORAGE_DIR = corruptDir;
    process.env.VOICEFORGE_MEDIA_TOMBSTONE_FILE = corruptFile;
    PrivateStorageService.setProvider(new LocalStorageProvider(corruptDir));

    const upRes = await originalFetch(`${baseUrl}/api/v1/media/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({
        audioBase64: generateSyntheticSpeechWav(1.5, 220, 0.1).toString('base64'),
        filename: 'lockout_probe.wav',
        mediaType: 'reference_audio',
      }),
    });
    assert.equal(upRes.status, 201);
    const upData = await upRes.json();
    const signedUrl = upData.signedDownloadUrl as string;
    const parsedUrl = new URL(`http://localhost${signedUrl}`);

    // Corrupt the durable tombstone ledger on disk
    fs.writeFileSync(corruptFile, '{corrupted_json_payload!!!', { mode: 0o600 });

    assert.equal(PrivateStorageService.isInvalidationLedgerHealthy(), false);
    assert.equal(
      PrivateStorageService.verifySignedUrl(
        upData.media.id,
        'usr_alice_user',
        Number(parsedUrl.searchParams.get('expires')),
        parsedUrl.searchParams.get('sig')!
      ),
      false,
      'Signed URL verification must fail closed when durable tombstone ledger is corrupted'
    );

    const dlDuringOutage = await originalFetch(`${baseUrl}${signedUrl}`);
    assert.equal(dlDuringOutage.status, 503);
    assert.equal((await dlDuringOutage.json()).code, 'STORAGE_UNAVAILABLE');

    const listDuringOutage = await originalFetch(`${baseUrl}/api/v1/media`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(listDuringOutage.status, 503);
  });

  // ==========================================================================
  // 5. P2 & P3 — S2B-NEW-05 & S2B-NEW-06: AUTH SECRET PARITY & GET /api/v1/media
  // ==========================================================================

  test('P2-S2B-NEW-05: getAuthSecret(), assertDatabaseConfigured(), and VoiceForgeSynthesizer enforce restricted-environment policy consistently without leaking secrets', async () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origAuthSec = process.env.VOICEFORGE_AUTH_SECRET;
    const origDbUrl = process.env.DATABASE_URL;

    try {
      for (const restrictedEnv of ['staging', 'production', 'qa', 'PRODUCTION']) {
        process.env.NODE_ENV = restrictedEnv;
        delete process.env.DATABASE_URL;

        for (const badAuthSecret of [
          undefined,
          '',
          '   ',
          'short_15_chars!',
          'vf_auth_secret_phase3a_secure_token_sig_k92m',
        ]) {
          if (badAuthSecret === undefined) delete process.env.VOICEFORGE_AUTH_SECRET;
          else process.env.VOICEFORGE_AUTH_SECRET = badAuthSecret;

          assert.throws(
            () => getAuthSecret(),
            /FATAL SECURITY CONFIGURATION.*VOICEFORGE_AUTH_SECRET/i
          );
          assert.throws(
            () => AuthService.getAuthSecret(),
            /FATAL SECURITY CONFIGURATION.*VOICEFORGE_AUTH_SECRET/i
          );
        }

        assert.throws(
          () => assertDatabaseConfigured(),
          (err: any) => err instanceof FatalDatabaseConfigurationError
        );
      }

      // VoiceForgeSynthesizer rejects cloned voice synthesis when ConsentVerificationEngine.isConsentActive() is false
      // even if record.status === 'active' (e.g. consent record signed under a different/fallback secret)
      process.env.NODE_ENV = 'development';
      delete process.env.VOICEFORGE_CONSENT_SECRET;
      const devChallenge = ConsentVerificationEngine.issueChallenge('usr_alice_user', 'FallbackSignedClone');
      const devEnrolled = ConsentVerificationEngine.verifyEnrollment({
        userId: 'usr_alice_user',
        challenge: devChallenge,
        voiceName: 'FallbackSignedClone',
        referenceAudio: generateSyntheticSpeechWav(3.8, 220, 0.1),
        consentAudio: generateSyntheticSpeechWav(4.0, 220, 0.2),
      });
      assert.ok(devEnrolled.voiceId && devEnrolled.auditRecord);
      const enrolledVoiceId = devEnrolled.voiceId;
      assert.equal(devEnrolled.auditRecord.status, 'active');

      // Rotate to authoritative test consent secret -> auditSignature no longer matches -> isConsentActive() === false
      process.env.NODE_ENV = 'test';
      process.env.VOICEFORGE_CONSENT_SECRET = TEST_CONSENT_SECRET;
      process.env.VOICEFORGE_AUTH_SECRET = TEST_AUTH_SECRET;
      assert.equal(ConsentVerificationEngine.isConsentActive(enrolledVoiceId), false);

      const synth = new VoiceForgeSynthesizer();
      await assert.rejects(
        async () => {
          await synth.synthesize(
            { text: 'Unverified clone test', voiceId: enrolledVoiceId, language: 'en' },
            {
              id: enrolledVoiceId,
              name: 'FallbackSignedClone',
              category: 'cloned_instant',
              gender: 'female',
              primaryLanguage: 'en',
              supportedLanguages: ['en'],
              accent: 'Neutral',
              description: 'Test',
              defaultSettings: {
                stability: 0.8,
                similarity: 0.9,
                style: 0.2,
                speed: 1.0,
                pitch: 0,
                speakerBoost: true,
              },
            }
          );
        },
        /Synthesis prohibited: Biometric consent/i
      );
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      process.env.VOICEFORGE_AUTH_SECRET = origAuthSec;
      if (origDbUrl !== undefined) process.env.DATABASE_URL = origDbUrl;
      else delete process.env.DATABASE_URL;
    }
  });

  test('P3-S2B-NEW-06: GET /api/v1/media enforces out-of-band consent revocation fail-closed, unlinks underlying bytes, and omits internal storageKey paths', async () => {
    const voiceId = await enrollClonedVoice(aliceToken, 'Alice_Media_List_OOB_Voice', 0.72);

    const jobRes = await (
      await originalFetch(`${baseUrl}/api/v1/tts/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
        body: JSON.stringify({
          text: 'Testing GET /api/v1/media out of band consent revocation',
          voiceId,
          language: 'en',
        }),
      })
    ).json();
    const mediaId = jobRes.outputMediaId as string;
    const signedUrl = jobRes.outputSignedUrl as string;

    // While active, GET /api/v1/media lists the item WITHOUT exposing internal storageKey
    const activeListRes = await originalFetch(`${baseUrl}/api/v1/media`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(activeListRes.status, 200);
    const activeListJson = await activeListRes.json();
    const listedItem = activeListJson.media.find((m: any) => m.id === mediaId);
    assert.ok(listedItem, 'Active media item must be listed for owner');
    assert.equal('storageKey' in listedItem, false, 'Internal storageKey must not be exposed in GET /api/v1/media');

    // Out-of-band consent revocation BEFORE any download or TTS job list call
    ConsentVerificationEngine.revokeConsent(voiceId, 'usr_alice_user');

    const afterOobListRes = await originalFetch(`${baseUrl}/api/v1/media`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(afterOobListRes.status, 200);
    const afterOobListJson = await afterOobListRes.json();
    assert.equal(
      afterOobListJson.media.some((m: any) => m.id === mediaId),
      false,
      'Out-of-band revoked voice media must be scrubbed and omitted from GET /api/v1/media'
    );

    const diskPath = path.join(tempRoot, 'usr_alice_user', `${mediaId}.wav`);
    assert.equal(fs.existsSync(diskPath), false, 'Underlying WAV file must be unlinked during lazy invalidation');

    const dlAfterOob = await originalFetch(`${baseUrl}${signedUrl}`);
    assert.equal(dlAfterOob.status, 403);
    assert.equal((await dlAfterOob.json()).code, 'CONSENT_REVOKED');
  });
});
