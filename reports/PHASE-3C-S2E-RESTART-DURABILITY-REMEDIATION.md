# PHASE 3C-S2E — Targeted Remediation of Restart-Related Private Media Reauthorization (`S2D-NEW-01`)

- **Date:** 2026-10-28 (`Asia/Calcutta`)
- **Repository:** `/home/user/Voice-clone` (`ranimony-afk/Voice-clone`)
- **Branch:** `arena/3b3635b6-voice-clone` (`active`)
- **Base `HEAD` Commit:** `594593a129ee586e29143933e09b4ee634460567` (matches `origin/main`; uncommitted workspace state per standing git constraints)
- **Target Finding:** `S2D-NEW-01` (`P1 High`) from `reports/PHASE-3C-S2D-INDEPENDENT-SECURITY-VERIFICATION.md` (`1df7ca892a09664d2b649864059914c1002082c930dd6aa42328f755b2098f61`)

---

## 1. Executive Summary & Honest Gate Verdicts

Phase 3C-S2E remediates `S2D-NEW-01` — the sole remaining Phase 3C-S2D security finding in which previously issued HMAC-signed download URLs could reauthorize access to cancelled, consent-revoked, or voice-deleted private WAV artifacts after an OS process restart when either:
- **Case A:** the shared storage root could not accept atomic temp-file writes (`chmod 0o500`), causing `persistTombstonesSync()` and `provider.delete()` to fail while `ensureTombstonesLoaded()` reset `tombstoneLedgerHealthy = true` from a stale on-disk ledger and lifecycle endpoints still returned `200 OK { success: true }`; or
- **Case B:** `provider.delete()` failed (leaving WAV bytes on disk) and `.invalidated_media.json` was missing (`ENOENT`) in a populated storage directory on process restart, which `ensureTombstonesLoaded()` treated as an empty healthy ledger.

### Gate & Scope Verdicts

| Gate / Scope Dimension | Status | Basis |
| :--- | :--- | :--- |
| **`S2D-NEW-01` Local Filesystem & Multi-Process Restart Durability** | **REMEDIATED (`PASS` locally; pending independent S2F re-verification)** | Both Case A and Case B reproduced across separate OS processes before code changes (`91,638`B and `32,044`B WAV leaked pre-fix) and verified closed (`503` / `403`, `0` WAV bytes leaked) across fresh OS processes (`S2E-01`–`S2E-08`, `8/8` passing). |
| **Prior Security Protections (`S1`, `S2A`, `S2C` / `S2B-NEW-01,02,03,05,06`)** | **`PASS` (`65/65` across all 7 security suites)** | All prior auth, consent, dubbing, watermark, duplicate-header, secret-policy, media-listing, and `P0-7` cleanup-failure contracts remain intact (`123/123` across all 15 non-PG Node/TS suites; `15/15` Python OmniVoice tests). |
| **Live PostgreSQL Persistence (`127.0.0.1:5433`)** | **`BLOCKED` (separate environment blocker)** | `test/integration/postgres_persistence.test.ts`: `1/6` pass, `5/6` fail with `ECONNREFUSED 127.0.0.1:5433`. Live PostgreSQL durability was **not** tested and is **not** claimed. |
| **Client Production Bundle (`npm run build:client`)** | **`FAIL` (separate out-of-scope blocker)** | Fails resolving `react-is` imported by `node_modules/recharts/es6/util/ReactUtils.js` (`package.json`/`bun.lock` untouched per constraints). |
| **Overall Release Readiness** | **`NO-GO`** | Remains `NO-GO` pending independent security verification (`Phase 3C-S2F`) and resolution of the separate `react-is` client build and live PostgreSQL verification blockers. |

---

## 2. Read-Only Preflight Record

All preflight checks completed in read-only mode prior to any source or test modification, with zero discrepancies:

