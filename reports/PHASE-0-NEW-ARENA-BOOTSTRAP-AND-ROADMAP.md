# VOICEFORGE — PHASE 0: NEW ARENA SESSION BOOTSTRAP, SOURCE RECONCILIATION & MASTER ROADMAP

**Document Identifier**: `reports/PHASE-0-NEW-ARENA-BOOTSTRAP-AND-ROADMAP.md`  
**Execution Date**: 2026-10-28 (UTC)  
**Repository**: `https://github.com/ranimony-afk/Voice-clone`  
**Session Branch**: `arena/3b3635b6-voice-clone`  
**Checked-Out Commit**: `594593a129ee586e29143933e09b4ee634460567`  
**Execution Mode**: STRICT READ-ONLY BOOTSTRAP (zero application edits, zero package installs, zero Git history mutations)  
**Phase 0 Bootstrap Gate Verdict**: **`PASS WITH CONDITIONS`**  
**Overall Security / Staging / Production Readiness**: **`FAIL — NOT READY`**

---

## 1. Exact Arena Repository & Worktree Identity

| Property | Verified Value | Verification Command / Source |
| :--- | :--- | :--- |
| **Sandbox Home Directory** | `/home/user` | `pwd` |
| **Repository Root** | `/home/user/Voice-clone` | `git rev-parse --show-toplevel` |
| **Materialization Type** | Shallow Git checkout (`.git` present, `--is-shallow-repository = true`, depth `1`) | `git rev-parse --is-shallow-repository`, `.git/shallow` |
| **Active Session Branch** | `arena/3b3635b6-voice-clone` (no remote upstream set yet) | `git status --porcelain=v2 --branch`, `git branch -a -vv` |
| **Local `main` Branch** | `594593a129ee586e29143933e09b4ee634460567` tracking `origin/main` | `git branch -a -vv` |
| **Configured Remote (`origin`)** | `https://github.com/ranimony-afk/Voice-clone.git` (fetch & push) | `git remote -v` |
| **HEAD Commit SHA** | `594593a129ee586e29143933e09b4ee634460567` | `git rev-parse HEAD` |
| **HEAD Tree SHA** | `d07d6495fa4ff0f2ef4d37ea580aaf6690ab2d54` | `git cat-file -p HEAD` |
| **Recorded Parent Commit SHA** | `e13b0faeb57124900c07a84b9d39c6c1a6f31422` *(grafted; parent object not unpacked locally due to depth-1 clone)* | `git cat-file -p HEAD` |
| **HEAD Commit Subject** | `feat(core): implement synthesis modes and security` | `git log -n 1 --oneline` |
| **Worktree List** | `/home/user/Voice-clone  594593a [arena/3b3635b6-voice-clone]` | `git worktree list` |
| **Tracked Modifications (Pre-Report)** | None (`0` modified, `0` staged) | `git status --porcelain=v2` |
| **Untracked / Ignored Files (Pre-Report)** | None (`0` untracked, `0` ignored; `node_modules/` and `.venv/` absent) | `git status --ignored --porcelain=v2` |
| **Legacy Paths (`/app/applet`, `/tmp/voiceforge-remote-main`)** | Absent (this session is a clean Arena Git sandbox, not the prior exported tree) | Filesystem inspection |

### Installed Runtime & Tooling Inventory

| Runtime / Tool | Status in Sandbox | Version / Notes |
| :--- | :--- | :--- |
| `node` | Installed | `v22.22.3` (`/usr/local/bin/node`) |
| `npm` / `npx` | Installed | `10.9.8` (`/usr/local/bin/npm`) |
| `yarn` | Installed | `1.22.22` (`/usr/local/bin/yarn`) |
| `bun` / `pnpm` | **NOT INSTALLED** | Note: repository contains `bun.lock`, no `package-lock.json` |
| `node_modules/` (`tsx`, `tsc`, `vite`, `esbuild`, `express`, `pg`, `zod`, etc.) | **NOT INSTALLED** | Neither local `node_modules/` nor global `tsc`/`tsx`/`vite` is installed |
| `python3` / `python` | Installed | `Python 3.11.2` (`/usr/bin/python3`) |
| `pip` / `pip3` | Installed | `pip 23.0.1` (only `pip`, `setuptools`, `wheel` installed; no `pytest`, `numpy`, `fastapi`, `torch`, `omnivoice`) |
| `postgres` / `psql` / `pg_isready` | **NOT INSTALLED** | No local PostgreSQL server or client binaries |
| `docker` / `ffmpeg` | **NOT INSTALLED** | Unavailable in sandbox |

---

## 2. Public `main` Baseline & Verified Relationship to Current Checkout

