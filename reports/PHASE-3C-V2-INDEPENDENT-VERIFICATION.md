# PHASE 3C-V2 — INDEPENDENT SECURITY VERIFICATION REPORT

- **Repository**: `https://github.com/ranimony-afk/Voice-clone` (`/home/user/Voice-clone`)
- **Working Branch**: `arena/3b3635b6-voice-clone` (`active`)
- **Base Commit (`HEAD`)**: `594593a129ee586e29143933e09b4ee634460567` (`feat(core): implement synthesis modes and security`, matching `main` and `origin/main`)
- **Verification Date**: `2026-10-28` (`Asia/Calcutta`)
- **Preserved Prior Reports**:
  - `reports/PHASE-0-NEW-ARENA-BOOTSTRAP-AND-ROADMAP.md` (`SHA-256: 2a3672393f93bd4fcb954f024245dec2abec64b789335ece06669f138b5a2772`)
  - `reports/PHASE-3C-S1-CRITICAL-AUTH-REMEDIATION.md` (`SHA-256: 337039b386d156f4e727dd1e8ffadf93bf03e3e1ab86c61d41388f37cae9970e`)
- **Application Code Modified in Phase 3C-V2**: **None (`0` bytes changed across all tracked and Phase 3C-S1 files)**
- **Phase 3C-V2 Security Gate Verdict**: **`FAIL`**
  - **Summary Rationale**: Although the existing test suites pass (`12/12` in `phase3c_s1_auth_remediation.test.ts`, `37/37` across `test/security/*.test.ts`, `95/95` across all 12 non-PostgreSQL Node/TS suites) and **8 of 10** core authentication/authorization objectives hold under independent adversarial verification, independent code inspection and synthetic local HTTP probing uncovered **two genuine security objective failures** missed by the Phase 3C-S1 test suite, alongside the **two known unresolved build/persistence gates**:
    1. **Security Blocker (`FAIL`) — Private Audio Leakage After Consent Revocation & Job Cancellation**:
       - **Post-revocation list leakage (`server/routes/api.ts:1244-1248`)**: After `POST /api/voices/clone/revoke-consent` succeeds (`200 OK`), calling `GET /api/v1/tts/jobs` (before polling `:id`) returns `200 OK` with `status: "completed"`, full `result.audioBase64` (`161,120` chars of WAV data), and `outputSignedUrl` intact because revocation does not eagerly purge job artifacts and `GET /api/v1/tts/jobs` omits `ConsentVerificationEngine.isConsentActive(j.voiceId)` enforcement.
       - **Post-cancellation media download leakage (`server/routes/api.ts:2734-2789`, `1074-1128`)**: `POST /api/v1/jobs/:id/cancel` deletes `result` and `outputSignedUrl` on the in-memory job record, **but does not delete or invalidate `outputMediaId` in `PrivateStorageService`**, allowing `GET /api/v1/media/download/:id` (via Bearer token or previously obtained signed URL) to still return `200 OK` with raw WAV bytes after cancellation.
    2. **Security Edge-Case (`FAIL`) — Whitespace Query-Token Fallback Through `optionalAuth` & Permissive `extractToken` (`server/auth/auth.ts:518-571`)**:
       - Standard forged, expired, missing-`exp`, `alg:none`, and revoked tokens are rejected with `401` across `optionalAuth` routes. However, `GET /api/v1/voices?token=%20%20%20` (`req.query.token === "   "`) trims to `""` in `extractToken()`, causing `optionalAuth` (`if (!token) return next()`) to silently downgrade to anonymous (`200 OK`) instead of returning `401`. Additionally, `extractToken()` accepts non-Bearer `Authorization: <rawJwt>` headers (`200 OK`) and URL query tokens (`?token=<jwt>`).
    3. **Known Unresolved Gate (`FAIL`) — Client Production Bundle (`npm run build:client`)**: Exits `1` in Rolldown (`Cannot resolve import "react-is"` from `node_modules/recharts/es6/util/ReactUtils.js`) under Option 1A `--legacy-peer-deps`.
    4. **Known Unresolved Gate (`BLOCKED / FAIL`) — PostgreSQL Persistence Suite (`test/integration/postgres_persistence.test.ts`)**: Exits `1` (`5/6` subtests fail with `ECONNREFUSED` at `127.0.0.1:5433`; no local PostgreSQL service).

---

## 1. Baseline Repository, Worktree & Protected-File State

### 1.1 Git & Worktree Verification (Recorded Prior to Any Execution)
- **Repository Root**: `/home/user/Voice-clone`
- **Branch**: `arena/3b3635b6-voice-clone` (`active`)
- **HEAD Commit**: `594593a129ee586e29143933e09b4ee634460567` (`grafted, HEAD -> arena/3b3635b6-voice-clone, origin/main, origin/HEAD, main`)
- **Remote `origin`**: `https://github.com/ranimony-afk/Voice-clone.git` (fetch & push)
- **Modified Tracked Files (`8` files, `+991 / -372` lines from Phase 3C-S1)**:
  - `server.ts` (`12 +-`)
  - `server/auth/auth.ts` (`338 +-`)
  - `server/config/env.ts` (`71 +-`)
  - `server/engine/audio/consent.ts` (`29 +-`)
  - `server/routes/api.ts` (`810 +-`)
  - `src/components/Header.tsx` (`15 +-`)
  - `src/components/VoiceCloningLabView.tsx` (`25 +-`)
  - `test/api/routes.test.ts` (`63 +-`)