- **Repository Root & Branch:** `/home/user/Voice-clone` on `arena/3b3635b6-voice-clone` at `HEAD` `594593a129ee586e29143933e09b4ee634460567` (`origin` -> `https://github.com/ranimony-afk/Voice-clone.git`, no `git fetch`/`pull`/branch switch performed).
- **Verified Pre-S2E Checksums:**
  - `reports/PHASE-3C-S2D-INDEPENDENT-SECURITY-VERIFICATION.md`: `1df7ca892a09664d2b649864059914c1002082c930dd6aa42328f755b2098f61`
  - `reports/PHASE-3C-S2C-RESIDUAL-SECURITY-REMEDIATION.md`: `9b481d0aa8610f180dc472524007f58dde1a0c9314994af039cff9734887b155`
  - `reports/PHASE-3C-S2B-INDEPENDENT-SECURITY-VERIFICATION.md`: `7b07914a5b326283eb185cb76b481ddb70c14afc60bf3d27d09de2ae3eea31f9`
  - `server/storage/privateStorage.ts` (pre-S2E): `5eeb48480628ce0dc5f1c620076400758a9f376144f1214a68de73737be3ca44`
  - `server/routes/api.ts` (pre-S2E): `abd5d4b668071d40dddc3e5febfda6eec9db0169a6bc40e50fd4cdc1caf9c887`
  - `server.ts` (pre-S2E): `018ba360e6b26a01681975ebd025e6a0c9c05ff0b33345bbfd149df2b1f345` (`018ba360e6b26a01681975ebd025e6a0c9c05ff0b33345bbfd149df2b1f3b345`)
  - `storage/auth/revoked_tokens.json`: `6c29f5194bb7fbe434fe464610eb790756191e31ee6a938c12225b61f3a70e2e`
  - All other 19 tracked/untracked workspace files matched `PHASE-3C-S2D` §2.2 exactly; `reports/PHASE-3C-S2E-RESTART-DURABILITY-REMEDIATION.md` did not previously exist.

---

## 3. Pre-Remediation Empirical Reproduction (Separate OS Processes)

Before editing any code, both S2D failure modes were reproduced using temporary synthetic WAV fixtures and separate `tsx` OS processes:

1. **Case A (Unwritable shared storage root `0o500`):**
   - **Process 1:** Seeded `.invalidated_media.json` via an initial job cancel, created target synthesis job + signed URL, set `0o500` on `<storageDir>` and `<storageDir>/usr_alice_user`, and called `POST /api/v1/jobs/:id/cancel`.
   - **Pre-Fix Process 1 Result:** Returned **`200 OK`** `{ "success": true, "cleanupFailed": true }` even though `targetInDiskLedger === false`, `wavStillOnDisk === true`, and `PrivateStorageService.isInvalidationLedgerHealthy()` erroneously reset to **`true`** after re-reading the stale pre-existing `.invalidated_media.json`.
   - **Pre-Fix Process 2 (Fresh OS Restart) Result:** `GET <signedUrl>` returned **`200 OK`** with **`91,638` bytes** of valid `RIFF/WAVE` audio.

2. **Case B (Missing `.invalidated_media.json` after failed `provider.delete()`):**
   - **Process 1:** Stored synthetic private WAV (`32,044`B) and issued signed URL; forced `provider.delete()` to return `false` during `invalidateAndDeleteMedia()` (`cleanupFailed: true`, `PROVIDER_DELETE_RETURNED_FALSE`).
   - **Controlled Fault:** Unlinked `.invalidated_media.json` while the orphaned WAV remained in `<storageDir>/usr_alice_user/`.
   - **Pre-Fix Process 2 (Fresh OS Restart) Result:** `ensureTombstonesLoaded()` treated `ENOENT` on the populated storage directory as healthy/empty, and `GET <signedUrl>` returned **`200 OK`** with **`32,044` bytes** of valid `RIFF/WAVE` audio.

---

## 4. Root-Cause Remediation & Security Invariant Mapping

No new database, external storage provider, or architectural dependency was required. The defect was resolved within `server/storage/privateStorage.ts`, `server/routes/api.ts`, and `server.ts`:

### Key Code Changes

1. **Pre-Store Ledger & Companion WAL Initialization (`server/storage/privateStorage.ts`):**
   - `storeMedia()` now invokes `ensureLedgerInitializedBeforeStoreSync()` **before** `provider.store()` writes any private audio bytes, durably creating both `.invalidated_media.json` (`0o600`) and a pre-allocated append-only `.invalidated_media.json.wal` (`0o600`), `fsync`ing both files and `fsync`ing the parent directory descriptor (`fsyncDirectorySync()`).
   - If the ledger or storage root is unhealthy/unwritable, `storeMedia()` aborts with `StorageUnavailableError` before writing private audio.

