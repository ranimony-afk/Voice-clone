/**
 * Phase 3C-S2I: Batch-Atomic Voice Revocation & Shared-Worker Fail-Closed Remediation Suite
 *
 * Adversarial regression tests proving remediation of finding S2H-NEW-01:
 *   1. S2I-01: Multi-artifact (3+) real OS SIGKILL crash during voice consent revocation and
 *      voice deletion — proves durable batch invalidation is established for ALL artifacts
 *      before item 1 physical deletion begins, pre-hydrated workers return 0 WAV bytes across
 *      signed URL / bearer HTTP / verifySignedUrl / getMedia, and a fresh OS process running
 *      ONLY init() + reconcilePendingDeletions() discovers and deletes every orphaned file.
 *   2. S2I-02: Stale sibling worker OS process without restart — proves two live workers sharing
 *      storage enforce voice revocation and deletion immediately across all media, synthesis,
 *      voice export, cross-lingual, speech-to-speech, dubbing, and job endpoints (0 WAV bytes),
 *      and fail closed (503) when the shared ledger is unreadable/corrupted.
 *   3. S2I-03: Failures before and during durable batch persistence — proves zero destructive
 *      provider.delete() calls occur on unreadable/unwritable ledgers, partial .tmp writes,
 *      corrupted state, or batch_tombstones persistence failure; proves post_cleanup persistence
 *      faults never report complete cleanup; and proves real OS SIGKILL between voice_barrier
 *      (Step 1A) and batch_tombstones (Step 1B) still denies all 3 artifacts and reconciles cleanly.
 *   4. S2I-04: Repeated multi-restart recovery, partial physical cleanup failure retention,
 *      idempotent retries, and unrelated voice / sibling tenant preservation.
 *   5. S2I-05: Existing security invariants (single-artifact pre-delete persistence gate in both
 *      initial and retry branches, job cancellation isolation, cross-tenant ownership, S2H
 *      non-mutating 503 job polling, signed URL tamper/expiry, and zero-byte audio denial).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { AuthService, PRELOADED_USERS } from '../../server/auth/auth.ts';

const REPO_ROOT = process.cwd();
const TEST_AUTH_SECRET = 'phase3c_s2i_auth_secret_key_0123456789abcdef';
const TEST_STORAGE_SECRET = 'phase3c_s2i_storage_secret_key_0123456789abcd';
const TEST_CONSENT_SECRET = 'phase3c_s2i_consent_secret_key_0123456789abcd';
const TEST_WATERMARK_KEY = 'phase3c_s2i_watermark_secret_key_0123456789ab';

const RIFF_MAGIC = Buffer.from('RIFF', 'ascii');
const WAVE_MAGIC = Buffer.from('WAVE', 'ascii');

function createSyntheticWav(
  durationSeconds: number = 4.0,
  baseFreqHz: number = 215,
  phaseOffset: number = 0.0
): Buffer {
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
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
    VOICEFORGE_STORAGE_PROVIDER: 'local',
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

function assertValidWavBytes(raw: Buffer, context: string): void {
  assert.ok(raw.length >= 44, `${context}: expected >= 44 WAV bytes, got ${raw.length}`);
  assert.equal(raw.subarray(0, 4).toString('ascii'), 'RIFF', `${context}: missing RIFF magic`);
  assert.equal(raw.subarray(8, 12).toString('ascii'), 'WAVE', `${context}: missing WAVE magic`);
}

function countWavPayloadBytes(raw: Buffer): number {
  if (
    raw.length >= 12 &&
    raw.subarray(0, 4).equals(RIFF_MAGIC) &&
    raw.subarray(8, 12).equals(WAVE_MAGIC)
  ) {
    return raw.length;
  }
  return 0;
}

function assertZeroAudioAndNoLeakage(
  raw: Buffer,
  forbiddenPaths: string[] = [],
  context = 'denied response'
): void {
  assert.equal(
    raw.includes(RIFF_MAGIC),
    false,
    `${context}: response must contain 0 RIFF audio header bytes`
  );
  assert.equal(
    raw.includes(WAVE_MAGIC),
    false,
    `${context}: response must contain 0 WAVE audio header bytes`
  );
  const text = raw.toString('utf8');
  assert.equal(text.includes('audioBase64'), false, `${context}: must not leak audioBase64`);
  assert.equal(text.includes('data:audio/'), false, `${context}: must not leak inline audio data URI`);
  assert.equal(
    text.includes(TEST_STORAGE_SECRET),
    false,
    `${context}: must not leak storage signing secret`
  );
  for (const fp of forbiddenPaths) {
    if (fp) {
      assert.equal(text.includes(fp), false, `${context}: must not leak internal path ${fp}`);
    }
  }
}

function restoreTreePermissionsRecursive(rootPath: string): void {
  if (!fs.existsSync(rootPath)) return;
  try {
    const st = fs.lstatSync(rootPath);
    if (st.isDirectory()) {
      fs.chmodSync(rootPath, 0o700);
      for (const child of fs.readdirSync(rootPath)) {
        restoreTreePermissionsRecursive(path.join(rootPath, child));
      }
    } else if (st.isFile()) {
      fs.chmodSync(rootPath, 0o600);
    }
  } catch {
    // Best-effort cleanup helper
  }
}

interface LiveWorkerHandle {
  proc: ChildProcess;
  pid: number;
  baseUrl: string;
  sendCommand: (cmd: Record<string, any>) => Promise<any>;
  shutdown: () => Promise<void>;
}

/**
 * Spawns a long-lived child OS worker running the real Express API router (`apiRouter`)
 * plus a JSON stdin/stdout RPC channel for hydrating state or executing direct
 * `PrivateStorageService` calls inside that separate OS process.
 */
async function spawnLiveApiWorker(params: {
  storageDir: string;
  revocationFile: string;
  label: string;
}): Promise<LiveWorkerHandle> {
  const workerScript = `
    import express from 'express';
    import readline from 'node:readline';
    import { apiRouter } from './server/routes/api.ts';
    import { PrivateStorageService } from './server/storage/privateStorage.ts';
    import { ConsentVerificationEngine } from './server/engine/audio/consent.ts';
    import { memoryStore } from './server/db/index.ts';

    PrivateStorageService.init();
    const app = express();
    app.use(express.json({ limit: '25mb' }));
    app.use('/api', apiRouter);

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;
    const baseUrl = 'http://127.0.0.1:' + port;

    process.stdout.write('__WORKER_READY__' + JSON.stringify({
      pid: process.pid,
      port,
      baseUrl,
    }) + '\\n');

    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on('line', async (line) => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const { reqId, action, payload } = msg;
      try {
        if (action === 'hydrate_snapshot') {
          for (const m of payload.privateMedia || []) {
            if (!memoryStore.privateMedia.some((pm) => pm.id === m.id)) {
              memoryStore.privateMedia.push(m);
            }
          }
          process.stdout.write('__WORKER_RPC__' + JSON.stringify({ reqId, ok: true }) + '\\n');
        } else if (action === 'enroll_hydrated_exact_voice') {
          const engineAny = ConsentVerificationEngine;
          if (engineAny.auditRecords && payload.auditRecord) {
            engineAny.auditRecords.set(payload.voiceId, { ...payload.auditRecord });
          }
          if (payload.voice && !memoryStore.customVoices.some((cv) => cv.id === payload.voice.id)) {
            memoryStore.customVoices.unshift(payload.voice);
          }
          if (payload.consentRecord && !memoryStore.consentRecords.some((r) => r.voiceId === payload.voiceId)) {
            memoryStore.consentRecords.push(payload.consentRecord);
          }
          for (const m of payload.privateMedia || []) {
            if (!memoryStore.privateMedia.some((pm) => pm.id === m.id)) {
              memoryStore.privateMedia.push(m);
            }
          }
          for (const j of payload.synthesisJobs || []) {
            if (!memoryStore.synthesisJobs.some((sj) => sj.id === j.id)) {
              memoryStore.synthesisJobs.unshift(j);
            }
          }
          for (const tj of payload.transcriptionJobs || []) {
            if (!memoryStore.transcriptionJobs.some((stj) => stj.id === tj.id)) {
              memoryStore.transcriptionJobs.unshift(tj);
            }
          }
          process.stdout.write('__WORKER_RPC__' + JSON.stringify({
            reqId,
            ok: true,
            consentActiveBeforeRevoke: ConsentVerificationEngine.isConsentActive(payload.voiceId),
            mediaCountInMemory: memoryStore.privateMedia.length,
          }) + '\\n');
        } else if (action === 'export_state') {
          const auditRecord = payload.voiceId ? ConsentVerificationEngine.getAuditRecord(payload.voiceId) : undefined;
          const voice = payload.voiceId ? memoryStore.customVoices.find((v) => v.id === payload.voiceId) : undefined;
          const consentRecord = payload.voiceId ? memoryStore.consentRecords.find((r) => r.voiceId === payload.voiceId) : undefined;
          const privateMedia = payload.voiceId
            ? memoryStore.privateMedia.filter((m) => m.voiceId === payload.voiceId)
            : memoryStore.privateMedia;
          const synthesisJobs = payload.voiceId
            ? memoryStore.synthesisJobs.filter((j) => j.voiceId === payload.voiceId)
            : memoryStore.synthesisJobs;
          const transcriptionJobs = payload.voiceId
            ? memoryStore.transcriptionJobs.filter((j) => j.dubbingVoiceId === payload.voiceId)
            : memoryStore.transcriptionJobs;
          process.stdout.write('__WORKER_RPC__' + JSON.stringify({
            reqId,
            ok: true,
            auditRecord,
            voice,
            consentRecord,
            privateMedia,
            synthesisJobs,
            transcriptionJobs,
          }) + '\\n');
        } else if (action === 'direct_storage_probe') {
          const { mediaId, userId, expires, sig } = payload;
          const verifyOk = PrivateStorageService.verifySignedUrl(mediaId, userId, expires, sig);
          let getMediaOutcome = 'unexpected_success';
          let getMediaBytes = 0;
          try {
            const res = await PrivateStorageService.getMedia(mediaId, userId);
            getMediaBytes = res.buffer.length;
          } catch (err) {
            getMediaOutcome = err.message || String(err);
          }
          let storeRejected = false;
          if (payload.testStoreForVoiceId) {
            try {
              await PrivateStorageService.storeMedia({
                userId,
                voiceId: payload.testStoreForVoiceId,
                mediaType: 'tts_output',
                filename: 'should_reject.wav',
                buffer: Buffer.from(payload.wavBase64, 'base64'),
              });
            } catch {
              storeRejected = true;
            }
          }
          process.stdout.write('__WORKER_RPC__' + JSON.stringify({
            reqId,
            ok: true,
            verifyOk,
            getMediaOutcome,
            getMediaBytes,
            storeRejected,
          }) + '\\n');
        } else if (action === 'shutdown') {
          await new Promise((r) => server.close(() => r()));
          process.stdout.write('__WORKER_RPC__' + JSON.stringify({ reqId, ok: true }) + '\\n');
          process.exit(0);
        }
      } catch (err) {
        process.stdout.write('__WORKER_RPC__' + JSON.stringify({
          reqId,
          ok: false,
          error: err?.message || String(err),
        }) + '\\n');
      }
    });
  `;

  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', workerScript],
    {
      cwd: REPO_ROOT,
      env: buildIsolatedEnv(params.storageDir, params.revocationFile),
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );

  const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  let readyResolve!: (info: any) => void;
  let readyReject!: (err: Error) => void;
  const readyPromise = new Promise<any>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  child.stderr!.on('data', (chunk) => {
    stderrBuf += chunk.toString('utf8');
  });
  child.stdout!.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    let nlIdx: number;
    while ((nlIdx = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nlIdx);
      stdoutBuf = stdoutBuf.slice(nlIdx + 1);
      if (line.startsWith('__WORKER_READY__')) {
        readyResolve(JSON.parse(line.slice('__WORKER_READY__'.length)));
      } else if (line.startsWith('__WORKER_RPC__')) {
        const parsed = JSON.parse(line.slice('__WORKER_RPC__'.length));
        const waiter = pending.get(parsed.reqId);
        if (waiter) {
          pending.delete(parsed.reqId);
          if (parsed.ok) waiter.resolve(parsed);
          else waiter.reject(new Error(parsed.error || 'Worker RPC failed'));
        }
      }
    }
  });

  child.on('exit', (code, signal) => {
    readyReject(
      new Error(
        `Worker ${params.label} exited prematurely (code=${code}, signal=${signal}): ${stderrBuf}`
      )
    );
    for (const [, waiter] of pending) {
      waiter.reject(new Error(`Worker ${params.label} exited`));
    }
    pending.clear();
  });

  const readyInfo = await readyPromise;
  let seq = 0;

  const sendCommand = (cmd: Record<string, any>): Promise<any> => {
    const reqId = `${params.label}_${++seq}`;
    return new Promise((resolve, reject) => {
      pending.set(reqId, { resolve, reject });
      child.stdin!.write(JSON.stringify({ reqId, ...cmd }) + '\n');
    });
  };

  const shutdown = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      await Promise.race([
        sendCommand({ action: 'shutdown' }),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    } catch {
      // Ignore shutdown race
    }
    if (child.exitCode === null && child.signalCode !== null) return;
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  };

  return {
    proc: child,
    pid: readyInfo.pid,
    baseUrl: readyInfo.baseUrl,
    sendCommand,
    shutdown,
  };
}

