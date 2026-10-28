# Phase 3C-S2D — Independent Security Verification of Phase 3C-S2C

- **Phase**: `Phase 3C-S2D — Independent Security Verification of S2C (Read-Only)`
- **Date**: `2026-10-28`
- **Repository Root**: `/home/user/Voice-clone` (`ranimony-afk/Voice-clone`)
- **Active Branch**: `arena/3b3635b6-voice-clone` (status: `active`)
- **Baseline `HEAD` Commit**: `594593a129ee586e29143933e09b4ee634460567`
- **Verified Phase 3C-S2C Report**: `reports/PHASE-3C-S2C-RESIDUAL-SECURITY-REMEDIATION.md`
  - **Expected SHA-256**: `9b481d0aa8610f180dc472524007f58dde1a0c9314994af039cff9734887b155`
  - **Actual SHA-256 (Pre & Post Verification)**: `9b481d0aa8610f180dc472524007f58dde1a0c9314994af039cff9734887b155` (**EXACT MATCH**)
- **Security Gate Verdict**: **`FAIL`** *(Five S2C remediations `S2B-NEW-01`, `02`, `03`, `05`, `06` independently **PASS**, and all 115 existing non-PostgreSQL automated tests pass, **however** independent multi-process adversarial probing of `S2B-NEW-04` reproduced **restart-related reauthorization of invalidated private WAV audio** (`HTTP 200 OK`, `95,304`–`124,470` `RIFF...WAVE` bytes) under persistence write failure and missing-ledger recovery — recorded as **`S2D-NEW-01`**; additionally, live PostgreSQL durability on `127.0.0.1:5433` remains **`BLOCKED`**.)*
- **Overall Release Gate Verdict**: **`FAIL / NO-GO`** *(Blocked by Security Gate `FAIL` on `S2D-NEW-01`, unprovisioned PostgreSQL `127.0.0.1:5433` integration environment, and separate unresolved frontend `npm run build:client` `react-is` build failure.)*

---

## 1. Executive Verdict Summary

| Category / Objective | S2C Claimed Status | Independent S2D Verdict | Summary of Direct Evidence |
|---|---|---|---|
| **P0 `S2B-NEW-01`** — Multimodal Audio Privacy (`/api/media/transcribe-translate`, `/api/media/jobs`, `/api/media/jobs/:id`) | `PASS` | **`PASS`** | Verified across all 9 required scenarios: anonymous (`401`) & cross-tenant (`403` / `404`) isolation, server-derived `userId`, owner active access (`200`), pre-retrieval revocation, mid-flight revocation during async ASR/translation (`403 CONSENT_REVOKED`, zero persisted job/audio), out-of-band revocation, voice deletion across both `DELETE /api/voices/:id` & `DELETE /api/v1/voices/:id`, transient delete failure, and idempotent repeat cleanup. |
| **P1 `S2B-NEW-02`** — Watermark Signing-Key Verification (`AudioWatermarker`, `server.ts`) | `PASS` | **`PASS`** | Verified in fresh OS subprocesses across `staging`, `production`, and explicit unknown `NODE_ENV` values (`""`, `"qa"`, `"PRODUCTION"`, `"unknown_env"`): missing, blank, `< 16`-char, and both publicly known fallback keys fail closed on signing and verification; valid current & rotated legacy keys verify cleanly; `development -> staging` transitions reject fallback-signed WAVs; zero secret values logged. |
| **P2 `S2B-NEW-03`** — Duplicate Raw HTTP `Authorization` Headers (`AuthService.parseCredential`) | `PASS` | **`PASS`** | Verified over raw TCP (`node:net`) on `requireAuth` and `optionalAuth` routes: two valid tokens for different users (both orders), valid + forged, forged + valid, duplicate identical tokens, and mixed-case header names (`AuThOrIzAtIoN`) all fail closed with `401 MALFORMED_AUTH_HEADER` before auth; single valid Bearer (`200`) and headerless anonymous contracts preserved. |
| **P2 `S2B-NEW-04` (Sub-Objective 4A)** — Local Shared-Filesystem Restart-Durable Media Invalidation | `PASS` *(local)* | **`FAIL` (`S2D-NEW-01`)** | Scenarios 1–4, 5A, 7, 9, 10 pass when `.invalidated_media.json` is written and preserved. **However, Scenarios 6 & 5B FAIL**: (1) when `.invalidated_media.json` write fails (`0o500` / `EROFS` / `ENOSPC`), `ensureTombstonesLoaded()` re-reads any prior `.invalidated_media.json` and resets `tombstoneLedgerHealthy = true` in Process 1, `invalidateAndDeleteMedia()` returns `invalidated: true` (`HTTP 200 OK` on cancel/revoke), and **after OS process restart Process 2 reauthorizes the invalidated artifact (`HTTP 200 OK`, `95,304`–`124,470` WAV bytes)**; (2) missing `.invalidated_media.json` (`ENOENT`) on a populated storage root after failed `provider.delete()` also reauthorizes (`HTTP 200 OK`, `32,044` WAV bytes). |
| **P2 `S2B-NEW-04` (Sub-Objective 4B)** — Live PostgreSQL Multi-Instance Durability (`127.0.0.1:5433`) | `BLOCKED` | **`BLOCKED`** | PostgreSQL `127.0.0.1:5433` is unavailable (`ECONNREFUSED`; `postgres_persistence.test.ts` `5/6` failed). Local POSIX results are not promoted to live PostgreSQL durability. |
| **P2 `S2B-NEW-05`** — Auth-Secret Strength & Restricted-Env Parity (`auth.ts`, `db/index.ts`, `synthesizer.ts`) | `PASS` | **`PASS`** | Verified in fresh subprocesses across `staging`, `production`, `"qa"`, and `""`: `getAuthSecret()` rejects missing, blank, `15`-char, and `DEV_FALLBACK_AUTH_SECRET` values without leaking secrets; `assertDatabaseConfigured()` and `VoiceForgeSynthesizer` enforce `isRestrictedEnvironment()` and `isConsentActive()`. |
| **P3 `S2B-NEW-06`** — Lazy Invalidation & Metadata Scrubbing on `GET /api/v1/media` | `PASS` | **`PASS`** | Verified out-of-band consent revocation and out-of-band `synthesisJobs` cancellation lazily invalidate & unlink `.wav` bytes before returning; zero `storageKey`, `sig=`, or base64 audio leaked; cross-tenant Bob cannot view or invalidate Alice's media; active control media stays `200 OK`. |
| **Separate Release Blocker A** — Frontend Client Build (`npm run build:client`) | `FAIL / BLOCKED` | **`FAIL / BLOCKED`** | Unchanged non-S2C blocker: Vite/Rolldown fails resolving `"react-is"` imported by `recharts`. |
| **Separate Release Blocker B** — PostgreSQL Integration Suite (`postgres_persistence.test.ts`) | `BLOCKED` | **`BLOCKED`** | Unchanged environment blocker: `ECONNREFUSED` on `127.0.0.1:5433` (`1/6` pass, `5/6` fail). |