2. **Fail-Closed Detection of Missing, Corrupted, Unreadable, Unwritable, and Non-Regular Ledgers (`server/storage/privateStorage.ts`):**
   - `mayPrivateArtifactsExistSync()` inspects `initializedLedgerPaths`, presence of `.invalidated_media.json.wal`, non-trivial entries in the ledger directory and active `LocalStorageProvider` / `VOICEFORGE_STORAGE_DIR` roots, and in-memory metadata on non-local providers. Whenever `.invalidated_media.json` is `ENOENT` while private artifacts may exist, `ensureTombstonesLoaded()` sets `tombstoneLedgerHealthy = false` (`MEDIA_TOMBSTONE_LEDGER_MISSING_WITH_ARTIFACTS`) and refuses private media access (`503` / `verifySignedUrl() === false`).
   - `isLedgerLocationWritableSync()` verifies regular-file `lstat` (rejecting symlinks/non-files), POSIX owner-write mode bits (`0o200`), and `fs.accessSync(..., R_OK | W_OK)` across the ledger directory, `.invalidated_media.json`, and `.invalidated_media.json.wal`.
   - High-resolution nanosecond `lstatSync(..., { bigint: true })` signatures (`ino`, `size`, `mtimeNs`, `ctimeNs`) prevent sub-millisecond stale-cache hits.
   - `checkDiskRecoverableAndMergeUnseenSync()` prevents `persistTombstonesSync()` from overwriting an unrecoverable corrupted or missing-with-artifacts primary ledger during subsequent cancellations/revocations so uncertain historical state never silently self-heals into authorization.

3. **Sticky Unpersisted Tombstones + Emergency WAL Defense-in-Depth (`server/storage/privateStorage.ts`):**
   - `unpersistedInvalidationsByPath` retains in-memory invalidations per ledger path whenever primary atomic snapshot persistence fails; `ensureTombstonesLoaded()` never clears `unpersistedInvalidationsByPath` or marks the ledger healthy until `writeLedgerSnapshotInternalSync()` durably writes all merged entries (`fsync` file + `renameSync` + `fsync` directory).
   - When directory-level `0o500` permissions block atomic temp-file creation (`EACCES`), `appendEmergencyWalSync()` appends and `fsync`s the tombstone into the pre-allocated `0o600` `.invalidated_media.json.wal` while still marking the primary ledger unhealthy (`false`). Even if an operator later restores `chmod 0o700` and restarts in a fresh OS process without retrying the API call, startup WAL replay compacts the tombstone into `.invalidated_media.json` and denies the prior signed URL with `403`.

4. **No False Success & Idempotent Recovery Across Lifecycle Routes (`server/routes/api.ts`, `server.ts`):**
   - `MediaInvalidationOutcome` now explicitly tracks `durableInvalidationEstablished: boolean` separately from physical byte `cleanupFailed: boolean`:
     - When `durableInvalidationEstablished === true` and `provider.delete()` fails (`P0-7` / `S2B-NEW-04a`), routes continue returning `200 OK` with `cleanupFailed: true` because the tombstone is durably recorded on disk.
     - When `durableInvalidationEstablished === false` (or the invalidation ledger is unhealthy), `POST /api/v1/jobs/:id/cancel`, `POST /api/voices/clone/revoke-consent`, `DELETE /api/voices/:id`, and `DELETE /api/v1/voices/:id` immediately enforce revocation/scrubbing in memory, retain retry tracking (`pendingCancelledJobMedia`, `pendingDeletedVoices`, and `invalidateByVoiceId` pending-entry scan), log a sanitized failure audit event, and return **HTTP `503`** `{ success: false, code: 'STORAGE_UNAVAILABLE', cleanupFailed: true }`.
   - `server.ts` initializes `PrivateStorageService` and runs `reconcilePendingDeletions()` before accepting traffic, and `/readyz` returns `503` when `isInvalidationLedgerHealthy()` is `false`.
   - Error handlers in `LocalStorageProvider` and `server/routes/api.ts` omit internal filesystem paths, secrets, and audio bytes.

### Mapping to the 9 Required Security Invariants

