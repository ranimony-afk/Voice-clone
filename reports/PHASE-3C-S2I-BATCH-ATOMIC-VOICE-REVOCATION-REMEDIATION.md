# Phase 3C-S2I — Batch-Atomic Voice Revocation & Shared-Worker Fail-Closed Remediation Report

**Document ID:** `PHASE-3C-S2I-BATCH-ATOMIC-VOICE-REVOCATION-REMEDIATION`  
**Date:** `2026-10-28`  
**Repository:** `ranimony-afk/Voice-clone` (`/home/user/Voice-clone`)  
**Branch:** `arena/3b3635b6-voice-clone` (status: `active`)  
**Base Commit (`HEAD`):** `594593a129ee586e29143933e09b4ee634460567`  
**Phase Status:** **REMEDIATION COMPLETE — READY FOR INDEPENDENT PHASE 3C-S2J VERIFICATION**

---

## 1. Executive Summary & Remediation Verdict

Phase 3C-S2I remediates finding **`S2H-NEW-01`** identified during the Phase 3C-S2H independent adversarial audit (`reports/PHASE-3C-S2H-INDEPENDENT-VERIFICATION.md`, SHA-256 `419099cd656ac741d99276368a3fe41f8a31265fa685485abb792987469cff24`).

### Remediation Verdict: **COMPLETE (`S2H-NEW-01` CLOSED)**

1. **Batch-Atomic Pre-Delete Durability Barrier (`PrivateStorageService.invalidateByVoiceId` & `purgeVoiceArtifactsAndJobs`)**:
   - Before invoking the first `provider.delete()` or connected PostgreSQL delete, `invalidateByVoiceId()` enumerates the complete affected artifact set across `memoryStore.privateMedia`, the shared durable `persistedMediaCatalog`, existing tombstones, caller-supplied job references (`additionalArtifacts` from `synthesisJobs`, `asyncJobsLedger`, and `transcriptionJobs`), and connected PostgreSQL `synthesis_jobs`/`private_media` tables.
   - It then commits a durable voice-level invalidation barrier (`Step 1A: 'voice_barrier'` -> `invalidatedVoices`) followed by a single atomic flushed write of `CLEANUP_PENDING` (`cleanupFailed: true`, `storageKey`, `voiceId`) tombstones for **every** affected artifact (`Step 1B: 'batch_tombstones'`) prior to any destructive storage or database operation.
   - Single-artifact `invalidateAndDeleteMedia()` likewise gates `verifyOrPerformPhysicalCleanup()` and `deleteFromDatabaseIfConnected()` on `persistTombstonesSync() === true` in both its initial and `!meta && existingInv` retry branches.
2. **Shared-Worker & Hydrated-Catalog Fail-Closed Authorization**:
   - `.invalidated_media.json` (and companion `.invalidated_media.json.wal`) now durably track `invalidatedVoices` (`consent_revoked` / `voice_deleted`) and `mediaCatalog` (`id`, `ownerId`, `voiceId`, `storageKey`, `createdAt`, recorded durably in `storeMedia()` before `provider.store()`).
   - `resolveEffectiveInvalidationSync(mediaId)` evaluates both direct `invalidatedMedia` tombstones and `invalidatedVoices` via `memoryStore.privateMedia` + `persistedMediaCatalog`, ensuring `verifySignedUrl()`, `hasValidSignedUrlForInvalidatedMedia()`, `getMedia()`, `isMediaInvalidated()`, `getInvalidationRecord()`, and `GET /api/v1/media/download/:id` return **`0` WAV bytes** (`403 CONSENT_REVOKED` / `403 MEDIA_ARTIFACT_INVALIDATED`) across pre-hydrated workers, live sibling workers without restart, and unhydrated fresh workers—even if `SIGKILL` terminates the revoking process between `Step 1A` and `Step 1B` or during item 1 physical deletion.
   - Custom/cloned voice API routes (`POST /api/tts/synthesize`, `POST /api/v1/tts/jobs`, `GET /api/voices`, `GET /api/v1/voices`, `GET /api/v1/voices/:id`, `GET /api/voices/:id/export`, `POST /api/voices/cross-lingual-test`, `POST /api/speech-to-speech`, `POST /api/media/transcribe-translate`, `POST /api/v1/media/upload`) synchronize durable voice state on every request and fail closed (`503 STORAGE_UNAVAILABLE`, `0` audio bytes) if the shared invalidation ledger is unreadable or corrupted.
