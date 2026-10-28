# Phase 3C-S2A — Critical Security Remediation: Audio Revocation, Token Extraction, and Restricted-Environment Secrets

- **Date:** 2026-10-28 (Asia/Calcutta)
- **Repository:** `/home/user/Voice-clone` (`ranimony-afk/Voice-clone`)
- **Branch:** `arena/3b3635b6-voice-clone` (active)
- **Base `HEAD` Commit:** `594593a129ee586e29143933e09b4ee634460567` (no commits created)
- **Phase Scope:** Authorized Phase 3C-S2A critical security remediation (`P0` private audio revocation/deletion/cancellation lifecycle, `P1` strict `Authorization: Bearer <token>` extraction & `optionalAuth` failure handling, `P1` restricted-environment secret enforcement across `staging` and `production`)
- **S2A Remediation Validation Status:** **LOCALLY VALIDATED** (`12/12` S2A regression tests, `49/49` security tests across 5 suites, `107/107` non-PostgreSQL Node/TS tests across 13 suites, `15/15` Python `omnivoice` tests, `npm run lint` exit `0`, `npm run build:server` exit `0`)
- **Overall Repository Gate Verdict:** **`FAIL`** (intentionally remains `FAIL` pending independent Phase 3C-S2B verification and separate resolution of the untouched `npm run build:client` `react-is` dependency defect and unprovisioned PostgreSQL `127.0.0.1:5433` gate)

---

## 1. Executive Summary

Phase 3C-V2 (`reports/PHASE-3C-V2-INDEPENDENT-VERIFICATION.md`) confirmed that Phase 3C-S1 remediated identity minting, unknown-subject hydration, `staging` environment classification, and multi-tenant authorization bypasses, while identifying three security blockers requiring immediate remediation in **Phase 3C-S2A**:

1. **P0 — Private Audio Revocation, Voice Deletion, and Job Cancellation (`V2-NEW-01` / `V2-NEW-02`):**
   - `GET /api/v1/tts/jobs` serialized `memoryStore.synthesisJobs` without checking `ConsentVerificationEngine.isConsentActive(j.voiceId)`, exposing `161,120`-character `result.audioBase64` WAV payloads and `outputSignedUrl` values after consent revocation.
   - `POST /api/v1/jobs/:id/cancel` rejected `completed` jobs (`400 CANNOT_CANCEL`) and never invalidated or deleted `PrivateStorageService` artifacts, leaving previously issued signed URLs and Bearer downloads serving `200 audio/wav` bytes.
   - `POST /api/voices/clone/revoke-consent`, `DELETE /api/voices/:id`, and `DELETE /api/v1/voices/:id` neither eagerly scrubbed job outputs nor invalidated/deleted private media artifacts.
