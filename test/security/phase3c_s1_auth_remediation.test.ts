/**
 * VoiceForge Phase 3C-S1 — Critical Authentication & Authorization Remediation Suite
 *
 * Exercises the real Express application router and middleware over an in-process
 * HTTP server bound exclusively to 127.0.0.1 on an ephemeral port using synthetic fixtures.
 *
 * Covers all 12 mandatory adversarial criteria:
 *  1. Anonymous requests cannot mint a token for usr_admin_root.
 *  2. Anonymous requests cannot mint tokens by supplying an existing user's ID or email.
 *  3. Caller-supplied admin or creator roles cannot create or elevate principals.
 *  4. Unknown user IDs and forged/stale JWT claims cannot hydrate or elevate principals.
 *  5. Token issuance fails closed in both production and staging (including empty-body & demo requests),
 *     and environment resolution never degrades staging or unknown NODE_ENV into development.
 *  6. Anonymous and cross-tenant consent-revocation and voice-deletion requests cannot impersonate admin or owner.
 *  7. Cross-tenant and anonymous requests cannot read private voices, obtain another user's job audio, or cancel another user's jobs.
 *  8. Privileged audit and administrative migration routes reject anonymous and non-admin users.
 *  9. Invalid, malformed, missing-exp, expired, forged, and revoked tokens are rejected across requireAuth and optionalAuth routes.
 * 10. Valid server-authenticated principals retain legitimate tenant-scoped access and authorized admin paths work.
 * 11. Development-only sandbox behavior is unavailable outside explicit development mode and cannot grant elevated privileges.
 * 12. Failed requests perform zero mutations on user, voice, consent, job, or revocation state.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import http from 'node:http';
import { apiRouter } from '../../server/routes/api.ts';
import {
  AuthService,
  DEV_SANDBOX_USER,
  DurableRevocationStore,
  PRELOADED_USERS,
} from '../../server/auth/auth.ts';
import {
  isDevelopmentEnvironment,
  isRestrictedEnvironment,
  parseEnv,
  resolveRuntimeEnvironment,
} from '../../server/config/env.ts';
import { ConsentVerificationEngine } from '../../server/engine/audio/consent.ts';
import { memoryStore } from '../../server/db/index.ts';
import { globalStore } from '../../server/middleware/rateLimiter.ts';

function signCustomJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  secret: string
): string {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

function createSyntheticWav(durationSeconds: number, freq: number = 330): Buffer {
  const sampleRate = 24000;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const pcm = new Int16Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = Math.min(1.0, t * 2.0) * Math.min(1.0, (durationSeconds - t) * 2.0);
    const val =
      Math.sin(2 * Math.PI * freq * t) * 0.4 + Math.sin(2 * Math.PI * (freq * 1.5) * t) * 0.2;
    pcm[i] = Math.floor(val * env * 26000);
  }

  const dataSize = pcm.length * 2;
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
  for (let i = 0; i < pcm.length; i++) {
    buffer.writeInt16LE(pcm[i], 44 + i * 2);
  }
  return buffer;
}

describe('Phase 3C-S1: Critical Authentication & Authorization Remediation Suite', () => {
  let server: http.Server;
  let baseUrl: string;
  let tempDir: string;
  let origRevocationFile: string | undefined;
  let origNodeEnv: string | undefined;
  let origAuthSecret: string | undefined;
  let origDevDemoFlag: string | undefined;

  let aliceToken: string;
  let bobToken: string;
  let creatorToken: string;
  let adminToken: string;

  let aliceEnrolledVoiceId: string;
  let aliceCompletedJobId: string;

  before(async () => {
    origRevocationFile = process.env.VOICEFORGE_REVOCATION_FILE;
    origNodeEnv = process.env.NODE_ENV;
    origAuthSecret = process.env.VOICEFORGE_AUTH_SECRET;
    origDevDemoFlag = process.env.VOICEFORGE_ENABLE_DEV_DEMO_AUTH;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf_phase3c_s1_'));
    process.env.VOICEFORGE_REVOCATION_FILE = path.join(tempDir, 'revoked_tokens.json');
    process.env.NODE_ENV = 'test';
    process.env.VOICEFORGE_AUTH_SECRET = 'test_phase3c_s1_authoritative_secret_key_99a1b2c3d4';
    delete process.env.VOICEFORGE_ENABLE_DEV_DEMO_AUTH;

    AuthService.resetUserStoreForTesting();
    DurableRevocationStore.resetForTesting();

    aliceToken = AuthService.issueToken(PRELOADED_USERS.usr_alice_user);
    bobToken = AuthService.issueToken(PRELOADED_USERS.usr_bob_user);
    creatorToken = AuthService.issueToken(PRELOADED_USERS.usr_default_creator);
    adminToken = AuthService.issueToken(PRELOADED_USERS.usr_admin_root);

    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use('/api', apiRouter);

    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // Enroll a genuine private biometric voice and synthesis job owned by Alice for isolation tests
    const chalRes = await fetch(`${baseUrl}/api/voices/clone/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ voiceName: 'Alice S1 Vault Voice' }),
    });
    assert.equal(chalRes.status, 200);
    const challenge = await chalRes.json();

    const wavRef = createSyntheticWav(4.0, 315);
    const wavCon = createSyntheticWav(4.0, 319);
    const enrollRes = await fetch(`${baseUrl}/api/voices/clone/verify-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        challenge,
        voiceName: 'Alice S1 Vault Voice',
        referenceAudioBase64: wavRef.toString('base64'),
        consentAudioBase64: wavCon.toString('base64'),
      }),
    });
    assert.equal(enrollRes.status, 200);
    const enrollData = await enrollRes.json();
    aliceEnrolledVoiceId = enrollData.voiceId;
    assert.ok(aliceEnrolledVoiceId);

    const jobRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        text: 'Confidential speech synthesis belonging strictly to Alice.',
        voiceId: aliceEnrolledVoiceId,
        language: 'en',
        idempotencyKey: 'idem_shared_probe_01',
      }),
    });
    assert.equal(jobRes.status, 202);
    const jobData = await jobRes.json();
    aliceCompletedJobId = jobData.jobId;
    assert.ok(aliceCompletedJobId);
  });

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.VOICEFORGE_AUTH_SECRET = 'test_phase3c_s1_authoritative_secret_key_99a1b2c3d4';
    delete process.env.VOICEFORGE_ENABLE_DEV_DEMO_AUTH;
    AuthService.resetUserStoreForTesting();
    globalStore.resetForTesting();
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

    DurableRevocationStore.resetForTesting();
    AuthService.resetUserStoreForTesting();

    if (origRevocationFile !== undefined) process.env.VOICEFORGE_REVOCATION_FILE = origRevocationFile;
    else delete process.env.VOICEFORGE_REVOCATION_FILE;

    if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
    else delete process.env.NODE_ENV;

    if (origAuthSecret !== undefined) process.env.VOICEFORGE_AUTH_SECRET = origAuthSecret;
    else delete process.env.VOICEFORGE_AUTH_SECRET;

    if (origDevDemoFlag !== undefined) process.env.VOICEFORGE_ENABLE_DEV_DEMO_AUTH = origDevDemoFlag;
    else delete process.env.VOICEFORGE_ENABLE_DEV_DEMO_AUTH;

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================================================
  // 1. ANONYMOUS ADMIN MINTING BLOCKED
  // ==========================================================================
  test('1. ADVERSARIAL: Anonymous request cannot mint a token for usr_admin_root', async () => {
    const userCountBefore = AuthService.getUserCount();

    const res = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'usr_admin_root' }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'FORBIDDEN_IDENTITY_CLAIM');
    assert.equal(body.token, undefined, 'Rejected response must never include a token');
    assert.equal(AuthService.getUserCount(), userCountBefore);

    // Confirm audit endpoint remains inaccessible without legitimate admin token
    const auditProbe = await fetch(`${baseUrl}/api/v1/audit/events`, {
      headers: { Authorization: `Bearer ${body.token || ''}` },
    });
    assert.equal(auditProbe.status, 401);
  });

  // ==========================================================================
  // 2. EXISTING USER IMPERSONATION BY ID OR EMAIL BLOCKED
  // ==========================================================================
  test('2. ADVERSARIAL: Anonymous requests cannot mint tokens by supplying existing userId or email', async () => {
    const attempts = [
      { userId: 'usr_alice_user' },
      { userId: 'usr_bob_user' },
      { userId: 'usr_default_creator' },
      { email: 'alice@voiceforge.ai' },
      { email: 'bob@voiceforge.ai' },
      { email: 'creator@voiceforge.ai' },
      { email: 'security-admin@voiceforge.ai' },
    ];

    const userCountBefore = AuthService.getUserCount();

    for (const payload of attempts) {
      const res = await fetch(`${baseUrl}/api/v1/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(res.status, 403, `Expected 403 for payload ${JSON.stringify(payload)}`);
      const body = await res.json();
      assert.equal(body.code, 'FORBIDDEN_IDENTITY_CLAIM');
      assert.equal(body.token, undefined);
    }

    assert.equal(AuthService.getUserCount(), userCountBefore);
    assert.equal(AuthService.getUserById('usr_alice_user')?.role, 'user');
    assert.equal(AuthService.getUserById('usr_default_creator')?.role, 'creator');
  });

  // ==========================================================================
  // 3. CALLER-SUPPLIED ROLE ESCALATION BLOCKED
  // ==========================================================================
  test('3. ADVERSARIAL: Caller-supplied admin or creator roles cannot create or elevate principals', async () => {
    const rolePayloads = [
      { role: 'admin' },
      { role: 'creator' },
      { userId: 'usr_attacker_new', role: 'admin', name: 'Attacker Root' },
      { userId: 'usr_attacker_creator', role: 'creator' },
      { userId: 'usr_alice_user', role: 'admin' },
      { email: 'attacker@evil.example', role: 'admin' },
    ];

    const userCountBefore = AuthService.getUserCount();

    for (const payload of rolePayloads) {
      const res = await fetch(`${baseUrl}/api/v1/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.code, 'FORBIDDEN_IDENTITY_CLAIM');
      assert.equal(body.token, undefined);
    }

    assert.equal(AuthService.getUserCount(), userCountBefore);
    assert.equal(AuthService.getUserById('usr_attacker_new'), undefined);
    assert.equal(AuthService.getUserById('usr_attacker_creator'), undefined);
    assert.equal(AuthService.getUserById('usr_alice_user')?.role, 'user');
  });

  // ==========================================================================
  // 4. UNKNOWN SUBJECT HYDRATION & STALE/TAMPERED ROLE CLAIMS BLOCKED
  // ==========================================================================
  test('4. ADVERSARIAL: Unknown signed subjects are not hydrated and JWT role claims cannot elevate stored principals', async () => {
    const secret = AuthService.getAuthSecret();
    const now = Math.floor(Date.now() / 1000);
    const userCountBefore = AuthService.getUserCount();

    // Case A: Cryptographically valid signature for an unregistered subject claiming role: 'admin'
    const unknownAdminToken = signCustomJwt(
      { alg: 'HS256', typ: 'JWT' },
      {
        sub: 'usr_unregistered_phantom',
        email: 'phantom@voiceforge.local',
        role: 'admin',
        name: 'Phantom Admin',
        iat: now,
        exp: now + 3600,
      },
      secret
    );

    assert.equal(AuthService.verifyToken(unknownAdminToken), null);
    assert.equal(AuthService.getUserById('usr_unregistered_phantom'), undefined);
    assert.equal(AuthService.getUserCount(), userCountBefore);

    const meGhostRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${unknownAdminToken}` },
    });
    assert.equal(meGhostRes.status, 401);

    const auditGhostRes = await fetch(`${baseUrl}/api/v1/audit/events`, {
      headers: { Authorization: `Bearer ${unknownAdminToken}` },
    });
    assert.equal(auditGhostRes.status, 401);
    assert.equal(AuthService.getUserCount(), userCountBefore);

    // Case B: Valid signature for registered 'usr_alice_user' (stored role='user') with JWT payload claiming role='admin'
    const elevatedClaimToken = signCustomJwt(
      { alg: 'HS256', typ: 'JWT' },
      {
        sub: 'usr_alice_user',
        email: 'security-admin@voiceforge.ai',
        role: 'admin',
        name: 'Spoofed Admin Alice',
        iat: now,
        exp: now + 3600,
      },
      secret
    );

    const verifiedAlice = AuthService.verifyToken(elevatedClaimToken);
    assert.ok(verifiedAlice);
    assert.equal(verifiedAlice.id, 'usr_alice_user');
    assert.equal(verifiedAlice.role, 'user', 'Authoritative store role must override JWT role claim');
    assert.equal(verifiedAlice.email, 'alice@voiceforge.ai');

    const auditAliceClaimRes = await fetch(`${baseUrl}/api/v1/audit/events`, {
      headers: { Authorization: `Bearer ${elevatedClaimToken}` },
    });
    assert.equal(auditAliceClaimRes.status, 403);
    const auditErr = await auditAliceClaimRes.json();
    assert.equal(auditErr.code, 'FORBIDDEN_ROLE');
  });

  // ==========================================================================
  // 5. STAGING & PRODUCTION FAIL-CLOSED + ENVIRONMENT VALIDATION
  // ==========================================================================
  test('5. ADVERSARIAL: Token issuance fails closed in staging and production and env parsing never degrades staging to development', async () => {
    // Verify environment parser preserves staging and fails closed on unknown values
    assert.equal(resolveRuntimeEnvironment('staging'), 'staging');
    assert.equal(resolveRuntimeEnvironment('production'), 'production');
    assert.equal(resolveRuntimeEnvironment('prod-cluster'), 'production');
    assert.equal(resolveRuntimeEnvironment(''), 'production');
    assert.equal(isDevelopmentEnvironment('staging'), false);
    assert.equal(isDevelopmentEnvironment('prod-cluster'), false);
    assert.equal(isRestrictedEnvironment('staging'), true);
    assert.equal(isRestrictedEnvironment('production'), true);
    assert.equal(isRestrictedEnvironment('unknown_env'), true);

    const parsedStaging = parseEnv({ NODE_ENV: 'staging' } as NodeJS.ProcessEnv);
    assert.equal(parsedStaging.NODE_ENV, 'staging');

    // Missing VOICEFORGE_AUTH_SECRET fails closed in BOTH staging and production
    for (const envName of ['staging', 'production'] as const) {
      process.env.NODE_ENV = envName;
      delete process.env.VOICEFORGE_AUTH_SECRET;
      assert.throws(
        () => AuthService.getAuthSecret(),
        /FATAL SECURITY CONFIGURATION.*VOICEFORGE_AUTH_SECRET/i
      );
    }

    // Even when VOICEFORGE_AUTH_SECRET AND VOICEFORGE_ENABLE_DEV_DEMO_AUTH=true are set,
    // staging and production reject empty-body, sandbox, and demo-identity token requests
    process.env.VOICEFORGE_AUTH_SECRET = 'test_phase3c_s1_authoritative_secret_key_99a1b2c3d4';
    process.env.VOICEFORGE_ENABLE_DEV_DEMO_AUTH = 'true';

    for (const envName of ['staging', 'production', 'staging-eu'] as const) {
      process.env.NODE_ENV = envName;
      const payloads = [
        {},
        { bootstrap: 'dev_sandbox' },
        { userId: 'usr_default_creator' },
        { userId: DEV_SANDBOX_USER.id },
        { userId: 'usr_admin_root' },
      ];

      for (const bodyPayload of payloads) {
        const res = await fetch(`${baseUrl}/api/v1/auth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyPayload),
        });
        assert.ok(
          res.status === 401 || res.status === 403,
          `Expected 401/403 in ${envName} for ${JSON.stringify(bodyPayload)}, got ${res.status}`
        );
        const data = await res.json();
        assert.equal(data.token, undefined);
      }
    }
  });

  // ==========================================================================
  // 6. BODY-BASED IDENTITY & ADMIN SPOOFING ON CONSENT REVOCATION & VOICE DELETION
  // ==========================================================================
  test('6. ADVERSARIAL: Anonymous and cross-tenant consent revocation and voice deletion cannot impersonate admin or owner', async () => {
    // Anonymous revoke-consent attempts with spoofed body userId
    for (const spoofedUserId of ['usr_admin_root', 'admin', 'usr_alice_user']) {
      const res = await fetch(`${baseUrl}/api/voices/clone/revoke-consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId: aliceEnrolledVoiceId, userId: spoofedUserId }),
      });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.code, 'AUTH_REQUIRED');
    }

    // Authenticated Bob attempting body userId spoofing as usr_admin_root or usr_alice_user
    for (const spoofedUserId of ['usr_admin_root', 'admin', 'usr_alice_user']) {
      const res = await fetch(`${baseUrl}/api/voices/clone/revoke-consent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bobToken}`,
        },
        body: JSON.stringify({ voiceId: aliceEnrolledVoiceId, userId: spoofedUserId }),
      });
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.code, 'FORBIDDEN_NOT_OWNER');
    }

    // Anonymous and cross-tenant voice deletion on BOTH /api/voices/:id and /api/v1/voices/:id
    for (const endpoint of [
      `/api/voices/${aliceEnrolledVoiceId}`,
      `/api/v1/voices/${aliceEnrolledVoiceId}`,
    ]) {
      const anonDel = await fetch(`${baseUrl}${endpoint}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'usr_admin_root' }),
      });
      assert.equal(anonDel.status, 401);

      const bobDel = await fetch(`${baseUrl}${endpoint}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bobToken}`,
        },
        body: JSON.stringify({ userId: 'usr_admin_root' }),
      });
      assert.equal(bobDel.status, 403);
    }

    // Premade system voice cannot be deleted or consent-revoked by non-admin user
    const bobPremadeRevoke = await fetch(`${baseUrl}/api/voices/clone/revoke-consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({ voiceId: 'vf_sarah_en', userId: 'usr_admin_root' }),
    });
    assert.equal(bobPremadeRevoke.status, 403);
    assert.equal(ConsentVerificationEngine.isConsentActive('vf_sarah_en'), true);

    const bobPremadeDelete = await fetch(`${baseUrl}/api/v1/voices/vf_sarah_en`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert.equal(bobPremadeDelete.status, 403);

    // Verify Alice's voice and consent were NOT mutated
    assert.equal(ConsentVerificationEngine.isConsentActive(aliceEnrolledVoiceId), true);
    const aliceVoiceCheck = await fetch(`${baseUrl}/api/v1/voices/${aliceEnrolledVoiceId}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(aliceVoiceCheck.status, 200);
  });

  // ==========================================================================
  // 7. CROSS-TENANT PRIVATE VOICE, JOB AUDIO, AND JOB CANCELLATION ISOLATION
  // ==========================================================================
  test("7. ADVERSARIAL: Anonymous and cross-tenant callers cannot read private voices, steal job audio, or cancel another user's jobs", async () => {
    // A. Private voice hidden from anonymous and Bob in both /api/voices and /api/v1/voices
    for (const listPath of ['/api/voices', '/api/v1/voices']) {
      const anonList = await (await fetch(`${baseUrl}${listPath}`)).json();
      assert.equal(
        anonList.voices.some((v: any) => v.id === aliceEnrolledVoiceId),
        false,
        `Anonymous ${listPath} must not expose Alice's private voice`
      );

      const bobList = await (
        await fetch(`${baseUrl}${listPath}`, { headers: { Authorization: `Bearer ${bobToken}` } })
      ).json();
      assert.equal(
        bobList.voices.some((v: any) => v.id === aliceEnrolledVoiceId),
        false,
        `Bob ${listPath} must not expose Alice's private voice`
      );
    }

    // B. Direct private voice retrieval & model export blocked
    const anonVoiceGet = await fetch(`${baseUrl}/api/v1/voices/${aliceEnrolledVoiceId}`);
    assert.equal(anonVoiceGet.status, 401);

    const bobVoiceGet = await fetch(`${baseUrl}/api/v1/voices/${aliceEnrolledVoiceId}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert.equal(bobVoiceGet.status, 403);

    const anonExport = await fetch(`${baseUrl}/api/voices/${aliceEnrolledVoiceId}/export`);
    assert.equal(anonExport.status, 401);

    const bobExport = await fetch(`${baseUrl}/api/voices/${aliceEnrolledVoiceId}/export`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert.equal(bobExport.status, 403);

    // C. Anonymous synthesis with Alice's private voice is rejected with 401 (closing optionalAuth bypass)
    const anonSynthPrivate = await fetch(`${baseUrl}/api/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Unauthorized synthesis probe', voiceId: aliceEnrolledVoiceId }),
    });
    assert.equal(anonSynthPrivate.status, 401);

    // D. Job retrieval (/api/v1/jobs/:id and /api/v1/tts/jobs/:id) rejects anonymous & Bob without leaking audioBase64
    for (const jobPath of [
      `/api/v1/jobs/${aliceCompletedJobId}`,
      `/api/v1/tts/jobs/${aliceCompletedJobId}`,
    ]) {
      const anonJobRes = await fetch(`${baseUrl}${jobPath}`);
      assert.equal(anonJobRes.status, 401);
      const anonJobText = await anonJobRes.text();
      assert.ok(!anonJobText.includes('audioBase64'));

      const bobJobRes = await fetch(`${baseUrl}${jobPath}`, {
        headers: { Authorization: `Bearer ${bobToken}` },
      });
      assert.equal(bobJobRes.status, 403);
      const bobJobBody = await bobJobRes.json();
      assert.equal(bobJobBody.code, 'FORBIDDEN_NOT_OWNER');
      assert.equal(bobJobBody.result, undefined);
      assert.equal(bobJobBody.outputSignedUrl, undefined);
    }

    // E. Cross-tenant idempotency key isolation: Bob using same idempotencyKey never receives Alice's job
    const bobIdemRes = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({
        text: 'Bob independent synthesis request.',
        voiceId: 'vf_sarah_en',
        language: 'en',
        idempotencyKey: 'idem_shared_probe_01',
      }),
    });
    assert.equal(bobIdemRes.status, 202);
    const bobJob = await bobIdemRes.json();
    assert.notEqual(bobJob.jobId, aliceCompletedJobId);
    assert.equal(bobJob.userId, 'usr_bob_user');

    // F. Job cancellation isolation: seed a pending job owned by Alice, verify anon & Bob fail without mutating status
    const pendingJobId = `job_pending_alice_${Date.now()}`;
    const pendingJob = {
      id: pendingJobId,
      jobId: pendingJobId,
      userId: 'usr_alice_user',
      voiceId: 'vf_sarah_en',
      status: 'pending',
      executionMode: 'DEMO',
      inputText: 'Pending Alice synthesis job',
      language: 'en',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryStore.synthesisJobs.unshift(pendingJob);

    const anonCancel = await fetch(`${baseUrl}/api/v1/jobs/${pendingJobId}/cancel`, {
      method: 'POST',
    });
    assert.equal(anonCancel.status, 401);
    assert.equal(pendingJob.status, 'pending');

    const bobCancel = await fetch(`${baseUrl}/api/v1/jobs/${pendingJobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert.equal(bobCancel.status, 403);
    assert.equal(pendingJob.status, 'pending', 'Cross-tenant cancel attempt must not mutate job status');

    // Alice legitimately cancels her own pending job
    const aliceCancel = await fetch(`${baseUrl}/api/v1/jobs/${pendingJobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(aliceCancel.status, 200);
    assert.equal(pendingJob.status, 'cancelled');
  });

  // ==========================================================================
  // 8. PRIVILEGED AUDIT & ADMIN ROUTES REJECT ANONYMOUS AND NON-ADMIN CALLERS
  // ==========================================================================
  test('8. ADVERSARIAL: Privileged audit and migration routes reject anonymous and non-admin callers', async () => {
    const anonAudit = await fetch(`${baseUrl}/api/v1/audit/events`);
    assert.equal(anonAudit.status, 401);

    for (const nonAdminToken of [aliceToken, bobToken, creatorToken]) {
      const auditRes = await fetch(`${baseUrl}/api/v1/audit/events`, {
        headers: { Authorization: `Bearer ${nonAdminToken}` },
      });
      assert.equal(auditRes.status, 403);
      const body = await auditRes.json();
      assert.equal(body.code, 'FORBIDDEN_ROLE');
      assert.equal(body.events, undefined);

      const migrateRes = await fetch(`${baseUrl}/api/db/migrate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${nonAdminToken}` },
      });
      assert.equal(migrateRes.status, 403);
    }

    const anonMigrate = await fetch(`${baseUrl}/api/db/migrate`, { method: 'POST' });
    assert.equal(anonMigrate.status, 401);

    // Legitimate administrator succeeds on audit ledger
    const adminAudit = await fetch(`${baseUrl}/api/v1/audit/events`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminAudit.status, 200);
    const adminAuditData = await adminAudit.json();
    assert.ok(Array.isArray(adminAuditData.events));
  });

  // ==========================================================================
  // 9. INVALID, EXPIRED, FORGED, MISSING-EXP, AND REVOKED TOKENS REJECTED
  // ==========================================================================
  test('9. ADVERSARIAL: Invalid, malformed, missing-exp, expired, forged, and revoked tokens are rejected across routes', async () => {
    const secret = AuthService.getAuthSecret();
    const now = Math.floor(Date.now() / 1000);

    const missingExpToken = signCustomJwt(
      { alg: 'HS256', typ: 'JWT' },
      { sub: 'usr_alice_user', role: 'user', iat: now },
      secret
    );
    const wrongAlgToken = signCustomJwt(
      { alg: 'none', typ: 'JWT' },
      { sub: 'usr_alice_user', role: 'user', iat: now, exp: now + 3600 },
      secret
    );
    const expiredToken = AuthService.issueToken(PRELOADED_USERS.usr_alice_user, -30);
    const forgedToken = `${aliceToken.slice(0, aliceToken.lastIndexOf('.'))}.forged_signature_bytes`;

    const tempRevokedToken = AuthService.issueToken(PRELOADED_USERS.usr_bob_user, 3600);
    AuthService.revokeToken(tempRevokedToken, { userId: 'usr_bob_user', reason: 'adversarial_test' });

    const badTokens = [
      'not-a-jwt',
      missingExpToken,
      wrongAlgToken,
      expiredToken,
      forgedToken,
      tempRevokedToken,
    ];

    for (const bad of badTokens) {
      // Rejected on requireAuth route
      const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${bad}` },
      });
      assert.equal(meRes.status, 401);

      // Also rejected on optionalAuth route (never silently downgraded to anonymous)
      const voicesRes = await fetch(`${baseUrl}/api/v1/voices`, {
        headers: { Authorization: `Bearer ${bad}` },
      });
      assert.equal(voicesRes.status, 401);
    }

    // Bob cannot revoke Alice's active session token via /api/v1/auth/revoke
    const crossRevokeRes = await fetch(`${baseUrl}/api/v1/auth/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({ token: aliceToken }),
    });
    assert.equal(crossRevokeRes.status, 403);
    assert.equal(AuthService.isTokenRevoked(aliceToken), false, "Alice's token must remain active");
  });

  // ==========================================================================
  // 10. LEGITIMATE AUTHENTICATED TENANT & ADMIN WORKFLOWS PRESERVED
  // ==========================================================================
  test('10. POSITIVE: Valid server-authenticated principals retain tenant-scoped access and authorized admin actions work', async () => {
    // Alice inspects her session
    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.user.id, 'usr_alice_user');

    // Alice creates a custom voice (attempting category='premade' is safely normalized to 'designed')
    const createVoiceRes = await fetch(`${baseUrl}/api/v1/voices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ name: 'Alice Custom Studio Voice', category: 'premade' }),
    });
    assert.equal(createVoiceRes.status, 201);
    const { voice } = await createVoiceRes.json();
    assert.equal(voice.userId, 'usr_alice_user');
    assert.equal(voice.isPublic, false);
    assert.equal(voice.category, 'designed');

    // Alice can read her own custom voice; Bob cannot
    const aliceRead = await fetch(`${baseUrl}/api/v1/voices/${voice.id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(aliceRead.status, 200);

    const bobRead = await fetch(`${baseUrl}/api/v1/voices/${voice.id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    assert.equal(bobRead.status, 403);

    // Legitimate administrator CAN read and delete a tenant voice for compliance enforcement
    const adminRead = await fetch(`${baseUrl}/api/v1/voices/${voice.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminRead.status, 200);

    const adminDelete = await fetch(`${baseUrl}/api/v1/voices/${voice.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminDelete.status, 200);
  });

  // ==========================================================================
  // 11. DEVELOPMENT-ONLY DEMO SANDBOX GATING & NON-ESCALATION
  // ==========================================================================
  test('11. ADVERSARIAL: Development demo sandbox is disabled by default, strictly nonprivileged when enabled, and invalidated outside development', async () => {
    // Default development (flag unset) -> fails closed
    process.env.NODE_ENV = 'development';
    delete process.env.VOICEFORGE_ENABLE_DEV_DEMO_AUTH;

    const disabledDevRes = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(disabledDevRes.status, 401);
    const disabledBody = await disabledDevRes.json();
    assert.equal(disabledBody.code, 'AUTH_PROVIDER_UNAVAILABLE');
    assert.equal(disabledBody.token, undefined);

    // Explicit development + VOICEFORGE_ENABLE_DEV_DEMO_AUTH=true -> issues fixed usr_dev_sandbox ('user') only on claim-free body
    process.env.VOICEFORGE_ENABLE_DEV_DEMO_AUTH = 'true';

    // Identity/role claims STILL rejected even when dev demo flag is enabled
    const claimInDevRes = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.equal(claimInDevRes.status, 403);

    const sandboxRes = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(sandboxRes.status, 200);
    const sandboxData = await sandboxRes.json();
    assert.equal(sandboxData.user.id, DEV_SANDBOX_USER.id);
    assert.equal(sandboxData.user.role, 'user');

    // Sandbox token cannot access admin audit trail or Alice's private voice
    const sandboxAudit = await fetch(`${baseUrl}/api/v1/audit/events`, {
      headers: { Authorization: `Bearer ${sandboxData.token}` },
    });
    assert.equal(sandboxAudit.status, 403);

    const sandboxAliceVoice = await fetch(`${baseUrl}/api/v1/voices/${aliceEnrolledVoiceId}`, {
      headers: { Authorization: `Bearer ${sandboxData.token}` },
    });
    assert.equal(sandboxAliceVoice.status, 403);

    // Switching runtime to staging immediately invalidates the already-issued dev sandbox token!
    process.env.NODE_ENV = 'staging';
    const sandboxInStaging = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${sandboxData.token}` },
    });
    assert.equal(sandboxInStaging.status, 401);
  });

  // ==========================================================================
  // 12. ZERO PROTECTED STATE MUTATION ON REJECTED REQUESTS
  // ==========================================================================
  test('12. INVARIANT: Rejected anonymous and unauthorized requests leave user, voice, consent, job, and revocation state untouched', async () => {
    const usersBefore = AuthService.getUserCount();
    const voicesCountBefore = memoryStore.customVoices.length;
    const consentRecordsBefore = memoryStore.consentRecords.length;
    const jobsCountBefore = memoryStore.synthesisJobs.length;
    const consentActiveBefore = ConsentVerificationEngine.isConsentActive(aliceEnrolledVoiceId);

    // Execute a batch of unauthorized mutation attempts
    const r1 = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'usr_injected_99', role: 'admin' }),
    });
    assert.equal(r1.status, 403);

    const r2 = await fetch(`${baseUrl}/api/voices/clone/verify-consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge: { challengeId: 'ch_fake', nonce: 'n', userId: 'usr_alice_user', signature: 's' },
        voiceName: 'Injected Clone',
        referenceAudioBase64: 'AAAA',
        consentAudioBase64: 'BBBB',
      }),
    });
    assert.equal(r2.status, 401);

    const r3 = await fetch(`${baseUrl}/api/voices/upload-sample`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceName: 'Anonymous Uploaded Clone' }),
    });
    assert.equal(r3.status, 401);

    const r4 = await fetch(`${baseUrl}/api/voices/design`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Anonymous Designed Voice', prompt: 'Warm narrator' }),
    });
    assert.equal(r4.status, 401);

    const r5 = await fetch(`${baseUrl}/api/v1/tts/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Unauthorized job', voiceId: 'vf_sarah_en' }),
    });
    assert.equal(r5.status, 401);

    const r6 = await fetch(`${baseUrl}/api/v1/auth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: aliceToken, userId: 'usr_admin_root' }),
    });
    assert.equal(r6.status, 401);

    // Assert zero protected state mutation across all stores
    assert.equal(AuthService.getUserCount(), usersBefore);
    assert.equal(AuthService.getUserById('usr_injected_99'), undefined);
    assert.equal(memoryStore.customVoices.length, voicesCountBefore);
    assert.equal(memoryStore.consentRecords.length, consentRecordsBefore);
    assert.equal(memoryStore.synthesisJobs.length, jobsCountBefore);
    assert.equal(ConsentVerificationEngine.isConsentActive(aliceEnrolledVoiceId), consentActiveBefore);
    assert.equal(AuthService.isTokenRevoked(aliceToken), false);
  });
});