- **Public `main` Reference Baseline**: `594593a129ee586e29143933e09b4ee634460567` (parent `e13b0faeb57124900c07a84b9d39c6c1a6f31422`).
- **Diff Against `main` (`git diff --stat main`)**: **Empty (`0` files changed)** prior to writing this Phase 0 bootstrap report.
- **Lineage Classification**: **Case 1 — Contains the exact vulnerable token handler and authentication module from public `main` (`594593a129ee586e29143933e09b4ee634460567`)**.
  - Unlike the earlier `3C-S1` session on a different branch/checkout that lacked `server/auth/auth.ts` and `POST /api/v1/auth/token`, this checkout has complete, unambiguous lineage and contains the exact remediation target.

---

## 3. Repository File Inventory & Presence/Absence of Phase Reports

### 3.1 Confirmed Core Source & Configuration Files

| Path | Lines | Size (Bytes) | Status |
| :--- | ---: | ---: | :--- |
| `server.ts` | 281 | 9,526 | Present |
| `server/routes/api.ts` | 2,516 | 93,104 | Present (contains vulnerable `POST /v1/auth/token` at lines 82–122) |
| `server/auth/auth.ts` | 467 | 14,267 | Present (`AuthService`, `DurableRevocationStore`, `PRELOADED_USERS`, `requireAuth`) |
| `server/middleware/rateLimiter.ts` | 202 | 6,178 | Present (`SlidingWindowStore`, `authRateLimiter`, `generalApiRateLimiter`, etc.) |
| `server/db/index.ts` | 139 | 4,495 | Present (`assertDatabaseConfigured`, `getDatabase`, `checkDatabaseHealth`, `memoryStore`) |
| `server/db/schema.ts` | 239 | 13,082 | Present (14 Drizzle tables defined) |
| `server/db/migrate.ts` | 321 | 11,229 | Present (creates 13 PostgreSQL tables; omits `generations`) |
| `server/db/migrations/0001_phase3a_security_persistence.sql` | 99 | 3,545 | Present (5 Phase 3A/3B security tables; note typo `createdAt` unquoted on line 21) |
| `server/config/env.ts` | 41 | 1,230 | Present (`envSchema`, `parseEnv`) |
| `server/storage/privateStorage.ts` | 458 | 15,029 | Present (`PrivateStorageService`, `LocalStorageProvider`, `S3CompatibleStorageProvider`) |
| `server/engine/audio/synthesizer.ts` | 484 | 16,501 | Present (`OmniVoiceSpeechEngine`, `GeminiNeuralSpeechEngine`, `DevFormantSynthesizer`) |
| `server/engine/audio/consent.ts` | 378 | 13,594 | Present (`ConsentVerificationEngine`) |
| `server/engine/audio/jobWorker.ts` | 105 | 3,716 | Present (`SynthesisJobWorker` — used only in tests, not wired to `api.ts`) |
| `server/engine/audio/watermark.ts` | 317 | 11,284 | Present (`AudioWatermarker`) |
| `server/engine/audio/quality.ts` | 401 | 14,313 | Present (`AudioQualityAnalyzer`) |
| `server/engine/gemini/multimodal.ts` | 824 | 36,300 | Present (`GeminiMultimodalEngine` with silent static/procedural fallbacks) |
| `server/engine/paper2audio/engine.ts` | 920 | 41,475 | Present (`Paper2AudioEngine` with deterministic script fallback) |
| `storage/auth/revoked_tokens.json` | 1 | 135 | Tracked in Git with 2 test token SHA-256 hashes |
| `voiceforge-work/Voice-clone/.env.example` | 14 | 737 | Tracked artifact left in Git despite `voiceforge-work/` in `.gitignore` |
| `package.json` / `bun.lock` | 51 / 808 | 1,383 / 88,303 | Present (`package-lock.json` absent) |

### 3.2 Historical Reports & Recovery Artifacts Inventory

