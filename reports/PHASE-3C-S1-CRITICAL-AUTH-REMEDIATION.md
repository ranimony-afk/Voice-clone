# PHASE 3C-S1 — CRITICAL AUTHENTICATION & AUTHORIZATION REMEDIATION REPORT

- **Repository**: `https://github.com/ranimony-afk/Voice-clone` (`/home/user/Voice-clone`)
- **Working Branch**: `arena/3b3635b6-voice-clone` (`active`)
- **Base Commit (`HEAD`)**: `594593a129ee586e29143933e09b4ee634460567` (matches `main` and `origin/main`)
- **Audit / Execution Date**: `2026-10-28` (`Asia/Calcutta`)
- **Prior Artifact Preserved**: `reports/PHASE-0-NEW-ARENA-BOOTSTRAP-AND-ROADMAP.md` (`SHA-256: 2a3672393f93bd4fcb954f024245dec2abec64b789335ece06669f138b5a2772`)
- **Phase 3C-S1 Verdict**: **`PASS WITH CONDITIONS`**
  - **Security Remediation & Auth/Authz Regression Gates**: **PASS** (`12/12` new adversarial/positive auth scenarios pass; `95/95` non-PostgreSQL Node/TS tests across `12/12` suites pass; `tsc --noEmit` passes; `esbuild` server bundle passes; `15/15` local Python `omnivoice` tests pass).
  - **Conditions Preventing Unconditional `PASS`** (environmental / Option 1A dependency limitation, not auth defects):
    1. **`npm run build:client` (`vite build`) — Option 1A `--legacy-peer-deps` peer-dependency gap vs `bun.lock`**: Transforms all `2,250` modules (including modified `src/components/Header.tsx` and `src/components/VoiceCloningLabView.tsx`), then exits `1` when Rolldown resolves `recharts/es6/util/ReactUtils.js -> "react-is"` (`BillingDashboard.tsx`). `recharts@3.10.1` declares `react-is` in `peerDependencies`, `package.json` omits `react-is` from direct `dependencies`, `bun.lock` auto-installed `react-is@19.3.0`, and npm 10's `--legacy-peer-deps` skips undeclared peer dependencies. Because adding packages or altering `package.json` / `vite.config.ts` was out of scope under Option 1A constraints, this condition is documented transparently rather than masked.
    2. **`test/integration/postgres_persistence.test.ts` — `BLOCKED` (no local PostgreSQL service)**: `127.0.0.1:5433` and `127.0.0.1:5432` return `ECONNREFUSED` in this sandbox (neither PostgreSQL nor Docker is installed).

---

## 1. Preflight & Dependency State

### 1.1 Repository & Worktree Preconditions
Before installing dependencies or editing source files, the repository state was verified:
- **Repository root**: `/home/user/Voice-clone` (shallow depth-1 clone).
- **Branch & commit**: `arena/3b3635b6-voice-clone` at `594593a129ee586e29143933e09b4ee634460567` (zero tracked diffs vs `origin/main` before Phase 3C-S1 edits).
- **Available runtimes**: `node v22.22.3`, `npm 10.9.8`, `python3 3.11.2`. Unavailable: `bun`, `pnpm`, `yarn`, `psql`, `pg_isready`, `docker`, `ffmpeg`, `pytest`.
- **Outbound network**: Restricted sandbox allowlist (`registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`, `github.com`, `api.github.com`, `codeload.github.com`).

### 1.2 Dependency Installation History & Authorized Option 1A Execution
1. **Initial unflagged npm attempt (stopped per stop-condition rule)**:
   - Command: `npm install --no-package-lock --ignore-scripts`
   - Outcome: Exit `1` (`ERESOLVE could not resolve`). Root `package.json` declares `"vite": "^8.3.0"` (npm resolved `vite@8.3.5`, which declares `peerOptional esbuild@"^0.27.0 || ^0.28.0"`) alongside root devDependency `"esbuild": "^0.25.0"` (`esbuild@0.25.12`). No files or lockfiles were written.
2. **Authorized Option 1A execution**:
   - Command: `npm install --no-package-lock --ignore-scripts --legacy-peer-deps`
   - Outcome: Exit `0` (`added 242 packages, and audited 243 packages in 9s`, `0 vulnerabilities`; npm deprecation warning on transitive `node-domexception@1.0.0`).
3. **Post-install integrity & binary checks**:
   - `package.json` unchanged: `96cb310c3093ccd9cc352f8bbfd007fdb97c33b88bf1ab0c02839cd74470d400`
   - `bun.lock` unchanged: `6dbe0469946c602996493bb706e9eff060cf5ed1afd2c71134b23afdcb826e48`
   - `storage/auth/revoked_tokens.json` unchanged (`135` bytes): `6c29f5194bb7fbe434fe464610eb790756191e31ee6a938c12225b61f3a70e2e`
   - `reports/PHASE-0-NEW-ARENA-BOOTSTRAP-AND-ROADMAP.md` unchanged: `2a3672393f93bd4fcb954f024245dec2abec64b789335ece06669f138b5a2772`
   - `package-lock.json` / `npm-shrinkwrap.json`: Not created.
   - Local tool binaries & native Linux x64 bindings verified (`--ignore-scripts` safe because prebuilt optional platform packages were installed): `tsx v4.23.15`, `tsc Version 7.0.2`, `vite/8.3.5 linux-x64 node-v22.22.3`, `esbuild 0.25.12`, `@rolldown/binding-linux-x64-gnu@1.2.15`, `@tailwindcss/oxide-linux-x64-gnu@4.3.3`.

### 1.3 Lockfile Drift & Option 1A Limitations vs `bun.lock`
> **Truthfulness Disclosure**: The `node_modules/` tree installed via npm Option 1A (`--legacy-peer-deps`) **does NOT reproduce the `bun.lock` environment**.