- **Untracked Phase 0 / Phase 3C-S1 Artifacts Present**:
  - `reports/PHASE-0-NEW-ARENA-BOOTSTRAP-AND-ROADMAP.md`
  - `reports/PHASE-3C-S1-CRITICAL-AUTH-REMEDIATION.md`
  - `test/security/phase3c_s1_auth_remediation.test.ts`

### 1.2 Container Snapshot `node_modules/` Note
When this Arena container resumed from snapshot at `2026-10-28 06:42 UTC`, `node_modules/` was absent because Arena snapshots exclude `node_modules/`. After completing the read-only git/checksum inspection and static source audit, the exact previously authorized Phase 3C-S1 Option 1A baseline command (`npm install --no-package-lock --ignore-scripts --legacy-peer-deps`) was executed to hydrate `node_modules/` (`242` packages) so existing and independent dynamic tests could run. **Zero additional packages were installed (`react-is` was NOT installed), zero lifecycle scripts ran, no `package-lock.json` was generated, and all 14 file SHA-256 checksums below were verified identical before and after verification.**

### 1.3 Checksum Verification Table (Before & After Phase 3C-V2)

| File Path | Role | Verified SHA-256 | Mutated in V2? |
| :--- | :--- | :--- | :---: |
| `package.json` | Manifest (protected) | `96cb310c3093ccd9cc352f8bbfd007fdb97c33b88bf1ab0c02839cd74470d400` | No |
| `bun.lock` | Lockfile (protected) | `6dbe0469946c602996493bb706e9eff060cf5ed1afd2c71134b23afdcb826e48` | No |
| `storage/auth/revoked_tokens.json` | Revocation store (protected) | `6c29f5194bb7fbe434fe464610eb790756191e31ee6a938c12225b61f3a70e2e` | No |
| `reports/PHASE-0-NEW-ARENA-BOOTSTRAP-AND-ROADMAP.md` | Phase 0 report (protected) | `2a3672393f93bd4fcb954f024245dec2abec64b789335ece06669f138b5a2772` | No |
| `reports/PHASE-3C-S1-CRITICAL-AUTH-REMEDIATION.md` | Phase 3C-S1 report (protected) | `337039b386d156f4e727dd1e8ffadf93bf03e3e1ab86c61d41388f37cae9970e` | No |
| `server.ts` | S1 modified app entry | `4ebd586e8b41b0aede651fe098ad65f0a57b4887bcf2434c92c0014fc26eeaa6` | No |
| `server/config/env.ts` | S1 modified env config | `3bd0bc50c34d2356798fd0ac645cee05625f036abda547d6c1dd122a1a0dcc1a` | No |
| `server/auth/auth.ts` | S1 modified auth subsystem | `9411960607c778c53391f924d71847a514e70d257ae1e3fae624fdc115fae554` | No |
| `server/engine/audio/consent.ts` | S1 modified consent engine | `bb44b038da980fa41be131bf7f58f329527b2b2a7b5ed14868fe90c4d2c7d8c3` | No |
| `server/routes/api.ts` | S1 modified API router | `497df7d01acaf946867fda876f3f1262112201a03434d8cb5887d1279cc0d67a` | No |
| `src/components/Header.tsx` | S1 modified header UI | `bd9093836238ae5c794a94ea6fbe347154910c3ee31ba62b14fde7ec8bec1f60` | No |
| `src/components/VoiceCloningLabView.tsx` | S1 modified cloning UI | `c455997a773cb054a1fb977c1b1e1183ae0495958d08a7e37609b1c6b53daa1f` | No |
| `test/api/routes.test.ts` | S1 modified API tests | `e2a0dd8759cc4749ccd3480f6760c9cb0a5cbf11b47271ba4cff4f6df7d38963` | No |
| `test/security/phase3c_s1_auth_remediation.test.ts` | S1 adversarial suite | `8c87298910042b94e3e7af98d54d78ee5ff23dca78a13c3f083e8f255592b7f4` | No |

---

## 2. Independent Source Code Audit (Task 1)

Every modified and security-adjacent module was inspected line-by-line without trusting claims made in `reports/PHASE-3C-S1-CRITICAL-AUTH-REMEDIATION.md`:

1. **Environment Resolution & Restricted-Tier Secret Enforcement**:
   - `server/config/env.ts:22-51`: `resolveRuntimeEnvironment()` maps `undefined` and `'undefined'` to `'development'`, preserves exact `'development' | 'staging' | 'production' | 'test'`, and maps any other explicit string (`''`, `'DEVELOPMENT'`, `'Staging'`, `'prod-cluster'`) fail-closed to `'production'`. `isRestrictedEnvironment()` returns `true` for `'staging'` and `'production'`.
   - `server/auth/auth.ts:38-49`: `getAuthSecret()` throws in both `staging` and `production` when `VOICEFORGE_AUTH_SECRET` is unset/blank.
   - **Audit Finding (`AF-01`, Medium — Secondary Secrets Not Hardened for `staging`)**:
     - `server/storage/privateStorage.ts:183-191` (`PrivateStorageService.getSigningSecret()`) still checks `if (process.env.NODE_ENV === 'production')` rather than `isRestrictedEnvironment()`. In `staging`, if `VOICEFORGE_STORAGE_SECRET` is unset, signed media URLs silently use hardcoded `'vf_storage_sec_sig_p3a_88a91'`.
     - `server/engine/audio/consent.ts:57` (`ConsentVerificationEngine.SERVER_SECRET`) evaluates `process.env.VOICEFORGE_CONSENT_SECRET || 'vf_consent_sec_prod_99f2a87b1c4e6'` once at import time and never fails closed in `staging` or `production`.
2. **Token Issuance (`POST /api/v1/auth/token`, `server/routes/api.ts:126-184` & `server/auth/auth.ts:311-334`)**:
   - Rejects any request body with `role !== undefined || userId !== undefined || email !== undefined` (`403 FORBIDDEN_IDENTITY_CLAIM`).
   - Fails closed (`401 AUTH_PROVIDER_UNAVAILABLE`) unless `resolveRuntimeEnvironment(process.env.NODE_ENV) === 'development'` **and** `process.env.VOICEFORGE_ENABLE_DEV_DEMO_AUTH === 'true'`.
   - When dev demo bootstrap is explicitly enabled in `development`, `issueDevSandboxToken()` issues a 1-hour token strictly for frozen `DEV_SANDBOX_USER` (`id: 'usr_dev_sandbox'`, `role: 'user'`).
   - **Audit Finding (`AF-02`, Low — Non-Plain-Object JSON Body Telemetry Bypass)**: Because `typeof [] === 'object'`, posting a JSON array `[{"role":"admin"}]` in `development` + `VOICEFORGE_ENABLE_DEV_DEMO_AUTH=true` evaluates `body.role === undefined` and mints a nonprivileged `usr_dev_sandbox` (`role: 'user'`) token instead of returning `403 FORBIDDEN_IDENTITY_CLAIM`. Privilege escalation does **not** occur (`issuedUserId: 'usr_dev_sandbox'`, `issuedRole: 'user'`, and `401` in `test`/`staging`/`production`).
3. **Token Verification, Revocation, `requireAuth`, and `optionalAuth` (`server/auth/auth.ts:427-592`)**:
   - `verifyToken()` verifies 3-part format, `length <= 4096`, `DurableRevocationStore.isRevoked()`, constant-time HMAC-SHA256 (`timingSafeEqual`), `header.alg === 'HS256' && header.typ === 'JWT'`, non-empty `payload.sub`, finite `iat`/`exp` (`exp > now`), active dev-sandbox gate when `sub === 'usr_dev_sandbox'`, and authoritative `userStore.get(payload.sub)` lookup (returning `{ ...storedUser }` and ignoring JWT `role`/`email` claims; never hydrating unknown subjects).
   - **Audit Finding (`AF-03`, Medium — `extractToken` / `optionalAuth` Edge Cases at `server/auth/auth.ts:518-571`)**:
     - `req.query.token`: If a caller passes whitespace `?token=%20%20%20`, `req.query.token.length > 0` matches at line 530 and `.trim()` returns `""`, which `optionalAuth` (`if (!token) return next();` at line 569) treats as anonymous (`200 OK`) instead of `401`.
     - `req.headers.authorization`: If a caller sends `Authorization: <rawValidJwt>` without a `"Bearer "` prefix, line 524 returns `authHeader.trim()`, which `verifyToken()` accepts as `200 OK` rather than rejecting the malformed scheme.
     - Accepting bearer session tokens in URL query parameters (`?token=<jwt>`) exposes credentials to server/proxy logs and `Referer` headers.
     - Note: Phase 3C-S1 Report Section 3.2 claimed `VOICEFORGE_AUTH_SECRET_PREVIOUS` dual-secret rotation was supported in `verifyToken()`; `server/auth/auth.ts:444-456` actually verifies against single `getAuthSecret()` only (inaccurate report description, though fail-closed).
4. **Consent Revocation & Voice Deletion (`server/engine/audio/consent.ts:251-294`, `server/routes/api.ts:750-873, 1009-1041`)**:
   - `ConsentVerificationEngine.revokeConsent()` requires explicit `options?.isAdmin === true` and `options?.recordRevocationMarker === true`; magic strings `'admin'` and `'usr_admin_root'` grant zero authority.
   - `POST /api/voices/clone/revoke-consent`, `DELETE /api/voices/:id`, and `DELETE /api/v1/voices/:id` all enforce `requireAuth` and verify `ownerId === req.user.id || req.user.role === 'admin'` before mutating `customVoices` or consent state.