| Artifact / Report | Status in Checkout | Notes / Integrity |
| :--- | :--- | :--- |
| `reports/M0-INTEGRATION-AUDIT.md` | **PRESENT** | Historical M0 report |
| `reports/PHASE-0-BASELINE-AUDIT.md` | **PRESENT** | Earlier Phase 0 audit |
| `reports/PHASE-0-CURRENT-STATE.md` | **PRESENT** | Earlier state snapshot |
| `reports/PHASE-1-UPSTREAM-INTEGRATION-MATRIX.md` | **PRESENT** | Upstream matrix |
| `reports/PHASE-2A-EXECUTION-MODE-HARDENING.md` | **PRESENT** | Execution-mode contract report |
| `reports/PHASE-2B-INDEPENDENT-VERIFICATION-AND-UI-FOUNDATION.md` | **PRESENT** | Design system & code-splitting report |
| `reports/PHASE-3A-SECURE-FOUNDATION-GATE.md` | **PRESENT** | Phase 3A report |
| `reports/PHASE-3A-V-INDEPENDENT-SECURITY-VERIFICATION.md` | **PRESENT** | Phase 3A-V report |
| `reports/PHASE-3B-INTEGRATION-AND-SECURITY-GATE.md` | **PRESENT** | Phase 3B report |
| `reports/PHASE-3B-V-INDEPENDENT-VERIFICATION.md` | **PRESENT** | Phase 3B-V report |
| `reports/PHASE-3C-DEPLOYMENT-READINESS-ASSESSMENT.md` | **PRESENT** | Phase 3C read-only assessment |
| `reports/PHASE-3C-R-STAGING-REMEDIATION.md` | **PRESENT** | Claims `PASS`, contradicted by `3C-V` P0 finding |
| `reports/voiceforge-m2a-worktree-snapshot.tar.gz` | **PRESENT** | SHA-256 `8f33310d9502532007fc369bdffbc962142a844af12ffc5508c11dee22ef312d` verified |
| `reports/voiceforge-m2a.patch` | **PRESENT** | SHA-256 `bd662b7e9255906ebc08f6a261ec654d34880781b27f035f361d099075446955` verified |
| `reports/PHASE-3C-V-*` (2026-10-28 independent verification) | **ABSENT** | Not committed to public `main`; carried forward from mission brief |
| `reports/PHASE-3C-S1-*` (blocker report from other checkout) | **ABSENT** | Not committed to public `main`; carried forward from mission brief |

---

## 4. Code-Level Assessment of the P0 Critical Vulnerability

### Finding `P0-AUTH-01`: Unauthenticated Privileged-Token Issuance & Arbitrary Principal Impersonation

- **Status**: **CONFIRMED PRESENT IN SOURCE** at commit `594593a129ee586e29143933e09b4ee634460567`.
- **Exact Locations**:
  - Route mount: `server.ts:75` (`app.use('/api', apiRouter)`)
  - Vulnerable handler: `server/routes/api.ts:82-122` (`apiRouter.post('/v1/auth/token', ...)`)
  - Preloaded privileged identities: `server/auth/auth.ts:50-75` (`PRELOADED_USERS`, specifically `PRELOADED_USERS['usr_admin_root']` with `role: 'admin'`)
  - Signing & verification path: `server/auth/auth.ts:242-334` (`AuthService.issueToken`, `AuthService.verifyToken`) and `360-388` (`requireAuth`), `394-403` (`optionalAuth`).

### Exact Exploit Mechanics in Current Code

`POST /api/v1/auth/token` requires **no authentication, no secret/password/credential check, no environment restriction (active even when `NODE_ENV=production`), and no `authRateLimiter`**. Any anonymous caller can exploit three distinct escalation paths:

1. **Direct Preloaded Root Admin Minting (`server/routes/api.ts:86-87`)**:
   - Sending `{ "userId": "usr_admin_root" }` resolves `PRELOADED_USERS['usr_admin_root']` (`role: 'admin'`, `email: 'security-admin@voiceforge.ai'`, `creditBalance: 999999`) and returns a cryptographically valid 7-day HMAC-SHA256 Bearer token signed with `getAuthSecret()`.
   - Sending `{ "userId": "usr_alice_user" }` or `{ "userId": "usr_bob_user" }` similarly impersonates any preloaded tenant.
2. **Account Takeover of Any Registered Email (`server/routes/api.ts:88-89`)**:
   - Sending `{ "email": "<victim@domain>" }` resolves `AuthService.getUserByEmail(email)` and issues a valid session token for that user with zero proof of identity.
3. **Self-Assigned `admin` / `creator` Role & Arbitrary `userId` Registration (`server/routes/api.ts:91-101`)**:
   - Sending `{ "userId": "attacker_1", "role": "admin" }` hits line 97 (`role: (role === 'admin' || role === 'creator' ? role : 'user')`), registers the caller in `userStore` as `admin`, and issues a valid signed `admin` JWT.
   - Sending `{ "userId": "<non_preloaded_victim_id>" }` before that victim is in `userStore` claims their `userId` with attacker-chosen attributes.

### Downstream Impact & Compounding Auth Defects Discovered in Source

1. **Cross-Tenant Admin Bypass**: Middleware `requireAuth` / `optionalAuth` accepts the signed token and populates `req.user` (`role: 'admin'`), granting access to:
   - All tenants' private voice catalogs (`GET /api/v1/voices`, `api.ts:575`) and voice deletion (`DELETE /api/v1/voices/:id`, `api.ts:635`).
   - All tenants' private uploaded reference/consent/TTS audio buffers (`GET /api/v1/media/download/:id`, `api.ts:742`).
   - All tenants' synthesis jobs (`GET /api/v1/tts/jobs/:id`, `api.ts:878`), consent records (`GET /api/v1/consent/records`, `api.ts:918`), and security audit trails (`GET /api/v1/audit/events`, `api.ts:909`).