---

## 2. Repository Identity, Worktree State & Read-Only Preservation Checksums

### 2.1 Verified Repository & Branch State
- **Root**: `/home/user/Voice-clone`
- **Branch**: `arena/3b3635b6-voice-clone` (`active`)
- **HEAD**: `594593a129ee586e29143933e09b4ee634460567`
- **Origin**: `https://github.com/ranimony-afk/Voice-clone.git`
- **Read-Only Verification Discipline**: Zero application files, test files, manifests, lockfiles, or prior reports were modified. Temporary test side effects (`storage/auth/revoked_tokens.json`, `dist-server/`, `dist/`, `/tmp/voiceforge-storage/.invalidated_media.json`, `/tmp/vf-s2d-*`) were cleaned/restored and verified via SHA-256 checksums below.

### 2.2 Pre-Verification vs. Post-Verification SHA-256 Checksums (All 25 Pre-Existing Workspace Files)
| File Path | Pre-S2D SHA-256 | Post-S2D SHA-256 | Match |
|---|---|---|---|
| `package.json` | `96cb310c3093ccd9cc352f8bbfd007fdb97c33b88bf1ab0c02839cd74470d400` | `96cb310c3093ccd9cc352f8bbfd007fdb97c33b88bf1ab0c02839cd74470d400` | **IDENTICAL** |
| `bun.lock` | `6dbe0469946c602996493bb706e9eff060cf5ed1afd2c71134b23afdcb826e48` | `6dbe0469946c602996493bb706e9eff060cf5ed1afd2c71134b23afdcb826e48` | **IDENTICAL** |
| `storage/auth/revoked_tokens.json` | `6c29f5194bb7fbe434fe464610eb790756191e31ee6a938c12225b61f3a70e2e` | `6c29f5194bb7fbe434fe464610eb790756191e31ee6a938c12225b61f3a70e2e` | **IDENTICAL** |
| `server.ts` | `018ba360e6b26a01681975ebd025e6a0c9c05ff0b33345bbfd149df2b1f3b345` | `018ba360e6b26a01681975ebd025e6a0c9c05ff0b33345bbfd149df2b1f3b345` | **IDENTICAL** |
| `server/auth/auth.ts` | `788b4242ce6f43e2c242816573a0c3080ba782a9c8db89e03cf826f1aac175e3` | `788b4242ce6f43e2c242816573a0c3080ba782a9c8db89e03cf826f1aac175e3` | **IDENTICAL** |
| `server/config/env.ts` | `3bd0bc50c34d2356798fd0ac645cee05625f036abda547d6c1dd122a1a0dcc1a` | `3bd0bc50c34d2356798fd0ac645cee05625f036abda547d6c1dd122a1a0dcc1a` | **IDENTICAL** |
| `server/db/index.ts` | `0d858ac9562833ea1a4c099d1e20562b1d17aec0bab480b11d28d9ee0716f31d` | `0d858ac9562833ea1a4c099d1e20562b1d17aec0bab480b11d28d9ee0716f31d` | **IDENTICAL** |
| `server/engine/audio/consent.ts` | `e7a30d3ffa20f95dde3ff3b253257286b1bd613c3f3a68f3f065ea6dbcebe4e3` | `e7a30d3ffa20f95dde3ff3b253257286b1bd613c3f3a68f3f065ea6dbcebe4e3` | **IDENTICAL** |
| `server/engine/audio/synthesizer.ts` | `acd3bf8fd85cbd2ab1c5ec5758ac780348bad898b2ec56057f89e4bcdc44e862` | `acd3bf8fd85cbd2ab1c5ec5758ac780348bad898b2ec56057f89e4bcdc44e862` | **IDENTICAL** |
| `server/engine/audio/watermark.ts` | `5623bcc5c248f80497f97c283d7cdc763330caca2e7d0f84cc95d5f3c53ecbf5` | `5623bcc5c248f80497f97c283d7cdc763330caca2e7d0f84cc95d5f3c53ecbf5` | **IDENTICAL** |
| `server/routes/api.ts` | `abd5d4b668071d40dddc3e5febfda6eec9db0169a6bc40e50fd4cdc1caf9c887` | `abd5d4b668071d40dddc3e5febfda6eec9db0169a6bc40e50fd4cdc1caf9c887` | **IDENTICAL** |
| `server/storage/privateStorage.ts` | `5eeb48480628ce0dc5f1c620076400758a9f376144f1214a68de73737be3ca44` | `5eeb48480628ce0dc5f1c620076400758a9f376144f1214a68de73737be3ca44` | **IDENTICAL** |
| `src/components/Header.tsx` | `bd9093836238ae5c794a94ea6fbe347154910c3ee31ba62b14fde7ec8bec1f60` | `bd9093836238ae5c794a94ea6fbe347154910c3ee31ba62b14fde7ec8bec1f60` | **IDENTICAL** |
| `src/components/MediaTranscribeTranslateView.tsx` | `72686614fa3f53f75d7ff46d1c3ba35fe6c5ee980d46fb5f12c9bea3d6b3f677` | `72686614fa3f53f75d7ff46d1c3ba35fe6c5ee980d46fb5f12c9bea3d6b3f677` | **IDENTICAL** |
| `src/components/VoiceCloningLabView.tsx` | `c455997a773cb054a1fb977c1b1e1183ae0495958d08a7e37609b1c6b53daa1f` | `c455997a773cb054a1fb977c1b1e1183ae0495958d08a7e37609b1c6b53daa1f` | **IDENTICAL** |
| `test/api/routes.test.ts` | `e2a0dd8759cc4749ccd3480f6760c9cb0a5cbf11b47271ba4cff4f6df7d38963` | `e2a0dd8759cc4749ccd3480f6760c9cb0a5cbf11b47271ba4cff4f6df7d38963` | **IDENTICAL** |
| `test/security/phase3c_s1_auth_remediation.test.ts` | `8c87298910042b94e3e7af98d54d78ee5ff23dca78a13c3f083e8f255592b7f4` | `8c87298910042b94e3e7af98d54d78ee5ff23dca78a13c3f083e8f255592b7f4` | **IDENTICAL** |
| `test/security/phase3c_s2a_remediation.test.ts` | `2d4ad902f733484d2559a3cf5a5bb4542187e424eba75964ba4c48a5caeeff95` | `2d4ad902f733484d2559a3cf5a5bb4542187e424eba75964ba4c48a5caeeff95` | **IDENTICAL** |
| `test/security/phase3c_s2c_residual_remediation.test.ts` | `bed41adb7868fd5a95c4548359c9c2a347037d1c8743f9de85d033b672b90317` | `bed41adb7868fd5a95c4548359c9c2a347037d1c8743f9de85d033b672b90317` | **IDENTICAL** |
| `reports/PHASE-0-NEW-ARENA-BOOTSTRAP-AND-ROADMAP.md` | `2a3672393f93bd4fcb954f024245dec2abec64b789335ece06669f138b5a2772` | `2a3672393f93bd4fcb954f024245dec2abec64b789335ece06669f138b5a2772` | **IDENTICAL** |
| `reports/PHASE-3C-S1-CRITICAL-AUTH-REMEDIATION.md` | `337039b386d156f4e727dd1e8ffadf93bf03e3e1ab86c61d41388f37cae9970e` | `337039b386d156f4e727dd1e8ffadf93bf03e3e1ab86c61d41388f37cae9970e` | **IDENTICAL** |
| `reports/PHASE-3C-V2-INDEPENDENT-VERIFICATION.md` | `d51ebc96781a33a62891610c13a518bfd25d2319dec364f79fca482d046f44ed` | `d51ebc96781a33a62891610c13a518bfd25d2319dec364f79fca482d046f44ed` | **IDENTICAL** |
| `reports/PHASE-3C-S2A-CRITICAL-SECURITY-REMEDIATION.md` | `e984fd03ed34427bd869be765bed8902830d8f9f27157e33b02f7a584703a912` | `e984fd03ed34427bd869be765bed8902830d8f9f27157e33b02f7a584703a912` | **IDENTICAL** |
| `reports/PHASE-3C-S2B-INDEPENDENT-SECURITY-VERIFICATION.md` | `7b07914a5b326283eb185cb76b481ddb70c14afc60bf3d27d09de2ae3eea31f9` | `7b07914a5b326283eb185cb76b481ddb70c14afc60bf3d27d09de2ae3eea31f9` | **IDENTICAL** |
| `reports/PHASE-3C-S2C-RESIDUAL-SECURITY-REMEDIATION.md` | `9b481d0aa8610f180dc472524007f58dde1a0c9314994af039cff9734887b155` | `9b481d0aa8610f180dc472524007f58dde1a0c9314994af039cff9734887b155` | **IDENTICAL** |

