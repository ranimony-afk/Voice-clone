# Phase 3C-S2G — Crash-Recovery and Fail-Closed State Hardening Report

**Date:** 2026-10-28  
**Phase:** `PHASE-3C-S2G` (Targeted Hardening Follow-Up to `PHASE-3C-S2F`)  
**Baseline Gate Authority:** `reports/PHASE-3C-S2F-INDEPENDENT-VERIFICATION.md` (`c719a00c6d747377e779c34ba49d323f89f44fa7c12a5bdd818cf5af47903e48`)  
**Scoped Targets:** `S2F-OBS-02` (Crash-Safe Private-Media Orphan Cleanup) & `S2F-OBS-03` (Preserving Valid Job Lifecycle State During Transient Invalidation-Ledger Faults)

---

## 1. Preflight Repository & Gate Identity

Read-only preflight verification was completed prior to making any workspace edits:

| Property | Verified Value |
| :--- | :--- |
| Working Directory (`pwd`) | `/home/user/Voice-clone` |
| Git Top-Level (`git rev-parse --show-toplevel`) | `/home/user/Voice-clone` |
| Active Branch (`git branch --show-current`) | `arena/3b3635b6-voice-clone` |
| `HEAD` Commit (`git rev-parse HEAD`) | `594593a129ee586e29143933e09b4ee634460567` |
| Remote `origin` (`git remote -v`) | `https://github.com/ranimony-afk/Voice-clone.git` (`fetch` / `push`) |
| Target Report Pre-Existence | `reports/PHASE-3C-S2G-CRASH-RECOVERY-HARDENING.md` did not exist (`DOES_NOT_EXIST`) |
| Pre-Existing Uncommitted Changes | Preserved intact across `server.ts`, `server/auth/auth.ts`, `server/config/env.ts`, `server/db/index.ts`, `server/engine/audio/{consent,synthesizer,watermark}.ts`, `server/routes/api.ts`, `server/storage/privateStorage.ts`, `src/components/{Header,MediaTranscribeTranslateView,VoiceCloningLabView}.tsx`, `test/api/routes.test.ts`, historical reports `PHASE-0`..`PHASE-3C-S2F`, and security suites `phase3c_s1`..`phase3c_s2e` |
| Dependency / Lockfile / Git Policy | `package.json`, `bun.lock`, and `.git` untouched; zero `git commit`, `push`, `reset`, `checkout`, or `clean` operations performed |

---

## 2. Root Causes & Controlled Pre-Fix Reproduction Evidence

### 2.1 `S2F-OBS-02` — Orphaned Private WAV Left Unreconciled After `SIGKILL` During Deletion

- **Root Cause (`server/storage/privateStorage.ts`):**
  1. In `PrivateStorageService.invalidateAndDeleteMedia()`, Step 1 durably persisted the tombstone entry with `cleanupFailed: false` **before** calling `this.provider.delete(meta.storageKey)` and `this.deleteFromDatabaseIfConnected(mediaId)`. Only if `provider.delete()` returned normally and `provider.exists()` remained `true` (or threw) did Step 3 rewrite the entry with `cleanupFailed: true` and re-persist.
  2. Consequently, if the OS process terminated abruptly via `SIGKILL` after Step 1 persisted `.invalidated_media.json` (or `.invalidated_media.wal.ndjson`) and before `provider.delete()` unlinked the physical `.wav` file, authorization remained durably denied (`403`, `0` WAV bytes), **but** `.invalidated_media.json` already recorded `cleanupFailed: false`. On subsequent fresh-process startup, `PrivateStorageService.reconcilePendingDeletions()` skipped all entries where `!entry.cleanupFailed`, leaving the unreferenced `.wav` orphaned on disk indefinitely.
  3. Additionally, `LocalStorageProvider.exists(key)` called `fs.existsSync(fullPath)`, which conflates genuine file absence (`ENOENT`) with directory stat/traversal failures (`EACCES`/`EIO`), risking false confirmation of physical cleanup if a tenant subdirectory became unreadable (`0o000`).