2. **Self-Hydrating Token Claims (`server/auth/auth.ts:317-328`)**:
   - In `AuthService.verifyToken`, if `payload.sub` is not in `userStore` (e.g., after process restart), `verifyToken` constructs a new user directly from `payload.role` (`role: payload.role || 'user'`) and inserts it into `userStore`.
3. **Related Unauthenticated Caller-Supplied Identity Escalation (`server/routes/api.ts:474-488`, `531-536`, `328-336`, `360-379`)**:
   - `POST /api/voices/clone/revoke-consent` (`api.ts:474`) uses `optionalAuth` and sets:
     - `effectiveUserId = req.user ? req.user.id : (clientUserId || 'usr_default_creator')` (`line 479`)
     - `isAdmin = req.user?.role === 'admin' || effectiveUserId === 'usr_admin_root'` (`line 487`)
     - Even **without** calling `/api/v1/auth/token`, an anonymous request with `{ "voiceId": "<target>", "userId": "usr_admin_root" }` bypasses ownership checks in both `api.ts:488` and `ConsentVerificationEngine.revokeConsent` (`consent.ts:261`)!
   - Similarly, `POST /api/voices/clone/challenge` (`api.ts:334`) and `POST /api/voices/clone/verify-consent` (`api.ts:378`) use `optionalAuth` and fall back to caller-supplied `req.body.userId` when unauthenticated.
4. **Legitimate Caller Pattern Inventory**:
   - Only `src/components/Header.tsx` (`lines 35, 91`) calls `POST /api/v1/auth/token`, passing `{ userId: 'usr_default_creator' }` for local UI session bootstrap.
   - No password hashing, OAuth/OIDC, or verified admin login flow exists anywhere in the codebase (`users.passwordHash` in `server/db/schema.ts:8` is unused). Thus, **the architecture currently has no trustworthy unauthenticated privileged-identity mechanism and must fail closed on privileged or production/staging token issuance**.

---

## 5. Verification of Additional Reported Findings & Related Source Defects

| ID | Reported Finding | Verification Verdict | Exact File / Function / Line References & Details | Target Phase |
| :--- | :--- | :--- | :--- | :--- |
| **F-01** | Strict auth rate limiter does not cover token issuance | **CONFIRMED** | `server/routes/api.ts:82` (`POST /v1/auth/token`) omits `authRateLimiter` (10 req / 15 min), despite `server/middleware/rateLimiter.ts:163` documenting coverage of token issuance. | Phase 3C-S1 / 3C-S2 |
| **F-02** | Strict limiter misses consent revocation; nested synthesis route lacks specific limiter | **CONFIRMED** | `server/routes/api.ts:474` (`POST /voices/clone/revoke-consent`) omits `authRateLimiter`. Nested `v1Router.post('/tts/jobs')` (`api.ts:1463`) omits `synthesisJobRateLimiter` (and duplicates/is shadowed by `apiRouter.post('/v1/tts/jobs')` at `api.ts:778`). Direct synthesis routes (`/tts/synthesize` at `251`, `/voices/upload-sample` at `927`, `/paper2audio/synthesize` at `1388`, `/speech-to-speech` at `1945`) also lack route-specific upload/synthesis limiters. | Phase 3C-S2 |
| **F-03** | Database URL validation relies on string prefix instead of robust parsing | **CONFIRMED** | `server/db/index.ts:48` (`assertDatabaseConfigured`), `index.ts:63` (`getDatabase`), `index.ts:106` (`checkDatabaseHealth`), and `server/db/migrate.ts:11` (`runMigrations`) only check `dbUrl.startsWith('postgres')`. Malformed strings like `"postgres"`, `"postgres_bad"`, or `"postgresql://"` pass startup validation in `staging`/`production`. | Phase 3C-S2 |
| **F-04** | Remote PostgreSQL TLS disables certificate verification | **CONFIRMED** | `server/db/index.ts:65-68` and `server/db/migrate.ts:18-21` set `ssl: isLocal ? false : { rejectUnauthorized: false }`, disabling certificate & hostname verification against MITM attacks. In addition, `isLocal` uses substring `.includes('localhost')` / `.includes('sslmode=disable')`, allowing `sslmode=disable` even in `staging`/`production`. | Phase 3C-S2 |
| **F-05** | Rate limiter and revocation/consent mechanisms use process-local state | **CONFIRMED** | `SlidingWindowStore` (`rateLimiter.ts:27`) is an in-memory `Map`. `DurableRevocationStore` (`auth.ts:84-135`) syncs from file/DB only once at startup (`initialized` guard) via fire-and-forget async `syncFromDatabase()`. `userStore` (`auth.ts:78`), `ConsentVerificationEngine.consumedNonces` & `auditRecords` (`consent.ts:62-64`), `AudioWatermarker.manifestLedger` (`watermark.ts:43`), and `memoryStore` (`db/index.ts:16`) are all process-local in-memory structures. | Phase 3D (process-local boundaries documented in 3C-S2) |
| **F-06** | Staging environment validation is inconsistent | **CONFIRMED** | `server/config/env.ts:12` defines `z.enum(['development', 'production', 'test'])` — omitting `'staging'`. When `NODE_ENV=staging`, `parseEnv()` fails validation and silently resets `config.NODE_ENV = 'development'` and `CORS_ALLOWED_ORIGINS = '*'`, causing `server.ts:94` to leak internal error messages and `server.ts:101` to mount Vite dev middleware! Furthermore, `getAuthSecret()` (`auth.ts:39`), `getSigningSecret()` (`privateStorage.ts:171`), `synthesizer.ts:334,342,395`, `api.ts:1417`, and `services/omnivoice/app/config.py:36` only enforce strict fail-closed rules for `'production'`, leaving `'staging'` on hardcoded dev secrets and `DEMO` fallbacks. Meanwhile `consent.ts:59` and `watermark.ts:38` never fail closed on missing secrets even in `'production'`. | Phase 3C-S2 |
| **F-07** | Proxy trust & health-skip inconsistencies | **CONFIRMED** | `server.ts:30` checks `VOICEFORGE_TRUST_PROXY === 'true'`, while `rateLimiter.ts:112` also accepts `TRUST_PROXY === 'true'` and parses leftmost `x-forwarded-for` manually (`parts[0]`). Also `generalApiRateLimiter` skip check (`req.path === '/healthz' \|\| req.path === '/readyz'` at `rateLimiter.ts:198`) never matches `/api/health` or `/api/v1/health/*` because `apiRouter` is mounted under `/api`. | Phase 3C-S2 |
| **F-08** | Unauthenticated `v1Router` shadow/residual endpoints & `/api/db/migrate` | **CONFIRMED** | `v1Router` (`api.ts:1428, 1506, 1514`) exposes `GET /api/v1/voices/:id`, `GET /api/v1/jobs/:id` (returning `result.audioBase64` for jobs pushed at `api.ts:849`!), and `POST /api/v1/jobs/:id/cancel` without `requireAuth` or tenant checks. `POST /api/db/migrate` (`api.ts:207`) triggers DDL migrations without authentication. Global body parser (`server.ts:71`) allows `50mb` JSON on all routes. | Phase 3C-S1 / 3C-S2 / 3D |