3. **Self-Contained Crash Recovery Without Process-Local Memory**:
   - A fresh OS process calling only `PrivateStorageService.init()` and `await PrivateStorageService.reconcilePendingDeletions()` (without manually calling `invalidateByVoiceId()`) promotes any cataloged artifacts belonging to `invalidatedVoices`, retries physical + connected DB deletion for all `cleanupFailed: true` tombstones, prunes resolved catalog entries, and clears `cleanupFailed` **only** after verified physical absence and durable `reconcile_persist` commit.

---

## 2. Repository Identity, Worktree State & Input Artifact Hashes

| Property | Verified Value |
| :--- | :--- |
| Repository Root | `/home/user/Voice-clone` |
| Remote Origin | `https://github.com/ranimony-afk/Voice-clone.git` |
| Active Branch | `arena/3b3635b6-voice-clone` (`active`) |
| `HEAD` Commit | `594593a129ee586e29143933e09b4ee634460567` |
| Input Report (`S2H`) | `reports/PHASE-3C-S2H-INDEPENDENT-VERIFICATION.md` — `419099cd656ac741d99276368a3fe41f8a31265fa685485abb792987469cff24` (**EXACT MATCH**) |
| Prior Report (`S2G`) | `reports/PHASE-3C-S2G-CRASH-RECOVERY-HARDENING.md` — `31411c07d8c8c4a53dfccf32f07ebaaf4904f224b1a0b6471817f3cff2d2ce14` (untouched) |
| Prior Report (`S2F`) | `reports/PHASE-3C-S2F-INDEPENDENT-VERIFICATION.md` — `c719a00c6d747377e779c34ba49d323f89f44fa7c12a5bdd818cf5af47903e48` (untouched) |
| Prior Report (`S2E`) | `reports/PHASE-3C-S2E-RESTART-DURABILITY-REMEDIATION.md` — `ec0dc471f4f5154c5ed7df86581e3ca23223e081d398f8dd8631f8bb185c36af` (untouched) |
| Prior Report (`S2D`) | `reports/PHASE-3C-S2D-INDEPENDENT-SECURITY-VERIFICATION.md` — `1df7ca892a09664d2b649864059914c1002082c930dd6aa42328f755b2098f61` (untouched) |
| Preserved Token Store | `storage/auth/revoked_tokens.json` — `6c29f5194bb7fbe434fe464610eb790756191e31ee6a938c12225b61f3a70e2e` (untouched) |
| Frozen Dependency Manifests | `package.json` (`96cb310c3093ccd9cc352f8bbfd007fdb97c33b88bf1ab0c02839cd74470d400`), `bun.lock` (`6dbe0469946c602996493bb706e9eff060cf5ed1afd2c71134b23afdcb826e48`) (untouched) |

---

## 3. Exact Root-Cause Analysis of `S2H-NEW-01`

Prior to Phase 3C-S2I, three interacting architectural gaps existed across `server/storage/privateStorage.ts` and `server/routes/api.ts`:

1. **Sequential Item-by-Item Tombstone Persistence Interleaved With Physical Deletion**:
   - `PrivateStorageService.invalidateByVoiceId()` iterated `candidateIds` in a `for (const mediaId of candidateIds)` loop calling `await this.invalidateAndDeleteMedia(...)` one artifact at a time, and `purgeVoiceArtifactsAndJobs()` in `server/routes/api.ts` had a second sequential loop over `discoveredMedia`.
   - Each iteration wrote item `i`'s tombstone and immediately executed `provider.delete(storageKey)` + database deletion before item `i + 1` received any durable tombstone. If `SIGKILL` or power loss terminated the process during item `1`'s physical deletion in a 3-artifact voice batch, items `2` and `3` had **zero** durable tombstones on disk and **zero** `cleanupFailed: true` markers for startup reconciliation.