---

## 3. Detailed Independent Verification by Objective

### 3.1 Objective 1 (P0 — `S2B-NEW-01`): Multimodal Audio Privacy — **`PASS`**
- **Code Inspection (`server/routes/api.ts:201-269`, `337-370`, `2245-2615`)**:
  - `POST /api/media/transcribe-translate` uses `optionalAuth`, derives `ownerUserId = req.user ? req.user.id : null` (never reading `req.body.userId`), checks `isVoiceConsentVerifiedActive` and `checkVoiceAccess` up front, re-verifies active consent both before and immediately after `synthesizer.synthesize(...)`, stores authenticated dubbing WAVs in `PrivateStorageService`, and marks every authenticated or private-voice job `isPrivate: true`.
  - `isPrivateTranscriptionJob(job)` treats any job with `isPrivate === true`, non-empty `userId`, or non-public `dubbingVoiceId` as private — so even legacy/unattributed records referencing a private voice cannot leak.
  - `GET /api/media/jobs` filters private jobs strictly to `job.userId === caller.id` (or `admin`) and lazily scrubs revoked jobs + invalidates linked `outputMediaId` artifacts.
  - `GET /api/media/jobs/:id` requires auth (`401` anonymous), returns `404 JOB_NOT_FOUND` for cross-tenant probes (byte-for-byte identical body to nonexistent job IDs), and returns `403 CONSENT_REVOKED` after revocation/deletion.
  - Other multimodal/synthesis routes (`/voices/cross-lingual-test`, `/voices/:id/export`, `/speech-to-speech`, `/paper2audio/synthesize`, `/dubbing/create`) were also audited; none bypass private voice ownership or expose `transcriptionJobs`.