2. **P1 — Strict Token Extraction and Optional-Auth Failure Handling (`V2-NEW-03`):**
   - `AuthService.extractToken()` accepted `?token=...` query strings, `x-session-token` headers, and raw non-Bearer `Authorization: <jwt>` headers, and silently downgraded present-but-empty/whitespace credentials (`?token=%20%20%20` and `Authorization:    `, which Node's HTTP parser normalizes to `req.headers.authorization === ""`) to `null` (anonymous `200` on `optionalAuth` routes).
3. **P1 — Restricted-Environment Secret Enforcement (`V2-NEW-04`):**
   - `PrivateStorageService.getSigningSecret()` checked `process.env.NODE_ENV === 'production'` only, allowing `NODE_ENV=staging` (and unrecognized environments) to fall back to hardcoded `'vf_storage_sec_sig_p3a_88a91'`.
   - `ConsentVerificationEngine.SERVER_SECRET` evaluated once at module import time with static fallback `'vf_consent_sec_prod_99f2a87b1c4e6'`, failing open in both `staging` and `production`.

All three objectives have been remediated in minimal, focused changes across `server/storage/privateStorage.ts`, `server/routes/api.ts`, `server/auth/auth.ts`, `server/engine/audio/consent.ts`, and `server.ts`, backed by a new 12-test adversarial regression suite in `test/security/phase3c_s2a_remediation.test.ts`.

---

## 2. Authorized Workspace Rehydration Record (Option 1A)

Prior to editing any files, inspection revealed that Arena container snapshot restoration had stripped the gitignored `node_modules/` directory. Per explicit user authorization for **Option 1A**, `node_modules/` was restored strictly from existing `package.json` specifications without lockfile generation or lifecycle script execution:

- **Command:** `npm install --no-package-lock --ignore-scripts --legacy-peer-deps`
- **Exit Code:** `0` (`added 242 packages in 9s`)
- **Post-Install Integrity Checks:**
  - `package.json` SHA-256 unchanged: `96cb310c3093ccd9cc352f8bbfd007fdb97c33b88bf1ab0c02839cd74470d400`
  - `bun.lock` SHA-256 unchanged: `6dbe0469946c602996493bb706e9eff060cf5ed1afd2c71134b23afdcb826e48`
  - `package-lock.json` created: `false`
  - `npm-shrinkwrap.json` created: `false`
  - `node_modules/react-is` installed: `false` (intentionally left unresolved)

---

## 3. Files Modified & Created in Phase 3C-S2A

All prior Phase 3C-S1 source/test changes and all prior reports (`PHASE-0`, `PHASE-3C-S1`, `PHASE-3C-V2`) were preserved intact.

| File | Role in Phase 3C-S2A |
| :--- | :--- |
| `server/storage/privateStorage.ts` | Added authoritative `invalidatedMedia` tombstone registry, fail-closed pre-delete `invalidateAndDeleteMedia()` and `invalidateByVoiceId()`, invalidation checks in `verifySignedUrl()` and `getMedia()`, and `isRestrictedEnvironment()` secret enforcement in `getSigningSecret()`. |
| `server/routes/api.ts` | Added `isVoiceConsentVerifiedActive()`, `scrubJobAudioArtifactsInMemory()`, `serializeSafeSynthesisJob()`, `recordSanitizedCleanupFailures()`, and `purgeVoiceArtifactsAndJobs()`. Hardened `POST /api/voices/clone/revoke-consent`, `DELETE /api/voices/:id`, `DELETE /api/v1/voices/:id`, `POST /api/v1/jobs/:id/cancel`, `GET /api/v1/tts/jobs`, `GET /api/v1/tts/jobs/:id`, `GET /api/v1/jobs/:id`, `GET /api/v1/media/download/:id`, `POST /api/v1/media/upload`, and restricted-env error sanitization on `/voices/clone/challenge` & `/voices/clone/verify-consent`. |
| `server/auth/auth.ts` | Added `AuthService.parseCredential(req)` enforcing `Authorization: Bearer <token>`, rejecting `?token=...`, `x-session-token`, empty/whitespace `Authorization`, raw JWTs, and malformed Bearer headers across both `requireAuth` and `optionalAuth`. |
| `server/engine/audio/consent.ts` | Replaced static import-time `SERVER_SECRET` with dynamic `getConsentSecret()` enforced via `isRestrictedEnvironment()`, constant-time `crypto.timingSafeEqual` challenge & audit HMAC checks in `verifyEnrollment()` and `isConsentActive()`, and `resourceOwnerId` preservation on revocation markers. |
| `server.ts` | Added startup fail-closed verification of `getAuthSecret()`, `PrivateStorageService.getSigningSecret()`, and `ConsentVerificationEngine.getConsentSecret()` when `isRestrictedEnvironment(process.env.NODE_ENV)` is true. |
| `test/security/phase3c_s2a_remediation.test.ts` | New 12-subtest adversarial regression suite covering all P0 and P1 remediation requirements. |
| `reports/PHASE-3C-S2A-CRITICAL-SECURITY-REMEDIATION.md` | This Phase 3C-S2A remediation report. |

---

## 4. Detailed Remediations & Before/After Exploit Behavior

### 4.1 Objective 1 (P0) — Private Audio Revocation, Voice Deletion, and Job Cancellation

#### Root Causes Fixed
1. `GET /api/v1/tts/jobs` returned raw `memoryStore.synthesisJobs` entries without checking active biometric consent or scrubbing cancelled jobs.
2. `POST /api/v1/jobs/:id/cancel` returned `400 CANNOT_CANCEL` whenever `job.status === 'completed'` and never invalidated or unlinked `job.outputMediaId`.
3. `POST /api/voices/clone/revoke-consent`, `DELETE /api/voices/:id`, and `DELETE /api/v1/voices/:id` did not scrub in-memory synthesis jobs (`memoryStore.synthesisJobs` / `asyncJobsLedger`) or delete `PrivateStorageService` media records.
4. `PrivateStorageService.deleteMedia()` previously called `provider.delete()` before removing metadata from `memoryStore.privateMedia` and maintained no invalidation tombstone, risking continued access if underlying deletion failed.

#### Remediation Summary
- **Authoritative Pre-Delete Artifact Invalidation (`PrivateStorageService`):**
  - `invalidateAndDeleteMedia()` enforces tenant ownership (`requestingUserId === ownerId`, `isAdmin`, or route-verified `allowVoiceOwnerCleanup`), records an immutable tombstone in `invalidatedMedia`, and splices the record from `memoryStore.privateMedia` **synchronously before** calling `provider.delete(storageKey)`.
  - `verifySignedUrl()` immediately returns `false` and `getMedia()` immediately throws if `invalidatedMedia.has(mediaId)`.
  - `GET /api/v1/media/download/:id` requires authentication or signed URL parameters (`401 AUTH_REQUIRED` when neither is supplied), rejects cross-tenant/forged callers with `403 FORBIDDEN_MEDIA_ACCESS`, and returns `403 CONSENT_REVOKED` (for consent-revoked artifacts) or `403 MEDIA_ARTIFACT_INVALIDATED` (for cancelled jobs / deleted voices) with zero audio bytes.
- **Eager Scrubbing Across Lifecycle Endpoints (`server/routes/api.ts`):**
  - `POST /api/voices/clone/revoke-consent`, `DELETE /api/voices/:id`, and `DELETE /api/v1/voices/:id` invoke `purgeVoiceArtifactsAndJobs()`, scrubbing `result`, `outputSignedUrl`, and `outputMediaId` across both `memoryStore.synthesisJobs` and `asyncJobsLedger` and invalidating/deleting all private media artifacts for `voiceId`.
  - `POST /api/v1/jobs/:id/cancel` cancels `pending`, `processing`, `completed`, and `cancelled` (idempotent) jobs owned by the caller (or admin), scrubs `result`, `outputSignedUrl`, and `outputMediaId`, and invalidates/deletes `outputMediaId`.
  - `GET /api/v1/tts/jobs`, `GET /api/v1/tts/jobs/:id`, and `GET /api/v1/jobs/:id` evaluate `isVoiceConsentVerifiedActive(job.voiceId)` and `PrivateStorageService.isMediaInvalidated(job.outputMediaId)` before serialization, failing closed (including on out-of-band `ConsentVerificationEngine.revokeConsent()` calls) without exposing `audioBase64`, `outputSignedUrl`, or `outputMediaId`.

#### Before vs. After Exploit Behavior & Artifact Inaccessibility Evidence

| Exploit / Lifecycle Probe | Before Phase 3C-S2A (V2 Confirmed) | After Phase 3C-S2A (Verified in `P0-1`..`P0-7`) |
| :--- | :--- | :--- |
| `GET /api/v1/tts/jobs` after `POST /api/voices/clone/revoke-consent` | `200 OK` with `status: 'completed'`, `161,120`-char `result.audioBase64`, and `outputSignedUrl` (**P0 LEAK**) | `200 OK` with `status: 'cancelled'`, `result: undefined`, `outputSignedUrl: undefined`, `outputMediaId: undefined`; zero `RIFF`/`UklGR` bytes |
| `GET /api/v1/tts/jobs` after out-of-band `ConsentVerificationEngine.revokeConsent()` | `200 OK` with full `result.audioBase64` and `outputSignedUrl` (**P0 LEAK**) | `200 OK` fail-closed: scrubs `result`/`outputSignedUrl`/`outputMediaId` and invalidates underlying artifact (`P0-2`) |
| `GET ${priorSignedUrl}` or Bearer `GET /api/v1/media/download/:id` after consent revocation | Metadata blocked if still in `privateMedia`, but disk WAV remained untouched | Underlying WAV deleted from `LocalStorageProvider` (`exists === false`), `verifySignedUrl === false`, returns `403 CONSENT_REVOKED` with zero audio bytes (`P0-1`) |
| `POST /api/v1/jobs/:id/cancel` on a `completed` synthesis job | `400 Bad Request` (`CANNOT_CANCEL`); signed URL and Bearer download continued serving `200 audio/wav` bytes (**P0 LEAK**) | `200 OK` (`status: 'cancelled'`), scrubs `result`/`outputSignedUrl`/`outputMediaId`, unlinks WAV on disk; Bearer download & prior signed URL both return `403 MEDIA_ARTIFACT_INVALIDATED` (`P0-3`) |
| `DELETE /api/voices/:id` and `DELETE /api/v1/voices/:id` | Removed catalog item only; jobs retained `audioBase64` and media remained on disk | Scrubs all jobs for `voiceId`, unlinks underlying WAVs, and blocks prior signed URLs & Bearer downloads with `403` (`P0-4`) |
| Cross-tenant `revoke-consent`, `DELETE /voices/:id`, `POST /jobs/:id/cancel`, `invalidateAndDeleteMedia` | Protected on routes, untested on storage invalidation helper | All return `403 FORBIDDEN_NOT_OWNER` / throw `Forbidden`; owner's active audio remains intact (`P0-5`) |
| Repeated `revoke-consent`, repeated `jobs/:id/cancel`, or pre-unlinked disk file | Not idempotent on `cancel` | Returns `200 OK` idempotently (`alreadyCancelled: true` on second cancel, `cleanupFailed: false` when blob already absent) (`P0-6`) |

#### Cleanup Failure Modes & Fail-Closed Guarantees (`P0-7`)

| Storage Failure Mode Simulated | Pre-Delete Invalidation State | Subsequent Retrieval (`priorSignedUrl`, Bearer `/media/download/:id`, `getMedia`) | Audit Recording Behavior |
| :--- | :--- | :--- | :--- |
| `provider.delete(key)` throws `Error` containing canary secret `AWS_SECRET_ACCESS_KEY=...` and internal path | Tombstone written to `invalidatedMedia` and `memoryStore.privateMedia` spliced **before** `provider.delete()` | `403` (`CONSENT_REVOKED` / `MEDIA_ARTIFACT_INVALIDATED`), `provider.retrieve()` invoked **`0` times**, `getMedia()` throws invalidated error | `media_artifact_cleanup_failed` logged with `{ failureCode: 'PROVIDER_DELETE_EXCEPTION', artifactRemainsInvalidated: true }`; **zero** canary credentials, paths, or audio bytes in HTTP responses or audit logs |
| `provider.delete(key)` returns `false` while file still exists on disk (`provider.exists(key) === true`) | Tombstone written to `invalidatedMedia` and `memoryStore.privateMedia` spliced **before** `provider.delete()` | `403` (`MEDIA_ARTIFACT_INVALIDATED`), `provider.retrieve()` invoked **`0` times** despite bytes still on disk | `media_artifact_cleanup_failed` logged with `{ failureCode: 'PROVIDER_DELETE_RETURNED_FALSE', artifactRemainsInvalidated: true }` |

---

### 4.2 Objective 2 (P1) — Strict Token Extraction and Optional-Auth Failure Handling

#### Root Causes Fixed
- `AuthService.extractToken()` accepted `?token=...` query parameters, `x-session-token` headers, and raw JWTs in `Authorization: <jwt>`, and checked `authHeader.length > 0` / `req.query.token.length > 0` before returning `null`.
- Because Node's HTTP parser strips optional whitespace (OWS) from header values (`Authorization:    ` -> `req.headers.authorization === ""`), and `"".trim()` on `?token=%20%20%20` became empty, `optionalAuth` treated present-but-empty/whitespace credentials as `null` (anonymous `200 OK`).

#### Remediation Summary
- Implemented `AuthService.parseCredential(req): CredentialParseResult` returning `{ status: 'absent' }`, `{ status: 'present', token }`, or `{ status: 'invalid', code, error }`:
  - Any request containing `'token' in req.query` (`req.query.token !== undefined` — empty, whitespace, invalid, valid JWT, or paired with a Bearer header) returns `{ status: 'invalid', code: 'UNSUPPORTED_AUTH_TRANSPORT' }`.
  - Any request containing `'x-session-token' in req.headers` returns `{ status: 'invalid', code: 'UNSUPPORTED_AUTH_TRANSPORT' }`.
  - Any request containing `'authorization' in req.headers` must be a string starting with exact `'Bearer '` followed by a non-empty token containing no internal whitespace; otherwise returns `{ status: 'invalid', code: 'MALFORMED_AUTH_HEADER' }`.
  - Both `requireAuth` and `optionalAuth` reject `status === 'invalid'`, revoked tokens (`AUTH_TOKEN_REVOKED`), and invalid/expired/missing-`exp`/forged tokens (`AUTH_INVALID_TOKEN`) with **`401 Unauthorized`**. Only `{ status: 'absent' }` proceeds anonymously on `optionalAuth`.

#### Before vs. After Exploit Behavior (`P1-Auth-1`..`P1-Auth-3`)

| Request Credential Variant on `GET /api/v1/voices` (`optionalAuth`) & `GET /api/v1/auth/me` (`requireAuth`) | Before Phase 3C-S2A | After Phase 3C-S2A |
| :--- | :--- | :--- |
| `?token=%20%20%20` or `?token=` | `200 OK` anonymous on `optionalAuth` (**Bypass**) | `401 UNSUPPORTED_AUTH_TRANSPORT` on both |
| `?token=<validAliceJwt>` | `200 OK` authenticated via URL query (**Leak-prone transport**) | `401 UNSUPPORTED_AUTH_TRANSPORT` on both |
| `Authorization:    ` (raw whitespace header) or `Authorization: ""` | `200 OK` anonymous on `optionalAuth` (**Bypass**) | `401 MALFORMED_AUTH_HEADER` on both |
| `Authorization: <validAliceJwt>` (raw JWT without `Bearer `) | `200 OK` authenticated (**Contract violation**) | `401 MALFORMED_AUTH_HEADER` on both |
| `Authorization: Bearer`, `Authorization: Bearer    `, `Authorization: Bearer <jwt> extra`, `Authorization: bearer <jwt>` | Partial acceptance / inconsistent | `401 MALFORMED_AUTH_HEADER` on both |
| `x-session-token: <validAliceJwt>` or `x-session-token:    ` | `200 OK` authenticated / `200 OK` anonymous | `401 UNSUPPORTED_AUTH_TRANSPORT` on both |
| Forged, expired, missing-`exp`, `alg:none`, or revoked Bearer token | `401` | `401` (`AUTH_INVALID_TOKEN` / `AUTH_TOKEN_REVOKED`) — never downgraded to anonymous |
| No credentials supplied | `200` on `optionalAuth`, `401` on `requireAuth` | Preserved (`200` public-only voices on `optionalAuth`, `401 AUTH_REQUIRED` on `requireAuth`) |
| Valid `Authorization: Bearer <aliceToken>` | `200` own resources, `403` admin/cross-tenant | Preserved (`200` own resources, `403` on `/api/v1/audit/events` & cross-tenant resources) |

---

### 4.3 Objective 3 (P1) — Restricted-Environment Secret Enforcement

#### Root Causes Fixed
- `PrivateStorageService.getSigningSecret()` checked `process.env.NODE_ENV === 'production'` instead of `isRestrictedEnvironment(process.env.NODE_ENV)`, failing open in `staging` and unrecognized `NODE_ENV` values.
- `ConsentVerificationEngine` defined `private static readonly SERVER_SECRET = process.env.VOICEFORGE_CONSENT_SECRET || 'vf_consent_sec_prod_99f2a87b1c4e6'` at module load time, permanently caching a static fallback secret in all environments.

#### Remediation Summary
- Both `PrivateStorageService.getSigningSecret()` and `ConsentVerificationEngine.getConsentSecret()` now use `isRestrictedEnvironment(process.env.NODE_ENV)` from `server/config/env.ts` and fail closed (`FATAL SECURITY CONFIGURATION`) in `staging`, `production`, and any unrecognized `NODE_ENV` when their secret (`VOICEFORGE_STORAGE_SECRET` / `VOICEFORGE_CONSENT_SECRET`) is missing, empty/whitespace, shorter than 16 characters, or set to a known development/legacy fallback string.
- Removed `ConsentVerificationEngine.SERVER_SECRET` completely so no fallback secret is ever cached at module initialization.
- `ConsentVerificationEngine.verifyEnrollment()` and `ConsentVerificationEngine.isConsentActive()` dynamically resolve `getConsentSecret()` and verify HMAC signatures with `crypto.timingSafeEqual`, ensuring development/test fallback challenges and enrollments cannot leak into `staging` or `production`.
- `server.ts` invokes `getAuthSecret()`, `PrivateStorageService.getSigningSecret()`, and `ConsentVerificationEngine.getConsentSecret()` during startup whenever `isRestrictedEnvironment(process.env.NODE_ENV)` is true.
- Secret values are never logged to stdout/stderr or returned in error payloads.

#### Before vs. After Environment Matrix (`P1-Secrets-1` & `P1-Secrets-2`)

| Environment (`NODE_ENV`) | Secret State | Before Phase 3C-S2A | After Phase 3C-S2A |
| :--- | :--- | :--- | :--- |
| `development`, `test` | Unset | Dev fallback used | Dev fallback permitted for local/test compatibility; URLs & consent records created with dev fallback are rejected if `NODE_ENV` becomes `staging` or `production` |
| `staging` | Missing / blank / `< 16` chars / fallback string | **Fell back to static secrets in both `PrivateStorageService` and `ConsentVerificationEngine`** | **Fails closed** (`FATAL SECURITY CONFIGURATION` in `getSigningSecret()`, `getConsentSecret()`, `issueChallenge()`, `verifyEnrollment()`, cold-boot subprocess, and `server.ts` startup) |
| `production` | Missing / blank / `< 16` chars / fallback string | `PrivateStorageService` threw on missing only; **`ConsentVerificationEngine` fell back to static `'vf_consent_sec_prod_99f2a87b1c4e6'`** | **Both fail closed** (`FATAL SECURITY CONFIGURATION`), `isConsentActive()` returns `false`, `verifySignedUrl()` returns `false` |
| Unrecognized (`unrecognized_env`) | Missing / invalid | Fell back to static secrets | **Both fail closed** via `isRestrictedEnvironment()` |
| `development`, `test`, `staging`, `production` | Valid strong secrets (`>= 16` chars) | Worked (with static import caveat on `ConsentVerificationEngine`) | Dynamically resolves configured secrets, passes signing + verification, logs **zero** secret characters |

---

## 5. Validation Commands & Exit Codes

| Gate / Suite | Exact Command Executed | Result | Exit Code |
| :--- | :--- | :--- | :---: |
| **Phase 3C-S2A Regression Suite** | `npx tsx --test test/security/phase3c_s2a_remediation.test.ts` | **PASS** (`12 / 12` subtests) | `0` |
| **TypeScript Typecheck / Lint** | `npm run lint` (`tsc --noEmit`) | **PASS** (0 errors) | `0` |
| **Full Security Test Suite (5 files)** | `npx tsx --test test/security/*.test.ts` | **PASS** (`49 / 49` subtests across 5 suites) | `0` |
| **All 13 Non-PostgreSQL Node/TS Suites** | `npx tsx --test test/api/routes.test.ts test/integration/consent_job_race.test.ts test/integration/durable_revocation.test.ts test/integration/rate_limit_and_db_fail_closed.test.ts test/integration/storage_provider.test.ts test/security/consent.test.ts test/security/phase3a_security.test.ts test/security/phase3c_s1_auth_remediation.test.ts test/security/phase3c_s2a_remediation.test.ts test/security/watermark.test.ts test/unit/normalizer.test.ts test/unit/phonemizer.test.ts test/unit/quality.test.ts` | **PASS** (`107 / 107` subtests across 13 suites; `storage/auth/revoked_tokens.json` restored to `HEAD` after `durable_revocation.test.ts` unlinked it) | `0` |
| **Server Bundle Build** | `npm run build:server` (followed by `rm -rf dist-server`) | **PASS** (`dist-server/server.js 348.4kb`) | `0` |
| **Python OmniVoice Service Suite** | `python3 services/omnivoice/tests/run_tests.py` | **PASS** (`15 / 15` tests in `0.493s`) | `0` |
| **Client Production Build (Untouched Gate)** | `npm run build:client` (followed by `rm -rf dist`) | **FAIL** (Rolldown unresolved import `"react-is"` from `node_modules/recharts/es6/util/ReactUtils.js` — intentionally untouched per scope) | `1` |
| **PostgreSQL Persistence Suite (Untouched Gate)** | `npx tsx --test test/integration/postgres_persistence.test.ts` | **BLOCKED / FAIL** (`1` pass, `5` fail with `ECONNREFUSED` on `127.0.0.1:5433` — PostgreSQL intentionally unprovisioned per scope) | `1` |

---

## 6. Separate Unresolved Gates (Not Modified in Phase 3C-S2A)

Per explicit phase boundaries, overall repository readiness is **not** claimed as `PASS` because:
1. **Independent Verification Pending:** Phase 3C-S2A remediation must be independently verified in a subsequent verification phase (Phase 3C-S2B).
2. **Client Bundle Build (`npm run build:client`, exit `1`):** `recharts@3.10.1` imports `react-is`, which is absent from `package.json`. Per instructions, `package.json` and `bun.lock` were not modified.
3. **PostgreSQL Live Persistence Gate (`test/integration/postgres_persistence.test.ts`, exit `1`):** No local PostgreSQL instance is provisioned on `127.0.0.1:5433` (`ECONNREFUSED`). Per instructions, PostgreSQL was not installed or started during S2A.

---

## 7. Protected File Checksums & Boundary Attestation

- `package.json`: `96cb310c3093ccd9cc352f8bbfd007fdb97c33b88bf1ab0c02839cd74470d400` (unchanged)
- `bun.lock`: `6dbe0469946c602996493bb706e9eff060cf5ed1afd2c71134b23afdcb826e48` (unchanged)
- `storage/auth/revoked_tokens.json`: `6c29f5194bb7fbe434fe464610eb790756191e31ee6a938c12225b61f3a70e2e` (unchanged)
- `reports/PHASE-0-NEW-ARENA-BOOTSTRAP-AND-ROADMAP.md`: `2a3672393f93bd4fcb954f024245dec2abec64b789335ece06669f138b5a2772` (preserved)
- `reports/PHASE-3C-S1-CRITICAL-AUTH-REMEDIATION.md`: `337039b386d156f4e727dd1e8ffadf93bf03e3e1ab86c61d41388f37cae9970e` (preserved)
- `reports/PHASE-3C-V2-INDEPENDENT-VERIFICATION.md`: `d51ebc96781a33a62891610c13a518bfd25d2319dec364f79fca482d046f44ed` (preserved)
- `package-lock.json` / `npm-shrinkwrap.json`: absent (`NO_PACKAGE_LOCK`, `NO_SHRINKWRAP`)
- **Git & Operational Boundaries:** Zero commits, zero pushes, zero pull requests, zero branch switches, zero deployments, zero extra package installations beyond authorized Option 1A rehydration, and zero PostgreSQL provisioning were performed.