2. **Destructive Cleanup Not Gated on Pre-Delete Persistence Outcome**:
   - `invalidateAndDeleteMedia()` called `this.persistTombstonesSync([entry])` without checking its boolean return value before invoking `verifyOrPerformPhysicalCleanup()` and `deleteFromDatabaseIfConnected()` (and in its `!meta && existingInv` retry branch ran `verifyOrPerformPhysicalCleanup()` *before* `persistTombstonesSync()`).
3. **Process-Local Voice Revocation & Media Lineage Across Shared-Storage Workers**:
   - `.invalidated_media.json` stored only `entries: InvalidatedMediaEntry[]`. Neither voice-level revocation (`invalidatedVoices`) nor stored artifact lineage (`mediaCatalog`) was durably shared across workers, and `ConsentVerificationEngine` + `customVoices` in `server/routes/api.ts` were purely process-local. Consequently, a pre-hydrated or sibling worker sharing `VOICEFORGE_STORAGE_DIR` could continue serving pre-revocation signed URLs (`200` WAV bytes) for untouched tail items after a mid-batch crash or continue synthesizing/exporting a voice revoked on another worker.

---

## 4. Batch-Atomic Invalidation Design & State-Machine Lifecycle

```
[Active Voice + Stored Artifacts in mediaCatalog]
        │
        ▼  invalidateByVoiceId({ voiceId, requestingUserId, reason, additionalArtifacts })
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 0: Enumerate Complete Batch                                             │
│   Union of: memoryStore.privateMedia + persistedMediaCatalog +               │
│   invalidatedMedia + additionalArtifacts + connected PG synthesis_jobs/media │
│   (If connected PG query fails -> fail closed, 0 destructive deletes)        │
└──────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 1A ('voice_barrier'): Atomic Snapshot (or Emergency WAL) Commit         │
│   Persists InvalidatedVoiceEntry { voiceId, ownerId, reason, invalidatedAt } │
│   -> Immediately blocks ALL cataloged/hydrated artifacts of voiceId across   │
│      all workers even before per-artifact entries are written.               │
│   (If persistence fails -> 0 provider.delete() / DB deletes, HTTP 503)       │
└──────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 1B ('batch_tombstones'): Atomic Full-Batch Pending-Cleanup Commit       │
│   Persists InvalidatedMediaEntry for ALL N artifacts with:                   │
│     cleanupFailed: true, cleanupFailureCode: 'CLEANUP_PENDING', storageKey   │
│   fsync(tmp) -> rename(tmp, .invalidated_media.json) -> fsync(dir)           │
│   (If persistence fails -> 0 provider.delete() / DB deletes, HTTP 503)       │
└──────────────────────────────────────────────────────────────────────────────┘
        │
        ▼  (ONLY after both Step 1A and Step 1B succeed durably)
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: Physical & Connected-DB Cleanup Per Pending Artifact                 │
│   verifyOrPerformPhysicalCleanup(storageKey) + deleteFromDatabaseIfConnected │
│   Verified physical absence + DB ok -> cleanupFailed = false + prune catalog │
│   Otherwise -> retain cleanupFailed = true + sanitized failureCode           │
└──────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ STEP 3 ('post_cleanup'): Atomic Final Cleanup-Status Commit                  │
│   Persists updated tombstones + pruned mediaCatalog.                         │
│   If Step 3 persistence fails -> reverts resolvedNow items back to           │
│   cleanupFailed: true, restores mediaCatalog, returns durable=false (503).   │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Precedence Preservation**: `consent_revoked` strictly dominates `voice_deleted` and `job_cancelled` in both `validateAndMergeEntry()` and `validateAndMergeVoiceEntry()`. Any `InvalidatedMediaEntry` carrying `voiceId` with reason `consent_revoked` or `voice_deleted` also auto-promotes into `invalidatedVoices` during ledger/WAL load (`promoteVoiceInvalidationFromMediaEntrySync`).
- **Schema Validation**: `.invalidated_media.json` version `1` validates `entries`, optional `invalidatedVoices`, and optional `mediaCatalog`, while `.wal` validates `{ v: 1, entry }` and `{ v: 1, voiceEntry }` lines. Any malformed record marks `tombstoneLedgerHealthy = false` (`MEDIA_TOMBSTONE_LEDGER_CORRUPTED_OR_UNREADABLE` / `MEDIA_TOMBSTONE_WAL_CORRUPTED`) and never silently overwrites unrecovered state.

---

## 5. Shared-Worker & Hydrated-Catalog Fail-Closed Authorization Model

1. **Shared Storage Catalog Registration Before Byte Materialization (`PrivateStorageService.storeMedia`, lines `1777–1889`)**:
   - Rejects storage requests if `params.voiceId` is already in `invalidatedVoices`.
   - Records `PersistedMediaCatalogEntry` (`{ id, ownerId, voiceId, storageKey, createdAt }`) and flushes `persistTombstonesSync([], [], 'catalog_store')` **before** calling `provider.store(storageKey, buffer)`. If `provider.store()` throws, the catalog entry is rolled back so no phantom entry remains. Zero extra files are created in `VOICEFORGE_STORAGE_DIR` beyond `.invalidated_media.json` and `.invalidated_media.json.wal`.
2. **Effective Media Invalidation Resolution (`resolveEffectiveInvalidationSync`, lines `1514–1546`)**:
   - Every call to `verifySignedUrl()`, `hasValidSignedUrlForInvalidatedMedia()`, `getMedia()`, `isMediaInvalidated()`, and `getInvalidationRecord()` calls `ensureTombstonesLoaded()` (re-checking `.invalidated_media.json` + `.wal` stat signatures) and evaluates `resolveEffectiveInvalidationSync(mediaId)`.
   - If `mediaId` has a direct tombstone OR its known context (`memoryStore.privateMedia` or `persistedMediaCatalog`) links to a `voiceId` in `invalidatedVoices`, access is denied with **`0` WAV bytes**.
   - If `tombstoneLedgerHealthy === false`, `verifySignedUrl()` returns `false`, `isMediaInvalidated()` returns `true`, and `assertInvalidationLedgerHealthy()` throws `StorageUnavailableError` (`503 STORAGE_UNAVAILABLE`).
3. **Route-Level Shared-Worker Synchronization & Check Ordering (`server/routes/api.ts`, lines `99–232`)**:
   - `syncDurableVoiceState(voiceId)` reads `PrivateStorageService.getVoiceInvalidationRecord(voiceId)`, removes revoked/deleted voices from `customVoices`, and synchronizes `ConsentVerificationEngine` + `memoryStore.consentRecords` in-memory on sibling workers without requiring a restart.
   - Custom-voice endpoints check `isPositivelyConsentRevoked(voiceId)` (`403 CONSENT_REVOKED`) **before** `assertNonPremadeVoiceLedgerHealthy(voiceId)` (`503 STORAGE_UNAVAILABLE`), preserving deterministic `403` responses for known-revoked voices under `0o500` storage faults (`S2E-02`) while failing closed (`503`) on unrevoked custom voices when a sibling worker cannot read or validate the shared ledger.

---

## 6. Physical Cleanup & Startup / On-Demand Reconciliation Model

`PrivateStorageService.reconcilePendingDeletions()` (`server/storage/privateStorage.ts:1313–1428`) operates purely from durable disk state without requiring process-local memory or manual `invalidateByVoiceId()` calls:

1. Loads `.invalidated_media.json` + `.invalidated_media.json.wal` via `ensureTombstonesLoaded()` and throws `StorageUnavailableError` if the ledger is unhealthy.
2. Scans `persistedMediaCatalog` and `memoryStore.privateMedia` for any artifact whose `voiceId` appears in `invalidatedVoices` without a corresponding `invalidatedMedia` tombstone (covering a crash between `Step 1A: voice_barrier` and `Step 1B: batch_tombstones`), promotes all such items to `cleanupFailed: true` (`CLEANUP_PENDING`) tombstones, and persists them via `'batch_tombstones'` before unlinking any bytes.
3. For every `InvalidatedMediaEntry` with `cleanupFailed: true`, executes `verifyOrPerformPhysicalCleanup(entry.storageKey)` (confirming `provider.exists(storageKey) === false` on an available provider) and `deleteFromDatabaseIfConnected(entry.id)`.
4. Marks `entry.cleanupFailed = false`, deletes `entry.cleanupFailureCode`, and prunes `persistedMediaCatalog.delete(entry.id)` **only** when both physical absence and DB cleanup succeed, then commits via `persistTombstonesSync([], [], 'reconcile_persist')` (rolling back `cleanupFailed: true` and `persistedMediaCatalog` if persistence fails).

---

## 7. File-by-File Remediation Summary

| File Path | Action | Key Line Ranges | Post-S2I SHA-256 | Summary of Changes |
| :--- | :--- | :--- | :--- | :--- |
| `server/storage/privateStorage.ts` | Modified | `25–50`, `253–449`, `675–1177`, `1313–1586`, `1735–2606` | `5543ed6464c9bb99d1d39ebe9025575f8abb64e1ac33a0d311f2a793093737f2` | Added `InvalidatedVoiceEntry` & `PersistedMediaCatalogEntry` durable schema + WAL `{ v: 1, voiceEntry }` support; added `storeMedia` catalog persistence & revoked-voice rejection; added `resolveEffectiveInvalidationSync` across `verifySignedUrl`/`hasValidSignedUrlForInvalidatedMedia`/`getMedia`/`isMediaInvalidated`/`getInvalidationRecord`; gated `invalidateAndDeleteMedia` physical/DB cleanup on pre-delete persistence in both initial and retry branches; rewrote `invalidateByVoiceId` with full-batch enumeration + `voice_barrier` + `batch_tombstones` pre-delete durability barriers + `post_cleanup` rollback; enhanced `reconcilePendingDeletions` to promote cataloged voice artifacts and prune cleaned entries. |
| `server/routes/api.ts` | Modified | `23–30`, `99–232`, `397–468`, `822–885`, `1105–1128`, `1536–1560`, `1816–1925`, `2200–2295`, `2415–2495`, `2640–2680`, `3365–3428`, `3650–3705` | `7bc1b227d9feb0d4ff986d608a2ab16ca07aba18e98f513ad582314c6e1edfc7` | Passed job-discovered `additionalArtifacts` directly into `PrivateStorageService.invalidateByVoiceId` in `purgeVoiceArtifactsAndJobs`; added `syncDurableVoiceState`, `isPositivelyConsentRevoked`, and `assertNonPremadeVoiceLedgerHealthy`; updated `filterVisibleVoices`, `isVoiceConsentVerifiedActive`, `POST /voices/clone/revoke-consent`, and all custom-voice synthesis/export/upload/dubbing/read routes for shared-worker revocation sync and fail-closed `503 STORAGE_UNAVAILABLE` handling. |
| `test/security/phase3c_s2i_batch_voice_revocation.test.ts` | Created | `1–1955` | `336f7f6d1db4579306947b84ac5319286c163349207911ce5a13ab9c82dedb46` | Added 5-test adversarial regression suite (`S2I-01`..`S2I-05`) using isolated temp storage directories, live Express child worker processes, and real OS `SIGKILL` crash injection. |
| `reports/PHASE-3C-S2I-BATCH-ATOMIC-VOICE-REVOCATION-REMEDIATION.md` | Created | Full report | *(Computed post-write)* | Phase 3C-S2I engineering remediation and verification report. |

---

## 8. Adversarial Crash & Sibling-Worker Test Matrix (`S2I-01`, `S2I-02`, `S2I-04`, `S2I-05`)

All crash tests used real child OS processes terminated via `process.kill(process.pid, 'SIGKILL')` (`signal === 'SIGKILL'`), not mocked exceptions alone:

| Test ID | Scenario & Crash Point | Real OS PIDs | Batch Size & Post-Crash State | Pre-Hydrated / Sibling Worker Result (Before Reconcile) | Fresh-Process `init()` + `reconcilePendingDeletions()` Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `S2I-01` (`revoke_consent`) | `POST /api/voices/clone/revoke-consent` killed via `SIGKILL` inside item 1 `provider.delete()` | Killed: `21558` (`SIGKILL`), Pre-hydrated B: `21550`, Recovery C: `21573` | `3` target WAVs (`2` still on disk post-crash) + `1` active sibling WAV; `3/3` tombstones on disk (`cleanupFailed: true`, `CLEANUP_PENDING`) + durable `voice_barrier` | Signed URL HTTP: `[403, 403, 403]` (`CONSENT_REVOKED`); Bearer HTTP: `[403, 403, 403]`; `verifySignedUrl=false`; `getMedia` threw; `storeMedia` rejected; **`0` WAV bytes**; active sibling `200` WAV | `attempted=3, resolved=3, stillFailing=0`; `0` target WAVs left on disk; all 3 tombstones `cleanupFailed: false`; active sibling WAV preserved |
| `S2I-01` (`delete_voice`) | `DELETE /api/v1/voices/:id` killed via `SIGKILL` inside item 1 `provider.delete()` | Killed: `21588` (`SIGKILL`), Pre-hydrated B: `21580`, Recovery C: `21601` | `3` target WAVs (`2` still on disk post-crash) + `1` active sibling WAV; `3/3` tombstones on disk (`cleanupFailed: true`, `CLEANUP_PENDING`) | Signed URL HTTP: `[403, 403, 403]`; Bearer HTTP: `[403, 403, 403]`; `verifySignedUrl=false`; `getMedia` threw; **`0` WAV bytes**; active sibling `200` WAV | `attempted=3, resolved=3, stillFailing=0`; `0` target WAVs left on disk; all 3 tombstones `cleanupFailed: false` |
| `S2I-02` | Live two-worker shared-storage test (`Worker A` revokes/deletes; `Worker B` **never restarted**) + corrupt shared ledger probe | Worker A: `21608`, Worker B: `21616` (`restarted=false`) | `3` revoked-voice TTS WAVs + `1` dubbing job + `2` deleted-voice WAVs + `1` healthy custom voice + `1` Bob tenant voice | Worker B immediately returned `403` (`0` WAV bytes) across signed URLs, bearer download, `verifySignedUrl`, `getMedia`, `/api/tts/synthesize`, `/api/v1/tts/jobs`, `/api/voices/:id/export`, `/api/voices/cross-lingual-test`, `/api/speech-to-speech`, `/api/media/transcribe-translate`, `/api/v1/voices/:id`, job detail & dubbing detail; omitted from `/api/v1/voices`; Bob media `200` WAV; corrupt ledger returned `503` on all `7/7` custom-voice/media probes | Clean (`cleanupFailed: false` on Worker A; ledger restored cleanly after `503` fault test) |
| `S2I-04` | `4`-artifact `SIGKILL` crash -> Restart 1 partial physical failure on item 3 -> Restart 2 full resolution -> Restart 3 idempotency & multi-tenant check | Crash: `21658` (`SIGKILL`), R1: `21670`, R2: `21677`, R3: `21684` | `4` revoked-voice WAVs + `2` Alice kept-voice WAVs + `2` Bob tenant WAVs | All `4` revoked URLs `403` (`0` WAV bytes); Restart 1 retained `cleanupFailed: true` on item 3 (`never` false cleanup completion) | R1: `attempted=4, resolved=3, stillFailing=1`; R2: `attempted=1, resolved=1, stillFailing=0`, repeat `attempted=0`; R3 HTTP `revoke-consent` retry `200` (`cleanupFailed: false`), Bob `403`, all `4` kept WAVs `200` |
| `S2I-05` | Single-artifact persistence gate, job cancel isolation, cross-tenant auth, S2H non-mutating `503` job polling, HMAC tamper | Worker: `21692` | `2` Alice jobs (`jobKeep`, `jobCancel`) + single-artifact gate fixture | Anonymous `401`, Bob `403`, cancelled job `403 MEDIA_ARTIFACT_INVALIDATED` (`0` WAV bytes), kept job `200` WAV, tampered sig `403`, transient corrupt ledger `503` without mutating `jobKeep` (`status: 'completed'` after restore) | Initial + retry `invalidateAndDeleteMedia` made `0` `provider.delete` calls while unwritable, then cleaned & persisted `cleanupFailed: false` once `0o700` restored |

---

## 9. Persistence-Failure & Partial-Write Test Matrix (`S2I-03`)

| Subcase | Injected Persistence Fault | `provider.delete()` Calls | Returned Outcome State | Authorization & Recovery Verification |
| :--- | :--- | :---: | :--- | :--- |
| **`3A`** | Unwritable ledger + WAL (`0o400` `.invalidated_media.json` & `.wal`, `0o500` storage root) | **`0`** | `3/3` outcomes: `durableInvalidationEstablished: false`, `cleanupFailed: true`, `deletedFromProvider: false` | All 3 physical `.wav` files untouched on disk; `isMediaInvalidated(...) === true` (fail-closed in-process) |
| **`3B`** | Truncated partial `.tmp` write + simulated `EIO` before `fs.renameSync` during `'batch_tombstones'` (+ `0o400` WAL) | **`0`** | `3/3` outcomes: `durableInvalidationEstablished: false`, `cleanupFailed: true` | Main `.invalidated_media.json` snapshot remained valid JSON (`version: 1`, uncorrupted by partial `.tmp`); zero destructive deletes |
| **`3C`** | Corrupted `.invalidated_media.json` (`"{ corrupted_ledger_payload"`) on disk before `invalidateByVoiceId()` | **`0`** | `3/3` outcomes: `durableInvalidationEstablished: false`, `cleanupFailed: true` | `isInvalidationLedgerHealthy() === false`; zero destructive deletes; never overwrote corrupt ledger |
| **`3D`** | Simulated `EIO` failure during `'post_cleanup'` persistence after physical deletion (+ `0o400` WAL) | `3` (after `Step 1A` & `Step 1B` succeeded) | `3/3` outcomes: `durableInvalidationEstablished: false`, `cleanupFailed: true` | Reverted in-memory `cleanupFailed` back to `true` and restored `mediaCatalog`; never falsely reported complete cleanup |
| **`3E`** | **Real OS `SIGKILL` (`PID 21636`) BETWEEN `Step 1A` (`voice_barrier`) and `Step 1B` (`batch_tombstones`)** | **`0`** | Process killed by `SIGKILL` before any per-artifact tombstone write | Fresh unhydrated worker denied all `3/3` signed URLs with `403 CONSENT_REVOKED` (`0` WAV bytes) via `invalidatedVoices` + `mediaCatalog`; fresh recovery process (`PID 21651`) ran `init()` + `reconcilePendingDeletions()` -> promoted & deleted all 3 orphans (`attempted=3, resolved=3, stillFailing=0`) |

---

## 10. Full Regression & Build Gate Results

| Verification Gate | Command / Scope | Result | Details |
| :--- | :--- | :---: | :--- |
| **Non-PG Node/TypeScript Suites (16 suites + new S2I suite)** | `npx --yes tsx --test` across `normalizer`, `phonemizer`, `quality`, `watermark`, `consent`, `routes`, `consent_job_race`, `rate_limit_and_db_fail_closed`, `storage_provider`, `phase3a_security`, `phase3c_s1..s2i` + isolated `durable_revocation` | **PASS (`132 / 132`)** | `125/125` across 16 suites + `7/7` in isolated-`cwd` `durable_revocation.test.ts` (`17/17` suites, `0` failures; baseline `127/127` + `5/5` new `S2I` tests) |
| **Python OmniVoice Unit Tests** | `python3 services/omnivoice/tests/run_tests.py` | **PASS (`15 / 15`)** | `Ran 15 tests in 0.330s — OK` |
| **TypeScript Typecheck** | `npm run lint` (`tsc --noEmit`) | **PASS (`exit 0`)** | Zero TypeScript errors across server, client, and all test suites |
| **Server Production Bundle** | `npm run build:server` (`esbuild server.ts ...`) | **PASS (`exit 0`)** | Built `dist-server/server.js` (`434.0kb`) cleanly in `23ms`; artifact cleaned post-check |
| **PostgreSQL-Dependent Integration Suite** *(Known Environment Blocker)* | `npx --yes tsx --test test/integration/postgres_persistence.test.ts` | **BLOCKED (`1/6` pass, `5/6` `ECONNREFUSED`)** | No local PostgreSQL server running on `127.0.0.1:5433` in sandbox; graceful fallback test (`6/6`) passed |
| **Client Vite Bundle** *(Known Pre-Existing Dependency Blocker)* | `npm run build` | **BLOCKED (`exit 1`)** | Pre-existing `[vite]: Rolldown failed to resolve import "react-is" from ".../node_modules/recharts/es6/util/ReactUtils.js"`; `package.json` and `bun.lock` left untouched per scope rules |

---

## 11. Security Invariant Preservation Review

- **Authentication & Tenant Ownership (`S1` / `Phase 3A`)**: Preserved across all voice, job, media, consent, and audit endpoints (`401 AUTH_REQUIRED` for unauthenticated callers, `403 FORBIDDEN_NOT_OWNER` / `403 FORBIDDEN_MEDIA_ACCESS` for cross-tenant principals, zero body `userId` trust).
- **Biometric Consent Revocation & Precedence (`S2A` / `S2C`)**: `consent_revoked` remains irreversible and strictly dominates `voice_deleted` and `job_cancelled` across both per-artifact and voice-level durable records, returning `403 CONSENT_REVOKED` with zero audio bytes.
- **Restart Durability & Fail-Closed Ledger Handling (`S2D` / `S2E`)**: Missing ledgers in non-empty storage directories, `0o000` unreadable ledgers, `0o500`/`0o400` unwritable roots, corrupt JSON snapshots, corrupt `.wal` lines, and non-regular ledger paths remain permanently fail-closed (`503 STORAGE_UNAVAILABLE`) without silent self-healing.
- **Crash-Safe Orphan Cleanup & Non-Mutating Job Polling (`S2F` / `S2G` / `S2H`)**: `cleanupFailed` separates authorization denial from physical deletion (`verifyOrPerformPhysicalCleanup` confirms post-delete absence), and transient ledger faults on `GET /api/v1/tts/jobs`, `GET /api/v1/tts/jobs/:id`, `GET /api/v1/jobs/:id`, `GET /api/media/jobs`, and `GET /api/media/jobs/:id` return `503 STORAGE_UNAVAILABLE` without mutating active/completed jobs into `cancelled`.
- **Zero-Byte Audio Denial & Secret Hygiene**: Every `401`, `403`, `404`, and `503` response verified to contain `0` RIFF/WAVE bytes, no `audioBase64` / `data:audio/` URIs, no filesystem paths, and no signing secrets.

---

## 12. Residual Risks & Non-Blocking Observations

1. **PostgreSQL Live-Connection Execution Coverage**: `PrivateStorageService.enumerateDatabaseArtifactsForVoiceIfConnected()` and `deleteFromDatabaseIfConnected()` implement fail-closed connected-PostgreSQL batch enumeration and cleanup, but live PostgreSQL execution could not be exercised in this sandbox because `127.0.0.1:5433` is not provisioned.
2. **Ledger Compaction Growth Over Long Lifetimes**: `invalidatedMedia` and `invalidatedVoices` retain compact metadata tombstones indefinitely to guarantee permanent fail-closed denial of historical signed URLs (`persistedMediaCatalog` entries *are* pruned once physical + DB cleanup is confirmed). High-churn production deployments with S3/PostgreSQL should pair tombstone retention with bounded signed-URL TTLs (`DEFAULT_URL_TTL_SECONDS = 900s`) during periodic maintenance windows.
3. **Pre-Existing Client Build Dependency (`react-is`)**: Unchanged per standing constraint prohibiting `package.json` / `bun.lock` edits during Phase 3C-S2I.

---

## 13. Git & Worktree Preservation Verification

- Branch remained `arena/3b3635b6-voice-clone` at `HEAD` `594593a129ee586e29143933e09b4ee634460567` with **zero** commits, pushes, resets, stashes, or branch switches.
- All prior uncommitted worktree modifications, all prior verification/remediation reports (`PHASE-0` through `PHASE-3C-S2H`), `storage/auth/revoked_tokens.json`, `package.json`, `bun.lock`, and `server.ts` were preserved with identical SHA-256 digests.
- Temporary build and test directories (`dist-server/`, `dist/`, `/tmp/s2i-*`, `/tmp/voiceforge-storage`) were completely removed.

---

## 14. Readiness Statement for Independent Phase 3C-S2J Verification

Phase 3C-S2I remediation of finding **`S2H-NEW-01`** is complete, verified against real OS `SIGKILL` multi-artifact crashes, pre-hydrated and live sibling workers without restart, pre-delete persistence faults, multi-restart reconciliation, and all `132/132` non-PostgreSQL Node/TypeScript and `15/15` Python OmniVoice regression tests. The repository worktree on branch `arena/3b3635b6-voice-clone` is ready for an independent **Phase 3C-S2J** adversarial verification pass.