| Package | `bun.lock` Version | npm Option 1A Version | Drift / Impact |
| :--- | :--- | :--- | :--- |
| `@google/genai` | `2.28.0` | `2.31.0` | Minor caret drift (`^2.4.0`) |
| `@rolldown/binding-linux-x64-gnu` | `1.2.13` | `1.2.15` | Transitive patch drift via `vite@8.3.5` |
| `autoprefixer` | `10.6.1` | `10.6.2` | Patch caret drift (`^10.4.21`) |
| `react` | `19.3.0` | `19.3.1` | Patch caret drift (`^19.0.1`) |
| `react-dom` | `19.3.0` | `19.3.1` | Patch caret drift (`^19.0.1`) |
| `vite` | `8.3.4` | `8.3.5` | Patch caret drift (`^8.3.0`) |
| `react-is` *(peer of `recharts@3.10.1`)* | `19.3.0` *(auto-installed by Bun)* | **Not installed** | `recharts@3.10.1` declares `react-is` in `peerDependencies` (not `dependencies`), and root `package.json` omits `react-is`. npm `--legacy-peer-deps` skips undeclared peer dependencies, causing `vite build` (`Rolldown`) to fail resolving `react-is` in `recharts/es6/util/ReactUtils.js` (`BillingDashboard.tsx`). |

---

## 2. Vulnerability Root-Cause Table

| ID | Pre-Remediation `file:line` | Old Behavior | Concrete Exploit Path | New Behavior (Phase 3C-S1) |
| :--- | :--- | :--- | :--- | :--- |
| **V-01** | `server/routes/api.ts:276-310` | `POST /api/v1/auth/token` accepted anonymous `userId`, `email`, and `role` (`user`/`creator`/`admin`) from `req.body`, gated only by `process.env.NODE_ENV === 'production'`, and minted valid 8h HMAC tokens via `AuthService.createDemoToken(...)`. | Any unauthenticated caller in `development`, `test`, or **`staging`** (`NODE_ENV=staging !== 'production'`) could `POST {"userId":"usr_admin_root"}` or `{"role":"admin"}` to mint a full admin bearer token or impersonate any existing tenant. | `POST /api/v1/auth/token` fails closed (`401 AUTH_PROVIDER_UNAVAILABLE`) in all environments by default, rejects any `role`/`userId`/`email` claim (`403 FORBIDDEN_IDENTITY_CLAIM`), and only issues a nonprivileged `usr_dev_sandbox` (`role: 'user'`, 1h TTL) token when `resolveRuntimeEnvironment() === 'development'` **and** `VOICEFORGE_ENABLE_DEV_DEMO_AUTH === 'true'`. |
| **V-02** | `server/auth/auth.ts:154-200` | `AuthService.createDemoToken` created/mutated arbitrary principals with caller-supplied `role` in `userStore`; `verifyToken` hydrated unknown `sub` claims from token payload (`role: payload.role`) when missing from `userStore`. | Even without `/auth/token` mutation, any token signed with a forged/elevated `role` or non-existent `sub` was auto-hydrated into memory with the JWT's claimed `role`, bypassing server-side role revocation/demotion. | `createDemoToken` removed and replaced by `issueDevSandboxToken()` (`development` + `VOICEFORGE_ENABLE_DEV_DEMO_AUTH=true` only). `verifyToken()` requires `HS256`/`JWT` header, finite `iat`/`exp`, unrevoked hash, and existing `userStore` principal; ignores JWT `role`/`email` claims in favor of authoritative `userStore` record and never hydrates unknown subjects. |
| **V-03** | `server/config/env.ts:13-63`, `server/auth/auth.ts:36-47`, `server.ts:30,90,113,128` | `ALLOWED_NODE_ENVS` omitted `'staging'` and fell back to `'development'` for unrecognized `NODE_ENV` values; `getAuthSecret()` only threw when `NODE_ENV === 'production'`. | Deploying with `NODE_ENV=staging` silently degraded parsed config to `'development'`, allowed fallback HMAC dev secret usage when `VOICEFORGE_AUTH_SECRET` was unset, and exposed unredacted 500 error messages. | Added `'staging'` to `ALLOWED_NODE_ENVS` and introduced fail-closed `resolveRuntimeEnvironment()` (unset -> `'development'`; `'development'\|'staging'\|'production'\|'test'` preserved; any other explicit string -> `'production'`). `getAuthSecret()`, `server.ts` DB startup checks, `/readyz`, and 500 error redaction enforce restricted behavior across `'staging'` and `'production'`. |
| **V-04** | `server/routes/api.ts:436-481`, `server/engine/audio/consent.ts:144-169` | `POST /api/voices/clone/revoke-consent` used `optionalAuth` and `const userId = req.user?.id \|\| req.body?.userId \|\| 'anonymous'`; `ConsentVerificationEngine.revokeConsent` treated `userId === 'admin' \|\| userId === 'usr_admin_root'` as privileged bypass and unconditionally added `voiceId` to `revokedVoiceIds` before verifying ownership. | Any anonymous user could `POST {"voiceId":"v_victim","userId":"admin"}` (or `"usr_admin_root"`) to permanently revoke any tenant's biometric consent and brick their cloned voices. | Route now requires `requireAuth`, derives identity strictly from `req.user`, verifies voice existence (`404`) and `voice.ownerId === req.user.id \|\| req.user.role === 'admin'` (`403`) before touching consent state, and `ConsentVerificationEngine.revokeConsent` requires explicit `{ isAdmin, recordRevocationMarker }` options with zero magic `userId` strings. |
| **V-05** | `server/routes/api.ts:483-521` | `DELETE /api/voices/:id` used `optionalAuth` and fell back to `req.body?.userId`, treating `userId === 'admin'` as admin override. | Any anonymous caller could delete any user's custom cloned voice by passing `{"userId":"admin"}` or the victim's `userId` in the `DELETE` JSON body, which also recorded a revocation tombstone. | Route now requires `requireAuth`, derives identity solely from `req.user`, rejects non-owner/non-admin callers with `403 UNAUTHORIZED_VOICE_DELETE`, and leaves custom voices and consent state untouched on denial. |
| **V-06** | `server/routes/api.ts:340-435,541-885` | `GET /api/voices`, `POST /api/tts/synthesize`, `POST /api/voices/clone/{challenge,verify-consent}`, `POST /api/voices/{upload-sample,cross-lingual-test,design}`, `GET /api/voices/:id/export`, `POST /api/media/transcribe-translate`, and `POST /api/speech-to-speech` either leaked all private `customVoices`, trusted `req.body.userId`, fell back to `customVoices[0]` when `voiceId` failed lookup, or lacked ownership checks. | Anonymous/cross-tenant callers could enumerate private voices via `GET /api/voices`, synthesize or export another user's private voice (including silent `customVoices[0]` fallback), or enroll voices attributed to arbitrary `req.body.userId` principals. | `GET /api/voices` & `GET /api/v1/voices` filter via `filterVisibleVoices(req.user)` (public presets + caller's own voices; all voices for `admin`). Private voice synthesis/export/S2S/cross-lingual require authenticated owner or `admin` (`checkVoiceAccess`), remove `customVoices[0]` fallback (`404 VOICE_NOT_FOUND`), check `isVoiceRevoked`, and never read `req.body.userId`. |
| **V-07** | `server/routes/api.ts:313-325,529-535,612-631` | `POST /api/v1/auth/revoke` revoked any bearer token presented without checking principal ownership; `POST /api/db/migrate` had zero auth middleware; `GET /api/v1/audit/events` allowed any authenticated regular user to read the global audit trail. | Anonymous callers could trigger DB migrations (`POST /api/db/migrate`), any non-admin user could inspect cross-tenant audit logs (`GET /api/v1/audit/events`), and callers could submit arbitrary tokens to `/auth/revoke` without matching identity. | `POST /api/db/migrate` and `GET /api/v1/audit/events` enforce `requireAuth` + `requireRole('admin')`. `POST /api/v1/auth/revoke` enforces `requireAuth` and restricts revoking third-party tokens to `admin` (`403 FORBIDDEN`). |
| **V-08** | `server/routes/api.ts:887-1052` (`v1Router`) | Nested `v1Router` contained unauthenticated duplicate routes (`GET /voices`, `DELETE /voices/:id`, `POST /tts/jobs`) plus active unauthenticated handlers for `GET /v1/voices/:id`, `POST /v1/audio/reference`, `GET /v1/jobs/:id` (returning `result.audioBase64`), `POST /v1/jobs/:id/cancel`, `GET\|POST /v1/projects*`, and `POST /v1/visuals/render` (storing jobs with `userId: 'anonymous'`). `GET /v1/media/download/:id` returned `403` instead of `401` on completely unauthenticated unsigned requests. | Any anonymous or cross-tenant caller knowing/guessing a `jobId` or `voiceId` could fetch private voice metadata via `GET /api/v1/voices/:id`, download raw synthesized audio via `GET /api/v1/jobs/:id` (`result.audioBase64`), cancel another user's job via `POST /api/v1/jobs/:id/cancel`, or read/mutate shared `projectsStore` and visual render jobs. | Removed shadowed unauthenticated duplicates; enforced `requireAuth` + tenant ownership (`ownerId`/`userId === req.user.id \|\| admin`) across `GET /v1/voices/:id`, `POST /v1/audio/reference`, `GET /v1/jobs/:id` (plus post-revocation `403 CONSENT_REVOKED` scrubbing `result`/`outputSignedUrl`), `POST /v1/jobs/:id/cancel`, `GET\|POST /v1/projects*`, and `POST /v1/visuals/render`. `GET /v1/media/download/:id` now returns `401 AUTH_REQUIRED` when neither bearer auth nor complete `(expires, uid, sig)` query params are supplied. |
| **V-09** | `server/auth/auth.ts:251-265` (`optionalAuth`) | `optionalAuth` silently ignored malformed, forged, expired, or revoked `Authorization: Bearer ...` headers and allowed the request to proceed as anonymous. | Callers presenting revoked or tampered bearer tokens on `optionalAuth` routes (`GET /voices`, `POST /tts/synthesize` for presets, `POST /voices/clone/challenge`) were silently downgraded instead of rejected fail-closed. | `optionalAuth` passes through only when no `Authorization` header is supplied; any malformed header or invalid/expired/revoked bearer token immediately returns `401 INVALID_TOKEN` / `MALFORMED_AUTH_HEADER`. |
| **V-10** | `src/components/Header.tsx:31-42`, `src/components/VoiceCloningLabView.tsx:161-193,240-264` | Frontend sent spoofed body fields (`role: 'creator'` to `/api/v1/auth/token`, `userId: 'usr_default_creator'` to `challenge`, `userId: 'user_active'` to `revoke-consent`) without attaching stored `Bearer` headers on `challenge`/`verify-consent`/`revoke-consent`/`DELETE /api/voices/:id`. | UI relied on the vulnerable body-spoofing contract and would send rejected `role` claims or unauthenticated destructive requests once server auth hardened. | Removed all client-supplied `role`/`userId` body claims, sent `{}` to `/api/v1/auth/token` with clear fail-closed handling when dev demo auth is disabled, and attached `Authorization: Bearer <token>` from `localStorage` across `challenge`, `verify-consent`, `revoke-consent`, and `DELETE /api/voices/:id`. |