| # | Security Invariant | Enforcement Mechanism | Verified By |
| :--- | :--- | :--- | :--- |
| 1 | **No reauthorization after invalidation** | Pre-store ledger/WAL init + atomic snapshot (`fsync` file + dir) + emergency WAL replay + `verifySignedUrl()` / `getMedia()` / download route checks across fresh OS processes | `S2E-01`, `S2E-02`, `S2E-04`, `S2E-07`, `S2E-08` |
| 2 | **Fail closed on uncertain state** | `mayPrivateArtifactsExistSync()` (`ENOENT` with artifacts -> `503`), JSON/WAL corruption checks, `0o000`/`0o400`/`0o500` read/write checks, `lstat` symlink rejection | `S2E-01`, `S2E-02`, `S2E-03`, `S2E-05` |
| 3 | **No false success** | `durableInvalidationEstablished` gated in `cancel`, `revoke-consent`, `DELETE /voices/:id`, `DELETE /v1/voices/:id`, and `deleteMedia()` -> `503 { success: false }` | `S2E-01`, `S2E-02`, `S2E-05`, `S2E-06` |
| 4 | **Deletion failure is not authorization** | Tombstone persisted prior to `provider.delete()`; failed unlink keeps `cleanupFailed: true` and blocks signed/Bearer access across restarts | `S2E-03`, `S2E-04`, `S2E-08`, `P0-7`, `S2B-NEW-04a` |
| 5 | **Startup safety** | `server.ts` boot init + reconciliation, `/readyz` check, and synchronous `ensureTombstonesLoaded()` before any private media operation | `S2E-01`–`S2E-04`, `S2E-08` |
| 6 | **Concurrency safety** | Synchronous pre-await tombstone insert + snapshot write + union merge of unseen disk/WAL entries across overlapping async deletes | `S2E-07` (`8` concurrent cancels + reads + restart) |
| 7 | **Recovery safety** | Sticky `unpersistedInvalidationsByPath` + `pendingCancelledJobMedia`/`pendingDeletedVoices` retry completion after `chmod 0o700`, while unrecoverable corrupted/missing ledgers never self-heal | `S2E-01` (P3), `S2E-05`, `S2E-06` |
| 8 | **Scope isolation** | Valid sibling private media (`200` WAV), public premade catalog (`200`), cross-tenant `403`, anonymous `401`, expired/tampered HMAC `403` preserved | `S2E-04`, `S2E-06`, `S2E-08`, `S1`, `S2A`, `S2C` |
| 9 | **Safe failure responses** | Sanitized `StorageUnavailableError` and `503`/`403` JSON bodies verified free of `RIFF` WAV bytes, filesystem paths, and secrets | `S2E-01`–`S2E-03`, `P0-7` |

---

## 5. Post-Remediation Multi-Process Verification Summary

Re-running the exact Case A and Case B harnesses across isolated OS processes after remediation confirmed:
- **Case A:**
  - **Process 1 (`0o500` shared root):** `POST /api/v1/jobs/:id/cancel` -> **`503`** `{ "success": false, "code": "STORAGE_UNAVAILABLE", "cleanupFailed": true }`; emergency WAL entry durably `fsync`ed (`targetInEmergencyWal: true`); in-process signed URL fetch -> **`503`** (`0` WAV bytes).
  - **Process 2 (fresh OS PID while still `0o500`):** `GET <signedUrl>` -> **`503`** `STORAGE_UNAVAILABLE` (`0` WAV bytes).
  - **Process 3 (fresh OS PID after `chmod 0o700` repair):** WAL replayed & compacted; `GET <signedUrl>` -> **`403`** `MEDIA_ARTIFACT_INVALIDATED` (`0` WAV bytes); `reconcilePendingDeletions()` -> `resolved: 1` (orphaned `.wav` physically deleted).
- **Case B:**
  - **Process 1 (`provider.delete()` returns `false`) -> `.invalidated_media.json` (and `.wal`) removed -> Process 2 (fresh OS PID):** `isInvalidationLedgerHealthy() === false`; `GET <signedUrl>` -> **`503`** `STORAGE_UNAVAILABLE` (`0` WAV bytes).

All 8 tests in `test/security/phase3c_s2e_restart_durability.test.ts` (`S2E-01` through `S2E-08`) execute real multi-process restarts (`execFileSync` with distinct OS PIDs asserted) and pass (`8/8`).

---

## 6. Validation Matrix Results