function parseSignedUrlQuery(signedUrl: string): {
  mediaId: string;
  uid: string;
  expires: number;
  sig: string;
} {
  const parsed = new URL(signedUrl, 'http://127.0.0.1');
  const parts = parsed.pathname.split('/');
  const mediaId = decodeURIComponent(parts[parts.length - 1]);
  return {
    mediaId,
    uid: parsed.searchParams.get('uid') || '',
    expires: parseInt(parsed.searchParams.get('expires') || '0', 10),
    sig: parsed.searchParams.get('sig') || '',
  };
}

async function enrollClonedVoiceHttp(
  baseUrl: string,
  token: string,
  voiceName: string,
  refWavB64: string,
  consentWavB64: string
): Promise<{ voiceId: string; voice: any }> {
  const chRes: Response = await fetch(`${baseUrl}/api/voices/clone/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ voiceName }),
  });
  assert.equal(chRes.status, 200, `Challenge for ${voiceName} must succeed`);
  const chJson: any = await chRes.json();

  const verRes: Response = await fetch(`${baseUrl}/api/voices/clone/verify-consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      challenge: chJson,
      voiceName,
      referenceAudioBase64: refWavB64,
      consentAudioBase64: consentWavB64,
      primaryLanguage: 'en',
      gender: 'female',
    }),
  });
  assert.equal(verRes.status, 200, `Enrollment for ${voiceName} must succeed`);
  return (await verRes.json()) as { voiceId: string; voice: any };
}