5. **Job Access, Cancellation & Private Audio Delivery (`server/routes/api.ts:1074-1300, 2671-2790`)**:
   - **Audit Finding (`AF-04`, High — Post-Revocation Audio Leakage via `GET /api/v1/tts/jobs` List Endpoint, `server/routes/api.ts:1244-1248`)**:
     - `GET /api/v1/tts/jobs/:id` (`api.ts:1251-1297`) and `GET /api/v1/jobs/:id` (`api.ts:2679-2732`) check `!ConsentVerificationEngine.isConsentActive(job.voiceId)` and lazily scrub `job.result` and `job.outputSignedUrl` on access.
     - However, `POST /api/voices/clone/revoke-consent` (`api.ts:750-828`) does **not** scrub existing jobs or delete stored media when consent is revoked, and **`GET /api/v1/tts/jobs` (`api.ts:1244-1248`) returns `(memoryStore.synthesisJobs).filter(j => j.userId === callerId)` directly without checking `isConsentActive(j.voiceId)` or scrubbing `result.audioBase64` / `outputSignedUrl`**. Any call to `GET /api/v1/tts/jobs` after consent revocation (prior to polling `:id`) returns the full synthesized WAV payload (`result.audioBase64`) and `outputSignedUrl`.
   - **Audit Finding (`AF-05`, High — Post-Cancellation Media Artifact Still Downloadable via `GET /api/v1/media/download/:id`, `server/routes/api.ts:2734-2789` & `1074-1128`)**:
     - `POST /api/v1/jobs/:id/cancel` deletes `result` and `outputSignedUrl` on `ledgerJob` and `storeJob`, **but never calls `PrivateStorageService.deleteMedia(job.outputMediaId, ...)` or checks cancelled job status in `GET /api/v1/media/download/:id`**. Any media artifact already written for a job remains downloadable (`200 OK` WAV bytes) via Bearer auth or a previously issued signed URL after job cancellation.
   - **Audit Finding (`AF-06`, Low-Medium — Report-vs-Code Discrepancy & ID Enumeration on `GET /api/v1/media/download/:id`, `server/routes/api.ts:1074-1128`)**:
     - Phase 3C-S1 Report Section 5 claimed `GET /api/v1/media/download/:id` returns `401 AUTH_REQUIRED` when neither bearer auth nor `(expires, uid, sig)` query params are present. In actual `server/routes/api.ts:1079-1125`, the handler looks up `mediaMeta` **before** checking credentials (returning `404` for unknown IDs vs `403 FORBIDDEN_MEDIA_ACCESS` for existing IDs to anonymous callers). No audio bytes leak, but media ID existence is distinguishable pre-auth and the S1 report matrix was inaccurate on the `401` vs `403` status code (similarly, `/voices/cross-lingual-test`, `/voices/:id/export`, and `/speech-to-speech` use `optionalAuth` + `checkVoiceAccess` rather than `requireAuth`, so premade public voices remain accessible anonymously while private voices return `401`/`403`).
6. **Frontend Client Auth Integration (`src/components/Header.tsx`, `src/components/VoiceCloningLabView.tsx`)**:
   - **Audit Finding (`AF-07`, Medium — Broken Cross-Lingual Preview for Cloned Voices in UI, `src/components/VoiceCloningLabView.tsx:464-476`)**: `handleTestLanguage()` posts `voiceId: clonedVoice.id` to `/api/voices/cross-lingual-test` with `headers: { 'Content-Type': 'application/json' }` and **omits `Authorization: Bearer ${token}`**, causing the hardened server endpoint (`api.ts:1376-1394`) to reject the UI action with `401 AUTH_REQUIRED`.
7. **Audit & Database Migration Endpoints (`server/routes/api.ts:346-354, 1299-1302`)**:
   - Both `POST /api/db/migrate` and `GET /api/v1/audit/events` strictly enforce `requireAuth` followed by `requireRole('admin')`.

---

## 3. Review of Phase 3C-S1 Adversarial Tests & Coverage Gaps (Task 2)

Inspection of `test/security/phase3c_s1_auth_remediation.test.ts` (`918` lines, `12` tests) identified five concrete coverage gaps relative to the Phase 3C-S1 acceptance criteria:

| Gap ID | Missing / Incomplete Coverage in `phase3c_s1_auth_remediation.test.ts` | Consequence |
| :--- | :--- | :--- |
| **G-01** | **No post-consent-revocation or post-job-cancellation audio leakage assertions**: Test 10 deleted a newly created voice that had zero synthesis jobs, and Test 7F cancelled a synthetic pending job that had no `outputMediaId` or `result.audioBase64`. Neither `GET /api/v1/tts/jobs` (list) nor `GET /api/v1/media/download/:id` was probed after consent revocation or job cancellation. | Missed **AF-04** (`GET /api/v1/tts/jobs` leaking `161,120` chars of `audioBase64` after consent revocation) and **AF-05** (`GET /api/v1/media/download/:id` returning `200` WAV bytes after job cancellation). |
| **G-02** | **`GET /api/v1/media/download/:id` never called in S1 suite**: Zero requests in `phase3c_s1_auth_remediation.test.ts` hit `/api/v1/media/download/:id`. | Missed **AF-06** (`403` vs claimed `401` on anonymous unsigned download, plus `404` vs `403` pre-auth media ID enumeration). |
| **G-03** | **Alternative `extractToken()` channels (`X-Session-Token`, `?token=`, non-Bearer `Authorization`) not tested**: Test 9 only sent `Authorization: Bearer <bad>` to `/api/v1/auth/me` and `/api/v1/voices`. | Missed **AF-03** (`?token=%20%20%20` silently falling through `optionalAuth` with `200 OK`, and raw non-Bearer `Authorization: <jwt>` succeeding with `200 OK`). |
| **G-04** | **Secondary private-voice & project routes omitted from S1 suite**: `POST /api/voices/cross-lingual-test`, `POST /api/speech-to-speech`, `POST /api/media/transcribe-translate` (`dubbingVoiceId`), `POST /api/v1/audio/reference`, and `GET /api/v1/projects*` were not tested in `phase3c_s1_auth_remediation.test.ts`. | Left cross-tenant enforcement on those 6 routes unverified by S1's regression suite (independently verified in Phase 3C-V2 below). |
| **G-05** | **`PrivateStorageService` & `ConsentVerificationEngine` staging secrets not tested**: Test 5 only asserted `AuthService.getAuthSecret()` in `staging`/`production`. | Missed **AF-01** (`PrivateStorageService.getSigningSecret()` not throwing in `staging` when `VOICEFORGE_STORAGE_SECRET` is unset). |

---

## 4. Existing Test, Typecheck, Build & Persistence Gate Re-Runs (Task 3)

All existing suites and build scripts were re-run without modifying any test or source file (`storage/auth/revoked_tokens.json` backed up and restored byte-for-byte around `durable_revocation.test.ts`, and `npm run clean` run after build checks):

| Gate | Exact Command | Exit Code | Status | Observed Result |
| :--- | :--- | :---: | :---: | :--- |
| **Focused Phase 3C-S1 Suite** | `./node_modules/.bin/tsx --test test/security/phase3c_s1_auth_remediation.test.ts` | `0` | **`PASS`** | `12/12` tests pass (`1673ms`). |
| **All Security Suites** | `VOICEFORGE_REVOCATION_FILE=/tmp/vf_v2_sec.json ./node_modules/.bin/tsx --test test/security/*.test.ts` | `0` | **`PASS`** | `37/37` tests pass across `4` suites (`consent`, `phase3a_security`, `phase3c_s1_auth_remediation`, `watermark`). |
| **All 12 Non-PostgreSQL Node/TS Suites** | `./node_modules/.bin/tsx --test test/unit/*.test.ts test/api/*.test.ts test/security/*.test.ts test/integration/{consent_job_race,durable_revocation,rate_limit_and_db_fail_closed,storage_provider}.test.ts` | `0` | **`PASS`** | `95/95` tests pass across `12/12` suites (`8971ms`). |
| **TypeScript Typecheck** | `npm run lint` (`tsc --noEmit`) | `0` | **`PASS`** | `0` TypeScript errors. |
| **Server Production Build** | `npm run build:server` | `0` | **`PASS`** | Emitted `dist-server/server.js` (`319.8kb` in `21ms`; cleaned via `npm run clean`). |
| **Local Python `omnivoice` Suite** | `python3 services/omnivoice/tests/run_tests.py` | `0` | **`PASS`** | `15/15` tests pass (`0.287s`). |
| **Client Production Build *(Known Unresolved Gate)*** | `npm run build:client` (`vite build`) | `1` | **`FAIL`** | Transforms `2,250` modules, then fails in Rolldown: `Failed to resolve import "react-is" from ".../node_modules/recharts/es6/util/ReactUtils.js"` (Option 1A `--legacy-peer-deps` peer omission vs `bun.lock`). Not repaired per Phase 3C-V2 constraints. |
| **PostgreSQL Persistence Suite *(Known Unresolved Gate)*** | `./node_modules/.bin/tsx --test test/integration/postgres_persistence.test.ts` | `1` | **`BLOCKED` / `FAIL`** | `1/6` pass, `5/6` fail with `ECONNREFUSED` at `127.0.0.1:5433` (no local PostgreSQL daemon; not provisioned per Phase 3C-V2 constraints). |

---

## 5. Independent Security Verification Matrix (Tasks 4, 5 & 6)

All objectives below were **independently verified** via an ephemeral in-process ESM probe executed over stdin (`./node_modules/.bin/tsx --input-type=module -`) mounting `apiRouter` on `127.0.0.1:0` with synthetic PCM WAV buffers and isolated temporary directories (`os.tmpdir()`), leaving zero files or mutations in the workspace.