- **Independent Synthetic Probe Evidence (`PROBE_A_P0_SUCCESS`)**:
  1. **Legacy unattributed fixture check**: Injected unattributed `trans_legacy_s2b_new_01_fixture` with Alice's `dubbingVoiceId` -> omitted from both anonymous (`false`) and cross-tenant Bob (`false`) `GET /api/media/jobs`.
  2. **Anonymous & cross-tenant synthesis**: Anonymous `POST /api/media/transcribe-translate` with Alice's voice -> `401`; Bob -> `403`.
  3. **Authorized owner with active consent & spoofed `userId`**: Alice `POST` with `userId: "usr_bob_user"` -> stored `userId === "usr_alice_user"`, `outputMediaId` and `outputSignedUrl` stripped from job JSON; Alice `GET /api/media/jobs` (`200`), `GET /api/media/jobs/:id` (`200`), and signed URL (`200`) succeed; Anonymous list (`false`), Bob list (`false`), Anonymous detail (`401`), Bob detail (`404`, matching nonexistent job `404`), and Bob Bearer media download (`403`) leak zero audio or metadata.
  4. **Revocation before retrieval + cleanup failure + repeat cleanup**: With `provider.delete()` throwing `StorageUnavailableError`, `POST /api/voices/clone/revoke-consent` (`200`, `cleanupFailed: true`) scrubbed `GET /api/media/jobs` (`status: "cancelled"`, `dubbedAudioUrl: undefined`) and blocked `GET /api/media/jobs/:id` (`403`), signed URL (`403`), and Bearer download (`403`); repeat revocation (`200`) + `reconcilePendingDeletions()` (`stillFailing: 0`) removed the file cleanly.
  5. **Mid-flight revocation before synthesis completes**: Injecting `POST /api/voices/clone/revoke-consent` during async `transcribeMedia` inside an active `POST /api/media/transcribe-translate` request returned `403 CONSENT_REVOKED`, `hasAudioInResponse: false`, `persistedJobCreated: false`.
  6. **Out-of-band revocation**: Direct `ConsentVerificationEngine.revokeConsent()` caused `GET /api/media/jobs/:id` -> `403` and signed URL -> `403`.
  7. **Voice deletion via all supported routes**: Both `DELETE /api/voices/:id` (`200`) and `DELETE /api/v1/voices/:id` (`200`) scrubbed dubbing jobs (`GET /api/media/jobs/:id` -> `403`) and invalidated dubbing signed URLs (`403`).