- **Controlled Pre-Fix Subprocess Reproduction:**
  - **Process 1 (`PID 16407`):** Created synthetic private TTS output (`200 OK`, `58,038` RIFF WAV bytes via signed URL), armed `process.kill(process.pid, 'SIGKILL')` inside `provider.delete()` prior to physical `unlink`, and invoked `POST /api/v1/jobs/:id/cancel`. Process terminated with `SIGKILL`.
  - **Process 2 (`PID 16443`, fresh OS process):** Inspected `.invalidated_media.json` (`cleanupFailed: false`), ran `PrivateStorageService.reconcilePendingDeletions()` -> `{ attempted: 0, resolved: 0, stillFailing: 0 }`, and verified the orphaned `.wav` remained on disk (`wavExistsAfterReconcile: true`), while replay of the pre-crash signed URL returned `403` (`0` WAV bytes).

### 2.2 `S2F-OBS-03` — Permanent In-Memory Job State Mutation During Transient Ledger Faults

- **Root Cause (`server/routes/api.ts`):**
  1. `PrivateStorageService.isMediaInvalidated(mediaId)` intentionally returns `true` when `!this.tombstoneLedgerHealthy` so download authorization fails closed during storage/ledger faults.
  2. However, job-polling handlers (`GET /api/v1/tts/jobs`, `GET /api/v1/tts/jobs/:id`, `GET /api/v1/jobs/:id`, and `GET /api/media/jobs`, `GET /api/media/jobs/:id`) evaluated `PrivateStorageService.isMediaInvalidated(job.outputMediaId)` directly without first checking `PrivateStorageService.assertInvalidationLedgerHealthy()`.
  3. When a transient invalidation-ledger fault occurred (e.g., storage root temporarily `0o500`), polling an uncancelled completed job treated the fail-closed `true` return from `isMediaInvalidated()` as a permanent cancellation, invoked `scrubJobAudioArtifactsInMemory(job, 'Synthesis job has been cancelled.')`, returned `200 OK` with `status: 'cancelled'`, and permanently destroyed `job.result`, `job.outputMediaId`, and `job.outputSignedUrl` in memory even after storage permissions were restored (`0o700`).

- **Controlled Pre-Fix Reproduction:**
  - Created two valid uncancelled completed synthesis jobs (`status: 'completed'`), injected transient `chmod 0o500` on `VOICEFORGE_STORAGE_DIR`, polled `GET /api/v1/tts/jobs` (`200`) and `GET /api/v1/jobs/:id` (`200`), restored `chmod 0o700`, and polled again: both uncancelled jobs remained permanently mutated to `status: 'cancelled'` with `detailJobHasResultAfterRestore: false`.

---

## 3. Exact Files Changed & Narrowly Scoped Remediation

Only two application files and one new regression test file were modified/created prior to this report:

| File | Pre-S2G SHA-256 | Post-S2G SHA-256 | Summary of Scoped Change |
| :--- | :--- | :--- | :--- |
| `server/storage/privateStorage.ts` | `e0e733fd831513f91ee67fb43f186096bf0bbb354095076ecd3eee8cc612296d` | `e70f6763113362470dd562c1b8ba680b04a0580a096f76fc1457f6e911568a8d` | Crash-safe two-phase cleanup accounting (`cleanupFailed: true` / `CLEANUP_PENDING` persisted before `provider.delete()`), `LocalStorageProvider.exists()` `ENOENT` vs `StorageUnavailableError` separation (`lines 165–179`), `storageKey`/`voiceId` retention in `validateAndMergeEntry` (`lines 302–307`), `verifyOrPerformPhysicalCleanup()` (`lines 919–1023`), hardened `reconcilePendingDeletions()` (`lines 1030–1077`), and crash-safe `invalidateAndDeleteMedia()` (`lines 1530–1678`). |
| `server/routes/api.ts` | `5075602da7bcdaff7de0d76219dc366faab78587ccef3ea88a923cdf9524fa8f` | `8825e53a208fe0bdd57403df87894539417172ad31717bd8ce2a6a2051a4661e` | Fail-closed `503 STORAGE_UNAVAILABLE` check via `PrivateStorageService.assertInvalidationLedgerHealthy()` prior to evaluating `isMediaInvalidated(job.outputMediaId)` on uncancelled jobs in `GET /api/v1/tts/jobs` (`lines 1857–1924`), `GET /api/v1/tts/jobs/:id` (`lines 1978–2003`), `GET /api/media/jobs` (`lines 2663–2686`), `GET /api/media/jobs/:id` (`lines 2742–2763`), and `GET /api/v1/jobs/:id` (`lines 3691–3716`), while preserving authentication (`401`), tenant ownership (`403 FORBIDDEN_NOT_OWNER`), and eager consent revocation (`403 CONSENT_REVOKED`). |
| `test/security/phase3c_s2g_crash_recovery_hardening.test.ts` | *(new file)* | `91e11f8e41d0c13e7a93f1c88325f98bbc5dedef3e23056d34a9aff93d8bd2be` | Dedicated subprocess `SIGKILL` crash-recovery & transient ledger-fault regression suite (`S2G-01` through `S2G-04`). |