| # | Security Objective | Verdict | Verification Provenance | Reproduction Method & Command | Observed Status / Result & Side-Effect Check | Source Locations & Residual Path |
| :- | :--- | :---: | :--- | :--- | :--- | :--- |
| **1** | **Anonymous privileged token issuance** | **`PASS`** | Independently verified (live HTTP `127.0.0.1:0` + code audit) | Ephemeral `tsx` HTTP `POST /api/v1/auth/token` with `{"userId":"usr_admin_root","role":"admin"}` and `{}` across `test`, default `development`, `staging`, and `production`. | `403 FORBIDDEN_IDENTITY_CLAIM` on identity/role payload; `401 AUTH_PROVIDER_UNAVAILABLE` on `{}`; `token === undefined`; `AuthService.getUserCount() === 4` (unchanged). | `server/routes/api.ts:126-184`, `server/auth/auth.ts:311-334`. Minor note: JSON array body `[...]` in dev-sandbox mode returns `usr_dev_sandbox` (`role: 'user'`), never privileged (**AF-02**). |
| **2** | **Caller-supplied role, user ID, and email escalation** | **`PASS`** | Independently verified (live HTTP `127.0.0.1:0` + code audit) | `POST /api/v1/auth/token` with `role`/`userId`/`email`; `POST /api/voices/clone/{challenge,verify-consent}` with `userId: "usr_admin_root"`/`"usr_bob_user"` as Alice; `POST /api/v1/voices` with `category: "premade"`. | `/v1/auth/token` -> `403`; `challenge.userId === "usr_alice_user"` and `enroll.voice.userId === "usr_alice_user"` (body `userId` ignored); `/v1/voices` normalizes `category` to `"designed"` and `isPublic: false`. Zero user-store mutations. | `server/routes/api.ts:126-148, 608-695, 959-1006`. No escalation path found. |
| **3** | **Forged or unknown JWT subject elevation** | **`PASS`** | Independently verified (live HTTP `127.0.0.1:0` + code audit) | Signed raw HS256 JWTs with (a) wrong secret (`sub: "usr_admin_root"`), (b) real secret + unregistered `sub: "usr_ghost_999", role: "admin"`, and (c) real secret + `sub: "usr_alice_user", role: "admin"`. Probed `/api/v1/auth/me` and `/api/v1/audit/events`. | Wrong secret -> `401`; unknown `sub` -> `401` and `getUserById("usr_ghost_999") === undefined` (zero hydration); tampered `role: "admin"` for Alice -> `/auth/me` returns authoritative `role: "user"` and `/v1/audit/events` returns `403 FORBIDDEN_ROLE`. | `server/auth/auth.ts:427-513`. Authoritative `userStore` lookup strictly overrides JWT payload claims. |
| **4** | **Anonymous consent revocation & destructive-operation owner spoofing** | **`PASS`** | Independently verified (direct engine call + live HTTP `127.0.0.1:0`) | Direct `ConsentVerificationEngine.revokeConsent(aliceVoiceId, "admin" \| "usr_admin_root")`; anonymous & Bob HTTP calls to `POST /api/voices/clone/revoke-consent`, `DELETE /api/voices/:id`, `DELETE /api/v1/voices/:id`, and `POST /api/v1/auth/revoke` with spoofed `userId`. | Direct engine calls returned `false`; anonymous HTTP calls -> `401`; Bob cross-tenant HTTP calls -> `403`; `isConsentActive(aliceVoiceId) === true`; `isTokenRevoked(aliceToken) === false`; voice retained in catalog. | `server/engine/audio/consent.ts:251-294`, `server/routes/api.ts:192-235, 750-873, 1009-1041`. |
| **5** | **Cross-tenant voice/job access and job cancellation** | **`PASS`** | Independently verified (live HTTP `127.0.0.1:0` across 14 endpoints) | Probed Alice's private voice, job, media, and project anonymously and as `Bob` across `/api/voices`, `/api/v1/voices*`, `/api/voices/:id/export`, `/api/tts/synthesize`, `/api/voices/cross-lingual-test`, `/api/speech-to-speech`, `/api/media/transcribe-translate`, `/api/v1/tts/jobs*`, `/api/v1/jobs/:id*`, `/api/v1/media/download/:id`, and `/api/v1/projects*`. | Anonymous private access -> `401` (`403 FORBIDDEN_MEDIA_ACCESS` on unsigned `/v1/media/download/:id`); cross-tenant `Bob` -> `403` across all private read/synthesis/export/cancel/download/project endpoints; Alice's private voice and project hidden from Bob's list responses. | `server/routes/api.ts:81-116, 458-514, 1074-1297, 1376-1565, 1957-1998, 2639-2818`. Note pre-auth `404` vs `403` media ID oracle (**AF-06**). |
| **6** | **Private audio leakage after consent revocation or cancellation** | **`FAIL`** | Independently verified (live HTTP `127.0.0.1:0` — **new defect discovered**) | (A) Enrolled Alice voice, created job (`161,120` base64 chars), revoked consent (`200`), then immediately called `GET /api/v1/tts/jobs` (list), `GET /api/v1/media/download/:id`, and `GET /api/v1/jobs/:id`. (B) Cancelled processing job with stored media via `POST /api/v1/jobs/:id/cancel` (`200`), then requested `GET /api/v1/media/download/:id` via signed URL and Bearer token. | **(A) Revocation**: Detail routes `/v1/jobs/:id`, `/v1/tts/jobs/:id`, and `/v1/media/download/:id` returned `403`, **BUT `GET /api/v1/tts/jobs` (list) returned `200` with `status: "completed"`, `result.audioBase64` (`161,120` chars), and `outputSignedUrl` intact!** **(B) Cancellation**: Job poll scrubbed `result`/`outputSignedUrl`, **BUT `GET /api/v1/media/download/:id` still returned `200 OK` WAV audio via both signed URL and Bearer header!** | **Residual exploit/leakage paths**: `server/routes/api.ts:1244-1248` (`GET /v1/tts/jobs` skips `isConsentActive` & scrubbing); `server/routes/api.ts:750-828` (revocation does not purge job/media stores); `server/routes/api.ts:2734-2789` (`cancel` does not delete/invalidate `PrivateStorageService` `outputMediaId`). |
| **7** | **Unauthorized audit and migration access** | **`PASS`** | Independently verified (live HTTP `127.0.0.1:0` + code audit) | Probed `GET /api/v1/audit/events` and `POST /api/db/migrate` anonymously, as `creatorToken` (`role: 'creator'`), with elevated-claim JWT (`usr_alice_user` claiming `admin`), and as legitimate `adminToken`. | Anonymous -> `401` on both; `creator` and tampered-claim JWT -> `403 FORBIDDEN_ROLE` on both; legitimate `adminToken` -> `200` on both. | `server/routes/api.ts:346-354, 1299-1302`, `server/auth/auth.ts:593-605`. |
| **8** | **Invalid bearer-token fallback through `optionalAuth`** | **`FAIL`** *(edge case)* | Independently verified (live HTTP `127.0.0.1:0` — **edge-case defect discovered**) | Sent forged `Authorization: Bearer`, revoked `Bearer`, expired `X-Session-Token`, bad `?token=bad.jwt.token`, and whitespace `?token=%20%20%20` across `optionalAuth` routes (`/api/voices`, `/api/v1/voices`, `/api/tts/synthesize`, `/api/voices/clone/challenge`, `/api/voices/:id/export`), plus raw non-Bearer `Authorization: <validJwt>` to `/api/v1/auth/me`. | Forged/revoked/expired/malformed non-empty tokens -> `401` (no fallback). **However, `GET /api/v1/voices?token=%20%20%20` returned `200 OK` (silent anonymous fallback!)**, and raw non-Bearer `Authorization: <validJwt>` + `?token=<validJwt>` returned `200 OK`. | **Residual path**: `server/auth/auth.ts:530-532` trims `"   "` to `""`, which `optionalAuth` (`server/auth/auth.ts:568-570`: `if (!token) return next()`) treats as missing rather than malformed; line `524` accepts non-Bearer `Authorization` headers. |
| **9** | **Zero state mutation on rejected requests (Task 5)** | **`PASS`** | Independently verified (live HTTP `127.0.0.1:0` before/after state diff) | Captured state snapshot (`userCount: 4`, `voicesCount: 9`, `consentRecordsCount: 1`, `jobsCount: 1`, `aliceConsentActive: true`, `aliceTokenRevoked: false`), executed 12 anonymous & cross-tenant mutation/access rejections, and diffed state. | `exactMatch === true` across all 6 stores/invariants (`0` unintended state mutations; only expected `denied` audit log entries appended). | `server/auth/auth.ts`, `server/engine/audio/consent.ts`, `server/routes/api.ts`. |
| **10** | **Dev demo auth disabled in staging/production & non-privileged (Task 6)** | **`PASS`** *(with staging storage-secret note)* | Independently verified (live HTTP `127.0.0.1:0` + env/secret unit checks) | Tested `resolveRuntimeEnvironment` across `'staging'`, `'production'`, `'DEVELOPMENT'`, `'Staging'`, `''`, `'undefined'`; tested `POST /api/v1/auth/token` with `VOICEFORGE_ENABLE_DEV_DEMO_AUTH=true` in `staging`/`production` and token invalidation on transition to `staging`. | `staging`/`production`/uppercase/empty never resolve to `development`; token minting fails closed (`401`/`403`) in `staging`/`production`; dev token grants `role: 'user'` (`usr_dev_sandbox`) only and returns `401` once `NODE_ENV=staging`. *(Note **AF-01**: `PrivateStorageService.getSigningSecret()` does not throw in `staging` when `VOICEFORGE_STORAGE_SECRET` is unset.)* | `server/config/env.ts:22-51`, `server/auth/auth.ts:38-49, 311-334, 496-498`; residual staging storage-secret gap at `server/storage/privateStorage.ts:183-191`. |