---

### 3.2 Objective 2 (P1 — `S2B-NEW-02`): Watermark Signing-Key Verification — **`PASS`**
- **Code Inspection (`server/engine/audio/watermark.ts:16-135`, `server.ts:34-39`)**:
  - Import-time static key caching is eliminated. `AudioWatermarker.getSigningSecret()` and `resolveKeyForVerification()` dynamically evaluate `isRestrictedEnvironment(process.env.NODE_ENV)`, rejecting missing, blank, `< 16`-char, and both publicly known fallback keys (`'vf_watermark_hmac_secret_key_prod_8f1b2c3d4e5a'`, `'vf_watermark_hmac_secret_key_legacy_rotation'`) for both `k_prod_2026_v1` and `k_legacy_2025_v0`, using `crypto.timingSafeEqual` for hex digest verification, and asserting secret validity at server startup (`server.ts:38`).
- **Independent Subprocess Probe Evidence (`PROBE_B_SUCCESS.p1Watermark`)**:
  - Fresh subprocess boot checks with unset `VOICEFORGE_WATERMARK_KEY` in `NODE_ENV=staging`, `NODE_ENV=production`, and `NODE_ENV=unknown_env` all threw `FATAL SECURITY CONFIGURATION` (`threw: true`).
  - Full `5 x 6` matrix (`staging`, `production`, `""`, `"qa"`, `"PRODUCTION"` x missing, `""`, `"    "`, `15`-char, public current fallback, public legacy fallback): `allRejected: true`, `leakedSecret: false`, and WAV containers crafted with embedded `vfpr` RIFF chunks signed under either public fallback key returned `isValid: false`.
  - Valid `>= 16`-char `VOICEFORGE_WATERMARK_KEY` (`prodCurrValid: true`) and valid rotated `>= 16`-char `VOICEFORGE_WATERMARK_LEGACY_KEY` (`prodRotatedLegacyValid: true`) verified cleanly in `production`, while public legacy fallback WAVs remained rejected (`prodPublicLegacyStillRejected: true`).
  - Post-initialization transition (`development` -> `staging`) flipped verification of dev-signed WAVs from `true` to `false`.
- **Non-Blocking Defense-in-Depth Observation (`S2D-OBS-01` — P3 Informational)**:
  - Python sidecar `services/omnivoice/app/safety.py:11` defines `SERVER_PROVENANCE_KEY = b"vf_omnivoice_provenance_signing_secret_prod_2026"` for its internal sidecar JSON field. Node's `OmniVoiceSpeechEngine` (`server/engine/audio/synthesizer.ts:104-108`) discards that field and re-signs audio via `AudioWatermarker`, and `/api/audio/verify-watermark` only trusts `AudioWatermarker`; however, the sidecar should avoid hardcoded constants if ever exposed beyond loopback.

---

### 3.3 Objective 3 (P2 — `S2B-NEW-03`): Duplicate `Authorization` Headers — **`PASS`**
- **Code Inspection (`server/auth/auth.ts:471-540`)**:
  - `AuthService.parseCredential(req)` iterates `req.rawHeaders` in name/value pairs (`i += 2`) prior to consulting `req.headers.authorization`, counting case-insensitive `'authorization'` headers and rejecting `rawAuthHeaderCount > 1 || Array.isArray(req.headers?.authorization)` with `{ status: 'invalid', code: 'MALFORMED_AUTH_HEADER' }`, which both `requireAuth` and `optionalAuth` turn into HTTP `401`.
- **Independent Raw TCP Probe Evidence (`PROBE_B_SUCCESS.p2DuplicateAuthHeaders`)**:
  - Raw `node:net` HTTP/1.1 requests tested against `GET /api/v1/auth/me` (`requireAuth`), `GET /api/v1/voices` (`optionalAuth`), and `GET /api/media/jobs` (`optionalAuth`):
    - `Bearer <alice>` + `Bearer <bob>` -> `401 MALFORMED_AUTH_HEADER` across all three routes.
    - `Bearer <bob>` + `Bearer <alice>` -> `401 MALFORMED_AUTH_HEADER` across all three routes.
    - `Bearer <alice>` + `Bearer forged.invalid.sig` -> `401 MALFORMED_AUTH_HEADER` across all three routes.
    - `Bearer forged.invalid.sig` + `Bearer <alice>` -> `401 MALFORMED_AUTH_HEADER` across all three routes.
    - Duplicate identical `Bearer <alice>` + `Bearer <alice>` -> `401 MALFORMED_AUTH_HEADER` across all three routes.
    - Case-variant `Authorization: Bearer <alice>` + `AuThOrIzAtIoN: Bearer <bob>` -> `401 MALFORMED_AUTH_HEADER` across all three routes.
    - Single valid `Authorization: Bearer <alice>` -> `200 OK` (includes `Alice_Private_Header_Canary` on `/api/v1/voices`).
    - Headerless anonymous request -> `200 OK` public-only on `/api/v1/voices` (`Alice_Private_Header_Canary` hidden) and `401` on `/api/v1/auth/me`.

