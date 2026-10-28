/**
 * Phase 3C-S2E: Restart-Related Private Media Reauthorization Remediation Suite (`S2D-NEW-01`)
 *
 * Verifies all 9 security invariants across genuinely separate OS processes (`execFileSync`):
 * 1. No reauthorization after invalidation (cancel, consent revoke, voice delete) across restarts.
 * 2. Fail closed on uncertain state (missing-with-artifacts, corrupted, unreadable, unwritable, non-regular ledger/WAL).
 * 3. No false success when security-critical invalidation state cannot be durably established (`503`, `success: false`).
 * 4. Storage deletion failure (`throw` / `false`) never restores access via prior signed URLs.
 * 5. Startup safety in fresh OS processes before serving private media (`server.ts` `/readyz` & `apiRouter`).
 * 6. Concurrency safety under simultaneous invalidations and downloads without lost tombstones or auth windows.
 * 7. Recovery safety (repeated cancel/revoke/delete under fault stay `503`, recover cleanly after permission repair,
 *    while unrecoverable corrupted/missing-with-artifacts ledgers never silently self-heal into authorization).
 * 8. Scope isolation (tenant ownership, consent enforcement, signed URL expiry/HMAC, authorized valid media `200`).
 * 9. Safe failure responses (zero WAV bytes, filesystem paths, or signing secrets leaked in error bodies).
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import express from 'express';

import {
  LocalStorageProvider,
  PrivateStorageService,
  StorageUnavailableError,
  type StorageProvider,
} from '../../server/storage/privateStorage.ts';
import { AuthService, DurableRevocationStore, PRELOADED_USERS } from '../../server/auth/auth.ts';
import { ConsentVerificationEngine } from '../../server/engine/audio/consent.ts';
import { memoryStore } from '../../server/db/index.ts';
import { apiRouter } from '../../server/routes/api.ts';

const TEST_AUTH_SECRET = 'phase3c_s2e_auth_secret_key_0123456789abcdef';
const TEST_STORAGE_SECRET = 'phase3c_s2e_storage_secret_key_0123456789abcd';
const TEST_CONSENT_SECRET = 'phase3c_s2e_consent_secret_key_0123456789abcd';
const TEST_WATERMARK_KEY = 'phase3c_s2e_watermark_secret_key_0123456789ab';

const tsxBin = path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');

function createSyntheticSpeechLikeWav(
  durationSeconds: number = 3.8,
  baseFreqHz: number = 220,
  phaseOffset: number = 0
): Buffer {
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * durationSeconds);
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
    const envelope = Math.sin(2 * Math.PI * 3.2 * t + phaseOffset) > -0.25 ? 1.0 : 0.04;
    const wave =
      (Math.sin(2 * Math.PI * baseFreqHz * t + phaseOffset) +
        0.5 * Math.sin(4 * Math.PI * baseFreqHz * t) +
        0.25 * Math.sin(6 * Math.PI * baseFreqHz * t)) *
      0.38 *
      envelope;
    const sample = Math.max(-0.95, Math.min(0.95, wave));
    buf.writeInt16LE(Math.floor(sample * 32767), 44 + i * 2);
  }
  return buf;
}

const SUBPROCESS_WAV_HELPER = `
function makeWav(sec = 3.8, freq = 220, phase = 0.1) {
  const sr = 16000;
  const n = Math.floor(sr * sec);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.sin(2 * Math.PI * 3.2 * t + phase) > -0.25 ? 1.0 : 0.04;
    const w = (Math.sin(2 * Math.PI * freq * t + phase) + 0.5 * Math.sin(4 * Math.PI * freq * t) + 0.25 * Math.sin(6 * Math.PI * freq * t)) * 0.38 * env;
    b.writeInt16LE(Math.floor(Math.max(-0.95, Math.min(0.95, w)) * 32767), 44 + i * 2);
  }
  return b;
}
`;

function runIsolatedServerProcess<T = any>(
  esmScript: string,
  extraEnv: Record<string, string | undefined> = {}
): T {
  const mergedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    VOICEFORGE_AUTH_SECRET: TEST_AUTH_SECRET,
    VOICEFORGE_STORAGE_SECRET: TEST_STORAGE_SECRET,
    VOICEFORGE_CONSENT_SECRET: TEST_CONSENT_SECRET,
    VOICEFORGE_WATERMARK_KEY: TEST_WATERMARK_KEY,
  };
  delete mergedEnv.VOICEFORGE_MEDIA_TOMBSTONE_FILE;
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) {
      delete mergedEnv[k];
    } else {
      mergedEnv[k] = v;
    }
  }

  const out = execFileSync(tsxBin, ['--input-type=module', '-e', esmScript], {
    cwd: process.cwd(),
    env: mergedEnv,
    encoding: 'utf8',
    timeout: 30000,
  });

  const markerIdx = out.lastIndexOf('__S2E_JSON__');
  assert.notEqual(markerIdx, -1, `Subprocess did not emit __S2E_JSON__ marker. Output: ${out}`);
  return JSON.parse(out.slice(markerIdx + '__S2E_JSON__'.length).trim()) as T;
}

function assertNoSensitiveLeakage(bodyText: string, forbiddenPaths: string[] = []): void {
  assert.equal(bodyText.startsWith('RIFF'), false, 'Error response must never start with WAV RIFF header');
  assert.equal(bodyText.includes(TEST_STORAGE_SECRET), false, 'Signing secret must never leak');
  assert.equal(bodyText.includes(TEST_AUTH_SECRET), false, 'Auth secret must never leak');
  assert.equal(bodyText.includes(TEST_CONSENT_SECRET), false, 'Consent secret must never leak');
  for (const p of forbiddenPaths) {
    if (p) {
      assert.equal(bodyText.includes(p), false, `Filesystem path must never leak in error body: ${p}`);
    }
  }
}

function restorePermissionsRecursively(targetDir: string): void {
  if (!fs.existsSync(targetDir)) return;
  try {
    const st = fs.lstatSync(targetDir);
    if (st.isDirectory()) {
      fs.chmodSync(targetDir, 0o700);
      for (const child of fs.readdirSync(targetDir)) {
        restorePermissionsRecursively(path.join(targetDir, child));
      }
    } else if (st.isFile()) {
      fs.chmodSync(targetDir, 0o600);
    }
  } catch {}
}

test.describe('Phase 3C-S2E: Restart Durability & Fail-Closed Private Media Remediation Suite', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let rootSuiteTmp: string;
  let origProvider: StorageProvider;
  let origFetch: typeof globalThis.fetch;

  before(() => {
    for (const k of [
      'NODE_ENV',
      'VOICEFORGE_STORAGE_DIR',
      'VOICEFORGE_MEDIA_TOMBSTONE_FILE',
      'VOICEFORGE_REVOCATION_FILE',
      'VOICEFORGE_AUTH_SECRET',
      'VOICEFORGE_STORAGE_SECRET',
      'VOICEFORGE_CONSENT_SECRET',
      'VOICEFORGE_WATERMARK_KEY',
    ]) {
      savedEnv[k] = process.env[k];
    }

    rootSuiteTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-s2e-suite-'));
    origProvider = PrivateStorageService.getProvider();

    process.env.NODE_ENV = 'test';
    process.env.VOICEFORGE_AUTH_SECRET = TEST_AUTH_SECRET;
    process.env.VOICEFORGE_STORAGE_SECRET = TEST_STORAGE_SECRET;
    process.env.VOICEFORGE_CONSENT_SECRET = TEST_CONSENT_SECRET;
    process.env.VOICEFORGE_WATERMARK_KEY = TEST_WATERMARK_KEY;
    process.env.VOICEFORGE_REVOCATION_FILE = path.join(rootSuiteTmp, 'revoked_tokens.json');
    delete process.env.VOICEFORGE_MEDIA_TOMBSTONE_FILE;

    // Block accidental non-loopback network traffic during tests
    origFetch = globalThis.fetch;
    globalThis.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(urlStr);
      if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
        throw new Error(`External network blocked in S2E test: ${parsed.hostname}`);
      }
      return origFetch(input, init);
    };
  });

  after(() => {
    globalThis.fetch = origFetch;
    PrivateStorageService.setProvider(origProvider);
    DurableRevocationStore.resetForTesting();
    AuthService.resetUserStoreForTesting();

    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }

    restorePermissionsRecursively(rootSuiteTmp);
    fs.rmSync(rootSuiteTmp, { recursive: true, force: true });
  });

  test('S2E-01 (Case A — Job Cancellation & Pre-Fix Contrast): Unwritable shared storage root refuses false 200 success (503), records emergency WAL, and denies signed URL across fresh OS restarts (both while 0o500 and after chmod 0o700)', () => {
    const caseADir = fs.mkdtempSync(path.join(rootSuiteTmp, 'caseA-cancel-'));

    try {
      // Process 1: Create pre-existing ledger, synthesize private WAV + signed URL, lock storageDir 0o500, cancel job
      const p1 = runIsolatedServerProcess(
        `
        import fs from 'node:fs';
        import path from 'node:path';
        import http from 'node:http';
        import express from 'express';
        import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
        import { AuthService, PRELOADED_USERS } from './server/auth/auth.ts';
        import { memoryStore } from './server/db/index.ts';
        import { apiRouter } from './server/routes/api.ts';

        const dir = ${JSON.stringify(caseADir)};
        PrivateStorageService.setProvider(new LocalStorageProvider(dir));

        const app = express();
        app.use(express.json({ limit: '25mb' }));
        app.use('/api', apiRouter);
        const srv = http.createServer(app);
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        const base = 'http://127.0.0.1:' + srv.address().port;
        const aliceTok = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
        const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + aliceTok };

        // Seed 1 cancelled job so .invalidated_media.json exists with valid JSON prior to permission fault
        const seedJob = await (await fetch(base + '/api/v1/tts/jobs', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: 'Seed job before directory lock.', voiceId: 'vf_sarah_en', language: 'en' }),
        })).json();
        const seedCancel = await fetch(base + '/api/v1/jobs/' + seedJob.jobId + '/cancel', {
          method: 'POST',
          headers,
        });
        if (seedCancel.status !== 200) throw new Error('Expected seed cancel 200');

        // Create target confidential WAV job
        const targetRes = await fetch(base + '/api/v1/tts/jobs', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: 'Case A confidential private WAV payload.', voiceId: 'vf_sarah_en', language: 'en' }),
        });
        const targetJob = await targetRes.json();
        const targetMeta = memoryStore.privateMedia.find((m) => m.id === targetJob.outputMediaId);

        // Verify authorized retrieval works BEFORE cancellation
        const preDl = await fetch(base + targetJob.outputSignedUrl);
        const preBuf = Buffer.from(await preDl.arrayBuffer());

        // Force exact S2D Case A filesystem condition: shared storage root & tenant dir become unwritable (0o500)
        fs.chmodSync(path.join(dir, 'usr_alice_user'), 0o500);
        fs.chmodSync(dir, 0o500);

        // Trigger job cancellation under unwritable shared storage root
        const cancelRes = await fetch(base + '/api/v1/jobs/' + targetJob.jobId + '/cancel', {
          method: 'POST',
          headers,
        });
        const cancelText = await cancelRes.text();

        // Attempt in-process download in Process 1 right after failed durable persist
        const p1PostDl = await fetch(base + targetJob.outputSignedUrl);
        const p1PostText = await p1PostDl.text();

        const primaryJson = JSON.parse(fs.readFileSync(path.join(dir, '.invalidated_media.json'), 'utf8'));
        const walRaw = fs.readFileSync(path.join(dir, '.invalidated_media.json.wal'), 'utf8');
        const wavStillOnDisk = fs.existsSync(path.join(dir, targetMeta.storageKey));
        const ledgerHealthyAfterFault = PrivateStorageService.isInvalidationLedgerHealthy();

        await new Promise((r) => srv.close(() => r()));
        process.stdout.write('__S2E_JSON__' + JSON.stringify({
          pid: process.pid,
          preStatus: preDl.status,
          preIsWav: preBuf.subarray(0, 4).toString('ascii') === 'RIFF',
          preBytes: preBuf.length,
          targetMeta,
          signedUrl: targetJob.outputSignedUrl,
          cancelStatus: cancelRes.status,
          cancelText,
          p1PostStatus: p1PostDl.status,
          p1PostText,
          targetInPrimarySnapshot: primaryJson.entries.some((e) => e.id === targetMeta.id),
          targetInEmergencyWal: walRaw.includes(targetMeta.id),
          wavStillOnDisk,
          ledgerHealthyAfterFault,
        }));
        `,
        { VOICEFORGE_STORAGE_DIR: caseADir }
      );

      // Contrast proof: before S2E, primary snapshot lacked targetMeta.id while wavStillOnDisk === true,
      // which caused pre-S2E Process 2 to return 200 OK with p1.preBytes of WAV audio.
      assert.equal(p1.preStatus, 200);
      assert.equal(p1.preIsWav, true);
      assert.ok(p1.preBytes > 1000);
      assert.equal(p1.targetInPrimarySnapshot, false, 'Atomic temp+rename cannot update snapshot while dir is 0o500');
      assert.equal(p1.wavStillOnDisk, true, 'Physical WAV file remains on disk while tenant dir is 0o500');

      // Post-S2E invariants in Process 1: NO false success (503), sticky unhealthy state, emergency WAL recorded
      assert.equal(p1.cancelStatus, 503);
      assertNoSensitiveLeakage(p1.cancelText, [caseADir]);
      const cancelJson = JSON.parse(p1.cancelText);
      assert.equal(cancelJson.success, false);
      assert.equal(cancelJson.code, 'STORAGE_UNAVAILABLE');
      assert.equal(cancelJson.cleanupFailed, true);
      assert.equal(p1.ledgerHealthyAfterFault, false);
      assert.equal(p1.targetInEmergencyWal, true);
      assert.equal(p1.p1PostStatus, 503);
      assertNoSensitiveLeakage(p1.p1PostText, [caseADir]);

      // Process 2: Restart in genuinely separate OS process while storageDir is STILL 0o500
      const p2 = runIsolatedServerProcess(
        `
        import http from 'node:http';
        import express from 'express';
        import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
        import { AuthService, PRELOADED_USERS } from './server/auth/auth.ts';
        import { memoryStore } from './server/db/index.ts';
        import { apiRouter } from './server/routes/api.ts';

        const p1 = ${JSON.stringify(p1)};
        PrivateStorageService.setProvider(new LocalStorageProvider(${JSON.stringify(caseADir)}));
        memoryStore.privateMedia.push({ ...p1.targetMeta });

        const app = express();
        app.use('/api', apiRouter);
        const srv = http.createServer(app);
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        const base = 'http://127.0.0.1:' + srv.address().port;
        const aliceTok = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);

        const signedRes = await fetch(base + p1.signedUrl);
        const signedBuf = Buffer.from(await signedRes.arrayBuffer());
        const bearerRes = await fetch(base + '/api/v1/media/download/' + p1.targetMeta.id, {
          headers: { Authorization: 'Bearer ' + aliceTok },
        });
        const bearerBuf = Buffer.from(await bearerRes.arrayBuffer());

        const parsedUrl = new URL('http://localhost' + p1.signedUrl);
        const verifyDirect = PrivateStorageService.verifySignedUrl(
          p1.targetMeta.id,
          'usr_alice_user',
          Number(parsedUrl.searchParams.get('expires')),
          parsedUrl.searchParams.get('sig')
        );

        await new Promise((r) => srv.close(() => r()));
        process.stdout.write('__S2E_JSON__' + JSON.stringify({
          pid: process.pid,
          ledgerHealthy: PrivateStorageService.isInvalidationLedgerHealthy(),
          verifyDirect,
          signedStatus: signedRes.status,
          signedText: signedBuf.toString('utf8'),
          signedIsWav: signedBuf.subarray(0, 4).toString('ascii') === 'RIFF',
          bearerStatus: bearerRes.status,
          bearerText: bearerBuf.toString('utf8'),
          bearerIsWav: bearerBuf.subarray(0, 4).toString('ascii') === 'RIFF',
        }));
        `,
        { VOICEFORGE_STORAGE_DIR: caseADir }
      );

      assert.notEqual(p2.pid, p1.pid, 'Restart verification must execute in a separate OS process');
      assert.equal(p2.ledgerHealthy, false);
      assert.equal(p2.verifyDirect, false);
      assert.equal(p2.signedStatus, 503);
      assert.equal(p2.signedIsWav, false);
      assertNoSensitiveLeakage(p2.signedText, [caseADir]);
      assert.equal(p2.bearerStatus, 503);
      assert.equal(p2.bearerIsWav, false);
      assertNoSensitiveLeakage(p2.bearerText, [caseADir]);

      // Process 3: Repair directory permissions (chmod 0o700) and restart in a third separate OS process;
      // emergency WAL is replayed & compacted, signed URL returns 403 MEDIA_ARTIFACT_INVALIDATED, and WAV reconciles!
      restorePermissionsRecursively(caseADir);
      const p3 = runIsolatedServerProcess(
        `
        import fs from 'node:fs';
        import path from 'node:path';
        import http from 'node:http';
        import express from 'express';
        import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
        import { memoryStore } from './server/db/index.ts';
        import { apiRouter } from './server/routes/api.ts';

        const p1 = ${JSON.stringify(p1)};
        const dir = ${JSON.stringify(caseADir)};
        PrivateStorageService.setProvider(new LocalStorageProvider(dir));
        memoryStore.privateMedia.push({ ...p1.targetMeta });

        const app = express();
        app.use('/api', apiRouter);
        const srv = http.createServer(app);
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        const base = 'http://127.0.0.1:' + srv.address().port;

        const signedRes = await fetch(base + p1.signedUrl);
        const signedBuf = Buffer.from(await signedRes.arrayBuffer());
        const reconcileResult = await PrivateStorageService.reconcilePendingDeletions();
        const wavAfterReconcile = fs.existsSync(path.join(dir, p1.targetMeta.storageKey));

        await new Promise((r) => srv.close(() => r()));
        process.stdout.write('__S2E_JSON__' + JSON.stringify({
          pid: process.pid,
          ledgerHealthy: PrivateStorageService.isInvalidationLedgerHealthy(),
          signedStatus: signedRes.status,
          signedBody: JSON.parse(signedBuf.toString('utf8')),
          signedIsWav: signedBuf.subarray(0, 4).toString('ascii') === 'RIFF',
          reconcileResult,
          wavAfterReconcile,
        }));
        `,
        { VOICEFORGE_STORAGE_DIR: caseADir }
      );

      assert.notEqual(p3.pid, p1.pid);
      assert.notEqual(p3.pid, p2.pid);
      assert.equal(p3.ledgerHealthy, true);
      assert.equal(p3.signedStatus, 403);
      assert.equal(p3.signedBody.code, 'MEDIA_ARTIFACT_INVALIDATED');
      assert.equal(p3.signedIsWav, false);
      assert.equal(p3.reconcileResult.resolved, 1);
      assert.equal(p3.wavAfterReconcile, false);
    } finally {
      restorePermissionsRecursively(caseADir);
    }
  });

  test('S2E-02 (Case A — Consent Revocation & Voice Deletion + Total Read-Only 0o400 Fault): Revoke and voice-delete refuse false 200 success when neither snapshot nor WAL is writable, and restart fails closed', () => {
    const revokeDir = fs.mkdtempSync(path.join(rootSuiteTmp, 'caseA-revoke-'));
    const deleteDir = fs.mkdtempSync(path.join(rootSuiteTmp, 'caseA-vdel-'));

    try {
      // Part 1: Cloned voice consent revocation when dir is 0o500 AND ledger + WAL are 0o400 (total write block)
      const rP1 = runIsolatedServerProcess(
        `
        import fs from 'node:fs';
        import path from 'node:path';
        import http from 'node:http';
        import express from 'express';
        import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
        import { AuthService, PRELOADED_USERS } from './server/auth/auth.ts';
        import { memoryStore } from './server/db/index.ts';
        import { apiRouter } from './server/routes/api.ts';
        ${SUBPROCESS_WAV_HELPER}

        const dir = ${JSON.stringify(revokeDir)};
        PrivateStorageService.setProvider(new LocalStorageProvider(dir));
        const app = express();
        app.use(express.json({ limit: '25mb' }));
        app.use('/api', apiRouter);
        const srv = http.createServer(app);
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        const base = 'http://127.0.0.1:' + srv.address().port;
        const aliceTok = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
        const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + aliceTok };

        const chRes = await (await fetch(base + '/api/voices/clone/challenge', {
          method: 'POST', headers, body: JSON.stringify({ voiceName: 'Alice CaseA Revoke Voice' }),
        })).json();
        const refWav = makeWav(4.0, 210, 0).toString('base64');
        const conWav = makeWav(4.2, 210, 0.08).toString('base64');
        const enroll = await (await fetch(base + '/api/voices/clone/verify-consent', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            challenge: chRes,
            voiceName: 'Alice CaseA Revoke Voice',
            referenceAudioBase64: refWav,
            consentAudioBase64: conWav,
            gender: 'female',
            primaryLanguage: 'en',
          }),
        })).json();

        const job = await (await fetch(base + '/api/v1/tts/jobs', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: 'Cloned synthesis under total write fault.', voiceId: enroll.voiceId, language: 'en' }),
        })).json();
        const ttsMeta = memoryStore.privateMedia.find((m) => m.id === job.outputMediaId);

        // Lock EVERYTHING read-only (0o400 files + 0o500 directories)
        fs.chmodSync(path.join(dir, '.invalidated_media.json'), 0o400);
        fs.chmodSync(path.join(dir, '.invalidated_media.json.wal'), 0o400);
        fs.chmodSync(path.join(dir, 'usr_alice_user'), 0o500);
        fs.chmodSync(dir, 0o500);

        const revRes = await fetch(base + '/api/voices/clone/revoke-consent', {
          method: 'POST',
          headers,
          body: JSON.stringify({ voiceId: enroll.voiceId }),
        });
        const revText = await revRes.text();

        // Synthesis with revoked voice is immediately blocked in Process 1 even though durability failed
        const synthAfterRevoke = await fetch(base + '/api/v1/tts/jobs', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: 'Must fail.', voiceId: enroll.voiceId, language: 'en' }),
        });

        await new Promise((r) => srv.close(() => r()));
        process.stdout.write('__S2E_JSON__' + JSON.stringify({
          pid: process.pid,
          voiceId: enroll.voiceId,
          ttsMeta,
          signedUrl: job.outputSignedUrl,
          revStatus: revRes.status,
          revText,
          synthAfterStatus: synthAfterRevoke.status,
        }));
        `,
        { VOICEFORGE_STORAGE_DIR: revokeDir }
      );

      assert.equal(rP1.revStatus, 503);
      assertNoSensitiveLeakage(rP1.revText, [revokeDir]);
      assert.equal(JSON.parse(rP1.revText).success, false);
      assert.equal(rP1.synthAfterStatus, 403);

      // Fresh OS process restart while unwritable -> fails closed (503, 0 WAV bytes)
      const rP2 = runIsolatedServerProcess(
        `
        import http from 'node:http';
        import express from 'express';
        import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
        import { memoryStore } from './server/db/index.ts';
        import { apiRouter } from './server/routes/api.ts';

        const p1 = ${JSON.stringify(rP1)};
        PrivateStorageService.setProvider(new LocalStorageProvider(${JSON.stringify(revokeDir)}));
        memoryStore.privateMedia.push({ ...p1.ttsMeta });

        const app = express();
        app.use('/api', apiRouter);
        const srv = http.createServer(app);
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        const base = 'http://127.0.0.1:' + srv.address().port;

        const dl = await fetch(base + p1.signedUrl);
        const buf = Buffer.from(await dl.arrayBuffer());
        await new Promise((r) => srv.close(() => r()));

        process.stdout.write('__S2E_JSON__' + JSON.stringify({
          pid: process.pid,
          status: dl.status,
          isWav: buf.subarray(0, 4).toString('ascii') === 'RIFF',
          text: buf.toString('utf8'),
        }));
        `,
        { VOICEFORGE_STORAGE_DIR: revokeDir }
      );

      assert.notEqual(rP2.pid, rP1.pid);
      assert.equal(rP2.status, 503);
      assert.equal(rP2.isWav, false);
      assertNoSensitiveLeakage(rP2.text, [revokeDir]);

      // Part 2: Voice deletion (DELETE /api/v1/voices/:id) under unwritable shared storage root
      const dP1 = runIsolatedServerProcess(
        `
        import fs from 'node:fs';
        import path from 'node:path';
        import http from 'node:http';
        import express from 'express';
        import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
        import { AuthService, PRELOADED_USERS } from './server/auth/auth.ts';
        import { memoryStore } from './server/db/index.ts';
        import { apiRouter } from './server/routes/api.ts';

        const dir = ${JSON.stringify(deleteDir)};
        PrivateStorageService.setProvider(new LocalStorageProvider(dir));
        const app = express();
        app.use(express.json({ limit: '25mb' }));
        app.use('/api', apiRouter);
        const srv = http.createServer(app);
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        const base = 'http://127.0.0.1:' + srv.address().port;
        const aliceTok = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
        const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + aliceTok };

        const vRes = await (await fetch(base + '/api/v1/voices', {
          method: 'POST', headers, body: JSON.stringify({ name: 'Alice Designed Voice' }),
        })).json();
        const voiceId = vRes.voice.id;

        const job = await (await fetch(base + '/api/v1/tts/jobs', {
          method: 'POST', headers, body: JSON.stringify({ text: 'Voice delete durability test.', voiceId, language: 'en' }),
        })).json();
        const ttsMeta = memoryStore.privateMedia.find((m) => m.id === job.outputMediaId);

        fs.chmodSync(path.join(dir, 'usr_alice_user'), 0o500);
        fs.chmodSync(dir, 0o500);

        const delRes = await fetch(base + '/api/v1/voices/' + voiceId, { method: 'DELETE', headers });
        const delText = await delRes.text();

        await new Promise((r) => srv.close(() => r()));
        process.stdout.write('__S2E_JSON__' + JSON.stringify({
          pid: process.pid,
          voiceId,
          ttsMeta,
          signedUrl: job.outputSignedUrl,
          delStatus: delRes.status,
          delText,
        }));
        `,
        { VOICEFORGE_STORAGE_DIR: deleteDir }
      );

      assert.equal(dP1.delStatus, 503);
      assertNoSensitiveLeakage(dP1.delText, [deleteDir]);
      assert.equal(JSON.parse(dP1.delText).success, false);

      // Repair permissions and restart -> emergency WAL blocks signed URL with 403!
      restorePermissionsRecursively(deleteDir);
      const dP2 = runIsolatedServerProcess(
        `
        import http from 'node:http';
        import express from 'express';
        import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
        import { memoryStore } from './server/db/index.ts';
        import { apiRouter } from './server/routes/api.ts';

        const p1 = ${JSON.stringify(dP1)};
        PrivateStorageService.setProvider(new LocalStorageProvider(${JSON.stringify(deleteDir)}));
        memoryStore.privateMedia.push({ ...p1.ttsMeta });

        const app = express();
        app.use('/api', apiRouter);
        const srv = http.createServer(app);
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        const base = 'http://127.0.0.1:' + srv.address().port;

        const dl = await fetch(base + p1.signedUrl);
        const buf = Buffer.from(await dl.arrayBuffer());
        await new Promise((r) => srv.close(() => r()));

        process.stdout.write('__S2E_JSON__' + JSON.stringify({
          pid: process.pid,
          status: dl.status,
          body: JSON.parse(buf.toString('utf8')),
          isWav: buf.subarray(0, 4).toString('ascii') === 'RIFF',
        }));
        `,
        { VOICEFORGE_STORAGE_DIR: deleteDir }
      );

      assert.notEqual(dP2.pid, dP1.pid);
      assert.equal(dP2.status, 403);
      assert.equal(dP2.isWav, false);
    } finally {
      restorePermissionsRecursively(revokeDir);
      restorePermissionsRecursively(deleteDir);
    }
  });

  test('S2E-03 (Case B — Missing Invalidation Ledger After Failed Deletion): Removing or withholding .invalidated_media.json while private artifacts exist fails closed (503) across fresh OS process restarts', () => {
    const caseBDir = fs.mkdtempSync(path.join(rootSuiteTmp, 'caseB-missing-'));

    const p1 = runIsolatedServerProcess(
      `
      import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
      ${SUBPROCESS_WAV_HELPER}

      const real = new LocalStorageProvider(${JSON.stringify(caseBDir)});
      PrivateStorageService.setProvider(real);

      const rec = await PrivateStorageService.storeMedia({
        userId: 'usr_alice_user',
        voiceId: 'vf_sarah_en',
        mediaType: 'tts_output',
        filename: 'caseB_orphaned.wav',
        buffer: makeWav(1.2, 240, 0.3),
      });
      const signedUrl = PrivateStorageService.generateSignedDownloadUrl(rec.id, 'usr_alice_user', 900);

      // Force provider.delete() to fail so WAV bytes remain on disk
      PrivateStorageService.setProvider({
        name: 'faulty_delete_case_b',
        isAvailable: () => real.isAvailable(),
        store: (k, b) => real.store(k, b),
        retrieve: (k) => real.retrieve(k),
        delete: async () => false,
        exists: (k) => real.exists(k),
      });

      const inv = await PrivateStorageService.invalidateAndDeleteMedia({
        mediaId: rec.id,
        requestingUserId: 'usr_alice_user',
        reason: 'job_cancelled',
      });

      process.stdout.write('__S2E_JSON__' + JSON.stringify({ pid: process.pid, rec, signedUrl, inv }));
      `,
      { VOICEFORGE_STORAGE_DIR: caseBDir }
    );

    assert.equal(p1.inv.invalidated, true);
    assert.equal(p1.inv.durableInvalidationEstablished, true);
    assert.equal(p1.inv.cleanupFailed, true);

    // Sub-case B1: Remove ONLY .invalidated_media.json (.wal still present on disk)
    fs.unlinkSync(path.join(caseBDir, '.invalidated_media.json'));

    const p2WithWal = runIsolatedServerProcess(
      `
      import http from 'node:http';
      import express from 'express';
      import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
      import { memoryStore } from './server/db/index.ts';
      import { apiRouter } from './server/routes/api.ts';

      const p1 = ${JSON.stringify(p1)};
      PrivateStorageService.setProvider(new LocalStorageProvider(${JSON.stringify(caseBDir)}));
      memoryStore.privateMedia.push({ ...p1.rec });

      const app = express();
      app.use('/api', apiRouter);
      const srv = http.createServer(app);
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const base = 'http://127.0.0.1:' + srv.address().port;

      const dl = await fetch(base + p1.signedUrl);
      const buf = Buffer.from(await dl.arrayBuffer());
      await new Promise((r) => srv.close(() => r()));

      process.stdout.write('__S2E_JSON__' + JSON.stringify({
        pid: process.pid,
        healthy: PrivateStorageService.isInvalidationLedgerHealthy(),
        status: dl.status,
        text: buf.toString('utf8'),
        isWav: buf.subarray(0, 4).toString('ascii') === 'RIFF',
      }));
      `,
      { VOICEFORGE_STORAGE_DIR: caseBDir }
    );

    assert.notEqual(p2WithWal.pid, p1.pid);
    assert.equal(p2WithWal.healthy, false);
    assert.equal(p2WithWal.status, 503);
    assert.equal(p2WithWal.isWav, false);
    assertNoSensitiveLeakage(p2WithWal.text, [caseBDir]);

    // Sub-case B2: Remove .invalidated_media.json.wal TOO so ONLY usr_alice_user/*.wav exists in storage root
    if (fs.existsSync(path.join(caseBDir, '.invalidated_media.json.wal'))) {
      fs.unlinkSync(path.join(caseBDir, '.invalidated_media.json.wal'));
    }

    const p3NoWalEither = runIsolatedServerProcess(
      `
      import http from 'node:http';
      import express from 'express';
      import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
      import { AuthService, PRELOADED_USERS } from './server/auth/auth.ts';
      import { memoryStore } from './server/db/index.ts';
      import { apiRouter } from './server/routes/api.ts';

      const p1 = ${JSON.stringify(p1)};
      PrivateStorageService.setProvider(new LocalStorageProvider(${JSON.stringify(caseBDir)}));
      memoryStore.privateMedia.push({ ...p1.rec });

      const app = express();
      app.use('/api', apiRouter);
      const srv = http.createServer(app);
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const base = 'http://127.0.0.1:' + srv.address().port;
      const aliceTok = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);

      const signedRes = await fetch(base + p1.signedUrl);
      const signedBuf = Buffer.from(await signedRes.arrayBuffer());
      const bearerRes = await fetch(base + '/api/v1/media/download/' + p1.rec.id, {
        headers: { Authorization: 'Bearer ' + aliceTok },
      });
      const listRes = await fetch(base + '/api/v1/media', {
        headers: { Authorization: 'Bearer ' + aliceTok },
      });
      await new Promise((r) => srv.close(() => r()));

      process.stdout.write('__S2E_JSON__' + JSON.stringify({
        pid: process.pid,
        healthy: PrivateStorageService.isInvalidationLedgerHealthy(),
        signedStatus: signedRes.status,
        signedIsWav: signedBuf.subarray(0, 4).toString('ascii') === 'RIFF',
        signedText: signedBuf.toString('utf8'),
        bearerStatus: bearerRes.status,
        listStatus: listRes.status,
      }));
      `,
      { VOICEFORGE_STORAGE_DIR: caseBDir }
    );

    assert.notEqual(p3NoWalEither.pid, p1.pid);
    assert.notEqual(p3NoWalEither.pid, p2WithWal.pid);
    assert.equal(p3NoWalEither.healthy, false);
    assert.equal(p3NoWalEither.signedStatus, 503);
    assert.equal(p3NoWalEither.signedIsWav, false);
    assertNoSensitiveLeakage(p3NoWalEither.signedText, [caseBDir]);
    assert.equal(p3NoWalEither.bearerStatus, 503);
    assert.equal(p3NoWalEither.listStatus, 503);

    // Sub-case B3: Withheld custom VOICEFORGE_MEDIA_TOMBSTONE_FILE pointing to non-existent file while storageDir has artifacts
    const withheldPath = path.join(rootSuiteTmp, 'withheld-dir', 'missing_ledger.json');
    const p4Withheld = runIsolatedServerProcess(
      `
      import http from 'node:http';
      import express from 'express';
      import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
      import { memoryStore } from './server/db/index.ts';
      import { apiRouter } from './server/routes/api.ts';

      const p1 = ${JSON.stringify(p1)};
      PrivateStorageService.setProvider(new LocalStorageProvider(${JSON.stringify(caseBDir)}));
      memoryStore.privateMedia.push({ ...p1.rec });

      const app = express();
      app.use('/api', apiRouter);
      const srv = http.createServer(app);
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const base = 'http://127.0.0.1:' + srv.address().port;

      const dl = await fetch(base + p1.signedUrl);
      const buf = Buffer.from(await dl.arrayBuffer());
      await new Promise((r) => srv.close(() => r()));

      process.stdout.write('__S2E_JSON__' + JSON.stringify({
        pid: process.pid,
        healthy: PrivateStorageService.isInvalidationLedgerHealthy(),
        status: dl.status,
        isWav: buf.subarray(0, 4).toString('ascii') === 'RIFF',
      }));
      `,
      {
        VOICEFORGE_STORAGE_DIR: caseBDir,
        VOICEFORGE_MEDIA_TOMBSTONE_FILE: withheldPath,
      }
    );

    assert.equal(p4Withheld.healthy, false);
    assert.equal(p4Withheld.status, 503);
    assert.equal(p4Withheld.isWav, false);
  });

  test('S2E-04 (All Lifecycle Invalidations Across Fresh OS Restart): Previously valid signed URLs for cancelled job, revoked cloned voice, and deleted voices (/voices/:id & /v1/voices/:id) remain 403 across restarts while valid sibling media continues serving 200', () => {
    const lifecycleDir = fs.mkdtempSync(path.join(rootSuiteTmp, 'lifecycle-restart-'));

    const p1 = runIsolatedServerProcess(
      `
      import http from 'node:http';
      import express from 'express';
      import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
      import { AuthService, PRELOADED_USERS } from './server/auth/auth.ts';
      import { memoryStore } from './server/db/index.ts';
      import { apiRouter } from './server/routes/api.ts';
      ${SUBPROCESS_WAV_HELPER}

      const real = new LocalStorageProvider(${JSON.stringify(lifecycleDir)});
      // Wrap provider so delete() fails on disk to prove restart denial does not rely on physical unlink!
      let blockDelete = false;
      PrivateStorageService.setProvider({
        name: 'keep_bytes_provider',
        isAvailable: () => real.isAvailable(),
        store: (k, b) => real.store(k, b),
        retrieve: (k) => real.retrieve(k),
        delete: async (k) => (blockDelete ? false : real.delete(k)),
        exists: (k) => real.exists(k),
      });

      const app = express();
      app.use(express.json({ limit: '25mb' }));
      app.use('/api', apiRouter);
      const srv = http.createServer(app);
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const base = 'http://127.0.0.1:' + srv.address().port;
      const aliceTok = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
      const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + aliceTok };

      // 1. Valid active job (must remain accessible!)
      const validJob = await (await fetch(base + '/api/v1/tts/jobs', {
        method: 'POST', headers: h, body: JSON.stringify({ text: 'Valid active audio.', voiceId: 'vf_sarah_en', language: 'en' }),
      })).json();
      const validMeta = memoryStore.privateMedia.find((m) => m.id === validJob.outputMediaId);

      // 2. Job to cancel
      const cancelJob = await (await fetch(base + '/api/v1/tts/jobs', {
        method: 'POST', headers: h, body: JSON.stringify({ text: 'Job to cancel.', voiceId: 'vf_sarah_en', language: 'en' }),
      })).json();
      const cancelMeta = memoryStore.privateMedia.find((m) => m.id === cancelJob.outputMediaId);

      // 3. Cloned voice to revoke consent
      const ch = await (await fetch(base + '/api/voices/clone/challenge', {
        method: 'POST', headers: h, body: JSON.stringify({ voiceName: 'Revoke Target Cloned Voice' }),
      })).json();
      const refWavB64 = makeWav(4.0, 205, 0).toString('base64');
      const conWavB64 = makeWav(4.2, 205, 0.08).toString('base64');
      const cloned = await (await fetch(base + '/api/voices/clone/verify-consent', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({
          challenge: ch,
          voiceName: 'Revoke Target Cloned Voice',
          referenceAudioBase64: refWavB64,
          consentAudioBase64: conWavB64,
          gender: 'female',
          primaryLanguage: 'en',
        }),
      })).json();
      const revokeJob = await (await fetch(base + '/api/v1/tts/jobs', {
        method: 'POST', headers: h, body: JSON.stringify({ text: 'Revoke voice output.', voiceId: cloned.voiceId, language: 'en' }),
      })).json();
      const revokeMeta = memoryStore.privateMedia.find((m) => m.id === revokeJob.outputMediaId);

      // 4. Custom voices to delete via /api/voices/:id and /api/v1/voices/:id
      const vLegacy = (await (await fetch(base + '/api/v1/voices', {
        method: 'POST', headers: h, body: JSON.stringify({ name: 'Delete Legacy Voice' }),
      })).json()).voice;
      const vLegacyJob = await (await fetch(base + '/api/v1/tts/jobs', {
        method: 'POST', headers: h, body: JSON.stringify({ text: 'Legacy voice output.', voiceId: vLegacy.id, language: 'en' }),
      })).json();
      const vLegacyMeta = memoryStore.privateMedia.find((m) => m.id === vLegacyJob.outputMediaId);

      const vV1 = (await (await fetch(base + '/api/v1/voices', {
        method: 'POST', headers: h, body: JSON.stringify({ name: 'Delete V1 Voice' }),
      })).json()).voice;
      const vV1Job = await (await fetch(base + '/api/v1/tts/jobs', {
        method: 'POST', headers: h, body: JSON.stringify({ text: 'V1 voice output.', voiceId: vV1.id, language: 'en' }),
      })).json();
      const vV1Meta = memoryStore.privateMedia.find((m) => m.id === vV1Job.outputMediaId);

      // Force physical deletes to return false while tombstones ARE durably written
      blockDelete = true;

      const rCancel = await fetch(base + '/api/v1/jobs/' + cancelJob.jobId + '/cancel', { method: 'POST', headers: h });
      const rRevoke = await fetch(base + '/api/voices/clone/revoke-consent', {
        method: 'POST', headers: h, body: JSON.stringify({ voiceId: cloned.voiceId }),
      });
      const rDelLegacy = await fetch(base + '/api/voices/' + vLegacy.id, { method: 'DELETE', headers: h });
      const rDelV1 = await fetch(base + '/api/v1/voices/' + vV1.id, { method: 'DELETE', headers: h });

      await new Promise((r) => srv.close(() => r()));
      process.stdout.write('__S2E_JSON__' + JSON.stringify({
        pid: process.pid,
        statuses: [rCancel.status, rRevoke.status, rDelLegacy.status, rDelV1.status],
        valid: { meta: validMeta, url: validJob.outputSignedUrl },
        cancelled: { meta: cancelMeta, url: cancelJob.outputSignedUrl },
        revoked: { meta: revokeMeta, url: revokeJob.outputSignedUrl },
        deletedLegacy: { meta: vLegacyMeta, url: vLegacyJob.outputSignedUrl },
        deletedV1: { meta: vV1Meta, url: vV1Job.outputSignedUrl },
      }));
      `,
      { VOICEFORGE_STORAGE_DIR: lifecycleDir }
    );

    assert.deepEqual(p1.statuses, [200, 200, 200, 200]);

    // Restart in separate OS process and verify every invalidated signed URL is 403 while valid media is 200 WAV
    const p2 = runIsolatedServerProcess(
      `
      import http from 'node:http';
      import express from 'express';
      import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
      import { AuthService, PRELOADED_USERS } from './server/auth/auth.ts';
      import { memoryStore } from './server/db/index.ts';
      import { apiRouter } from './server/routes/api.ts';

      const p1 = ${JSON.stringify(p1)};
      PrivateStorageService.setProvider(new LocalStorageProvider(${JSON.stringify(lifecycleDir)}));
      memoryStore.privateMedia.push(
        { ...p1.valid.meta },
        { ...p1.cancelled.meta },
        { ...p1.revoked.meta },
        { ...p1.deletedLegacy.meta },
        { ...p1.deletedV1.meta }
      );

      const app = express();
      app.use('/api', apiRouter);
      const srv = http.createServer(app);
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const base = 'http://127.0.0.1:' + srv.address().port;
      const bobTok = AuthService.issueToken(PRELOADED_USERS.usr_bob_user);
      const aliceTok = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);

      async function checkUrl(u) {
        const res = await fetch(base + u);
        const buf = Buffer.from(await res.arrayBuffer());
        return {
          status: res.status,
          isWav: buf.subarray(0, 4).toString('ascii') === 'RIFF',
          len: buf.length,
          code: res.status !== 200 ? JSON.parse(buf.toString('utf8')).code : null,
        };
      }

      const validCheck = await checkUrl(p1.valid.url);
      const cancelCheck = await checkUrl(p1.cancelled.url);
      const revokeCheck = await checkUrl(p1.revoked.url);
      const delLegacyCheck = await checkUrl(p1.deletedLegacy.url);
      const delV1Check = await checkUrl(p1.deletedV1.url);

      // Cross-tenant Bob must still be denied Alice's valid media (403)
      const bobStealValid = await fetch(base + '/api/v1/media/download/' + p1.valid.meta.id, {
        headers: { Authorization: 'Bearer ' + bobTok },
      });
      // Anonymous without signed params must still get 401
      const anonNoSig = await fetch(base + '/api/v1/media/download/' + p1.valid.meta.id);
      // Alice media listing returns ONLY p1.valid.meta.id
      const aliceList = await (await fetch(base + '/api/v1/media', {
        headers: { Authorization: 'Bearer ' + aliceTok },
      })).json();

      await new Promise((r) => srv.close(() => r()));
      process.stdout.write('__S2E_JSON__' + JSON.stringify({
        pid: process.pid,
        validCheck,
        cancelCheck,
        revokeCheck,
        delLegacyCheck,
        delV1Check,
        bobStatus: bobStealValid.status,
        anonStatus: anonNoSig.status,
        listedIds: aliceList.media.map((m) => m.id),
      }));
      `,
      { VOICEFORGE_STORAGE_DIR: lifecycleDir }
    );

    assert.notEqual(p2.pid, p1.pid);
    assert.equal(p2.validCheck.status, 200);
    assert.equal(p2.validCheck.isWav, true);
    assert.ok(p2.validCheck.len > 1000);

    assert.equal(p2.cancelCheck.status, 403);
    assert.equal(p2.cancelCheck.code, 'MEDIA_ARTIFACT_INVALIDATED');
    assert.equal(p2.cancelCheck.isWav, false);

    assert.equal(p2.revokeCheck.status, 403);
    assert.equal(p2.revokeCheck.code, 'CONSENT_REVOKED');
    assert.equal(p2.revokeCheck.isWav, false);

    assert.equal(p2.delLegacyCheck.status, 403);
    assert.equal(p2.delLegacyCheck.isWav, false);

    assert.equal(p2.delV1Check.status, 403);
    assert.equal(p2.delV1Check.isWav, false);

    assert.equal(p2.bobStatus, 403);
    assert.equal(p2.anonStatus, 401);
    assert.deepEqual(p2.listedIds, [p1.valid.meta.id]);
  });

  test('S2E-05 (Corrupted, Unreadable, Unwritable, WAL-Corrupted, and Non-Regular Ledger States + Unrecoverable Fail-Closed Permanence): Uncertain ledger states never self-heal via subsequent invalidations', async () => {
    const stateDir = fs.mkdtempSync(path.join(rootSuiteTmp, 'ledger-states-'));
    process.env.VOICEFORGE_STORAGE_DIR = stateDir;
    PrivateStorageService.setProvider(new LocalStorageProvider(stateDir));

    const app = express();
    app.use(express.json({ limit: '25mb' }));
    app.use('/api', apiRouter);
    const srv = http.createServer(app);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as any).port;
    const base = `http://127.0.0.1:${port}`;
    const aliceTok = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceTok}` };

    try {
      const jobA = await (
        await origFetch(`${base}/api/v1/tts/jobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: 'Artifact A.', voiceId: 'vf_sarah_en', language: 'en' }),
        })
      ).json();
      const jobB = await (
        await origFetch(`${base}/api/v1/tts/jobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: 'Artifact B.', voiceId: 'vf_sarah_en', language: 'en' }),
        })
      ).json();

      const ledgerPath = path.join(stateDir, '.invalidated_media.json');
      const walPath = path.join(stateDir, '.invalidated_media.json.wal');
      const goodLedgerContent = fs.readFileSync(ledgerPath, 'utf8');

      // 1. Corrupted primary JSON -> 503, AND cancelling jobB must NOT overwrite corrupted ledger into healthy state!
      fs.writeFileSync(ledgerPath, '{corrupted_ledger_payload', { mode: 0o600 });
      assert.equal(PrivateStorageService.isInvalidationLedgerHealthy(), false);

      const cancelWhileCorrupt = await origFetch(`${base}/api/v1/jobs/${jobB.jobId}/cancel`, {
        method: 'POST',
        headers,
      });
      assert.equal(cancelWhileCorrupt.status, 503);
      assert.equal((await cancelWhileCorrupt.json()).success, false);
      assert.equal(
        PrivateStorageService.isInvalidationLedgerHealthy(),
        false,
        'Unrecoverable corrupted ledger must remain fail-closed and never self-heal on subsequent cancel'
      );

      const dlWhileCorrupt = await origFetch(`${base}${jobA.outputSignedUrl}`);
      assert.equal(dlWhileCorrupt.status, 503);
      assert.equal(Buffer.from(await dlWhileCorrupt.arrayBuffer()).subarray(0, 4).toString('ascii') === 'RIFF', false);

      // 2. Restore primary JSON, corrupt companion WAL -> 503 fail-closed
      fs.writeFileSync(ledgerPath, goodLedgerContent, { mode: 0o600 });
      fs.writeFileSync(walPath, '{truncated_wal_line\n', { mode: 0o600 });
      assert.equal(PrivateStorageService.isInvalidationLedgerHealthy(), false);
      const dlWhileWalCorrupt = await origFetch(`${base}${jobA.outputSignedUrl}`);
      assert.equal(dlWhileWalCorrupt.status, 503);

      // 3. Unreadable primary JSON (0o000) -> 503 fail-closed
      fs.writeFileSync(walPath, '', { mode: 0o600 });
      fs.chmodSync(ledgerPath, 0o000);
      assert.equal(PrivateStorageService.isInvalidationLedgerHealthy(), false);
      const dlWhileUnreadable = await origFetch(`${base}${jobA.outputSignedUrl}`);
      assert.equal(dlWhileUnreadable.status, 503);

      // 4. Read-only / unwritable primary JSON (0o400) -> 503 fail-closed
      fs.chmodSync(ledgerPath, 0o400);
      assert.equal(PrivateStorageService.isInvalidationLedgerHealthy(), false);
      const dlWhileReadOnlyFile = await origFetch(`${base}${jobA.outputSignedUrl}`);
      assert.equal(dlWhileReadOnlyFile.status, 503);

      // 5. Symlink swap on ledger path -> 503 fail-closed
      fs.chmodSync(ledgerPath, 0o600);
      fs.unlinkSync(ledgerPath);
      const decoy = path.join(stateDir, 'decoy.json');
      fs.writeFileSync(decoy, goodLedgerContent, { mode: 0o600 });
      fs.symlinkSync(decoy, ledgerPath);
      assert.equal(PrivateStorageService.isInvalidationLedgerHealthy(), false);
      const dlWhileSymlink = await origFetch(`${base}${jobA.outputSignedUrl}`);
      assert.equal(dlWhileSymlink.status, 503);
      fs.unlinkSync(ledgerPath);
      fs.unlinkSync(decoy);

      // 6. Missing ledger while artifacts exist -> cancelling another job must NOT recreate a blank healthy ledger!
      assert.equal(PrivateStorageService.isInvalidationLedgerHealthy(), false);
      const cancelWhileMissing = await origFetch(`${base}/api/v1/jobs/${jobA.jobId}/cancel`, {
        method: 'POST',
        headers,
      });
      assert.equal(cancelWhileMissing.status, 503);
      assert.equal(fs.existsSync(ledgerPath), false);
      assert.equal(PrivateStorageService.isInvalidationLedgerHealthy(), false);

      // New uploads/stores are also refused while ledger is unhealthy
      await assert.rejects(
        () =>
          PrivateStorageService.storeMedia({
            userId: 'usr_alice_user',
            mediaType: 'tts_output',
            filename: 'blocked.wav',
            buffer: createSyntheticSpeechLikeWav(0.5),
          }),
        (err: any) => err instanceof StorageUnavailableError
      );
    } finally {
      restorePermissionsRecursively(stateDir);
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  test('S2E-06 (Repeated Cancel / Revoke / Delete & Safe Recovery): Repeated mutations keep returning 503 while unwritable, then complete cleanly (200) once permissions are repaired without losing invalidations', async () => {
    const retryDir = fs.mkdtempSync(path.join(rootSuiteTmp, 'retry-recovery-'));
    process.env.VOICEFORGE_STORAGE_DIR = retryDir;
    PrivateStorageService.setProvider(new LocalStorageProvider(retryDir));

    const app = express();
    app.use(express.json({ limit: '25mb' }));
    app.use('/api', apiRouter);
    const srv = http.createServer(app);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as any).port;
    const base = `http://127.0.0.1:${port}`;
    const aliceTok = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceTok}` };

    try {
      // Valid untouched media + target job to cancel + cloned voice to revoke + custom voice to delete
      const validJob = await (
        await origFetch(`${base}/api/v1/tts/jobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: 'Untouched valid job.', voiceId: 'vf_sarah_en', language: 'en' }),
        })
      ).json();

      const cancelJob = await (
        await origFetch(`${base}/api/v1/tts/jobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: 'Retry cancel job.', voiceId: 'vf_sarah_en', language: 'en' }),
        })
      ).json();
      const cancelMeta = (memoryStore.privateMedia as any[]).find((m) => m.id === cancelJob.outputMediaId);

      const ch = await (
        await origFetch(`${base}/api/voices/clone/challenge`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ voiceName: 'Retry Revoke Voice' }),
        })
      ).json();
      const refWavB64 = createSyntheticSpeechLikeWav(4.0, 215, 0).toString('base64');
      const conWavB64 = createSyntheticSpeechLikeWav(4.2, 215, 0.08).toString('base64');
      const cloned = await (
        await origFetch(`${base}/api/voices/clone/verify-consent`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            challenge: ch,
            voiceName: 'Retry Revoke Voice',
            referenceAudioBase64: refWavB64,
            consentAudioBase64: conWavB64,
            gender: 'female',
            primaryLanguage: 'en',
          }),
        })
      ).json();
      const revokeJob = await (
        await origFetch(`${base}/api/v1/tts/jobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: 'Retry revoke audio.', voiceId: cloned.voiceId, language: 'en' }),
        })
      ).json();
      const revokeMeta = (memoryStore.privateMedia as any[]).find((m) => m.id === revokeJob.outputMediaId);

      const customVoice = (
        await (
          await origFetch(`${base}/api/v1/voices`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ name: 'Retry Delete Voice' }),
          })
        ).json()
      ).voice;
      const delVoiceJob = await (
        await origFetch(`${base}/api/v1/tts/jobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: 'Retry delete voice audio.', voiceId: customVoice.id, language: 'en' }),
        })
      ).json();
      const delVoiceMeta = (memoryStore.privateMedia as any[]).find((m) => m.id === delVoiceJob.outputMediaId);

      // Inject permission fault (0o500)
      fs.chmodSync(path.join(retryDir, 'usr_alice_user'), 0o500);
      fs.chmodSync(retryDir, 0o500);

      // Attempt 1 & Attempt 2 while STILL 0o500 must BOTH return 503 (never 200 on repeat!)
      for (let attempt = 1; attempt <= 2; attempt++) {
        const cRes = await origFetch(`${base}/api/v1/jobs/${cancelJob.jobId}/cancel`, { method: 'POST', headers });
        assert.equal(cRes.status, 503, `Cancel attempt ${attempt} while 0o500 must be 503`);
        assert.equal((await cRes.json()).success, false);

        const rRes = await origFetch(`${base}/api/voices/clone/revoke-consent`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ voiceId: cloned.voiceId }),
        });
        assert.equal(rRes.status, 503, `Revoke attempt ${attempt} while 0o500 must be 503`);
        assert.equal((await rRes.json()).success, false);

        const dRes = await origFetch(`${base}/api/voices/${customVoice.id}`, { method: 'DELETE', headers });
        assert.equal(dRes.status, 503, `Delete voice attempt ${attempt} while 0o500 must be 503`);
        assert.equal((await dRes.json()).success, false);
      }

      // Repair permissions (0o700) -> Retrying each mutation now durably persists tombstones, deletes files, and returns 200!
      fs.chmodSync(retryDir, 0o700);
      fs.chmodSync(path.join(retryDir, 'usr_alice_user'), 0o700);

      const cRecovered = await origFetch(`${base}/api/v1/jobs/${cancelJob.jobId}/cancel`, {
        method: 'POST',
        headers,
      });
      assert.equal(cRecovered.status, 200);
      const cRecJson = await cRecovered.json();
      assert.equal(cRecJson.success, true);
      assert.equal(cRecJson.cleanupFailed, false);

      const rRecovered = await origFetch(`${base}/api/voices/clone/revoke-consent`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ voiceId: cloned.voiceId }),
      });
      assert.equal(rRecovered.status, 200);
      const rRecJson = await rRecovered.json();
      assert.equal(rRecJson.success, true);
      assert.equal(rRecJson.cleanupFailed, false);

      const dRecovered = await origFetch(`${base}/api/voices/${customVoice.id}`, {
        method: 'DELETE',
        headers,
      });
      assert.equal(dRecovered.status, 200);
      const dRecJson = await dRecovered.json();
      assert.equal(dRecJson.success, true);
      assert.equal(dRecJson.cleanupFailed, false);

      // Physical WAV files for all three invalidated resources are now deleted from disk
      assert.equal(fs.existsSync(path.join(retryDir, cancelMeta.storageKey)), false);
      assert.equal(fs.existsSync(path.join(retryDir, revokeMeta.storageKey)), false);
      assert.equal(fs.existsSync(path.join(retryDir, delVoiceMeta.storageKey)), false);

      // Invalidated signed URLs return 403, while untouched validJob signed URL recovers cleanly to 200 WAV!
      assert.equal((await origFetch(`${base}${cancelJob.outputSignedUrl}`)).status, 403);
      assert.equal((await origFetch(`${base}${revokeJob.outputSignedUrl}`)).status, 403);
      assert.equal((await origFetch(`${base}${delVoiceJob.outputSignedUrl}`)).status, 403);

      const validRes = await origFetch(`${base}${validJob.outputSignedUrl}`);
      assert.equal(validRes.status, 200);
      const validBuf = Buffer.from(await validRes.arrayBuffer());
      assert.equal(validBuf.subarray(0, 4).toString('ascii'), 'RIFF');
    } finally {
      restorePermissionsRecursively(retryDir);
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  test('S2E-07 (Concurrency Safety Across Restart): Concurrent invalidations and concurrent signed-URL reads lose zero tombstones and never reauthorize after fresh OS restart', () => {
    const concDir = fs.mkdtempSync(path.join(rootSuiteTmp, 'concurrency-'));

    const p1 = runIsolatedServerProcess(
      `
      import http from 'node:http';
      import express from 'express';
      import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
      import { AuthService, PRELOADED_USERS } from './server/auth/auth.ts';
      import { memoryStore } from './server/db/index.ts';
      import { apiRouter } from './server/routes/api.ts';

      const real = new LocalStorageProvider(${JSON.stringify(concDir)});
      // Delay delete() asynchronously and return false so concurrent awaits overlap while files stay on disk
      PrivateStorageService.setProvider({
        name: 'async_slow_fail_delete',
        isAvailable: () => real.isAvailable(),
        store: (k, b) => real.store(k, b),
        retrieve: (k) => real.retrieve(k),
        delete: async () => {
          await new Promise((r) => setTimeout(r, 15));
          return false;
        },
        exists: (k) => real.exists(k),
      });

      const app = express();
      app.use(express.json({ limit: '25mb' }));
      app.use('/api', apiRouter);
      const srv = http.createServer(app);
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const base = 'http://127.0.0.1:' + srv.address().port;
      const aliceTok = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
      const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + aliceTok };

      const jobs = [];
      for (let i = 0; i < 8; i++) {
        const j = await (await fetch(base + '/api/v1/tts/jobs', {
          method: 'POST', headers: h, body: JSON.stringify({ text: 'Concurrent item ' + i, voiceId: 'vf_sarah_en', language: 'en' }),
        })).json();
        const meta = memoryStore.privateMedia.find((m) => m.id === j.outputMediaId);
        jobs.push({ jobId: j.jobId, signedUrl: j.outputSignedUrl, meta });
      }

      // Fire all 8 cancellations concurrently alongside concurrent signed-URL downloads initiated AFTER cancel dispatch
      const cancelPromises = jobs.map((j) =>
        fetch(base + '/api/v1/jobs/' + j.jobId + '/cancel', { method: 'POST', headers: h })
      );
      const cancelResults = await Promise.all(cancelPromises);

      const postReads = await Promise.all(
        jobs.map(async (j) => {
          const r = await fetch(base + j.signedUrl);
          const b = Buffer.from(await r.arrayBuffer());
          return { status: r.status, isWav: b.subarray(0, 4).toString('ascii') === 'RIFF' };
        })
      );

      await new Promise((r) => srv.close(() => r()));
      process.stdout.write('__S2E_JSON__' + JSON.stringify({
        pid: process.pid,
        cancelStatuses: cancelResults.map((r) => r.status),
        postReads,
        jobs,
      }));
      `,
      { VOICEFORGE_STORAGE_DIR: concDir }
    );

    assert.deepEqual(p1.cancelStatuses, [200, 200, 200, 200, 200, 200, 200, 200]);
    for (const r of p1.postReads) {
      assert.equal(r.status, 403);
      assert.equal(r.isWav, false);
    }

    // Fresh OS process restart: ALL 8 tombstones must be present on disk (zero lost updates!)
    const p2 = runIsolatedServerProcess(
      `
      import http from 'node:http';
      import express from 'express';
      import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
      import { memoryStore } from './server/db/index.ts';
      import { apiRouter } from './server/routes/api.ts';

      const p1 = ${JSON.stringify(p1)};
      PrivateStorageService.setProvider(new LocalStorageProvider(${JSON.stringify(concDir)}));
      for (const j of p1.jobs) {
        memoryStore.privateMedia.push({ ...j.meta });
      }

      const app = express();
      app.use('/api', apiRouter);
      const srv = http.createServer(app);
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const base = 'http://127.0.0.1:' + srv.address().port;

      const results = await Promise.all(
        p1.jobs.map(async (j) => {
          const r = await fetch(base + j.signedUrl);
          const b = Buffer.from(await r.arrayBuffer());
          return { status: r.status, isWav: b.subarray(0, 4).toString('ascii') === 'RIFF' };
        })
      );
      const reconciled = await PrivateStorageService.reconcilePendingDeletions();
      await new Promise((r) => srv.close(() => r()));

      process.stdout.write('__S2E_JSON__' + JSON.stringify({ pid: process.pid, results, reconciled }));
      `,
      { VOICEFORGE_STORAGE_DIR: concDir }
    );

    assert.notEqual(p2.pid, p1.pid);
    for (const r of p2.results) {
      assert.equal(r.status, 403);
      assert.equal(r.isWav, false);
    }
    assert.equal(p2.reconciled.resolved, 8);
  });

  test('S2E-08 (Startup Safety, First-Request Enforcement, Signed-URL Expiry/Tamper & Public Catalog Isolation): Fresh OS process enforces ledger state on very first request and preserves signed-URL HMAC/expiry and public catalog routes', () => {
    const startDir = fs.mkdtempSync(path.join(rootSuiteTmp, 'startup-safety-'));

    const p1 = runIsolatedServerProcess(
      `
      import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
      ${SUBPROCESS_WAV_HELPER}

      const real = new LocalStorageProvider(${JSON.stringify(startDir)});
      PrivateStorageService.setProvider(real);

      const validRec = await PrivateStorageService.storeMedia({
        userId: 'usr_alice_user',
        voiceId: 'vf_sarah_en',
        mediaType: 'tts_output',
        filename: 'startup_valid.wav',
        buffer: makeWav(1.0, 220, 0),
      });
      const validUrl = PrivateStorageService.generateSignedDownloadUrl(validRec.id, 'usr_alice_user', 900);
      const expiredUrl = PrivateStorageService.generateSignedDownloadUrl(validRec.id, 'usr_alice_user', -60);

      const invRec = await PrivateStorageService.storeMedia({
        userId: 'usr_alice_user',
        voiceId: 'vf_sarah_en',
        mediaType: 'tts_output',
        filename: 'startup_inv.wav',
        buffer: makeWav(1.0, 260, 0.2),
      });
      const invUrl = PrivateStorageService.generateSignedDownloadUrl(invRec.id, 'usr_alice_user', 900);

      // Fail delete so startup_inv.wav remains on disk before restart
      PrivateStorageService.setProvider({
        name: 'startup_fail_del',
        isAvailable: () => real.isAvailable(),
        store: (k, b) => real.store(k, b),
        retrieve: (k) => real.retrieve(k),
        delete: async () => false,
        exists: (k) => real.exists(k),
      });
      await PrivateStorageService.invalidateAndDeleteMedia({
        mediaId: invRec.id,
        requestingUserId: 'usr_alice_user',
        reason: 'job_cancelled',
      });

      process.stdout.write('__S2E_JSON__' + JSON.stringify({
        pid: process.pid,
        validRec,
        validUrl,
        expiredUrl,
        invRec,
        invUrl,
      }));
      `,
      { VOICEFORGE_STORAGE_DIR: startDir }
    );

    // Fresh OS process WITHOUT explicitly calling setProvider — relies purely on VOICEFORGE_STORAGE_DIR
    // and startup init + reconcilePendingDeletions before accepting HTTP traffic
    const p2 = runIsolatedServerProcess(
      `
      import fs from 'node:fs';
      import path from 'node:path';
      import http from 'node:http';
      import express from 'express';
      import { PrivateStorageService } from './server/storage/privateStorage.ts';
      import { memoryStore } from './server/db/index.ts';
      import { apiRouter } from './server/routes/api.ts';

      const p1 = ${JSON.stringify(p1)};
      const dir = ${JSON.stringify(startDir)};

      // Mirror server.ts startup initialization sequence
      PrivateStorageService.init();
      const healthyAtBoot = PrivateStorageService.isInvalidationLedgerHealthy();
      const reconcileAtBoot = healthyAtBoot ? await PrivateStorageService.reconcilePendingDeletions() : null;
      const invWavExistsAfterBoot = fs.existsSync(path.join(dir, p1.invRec.storageKey));

      memoryStore.privateMedia.push({ ...p1.validRec }, { ...p1.invRec });

      const app = express();
      app.use('/api', apiRouter);
      const srv = http.createServer(app);
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const base = 'http://127.0.0.1:' + srv.address().port;

      // Very first request after boot is the invalidated signed URL -> must be 403
      const firstReqInv = await fetch(base + p1.invUrl);
      const firstReqBuf = Buffer.from(await firstReqInv.arrayBuffer());

      // Expired signed URL -> 403
      const expRes = await fetch(base + p1.expiredUrl);
      // Tampered signed URL -> 403
      const tamperedRes = await fetch(base + p1.validUrl.slice(0, -4) + 'ffff');
      // Valid signed URL -> 200 WAV
      const okRes = await fetch(base + p1.validUrl);
      const okBuf = Buffer.from(await okRes.arrayBuffer());
      // Public voice catalog -> 200
      const pubVoicesRes = await fetch(base + '/api/v1/voices');

      await new Promise((r) => srv.close(() => r()));
      process.stdout.write('__S2E_JSON__' + JSON.stringify({
        pid: process.pid,
        healthyAtBoot,
        reconcileAtBoot,
        invWavExistsAfterBoot,
        firstReqStatus: firstReqInv.status,
        firstReqIsWav: firstReqBuf.subarray(0, 4).toString('ascii') === 'RIFF',
        expStatus: expRes.status,
        tamperedStatus: tamperedRes.status,
        okStatus: okRes.status,
        okIsWav: okBuf.subarray(0, 4).toString('ascii') === 'RIFF',
        pubVoicesStatus: pubVoicesRes.status,
      }));
      `,
      { VOICEFORGE_STORAGE_DIR: startDir }
    );

    assert.notEqual(p2.pid, p1.pid);
    assert.equal(p2.healthyAtBoot, true);
    assert.equal(p2.reconcileAtBoot.resolved, 1);
    assert.equal(p2.invWavExistsAfterBoot, false);
    assert.equal(p2.firstReqStatus, 403);
    assert.equal(p2.firstReqIsWav, false);
    assert.equal(p2.expStatus, 403);
    assert.equal(p2.tamperedStatus, 403);
    assert.equal(p2.okStatus, 200);
    assert.equal(p2.okIsWav, true);
    assert.equal(p2.pubVoicesStatus, 200);
  });
});