---

## 6. Gate Verdict & Prioritized List of Remaining Blockers

### Overall Phase 3C-V2 Security Gate Verdict: **`FAIL`**

While Phase 3C-S1 successfully closed the critical anonymous admin token minting (`V-01`), unknown JWT subject hydration & claim elevation (`V-02`), body `userId`/`admin` spoofing (`V-04`, `V-05`), unauthenticated `v1Router` job/voice access (`V-08`), and unauthenticated `/db/migrate` & `/v1/audit/events` exposure (`V-07`), **the security gate cannot be marked `PASS`** until the post-revocation / post-cancellation audio leakage paths, `extractToken`/`optionalAuth` edge cases, and unresolved build/persistence gates below are closed.

### Prioritized Remaining Blockers (Input Scope for Phase 3C-S2 & Build/DB Gate Closure)

1. **`[P0 — Security Blocker]` Eliminate Private Audio Leakage After Consent Revocation & Job Cancellation (`AF-04`, `AF-05`)**:
   - In `POST /api/voices/clone/revoke-consent` (`server/routes/api.ts:750-828`) and `DELETE /api/voices/:id` / `DELETE /api/v1/voices/:id`: eagerly scrub `result` and `outputSignedUrl` on all matching jobs in `memoryStore.synthesisJobs` and `asyncJobsLedger`, mark them `'cancelled'`, and delete associated `PrivateMediaRecord` artifacts via `PrivateStorageService.deleteMedia(...)`.
   - In `GET /api/v1/tts/jobs` (`server/routes/api.ts:1244-1248`): enforce `ConsentVerificationEngine.isConsentActive(j.voiceId)` and scrub `result` / `outputSignedUrl` on any revoked or cancelled job before serializing the list response.
   - In `POST /api/v1/jobs/:id/cancel` (`server/routes/api.ts:2734-2789`): if `job.outputMediaId` exists, delete the underlying artifact from `PrivateStorageService` (and reject downloads in `GET /api/v1/media/download/:id` when the parent job is `cancelled`).