describe('Phase 3C-S2I: Batch-Atomic Voice Revocation & Shared-Worker Fail-Closed Suite', () => {
  let suiteTmpRoot = '';
  let refWavBase64 = '';
  let consentWavBase64 = '';
  let shortWavBase64 = '';
  let refWavB64File = '';
  let consentWavB64File = '';
  const savedEnv: Record<string, string | undefined> = {};

  before(() => {
    for (const k of [
      'NODE_ENV',
      'VOICEFORGE_AUTH_SECRET',
      'VOICEFORGE_STORAGE_SECRET',
      'VOICEFORGE_CONSENT_SECRET',
      'VOICEFORGE_WATERMARK_KEY',
    ]) {
      savedEnv[k] = process.env[k];
    }
    process.env.NODE_ENV = 'test';
    process.env.VOICEFORGE_AUTH_SECRET = TEST_AUTH_SECRET;
    process.env.VOICEFORGE_STORAGE_SECRET = TEST_STORAGE_SECRET;
    process.env.VOICEFORGE_CONSENT_SECRET = TEST_CONSENT_SECRET;
    process.env.VOICEFORGE_WATERMARK_KEY = TEST_WATERMARK_KEY;

    suiteTmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 's2i-suite-'));
    refWavBase64 = createSyntheticWav(4.0, 215, 0.0).toString('base64');
    consentWavBase64 = createSyntheticWav(4.2, 215, 0.08).toString('base64');
    shortWavBase64 = createSyntheticWav(0.4, 240, 0.0).toString('base64');
    refWavB64File = path.join(suiteTmpRoot, 'ref_wav.b64');
    consentWavB64File = path.join(suiteTmpRoot, 'consent_wav.b64');
    fs.writeFileSync(refWavB64File, refWavBase64);
    fs.writeFileSync(consentWavB64File, consentWavBase64);
  });

  after(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    restoreTreePermissionsRecursive(suiteTmpRoot);
    fs.rmSync(suiteTmpRoot, { recursive: true, force: true });
  });

  // ============================================================================
  // TEST 1: MULTI-ARTIFACT CRASH DURING VOICE REVOCATION (CORE S2H-NEW-01 PROOF)
  // ============================================================================
  test('S2I-01 (Test 1 — Multi-Artifact SIGKILL Crash During Voice Revocation & Deletion): 3-artifact batch persists durable invalidation before item 1 delete, denies pre-hydrated sibling worker (0 WAV bytes), and reconciles via fresh-process init()+reconcilePendingDeletions() alone', async () => {
    for (const mode of ['revoke_consent', 'delete_voice'] as const) {
      const storageDir = fs.mkdtempSync(path.join(suiteTmpRoot, `t1-${mode}-`));
      const revFile = path.join(suiteTmpRoot, `t1-${mode}-revoked.json`);
      const handoffFile = path.join(suiteTmpRoot, `t1-${mode}-handoff.json`);

      let preHydratedWorker: LiveWorkerHandle | null = null;
      try {
        preHydratedWorker = await spawnLiveApiWorker({
          storageDir,
          revocationFile: revFile,
          label: `t1_workerB_${mode}`,
        });

        const crashScript = `
          import fs from 'node:fs';
          import express from 'express';
          import { apiRouter } from './server/routes/api.ts';
          import { AuthService, PRELOADED_USERS } from './server/auth/auth.ts';
          import { PrivateStorageService } from './server/storage/privateStorage.ts';
          import { ConsentVerificationEngine } from './server/engine/audio/consent.ts';
          import { memoryStore } from './server/db/index.ts';

          const handoffFile = process.env.S2I_HANDOFF_FILE;
          const mode = process.env.S2I_MODE;
          const refWavB64 = fs.readFileSync(process.env.S2I_REF_WAV_FILE, 'utf8');
          const consentWavB64 = fs.readFileSync(process.env.S2I_CON_WAV_FILE, 'utf8');

          PrivateStorageService.init();
          const app = express();
          app.use(express.json({ limit: '25mb' }));
          app.use('/api', apiRouter);
          const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
          const base = 'http://127.0.0.1:' + srv.address().port;
          const aliceToken = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
          const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + aliceToken };

          const ch1 = await (await fetch(base + '/api/voices/clone/challenge', {
            method: 'POST', headers, body: JSON.stringify({ voiceName: 'TargetVoice_' + mode }),
          })).json();
          const enrTarget = await (await fetch(base + '/api/voices/clone/verify-consent', {
            method: 'POST', headers, body: JSON.stringify({
              challenge: ch1,
              voiceName: 'TargetVoice_' + mode,
              referenceAudioBase64: refWavB64,
              consentAudioBase64: consentWavB64,
              primaryLanguage: 'en',
              gender: 'female',
            }),
          })).json();

          const ch2 = await (await fetch(base + '/api/voices/clone/challenge', {
            method: 'POST', headers, body: JSON.stringify({ voiceName: 'SiblingKeep_' + mode }),
          })).json();
          const enrKeep = await (await fetch(base + '/api/voices/clone/verify-consent', {
            method: 'POST', headers, body: JSON.stringify({
              challenge: ch2,
              voiceName: 'SiblingKeep_' + mode,
              referenceAudioBase64: refWavB64,
              consentAudioBase64: consentWavB64,
              primaryLanguage: 'en',
              gender: 'female',
            }),
          })).json();

          const targetJobs = [];
          for (let i = 1; i <= 3; i++) {
            const j = await (await fetch(base + '/api/v1/tts/jobs', {
              method: 'POST', headers, body: JSON.stringify({
                text: 'Target voice batch artifact number ' + i,
                voiceId: enrTarget.voiceId,
                language: 'en',
              }),
            })).json();
            targetJobs.push(j);
          }

          const keepJob = await (await fetch(base + '/api/v1/tts/jobs', {
            method: 'POST', headers, body: JSON.stringify({
              text: 'Unrelated active sibling voice artifact',
              voiceId: enrKeep.voiceId,
              language: 'en',
            }),
          })).json();

          const targetMedia = targetJobs.map((j) =>
            memoryStore.privateMedia.find((m) => m.id === j.outputMediaId)
          );
          const keepMedia = memoryStore.privateMedia.find((m) => m.id === keepJob.outputMediaId);

          fs.writeFileSync(handoffFile, JSON.stringify({
            workerAPid: process.pid,
            aliceToken,
            targetVoiceId: enrTarget.voiceId,
            targetVoice: enrTarget.voice,
            targetAuditRecord: ConsentVerificationEngine.getAuditRecord(enrTarget.voiceId),
            targetConsentRecord: memoryStore.consentRecords.find((r) => r.voiceId === enrTarget.voiceId),
            targetJobs,
            targetMedia,
            keepVoiceId: enrKeep.voiceId,
            keepVoice: enrKeep.voice,
            keepAuditRecord: ConsentVerificationEngine.getAuditRecord(enrKeep.voiceId),
            keepConsentRecord: memoryStore.consentRecords.find((r) => r.voiceId === enrKeep.voiceId),
            keepJob,
            keepMedia,
            deleteCallCountBeforeKill: 0,
          }));

          const provider = PrivateStorageService.getProvider();
          const origDelete = provider.delete.bind(provider);
          let deleteCalls = 0;
          provider.delete = async (storageKey) => {
            deleteCalls++;
            const current = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));
            current.deleteCallCountBeforeKill = deleteCalls;
            current.killedAtStorageKey = storageKey;
            fs.writeFileSync(handoffFile, JSON.stringify(current));
            await origDelete(storageKey);
            process.kill(process.pid, 'SIGKILL');
            return true;
          };

          if (mode === 'revoke_consent') {
            await fetch(base + '/api/voices/clone/revoke-consent', {
              method: 'POST', headers, body: JSON.stringify({ voiceId: enrTarget.voiceId }),
            });
          } else {
            await fetch(base + '/api/v1/voices/' + enrTarget.voiceId, {
              method: 'DELETE', headers,
            });
          }
        `;

        const crashRun = spawnSync(
          process.execPath,
          ['--import', 'tsx', '--input-type=module', '-e', crashScript],
          {
            cwd: REPO_ROOT,
            env: buildIsolatedEnv(storageDir, revFile, {
              S2I_HANDOFF_FILE: handoffFile,
              S2I_MODE: mode,
              S2I_REF_WAV_FILE: refWavB64File,
              S2I_CON_WAV_FILE: consentWavB64File,
            }),
            encoding: 'utf8',
          }
        );

        assert.equal(
          crashRun.signal,
          'SIGKILL',
          `Worker A (${mode}) must terminate via real OS SIGKILL. stderr=${crashRun.stderr}`
        );
        const handoff: any = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));
        assert.equal(handoff.deleteCallCountBeforeKill, 1, 'SIGKILL must strike during item 1 physical delete');

        const workerB: LiveWorkerHandle = preHydratedWorker;

        // Pre-hydrate Worker B with the exact pre-revocation state (simulating a worker hydrated BEFORE revocation)
        await workerB.sendCommand({
          action: 'enroll_hydrated_exact_voice',
          payload: {
            voiceId: handoff.targetVoiceId,
            voice: handoff.targetVoice,
            auditRecord: handoff.targetAuditRecord,
            consentRecord: handoff.targetConsentRecord,
            privateMedia: [...handoff.targetMedia, handoff.keepMedia],
            synthesisJobs: [...handoff.targetJobs, handoff.keepJob],
          },
        });
        await workerB.sendCommand({
          action: 'enroll_hydrated_exact_voice',
          payload: {
            voiceId: handoff.keepVoiceId,
            voice: handoff.keepVoice,
            auditRecord: handoff.keepAuditRecord,
            consentRecord: handoff.keepConsentRecord,
            privateMedia: [],
            synthesisJobs: [],
          },
        });

        const diskPaths: string[] = handoff.targetMedia.map((m: any) =>
          path.join(storageDir, m.storageKey)
        );
        const presentOnDiskPostCrash = diskPaths.filter((p) => fs.existsSync(p));
        assert.equal(
          presentOnDiskPostCrash.length,
          2,
          'Items 2 and 3 must still physically exist on disk immediately after item-1 SIGKILL'
        );

        const ledgerPath = path.join(storageDir, '.invalidated_media.json');
        const ledgerPreReconcile: any = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
        const voiceInvEntry = (ledgerPreReconcile.invalidatedVoices || []).find(
          (v: any) => v.voiceId === handoff.targetVoiceId
        );
        assert.ok(voiceInvEntry, 'Durable voice-level invalidation record must exist on disk before item 1 delete');
        assert.equal(voiceInvEntry.reason, 'consent_revoked');

        const tombstonesForTarget = (ledgerPreReconcile.entries || []).filter(
          (e: any) => e.voiceId === handoff.targetVoiceId
        );
        assert.equal(
          tombstonesForTarget.length,
          3,
          'All 3 per-artifact tombstones must already be durably persisted on disk before item 1 delete'
        );
        for (const t of tombstonesForTarget) {
          assert.equal(t.cleanupFailed, true, `Tombstone ${t.id} must have cleanupFailed:true post-crash`);
          assert.equal(t.cleanupFailureCode, 'CLEANUP_PENDING');
          assert.ok(typeof t.storageKey === 'string' && t.storageKey.length > 0);
        }

        const workerBStatuses: number[] = [];
        let totalLeakedWavBytes = 0;

        for (let idx = 0; idx < 3; idx++) {
          const job = handoff.targetJobs[idx];
          const media = handoff.targetMedia[idx];
          const signedParts = parseSignedUrlQuery(job.outputSignedUrl);

          const directProbe: any = await workerB.sendCommand({
            action: 'direct_storage_probe',
            payload: {
              mediaId: media.id,
              userId: 'usr_alice_user',
              expires: signedParts.expires,
              sig: signedParts.sig,
              testStoreForVoiceId: idx === 0 ? handoff.targetVoiceId : undefined,
              wavBase64: shortWavBase64,
            },
          });
          assert.equal(directProbe.verifyOk, false, `Worker B verifySignedUrl must be false for artifact ${idx + 1}`);
          assert.equal(directProbe.getMediaBytes, 0, `Worker B getMedia must return 0 bytes for artifact ${idx + 1}`);
          assert.match(directProbe.getMediaOutcome, /invalidated/i);
          if (idx === 0) {
            assert.equal(directProbe.storeRejected, true, 'storeMedia for revoked voiceId must be rejected');
          }

          const dlSigned: Response = await fetch(`${workerB.baseUrl}${job.outputSignedUrl}`);
          const dlSignedBuf = Buffer.from(await dlSigned.arrayBuffer());
          workerBStatuses.push(dlSigned.status);
          totalLeakedWavBytes += countWavPayloadBytes(dlSignedBuf);
          assert.equal(dlSigned.status, 403, `Signed URL for artifact ${idx + 1} must return 403 on Worker B`);
          assertZeroAudioAndNoLeakage(dlSignedBuf, [storageDir], `Worker B signed URL artifact ${idx + 1}`);
          assert.equal(JSON.parse(dlSignedBuf.toString('utf8')).code, 'CONSENT_REVOKED');

          const dlBearer: Response = await fetch(
            `${workerB.baseUrl}/api/v1/media/download/${media.id}`,
            { headers: { Authorization: `Bearer ${handoff.aliceToken}` } }
          );
          const dlBearerBuf = Buffer.from(await dlBearer.arrayBuffer());
          totalLeakedWavBytes += countWavPayloadBytes(dlBearerBuf);
          assert.equal(dlBearer.status, 403, `Bearer download for artifact ${idx + 1} must return 403 on Worker B`);
          assertZeroAudioAndNoLeakage(dlBearerBuf, [storageDir], `Worker B bearer download artifact ${idx + 1}`);
        }

        const keepDl: Response = await fetch(`${workerB.baseUrl}${handoff.keepJob.outputSignedUrl}`);
        assert.equal(keepDl.status, 200, 'Unrelated active voice signed URL must remain 200');
        assertValidWavBytes(Buffer.from(await keepDl.arrayBuffer()), 'Unrelated active voice WAV');

        // Fresh OS recovery process (Worker C) running ONLY init() + reconcilePendingDeletions()
        const reconcileRun = spawnSync(
          process.execPath,
          [
            '--import',
            'tsx',
            '--input-type=module',
            '-e',
            `
            import { PrivateStorageService } from './server/storage/privateStorage.ts';
            PrivateStorageService.init();
            const result = await PrivateStorageService.reconcilePendingDeletions();
            process.stdout.write('__S2I_RECONCILE__' + JSON.stringify({
              recoveryPid: process.pid,
              result,
              ledgerHealthy: PrivateStorageService.isInvalidationLedgerHealthy(),
            }) + '\\n');
            `,
          ],
          {
            cwd: REPO_ROOT,
            env: buildIsolatedEnv(storageDir, revFile),
            encoding: 'utf8',
          }
        );
        assert.equal(reconcileRun.status, 0, `Fresh recovery process failed: ${reconcileRun.stderr}`);
        const recMarker = reconcileRun.stdout
          .split('\n')
          .find((l) => l.startsWith('__S2I_RECONCILE__'));
        assert.ok(recMarker, 'Expected __S2I_RECONCILE__ output');
        const recData: any = JSON.parse(recMarker!.slice('__S2I_RECONCILE__'.length));

        assert.equal(recData.result.attempted, 3, 'Recovery process must attempt all 3 pending tombstones');
        assert.equal(recData.result.resolved, 3, 'Recovery process must resolve all 3 pending tombstones');
        assert.equal(recData.result.stillFailing, 0, 'Zero tombstones may remain failing after reconciliation');

        for (const dp of diskPaths) {
          assert.equal(fs.existsSync(dp), false, `Orphaned WAV ${dp} must be physically deleted by recovery`);
        }
        const keepDiskPath = path.join(storageDir, handoff.keepMedia.storageKey);
        assert.equal(fs.existsSync(keepDiskPath), true, 'Unrelated active voice WAV must remain on disk');

        const ledgerPostReconcile: any = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
        const postTombstones = (ledgerPostReconcile.entries || []).filter(
          (e: any) => e.voiceId === handoff.targetVoiceId
        );
        assert.equal(postTombstones.length, 3);
        for (const pt of postTombstones) {
          assert.equal(pt.cleanupFailed, false, `Post-reconcile tombstone ${pt.id} must have cleanupFailed:false`);
          assert.equal('cleanupFailureCode' in pt, false);
        }
        const remainingCatalogIds: string[] = (ledgerPostReconcile.mediaCatalog || []).map((c: any) => c.id);
        for (const tm of handoff.targetMedia) {
          assert.equal(remainingCatalogIds.includes(tm.id), false, 'Cleaned artifact must be pruned from mediaCatalog');
        }
        assert.equal(
          remainingCatalogIds.includes(handoff.keepMedia.id),
          true,
          'Active voice artifact must remain in mediaCatalog'
        );

        console.log(
          `[S2I-EVIDENCE] Test1(${mode}): killedPid=${handoff.workerAPid} signal=${crashRun.signal} preHydratedPid=${workerB.pid} recoveryPid=${recData.recoveryPid} preReconcileTombstones=${tombstonesForTarget.length} postCrashFilesOnDisk=${presentOnDiskPostCrash.length} workerBStatuses=${JSON.stringify(workerBStatuses)} leakedWavBytes=${totalLeakedWavBytes} reconcile=${JSON.stringify(recData.result)} postReconcileFilesOnDisk=0`
        );
      } finally {
        if (preHydratedWorker) await preHydratedWorker.shutdown();
      }
    }
  });

  // ============================================================================
  // TEST 2: STALE SIBLING WORKER WITHOUT RESTART (MULTI-SURFACE + UNREADABLE LEDGER)
  // ============================================================================
  test('S2I-02 (Test 2 — Stale Sibling Worker Without Restart): Live sibling OS worker immediately blocks revoked/deleted voice across signed URL, bearer download, verifySignedUrl, getMedia, TTS, jobs, export, cross-lingual, speech-to-speech, and dubbing (0 WAV bytes), and fails closed (503) if ledger is unreadable', async () => {
    const storageDir = fs.mkdtempSync(path.join(suiteTmpRoot, 't2-sibling-'));
    const revFile = path.join(suiteTmpRoot, 't2-sibling-revoked.json');

    let workerAHandle: LiveWorkerHandle | null = null;
    let workerBHandle: LiveWorkerHandle | null = null;

    try {
      workerAHandle = await spawnLiveApiWorker({ storageDir, revocationFile: revFile, label: 't2_workerA' });
      workerBHandle = await spawnLiveApiWorker({ storageDir, revocationFile: revFile, label: 't2_workerB' });
      const workerA: LiveWorkerHandle = workerAHandle;
      const workerB: LiveWorkerHandle = workerBHandle;

      const aliceToken = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
      const bobToken = AuthService.issueToken(PRELOADED_USERS.usr_bob_user);
      const aliceHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      };
      const bobHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      };

      const aliceRevokeEnroll = await enrollClonedVoiceHttp(
        workerA.baseUrl,
        aliceToken,
        'Alice_Sibling_Revoke',
        refWavBase64,
        consentWavBase64
      );
      const aliceDeleteEnroll = await enrollClonedVoiceHttp(
        workerA.baseUrl,
        aliceToken,
        'Alice_Sibling_Delete',
        refWavBase64,
        consentWavBase64
      );
      const aliceHealthyEnroll = await enrollClonedVoiceHttp(
        workerA.baseUrl,
        aliceToken,
        'Alice_Sibling_Healthy',
        refWavBase64,
        consentWavBase64
      );
      const bobEnroll = await enrollClonedVoiceHttp(
        workerA.baseUrl,
        bobToken,
        'Bob_Sibling_Voice',
        refWavBase64,
        consentWavBase64
      );

      const revokeJobs: any[] = [];
      for (let i = 1; i <= 3; i++) {
        const jr: any = await (
          await fetch(`${workerA.baseUrl}/api/v1/tts/jobs`, {
            method: 'POST',
            headers: aliceHeaders,
            body: JSON.stringify({
              text: `Sibling worker test clip ${i}`,
              voiceId: aliceRevokeEnroll.voiceId,
              language: 'en',
            }),
          })
        ).json();
        revokeJobs.push(jr);
      }

      const deleteJobs: any[] = [];
      for (let i = 1; i <= 2; i++) {
        const jr: any = await (
          await fetch(`${workerA.baseUrl}/api/v1/tts/jobs`, {
            method: 'POST',
            headers: aliceHeaders,
            body: JSON.stringify({
              text: `Deleted voice clip ${i}`,
              voiceId: aliceDeleteEnroll.voiceId,
              language: 'en',
            }),
          })
        ).json();
        deleteJobs.push(jr);
      }

      const healthyJob: any = await (
        await fetch(`${workerA.baseUrl}/api/v1/tts/jobs`, {
          method: 'POST',
          headers: aliceHeaders,
          body: JSON.stringify({
            text: 'Healthy voice clip',
            voiceId: aliceHealthyEnroll.voiceId,
            language: 'en',
          }),
        })
      ).json();

      const bobJob: any = await (
        await fetch(`${workerA.baseUrl}/api/v1/tts/jobs`, {
          method: 'POST',
          headers: bobHeaders,
          body: JSON.stringify({
            text: 'Bob tenant voice clip',
            voiceId: bobEnroll.voiceId,
            language: 'en',
          }),
        })
      ).json();

      const dubCreateRes: Response = await fetch(`${workerA.baseUrl}/api/media/transcribe-translate`, {
        method: 'POST',
        headers: aliceHeaders,
        body: JSON.stringify({
          mediaBase64: shortWavBase64,
          mimeType: 'audio/wav',
          targetLanguage: 'ta',
          dubbingVoiceId: aliceRevokeEnroll.voiceId,
          synthesizeDub: true,
        }),
      });
      assert.equal(dubCreateRes.status, 200);
      const dubCreated: any = await dubCreateRes.json();
      const dubJobId = dubCreated.jobRecord.id as string;

      // Pre-hydrate live Worker B BEFORE any revocation/deletion on Worker A
      for (const vid of [
        aliceRevokeEnroll.voiceId,
        aliceDeleteEnroll.voiceId,
        aliceHealthyEnroll.voiceId,
        bobEnroll.voiceId,
      ]) {
        const snap: any = await workerA.sendCommand({ action: 'export_state', payload: { voiceId: vid } });
        await workerB.sendCommand({
          action: 'enroll_hydrated_exact_voice',
          payload: {
            voiceId: vid,
            voice: snap.voice,
            auditRecord: snap.auditRecord,
            consentRecord: snap.consentRecord,
            privateMedia: snap.privateMedia,
            synthesisJobs: snap.synthesisJobs,
            transcriptionJobs: snap.transcriptionJobs,
          },
        });
      }

      const preCheckRes: Response = await fetch(`${workerB.baseUrl}${revokeJobs[2].outputSignedUrl}`);
      assert.equal(preCheckRes.status, 200, 'Pre-revocation Worker B download must succeed');
      assertValidWavBytes(Buffer.from(await preCheckRes.arrayBuffer()), 'Pre-revocation Worker B WAV');

      // Revoke aliceRevokeEnroll and delete aliceDeleteEnroll ONLY on Worker A (Worker B is NOT restarted!)
      const revOnA: Response = await fetch(`${workerA.baseUrl}/api/voices/clone/revoke-consent`, {
        method: 'POST',
        headers: aliceHeaders,
        body: JSON.stringify({ voiceId: aliceRevokeEnroll.voiceId }),
      });
      assert.equal(revOnA.status, 200);
      const revJson: any = await revOnA.json();
      assert.equal(revJson.cleanupFailed, false);

      const delOnA: Response = await fetch(`${workerA.baseUrl}/api/voices/${aliceDeleteEnroll.voiceId}`, {
        method: 'DELETE',
        headers: aliceHeaders,
      });
      assert.equal(delOnA.status, 200);

      for (const rj of revokeJobs) {
        const sp = parseSignedUrlQuery(rj.outputSignedUrl);
        const dp: any = await workerB.sendCommand({
          action: 'direct_storage_probe',
          payload: {
            mediaId: rj.outputMediaId,
            userId: 'usr_alice_user',
            expires: sp.expires,
            sig: sp.sig,
          },
        });
        assert.equal(dp.verifyOk, false);
        assert.equal(dp.getMediaBytes, 0);

        const rSigned: Response = await fetch(`${workerB.baseUrl}${rj.outputSignedUrl}`);
        const bSigned = Buffer.from(await rSigned.arrayBuffer());
        assert.equal(rSigned.status, 403);
        assertZeroAudioAndNoLeakage(bSigned, [storageDir]);
        assert.equal(JSON.parse(bSigned.toString('utf8')).code, 'CONSENT_REVOKED');

        const rBearer: Response = await fetch(
          `${workerB.baseUrl}/api/v1/media/download/${rj.outputMediaId}`,
          { headers: aliceHeaders }
        );
        const bBearer = Buffer.from(await rBearer.arrayBuffer());
        assert.equal(rBearer.status, 403);
        assertZeroAudioAndNoLeakage(bBearer, [storageDir]);
      }

      for (const dj of deleteJobs) {
        const dSigned: Response = await fetch(`${workerB.baseUrl}${dj.outputSignedUrl}`);
        const bSigned = Buffer.from(await dSigned.arrayBuffer());
        assert.equal(dSigned.status, 403);
        assertZeroAudioAndNoLeakage(bSigned, [storageDir]);
      }

      const bSynth: Response = await fetch(`${workerB.baseUrl}/api/tts/synthesize`, {
        method: 'POST',
        headers: aliceHeaders,
        body: JSON.stringify({ text: 'Stale worker synth attempt', voiceId: aliceRevokeEnroll.voiceId }),
      });
      assert.equal(bSynth.status, 403);
      assertZeroAudioAndNoLeakage(Buffer.from(await bSynth.arrayBuffer()), [storageDir]);

      const bTtsJob: Response = await fetch(`${workerB.baseUrl}/api/v1/tts/jobs`, {
        method: 'POST',
        headers: aliceHeaders,
        body: JSON.stringify({ text: 'Stale worker job attempt', voiceId: aliceRevokeEnroll.voiceId }),
      });
      assert.equal(bTtsJob.status, 403);
      assertZeroAudioAndNoLeakage(Buffer.from(await bTtsJob.arrayBuffer()), [storageDir]);

      const bCross: Response = await fetch(`${workerB.baseUrl}/api/voices/cross-lingual-test`, {
        method: 'POST',
        headers: aliceHeaders,
        body: JSON.stringify({ voiceId: aliceRevokeEnroll.voiceId, language: 'en' }),
      });
      assert.equal(bCross.status, 403);
      assertZeroAudioAndNoLeakage(Buffer.from(await bCross.arrayBuffer()), [storageDir]);

      const bExport: Response = await fetch(
        `${workerB.baseUrl}/api/voices/${aliceRevokeEnroll.voiceId}/export`,
        { headers: aliceHeaders }
      );
      assert.equal(bExport.status, 403);

      const bSts: Response = await fetch(`${workerB.baseUrl}/api/speech-to-speech`, {
        method: 'POST',
        headers: aliceHeaders,
        body: JSON.stringify({ targetVoiceId: aliceRevokeEnroll.voiceId, audioBase64: shortWavBase64 }),
      });
      assert.equal(bSts.status, 403);
      assertZeroAudioAndNoLeakage(Buffer.from(await bSts.arrayBuffer()), [storageDir]);

      const bDub: Response = await fetch(`${workerB.baseUrl}/api/media/transcribe-translate`, {
        method: 'POST',
        headers: aliceHeaders,
        body: JSON.stringify({
          mediaBase64: shortWavBase64,
          mimeType: 'audio/wav',
          targetLanguage: 'ta',
          dubbingVoiceId: aliceRevokeEnroll.voiceId,
          synthesizeDub: true,
        }),
      });
      assert.equal(bDub.status, 403);
      assertZeroAudioAndNoLeakage(Buffer.from(await bDub.arrayBuffer()), [storageDir]);

      const bVoiceGet: Response = await fetch(
        `${workerB.baseUrl}/api/v1/voices/${aliceRevokeEnroll.voiceId}`,
        { headers: aliceHeaders }
      );
      assert.equal(bVoiceGet.status, 403);

      const bVoiceList: any = await (
        await fetch(`${workerB.baseUrl}/api/v1/voices`, { headers: aliceHeaders })
      ).json();
      assert.equal(
        bVoiceList.voices.some(
          (v: any) => v.id === aliceRevokeEnroll.voiceId || v.id === aliceDeleteEnroll.voiceId
        ),
        false,
        'Stale Worker B must omit revoked and deleted voices from GET /api/v1/voices'
      );

      for (const pathSuffix of [
        `/api/v1/tts/jobs/${revokeJobs[0].id}`,
        `/api/v1/jobs/${revokeJobs[0].id}`,
        `/api/media/jobs/${dubJobId}`,
      ]) {
        const jRes: Response = await fetch(`${workerB.baseUrl}${pathSuffix}`, { headers: aliceHeaders });
        const jBuf = Buffer.from(await jRes.arrayBuffer());
        assert.equal(jRes.status, 403, `Worker B ${pathSuffix} must return 403`);
        assertZeroAudioAndNoLeakage(jBuf, [storageDir], `Worker B ${pathSuffix}`);
      }

      const bobCheck: Response = await fetch(`${workerB.baseUrl}${bobJob.outputSignedUrl}`);
      assert.equal(bobCheck.status, 200, 'Bob media must remain 200 on Worker B');
      assertValidWavBytes(Buffer.from(await bobCheck.arrayBuffer()), 'Bob media WAV on Worker B');

      // Corrupt shared ledger and verify Worker B fails closed (503) across custom-voice & media routes
      const ledgerPath = path.join(storageDir, '.invalidated_media.json');
      const savedLedgerBytes = fs.readFileSync(ledgerPath);
      fs.writeFileSync(ledgerPath, '{ corrupt_shared_ledger_json');

      try {
        const probes: Array<() => Promise<Response>> = [
          () => fetch(`${workerB.baseUrl}${healthyJob.outputSignedUrl}`),
          () =>
            fetch(`${workerB.baseUrl}/api/tts/synthesize`, {
              method: 'POST',
              headers: aliceHeaders,
              body: JSON.stringify({ text: 'Corrupt ledger synth', voiceId: aliceHealthyEnroll.voiceId }),
            }),
          () =>
            fetch(`${workerB.baseUrl}/api/v1/tts/jobs`, {
              method: 'POST',
              headers: aliceHeaders,
              body: JSON.stringify({ text: 'Corrupt ledger job', voiceId: aliceHealthyEnroll.voiceId }),
            }),
          () =>
            fetch(`${workerB.baseUrl}/api/v1/voices/${aliceHealthyEnroll.voiceId}`, {
              headers: aliceHeaders,
            }),
          () =>
            fetch(`${workerB.baseUrl}/api/voices/${aliceHealthyEnroll.voiceId}/export`, {
              headers: aliceHeaders,
            }),
          () =>
            fetch(`${workerB.baseUrl}/api/speech-to-speech`, {
              method: 'POST',
              headers: aliceHeaders,
              body: JSON.stringify({
                targetVoiceId: aliceHealthyEnroll.voiceId,
                audioBase64: shortWavBase64,
              }),
            }),
          () =>
            fetch(`${workerB.baseUrl}/api/media/transcribe-translate`, {
              method: 'POST',
              headers: aliceHeaders,
              body: JSON.stringify({
                mediaBase64: shortWavBase64,
                mimeType: 'audio/wav',
                targetLanguage: 'ta',
                dubbingVoiceId: aliceHealthyEnroll.voiceId,
              }),
            }),
        ];
        for (const probe of probes) {
          const r: Response = await probe();
          const b = Buffer.from(await r.arrayBuffer());
          assert.equal(r.status, 503, 'Unreadable/corrupt shared ledger must fail closed with 503');
          assertZeroAudioAndNoLeakage(b, [storageDir], 'Corrupt ledger 503');
        }
      } finally {
        fs.writeFileSync(ledgerPath, savedLedgerBytes, { mode: 0o600 });
      }

      console.log(
        `[S2I-EVIDENCE] Test2: workerAPid=${workerA.pid} workerBPid=${workerB.pid} workerBRestarted=false revokedArtifactsDenied=3 deletedArtifactsDenied=2 dubbingJobDenied=1 corruptLedger503Probes=7 leakedWavBytes=0`
      );
    } finally {
      if (workerAHandle) await workerAHandle.shutdown();
      if (workerBHandle) await workerBHandle.shutdown();
    }
  });

  // ============================================================================
  // TEST 3: FAILURES BEFORE & DURING DURABLE BATCH PERSISTENCE (ALL 5 FAULT MODES)
  // ============================================================================
  test('S2I-03 (Test 3 — Pre-Delete Batch Persistence Faults & SIGKILL Between Voice Barrier and Batch Tombstones): Zero destructive deletes occur when batch persistence fails, post_cleanup fault never reports complete cleanup, and SIGKILL between Step 1A and Step 1B still denies all 3 artifacts and reconciles cleanly', async () => {
    const faultDir = fs.mkdtempSync(path.join(suiteTmpRoot, 't3-faults-'));
    const faultRevFile = path.join(suiteTmpRoot, 't3-faults-revoked.json');

    const subcaseScript = `
      import fs from 'node:fs';
      import path from 'node:path';
      import assert from 'node:assert/strict';
      import { PrivateStorageService, LocalStorageProvider } from './server/storage/privateStorage.ts';

      const baseDir = process.env.S2I_FAULT_BASE;
      const wavBuf = Buffer.from(process.env.S2I_WAV_B64, 'base64');

      async function seedVoiceBatch(subDir, voiceId) {
        process.env.VOICEFORGE_STORAGE_DIR = subDir;
        PrivateStorageService.setProvider(new LocalStorageProvider(subDir));
        PrivateStorageService.resetTombstonesForTesting();
        PrivateStorageService.init();
        const recs = [];
        for (let i = 1; i <= 3; i++) {
          recs.push(await PrivateStorageService.storeMedia({
            userId: 'usr_alice_user',
            voiceId,
            mediaType: 'tts_output',
            filename: 'clip_' + i + '.wav',
            buffer: wavBuf,
          }));
        }
        return recs;
      }

      const results = {};

      // 3A: Unwritable ledger + WAL (0o400 files + 0o500 root dir) -> 0 provider.delete() calls
      {
        const dir3a = path.join(baseDir, '3a');
        const recs = await seedVoiceBatch(dir3a, 'voice_3a');
        let deleteCalls = 0;
        const prov = PrivateStorageService.getProvider();
        const origDel = prov.delete.bind(prov);
        prov.delete = async (k) => { deleteCalls++; return origDel(k); };

        fs.chmodSync(path.join(dir3a, '.invalidated_media.json'), 0o400);
        fs.chmodSync(path.join(dir3a, '.invalidated_media.json.wal'), 0o400);
        fs.chmodSync(dir3a, 0o500);

        const outcomes = await PrivateStorageService.invalidateByVoiceId({
          voiceId: 'voice_3a',
          requestingUserId: 'usr_alice_user',
          reason: 'consent_revoked',
        });
        assert.equal(deleteCalls, 0, '3A: provider.delete must NOT be called when unwritable');
        assert.equal(outcomes.length, 3);
        for (const o of outcomes) {
          assert.equal(o.durableInvalidationEstablished, false);
          assert.equal(o.cleanupFailed, true);
          assert.equal(o.deletedFromProvider, false);
          assert.equal(PrivateStorageService.isMediaInvalidated(o.mediaId), true);
        }
        for (const r of recs) {
          assert.equal(fs.existsSync(path.join(dir3a, r.storageKey)), true, '3A: physical files untouched');
        }
        fs.chmodSync(dir3a, 0o700);
        fs.chmodSync(path.join(dir3a, '.invalidated_media.json'), 0o600);
        fs.chmodSync(path.join(dir3a, '.invalidated_media.json.wal'), 0o600);
        results.case3A = { deleteCalls, outcomesCount: outcomes.length, durable: false };
      }

      // 3B: Simulated partial .tmp write / failed fsync during batch_tombstones (+ read-only WAL)
      {
        const dir3b = path.join(baseDir, '3b');
        await seedVoiceBatch(dir3b, 'voice_3b');
        let deleteCalls = 0;
        const prov = PrivateStorageService.getProvider();
        const origDel = prov.delete.bind(prov);
        prov.delete = async (k) => { deleteCalls++; return origDel(k); };

        fs.chmodSync(path.join(dir3b, '.invalidated_media.json.wal'), 0o400);
        PrivateStorageService.setPersistenceHookForTesting((stage, tmpPath) => {
          if (stage === 'batch_tombstones') {
            fs.writeFileSync(tmpPath, '{"version":1,"entries":[{"id":"partial_trunc');
            throw Object.assign(new Error('Simulated EIO on fsync before rename'), { code: 'EIO' });
          }
        });

        const outcomes = await PrivateStorageService.invalidateByVoiceId({
          voiceId: 'voice_3b',
          requestingUserId: 'usr_alice_user',
          reason: 'consent_revoked',
        });
        PrivateStorageService.setPersistenceHookForTesting(null);

        assert.equal(deleteCalls, 0, '3B: zero destructive deletes when batch_tombstones write fails');
        for (const o of outcomes) {
          assert.equal(o.durableInvalidationEstablished, false);
          assert.equal(o.cleanupFailed, true);
        }
        const snapJson = JSON.parse(fs.readFileSync(path.join(dir3b, '.invalidated_media.json'), 'utf8'));
        assert.equal(snapJson.version, 1);
        fs.chmodSync(path.join(dir3b, '.invalidated_media.json.wal'), 0o600);
        results.case3B = { deleteCalls, snapshotIntact: true };
      }

      // 3C: Corrupted tombstone ledger on disk -> zero deletes, fail-closed
      {
        const dir3c = path.join(baseDir, '3c');
        await seedVoiceBatch(dir3c, 'voice_3c');
        let deleteCalls = 0;
        const prov = PrivateStorageService.getProvider();
        const origDel = prov.delete.bind(prov);
        prov.delete = async (k) => { deleteCalls++; return origDel(k); };

        fs.writeFileSync(path.join(dir3c, '.invalidated_media.json'), '{ corrupted_ledger_payload');
        const outcomes = await PrivateStorageService.invalidateByVoiceId({
          voiceId: 'voice_3c',
          requestingUserId: 'usr_alice_user',
          reason: 'consent_revoked',
        });
        assert.equal(deleteCalls, 0, '3C: zero destructive deletes when ledger is corrupted');
        assert.equal(PrivateStorageService.isInvalidationLedgerHealthy(), false);
        for (const o of outcomes) {
          assert.equal(o.durableInvalidationEstablished, false);
          assert.equal(o.cleanupFailed, true);
        }
        results.case3C = { deleteCalls, ledgerHealthy: false };
      }

      // 3D: Failure during post_cleanup persistence -> must NEVER report cleanupFailed:false!
      {
        const dir3d = path.join(baseDir, '3d');
        await seedVoiceBatch(dir3d, 'voice_3d');
        fs.chmodSync(path.join(dir3d, '.invalidated_media.json.wal'), 0o400);
        PrivateStorageService.setPersistenceHookForTesting((stage) => {
          if (stage === 'post_cleanup') {
            throw Object.assign(new Error('Simulated post_cleanup fsync failure'), { code: 'EIO' });
          }
        });
        const outcomes = await PrivateStorageService.invalidateByVoiceId({
          voiceId: 'voice_3d',
          requestingUserId: 'usr_alice_user',
          reason: 'consent_revoked',
        });
        PrivateStorageService.setPersistenceHookForTesting(null);
        fs.chmodSync(path.join(dir3d, '.invalidated_media.json.wal'), 0o600);

        for (const o of outcomes) {
          assert.equal(o.durableInvalidationEstablished, false, '3D: post_cleanup fault must report durable=false');
          assert.equal(o.cleanupFailed, true, '3D: post_cleanup fault must NEVER report complete cleanup');
        }
        results.case3D = { allCleanupFailedTrue: outcomes.every((o) => o.cleanupFailed === true) };
      }

      process.stdout.write('__S2I_T3_SUB__' + JSON.stringify(results) + '\\n');
    `;

    const subRun = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', subcaseScript],
      {
        cwd: REPO_ROOT,
        env: buildIsolatedEnv(faultDir, faultRevFile, {
          S2I_FAULT_BASE: faultDir,
          S2I_WAV_B64: shortWavBase64,
        }),
        encoding: 'utf8',
      }
    );
    assert.equal(subRun.status, 0, `Test 3 subcases 3A-3D failed: ${subRun.stderr}`);
    const subResults: any = JSON.parse(
      subRun.stdout
        .split('\n')
        .find((l) => l.startsWith('__S2I_T3_SUB__'))!
        .slice('__S2I_T3_SUB__'.length)
    );

    // Subcase 3E: Real OS SIGKILL BETWEEN Step 1A (voice_barrier) and Step 1B (batch_tombstones)!
    const dir3e = fs.mkdtempSync(path.join(suiteTmpRoot, 't3e-between-'));
    const handoff3e = path.join(suiteTmpRoot, 't3e-handoff.json');

    const kill3eRun = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
        import fs from 'node:fs';
        import { PrivateStorageService } from './server/storage/privateStorage.ts';

        const wavBuf = Buffer.from(process.env.S2I_WAV_B64, 'base64');
        PrivateStorageService.init();
        const recs = [];
        const urls = [];
        for (let i = 1; i <= 3; i++) {
          const r = await PrivateStorageService.storeMedia({
            userId: 'usr_alice_user',
            voiceId: 'voice_between_1a_1b',
            mediaType: 'tts_output',
            filename: 'between_' + i + '.wav',
            buffer: wavBuf,
          });
          recs.push(r);
          urls.push(PrivateStorageService.generateSignedDownloadUrl(r.id, 'usr_alice_user'));
        }
        fs.writeFileSync(process.env.S2I_HANDOFF_3E, JSON.stringify({
          pid: process.pid,
          recs,
          urls,
        }));

        PrivateStorageService.setPersistenceHookForTesting((stage) => {
          if (stage === 'batch_tombstones') {
            process.kill(process.pid, 'SIGKILL');
          }
        });

        await PrivateStorageService.invalidateByVoiceId({
          voiceId: 'voice_between_1a_1b',
          requestingUserId: 'usr_alice_user',
          reason: 'consent_revoked',
        });
        `,
      ],
      {
        cwd: REPO_ROOT,
        env: buildIsolatedEnv(dir3e, faultRevFile, {
          S2I_HANDOFF_3E: handoff3e,
          S2I_WAV_B64: shortWavBase64,
        }),
        encoding: 'utf8',
      }
    );

    assert.equal(kill3eRun.signal, 'SIGKILL', '3E must terminate via real SIGKILL between Step 1A and Step 1B');
    const h3e: any = JSON.parse(fs.readFileSync(handoff3e, 'utf8'));

    for (const r of h3e.recs) {
      assert.equal(fs.existsSync(path.join(dir3e, r.storageKey)), true);
    }

    const freshWorker3e = await spawnLiveApiWorker({
      storageDir: dir3e,
      revocationFile: faultRevFile,
      label: 't3e_fresh_worker',
    });
    try {
      for (let i = 0; i < 3; i++) {
        const res: Response = await fetch(`${freshWorker3e.baseUrl}${h3e.urls[i]}`);
        const buf = Buffer.from(await res.arrayBuffer());
        assert.equal(res.status, 403, `3E artifact ${i + 1} must be 403 even before per-artifact tombstones`);
        assertZeroAudioAndNoLeakage(buf, [dir3e]);
        assert.equal(JSON.parse(buf.toString('utf8')).code, 'CONSENT_REVOKED');
      }
    } finally {
      await freshWorker3e.shutdown();
    }

    const rec3e = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
        import { PrivateStorageService } from './server/storage/privateStorage.ts';
        PrivateStorageService.init();
        const r = await PrivateStorageService.reconcilePendingDeletions();
        process.stdout.write('__S2I_3E_REC__' + JSON.stringify({ pid: process.pid, r }) + '\\n');
        `,
      ],
      {
        cwd: REPO_ROOT,
        env: buildIsolatedEnv(dir3e, faultRevFile),
        encoding: 'utf8',
      }
    );
    assert.equal(rec3e.status, 0, rec3e.stderr);
    const rec3eJson: any = JSON.parse(
      rec3e.stdout
        .split('\n')
        .find((l) => l.startsWith('__S2I_3E_REC__'))!
        .slice('__S2I_3E_REC__'.length)
    );
    assert.equal(rec3eJson.r.attempted, 3);
    assert.equal(rec3eJson.r.resolved, 3);
    assert.equal(rec3eJson.r.stillFailing, 0);
    for (const r of h3e.recs) {
      assert.equal(fs.existsSync(path.join(dir3e, r.storageKey)), false, '3E orphan must be deleted by recovery');
    }

    console.log(
      `[S2I-EVIDENCE] Test3: subcases=${JSON.stringify(subResults)} case3EKilledPid=${h3e.pid} case3ERecoveryPid=${rec3eJson.pid} case3EReconcile=${JSON.stringify(rec3eJson.r)}`
    );
  });

  // ============================================================================
  // TEST 4: REPEATED RESTART RECOVERY, IDEMPOTENCY & TENANT PRESERVATION
  // ============================================================================
  test('S2I-04 (Test 4 — Repeated Restart Recovery, Partial Physical Failure, Idempotency & Multi-Tenant Preservation): Partial physical failure retains cleanupFailed:true across restart 1, resolves on restart 2, stays idempotent on restart 3, and preserves unrelated voices/tenants', async () => {
    const storageDir = fs.mkdtempSync(path.join(suiteTmpRoot, 't4-recovery-'));
    const revFile = path.join(suiteTmpRoot, 't4-recovery-revoked.json');
    const handoffFile = path.join(suiteTmpRoot, 't4-handoff.json');

    const seedCrash = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
        import fs from 'node:fs';
        import express from 'express';
        import { apiRouter } from './server/routes/api.ts';
        import { AuthService, PRELOADED_USERS } from './server/auth/auth.ts';
        import { PrivateStorageService } from './server/storage/privateStorage.ts';
        import { ConsentVerificationEngine } from './server/engine/audio/consent.ts';
        import { memoryStore } from './server/db/index.ts';

        const refWavB64 = fs.readFileSync(process.env.S2I_REF_WAV_FILE, 'utf8');
        const conWavB64 = fs.readFileSync(process.env.S2I_CON_WAV_FILE, 'utf8');
        PrivateStorageService.init();
        const app = express();
        app.use(express.json({ limit: '25mb' }));
        app.use('/api', apiRouter);
        const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
        const base = 'http://127.0.0.1:' + srv.address().port;

        const aliceToken = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
        const bobToken = AuthService.issueToken(PRELOADED_USERS.usr_bob_user);
        const ah = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + aliceToken };
        const bh = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bobToken };

        async function cloneVoice(h, name) {
          const ch = await (await fetch(base + '/api/voices/clone/challenge', {
            method: 'POST', headers: h, body: JSON.stringify({ voiceName: name }),
          })).json();
          return await (await fetch(base + '/api/voices/clone/verify-consent', {
            method: 'POST', headers: h, body: JSON.stringify({
              challenge: ch, voiceName: name,
              referenceAudioBase64: refWavB64, consentAudioBase64: conWavB64,
              primaryLanguage: 'en', gender: 'female',
            }),
          })).json();
        }

        const vRevoke = await cloneVoice(ah, 'AliceRevoke4');
        const vKeep = await cloneVoice(ah, 'AliceKeep2');
        const vBob = await cloneVoice(bh, 'BobKeep2');

        const revokeJobs = [];
        for (let i = 1; i <= 4; i++) {
          revokeJobs.push(await (await fetch(base + '/api/v1/tts/jobs', {
            method: 'POST', headers: ah, body: JSON.stringify({ text: 'Revoke clip ' + i, voiceId: vRevoke.voiceId }),
          })).json());
        }
        const aliceKeepJobs = [];
        for (let i = 1; i <= 2; i++) {
          aliceKeepJobs.push(await (await fetch(base + '/api/v1/tts/jobs', {
            method: 'POST', headers: ah, body: JSON.stringify({ text: 'Alice keep ' + i, voiceId: vKeep.voiceId }),
          })).json());
        }
        const bobKeepJobs = [];
        for (let i = 1; i <= 2; i++) {
          bobKeepJobs.push(await (await fetch(base + '/api/v1/tts/jobs', {
            method: 'POST', headers: bh, body: JSON.stringify({ text: 'Bob keep ' + i, voiceId: vBob.voiceId }),
          })).json());
        }

        fs.writeFileSync(process.env.S2I_T4_HANDOFF, JSON.stringify({
          crashPid: process.pid,
          aliceToken,
          bobToken,
          revokeVoiceId: vRevoke.voiceId,
          revokeMedia: revokeJobs.map((j) => memoryStore.privateMedia.find((m) => m.id === j.outputMediaId)),
          revokeUrls: revokeJobs.map((j) => j.outputSignedUrl),
          aliceKeepVoice: vKeep.voice,
          aliceKeepAudit: ConsentVerificationEngine.getAuditRecord(vKeep.voiceId),
          aliceKeepMedia: aliceKeepJobs.map((j) => memoryStore.privateMedia.find((m) => m.id === j.outputMediaId)),
          aliceKeepUrls: aliceKeepJobs.map((j) => j.outputSignedUrl),
          bobKeepVoice: vBob.voice,
          bobKeepAudit: ConsentVerificationEngine.getAuditRecord(vBob.voiceId),
          bobKeepMedia: bobKeepJobs.map((j) => memoryStore.privateMedia.find((m) => m.id === j.outputMediaId)),
          bobKeepUrls: bobKeepJobs.map((j) => j.outputSignedUrl),
        }));

        const prov = PrivateStorageService.getProvider();
        const origDel = prov.delete.bind(prov);
        prov.delete = async (k) => {
          await origDel(k);
          process.kill(process.pid, 'SIGKILL');
          return true;
        };

        await fetch(base + '/api/voices/clone/revoke-consent', {
          method: 'POST', headers: ah, body: JSON.stringify({ voiceId: vRevoke.voiceId }),
        });
        `,
      ],
      {
        cwd: REPO_ROOT,
        env: buildIsolatedEnv(storageDir, revFile, {
          S2I_T4_HANDOFF: handoffFile,
          S2I_REF_WAV_FILE: refWavB64File,
          S2I_CON_WAV_FILE: consentWavB64File,
        }),
        encoding: 'utf8',
      }
    );
    assert.equal(seedCrash.signal, 'SIGKILL', seedCrash.stderr);
    const h4: any = JSON.parse(fs.readFileSync(handoffFile, 'utf8'));

    // Restart 1: Simulate transient physical delete failure ONLY on artifact #3
    const r1 = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
        import { PrivateStorageService } from './server/storage/privateStorage.ts';
        PrivateStorageService.init();
        const blockedKey = process.env.S2I_BLOCKED_KEY;
        const prov = PrivateStorageService.getProvider();
        const origDel = prov.delete.bind(prov);
        prov.delete = async (k) => {
          if (k === blockedKey) return false;
          return origDel(k);
        };
        const res = await PrivateStorageService.reconcilePendingDeletions();
        const rec3 = PrivateStorageService.getInvalidationRecord(process.env.S2I_BLOCKED_ID);
        process.stdout.write('__S2I_R1__' + JSON.stringify({ pid: process.pid, res, rec3 }) + '\\n');
        `,
      ],
      {
        cwd: REPO_ROOT,
        env: buildIsolatedEnv(storageDir, revFile, {
          S2I_BLOCKED_KEY: h4.revokeMedia[2].storageKey,
          S2I_BLOCKED_ID: h4.revokeMedia[2].id,
        }),
        encoding: 'utf8',
      }
    );
    assert.equal(r1.status, 0, r1.stderr);
    const r1Data: any = JSON.parse(
      r1.stdout
        .split('\n')
        .find((l) => l.startsWith('__S2I_R1__'))!
        .slice('__S2I_R1__'.length)
    );
    assert.equal(r1Data.res.attempted, 4);
    assert.equal(r1Data.res.resolved, 3, 'Items 1, 2, 4 must resolve on Restart 1');
    assert.equal(r1Data.res.stillFailing, 1, 'Item 3 must remain failing on Restart 1');
    assert.equal(r1Data.rec3.cleanupFailed, true, 'Item 3 must NEVER report false cleanup completion');
    assert.equal(fs.existsSync(path.join(storageDir, h4.revokeMedia[2].storageKey)), true);

    // Restart 2: Unblocked reconciliation finishes deleting item 3
    const r2 = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
        import { PrivateStorageService } from './server/storage/privateStorage.ts';
        PrivateStorageService.init();
        const res = await PrivateStorageService.reconcilePendingDeletions();
        const repeatRes = await PrivateStorageService.reconcilePendingDeletions();
        process.stdout.write('__S2I_R2__' + JSON.stringify({ pid: process.pid, res, repeatRes }) + '\\n');
        `,
      ],
      {
        cwd: REPO_ROOT,
        env: buildIsolatedEnv(storageDir, revFile),
        encoding: 'utf8',
      }
    );
    assert.equal(r2.status, 0, r2.stderr);
    const r2Data: any = JSON.parse(
      r2.stdout
        .split('\n')
        .find((l) => l.startsWith('__S2I_R2__'))!
        .slice('__S2I_R2__'.length)
    );
    assert.equal(r2Data.res.attempted, 1);
    assert.equal(r2Data.res.resolved, 1);
    assert.equal(r2Data.res.stillFailing, 0);
    assert.equal(r2Data.repeatRes.attempted, 0);
    assert.equal(r2Data.repeatRes.resolved, 0);
    assert.equal(r2Data.repeatRes.stillFailing, 0);
    for (const rm of h4.revokeMedia) {
      assert.equal(fs.existsSync(path.join(storageDir, rm.storageKey)), false);
    }

    // Restart 3: Verify HTTP idempotent retry + cross-tenant denial + sibling preservation
    const workerR3 = await spawnLiveApiWorker({
      storageDir,
      revocationFile: revFile,
      label: 't4_workerR3',
    });
    try {
      await workerR3.sendCommand({
        action: 'enroll_hydrated_exact_voice',
        payload: {
          voiceId: h4.aliceKeepVoice.id,
          voice: h4.aliceKeepVoice,
          auditRecord: h4.aliceKeepAudit,
          privateMedia: h4.aliceKeepMedia,
          synthesisJobs: [],
        },
      });
      await workerR3.sendCommand({
        action: 'enroll_hydrated_exact_voice',
        payload: {
          voiceId: h4.bobKeepVoice.id,
          voice: h4.bobKeepVoice,
          auditRecord: h4.bobKeepAudit,
          privateMedia: h4.bobKeepMedia,
          synthesisJobs: [],
        },
      });

      const aliceRetryRev: Response = await fetch(`${workerR3.baseUrl}/api/voices/clone/revoke-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${h4.aliceToken}` },
        body: JSON.stringify({ voiceId: h4.revokeVoiceId }),
      });
      assert.equal(aliceRetryRev.status, 200);
      const aliceRetryJson: any = await aliceRetryRev.json();
      assert.equal(aliceRetryJson.success, true);
      assert.equal(aliceRetryJson.cleanupFailed, false);

      const bobRetryRev: Response = await fetch(`${workerR3.baseUrl}/api/voices/clone/revoke-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${h4.bobToken}` },
        body: JSON.stringify({ voiceId: h4.revokeVoiceId }),
      });
      assert.equal(bobRetryRev.status, 403);

      for (const u of h4.revokeUrls) {
        const res: Response = await fetch(`${workerR3.baseUrl}${u}`);
        const buf = Buffer.from(await res.arrayBuffer());
        assert.equal(res.status, 403);
        assertZeroAudioAndNoLeakage(buf, [storageDir]);
      }

      for (const km of [...h4.aliceKeepMedia, ...h4.bobKeepMedia]) {
        assert.equal(fs.existsSync(path.join(storageDir, km.storageKey)), true);
      }
      for (const u of [...h4.aliceKeepUrls, ...h4.bobKeepUrls]) {
        const res: Response = await fetch(`${workerR3.baseUrl}${u}`);
        assert.equal(res.status, 200);
        assertValidWavBytes(Buffer.from(await res.arrayBuffer()), 'Preserved voice WAV');
      }
    } finally {
      await workerR3.shutdown();
    }

    console.log(
      `[S2I-EVIDENCE] Test4: crashPid=${h4.crashPid} r1Pid=${r1Data.pid} r1=${JSON.stringify(r1Data.res)} r2Pid=${r2Data.pid} r2=${JSON.stringify(r2Data.res)} r3Pid=${workerR3.pid} preservedArtifacts=4`
    );
  });

  // ============================================================================
  // TEST 5: EXISTING SECURITY & DURABILITY REGRESSIONS (S2D/S2E/S2F/S2G/S2H)
  // ============================================================================
  test('S2I-05 (Test 5 — Existing Security & Durability Invariants): Single-artifact pre-delete persistence gate (initial & retry), job cancellation isolation, cross-tenant ownership, S2H non-mutating 503 job polling, and HMAC tamper/expiry', async () => {
    const storageDir = fs.mkdtempSync(path.join(suiteTmpRoot, 't5-regressions-'));
    const revFile = path.join(suiteTmpRoot, 't5-regressions-revoked.json');

    const worker = await spawnLiveApiWorker({
      storageDir,
      revocationFile: revFile,
      label: 't5_worker',
    });

    try {
      const aliceToken = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
      const bobToken = AuthService.issueToken(PRELOADED_USERS.usr_bob_user);
      const ah = { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` };
      const bh = { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` };

      const enr = await enrollClonedVoiceHttp(
        worker.baseUrl,
        aliceToken,
        'Alice_S2I_Regress',
        refWavBase64,
        consentWavBase64
      );

      const jobKeep: any = await (
        await fetch(`${worker.baseUrl}/api/v1/tts/jobs`, {
          method: 'POST',
          headers: ah,
          body: JSON.stringify({ text: 'Job to keep active', voiceId: enr.voiceId, language: 'en' }),
        })
      ).json();
      const jobCancel: any = await (
        await fetch(`${worker.baseUrl}/api/v1/tts/jobs`, {
          method: 'POST',
          headers: ah,
          body: JSON.stringify({ text: 'Job to cancel individually', voiceId: enr.voiceId, language: 'en' }),
        })
      ).json();

      assert.equal(
        (await fetch(`${worker.baseUrl}/api/v1/jobs/${jobCancel.id}/cancel`, { method: 'POST' })).status,
        401
      );
      assert.equal(
        (await fetch(`${worker.baseUrl}/api/v1/jobs/${jobCancel.id}/cancel`, { method: 'POST', headers: bh })).status,
        403
      );
      assert.equal(
        (await fetch(`${worker.baseUrl}/api/v1/tts/jobs/${jobKeep.id}`, { headers: bh })).status,
        403
      );

      const cancelRes: Response = await fetch(`${worker.baseUrl}/api/v1/jobs/${jobCancel.id}/cancel`, {
        method: 'POST',
        headers: ah,
      });
      assert.equal(cancelRes.status, 200);

      const dlCancelled: Response = await fetch(`${worker.baseUrl}${jobCancel.outputSignedUrl}`);
      const dlCancelledBuf = Buffer.from(await dlCancelled.arrayBuffer());
      assert.equal(dlCancelled.status, 403);
      assertZeroAudioAndNoLeakage(dlCancelledBuf, [storageDir]);
      assert.equal(JSON.parse(dlCancelledBuf.toString('utf8')).code, 'MEDIA_ARTIFACT_INVALIDATED');

      const dlKeep: Response = await fetch(`${worker.baseUrl}${jobKeep.outputSignedUrl}`);
      assert.equal(dlKeep.status, 200);
      assertValidWavBytes(Buffer.from(await dlKeep.arrayBuffer()), 'Kept job WAV');

      const tamperedUrl = jobKeep.outputSignedUrl.replace(/sig=[0-9a-f]{4}/, 'sig=ffff');
      const dlTampered: Response = await fetch(`${worker.baseUrl}${tamperedUrl}`);
      assert.equal(dlTampered.status, 403);
      assertZeroAudioAndNoLeakage(Buffer.from(await dlTampered.arrayBuffer()), [storageDir]);

      // S2H non-mutating fail-closed job polling during transient ledger fault
      const ledgerPath = path.join(storageDir, '.invalidated_media.json');
      const savedLedger = fs.readFileSync(ledgerPath);
      fs.writeFileSync(ledgerPath, '{ transient_corrupt_ledger');
      try {
        for (const p of ['/api/v1/tts/jobs', `/api/v1/tts/jobs/${jobKeep.id}`, `/api/v1/jobs/${jobKeep.id}`]) {
          const pollRes: Response = await fetch(`${worker.baseUrl}${p}`, { headers: ah });
          assert.equal(pollRes.status, 503);
          assertZeroAudioAndNoLeakage(Buffer.from(await pollRes.arrayBuffer()), [storageDir]);
        }
      } finally {
        fs.writeFileSync(ledgerPath, savedLedger, { mode: 0o600 });
      }

      const jobKeepAfter: any = await (
        await fetch(`${worker.baseUrl}/api/v1/tts/jobs/${jobKeep.id}`, { headers: ah })
      ).json();
      assert.equal(jobKeepAfter.job.status, 'completed');

      // Single-artifact invalidateAndDeleteMedia gates provider.delete() on persistence in BOTH initial and retry branches
      const singleGateDir = fs.mkdtempSync(path.join(suiteTmpRoot, 't5-single-gate-'));
      const singleGateRun = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `
          import fs from 'node:fs';
          import path from 'node:path';
          import assert from 'node:assert/strict';
          import { PrivateStorageService, LocalStorageProvider } from './server/storage/privateStorage.ts';

          const dir = process.env.VOICEFORGE_STORAGE_DIR;
          const wav = Buffer.from(process.env.S2I_WAV_B64, 'base64');
          PrivateStorageService.setProvider(new LocalStorageProvider(dir));
          PrivateStorageService.resetTombstonesForTesting();
          PrivateStorageService.init();

          const rec = await PrivateStorageService.storeMedia({
            userId: 'usr_alice_user',
            mediaType: 'tts_output',
            filename: 'single_gate.wav',
            buffer: wav,
          });

          let deleteCalls = 0;
          const prov = PrivateStorageService.getProvider();
          const origDel = prov.delete.bind(prov);
          prov.delete = async (k) => { deleteCalls++; return origDel(k); };

          fs.chmodSync(path.join(dir, '.invalidated_media.json'), 0o400);
          fs.chmodSync(path.join(dir, '.invalidated_media.json.wal'), 0o400);
          fs.chmodSync(dir, 0o500);

          const out1 = await PrivateStorageService.invalidateAndDeleteMedia({
            mediaId: rec.id,
            requestingUserId: 'usr_alice_user',
            reason: 'job_cancelled',
          });
          assert.equal(deleteCalls, 0, 'Initial branch must NOT call provider.delete when persistence fails');
          assert.equal(out1.durableInvalidationEstablished, false);
          assert.equal(out1.cleanupFailed, true);

          const out2 = await PrivateStorageService.invalidateAndDeleteMedia({
            mediaId: rec.id,
            requestingUserId: 'usr_alice_user',
            reason: 'job_cancelled',
          });
          assert.equal(deleteCalls, 0, 'Retry branch must NOT call provider.delete when persistence fails');
          assert.equal(out2.durableInvalidationEstablished, false);

          fs.chmodSync(dir, 0o700);
          fs.chmodSync(path.join(dir, '.invalidated_media.json'), 0o600);
          fs.chmodSync(path.join(dir, '.invalidated_media.json.wal'), 0o600);

          const out3 = await PrivateStorageService.invalidateAndDeleteMedia({
            mediaId: rec.id,
            requestingUserId: 'usr_alice_user',
            reason: 'job_cancelled',
          });
          assert.equal(out3.durableInvalidationEstablished, true);
          assert.equal(out3.cleanupFailed, false);
          assert.ok(deleteCalls >= 1);
          assert.equal(fs.existsSync(path.join(dir, rec.storageKey)), false);
          process.stdout.write('__S2I_SINGLE_OK__\\n');
          `,
        ],
        {
          cwd: REPO_ROOT,
          env: buildIsolatedEnv(singleGateDir, revFile, { S2I_WAV_B64: shortWavBase64 }),
          encoding: 'utf8',
        }
      );
      assert.equal(singleGateRun.status, 0, singleGateRun.stderr);
      assert.ok(singleGateRun.stdout.includes('__S2I_SINGLE_OK__'));

      console.log(
        `[S2I-EVIDENCE] Test5: workerPid=${worker.pid} singleGateVerified=true cancelIsolationVerified=true s2hNonMutating503Verified=true`
      );
    } finally {
      await worker.shutdown();
    }
  });
});