---

### 3.4 Objective 4 (P2 — `S2B-NEW-04`): Restart-Durable Private-Media Invalidation — **`FAIL` (Local Sub-Objective) & `BLOCKED` (Live PostgreSQL Sub-Objective)**

#### 3.4.1 Ten-Scenario Multi-Process Local Durability Matrix (`PROBE_C_MATRIX` & Real-POSIX HTTP Probe)
| # | Required Test Scenario | Separate-OS-Process Result | Verdict |
|---|---|---|---|
| **1** | Successful deletion followed by restart | `.wav` absent on disk (`diskBefore: false`); post-restart `GET ${signedUrl}` -> `403` (`0` audio bytes). | `PASS` |
| **2** | `provider.delete()` returning `false` followed by restart *(writable ledger)* | `.wav` still on disk (`diskBefore: true`); tombstone recovered from `.invalidated_media.json`; post-restart `GET ${signedUrl}` (with metadata rehydrated) -> `403`. | `PASS` |
| **3** | `provider.delete()` throwing followed by restart *(writable ledger)* | `.wav` still on disk (`diskBefore: true`); tombstone recovered; post-restart `GET ${signedUrl}` -> `403`. | `PASS` |
| **4** | Corrupt invalidation ledger across restart | Malformed `.invalidated_media.json` -> `isInvalidationLedgerHealthy() === false`, `GET ${signedUrl}` -> `503 STORAGE_UNAVAILABLE`, `GET /api/v1/media` -> `503`. | `PASS` |
| **5A** | Unavailable invalidation ledger (`EISDIR` / `EACCES`) across restart | Unreadable `.invalidated_media.json` -> `healthy: false`, `GET ${signedUrl}` -> `503 STORAGE_UNAVAILABLE`. | `PASS` |
| **5B** | Missing invalidation ledger (`ENOENT`) on populated storage root after failed `provider.delete()` | `.invalidated_media.json` missing while `dirB/usr_alice_user/*.wav` exists -> `ensureTombstonesLoaded()` treats `ENOENT` as healthy (`healthy: true`), `isInvalidatedAfterRestart: false`, **`GET ${signedUrl}` -> `200 OK` (`32,044` `RIFF` WAV bytes leaked)**. | **`FAIL` (`S2D-NEW-01`)** |
| **6** | **Persistence write failure (`chmod 0o500` on storage/tombstone dir — zero mocks) + OS process restart** | **Process 1**: `POST /api/v1/jobs/:id/cancel` returns **`200 OK { success: true, cleanupFailed: true }`** (and `POST /api/voices/clone/revoke-consent` returns `200 OK`); `ensureTombstonesLoaded()` re-reads stale `.invalidated_media.json` and resets `healthyInP1AfterWriteFailure: true`! **Process 2 (after restart)**: `healthyInP2: true`, `isInvalidatedInP2: false`, **`GET ${signedUrl}` -> `200 OK` (`95,304`–`124,470` `RIFF` WAV bytes leaked)** and **owner Bearer `GET /api/v1/media/download/:id` -> `200 OK` (`95,304`–`124,470` WAV bytes leaked)**. | **`FAIL` (`S2D-NEW-01`)** |
| **7** | Interrupted cleanup / `reconcilePendingDeletions()` across restart | Post-restart `reconcilePendingDeletions()` retried pending tombstone (`attempted: 1, resolved: 1, stillFailing: 0`), unlinking remaining `.wav` (`diskAfterReconcile: false`). | `PASS` |
| **8** | Previously issued signed URL after restart | Blocked (`403`) in Scenarios 1–3; blocked (`503`) in Scenarios 4 & 5A; **reauthorized (`200 OK` WAV bytes) in Scenarios 5B & 6**. | **`FAIL` (`S2D-NEW-01`)** |
| **9** | Repeated invalidation and cleanup across restart | Repeat `invalidateAndDeleteMedia()` across restart upgraded reason (`job_cancelled -> consent_revoked`), unlinked `.wav` (`diskAfterRepeat: false`), and behaved idempotently. | `PASS` |
| **10** | Active, non-revoked media artifact compatibility control across restart | Active `rCtrl` remained on disk (`true`) and served `200 OK` (`32,044` WAV bytes) over both signed URL and Bearer after restart alongside invalidated tombstones. | `PASS` |