### Key Design Properties Verified

1. **Authorization Denial vs. Physical Cleanup Strictly Separated (`Objective A`):**
   - Step 1 durably persists the invalidation tombstone (`cleanupFailed: true`, `cleanupFailureCode: 'CLEANUP_PENDING'`) **before** any `provider.delete()` or database metadata deletion begins.
   - Step 3 clears `cleanupFailed = false` (and removes `cleanupFailureCode`) **only after** `verifyOrPerformPhysicalCleanup()` confirms physical absence (`provider.delete() === true && provider.exists() === false` when the file existed, or `ENOENT` on an available provider when already unlinked) **and** `deleteFromDatabaseIfConnected()` succeeds, followed by a durable snapshot write.
   - `reconcilePendingDeletions()` reverts in-memory `cleanupFailed` transitions and throws `StorageUnavailableError` if persisting reconciled tombstone state fails, never clearing pending cleanup prematurely.
   - No reconciliation or recovery path ever removes an entry from `invalidatedMedia` or reauthorizes a previously invalidated artifact.
2. **Non-Mutating Fail-Closed Job Polling (`Objective B`):**
   - Authentication (`401`), job lookup (`404`), cross-tenant ownership (`403 FORBIDDEN_NOT_OWNER`), and revoked biometric consent (`403 CONSENT_REVOKED` + eager memory scrub) execute first.
   - Before evaluating `PrivateStorageService.isMediaInvalidated(job.outputMediaId)` on any uncancelled job, polling routes invoke `PrivateStorageService.assertInvalidationLedgerHealthy()`. When the ledger is unhealthy, the route catches `StorageUnavailableError` and returns `503 { error: 'Storage backend is currently unavailable', code: 'STORAGE_UNAVAILABLE' }` with zero audio, signed URLs, or storage paths leaked and **zero mutation** of valid job state in `memoryStore` or `asyncJobsLedger`.

---

## 4. Crash-Injection Methodology, Fresh-Process Recovery & Returned-Byte Counts

All crash-recovery claims were verified using real OS child processes spawned directly via `process.execPath` (`node --import tsx --input-type=module -e ...`) against isolated temporary `VOICEFORGE_STORAGE_DIR` roots and synthetic PCM WAV signals (never in-process helper mocks alone):