---

## 6. Existing Tests & Executable Validation Capability (Phase 0 Inspection)

Per Phase 0 rules, **zero dependencies were installed** and **zero workspace files were mutated** during capability probing.

| Suite / Check | Configured Command | Files / Scope | Phase 0 Status | Reason / Findings |
| :--- | :--- | :--- | :--- | :--- |
| **Python OmniVoice Stdlib Suite** | `PYTHONDONTWRITEBYTECODE=1 python3 -B services/omnivoice/tests/run_tests.py` | 1 file, 15 unit/contract tests | **RUN — PASS (15/15, exit 0)** | Uses Python 3.11 stdlib (`unittest`, `wave`, `struct`, `hmac`) with built-in shims when `pydantic`/`numpy`/`fastapi` are absent. |
| **Node Zero-Dep Watermark Suite** | `node --experimental-strip-types --test test/security/watermark.test.ts` | 1 file, 4 tests | **RUN — PASS (4/4, exit 0)** | Imports only `node:test`, `node:assert`, `node:crypto` with no type-only re-imports. |
| **Node Unit & Consent Suites (without `tsx`)** | `node --experimental-strip-types --test test/unit/*.test.ts test/security/consent.test.ts` | 4 files | **FAILS WITHOUT `tsx` / NOT RUN VIA `tsx`** | Source files (`normalizer.ts`, `phonemizer.ts`, `quality.ts`) use `import { SomeInterface } from '../types.ts'` instead of `import type`, which requires `tsx` (esbuild) transformation and fails under bare Node 22 strip-types (`SyntaxError`). |
| **Node API, Auth, Rate-Limit & Race Integration Suites** | `npx tsx --test ...` | 6 files (`routes.test.ts`, `phase3a_security.test.ts`, `durable_revocation.test.ts`, `consent_job_race.test.ts`, `storage_provider.test.ts`, `rate_limit_and_db_fail_closed.test.ts`) | **NOT RUN** | Requires `node_modules` (`tsx`, `express`, `drizzle-orm`, `pg`, `zod`, `@google/genai`), which are not installed yet. Once `npm install` is authorized, all 6 suites run **100% in-process** on `127.0.0.1:0` with zero external services. |
| **PostgreSQL Live Integration Suite** | `npx tsx --test test/integration/postgres_persistence.test.ts` | 1 file, 6 tests | **NOT RUN** | Requires both `node_modules` (`pg`, `tsx`) AND a live PostgreSQL instance on `localhost:5433/voiceforge_test` (`postgres` binary is not installed in this container). |
| **Python Pytest / NumPy Suite** | `pytest services/omnivoice/tests/test_inference.py` | 1 file, 5 tests | **NOT RUN** | Requires `pytest` and `numpy` (not installed in `/usr/bin/python3`). |
| **TypeScript Typecheck** | `npm run lint` (`tsc --noEmit`) | Whole repo | **NOT RUN** | Requires `typescript` (`tsc`), not installed yet. |
| **Client & Server Production Builds** | `npm run build` / `npm run build:server` | `vite build` / `esbuild` | **NOT RUN** | Requires `vite` and `esbuild`, not installed yet. Also note `package.json` `"start": "node server.ts"` cannot run natively without `tsx` or bundling (`dist-server/server.js`). |

