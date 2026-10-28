/**
 * Phase 3C-S2G: Crash-Recovery and Fail-Closed State Hardening Suite
 *
 * Covers the two targeted S2F observations without weakening any S1/S2A/S2C/S2E guarantees:
 * - `S2F-OBS-02` (Objective A): Crash-safe private-media orphan cleanup when `SIGKILL` terminates
 *   the process before, during, or immediately after `provider.delete()`, keeping durable
 *   authorization invalidation and physical artifact cleanup strictly separate.
 * - `S2F-OBS-03` (Objective B): Preserving valid, uncancelled job lifecycle state during transient
 *   invalidation-ledger faults (`503 STORAGE_UNAVAILABLE` fail-closed without mutating job status
 *   to `'cancelled'`), while keeping explicit cancellation, consent revocation, and tenant isolation intact.
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import express from 'express';

import {
  LocalStorageProvider,
  PrivateStorageService,
  type StorageProvider,
} from '../../server/storage/privateStorage.ts';
import { AuthService, DurableRevocationStore, PRELOADED_USERS } from '../../server/auth/auth.ts';
import { memoryStore } from '../../server/db/index.ts';
import { apiRouter } from '../../server/routes/api.ts';

const TEST_AUTH_SECRET = 'phase3c_s2g_auth_secret_key_0123456789abcdef';
const TEST_STORAGE_SECRET = 'phase3c_s2g_storage_secret_key_0123456789abcd';
const TEST_CONSENT_SECRET = 'phase3c_s2g_consent_secret_key_0123456789abcd';
const TEST_WATERMARK_KEY = 'phase3c_s2g_watermark_secret_key_0123456789ab';

function createSyntheticWav(
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

function buildIsolatedEnv(
  storageDir: string,
  revocationFile: string,
  extraEnv: Record<string, string | undefined> = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    VOICEFORGE_STORAGE_DIR: storageDir,
    VOICEFORGE_REVOCATION_FILE: revocationFile,
    VOICEFORGE_AUTH_SECRET: TEST_AUTH_SECRET,
    VOICEFORGE_STORAGE_SECRET: TEST_STORAGE_SECRET,
    VOICEFORGE_CONSENT_SECRET: TEST_CONSENT_SECRET,
    VOICEFORGE_WATERMARK_KEY: TEST_WATERMARK_KEY,
  };
  delete env.VOICEFORGE_MEDIA_TOMBSTONE_FILE;
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

function runFreshSubprocess<T = any>(
  storageDir: string,
  revocationFile: string,
  esmScript: string,
  extraEnv: Record<string, string | undefined> = {}
): T {
  const out = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', esmScript],
    {
      cwd: process.cwd(),
      env: buildIsolatedEnv(storageDir, revocationFile, extraEnv),
      encoding: 'utf8',
      timeout: 30000,
    }
  );
  const idx = out.lastIndexOf('__S2G_JSON__');
  assert.notEqual(idx, -1, `Subprocess did not emit __S2G_JSON__ marker. Output: ${out}`);
  return JSON.parse(out.slice(idx + '__S2G_JSON__'.length).trim()) as T;
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

function assertZeroAudioAndNoLeakage(buf: Buffer, forbiddenPaths: string[] = []): void {
  assert.equal(
    buf.subarray(0, 4).toString('ascii') === 'RIFF',
    false,
    'Response must never contain RIFF WAV bytes'
  );
  const text = buf.toString('utf8');
  assert.equal(text.includes('UklGR'), false, 'Response must never contain base64 WAV audio');
  assert.equal(text.includes(TEST_STORAGE_SECRET), false, 'Storage secret must never leak');
  assert.equal(text.includes(TEST_AUTH_SECRET), false, 'Auth secret must never leak');
  for (const p of forbiddenPaths) {
    if (p) {
      assert.equal(text.includes(p), false, `Filesystem path must never leak: ${p}`);
    }
  }
}

test.describe('Phase 3C-S2G: Crash-Recovery & Fail-Closed State Hardening Suite', () => {
  const savedEnv: Record<string, string | undefined> = {};
  let suiteTmpRoot: string;
  let revocationFile: string;
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

    suiteTmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-s2g-suite-'));
    revocationFile = path.join(suiteTmpRoot, 'revoked_tokens.json');
    origProvider = PrivateStorageService.getProvider();

    process.env.NODE_ENV = 'test';
    process.env.VOICEFORGE_AUTH_SECRET = TEST_AUTH_SECRET;
    process.env.VOICEFORGE_STORAGE_SECRET = TEST_STORAGE_SECRET;
    process.env.VOICEFORGE_CONSENT_SECRET = TEST_CONSENT_SECRET;
    process.env.VOICEFORGE_WATERMARK_KEY = TEST_WATERMARK_KEY;
    process.env.VOICEFORGE_REVOCATION_FILE = revocationFile;
    delete process.env.VOICEFORGE_MEDIA_TOMBSTONE_FILE;

    origFetch = globalThis.fetch;
    globalThis.fetch = async (input: any, init?: any) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const parsed = new URL(urlStr);
      if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
        throw new Error(`External network blocked in S2G test: ${parsed.hostname}`);
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

    restorePermissionsRecursively(suiteTmpRoot);
    fs.rmSync(suiteTmpRoot, { recursive: true, force: true });
  });

  test('S2G-01 (Objective A — S2F-OBS-02): SIGKILL mid-deletion leaves artifact denied (403, 0 WAV bytes) with cleanupFailed:true, and a fresh OS process discovers and deletes the orphan idempotently', () => {
    const crashDir = fs.mkdtempSync(path.join(suiteTmpRoot, 'obs02-sigkill-'));
    const handoffFile = path.join(suiteTmpRoot, 'obs02-handoff.json');

    try {
      // Process 1: Create WAV + signed URL, then deliver real SIGKILL inside provider.delete() BEFORE unlink
      const killRun = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `
          import fs from 'node:fs';
          import http from 'node:http';
          import express from 'express';
          import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
          import { AuthService, PRELOADED_USERS } from './server/auth/auth.ts';
          import { memoryStore } from './server/db/index.ts';
          import { apiRouter } from './server/routes/api.ts';

          const dir = process.env.VOICEFORGE_STORAGE_DIR;
          const real = new LocalStorageProvider(dir);
          let armKill = false;
          PrivateStorageService.setProvider({
            name: 's2g_sigkill_before_unlink',
            isAvailable: () => real.isAvailable(),
            store: (k, b) => real.store(k, b),
            retrieve: (k) => real.retrieve(k),
            delete: async (k) => {
              if (armKill) {
                process.kill(process.pid, 'SIGKILL');
              }
              return real.delete(k);
            },
            exists: (k) => real.exists(k),
          });

          const app = express();
          app.use(express.json({ limit: '25mb' }));
          app.use('/api', apiRouter);
          const srv = http.createServer(app);
          await new Promise((r) => srv.listen(0, '127.0.0.1', r));
          const base = 'http://127.0.0.1:' + srv.address().port;
          const tok = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
          const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };

          const job = await (await fetch(base + '/api/v1/tts/jobs', {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ text: 'S2G SIGKILL mid-delete verification', voiceId: 'vf_sarah_en', language: 'en' }),
          })).json();
          const preDl = await fetch(base + job.outputSignedUrl);
          const preBuf = Buffer.from(await preDl.arrayBuffer());
          const meta = memoryStore.privateMedia.find((m) => m.id === job.outputMediaId);

          fs.writeFileSync(${JSON.stringify(handoffFile)}, JSON.stringify({
            pid: process.pid,
            jobId: job.jobId,
            mediaId: job.outputMediaId,
            signedUrl: job.outputSignedUrl,
            meta,
            preStatus: preDl.status,
            preWavBytes: preBuf.subarray(0, 4).toString('ascii') === 'RIFF' ? preBuf.length : 0,
          }));

          armKill = true;
          await fetch(base + '/api/v1/jobs/' + job.jobId + '/cancel', { method: 'POST', headers: h });
          `,
        ],
        {
          cwd: process.cwd(),
          env: buildIsolatedEnv(crashDir, revocationFile),
          encoding: 'utf8',
          timeout: 30000,
        }
      );

      assert.equal(killRun.signal, 'SIGKILL', 'Child process must terminate via SIGKILL');
      const p1 = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));
      assert.equal(p1.preStatus, 200);
      assert.ok(p1.preWavBytes > 1000);

      // Inspect durable ledger on disk immediately after SIGKILL BEFORE Process 2 boots:
      const wavAbsPath = path.join(crashDir, p1.meta.storageKey);
      assert.equal(fs.existsSync(wavAbsPath), true, 'Physical WAV file is still orphaned on disk right after SIGKILL');
      const ledgerAfterCrash = JSON.parse(
        fs.readFileSync(path.join(crashDir, '.invalidated_media.json'), 'utf8')
      );
      const crashedEntry = ledgerAfterCrash.entries.find((e: any) => e.id === p1.mediaId);
      assert.ok(crashedEntry, 'Step 1 tombstone must already be durably persisted prior to provider.delete()');
      assert.equal(
        crashedEntry.cleanupFailed,
        true,
        'Physical deletion must NOT be marked complete before provider.delete() succeeds'
      );

      // Process 2: Fresh OS process verifies signed URL is denied BEFORE reconciliation, then runs startup reconciliation
      const p2 = runFreshSubprocess(
        crashDir,
        revocationFile,
        `
        import fs from 'node:fs';
        import path from 'node:path';
        import http from 'node:http';
        import express from 'express';
        import { PrivateStorageService } from './server/storage/privateStorage.ts';
        import { AuthService, PRELOADED_USERS } from './server/auth/auth.ts';
        import { memoryStore } from './server/db/index.ts';
        import { apiRouter } from './server/routes/api.ts';

        const dir = process.env.VOICEFORGE_STORAGE_DIR;
        PrivateStorageService.init();
        memoryStore.privateMedia.push(${JSON.stringify(p1.meta)});

        const app = express();
        app.use('/api', apiRouter);
        const srv = http.createServer(app);
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        const base = 'http://127.0.0.1:' + srv.address().port;
        const tok = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);

        // 1. Probe signed URL BEFORE reconcilePendingDeletions() runs
        const preRecRes = await fetch(base + ${JSON.stringify(p1.signedUrl)});
        const preRecBuf = Buffer.from(await preRecRes.arrayBuffer());

        // 2. Run startup reconciliation
        const rec1 = await PrivateStorageService.reconcilePendingDeletions();
        const wavExistsAfterRec1 = fs.existsSync(path.join(dir, ${JSON.stringify(p1.meta.storageKey)}));

        // 3. Idempotent second reconciliation in same process
        const rec2 = await PrivateStorageService.reconcilePendingDeletions();

        // 4. Probe signed URL & Bearer AFTER reconciliation
        const postRecRes = await fetch(base + ${JSON.stringify(p1.signedUrl)});
        const postRecBuf = Buffer.from(await postRecRes.arrayBuffer());
        const bearerRes = await fetch(base + '/api/v1/media/download/' + ${JSON.stringify(p1.mediaId)}, {
          headers: { Authorization: 'Bearer ' + tok },
        });
        const bearerBuf = Buffer.from(await bearerRes.arrayBuffer());

        const ledgerAfterRec = JSON.parse(fs.readFileSync(path.join(dir, '.invalidated_media.json'), 'utf8'));
        await new Promise((r) => srv.close(() => r()));

        process.stdout.write('__S2G_JSON__' + JSON.stringify({
          pid: process.pid,
          preRecStatus: preRecRes.status,
          preRecBase64: preRecBuf.toString('base64'),
          rec1,
          wavExistsAfterRec1,
          rec2,
          postRecStatus: postRecRes.status,
          postRecBase64: postRecBuf.toString('base64'),
          bearerStatus: bearerRes.status,
          bearerBase64: bearerBuf.toString('base64'),
          entryAfterRec: ledgerAfterRec.entries.find((e) => e.id === ${JSON.stringify(p1.mediaId)}),
        }));
        `
      );

      assert.notEqual(p2.pid, p1.pid);
      assert.equal(p2.preRecStatus, 403);
      assertZeroAudioAndNoLeakage(Buffer.from(p2.preRecBase64, 'base64'), [crashDir]);
      assert.deepEqual(p2.rec1, { attempted: 1, resolved: 1, stillFailing: 0 });
      assert.equal(p2.wavExistsAfterRec1, false, 'Orphaned WAV artifact must be physically removed on startup reconciliation');
      assert.deepEqual(p2.rec2, { attempted: 0, resolved: 0, stillFailing: 0 });
      assert.equal(p2.entryAfterRec.cleanupFailed, false);
      assert.equal(p2.entryAfterRec.cleanupFailureCode, undefined);
      assert.equal(p2.postRecStatus, 403);
      assertZeroAudioAndNoLeakage(Buffer.from(p2.postRecBase64, 'base64'), [crashDir]);
      assert.equal(p2.bearerStatus, 403);
      assertZeroAudioAndNoLeakage(Buffer.from(p2.bearerBase64, 'base64'), [crashDir]);

      // Process 3: Repeated fresh OS restart remains idempotent and permanently denies signed URL
      const p3 = runFreshSubprocess(
        crashDir,
        revocationFile,
        `
        import http from 'node:http';
        import express from 'express';
        import { PrivateStorageService } from './server/storage/privateStorage.ts';
        import { memoryStore } from './server/db/index.ts';
        import { apiRouter } from './server/routes/api.ts';

        PrivateStorageService.init();
        const rec = await PrivateStorageService.reconcilePendingDeletions();
        memoryStore.privateMedia.push(${JSON.stringify(p1.meta)});

        const app = express();
        app.use('/api', apiRouter);
        const srv = http.createServer(app);
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        const base = 'http://127.0.0.1:' + srv.address().port;

        const dl = await fetch(base + ${JSON.stringify(p1.signedUrl)});
        const buf = Buffer.from(await dl.arrayBuffer());
        await new Promise((r) => srv.close(() => r()));

        process.stdout.write('__S2G_JSON__' + JSON.stringify({
          pid: process.pid,
          rec,
          status: dl.status,
          bodyBase64: buf.toString('base64'),
        }));
        `
      );

      assert.notEqual(p3.pid, p2.pid);
      assert.deepEqual(p3.rec, { attempted: 0, resolved: 0, stillFailing: 0 });
      assert.equal(p3.status, 403);
      assertZeroAudioAndNoLeakage(Buffer.from(p3.bodyBase64, 'base64'), [crashDir]);
    } finally {
      restorePermissionsRecursively(crashDir);
      fs.rmSync(crashDir, { recursive: true, force: true });
      fs.rmSync(handoffFile, { force: true });
    }
  });

  test('S2G-02 (Objective A — Post-Unlink Crash, Failed Deletion Retention & Missing-Artifact vs EACCES Distinction): SIGKILL after unlink reconciles missing artifact cleanly, whereas failed delete or unreadable 0o000 tenant dir preserves cleanupFailed:true', () => {
    const dir = fs.mkdtempSync(path.join(suiteTmpRoot, 'obs02-transitions-'));
    const handoffFile = path.join(suiteTmpRoot, 'obs02-postunlink.json');

    try {
      // Transition A: SIGKILL immediately AFTER physical unlink succeeds, BEFORE Step 3 persists cleanupFailed:false
      const killAfterUnlink = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `
          import fs from 'node:fs';
          import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';

          const dir = process.env.VOICEFORGE_STORAGE_DIR;
          const real = new LocalStorageProvider(dir);
          let killAfter = false;
          PrivateStorageService.setProvider({
            name: 's2g_sigkill_after_unlink',
            isAvailable: () => real.isAvailable(),
            store: (k, b) => real.store(k, b),
            retrieve: (k) => real.retrieve(k),
            delete: async (k) => {
              const deleted = await real.delete(k);
              if (killAfter) {
                process.kill(process.pid, 'SIGKILL');
              }
              return deleted;
            },
            exists: (k) => real.exists(k),
          });

          const wav = Buffer.alloc(44 + 3200);
          wav.write('RIFF', 0); wav.writeUInt32LE(36 + 3200, 4); wav.write('WAVE', 8);
          wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
          wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
          wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(3200, 40);

          const rec = await PrivateStorageService.storeMedia({
            userId: 'usr_alice_user',
            voiceId: 'vf_sarah_en',
            mediaType: 'tts_output',
            filename: 'postunlink.wav',
            buffer: wav,
          });
          const signedUrl = PrivateStorageService.generateSignedDownloadUrl(rec.id, 'usr_alice_user', 900);
          fs.writeFileSync(${JSON.stringify(handoffFile)}, JSON.stringify({ pid: process.pid, rec, signedUrl }));

          killAfter = true;
          await PrivateStorageService.invalidateAndDeleteMedia({
            mediaId: rec.id,
            requestingUserId: 'usr_alice_user',
            reason: 'job_cancelled',
          });
          `,
        ],
        {
          cwd: process.cwd(),
          env: buildIsolatedEnv(dir, revocationFile),
          encoding: 'utf8',
          timeout: 30000,
        }
      );

      assert.equal(killAfterUnlink.signal, 'SIGKILL');
      const saved = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));
      assert.equal(
        fs.existsSync(path.join(dir, saved.rec.storageKey)),
        false,
        'WAV file was already unlinked prior to SIGKILL'
      );

      // Fresh process: missing artifact on available store is reconciled cleanly without error;
      // ALSO test failed delete + 0o000 unreadable directory keeping cleanupFailed:true!
      const verifyRes = runFreshSubprocess(
        dir,
        revocationFile,
        `
        import fs from 'node:fs';
        import path from 'node:path';
        import http from 'node:http';
        import express from 'express';
        import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
        import { memoryStore } from './server/db/index.ts';
        import { apiRouter } from './server/routes/api.ts';

        const dir = process.env.VOICEFORGE_STORAGE_DIR;
        const real = new LocalStorageProvider(dir);
        PrivateStorageService.setProvider(real);
        PrivateStorageService.init();

        // 1. Reconcile post-unlink missing artifact
        const missingArtifactRec = await PrivateStorageService.reconcilePendingDeletions();

        // 2. Store a second artifact, force delete() to return false -> cleanupFailed must remain true
        const wav = Buffer.alloc(44 + 3200);
        wav.write('RIFF', 0); wav.writeUInt32LE(36 + 3200, 4); wav.write('WAVE', 8);
        wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
        wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(3200, 40);

        const rec2 = await PrivateStorageService.storeMedia({
          userId: 'usr_alice_user',
          voiceId: 'vf_sarah_en',
          mediaType: 'tts_output',
          filename: 'faildel.wav',
          buffer: wav,
        });
        const url2 = PrivateStorageService.generateSignedDownloadUrl(rec2.id, 'usr_alice_user', 900);

        PrivateStorageService.setProvider({
          name: 's2g_false_delete',
          isAvailable: () => real.isAvailable(),
          store: (k, b) => real.store(k, b),
          retrieve: (k) => real.retrieve(k),
          delete: async () => false,
          exists: (k) => real.exists(k),
        });
        const failOutcome = await PrivateStorageService.invalidateAndDeleteMedia({
          mediaId: rec2.id,
          requestingUserId: 'usr_alice_user',
          reason: 'job_cancelled',
        });
        const recWhileDeleteFails = await PrivateStorageService.reconcilePendingDeletions();

        // 3. Switch back to real provider, make tenant dir 0o000 (EACCES on lstatSync) so exists() cannot stat!
        // Must NOT mistake EACCES for ENOENT; cleanupFailed must stay true!
        PrivateStorageService.setProvider(real);
        const tenantDir = path.join(dir, 'usr_alice_user');
        fs.chmodSync(tenantDir, 0o000);
        const recWhile000 = await PrivateStorageService.reconcilePendingDeletions();
        fs.chmodSync(tenantDir, 0o700);
        const wavStillPresentBeforeRealFix = fs.existsSync(path.join(dir, rec2.storageKey));

        // 4. Now with 0o700 restored, reconcilePendingDeletions() genuinely deletes rec2!
        const recAfter700 = await PrivateStorageService.reconcilePendingDeletions();
        const wavPresentAfter700 = fs.existsSync(path.join(dir, rec2.storageKey));

        memoryStore.privateMedia.push(${JSON.stringify(saved.rec)}, rec2);
        const app = express();
        app.use('/api', apiRouter);
        const srv = http.createServer(app);
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        const base = 'http://127.0.0.1:' + srv.address().port;
        const dl1 = await fetch(base + ${JSON.stringify(saved.signedUrl)});
        const dl1Buf = Buffer.from(await dl1.arrayBuffer());
        const dl2 = await fetch(base + url2);
        const dl2Buf = Buffer.from(await dl2.arrayBuffer());
        await new Promise((r) => srv.close(() => r()));

        process.stdout.write('__S2G_JSON__' + JSON.stringify({
          pid: process.pid,
          missingArtifactRec,
          failOutcome,
          recWhileDeleteFails,
          recWhile000,
          wavStillPresentBeforeRealFix,
          recAfter700,
          wavPresentAfter700,
          dl1Status: dl1.status,
          dl1Base64: dl1Buf.toString('base64'),
          dl2Status: dl2.status,
          dl2Base64: dl2Buf.toString('base64'),
        }));
        `
      );

      assert.notEqual(verifyRes.pid, saved.pid);
      assert.deepEqual(verifyRes.missingArtifactRec, { attempted: 1, resolved: 1, stillFailing: 0 });
      assert.equal(verifyRes.failOutcome.invalidated, true);
      assert.equal(verifyRes.failOutcome.deletedFromProvider, false);
      assert.equal(verifyRes.failOutcome.cleanupFailed, true);
      assert.deepEqual(verifyRes.recWhileDeleteFails, { attempted: 1, resolved: 0, stillFailing: 1 });
      assert.deepEqual(
        verifyRes.recWhile000,
        { attempted: 1, resolved: 0, stillFailing: 1 },
        'Unreadable 0o000 directory (EACCES) must never clear pending cleanup state'
      );
      assert.equal(verifyRes.wavStillPresentBeforeRealFix, true);
      assert.deepEqual(verifyRes.recAfter700, { attempted: 1, resolved: 1, stillFailing: 0 });
      assert.equal(verifyRes.wavPresentAfter700, false);
      assert.equal(verifyRes.dl1Status, 403);
      assertZeroAudioAndNoLeakage(Buffer.from(verifyRes.dl1Base64, 'base64'), [dir]);
      assert.equal(verifyRes.dl2Status, 403);
      assertZeroAudioAndNoLeakage(Buffer.from(verifyRes.dl2Base64, 'base64'), [dir]);
    } finally {
      restorePermissionsRecursively(dir);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(handoffFile, { force: true });
    }
  });

  test('S2G-03 (Objective B — S2F-OBS-03): Transient invalidation-ledger faults fail closed (503) on GET /api/v1/tts/jobs, GET /api/v1/jobs/:id, and GET /api/v1/tts/jobs/:id without mutating valid jobs into cancelled', async () => {
    const jobDir = fs.mkdtempSync(path.join(suiteTmpRoot, 'obs03-jobs-'));
    PrivateStorageService.setProvider(new LocalStorageProvider(jobDir));

    const app = express();
    app.use(express.json({ limit: '25mb' }));
    app.use('/api', apiRouter);
    const srv = http.createServer(app);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as any).port;
    const base = `http://127.0.0.1:${port}`;

    const aliceTok = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
    const bobTok = AuthService.issueToken(PRELOADED_USERS.usr_bob_user);
    const aliceHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceTok}` };
    const bobHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${bobTok}` };

    try {
      // Create valid uncancelled synthesis jobs + a cloned voice job to test consent revocation alongside transient fault
      const validJobA = await (
        await origFetch(`${base}/api/v1/tts/jobs`, {
          method: 'POST',
          headers: aliceHeaders,
          body: JSON.stringify({
            text: 'Valid completed job A must survive transient storage fault.',
            voiceId: 'vf_sarah_en',
            language: 'en',
          }),
        })
      ).json();
      const validJobB = await (
        await origFetch(`${base}/api/v1/tts/jobs`, {
          method: 'POST',
          headers: aliceHeaders,
          body: JSON.stringify({
            text: 'Valid completed job B for explicit cancellation after recovery.',
            voiceId: 'vf_sarah_en',
            language: 'en',
          }),
        })
      ).json();

      const chRes = await (
        await origFetch(`${base}/api/voices/clone/challenge`, {
          method: 'POST',
          headers: aliceHeaders,
          body: JSON.stringify({ voiceName: 'Alice S2G Consent Voice' }),
        })
      ).json();
      const enrollRes = await (
        await origFetch(`${base}/api/voices/clone/verify-consent`, {
          method: 'POST',
          headers: aliceHeaders,
          body: JSON.stringify({
            challenge: chRes,
            voiceName: 'Alice S2G Consent Voice',
            referenceAudioBase64: createSyntheticWav(4.0, 210, 0).toString('base64'),
            consentAudioBase64: createSyntheticWav(4.2, 210, 0.08).toString('base64'),
            gender: 'female',
            primaryLanguage: 'en',
          }),
        })
      ).json();
      const clonedJob = await (
        await origFetch(`${base}/api/v1/tts/jobs`, {
          method: 'POST',
          headers: aliceHeaders,
          body: JSON.stringify({
            text: 'Cloned voice job for consent check.',
            voiceId: enrollRes.voiceId,
            language: 'en',
          }),
        })
      ).json();

      assert.equal(validJobA.status, 'completed');
      assert.equal(validJobB.status, 'completed');
      assert.equal(clonedJob.status, 'completed');

      // Inject transient invalidation-ledger fault (unwritable 0o500 storage directory)
      fs.chmodSync(jobDir, 0o500);

      // 1. Anonymous & Cross-Tenant checks remain strictly enforced even during ledger fault
      const anonList = await origFetch(`${base}/api/v1/tts/jobs`);
      assert.equal(anonList.status, 401);
      const bobPollAlice = await origFetch(`${base}/api/v1/jobs/${validJobA.jobId}`, { headers: bobHeaders });
      assert.equal(bobPollAlice.status, 403);
      assert.equal((await bobPollAlice.json()).code, 'FORBIDDEN_NOT_OWNER');

      // 2. Owner polling GET /api/v1/tts/jobs, GET /api/v1/jobs/:id, and GET /api/v1/tts/jobs/:id fails closed with 503
      //    and leaks zero audio, signed URLs, or storage paths
      for (const pollPath of [
        '/api/v1/tts/jobs',
        `/api/v1/jobs/${validJobA.jobId}`,
        `/api/v1/tts/jobs/${validJobA.jobId}`,
      ]) {
        const res = await origFetch(`${base}${pollPath}`, { headers: aliceHeaders });
        const buf = Buffer.from(await res.arrayBuffer());
        assert.equal(res.status, 503, `${pollPath} must fail closed with 503 while ledger is unhealthy`);
        assertZeroAudioAndNoLeakage(buf, [jobDir]);
        const body = JSON.parse(buf.toString('utf8'));
        assert.equal(body.code, 'STORAGE_UNAVAILABLE');
        assert.equal(body.outputSignedUrl, undefined);
        assert.equal(body.result, undefined);
      }

      //Signed URL download is also blocked while ledger is unhealthy
      const dlDuringFault = await origFetch(`${base}${validJobA.outputSignedUrl}`);
      assert.equal(dlDuringFault.status, 503);
      assertZeroAudioAndNoLeakage(Buffer.from(await dlDuringFault.arrayBuffer()), [jobDir]);

      // 3. Repair transient fault (restore 0o700) -> validJobA and validJobB MUST still be 'completed', NOT 'cancelled'!
      fs.chmodSync(jobDir, 0o700);

      const listAfter = await origFetch(`${base}/api/v1/tts/jobs`, { headers: aliceHeaders });
      assert.equal(listAfter.status, 200);
      const listJson = await listAfter.json();
      const restoredA = listJson.jobs.find((j: any) => j.id === validJobA.jobId);
      const restoredB = listJson.jobs.find((j: any) => j.id === validJobB.jobId);
      assert.ok(restoredA);
      assert.ok(restoredB);
      assert.equal(restoredA.status, 'completed', 'GET /api/v1/tts/jobs must not mutate valid job into cancelled');
      assert.equal(restoredB.status, 'completed');
      assert.ok(restoredA.result?.audioBase64, 'Completed job result must remain intact after transient fault');

      const detailV1After = await origFetch(`${base}/api/v1/jobs/${validJobA.jobId}`, { headers: aliceHeaders });
      assert.equal(detailV1After.status, 200);
      const detailV1Json = await detailV1After.json();
      assert.equal(detailV1Json.status, 'completed', 'GET /api/v1/jobs/:id must preserve completed lifecycle state');
      assert.ok(detailV1Json.result?.audioBase64);

      const detailTtsAfter = await origFetch(`${base}/api/v1/tts/jobs/${validJobA.jobId}`, {
        headers: aliceHeaders,
      });
      assert.equal(detailTtsAfter.status, 200);
      assert.equal((await detailTtsAfter.json()).job.status, 'completed');

      const dlAfterRestore = await origFetch(`${base}${validJobA.outputSignedUrl}`);
      const dlAfterBuf = Buffer.from(await dlAfterRestore.arrayBuffer());
      assert.equal(dlAfterRestore.status, 200);
      assert.equal(dlAfterBuf.subarray(0, 4).toString('ascii'), 'RIFF');

      // 4. Explicit cancellation of validJobB continues to follow full cancellation & durable-invalidation protocol
      const cancelB = await origFetch(`${base}/api/v1/jobs/${validJobB.jobId}/cancel`, {
        method: 'POST',
        headers: aliceHeaders,
      });
      assert.equal(cancelB.status, 200);
      const cancelBJson = await cancelB.json();
      assert.equal(cancelBJson.success, true);
      assert.equal(cancelBJson.cleanupFailed, false);
      assert.equal(cancelBJson.job.status, 'cancelled');

      const pollBAfterCancel = await (
        await origFetch(`${base}/api/v1/jobs/${validJobB.jobId}`, { headers: aliceHeaders })
      ).json();
      assert.equal(pollBAfterCancel.status, 'cancelled');
      assert.equal(pollBAfterCancel.result, undefined);
      assert.equal(pollBAfterCancel.outputSignedUrl, undefined);

      const dlBAfterCancel = await origFetch(`${base}${validJobB.outputSignedUrl}`);
      assert.equal(dlBAfterCancel.status, 403);
      assertZeroAudioAndNoLeakage(Buffer.from(await dlBAfterCancel.arrayBuffer()), [jobDir]);

      // 5. Consent revocation continues to scrub clonedJob and return 403 CONSENT_REVOKED while validJobA stays completed
      const revRes = await origFetch(`${base}/api/voices/clone/revoke-consent`, {
        method: 'POST',
        headers: aliceHeaders,
        body: JSON.stringify({ voiceId: enrollRes.voiceId }),
      });
      assert.equal(revRes.status, 200);

      const pollClonedAfterRev = await origFetch(`${base}/api/v1/jobs/${clonedJob.jobId}`, {
        headers: aliceHeaders,
      });
      assert.equal(pollClonedAfterRev.status, 403);
      assert.equal((await pollClonedAfterRev.json()).code, 'CONSENT_REVOKED');

      const pollAStillCompleted = await (
        await origFetch(`${base}/api/v1/jobs/${validJobA.jobId}`, { headers: aliceHeaders })
      ).json();
      assert.equal(pollAStillCompleted.status, 'completed');
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
      restorePermissionsRecursively(jobDir);
      fs.rmSync(jobDir, { recursive: true, force: true });
    }
  });

  test('S2G-04 (Voice Consent Revocation SIGKILL Batch Cleanup + GET /api/media/jobs Transient Ledger Fault Protection): SIGKILL mid-batch voice revocation leaves all artifacts denied (0 WAV bytes) & reconcilable on restart, and media dubbing job polling fails closed without state mutation', async () => {
    const batchDir = fs.mkdtempSync(path.join(suiteTmpRoot, 'obs02-batch-'));
    const handoffFile = path.join(suiteTmpRoot, 'obs02-batch-handoff.json');

    try {
      // Part 1: Enroll cloned voice, generate 2 TTS artifacts, deliver SIGKILL during revoke-consent after 1st delete
      const batchKill = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `
          import fs from 'node:fs';
          import http from 'node:http';
          import express from 'express';
          import { LocalStorageProvider, PrivateStorageService } from './server/storage/privateStorage.ts';
          import { AuthService, PRELOADED_USERS } from './server/auth/auth.ts';
          import { memoryStore } from './server/db/index.ts';
          import { apiRouter } from './server/routes/api.ts';

          const dir = process.env.VOICEFORGE_STORAGE_DIR;
          const real = new LocalStorageProvider(dir);
          let armBatchKill = false;
          let deleteCalls = 0;
          PrivateStorageService.setProvider({
            name: 's2g_batch_sigkill',
            isAvailable: () => real.isAvailable(),
            store: (k, b) => real.store(k, b),
            retrieve: (k) => real.retrieve(k),
            delete: async (k) => {
              if (armBatchKill) {
                deleteCalls++;
                if (deleteCalls >= 2) {
                  process.kill(process.pid, 'SIGKILL');
                }
              }
              return real.delete(k);
            },
            exists: (k) => real.exists(k),
          });

          function mkWavB64(sec, freq, phase) {
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
              const w = (Math.sin(2 * Math.PI * freq * t + phase) + 0.5 * Math.sin(4 * Math.PI * freq * t)) * 0.38 * env;
              b.writeInt16LE(Math.floor(Math.max(-0.95, Math.min(0.95, w)) * 32767), 44 + i * 2);
            }
            return b.toString('base64');
          }
          const app = express();
          app.use(express.json({ limit: '25mb' }));
          app.use('/api', apiRouter);
          const srv = http.createServer(app);
          await new Promise((r) => srv.listen(0, '127.0.0.1', r));
          const base = 'http://127.0.0.1:' + srv.address().port;
          const tok = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
          const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };

          const ch = await (await fetch(base + '/api/voices/clone/challenge', {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ voiceName: 'Batch Crash Voice' }),
          })).json();
          const enr = await (await fetch(base + '/api/voices/clone/verify-consent', {
            method: 'POST',
            headers: h,
            body: JSON.stringify({
              challenge: ch,
              voiceName: 'Batch Crash Voice',
              referenceAudioBase64: mkWavB64(4.0, 215, 0.0),
              consentAudioBase64: mkWavB64(4.2, 215, 0.08),
              gender: 'female',
              primaryLanguage: 'en',
            }),
          })).json();

          const j1 = await (await fetch(base + '/api/v1/tts/jobs', {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ text: 'Batch output one', voiceId: enr.voiceId, language: 'en' }),
          })).json();
          const j2 = await (await fetch(base + '/api/v1/tts/jobs', {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ text: 'Batch output two', voiceId: enr.voiceId, language: 'en' }),
          })).json();

          const m1 = memoryStore.privateMedia.find((m) => m.id === j1.outputMediaId);
          const m2 = memoryStore.privateMedia.find((m) => m.id === j2.outputMediaId);
          fs.writeFileSync(${JSON.stringify(handoffFile)}, JSON.stringify({
            pid: process.pid,
            voiceId: enr.voiceId,
            u1: j1.outputSignedUrl,
            u2: j2.outputSignedUrl,
            m1,
            m2,
          }));

          armBatchKill = true;
          await fetch(base + '/api/voices/clone/revoke-consent', {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ voiceId: enr.voiceId }),
          });
          `,
        ],
        {
          cwd: process.cwd(),
          env: buildIsolatedEnv(batchDir, revocationFile),
          encoding: 'utf8',
          timeout: 30000,
        }
      );

      assert.equal(batchKill.signal, 'SIGKILL');
      const b1 = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));

      // Fresh OS process verifies remaining voice artifacts are recovered cleanly and all URLs stay 403 (0 WAV bytes)
      const b2 = runFreshSubprocess(
        batchDir,
        revocationFile,
        `
        import fs from 'node:fs';
        import path from 'node:path';
        import http from 'node:http';
        import express from 'express';
        import { PrivateStorageService } from './server/storage/privateStorage.ts';
        import { memoryStore } from './server/db/index.ts';
        import { apiRouter } from './server/routes/api.ts';

        const dir = process.env.VOICEFORGE_STORAGE_DIR;
        PrivateStorageService.init();
        memoryStore.privateMedia.push(${JSON.stringify(b1.m1)}, ${JSON.stringify(b1.m2)});
        // If batch crashed before visiting m2, re-running idempotent voice invalidation + startup reconciliation sweeps all!
        await PrivateStorageService.invalidateByVoiceId({
          voiceId: ${JSON.stringify(b1.voiceId)},
          requestingUserId: 'usr_alice_user',
          isAdmin: false,
          reason: 'consent_revoked',
        });
        const rec = await PrivateStorageService.reconcilePendingDeletions();

        const app = express();
        app.use('/api', apiRouter);
        const srv = http.createServer(app);
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        const base = 'http://127.0.0.1:' + srv.address().port;

        const r1 = await fetch(base + ${JSON.stringify(b1.u1)});
        const r1Buf = Buffer.from(await r1.arrayBuffer());
        const r2 = await fetch(base + ${JSON.stringify(b1.u2)});
        const r2Buf = Buffer.from(await r2.arrayBuffer());
        await new Promise((r) => srv.close(() => r()));

        process.stdout.write('__S2G_JSON__' + JSON.stringify({
          pid: process.pid,
          rec,
          w1Exists: fs.existsSync(path.join(dir, ${JSON.stringify(b1.m1.storageKey)})),
          w2Exists: fs.existsSync(path.join(dir, ${JSON.stringify(b1.m2.storageKey)})),
          r1Status: r1.status,
          r1Base64: r1Buf.toString('base64'),
          r2Status: r2.status,
          r2Base64: r2Buf.toString('base64'),
        }));
        `
      );

      assert.notEqual(b2.pid, b1.pid);
      assert.equal(b2.w1Exists, false);
      assert.equal(b2.w2Exists, false);
      assert.equal(b2.r1Status, 403);
      assertZeroAudioAndNoLeakage(Buffer.from(b2.r1Base64, 'base64'), [batchDir]);
      assert.equal(b2.r2Status, 403);
      assertZeroAudioAndNoLeakage(Buffer.from(b2.r2Base64, 'base64'), [batchDir]);

      // Part 2: Verify GET /api/media/jobs and GET /api/media/jobs/:id also preserve completed dubbing job state across 0o500 fault
      const mediaDir = fs.mkdtempSync(path.join(suiteTmpRoot, 'obs03-mediajobs-'));
      PrivateStorageService.setProvider(new LocalStorageProvider(mediaDir));
      const mediaRec = await PrivateStorageService.storeMedia({
        userId: 'usr_alice_user',
        voiceId: 'vf_sarah_en',
        mediaType: 'tts_output',
        filename: 'dubbed_s2g.wav',
        buffer: createSyntheticWav(2.0, 240, 0),
      });
      const signedDubUrl = PrivateStorageService.generateSignedDownloadUrl(
        mediaRec.id,
        'usr_alice_user',
        900
      );
      const dubJobId = `trj_s2g_${Date.now()}`;
      memoryStore.transcriptionJobs.push({
        id: dubJobId,
        userId: 'usr_alice_user',
        filename: 'clip.wav',
        mode: 'dub',
        status: 'completed',
        dubVoiceId: 'vf_sarah_en',
        outputMediaId: mediaRec.id,
        outputSignedUrl: signedDubUrl,
        dubbedAudioUrl: signedDubUrl,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });

      const app = express();
      app.use(express.json());
      app.use('/api', apiRouter);
      const srv = http.createServer(app);
      await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${(srv.address() as any).port}`;
      const aliceHeaders = {
        Authorization: `Bearer ${AuthService.issueToken(PRELOADED_USERS.usr_alice_user)}`,
      };

      try {
        fs.chmodSync(mediaDir, 0o500);
        const listFault = await origFetch(`${base}/api/media/jobs`, { headers: aliceHeaders });
        assert.equal(listFault.status, 503);
        assertZeroAudioAndNoLeakage(Buffer.from(await listFault.arrayBuffer()), [mediaDir]);

        const detailFault = await origFetch(`${base}/api/media/jobs/${dubJobId}`, {
          headers: aliceHeaders,
        });
        assert.equal(detailFault.status, 503);
        assertZeroAudioAndNoLeakage(Buffer.from(await detailFault.arrayBuffer()), [mediaDir]);

        fs.chmodSync(mediaDir, 0o700);
        const detailRecovered = await origFetch(`${base}/api/media/jobs/${dubJobId}`, {
          headers: aliceHeaders,
        });
        assert.equal(detailRecovered.status, 200);
        const recoveredBody = await detailRecovered.json();
        assert.equal(recoveredBody.job.status, 'completed');
      } finally {
        await new Promise<void>((r) => srv.close(() => r()));
        restorePermissionsRecursively(mediaDir);
        fs.rmSync(mediaDir, { recursive: true, force: true });
      }
    } finally {
      restorePermissionsRecursively(batchDir);
      fs.rmSync(batchDir, { recursive: true, force: true });
      fs.rmSync(handoffFile, { force: true });
    }
  });
});