| Scenario | Crash / Fault Injection | Fresh-Process Recovery & State Evidence | Returned WAV Bytes |
| :--- | :--- | :--- | :--- |
| **`S2G-01`: `SIGKILL` before physical `unlink` (`POST /api/v1/jobs/:id/cancel`)** | Child process armed `process.kill(process.pid, 'SIGKILL')` inside `provider.delete()` before unlinking `.wav` (`killRun.signal === 'SIGKILL'`). Pre-cancel signed URL returned `200 OK` (`> 1,000` RIFF WAV bytes). | Immediately post-`SIGKILL`, `.invalidated_media.json` held `cleanupFailed: true` (`CLEANUP_PENDING`) while `.wav` still existed on disk. Fresh OS process (`p2.pid !== p1.pid`) probed signed URL **before** reconciliation (`403`), ran `reconcilePendingDeletions()` -> `{ attempted: 1, resolved: 1, stillFailing: 0 }`, confirmed `wavExistsAfterRec1 === false` and `cleanupFailed === false`, and verified idempotency on second call and third fresh OS process (`p3.pid !== p2.pid`) -> `{ attempted: 0, resolved: 0, stillFailing: 0 }`. | **`0` WAV bytes** before reconciliation (`403`), after reconciliation (`403`), via Bearer download (`403`), and after subsequent OS restart (`403`). |
| **`S2G-02`: `SIGKILL` after physical `unlink` + Failed Delete + `0o000` `EACCES` Directory** | Child process unlinked `.wav` inside `provider.delete()` and immediately executed `process.kill(process.pid, 'SIGKILL')` before Step 3 persisted `cleanupFailed: false`. Second artifact tested `delete() => false` and `chmod 0o000` on tenant subdirectory (`EACCES` on `lstatSync`). | Fresh OS process reconciled missing post-unlink artifact cleanly (`{ attempted: 1, resolved: 1, stillFailing: 0 }`). For second artifact, `delete() => false` and `0o000` `EACCES` both preserved `cleanupFailed: true` (`{ attempted: 1, resolved: 0, stillFailing: 1 }`). Restoring `0o700` allowed `reconcilePendingDeletions()` to unlink the `.wav` (`{ attempted: 1, resolved: 1, stillFailing: 0 }`, `wavPresentAfter700 === false`). | **`0` WAV bytes** (`403`) across both artifacts and all failure/recovery transitions. |
| **`S2G-03`: Transient `0o500` Ledger Fault on `GET /api/v1/tts/jobs`, `GET /api/v1/jobs/:id`, `GET /api/v1/tts/jobs/:id`** | Created valid completed synthesis jobs (`validJobA`, `validJobB`) and cloned-voice job, injected `chmod 0o500` on `jobDir`, polled all three endpoints, then restored `chmod 0o700`, explicitly cancelled `validJobB`, and revoked cloned-voice consent. | During `0o500`, anonymous returned `401`, cross-tenant Bob returned `403 FORBIDDEN_NOT_OWNER`, and Alice's polling on all three routes returned `503 STORAGE_UNAVAILABLE` (`dlDuringFault: 503`). After `chmod 0o700`, `validJobA` and `validJobB` remained `status: 'completed'` (`200 OK`) with intact audio results and working signed URL (`200 OK` RIFF WAV). Explicit cancel transitioned `validJobB` to `'cancelled'` (`403`), and consent revocation returned `403 CONSENT_REVOKED` on `clonedJob` while `validJobA` stayed `'completed'`. | **`0` WAV bytes** during `503` fault, **`0` WAV bytes** after explicit cancel (`403`), and valid RIFF WAV bytes (`200 OK`) on uncancelled `validJobA` after fault recovery. |
| **`S2G-04`: `SIGKILL` Mid-Batch Voice Consent Revocation + `GET /api/media/jobs` Transient Fault** | Child process enrolled synthetic cloned voice, generated two TTS outputs, and triggered `SIGKILL` on the second `provider.delete()` call during `POST /api/voices/clone/revoke-consent`. Separate `0o500` fault injected on `GET /api/media/jobs` and `GET /api/media/jobs/:id`. | Fresh OS process (`b2.pid !== b1.pid`) ran idempotent `invalidateByVoiceId()` + `reconcilePendingDeletions()`, confirming both `.wav` files physically deleted (`w1Exists: false`, `w2Exists: false`). Media dubbing job routes returned `503` during `0o500` fault and preserved `status: 'completed'` (`200 OK`) once `0o700` was restored. | **`0` WAV bytes** (`403`) on both revoked-voice signed URLs and **`0` WAV bytes** (`503`) during media-job fault polling. |

---

## 5. Regression Validation Commands & Exit Codes