---

## 7. Truthfulness Matrix: Implemented vs. Simulated vs. Provider vs. Documented

| Capability / Subsystem | Classification | Reality in Current Checkout (`594593a`) |
| :--- | :--- | :--- |
| **Text Normalization & Multilingual G2P (`normalizer.ts`, `phonemizer.ts`)** | **Implemented & Executable (Rule-Based)** | Genuine Unicode NFC, number/currency expansion, code-switch segmentation, and rule-based IPA lookup/transliteration across EN, HI, TA, ML, JA. |
| **Acoustic Quality & WAV Inspector (`quality.ts`, `privateStorage.ts`)** | **Implemented & Executable** | Genuine PCM WAV header parsing, RMS/dBFS, clipping ratio, frame-energy SNR/VAD, 25 MB cap, and binary magic-byte header validation. |
| **Consent Challenge & Speaker Similarity (`consent.ts`)** | **Implemented Heuristic (Non-Neural)** | Genuine HMAC-SHA256 expiring challenge, nonce replay check, SHA-256 identical-buffer anti-spoofing, and 64-band energy/ZCR cosine similarity. **Not** neural ECAPA-TDNN speaker biometrics despite `api.ts` and `ARCHITECTURE.md` naming ECAPA-TDNN; `generateSpeakerEmbedding()` in `api.ts:307` is a deterministic string hash PRNG. |
| **Audio Provenance (`watermark.ts`)** | **Implemented Metadata Signing (Non-Steganographic)** | Genuine SHA-256 content hash + HMAC-SHA256 manifest embedded as a trailing WAV `vfpr` RIFF chunk. **Not** spread-spectrum inaudible acoustic watermarking or hardware C2PA certificates. |
| **Authentication, RBAC & Token Revocation (`auth.ts`, `api.ts`)** | **Implemented with P0 Vulnerability & Process-Local Gaps** | Real HMAC-SHA256 token verification, atomic disk hash revocation (`0o600`), and ownership middleware exist, **but are completely undermined by unauthenticated `POST /api/v1/auth/token` privilege minting**, unauthenticated `revoke-consent` body spoofing, and in-memory `userStore`. |
| **Local TTS Synthesis (`DevFormantSynthesizer`, `inference.py` fallback)** | **Simulated / Procedural Demo Audio** | Generates deterministic sine/formant harmonic tones in WAV containers; truthfully labeled `executionMode: 'DEMO'` on `/api/tts/synthesize` and `/api/engine/status`. |
| **Local Neural Inference (`services/omnivoice/`, `OmniVoiceSpeechEngine`)** | **Scaffolded Wrapper Only — NO Weights / Runtime Installed** | FastAPI wrapper and execution-mode contract (`NEURAL`/`DEMO`/`UNAVAILABLE`) exist, **but zero model weights (`.pt`/`.safetensors`), zero GPU/CUDA, and no `torch`/`omnivoice` packages exist in this environment**. |
| **CosyVoice 2, Indic Parler-TTS, OpenVoice v2, Vocos, faster-whisper, Demucs, Redis/Celery** | **Documented / Advertised Only (Unimplemented)** | Returned as static JSON by `GET /api/architecture` and drawn in `docs/ARCHITECTURE.md`, with **zero** implementation code or service bindings in the repository. |
| **Multimodal Music, Image, Video, ASR, Translation, Paper2Audio, Live WS (`multimodal.ts`, `paper2audio/engine.ts`, `server.ts`)** | **External Provider (`@google/genai`) with Silent Mock Fallbacks** | Calls Google GenAI SDK when a real `GEMINI_API_KEY` is injected (note model strings `gemini-3.8-flash`, `gemini-3.8-live`, `gemini-3.5-transcribe`, `gemini-nano-banana-2.1`, `veo-3.1-fast-generate-preview`, `lyria-3-*`). On failure or missing key, **silently falls back** to hardcoded transcripts/translations, chord-triad WAVs, placeholder SVGs, public Google sample MP4 URLs (`ForBiggerBlazes.mp4`), or synthetic formant PCM on `/live-ws`. |
| **Voice Isolation, Dubbing, Visual Render, Billing (`api.ts:1980-2135, 1551`)** | **UI-Only / Mocked API Responses** | `/api/audio/isolate` echoes back input audio with hardcoded `snrImprovementDb: 18.4`; `/api/dubbing/create` returns hardcoded segments + sample MP4; `/api/billing/*` mutates a module-global number `84250` with hardcoded chart arrays; `ShotcutEditorView.tsx` is a client-side Canvas/WebAudio UI. |
| **PostgreSQL & S3 Storage (`server/db/`, `privateStorage.ts`)** | **Partially Wired / Mostly In-Memory** | `db/schema.ts` and `migrate.ts` define tables, but `api.ts` only writes `videoTransformJobs` and `transcriptionTranslationJobs` (plus best-effort fire-and-forget `revokedTokens` and `privateMedia`) to PostgreSQL; `users`, `voices`, `consentRecords`, `synthesisJobs`, and `auditEvents` remain read/written from in-memory `memoryStore`/`userStore`/`customVoices`. `S3CompatibleStorageProvider` is an unbound stub throwing `StorageUnavailableError`. |