#### 3.4.2 Root-Cause Analysis of Security-Gate Blocker `S2D-NEW-01` (Severity: P1/P2)
1. **Stale-Read Health Reset in `ensureTombstonesLoaded()` (`server/storage/privateStorage.ts:269-326`)**:
   - When `persistTombstonesSync()` fails (`EACCES`, `EROFS`, `ENOSPC`), lines 372–373 set `this.tombstoneLedgerHealthy = false`. However, if `.invalidated_media.json` already exists on disk from any prior invalidation, the very next call to `ensureTombstonesLoaded()` bypasses the `mtimeMs` cache guard (because `this.tombstoneLedgerHealthy` is `false`), reads and parses the **stale** pre-failure `.invalidated_media.json`, and **unconditionally sets `this.tombstoneLedgerHealthy = true` at line 325**, erasing the persistence-failure lockout even within Process 1.
2. **Co-Located Default Ledger + Silent `invalidated: true` / `200 OK` on Failed Durable Write (`server/storage/privateStorage.ts:232`, `814-868`; `server/routes/api.ts:1106`, `1185`, `1322`, `3637`)**:
   - By default, `.invalidated_media.json` resides inside `LocalStorageProvider`'s `storageRoot`. Consequently, any real POSIX read-only remount, directory permission fault (`0o500`), or full-disk condition causes **both** `persistTombstonesSync()` and `provider.delete()` (`fs.unlinkSync`) to fail together.
   - Instead of failing closed when `initialPersistOk === false` (before claiming invalidation succeeded), `invalidateAndDeleteMedia()` returns `{ invalidated: true, cleanupFailed: true }` (even overwriting `TOMBSTONE_PERSISTENCE_UNAVAILABLE` with `PROVIDER_DELETE_RETURNED_FALSE` at line 832), and lifecycle HTTP endpoints return `200 OK { success: true }`. Once the process restarts, the unpersisted tombstone vanishes while the `.wav` file remains on disk; whenever metadata survives/rehydrates (e.g., from PostgreSQL if DB delete also failed/lagged, or for cancelled premade/active-voice jobs and general uploads), `GET /api/v1/media/download/:id` reauthorizes and streams the invalidated private WAV bytes (`200 OK`).
3. **Uninitialised Ledger `ENOENT` Ambiguity on Populated Storage Roots (`server/storage/privateStorage.ts:260-264`, `501-510`)**:
   - `PrivateStorageService.init()` / `storeMedia()` never creates an initialized `.invalidated_media.json` (`{ version: 1, entries: [] }`) when populating a storage directory, so `ensureTombstonesLoaded()` cannot distinguish a fresh empty install from a populated storage directory whose `.invalidated_media.json` went missing (`ENOENT`), allowing un-deleted artifacts to reauthorize on restart.
4. **Parent Directory Synchronization (`S2D-OBS-03` — P3 Durability Note)**:
   - `persistTombstonesSync()` (`privateStorage.ts:356-360`) calls `fs.fsyncSync(fd)` on the temporary file before `fs.renameSync(tmpPath, targetPath)`, but does not `fsync` the parent directory descriptor after `renameSync` for bare-metal power-loss durability.

#### 3.4.3 Live PostgreSQL Sub-Objective (`127.0.0.1:5433`) — **`BLOCKED`**
- Per Section 5 rules, PostgreSQL was not provisioned. `npx tsx --test test/integration/postgres_persistence.test.ts` fails (`1/6` pass, `5/6` fail with `ECONNREFUSED` on `127.0.0.1:5433`), so live multi-instance PostgreSQL invalidation durability remains **`BLOCKED`**.

---

### 3.5 Objective 5 (P2 — `S2B-NEW-05`): Auth-Secret Strength Parity — **`PASS`**
- **Code Inspection (`server/config/env.ts`, `server/auth/auth.ts:39-60`, `server/db/index.ts:44-59`, `server/engine/audio/synthesizer.ts:299-355`)**:
  - `getAuthSecret()`, `PrivateStorageService.getSigningSecret()`, `ConsentVerificationEngine.getConsentSecret()`, and `AudioWatermarker.getSigningSecret()` all enforce identical restricted-environment rules (`isRestrictedEnvironment(process.env.NODE_ENV)` -> `>= 16` trimmed chars, non-fallback, zero secret interpolation in errors).
  - Note (documented policy): completely unset `NODE_ENV` (`undefined`) resolves to `'development'` in `resolveRuntimeEnvironment()`, whereas `'staging'`, `'production'`, and any explicit unrecognized string (`""`, `'qa'`, `'PRODUCTION'`) resolve as restricted environments.
- **Independent Fresh-Subprocess Evidence (`PROBE_B_SUCCESS.p2AuthSecretParity`)**:
  - Across `staging`, `production`, `"qa"`, and `""`, fresh subprocesses rejected `undefined`, `""`, `"   "`, `"15_chars_secret"`, and `DEV_FALLBACK_AUTH_SECRET` (`allAuthRejected: true`, `leaked: false`), rejected missing `DATABASE_URL` (`dbRejected: true`), and accepted valid `>= 16`-char secrets (`validAccepted: true`).