| Validation Check | Exact Command | Exit Code | Result |
| :--- | :--- | :---: | :--- |
| **New Phase 3C-S2G Suite** | `./node_modules/.bin/tsx --test test/security/phase3c_s2g_crash_recovery_hardening.test.ts` | `0` | **PASS** (`4 / 4` tests, `1` suite) |
| **S1 + S2A + S2C + S2E + S2G Security Suites** | `./node_modules/.bin/tsx --test test/security/phase3c_s1_auth_remediation.test.ts test/security/phase3c_s2a_remediation.test.ts test/security/phase3c_s2c_residual_remediation.test.ts test/security/phase3c_s2e_restart_durability.test.ts test/security/phase3c_s2g_crash_recovery_hardening.test.ts` | `0` | **PASS** (`44 / 44` tests, `5` suites) |
| **All Non-PostgreSQL Node/TS Suites (`16` files)** | `./node_modules/.bin/tsx --test test/api/routes.test.ts test/integration/consent_job_race.test.ts test/integration/durable_revocation.test.ts test/integration/rate_limit_and_db_fail_closed.test.ts test/integration/storage_provider.test.ts test/security/consent.test.ts test/security/phase3a_security.test.ts test/security/phase3c_s1_auth_remediation.test.ts test/security/phase3c_s2a_remediation.test.ts test/security/phase3c_s2c_residual_remediation.test.ts test/security/phase3c_s2e_restart_durability.test.ts test/security/phase3c_s2g_crash_recovery_hardening.test.ts test/security/watermark.test.ts test/unit/normalizer.test.ts test/unit/phonemizer.test.ts test/unit/quality.test.ts` | `0` | **PASS** (`127 / 127` tests, `16` suites) |
| **TypeScript Typecheck (`lint`)** | `npm run lint` (`tsc --noEmit`) | `0` | **PASS** (`0` errors) |
| **Server Bundle Build** | `npm run build:server` | `0` | **PASS** (`dist-server/server.js` `403.7kb`, cleaned post-check) |
| **Python OmniVoice Test Suite** | `python3 services/omnivoice/tests/run_tests.py` | `0` | **PASS** (`15 / 15` tests) |
| **PostgreSQL Persistence Suite** *(separate)* | `./node_modules/.bin/tsx --test test/integration/postgres_persistence.test.ts` | `1` | **BLOCKED** (`ECONNREFUSED` on `127.0.0.1:5433`; PostgreSQL not provisioned in sandbox) |
| **Client Production Build** *(separate)* | `npm run build:client` (`vite build`) | `1` | **FAIL** (Pre-existing unresolved `react-is` import from `recharts/es6/util/ReactUtils.js`; untouched per dependency/scope constraints; `dist/` cleaned post-check) |

---

## 6. Historical Artifact & Baseline Checksum Preservation

All historical reports, package manifests, and baseline files were verified unchanged via `sha256sum`:

| Preserved File | Verified SHA-256 Checksum | Status |
| :--- | :--- | :---: |
| `reports/PHASE-3C-S2F-INDEPENDENT-VERIFICATION.md` | `c719a00c6d747377e779c34ba49d323f89f44fa7c12a5bdd818cf5af47903e48` | **PRESERVED** |
| `reports/PHASE-3C-S2E-RESTART-DURABILITY-REMEDIATION.md` | `ec0dc471f4f5154c5ed7df86581e3ca23223e081d398f8dd8631f8bb185c36af` | **PRESERVED** |
| `reports/PHASE-3C-S2D-INDEPENDENT-SECURITY-VERIFICATION.md` | `1df7ca892a09664d2b649864059914c1002082c930dd6aa42328f755b2098f61` | **PRESERVED** |
| `reports/PHASE-3C-S2C-RESIDUAL-SECURITY-REMEDIATION.md` | `9b481d0aa8610f180dc472524007f58dde1a0c9314994af039cff9734887b155` | **PRESERVED** |
| `reports/PHASE-3C-S2B-INDEPENDENT-SECURITY-VERIFICATION.md` | `7b07914a5b326283eb185cb76b481ddb70c14afc60bf3d27d09de2ae3eea31f9` | **PRESERVED** |
| `reports/PHASE-3C-S2A-CRITICAL-SECURITY-REMEDIATION.md` | `e984fd03ed34427bd869be765bed8902830d8f9f27157e33b02f7a584703a912` | **PRESERVED** |
| `reports/PHASE-3C-V2-INDEPENDENT-VERIFICATION.md` | `d51ebc96781a33a62891610c13a518bfd25d2319dec364f79fca482d046f44ed` | **PRESERVED** |
| `reports/PHASE-3C-S1-CRITICAL-AUTH-REMEDIATION.md` | `337039b386d156f4e727dd1e8ffadf93bf03e3e1ab86c61d41388f37cae9970e` | **PRESERVED** |
| `reports/PHASE-0-NEW-ARENA-BOOTSTRAP-AND-ROADMAP.md` | `2a3672393f93bd4fcb954f024245dec2abec64b789335ece06669f138b5a2772` | **PRESERVED** |
| `package.json` | `96cb310c3093ccd9cc352f8bbfd007fdb97c33b88bf1ab0c02839cd74470d400` | **PRESERVED** |
| `bun.lock` | `6dbe0469946c602996493bb706e9eff060cf5ed1afd2c71134b23afdcb826e48` | **PRESERVED** |
| `storage/auth/revoked_tokens.json` | `6c29f5194bb7fbe434fe464610eb790756191e31ee6a938c12225b61f3a70e2e` | **PRESERVED** |
| `server.ts` | `b76e5c6188ea390e9af8e46f89b4b5b40cbdf4f6e46b75916d5304449a68e894` | **PRESERVED** |
| `test/security/phase3c_s2e_restart_durability.test.ts` | `3320195fa8f2d2120ef1e2b8d8da240a84d65ec5a3ab1e99a5ff0941d57f3841` | **PRESERVED** |

---

## 7. Separate Phase 3C-S2G Verdicts

| Evaluation Dimension | Verdict | Basis |
| :--- | :---: | :--- |
| **1. Durable Authorization Invalidation** | **PASS** | Step 1 invalidation tombstones are durably persisted prior to storage/DB deletion; signed URL and Bearer downloads return `403` (`0` WAV bytes) immediately after `SIGKILL`, during failed cleanup, and across repeated fresh OS restarts; unhealthy ledgers fail closed (`503`). |
| **2. Physical Artifact Cleanup (`S2F-OBS-02`)** | **PASS** | `cleanupFailed: true` (`CLEANUP_PENDING`) is recorded durably before `provider.delete()` and cleared only after verified physical absence (`ENOENT` on available storage or `delete() === true && !exists()`) + DB cleanup. Fresh OS subprocesses discover and delete `SIGKILL`-orphaned `.wav` files idempotently, while failed deletes and unreadable `0o000` directories retain `cleanupFailed: true`. |
| **3. Job Lifecycle-State Integrity (`S2F-OBS-03`)** | **PASS** | Transient invalidation-ledger faults (`0o500`) cause job-polling routes (`GET /api/v1/tts/jobs`, `GET /api/v1/tts/jobs/:id`, `GET /api/v1/jobs/:id`, `GET /api/media/jobs`, `GET /api/media/jobs/:id`) to fail closed (`503 STORAGE_UNAVAILABLE`, `0` audio/metadata leaked) without mutating valid jobs into `'cancelled'`, while explicit cancellation, consent revocation (`403 CONSENT_REVOKED`), and tenant isolation (`403 FORBIDDEN_NOT_OWNER`) remain enforced. |
| **4. PostgreSQL Durability** | **BLOCKED** | Local PostgreSQL instance (`127.0.0.1:5433`) is not running in this sandbox (`ECONNREFUSED`); live PostgreSQL persistence remains unverified here and must not be claimed as `PASS`. |
| **5. Client Build Status** | **FAIL** | `npm run build:client` fails (`exit 1`) on pre-existing missing `react-is` dependency required by `recharts`; intentionally left untouched per strict S2G scope and manifest constraints. |