---

## 8. Prioritized Master Roadmap, Gates & Acceptance Criteria

### Phase 3C-S1 — Critical Authentication & Principal Integrity Remediation *(NEXT GATE)*
- **Dependencies**: User authorization to execute Phase 3C-S1 and install workspace npm dependencies (`npm install`) for local regression testing, typecheck, and build verification.
- **Scope**:
  1. Remediate `POST /api/v1/auth/token` (`server/routes/api.ts`) so unauthenticated callers can **never** mint `admin` or `creator` privileges, impersonate `usr_admin_root` or existing users by `userId`/`email`, or self-assign roles.
  2. Fail closed (`403`/`401`) in `production` and `staging` (and for any privileged identity request where no trustworthy server-verified authentication mechanism exists); restrict any unauthenticated sandbox/demo session bootstrap strictly to explicit local `development`/`test` mode with an unprivileged role, covered by `authRateLimiter`.
  3. Harden `AuthService.verifyToken` (`server/auth/auth.ts`) so unknown subjects cannot self-hydrate privileged roles from token claims alone without authoritative server registration, and eliminate unauthenticated body `userId` admin/owner spoofing (`effectiveUserId === 'usr_admin_root'`) and unauthenticated `v1Router` job/voice data exposure.
  4. Update `src/components/Header.tsx` if needed so legitimate local development sign-in continues cleanly and non-dev environments handle disabled demo bootstrap gracefully.
  5. Add dedicated in-process HTTP regression tests exercising the real `apiRouter` and `requireAuth`/`optionalAuth`/`requireRole` middlewares.
- **Acceptance Criteria**:
  - Unauthenticated requests to `POST /api/v1/auth/token` attempting `{ userId: "usr_admin_root" }`, `{ role: "admin" }`, `{ role: "creator" }`, `{ email: "security-admin@voiceforge.ai" }`, or `{ email: "alice@voiceforge.ai" }` are rejected (`401`/`403`) in **all** environments.
  - In `NODE_ENV=production` and `NODE_ENV=staging`, unauthenticated `POST /api/v1/auth/token` fails closed (`403`/`401`) for **all** requests.
  - Unauthenticated `POST /api/voices/clone/revoke-consent` and `DELETE /api/voices/:id` with body `{ userId: "usr_admin_root" }` or victim `userId` are rejected (`401`/`403`).
  - Existing legitimate authenticated flows and local dev demo bootstrap (if explicitly enabled in `development`) succeed only with non-privileged server-assigned roles.

### Phase 3C-S2 — Security Configuration, Rate-Limiting & Database Transport Remediation
- **Dependencies**: Completion of Phase 3C-S1.
- **Scope & Acceptance Criteria**:
  1. Apply `authRateLimiter` to `POST /api/v1/auth/token` and `POST /api/voices/clone/revoke-consent`; apply `synthesisJobRateLimiter` / `mediaUploadRateLimiter` consistently across synthesis and upload endpoints; consolidate duplicate `/v1` routes; fix health-skip path matching.
  2. Replace `.startsWith('postgres')` in `server/db/index.ts` and `server/db/migrate.ts` with strict `new URL()` connection-string parsing validating protocol (`postgres:`/`postgresql:`), non-empty hostname, valid port, and database pathname.
  3. Restore `rejectUnauthorized: true` (with optional explicit CA certificate support via env var) for remote PostgreSQL TLS, and forbid `sslmode=disable` in `staging`/`production`.
  4. Add `'staging'` to `envSchema` in `server/config/env.ts`; enforce fail-closed secret validation (`VOICEFORGE_AUTH_SECRET`, `VOICEFORGE_STORAGE_SECRET`, `VOICEFORGE_CONSENT_SECRET`, `VOICEFORGE_WATERMARK_KEY`), sanitized 500 errors, non-wildcard CORS requirements, and no-silent-demo rules consistently across both `'staging'` and `'production'`.
  5. Unify proxy trust configuration (`VOICEFORGE_TRUST_PROXY`) between `server.ts` and `rateLimiter.ts`, and bound default JSON payload size while keeping media limits scoped to media routes.