| Validation Target | Command | Result | Details |
| :--- | :--- | :--- | :--- |
| **Phase 3C-S2E Restart Durability Suite** | `npx tsx --test test/security/phase3c_s2e_restart_durability.test.ts` | **PASS (`8/8`)** | Covers Case A, Case B, fresh OS restarts, cancel/revoke/voice-delete, ledger states, concurrency, retries, unrecoverable fail-closed permanence, valid access, and isolation |
| **Phase 3C-S1 Auth Remediation Suite** | `npx tsx --test test/security/phase3c_s1_auth_remediation.test.ts` | **PASS (`12/12`)** | Auth token minting, role isolation, revocation, cross-tenant denials intact |
| **Phase 3C-S2A Security Suite** | `npx tsx --test test/security/phase3c_s2a_remediation.test.ts` | **PASS (`12/12`)** | Includes `P0-7` (`200 OK { cleanupFailed: true }` when tombstone is durable) |
| **Phase 3C-S2C Residual Security Suite** | `npx tsx --test test/security/phase3c_s2c_residual_remediation.test.ts` | **PASS (`8/8`)** | All 5 previously passing S2D objectives (`S2B-NEW-01,02,03,05,06`) + `S2B-NEW-04a/b` intact |
| **All 7 Security Suites Combined** | `npx tsx --test test/security/*.test.ts` | **PASS (`65/65`)** | Includes `consent.test.ts` (`6/6`), `watermark.test.ts` (`4/4`), `phase3a_security.test.ts` (`15/15`) |
| **All 15 Non-PG Node/TS Suites** | `npx tsx --test <all 15 non-PG suites>` | **PASS (`123/123`)** | Unit (`normalizer`, `phonemizer`, `quality`), API (`routes`), integration (`consent_job_race`, `durable_revocation`, `rate_limit_and_db_fail_closed`, `storage_provider`), and all 7 security suites |
| **TypeScript Typecheck (`lint`)** | `npm run lint` (`tsc --noEmit`) | **PASS (exit `0`)** | Zero TypeScript errors |
| **Server Production Bundle** | `npm run build:server` | **PASS (exit `0`)** | Bundled `dist-server/server.js` cleanly (`397.6kb`, removed after check) |
| **Python OmniVoice Tests** | `python3 services/omnivoice/tests/run_tests.py` | **PASS (`15/15`)** | `Ran 15 tests in 0.322s — OK` |
| **Client Build (Separate Blocker)** | `npm run build:client` | **FAIL (separate)** | Pre-existing unresolved `react-is` import in `recharts` (`package.json`/`bun.lock` untouched) |
| **Live PostgreSQL Suite (Separate Blocker)** | `npx tsx --test test/integration/postgres_persistence.test.ts` | **BLOCKED (`1/6`)** | `5/6` fail with `ECONNREFUSED 127.0.0.1:5433` (no PostgreSQL service provisioned) |

---

## 7. Modified & Created File Inventory (Post-S2E SHA-256)

Only the minimum authorized files were modified or created; all temporary build/test directories (`dist-server/`, `dist/`, `/tmp/voiceforge-storage`) were cleaned, `storage/auth/revoked_tokens.json` was restored to `HEAD` (`6c29f5194bb7fbe434fe464610eb790756191e31ee6a938c12225b61f3a70e2e`), and all 23 other workspace files and historical reports (`PHASE-0` through `PHASE-3C-S2D`) retain their exact pre-S2E SHA-256 checksums:

- `server/storage/privateStorage.ts` (modified): `e0e733fd831513f91ee67fb43f186096bf0bbb354095076ecd3eee8cc612296d`
- `server/routes/api.ts` (modified): `5075602da7bcdaff7de0d76219dc366faab78587ccef3ea88a923cdf9524fa8f`
- `server.ts` (modified): `b76e5c6188ea390e9af8e46f89b4b5b40cbdf4f6e46b75916d5304449a68e894`
- `test/security/phase3c_s2e_restart_durability.test.ts` (new): `3320195fa8f2d2120ef1e2b8d8da240a84d65ec5a3ab1e99a5ff0941d57f3841`
- `reports/PHASE-3C-S2E-RESTART-DURABILITY-REMEDIATION.md` (new): Remediation report for Phase 3C-S2E