---

## 3. Authentication & Authorization Model After Phase 3C-S1

### 3.1 Fail-Closed Environment & Secret Resolution
- **`resolveRuntimeEnvironment()` (`server/config/env.ts`)**:
  - Unset `NODE_ENV` (`undefined`, including Node's `process.env.NODE_ENV = undefined` string coercion `'undefined'`) resolves to `'development'`.
  - Explicit `'development'`, `'staging'`, `'production'`, and `'test'` resolve to their exact canonical tier.
  - Any empty or unrecognized `NODE_ENV` string (e.g., `''`, `'stage'`, `'prod'`) fails closed to `'production'`.
- **Cryptographic Secret Enforcement (`server/auth/auth.ts`, `server.ts`)**:
  - `isRestrictedEnvironment()` returns `true` for both `'staging'` and `'production'` (and any unknown `NODE_ENV` via fail-closed resolution).
  - `getAuthSecret()` throws `FATAL SECURITY CONFIGURATION: VOICEFORGE_AUTH_SECRET must be explicitly configured in staging and production.` whenever `VOICEFORGE_AUTH_SECRET` is missing/blank in restricted environments.

### 3.2 Token Issuance (`POST /api/v1/auth/token`) & Token Verification (`AuthService.verifyToken`)
- **No Unauthenticated Privileged or Impersonated Issuance**:
  - Any request body supplying `role`, `userId`, or `email` is immediately rejected with `403 FORBIDDEN_IDENTITY_CLAIM` and audited (`auth.token.denied_claim_injection`).
  - When `resolveRuntimeEnvironment() !== 'development'` **or** `process.env.VOICEFORGE_ENABLE_DEV_DEMO_AUTH !== 'true'`, `POST /api/v1/auth/token` fails closed with `401 AUTH_PROVIDER_UNAVAILABLE` (no fake password/secret authentication system was invented).
  - Only when `NODE_ENV=development` (or unset) **and** `VOICEFORGE_ENABLE_DEV_DEMO_AUTH=true` does `POST /api/v1/auth/token` (with an empty `{}` body) mint a 1-hour sandbox token strictly bound to frozen `DEV_SANDBOX_USER` (`id: 'usr_dev_sandbox'`, `role: 'user'`).
- **Server-Authoritative Token Verification**:
  - `verifyToken()` validates exact 3-segment JWT format, `{"alg":"HS256","typ":"JWT"}` header, constant-time `crypto.timingSafeEqual` HMAC-SHA256 signature (supporting optional `VOICEFORGE_AUTH_SECRET_PREVIOUS` rotation), SHA-256 revocation denylist (`revocationStore.isRevoked`), non-empty `sub`, and finite numeric `iat`/`exp` with `exp > now`.
  - Unknown subjects (`!userStore.get(payload.sub)`) are **rejected (`null`)** and never hydrated into `userStore`.
  - Stored `userStore` state is the sole source of `id`, `email`, `role`, and `tenantId`; elevated `role` claims inside a signed JWT payload are ignored.
  - `usr_dev_sandbox` tokens are rejected whenever `resolveRuntimeEnvironment() !== 'development'` or `VOICEFORGE_ENABLE_DEV_DEMO_AUTH !== 'true'`.

### 3.3 Tenant Isolation, Biometric Consent, and Destructive Operations
- **Voice Visibility & Access**:
  - Preset library voices (`category !== 'Cloned' && !isCloned && !ownerId`) remain readable/synthesizable for public preview (`GET /api/voices`, `POST /api/tts/synthesize`), while `optionalAuth` rejects invalid/revoked tokens.
  - Custom/cloned/designed voices always carry a verified `ownerId` (`req.user.id`), are invisible to anonymous and other non-admin tenants, cannot be synthesized/exported/deleted cross-tenant (`403`), and never fall back to `customVoices[0]` (`404 VOICE_NOT_FOUND`).
- **Biometric Consent & Job Artifact Isolation**:
  - `POST /api/voices/clone/verify-consent` requires `requireAuth`; `challenge` binds to `req.user.id` when authenticated (`'anonymous'` only if unauthenticated, which cannot verify for an authenticated user because `verifyAndEnroll` enforces `challenge.userId === userId`).
  - `POST /api/voices/clone/revoke-consent` and `DELETE /api/voices/:id` (`/api/v1/voices/:id`) require `requireAuth` and verified owner or `admin` role before mutating `customVoices` or `ConsentVerificationEngine` state.
  - Synthesis jobs (`POST /api/v1/tts/jobs`, `GET /api/v1/tts/jobs/:id`, `GET /api/v1/jobs/:id`, `POST /api/v1/jobs/:id/cancel`), projects (`/api/v1/projects*`), visual renders (`/api/v1/visuals/render`), and media downloads (`/api/v1/media/download/:id`) enforce `requireAuth` (or valid HMAC-signed `(expires, uid, sig)` URL on media download) plus strict tenant ownership (`job.userId === req.user.id || req.user.role === 'admin'`), and scrub `result`/`outputSignedUrl` with `403 CONSENT_REVOKED` if voice consent was revoked.

---

## 4. Files Changed and Why

| File Path | Status | Diff (`+/-`) | Why Changed |
| :--- | :--- | :--- | :--- |
| `server/config/env.ts` | Modified | `+71 / -12` | Added `'staging'` to `ALLOWED_NODE_ENVS`; added fail-closed `resolveRuntimeEnvironment()`, `isDevelopmentEnvironment()`, and `isRestrictedEnvironment()` so `staging` and unknown `NODE_ENV` values never degrade to `development` (while handling Node's `'undefined'` string coercion safely). |
| `server/auth/auth.ts` | Modified | `+338 / -92` | Enforced `VOICEFORGE_AUTH_SECRET` in `staging` and `production`; froze `PRELOADED_USERS`; replaced `createDemoToken` with gated `issueDevSandboxToken` (`usr_dev_sandbox`, `role: 'user'`); added `VOICEFORGE_REVOCATION_FILE` isolation support; hardened `verifyToken` (strict `HS256`, mandatory `exp`/`iat`, no subject hydration, authoritative `userStore` role lookup); hardened `optionalAuth` (`401` on invalid/revoked bearer tokens); sanitized `requireOwner` errors. |
| `server/engine/audio/consent.ts` | Modified | `+29 / -15` | Removed magic `'admin'` / `'usr_admin_root'` strings and unconditional pre-check `revokedVoiceIds.add(voiceId)` from `ConsentVerificationEngine.revokeConsent`; added explicit `{ isAdmin, recordRevocationMarker }` options. |
| `server.ts` | Modified | `+12 / -6` | Replaced `NODE_ENV === 'production'` checks with `resolveRuntimeEnvironment()` and `isRestrictedEnvironment()` for startup DB validation, `/readyz` reporting, error sanitization, and static serving. |
| `server/routes/api.ts` | Modified | `+810 / -237` | Remediated Objectives 4A–4D across `/v1/auth/token`, `/v1/auth/revoke`, `/db/migrate`, `/v1/audit/events`, `/voices*`, `/tts/synthesize`, `/voices/clone/*`, `/v1/voices*`, `/v1/tts/jobs*`, `/media/transcribe-translate`, `/speech-to-speech`, and `v1Router` (`/v1/voices/:id`, `/v1/audio/reference`, `/v1/jobs/:id*`, `/v1/media/download/:id`, `/v1/projects*`, `/v1/visuals/render`). |
| `src/components/Header.tsx` | Modified | `+15 / -4` | Removed `role: 'creator'` body payload on `/api/v1/auth/token` and surfaced server fail-closed error messages cleanly when dev demo auth is disabled. |
| `src/components/VoiceCloningLabView.tsx` | Modified | `+25 / -11` | Removed hardcoded `userId: 'usr_default_creator'` and `userId: 'user_active'` spoofing fields and attached `Authorization: Bearer` headers from `localStorage` across `challenge`, `verify-consent`, `revoke-consent`, and `DELETE /api/voices/:id`. |
| `test/api/routes.test.ts` | Modified | `+63 / -18` | Updated integration assertions to verify `challenge` ignores spoofed `req.body.userId` (`data.userId === 'anonymous'`) and `/api/v1/{tts/jobs,jobs/:id,projects,visuals/render}` reject anonymous callers (`401`) while succeeding with authenticated `aliceToken`. |
| `test/security/phase3c_s1_auth_remediation.test.ts` | Added | `+922 / -0` | New 12-scenario adversarial & positive HTTP regression suite bound to `127.0.0.1:0` with synthetic WAV fixtures and isolated revocation storage, proving every Phase 3C-S1 objective and zero protected state mutation on rejected requests. |
| `reports/PHASE-3C-S1-CRITICAL-AUTH-REMEDIATION.md` | Added | Report | This Phase 3C-S1 remediation, verification, dependency drift, and roadmap report. |

---

## 5. Endpoint-by-Endpoint Before / After Security Matrix

| Endpoint | Before Phase 3C-S1 | After Phase 3C-S1 |
| :--- | :--- | :--- |
| `POST /api/v1/auth/token` | Anonymous; trusted `req.body.{userId,email,role}` in `dev`/`test`/`staging`; minted `admin` tokens and mutated `userStore`. | Rejects any `role`/`userId`/`email` (`403`); fails closed (`401`) unless `NODE_ENV=development` **and** `VOICEFORGE_ENABLE_DEV_DEMO_AUTH=true`, issuing only `usr_dev_sandbox` (`role: 'user'`). |
| `POST /api/v1/auth/revoke` | No `requireAuth`; revoked any token string passed in header/body without checking token ownership. | `requireAuth`; caller may revoke only their own token unless `req.user.role === 'admin'` (`403`). |
| `GET /api/v1/auth/me` | `requireAuth`, but `verifyToken` trusted hydrated token claims / unknown `sub`. | `requireAuth` backed by hardened `verifyToken` (authoritative `userStore` lookup, zero hydration). |
| `POST /api/db/migrate` | Unauthenticated (`0` auth middleware). | `requireAuth` + `requireRole('admin')`. |
| `GET /api/v1/audit/events` | `requireAuth` only (any regular user could read global audit events). | `requireAuth` + `requireRole('admin')`. |
| `GET /api/voices` & `GET /api/v1/voices` | Returned all in-memory `customVoices` (including private cloned voices of all tenants) to anonymous callers. | `optionalAuth` (strict token validation) + `filterVisibleVoices(req.user)` (public presets + caller's own voices; all voices for `admin`). |
| `GET /api/v1/voices/:id` | Unauthenticated in `v1Router`; leaked private voice metadata by ID. | `optionalAuth` + `checkVoiceAccess` (`401` anonymous on private voice; `403` cross-tenant; `200` owner/admin or public preset). |
| `POST /api/voices/clone/challenge` | `optionalAuth` + trusted `req.body.userId` (`usr_admin_root` / victim ID). | `optionalAuth` (strict) + server-derived `req.user?.id \|\| 'anonymous'` (`req.body.userId` ignored). |
| `POST /api/voices/clone/verify-consent` | `optionalAuth` + trusted `req.body.userId`; allowed anonymous enrollment under spoofed owner IDs. | `requireAuth`; binds enrolled voice `ownerId` and challenge verification strictly to `req.user.id`. |
| `POST /api/voices/clone/revoke-consent` | `optionalAuth` + trusted `req.body.userId` (`'admin'`/`'usr_admin_root'` bypass) + pre-check revocation tombstone. | `requireAuth`; verifies voice existence (`404`) and `ownerId === req.user.id \|\| admin` (`403`) before mutating consent state. |
| `DELETE /api/voices/:id` & `DELETE /api/v1/voices/:id` | Legacy route used `optionalAuth` + `req.body.userId` (`'admin'` bypass); `v1Router` had duplicate unauthenticated `DELETE /voices/:id`. | Both require `requireAuth` + `ownerId === req.user.id \|\| admin` (`403`); shadowed unauthenticated `v1Router` duplicate removed. |
| `POST /api/v1/voices` | `requireAuth` (retained), plus shadowed duplicate cleanup. | `requireAuth`; `ownerId: req.user.id` enforced; consent record verified against `req.user.id` unless `admin`. |
| `POST /api/voices/upload-sample` | Unauthenticated; created custom voice without `ownerId`. | `requireAuth`; binds `ownerId: req.user.id` (`isPublic: false`). |
| `POST /api/voices/design` | Unauthenticated; created custom voice without `ownerId`. | `requireAuth`; binds `ownerId: req.user.id` (`isPublic: false`). |
| `GET /api/voices/:id/export` | Unauthenticated; exported any tenant's private voice metadata/config. | `requireAuth`; private voices require `ownerId === req.user.id \|\| admin` (`403`) and unrevoked consent (`403 CONSENT_REVOKED`). |
| `POST /api/tts/synthesize` | Fell back to `customVoices[0]` when `voiceId` not found; allowed anonymous/cross-tenant synthesis of private cloned voices. | `optionalAuth` (strict); removes `customVoices[0]` fallback (`404`); private voices require authenticated owner/admin (`401`/`403`) and active consent (`403`). |
| `POST /api/voices/cross-lingual-test` | Unauthenticated; fell back to `customVoices[0]` and synthesized private voices without ownership/consent checks. | `requireAuth` + `checkVoiceAccess` + `isVoiceRevoked` check; no `customVoices[0]` fallback. |
| `POST /api/speech-to-speech` | Unauthenticated; fell back to `customVoices[0]` and synthesized private voices without ownership/consent checks. | `requireAuth` + `checkVoiceAccess` + `isVoiceRevoked` check; no `customVoices[0]` fallback. |
| `POST /api/media/transcribe-translate` | Unauthenticated when `cloneVoice` used; trusted `req.body.userId` for voice cloning. | `optionalAuth` (strict); requires `requireAuth` (`401`) when `cloneVoice` is requested and binds `ownerId: req.user.id`; enforces `checkVoiceAccess` on `targetVoiceId`. |
| `POST /api/v1/audio/reference` | Unauthenticated in `v1Router`; stored reference uploads without tenant binding. | `requireAuth`; binds `ownerId: req.user.id` and generates signed URL scoped to `req.user.id`. |
| `POST /api/v1/tts/jobs` | `apiRouter` had global unscoped `Idempotency-Key` map (cross-tenant job leak) and allowed synthesizing another user's private voice; `v1Router` had unauthenticated duplicate. | `requireAuth`; `checkVoiceAccess` enforced on private voices; idempotency keys scoped to `${req.user.id}:${idempotencyKey}`; shadowed `v1Router` duplicate removed. |
| `GET /api/v1/tts/jobs/:id` & `GET /api/v1/jobs/:id` | `GET /api/v1/jobs/:id` was completely unauthenticated and leaked `result.audioBase64` for any tenant's job. | Both require `requireAuth`, enforce `job.userId === req.user.id \|\| admin` (`403`), check `isVoiceRevoked` (`403 CONSENT_REVOKED`), and scrub `result`/`outputSignedUrl` when revoked or cancelled. |
| `POST /api/v1/jobs/:id/cancel` | Unauthenticated in `v1Router`; any anonymous caller could cancel any user's queued/active job. | `requireAuth` + `job.userId === req.user.id \|\| admin` (`403`) + scrubs `result`/`outputSignedUrl` on cancel. |
| `GET /api/v1/media/download/:id` | Returned `403` instead of `401` on completely anonymous unsigned requests. | Returns `401 AUTH_REQUIRED` when neither bearer auth nor `(expires, uid, sig)` query params are present; enforces HMAC signature/expiry (`403`), tenant `ownerId` (`403`), and post-revocation block (`403 CONSENT_REVOKED`). |
| `GET\|POST /api/v1/projects` & `GET /api/v1/projects/:id` | Unauthenticated; global shared `projectsStore` readable/writable by anonymous callers. | `requireAuth`; projects bound to `ownerId: req.user.id`; list/detail scoped to caller (`403` cross-tenant) or `admin`. |
| `POST /api/v1/visuals/render` | Unauthenticated; stored render jobs under `userId: 'anonymous'`. | `requireAuth`; binds render job `userId: req.user.id`. |

---

## 6. New Adversarial & Positive Regression Suite (`test/security/phase3c_s1_auth_remediation.test.ts`)

All 12 tests execute against the real Express app (`createApp()`) over an in-process HTTP server bound to `127.0.0.1:0` using synthetic PCM WAV fixtures and an isolated temporary `VOICEFORGE_REVOCATION_FILE`:

1. **Test 1 (`usr_admin_root` minting blocked)**: Proves anonymous `POST /api/v1/auth/token` with `{"userId":"usr_admin_root"}` returns `403 FORBIDDEN_IDENTITY_CLAIM` and issues no token.
2. **Test 2 (Existing `userId`/`email` impersonation blocked)**: Proves anonymous `POST /api/v1/auth/token` supplying Alice's, Bob's, or Admin's `userId` or `email` returns `403` even when `VOICEFORGE_ENABLE_DEV_DEMO_AUTH=true` in `development`.
3. **Test 3 (Caller-supplied `role` elevation blocked)**: Proves `{"role":"admin"}` and `{"role":"creator"}` are rejected (`403`) and `AuthService.getUserCount()` remains unchanged.
4. **Test 4 (Unknown `sub` hydration & JWT `role` elevation blocked)**: Signs raw HS256 JWTs using the real `VOICEFORGE_AUTH_SECRET` for (a) non-existent `usr_ghost_admin` (`role: 'admin'`) -> rejected `401` with zero `userStore` hydration, and (b) registered `usr_alice` with tampered payload `role: 'admin'` -> `/api/v1/auth/me` still resolves `role: 'creator'` from `userStore` and `/api/v1/audit/events` returns `403`.
5. **Test 5 (`staging`/`production` fail-closed & env parsing safety)**: Proves `resolveRuntimeEnvironment('staging') === 'staging'`, unrecognized `NODE_ENV` fails closed to `'production'`, missing `VOICEFORGE_AUTH_SECRET` throws in both `staging` and `production`, and `POST /api/v1/auth/token` returns `401` in `staging` and `production` even if `VOICEFORGE_ENABLE_DEV_DEMO_AUTH=true`.
6. **Test 6 (Consent revocation & voice deletion spoofing blocked)**: Enrolls a real custom voice for Alice via `challenge` + `verify-consent`, then proves anonymous and cross-tenant (`Bob`) calls to `POST /api/voices/clone/revoke-consent` and `DELETE /api/voices/:id` (`/api/v1/voices/:id`) passing `userId: 'admin'`, `userId: 'usr_admin_root'`, or `userId: 'usr_alice'` fail (`401`/`403`) while `isVoiceRevoked` stays `false` and Alice's voice remains intact.
7. **Test 7 (`v1Router` private voice, job `audioBase64`, cancellation, projects, download isolation)**: Creates a synthesis job and project for Alice and proves anonymous (`401`) and cross-tenant `Bob` (`403`) callers cannot read Alice's private voice (`GET /api/voices`, `GET /api/v1/voices/:id`), export it, synthesize with it, read `result.audioBase64` (`GET /api/v1/jobs/:id`, `GET /api/v1/tts/jobs/:id`), cancel Alice's job (`POST /api/v1/jobs/:id/cancel`), download unsigned media (`401`), or access Alice's project (`GET /api/v1/projects/:id`).
8. **Test 8 (Privileged audit & migration endpoints)**: Proves `GET /api/v1/audit/events` and `POST /api/db/migrate` return `401` anonymously and `403` for `creator`/`user` tokens, and allow `adminToken` (`200` on audit events; non-`401`/`403` past auth gate on `/api/db/migrate`).
9. **Test 9 (Token validation & revocation enforcement)**: Proves malformed headers, `alg: "none"` unsigned JWTs, missing-`exp` JWTs, expired JWTs, wrong-secret forged signatures, and revoked tokens (`POST /api/v1/auth/revoke` + non-admin cross-principal revoke denial `403`) are rejected with `401` across both `requireAuth` and `optionalAuth` routes.
10. **Test 10 (Positive authorized workflows)**: Proves Alice can still read/synthesize/poll her own voice, job (`audioBase64` + signed media download URL), and project, and legitimate `admin` can inspect audit events, revoke consent (`POST /api/voices/clone/revoke-consent` -> subsequent job access returns `403 CONSENT_REVOKED` with `result` scrubbed), and delete voices.
11. **Test 11 (Dev demo sandbox isolation)**: Proves `POST /api/v1/auth/token` fails closed (`401`) in `development` when `VOICEFORGE_ENABLE_DEV_DEMO_AUTH` is unset, issues only `usr_dev_sandbox` (`role: 'user'`) when explicitly enabled in `development`, denies admin routes (`403`) and cross-tenant resources (`403`) to that sandbox token, and immediately invalidates that token (`401`) when `NODE_ENV` transitions to `staging` or `production`.
12. **Test 12 (Zero state-mutation invariant on rejected requests)**: Captures before/after snapshots of `userStore`, Alice's custom voice presence, `ConsentVerificationEngine.isVoiceRevoked`, job status + `audioBase64` byte length, project count, and revocation hash store across a full battery of rejected anonymous and cross-tenant requests, proving exact structural equality (`0` unintended mutations).

---

## 7. Exact Verification Commands Run & Results

| # | Gate | Exact Command Executed | Exit Code | Result Summary |
| :--- | :--- | :--- | :---: | :--- |
| **1** | **TypeScript Typecheck (`lint`)** | `npm run lint` (`tsc --noEmit`) | `0` | **PASS** — `0` errors across all server, client (`src/`), and test TypeScript files. |
| **2** | **Focused Phase 3C-S1 Adversarial Auth Suite** | `./node_modules/.bin/tsx --test test/security/phase3c_s1_auth_remediation.test.ts` | `0` | **PASS** — `12/12` tests passed (`1` suite, `0` failed, `1508ms`). |
| **3** | **All Security Suites (`test/security/*.test.ts`)** | `VOICEFORGE_REVOCATION_FILE=/tmp/vf_sec_rev.json ./node_modules/.bin/tsx --test test/security/consent.test.ts test/security/phase3a_security.test.ts test/security/phase3c_s1_auth_remediation.test.ts test/security/watermark.test.ts` | `0` | **PASS** — `37/37` security tests passed across `4/4` suites (`consent`: `6/6`, `phase3a_security`: `15/15`, `phase3c_s1_auth_remediation`: `12/12`, `watermark`: `4/4`). |
| **4** | **All Non-PostgreSQL Node/TS Suites (`12` of `13` test files)** | `./node_modules/.bin/tsx --test test/unit/normalizer.test.ts test/unit/phonemizer.test.ts test/unit/quality.test.ts test/api/routes.test.ts test/security/consent.test.ts test/security/watermark.test.ts test/security/phase3a_security.test.ts test/security/phase3c_s1_auth_remediation.test.ts test/integration/consent_job_race.test.ts test/integration/durable_revocation.test.ts test/integration/rate_limit_and_db_fail_closed.test.ts test/integration/storage_provider.test.ts` | `0` | **PASS** — `95/95` tests passed across `12/12` suites (`0` failed, `8416ms`). *(Tracked `storage/auth/revoked_tokens.json` backed up and restored byte-for-byte after `durable_revocation.test.ts`.)* |
| **5** | **Full `package.json` `npm test` Script (`test/**/*.test.ts`, `13` files)** | `npm test` | `1` *(Postgres blocked)* | **12/13 suites (`96/101` subtests) PASS**; sole failing file is `test/integration/postgres_persistence.test.ts` (`5` subtests fail with `ECONNREFUSED` on `127.0.0.1:5433`; `1` invalid-URL subtest passes). |
| **6** | **Server Production Bundle (`build:server`)** | `npm run build:server` (`esbuild server.ts --bundle --platform=node --target=node22 --format=esm --packages=external --outfile=dist-server/server.js`) | `0` | **PASS** — Bundled `dist-server/server.js` (`319.8kb`) cleanly in `21ms` (cleaned up afterward via `npm run clean`). |
| **7** | **Client Production Bundle (`build:client`)** | `npm run build:client` (`vite build`) | `1` *(Option 1A peer gap)* | **`BLOCKED / CONDITION`** — Transformed all `2,250` modules (including `Header.tsx` & `VoiceCloningLabView.tsx`), then failed in Rolldown resolving `"react-is"` imported by `node_modules/recharts/es6/util/ReactUtils.js` (`BillingDashboard.tsx`) because Option 1A `--legacy-peer-deps` skipped `recharts`'s undeclared peer dependency `react-is@19.3.0` (`dist/` cleaned via `npm run clean`). |
| **8** | **Local Python Stdlib Test Suite (`omnivoice`)** | `python3 services/omnivoice/tests/run_tests.py` | `0` | **PASS** — `15/15` tests passed in `0.318s`. |
| **9** | **Protected File Integrity Check** | `sha256sum package.json bun.lock storage/auth/revoked_tokens.json reports/PHASE-0-NEW-ARENA-BOOTSTRAP-AND-ROADMAP.md` | `0` | **PASS** — All 4 checksums match baseline byte-for-byte; no `package-lock.json` or `npm-shrinkwrap.json` present. |

---

## 8. Gates `NOT RUN` or `BLOCKED` (With Concrete Reasons)

| Gate / Check | Status | Concrete Reason |
| :--- | :---: | :--- |
| **`test/integration/postgres_persistence.test.ts`** (inside `npm test`) | `BLOCKED` | Requires a live PostgreSQL instance at `postgresql://voiceforge:voiceforge_pass@localhost:5433/voiceforge_test` (or `DATABASE_URL`). Verified via TCP probe that both `127.0.0.1:5432` and `127.0.0.1:5433` return `ECONNREFUSED`, and neither PostgreSQL (`psql`/`postgres`) nor `docker` is installed in this sandbox. |
| **`npm run build:client` (`vite build` full bundle completion)** | `BLOCKED` *(Option 1A dependency condition)* | `recharts@3.10.1` lists `react-is` under `peerDependencies` rather than `dependencies`, and root `package.json` omits `react-is`. Bun auto-installed `react-is@19.3.0` in `bun.lock`, whereas authorized Option 1A (`npm install --no-package-lock --ignore-scripts --legacy-peer-deps`) skips undeclared peer dependencies, causing Rolldown to error on `recharts/es6/util/ReactUtils.js -> "react-is"`. TypeScript compilation (`tsc --noEmit`) and Vite module transformation (`2,250` modules) succeeded cleanly. |
| **`services/omnivoice/tests/test_inference.py`** | `BLOCKED` | Requires `pytest` (`ModuleNotFoundError: No module named 'pytest'`) and FastAPI/OmniVoice Python dependencies not installed in system Python `3.11.2`. |
| **Bun-locked dependency reproduction (`bun install --frozen-lockfile`)** | `NOT RUN` | `bun` binary is not installed in the sandbox environment. |
| **Live GPU Neural OmniVoice Synthesis & Model-Weight E2E** | `NOT RUN` | Out of scope for Phase 3C-S1 and unavailable in CPU-only sandbox without GPU hardware or model weights. All tests ran using truthful synthetic DSP/fallback fixtures without claiming neural synthesis. |

---

## 9. Residual Security Risks Deliberately Deferred to Phase 3C-S2

In strict adherence to bounded phase discipline, the following non-S1 defects observed during auditing were **not** scope-crept into Phase 3C-S1 and are recorded for **Phase 3C-S2**:

1. **Spoofable `X-Forwarded-For` in Audit Event IP Metadata (`server/routes/api.ts`)**: Several audit helpers (`req.headers['x-forwarded-for'] || req.socket.remoteAddress`) read raw `X-Forwarded-For` directly instead of using the proxy-aware IP resolver implemented in `server/middleware/rateLimiter.ts` (`VOICEFORGE_TRUST_PROXY`). An attacker can forge the `ipAddress` field recorded in audit logs even though rate limiting itself ignores spoofed `X-Forwarded-For` by default.
2. **Rate-Limiter Architecture & Endpoint Policy Coverage (`server/middleware/rateLimiter.ts`, `server/routes/api.ts`)**:
   - Rate-limit counters live in single-process memory (`globalStore`) rather than shared Redis/PostgreSQL state.
   - `POST /api/voices/clone/revoke-consent` currently relies on `generalApiRateLimiter` (`120 req/min`) rather than a dedicated revocation/mutation rate-limit bucket (sharing `authRateLimiter`'s `10 req/min` IP bucket across `challenge` + `verify-consent` + `revoke-consent` + `auth/revoke` causes multi-step enrollment/revocation flows from a single IP to collide at 10 requests).
3. **Unauthenticated Compute / Media Studio Utility Endpoints (`server/routes/api.ts`)**:
   - Creative/media studio proxy endpoints (`/api/media/image-gen`, `/api/media/video-gen`, `/api/media/music-gen`, `/api/media/sfx-gen`, `/api/media/podcast-gen`, `/api/frontend/analyze`, `/api/audio/verify-watermark`) do not yet enforce `requireAuth` or per-tenant compute quotas. While server-side `GEMINI_API_KEY` is unset in local tests, authenticated quota gating should be enforced before any external provider key is configured.
4. **In-Memory Domain Stores vs Durable PostgreSQL Parity (`server/routes/api.ts`, `server/db/`)**:
   - `customVoices`, `ttsJobs`, `projectsStore`, `visualRenderJobs`, `ConsentVerificationEngine` challenges/records, and `AuditLogger` remain process-local in-memory structures rather than persisted through `server/db/` repositories, and `test/integration/durable_revocation.test.ts` writes directly to default `storage/auth/revoked_tokens.json` unless overridden via `VOICEFORGE_REVOCATION_FILE`.
5. **Real Identity Provider / Credential Authentication**:
   - `POST /api/v1/auth/token` now fails closed (`401 AUTH_PROVIDER_UNAVAILABLE`) outside explicit local dev sandbox mode (`VOICEFORGE_ENABLE_DEV_DEMO_AUTH=true`), which closes the privilege escalation hole safely; however, production user sign-in requires integrating a real upstream OIDC/OAuth2/session or hashed-credential provider in a dedicated auth-provider phase.

---

## 10. Recommended Scope for Phase 3C-V2 (Independent Verification) & Phase 3C-S2

### 10.1 Recommended Exact Scope for Phase 3C-V2 (Independent Verification Pass)
1. **Independent Black-Box Auth & Tenant Isolation Audit**:
   - Verify all 4 Phase 3C-S1 remediation pillars (4A token issuance, 4B body spoofing elimination, 4C `v1Router` endpoint protection & artifact scrubbing, 4D `verifyToken` & `optionalAuth` hardening) from a clean inspection pass without modifying production logic.
2. **Resolve & Verify the Two Environmental Conditions Blocking Unconditional `PASS`**:
   - **Client Build (`build:client`)**: Either verify in a `bun install --frozen-lockfile` runner (where `bun.lock` installs `react-is@19.3.0`) **or**, with explicit user authorization, add `"react-is": "^19.0.1"` to `package.json` (and update `bun.lock` in Bun) or install `react-is@19.3.0` `--no-save --no-package-lock --ignore-scripts --legacy-peer-deps` to confirm `npm run build:client` exits `0`.
   - **PostgreSQL Persistence Suite**: Execute `test/integration/postgres_persistence.test.ts` against an ephemeral local PostgreSQL 15/16 instance on `127.0.0.1:5433` to verify `13/13` suites (`101/101` tests) in `npm test` exit `0`.

### 10.2 Recommended Exact Scope for Phase 3C-S2 (Secondary Security Hardening)
1. Unify client IP extraction across `server/routes/api.ts` audit logging and `server/middleware/rateLimiter.ts` so `X-Forwarded-For` is never trusted unless `VOICEFORGE_TRUST_PROXY=true`.
2. Introduce dedicated rate-limit policy buckets for destructive/mutation endpoints (`revoke-consent`, `DELETE /voices/:id`, media studio generation) without starving enrollment (`challenge` + `verify-consent`) buckets.
3. Gate compute/provider-backed media studio endpoints (`/api/media/*`) behind `requireAuth` and tenant rate/quota enforcement.
4. Isolate `test/integration/durable_revocation.test.ts` onto a temporary `VOICEFORGE_REVOCATION_FILE` path so running `npm test` never mutates tracked `storage/auth/revoked_tokens.json`.