### Phase 3C-V2 — Independent Security Verification Gate
- **Dependencies**: Completion of Phase 3C-S1 and Phase 3C-S2.
- **Acceptance Criteria**:
  - Independent local reproduction of the historical `POST /api/v1/auth/token` privilege escalation verified rejected (`401`/`403`).
  - Full execution of Node integration/security/unit tests, Python stdlib tests, `tsc --noEmit`, and `vite build` / `esbuild` server bundle recorded with exact commands and exit codes; any unavailable checks (e.g., live PostgreSQL if daemon absent) explicitly marked `NOT RUN`.

### Phase 3D — Authoritative Persistence, Multi-Instance State & Deployment Architecture
- **Dependencies**: Phase 3C-V2 pass.
- **Acceptance Criteria**:
  - Design and implement authoritative PostgreSQL persistence for `users`, `voices`, `consent_records`, `synthesis_jobs`, `private_media`, `audit_events`, and `revoked_tokens` (eliminating process-local `userStore`, `customVoices`, and `ConsentVerificationEngine` amnesia across restarts).
  - Bind real S3-compatible private object storage SDK or persistent volume architecture with zero silent fallback in staging/production.
  - Wire `SynthesisJobWorker` into durable async job queue semantics and document concrete non-Vercel container/WebSocket/GPU deployment topology.

### Phase 3E — Controlled Staging Readiness Gate
- **Dependencies**: Phase 3D pass + explicit user authorization before provisioning or connecting to any staging infrastructure.
- **Acceptance Criteria**: End-to-end migration, TLS DB verification, secret rotation, observability, rollback runbook, and multi-tenant isolation verified on authorized staging infrastructure.

### Phase 4 — Genuine Neural Inference Integration
- **Dependencies**: Phase 3E pass + explicit user authorization for model weight downloads / GPU compute.
- **Acceptance Criteria**: One verified commercial-license neural speech engine (`k2-fsa/OmniVoice` or approved alternative) integrated end-to-end with real weights, truthful `NEURAL` / `PROVIDER` / `FALLBACK` / `DEMO` status across **all** audio and multimodal routes (removing silent mock MP4/SVG/transcript fallbacks), and real speaker-embedding biometric verification.

### Phase 5 — Product Completion & Benchmarking
- **Dependencies**: Phase 4 pass.
- **Acceptance Criteria**: Complete core user journeys, Zod request validation across all routes, durable credit metering/cost caps, accessibility audit, E2E suites, latency/WER/MOS benchmarks across EN/TA/HI/ML/JA, and complete license disclosures.

---

## 9. Exact Next Action & Why It Is Safe

- **Next Authorized Action**: Request explicit user authorization to execute **Phase 3C-S1 (Critical Authentication Remediation)** AND to install workspace Node.js dependencies from `package.json` (`npm install` via allowed `registry.npmjs.org`) so that the remediated authentication handlers, middleware, TypeScript compiler (`tsc --noEmit`), and local in-process HTTP regression suite can actually be executed rather than left static.
- **Why It Is Safe**:
  - Bounded strictly to authentication/authorization remediation (`server/routes/api.ts`, `server/auth/auth.ts`, `src/components/Header.tsx`, and local regression tests in `test/security/`).
  - Performs all verification against a synthetic, local, loopback (`127.0.0.1:0`) Express harness with zero external database, cloud provider, or deployed-service calls, and zero Git push/PR actions unless separately authorized.

---

## 10. Phase 0 Gate Verdict

- **Phase 0 Bootstrap & Source Reconciliation Verdict**: **`PASS WITH CONDITIONS`**
  - *Justification*: Repository identity, shallow Git history (`594593a129ee586e29143933e09b4ee634460567`), clean branch parity with public `main`, historical artifact hashes, P0 vulnerability code path, and all Phase 3C-S2/3D architectural gaps have been independently verified from source without mutating application files. Python stdlib tests (15/15) and zero-dependency Node watermark tests (4/4) were executed locally.
  - *Conditions*: (1) `node_modules`, `pytest`, and PostgreSQL binaries are not pre-installed in this sandbox, so full Node/TS/build/DB suites are truthfully recorded as **`NOT RUN`** pending dependency installation authorization; (2) **Overall Product / Staging / Production Security Verdict remains `FAIL (NOT READY)`** until `P0-AUTH-01` and subsequent gates are remediated and independently verified.