---

### 3.6 Objective 6 (P3 — `S2B-NEW-06`): Lazy Invalidation on `GET /api/v1/media` — **`PASS`**
- **Independent Synthetic HTTP Evidence (`PROBE_B_SUCCESS.p3LazyMediaListInvalidation`)**:
  - Out-of-band `ConsentVerificationEngine.revokeConsent(p3VoiceId)` and out-of-band `memoryStore.synthesisJobs` `status = 'cancelled'` mutation were both detected during Alice's `GET /api/v1/media`:
    - `revokedOmitted: true`, `cancelledOmitted: true`, `activeControlRetained: true`.
    - `revokedDiskDeleted: true`, `cancelledDiskDeleted: true`, `controlDiskRetained: true`.
    - `leaksStorageKey: false`, `leaksSignedUrl: false`, `leaksAudioBase64: false`.
    - Subsequent signed-URL probes returned `403` (`revokedSignedStatus: 403`, `cancelledSignedStatus: 403`) while the active control artifact returned `200` (`controlSignedStatus: 200`).
    - Cross-tenant Bob `GET /api/v1/media` returned `[]` and could not view or invalidate Alice's media.
- **Minor Defense-in-Depth Observation (`S2D-OBS-02` — P3 Informational)**:
  - `GET /api/v1/media` (`server/routes/api.ts:1593`) and `GET /api/v1/media/download/:id` (`api.ts:1518`) check `memoryStore.synthesisJobs` for out-of-band `status === 'cancelled'` records, but do not also scan `memoryStore.transcriptionJobs` or distinct `asyncJobsLedger` entries if a premade-voice dubbing job were ever marked `'cancelled'` out-of-band without calling `PrivateStorageService.invalidateAndDeleteMedia()`.

---

## 4. Validation Suite Execution Matrix

| Suite / Command | Exit Code | Counts / Result |
|---|---|---|
| `npx tsx --test test/security/phase3c_s1_auth_remediation.test.ts` | `0` | **`12 / 12` passed** (`0` failed) |
| `npx tsx --test test/security/phase3c_s2a_remediation.test.ts` | `0` | **`12 / 12` passed** (`0` failed) |
| `npx tsx --test test/security/phase3c_s2c_residual_remediation.test.ts` | `0` | **`8 / 8` passed** (`0` failed) |
| `npx tsx --test test/security/*.test.ts` (all 6 security suites) | `0` | **`57 / 57` passed** (`0` failed) |
| `npx tsx --test <all 14 non-PostgreSQL unit + API + security + integration suites>` | `0` | **`115 / 115` passed** (`0` failed across 14 suites) |
| `npm run lint` (`tsc --noEmit`) | `0` | **`0` TypeScript errors** |
| `npm run build:server` (`esbuild server.ts ...`) | `0` | Built `dist-server/server.js` (`375.5 KB`, cleaned up) |
| `python3 services/omnivoice/tests/run_tests.py` | `0` | **`15 / 15` passed** (`0.319s`) |
| `npm run build:client` *(separate non-security blocker)* | `1` | `FAIL`: Rolldown cannot resolve `"react-is"` from `recharts` (`dist/` cleaned up) |
| `npx tsx --test test/integration/postgres_persistence.test.ts` *(separate DB blocker)* | `1` | `BLOCKED`: `1 / 6` passed, `5 / 6` failed (`ECONNREFUSED` on `127.0.0.1:5433`) |

---

## 5. Required Remediation Scope Before Re-Verification (Do Not Implement Without Authorization)

1. **`S2D-NEW-01` (Security-Gate Blocker — P1/P2)**:
   - Make `tombstoneLedgerHealthy = false` sticky on persistence write failures in `PrivateStorageService` (never let `ensureTombstonesLoaded()` reset `tombstoneLedgerHealthy = true` by re-reading a stale `.invalidated_media.json` until a fresh full write of the in-memory `invalidatedMedia` map succeeds).
   - Fail closed (throw `StorageUnavailableError` / return HTTP `503` rather than returning `{ invalidated: true }` / HTTP `200 OK { success: true }`) whenever `persistTombstonesSync()` fails AND physical byte + metadata deletion cannot both be verified complete, so callers are never told cancellation/revocation durably succeeded when an artifact can resurrect after restart.
   - Initialize `.invalidated_media.json` (`{ version: 1, entries: [] }`, plus parent-directory `fsync` where supported) when `PrivateStorageService` initializes/stores media in a directory, and fail closed (`503`) if tenant media files exist on disk while `.invalidated_media.json` is unexpectedly missing (`ENOENT`).
2. **Separate Non-S2D Release Blockers (Unchanged)**:
   - Provision PostgreSQL (`127.0.0.1:5433`) to unblock `test/integration/postgres_persistence.test.ts` and Sub-Objective 4B.
   - Authorize dependency/manifest repair for missing `react-is` to unblock `npm run build:client`.