2. **`[P1 — Security Hardening]` Harden `AuthService.extractToken()` & `optionalAuth` (`AF-03`)**:
   - Reject any present-but-whitespace/malformed `Authorization`, `X-Session-Token`, or `token` credential in both `requireAuth` and `optionalAuth` with `401` (distinguish "no credential supplied" from "malformed/empty credential supplied").
   - Require strict `Bearer <token>` syntax on `Authorization` headers (never accept raw `<jwt>` without `Bearer `) and remove `?token=` query-parameter session extraction unless explicitly required for a narrow, short-lived stream endpoint.
3. **`[P1 — Restricted-Env Cryptography]` Fail Closed on Missing `VOICEFORGE_STORAGE_SECRET` & `VOICEFORGE_CONSENT_SECRET` in `staging` and `production` (`AF-01`)**:
   - Replace `process.env.NODE_ENV === 'production'` in `PrivateStorageService.getSigningSecret()` (`server/storage/privateStorage.ts:185`) with `isRestrictedEnvironment(process.env.NODE_ENV)`.
   - Replace static import-time `ConsentVerificationEngine.SERVER_SECRET` (`server/engine/audio/consent.ts:57`) with a dynamic secret getter that throws in `isRestrictedEnvironment()` when `VOICEFORGE_CONSENT_SECRET` is unset.
4. **`[P1 — Build Gate Blocker]` Resolve Missing `react-is` Peer Dependency in `npm run build:client`**:
   - Under `bun.lock`, Bun auto-installed `recharts@3.10.1`'s peer dependency `react-is@19.3.0`, whereas root `package.json` omits `react-is` and npm Option 1A (`--legacy-peer-deps`) skips undeclared peer dependencies, breaking `vite build` (`Rolldown`). Requires explicit authorization to declare `"react-is"` in `package.json` / install `react-is@19.3.0` or run under `bun install --frozen-lockfile`.
5. **`[P1 — Persistence Gate Blocker]` Provision Ephemeral PostgreSQL for `test/integration/postgres_persistence.test.ts`**:
   - Execute `test/integration/postgres_persistence.test.ts` against a live PostgreSQL instance on `127.0.0.1:5433` so all `13/13` test suites (`101/101` subtests) in `npm test` pass (`0` failures), and isolate `test/integration/durable_revocation.test.ts` via `VOICEFORGE_REVOCATION_FILE` so running `npm test` never mutates tracked `storage/auth/revoked_tokens.json`.
6. **`[P2 — Secondary API & UI Hygiene for Phase 3C-S2]`**:
   - Attach `Authorization: Bearer ${token}` in `src/components/VoiceCloningLabView.tsx:468` (`handleTestLanguage` -> `POST /api/voices/cross-lingual-test`) (**AF-07**).
   - Return `401 AUTH_REQUIRED` before `mediaMeta` lookup on completely unsigned/unauthenticated `GET /api/v1/media/download/:id` requests to eliminate pre-auth media ID enumeration (**AF-06**), and reject `Array.isArray(req.body)` on `POST /api/v1/auth/token` (**AF-02**).
   - Gate unauthenticated non-v1 mutation/compute routes (`/api/dictionary*`, `/api/billing/topup`, `/api/media/jobs`, `/api/videos/jobs*`, `/api/music/generate`, `/api/images/generate`, `/api/videos/*`, `/api/paper2audio/*`) and unify `X-Forwarded-For` proxy-trust handling in audit logs.
