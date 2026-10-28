# Phase 3C-S2B — Independent Security Verification Report

- **Phase**: `Phase 3C-S2B — Independent Security Verification` (Strictly Read-Only / Verification-Only)
- **Date**: `2026-10-28`
- **Repository**: `ranimony-afk/Voice-clone` (`/home/user/Voice-clone`)
- **Active Branch**: `arena/3b3635b6-voice-clone` (status: `active`)
- **HEAD Commit**: `594593a129ee586e29143933e09b4ee634460567`
- **Prior S2A Report Verified**: `reports/PHASE-3C-S2A-CRITICAL-SECURITY-REMEDIATION.md` (`e984fd03ed34427bd869be765bed8902830d8f9f27157e33b02f7a584703a912` — **MATCH**)
- **Phase 3C-S2 Security Gate Verdict**: **`FAIL`** *(All three exact V2-reported code paths in `PrivateStorageService`, `ConsentVerificationEngine`, `AuthService.parseCredential()`, and TTS job/media routes are verified fixed in-process; however, independent S2B adversarial probing uncovered confirmed residual vulnerabilities outside S2A's test surface, led by **`S2B-NEW-01`** [P0/P1 post-revocation & anonymous cross-tenant private cloned-voice dubbing audio leak via `POST /api/media/transcribe-translate` -> `GET /api/media/jobs`] and **`S2B-NEW-02`** [P1 `AudioWatermarker` hardcoded fallback HMAC key in `staging`/`production`], plus **`S2B-NEW-03`** through **`S2B-NEW-06`].)*
- **Overall Release Gate Verdict**: **`FAIL` / `BLOCKED`** *(Blocked both by the Security Gate `FAIL` findings above and independently by pre-existing non-S2A release blockers: `npm run build:client` failing on missing `react-is` [exit `1`] and `test/integration/postgres_persistence.test.ts` blocked on unprovisioned PostgreSQL `127.0.0.1:5433` [exit `1`, `5/6` failing with `ECONNREFUSED`].)*

---

## 1. Repository Identity, Baseline Checksums & Worktree Status

### 1.1 Repository & Branch Identity
| Property | Verified Value |
|---|---|
| Working Directory | `/home/user/Voice-clone` |
| Remote `origin` | `https://github.com/ranimony-afk/Voice-clone.git` |
| Current Branch | `arena/3b3635b6-voice-clone` (`active`) |
| `HEAD` Commit | `594593a129ee586e29143933e09b4ee634460567` |
| `node_modules/` Present | `true` (`242` packages from Phase 3C-S2A Option 1A; `react-is` absent; zero `npm install` executed in S2B) |
| Extra Lockfiles | None (`package-lock.json` absent; `npm-shrinkwrap.json` absent) |
| Commits / Pushes / PRs | None created or modified |

### 1.2 Verification of Prior Phase Reports & Protected Files (Pre-S2B == Post-S2B)
`reports/PHASE-3C-S2A-CRITICAL-SECURITY-REMEDIATION.md` was verified against expected SHA-256 `e984fd03ed34427bd869be765bed8902830d8f9f27157e33b02f7a584703a912` (**exact match**). All 18 pre-existing tracked/untracked workspace files were hashed before and after S2B verification:

| Path | git Status | Verified SHA-256 (Pre-S2B & Post-S2B Identical) |
|---|---|---|
| `package.json` | clean | `96cb310c3093ccd9cc352f8bbfd007fdb97c33b88bf1ab0c02839cd74470d400` |
| `bun.lock` | clean | `6dbe0469946c602996493bb706e9eff060cf5ed1afd2c71134b23afdcb826e48` |
| `storage/auth/revoked_tokens.json` | clean | `6c29f5194bb7fbe434fe464610eb790756191e31ee6a938c12225b61f3a70e2e` |
| `server.ts` | `M` (S1+S2A) | `6f68dc32962bb1f56f72c058d135ecdbcf65e47b7a090e6abe91642bb41f7a60` |
| `server/auth/auth.ts` | `M` (S1+S2A) | `2216fccb448443fd3e060bb35c78c6f7917909ca9eef0be78744690079c580c7` |
| `server/config/env.ts` | `M` (S1) | `3bd0bc50c34d2356798fd0ac645cee05625f036abda547d6c1dd122a1a0dcc1a` |
| `server/engine/audio/consent.ts` | `M` (S2A) | `e7a30d3ffa20f95dde3ff3b253257286b1bd613c3f3a68f3f065ea6dbcebe4e3` |
| `server/routes/api.ts` | `M` (S1+S2A) | `237af338fe963c85ea5fa30200c79cfae2908a69f9012a30705cf827379271e4` |
| `server/storage/privateStorage.ts` | `M` (S2A) | `436cba44da66d0eb0a1ff37f7fd93b8d7fc182649b4ef96886018acb1e207e16` |
| `src/components/Header.tsx` | `M` (S1) | `bd9093836238ae5c794a94ea6fbe347154910c3ee31ba62b14fde7ec8bec1f60` |
| `src/components/VoiceCloningLabView.tsx` | `M` (S1) | `c455997a773cb054a1fb977c1b1e1183ae0495958d08a7e37609b1c6b53daa1f` |
| `test/api/routes.test.ts` | `M` (S1) | `e2a0dd8759cc4749ccd3480f6760c9cb0a5cbf11b47271ba4cff4f6df7d38963` |
| `test/security/phase3c_s1_auth_remediation.test.ts` | `??` (S1) | `8c87298910042b94e3e7af98d54d78ee5ff23dca78a13c3f083e8f255592b7f4` |
| `test/security/phase3c_s2a_remediation.test.ts` | `??` (S2A) | `2d4ad902f733484d2559a3cf5a5bb4542187e424eba75964ba4c48a5caeeff95` |
| `reports/PHASE-0-NEW-ARENA-BOOTSTRAP-AND-ROADMAP.md` | `??` (P0) | `2a3672393f93bd4fcb954f024245dec2abec64b789335ece06669f138b5a2772` |
| `reports/PHASE-3C-S1-CRITICAL-AUTH-REMEDIATION.md` | `??` (S1) | `337039b386d156f4e727dd1e8ffadf93bf03e3e1ab86c61d41388f37cae9970e` |
| `reports/PHASE-3C-V2-INDEPENDENT-VERIFICATION.md` | `??` (V2) | `d51ebc96781a33a62891610c13a518bfd25d2319dec364f79fca482d046f44ed` |
| `reports/PHASE-3C-S2A-CRITICAL-SECURITY-REMEDIATION.md` | `??` (S2A) | `e984fd03ed34427bd869be765bed8902830d8f9f27157e33b02f7a584703a912` |

*(Operational note: Running `test/security/phase3a_security.test.ts` or `test/integration/durable_revocation.test.ts` without `VOICEFORGE_REVOCATION_FILE` unlinks/mutates `storage/auth/revoked_tokens.json` via `DurableRevocationStore.resetForTesting()`; after running those legacy suites, `storage/auth/revoked_tokens.json` was restored to its exact `HEAD` state `6c29f5194bb7fbe434fe464610eb790756191e31ee6a938c12225b61f3a70e2e`.)*

---

## 2. Independent Source-Audit Findings Across Server Modules

Rather than trusting Phase 3C-S2A's claims or stopping at S2A's modified lines, every route, storage/consent/auth service, background worker, synthesizer, watermarker, multimodal dubbing pipeline, and database adapter across `server/` and `server.ts` was audited directly:

1. **`server/storage/privateStorage.ts` (lines 1–756)**:
   - `getSigningSecret()` (lines 215–234) dynamically reads `process.env.VOICEFORGE_STORAGE_SECRET` and `isRestrictedEnvironment(process.env.NODE_ENV)` on every call, rejecting missing, whitespace, `< 16`-char, and `DEV_FALLBACK_STORAGE_SECRET` values in restricted environments without logging secret values.
   - `invalidateAndDeleteMedia()` (lines 539–689) enforces tenant ownership (`authoritativeOwnerId !== requestingUserId` unless `isAdmin` or verified `allowVoiceOwnerCleanup`), synchronously inserts an `InvalidatedMediaEntry` into `this.invalidatedMedia` and splices `memoryStore.privateMedia` **before** calling `this.provider.delete()`, and records `cleanupFailed: true` + sanitized codes (`PROVIDER_DELETE_RETURNED_FALSE`, `STORAGE_UNAVAILABLE_ON_DELETE`, `PROVIDER_DELETE_EXCEPTION`) if deletion fails or throws.
   - **Durability limitation identified (`S2B-NEW-04`)**: `invalidatedMedia` (`line 198`) is an **in-memory** `Map<string, InvalidatedMediaEntry>` (not persisted to disk or PostgreSQL), and `db.delete(schema.privateMedia)` (`lines 669–678`) is dispatched fire-and-forget via `.then(...)` without `await`.
2. **`server/engine/audio/consent.ts` (lines 1–384)**:
   - Static `SERVER_SECRET` was removed; `getConsentSecret()` (lines 75–98) dynamically reads `process.env.VOICEFORGE_CONSENT_SECRET` on every call and rejects missing, blank, `< 16`-char, `DEV_FALLBACK_CONSENT_SECRET`, and legacy `'vf_consent_sec_prod_99f2a87b1c4e6'` values in restricted environments.
   - `isConsentActive()` (lines 345–360) recomputes the HMAC over the stored `ImmutableConsentAuditRecord` using `getConsentSecret()` via `crypto.timingSafeEqual`, failing closed (`false`) if revoked, tampered, or signed with a development/test fallback secret when later checked in `staging`/`production`.
3. **`server/auth/auth.ts` (lines 1–608)**:
   - `AuthService.parseCredential(req)` (lines 505–547) explicitly rejects `?token=` (any value, including empty, whitespace, array, object, or valid JWT) and `x-session-token` with `401 UNSUPPORTED_AUTH_TRANSPORT`, requires exact `Authorization: Bearer <single-non-empty-token>`, and causes both `requireAuth` and `optionalAuth` (lines 562–607) to fail closed with `401` on any malformed, forged, expired, missing-`exp`, `alg:none`, or revoked token.
   - **Wire-level header ambiguity identified (`S2B-NEW-03`)**: `parseCredential(req)` inspects `req.headers.authorization` without checking `req.rawHeaders` for multiple `Authorization` header lines; Node's HTTP parser silently drops duplicate `Authorization` headers after the first.
   - **Restricted-secret strength gap identified (`S2B-NEW-05`)**: `getAuthSecret()` (lines 38–49) checks only `!secret || secret.trim().length === 0`, accepting `< 16`-char secrets and its own hardcoded dev-fallback literal `'vf_auth_secret_phase3a_secure_token_sig_k92m'` in `staging`/`production`.
4. **`server/routes/api.ts` (lines 1–3361)**:
   - TTS and private-media endpoints (`/voices/clone/revoke-consent`, `DELETE /voices/:id`, `DELETE /v1/voices/:id`, `GET /v1/tts/jobs`, `GET /v1/tts/jobs/:id`, `GET /v1/jobs/:id`, `POST /v1/jobs/:id/cancel`, `POST /v1/media/upload`, `GET /v1/media/download/:id`) properly enforce ownership, active consent, eager scrubbing (`scrubJobOutputArtifacts()`), and fail-closed media invalidation.
   - **Critical unscrubbed secondary audio ledger identified (`S2B-NEW-01`, lines 2076–2249)**: `POST /api/media/transcribe-translate` (`optionalAuth`) synthesizes WAV audio using an authenticated caller's private cloned `dubbingVoiceId` and stores inline `dubbedAudioUrl: "data:audio/wav;base64,..."` + `dubbingVoiceId` (with no `userId` field) in `memoryStore.transcriptionJobs` (and PostgreSQL `transcriptionTranslationJobs`). `GET /api/media/jobs` (`line 2230`) has **no authentication**, **no tenant filtering**, and **no `isVoiceConsentVerifiedActive(dubbingVoiceId)` check**, and `purgeVoiceArtifactsAndJobs()` (`lines 220–277`) never scrubs `memoryStore.transcriptionJobs`.
   - **Lazy metadata observation (`S2B-NEW-06`, lines 1454–1458)**: `GET /api/v1/media` returns `PrivateMediaRecord` metadata (no audio bytes, includes internal relative `storageKey`) without proactively checking `isVoiceConsentVerifiedActive(m.voiceId)` when consent is revoked out-of-band in memory prior to a download/job access.
5. **`server/engine/audio/watermark.ts` (lines 38–42)**:
   - **Restricted-environment secret bypass identified (`S2B-NEW-02`)**: `AudioWatermarker.SIGNING_KEYS` initializes `'k_prod_2026_v1'` at module load to `process.env.VOICEFORGE_WATERMARK_KEY || 'vf_watermark_hmac_secret_key_prod_8f1b2c3d4e5a'` (and `'k_legacy_2025_v0'` to `'vf_watermark_hmac_secret_key_legacy_rotation'`) with no `isRestrictedEnvironment(process.env.NODE_ENV)` check.
6. **`server/config/env.ts` (lines 17–58), `server.ts` (lines 48–62), `server/db/index.ts` (lines 43, 105), and `server/engine/audio/synthesizer.ts` (lines 300, 342, 350)**:
   - `server.ts` calls `getAuthSecret()`, `PrivateStorageService.getSigningSecret()`, and `ConsentVerificationEngine.getConsentSecret()` at startup when `isRestrictedEnvironment(process.env.NODE_ENV)` is true.
   - `resolveRuntimeEnvironment(undefined)` returns `'development'` when `NODE_ENV` is completely unset (`undefined`), while any explicit unrecognized `NODE_ENV` (`""`, `"qa"`, `"PRODUCTION"`) fails closed to `'production'`.
   - `server/db/index.ts:43,105` and `server/engine/audio/synthesizer.ts:342,350` check literal `NODE_ENV === 'production'` (or `'staging'`) instead of `isRestrictedEnvironment()`, and `synthesizer.ts:300` checks `consentRecord.status === 'revoked'` rather than `!ConsentVerificationEngine.isConsentActive(voice.id)` (mitigated on HTTP TTS routes by `api.ts:648,1472`).
7. **Frontend Callers (`src/`)**:
   - Audited all `Authorization`, `token=`, `x-session-token`, `/jobs/`, and `media/download` references in `src/`. Only `src/components/Header.tsx` and `src/components/VoiceCloningLabView.tsx` send auth credentials, and both exclusively send `Authorization: Bearer ${token}`. Rejecting `?token=` and `x-session-token` breaks zero legitimate client callers.

---

## 3. Reproduction & Before/After Verification of Previously Reported V2 Defects

All live HTTP reproductions ran on isolated loopback (`127.0.0.1:0`) with temporary `/tmp/vf-s2b-*` storage and outbound non-loopback `fetch` blocked in-process:

| Defect ID | Pre-S2A (V2 Confirmed Behavior) | Post-S2A (S2B Live HTTP Verification) | Narrow V2 Path Status |
|---|---|---|---|
| **`V2-NEW-01a`** Completed TTS job + consent revocation (`POST /api/voices/clone/revoke-consent`) | `GET /api/v1/tts/jobs` returned `status: "completed"` + live `outputSignedUrl`; `GET ${outputSignedUrl}` & Bearer `GET /api/v1/media/download/:id` returned `200 audio/wav` bytes. | Pre-revoke: `GET ${signedUrl}` -> `200` (`117,190` bytes), Bearer download -> `200`, disk `.wav` exists (`true`). Post-revoke (`200`): `GET /api/v1/tts/jobs` scrubs `result`/`outputSignedUrl`/`outputMediaId` (`status: "cancelled"`); `GET /api/v1/tts/jobs/:id` -> `403 CONSENT_REVOKED`; `GET /api/v1/jobs/:id` -> `403 CONSENT_REVOKED`; `GET ${ttsSignedUrl}`, `GET ${refSignedUrl}`, and Bearer download all -> `403 CONSENT_REVOKED`; disk `.wav` files unlinked (`false`). | **FIXED** *(TTS & `PrivateStorageService` paths; see `S2B-NEW-01` for `/api/media/jobs`)* |
| **`V2-NEW-01b`** Out-of-band consent revocation before `GET /api/v1/tts/jobs` | `GET /api/v1/tts/jobs` omitted `ConsentVerificationEngine.isConsentActive(j.voiceId)` and serialized `outputSignedUrl`. | `GET /api/v1/tts/jobs` checks `!isVoiceConsentVerifiedActive(j.voiceId)` before serialization, transitions job to `cancelled`, scrubs `result`/`outputSignedUrl`/`outputMediaId`, unlinks disk `.wav`, and `GET ${priorSignedUrl}` -> `403 CONSENT_REVOKED`. | **FIXED** |
| **`V2-NEW-01c`** Completed job cancellation (`POST /api/v1/jobs/:id/cancel`) & voice deletion (`DELETE /api/voices/:id`, `DELETE /api/v1/voices/:id`) | `cancel` returned `400 Cannot cancel a job in terminal state: completed`; `DELETE` routes left `memoryStore.privateMedia` and `.wav` files intact (`200 audio/wav`). | `POST /api/v1/jobs/:id/cancel` on completed job -> `200` (`status: "cancelled"`), scrubs job fields, unlinks `.wav` (`diskExists: false`), Bearer & signed URL -> `403 MEDIA_ARTIFACT_INVALIDATED`. Both `DELETE /api/voices/:id` (`200`) and `DELETE /api/v1/voices/:id` (`200`) unlink `.wav` (`diskExists: false`) and block prior signed URLs (`403`). | **FIXED** |
| **`V2-NEW-02`** Whitespace/malformed auth & legacy `?token=` / `x-session-token` downgrade on `optionalAuth` | `?token=%20%20%20`, `Authorization: "   "`, and `x-session-token: "   "` returned `200 OK` on `optionalAuth` by silently downgrading to anonymous. | All `?token=` variants (empty, `%20%20%20`, invalid, valid JWT, `?token[]=a`), all `x-session-token` variants, whitespace `Authorization: "    "` (raw TCP), raw JWT `Authorization`, `bearer <jwt>`, `Basic`, and `Bearer tok1 tok2` return **`401`** (`UNSUPPORTED_AUTH_TRANSPORT` / `MALFORMED_AUTH_HEADER`). | **FIXED** *(see `S2B-NEW-03` for duplicate raw `Authorization` headers)* |
| **`V2-NEW-03`** Static/fallback secrets in `PrivateStorageService` & `ConsentVerificationEngine` in `staging`/`production` | `PrivateStorageService.getSigningSecret()` accepted `DEV_FALLBACK` in `staging`; `ConsentVerificationEngine.SERVER_SECRET` cached fallback at import in `staging` & `production`. | Both `getSigningSecret()` and `getConsentSecret()` throw `FATAL SECURITY CONFIGURATION` across `staging`, `production`, and explicit unknown `NODE_ENV` (`"qa"`) for missing, blank, `< 16`-char, and known fallback secrets; fresh `staging`/`production` subprocess probes confirmed zero import-time fallback caching. | **FIXED** *(for those 2 classes; see `S2B-NEW-02` & `S2B-NEW-05`)* |

---

## 4. Independent Private-Audio Lifecycle Security Verification (Section 2)

### 4.1 Explicit Separation Across Access, Metadata, Download, Disk & Restart Layers
Per Section 2 requirements, S2B evaluated every lifecycle state transition across five distinct enforcement layers rather than conflating job JSON scrubbing with storage deletion or restart durability:

| Scenario | 1. Job Response Scrubbing | 2. Metadata Invalidation (`memoryStore.privateMedia` & Tombstone) | 3. Media-Download Denial (Signed URL + Bearer) | 4. Physical Storage Deletion (POSIX `.wav`) | 5. Restart Durability (`child_process` Verified) | Verdict |
|---|---|---|---|---|---|---|
| **2.1** Completed TTS job + HTTP `revoke-consent` | `GET /v1/tts/jobs` -> `cancelled`, `result`/`outputSignedUrl`/`outputMediaId` absent; job detail `/v1/tts/jobs/:id` & `/v1/jobs/:id` -> `403 CONSENT_REVOKED` | Removed from `memoryStore.privateMedia`; `invalidatedMedia` marked `consent_revoked` for both `tts_output` & `reference_audio` | Signed URL (`tts` + `ref`) -> `403`; Bearer download -> `403`; `verifySignedUrl() === false` | Both `.wav` files unlinked (`fs.existsSync === false`) | Disk `.wav` gone when `delete()` succeeded; tombstone itself is in-memory only | **PASS** *(TTS path)* |
| **2.2** Completed job + voice deletion (`DELETE /api/voices/:id` & `DELETE /api/v1/voices/:id`) | Both routes scrub jobs to `cancelled` with zero URLs/results; `/v1/tts/jobs/:id` -> `403` | Removed from `memoryStore.privateMedia`; `invalidatedMedia` marked `voice_deleted` | Signed URL & Bearer download -> `403` on both routes | `.wav` unlinked on both routes (`diskExists: false`) | Disk `.wav` gone when `delete()` succeeded; tombstone in-memory only | **PASS** *(TTS path)* |
| **2.3** Completed job + `POST /api/v1/jobs/:id/cancel` | `200`, `status: "cancelled"`, `result`/`outputSignedUrl`/`outputMediaId` deleted; non-cancelled sibling job unaffected; `idempotencyKey` reuse creates new job | Removed from `memoryStore.privateMedia`; `invalidatedMedia` marked `job_cancelled` | Signed URL & Bearer download -> `403 MEDIA_ARTIFACT_INVALIDATED` | `.wav` unlinked (`diskExists: false`) | Disk `.wav` gone when `delete()` succeeded; tombstone in-memory only | **PASS** |
| **2.4** Out-of-band `ConsentVerificationEngine.revokeConsent()` before HTTP access | `GET /v1/tts/jobs` & `GET /v1/tts/jobs/:id` fail closed before serialization (`cancelled` / `403`) | Lazy-invalidated upon job/download access *(note: `GET /v1/media` still lists metadata prior to lazy trigger — `S2B-NEW-06`)* | Immediate `403 CONSENT_REVOKED` on `GET ${signedUrl}` even before job list is queried (`dlOob.status === 403`) | `.wav` unlinked upon lazy invalidation | `auditRecords` & `invalidatedMedia` are in-memory | **PASS** *(with `S2B-NEW-06` note)* |
| **2.5** Prior signed URL replayed after revoke / delete / cancel | N/A | Tombstone checked in `verifySignedUrl()` & route Step 1 | `403` (`CONSENT_REVOKED` / `VOICE_DELETED` / `MEDIA_ARTIFACT_INVALIDATED`), `0` WAV bytes | Unlinked in normal path | **NOT restart-safe if `delete()` failed** (`verifySignedUrl()` reverts to `true` after restart — see §4.2) | **PARTIAL / LIMITATION (`S2B-NEW-04`)** |
| **2.6** Bearer-authenticated `GET /api/v1/media/download/:id` after invalidation | N/A | Tombstone checked before `memoryStore` lookup | Owner Bearer -> `403` invalidation code; cross-tenant Bob Bearer -> `403 FORBIDDEN_MEDIA_ACCESS` (no reason leak) | Unlinked in normal path | Returns `404` after restart only because `memoryStore.privateMedia` is not rehydrated | **PASS** *(in-process)* |
| **2.7** `provider.delete()` throws `StorageUnavailableError` OR returns `false` | Job still scrubbed to `cancelled` (`200`) | Synchronous pre-delete tombstone set (`cleanupFailed: true`, sanitized code); zero canary/path/audio leak (`throwLeakedCanaryInResponse: false`) | Signed URL -> `403`, Bearer -> `403`, `provider.retrieve` called **`0` times** (`retrieveHits: 0`) | Physical `.wav` bytes **remain on disk** (`diskBytesStillPresentButBlocked: true`) | **Tombstone lost on process restart** (`isMediaInvalidated: false`, `verifySignedUrl: true`, `.wav` still on disk) | **IN-PROCESS PASS / RESTART LIMITATION (`S2B-NEW-04`)** |
| **2.8** Repeated cancel / revoke & pre-unlinked disk file | Idempotent `200` on 2nd/3rd calls and when `.wav` was already unlinked (`cancelWhenFileAlreadyUnlinkedStatus: 200`) | `alreadyInvalidated: true`; `consent_revoked` precedence preserved | Remains `403` | Remains absent | N/A | **PASS** |
| **2.9** Cross-tenant access / invalidation attempts (`Bob` vs `Alice`) | Bob cannot view, cancel (`403`), delete (`403`), or revoke (`403`) Alice's jobs/voices | Bob cannot upload `reference_audio` linked to Alice's private `voiceId` (`403 FORBIDDEN_NOT_OWNER`) or call `invalidateAndDeleteMedia` (`Forbidden`) | Bob Bearer download -> `403 FORBIDDEN_MEDIA_ACCESS` both before & after Alice cancels | Alice's `.wav` untouched by Bob's rejected calls | N/A | **PASS** *(TTS path)* |
| **2.10** Normal authorized retrieval while consent is active | `POST /v1/tts/jobs` -> `201/200` (`completed`), `GET /v1/tts/jobs` & `:id` -> `200` | Stored in `memoryStore.privateMedia`; `GET /v1/media` -> `200` | Signed URL -> `200` (`117,190` valid RIFF/WAVE bytes); Bearer -> `200` | `.wav` written cleanly (`preDiskExists: true`) | N/A | **PASS** |
| **2.11 (`S2B-NEW-01`)** Multimodal dubbing with private cloned voice (`POST /api/media/transcribe-translate` -> `revoke-consent` -> `GET /api/media/jobs`) | **`FAIL`**: `memoryStore.transcriptionJobs` is **never scrubbed** on consent revocation or voice deletion | **`FAIL`**: Stores inline `dubbedAudioUrl: "data:audio/wav;base64,UklGR..."` (`730,230` chars) with **no `userId`** and **no `PrivateStorageService` tracking** | **`FAIL`**: Anonymous unauthenticated `GET /api/media/jobs` returns **`200 OK`** with full `730,230`-char WAV both **before** and **after** Alice revokes biometric consent (`leakedAfterRevocation: true`) | Inline data URI in memory + PostgreSQL `transcription_translation_jobs` | Persisted to PostgreSQL `transcription_translation_jobs` if DB connected | **`FAIL` (`S2B-NEW-01` — P0/P1)** |

### 4.2 Empirical Two-Subprocess Restart-Durability Evidence (`S2B-NEW-04`)
To strictly obey the S2B constraint *"Do not claim that an in-memory tombstone proves restart-safe invalidation"*, S2B executed a two-subprocess restart test against a shared `VOICEFORGE_STORAGE_DIR` and `VOICEFORGE_STORAGE_SECRET` where `provider.delete()` returned `false`:
- **Process 1 (Before Restart)**:
  - `mediaId`: `med_1793178231831_60e8e991f4992c5f`
  - `cleanupFailed`: `true` (physical `.wav` remained at `usr_alice_user/med_1793178231831_60e8e991f4992c5f.wav`)
  - `PrivateStorageService.verifySignedUrl(...)`: **`false`** (blocked by in-memory `invalidatedMedia` tombstone)
- **Process 2 (Fresh Process Boot Against Same Storage Directory & Signing Secret)**:
  - `PrivateStorageService.isMediaInvalidated(mediaId)`: **`false`** (in-memory `Map` lost on restart)
  - `PrivateStorageService.verifySignedUrl(...)`: **`true`** (**HMAC signed URL became valid again** for the remainder of its 15-minute TTL!)
  - `diskExistsAfterRestart`: **`true`** (orphaned `.wav` file still on disk, with no startup sweep)
  - `GET ${signedUrl}` HTTP status in Process 2: **`404`** (*only* because `memoryStore.privateMedia` is also an un-rehydrated in-memory array; if future code rehydrates `memoryStore.privateMedia` from disk or PostgreSQL — especially since `db.delete(schema.privateMedia)` in `invalidateAndDeleteMedia()` is un-awaited best-effort — the still-valid 15-minute signed URL + surviving `.wav` file would immediately re-expose invalidated private audio).

---

## 5. Independent Credential Handling Verification (Section 3)

Verified via live loopback HTTP (`fetch` + raw `node:net` TCP sockets) across `optionalAuth` (`GET /api/v1/voices`, `GET /api/v1/media/download/:id`), `requireAuth` (`GET /api/v1/auth/me`, `GET /api/v1/tts/jobs`), and public routes (`GET /api/health`):

| # | Test Scenario | Probe Input | Observed HTTP Status & Code | Verdict |
|---|---|---|---|---|
| 3.1 | No credentials on public / optional / protected routes | `GET /api/health`, `GET /api/v1/voices`, `GET /api/v1/auth/me`, `GET /api/v1/media/download/:id` | `/health` -> `200`; `/v1/voices` -> `200` (public premade voices only); `/v1/auth/me` -> `401 AUTH_REQUIRED`; `/v1/media/download/:id` (unsigned) -> `401 AUTH_REQUIRED` | **PASS** |
| 3.2 | Valid Bearer credentials | `Authorization: Bearer <aliceToken>` | `/v1/voices` -> `200` (includes Alice's private voices); `/v1/auth/me` -> `200`; cross-tenant/admin routes -> `403` | **PASS** |
| 3.3 | Empty & whitespace-only `Authorization` headers | Raw TCP `Authorization:     ` & empty header on `/api/v1/voices` | **`401 MALFORMED_AUTH_HEADER`** (never downgraded to anonymous) | **PASS** |
| 3.4 | Raw JWT `Authorization` without `Bearer ` | `Authorization: <aliceJwt>` on `/api/v1/voices` | **`401 MALFORMED_AUTH_HEADER`** | **PASS** |
| 3.5 | Malformed Bearer schemes | `Basic dXNlcjpwYXNz`, `Bearer`, `Bearer\t<aliceJwt>` (raw TCP), `Bearer <jwt> extra` | All **`401 MALFORMED_AUTH_HEADER`** | **PASS** |
| 3.6 | Lowercase `bearer` scheme | `Authorization: bearer <aliceJwt>` on `/api/v1/voices` | **`401 MALFORMED_AUTH_HEADER`** (strictly case-sensitive `'Bearer '` prefix) | **PASS** |
| 3.7 | Forged, expired, missing-`exp`, `alg:none`, & revoked JWTs | Tested on `optionalAuth` (`GET /api/v1/voices`) | Forged -> `401`; Expired -> `401`; Missing `exp` -> `401`; `alg:none` -> `401`; Revoked (`AuthService.revokeToken`) -> `401` (`AUTH_INVALID_TOKEN` — zero anonymous fallback) | **PASS** |
| 3.8 | `?token=` query attempts | `?token=`, `?token=%20%20%20`, `?token=<aliceJwt>`, `?token[]=abc&token[]=def`, and case-variant `?Token=<aliceJwt>` on `/v1/auth/me` | All `?token=` forms -> **`401 UNSUPPORTED_AUTH_TRANSPORT`**; `?Token=<aliceJwt>` on `/v1/auth/me` -> **`401 AUTH_REQUIRED`** (never authenticates) | **PASS** |
| 3.9 | `x-session-token` header attempts | `x-session-token: "   "` and `x-session-token: <aliceJwt>` on `/api/v1/voices` | **`401 UNSUPPORTED_AUTH_TRANSPORT`** | **PASS** |
| 3.10a | Cross-transport conflicts (`Bearer` + `?token=`, `Bearer` + `x-session-token`, signed URL + invalid `Bearer`, signed URL + `?token=`) | `Bearer <alice>` + `?token=abc`; `Bearer <alice>` + `x-session-token: abc`; signed media URL + `Bearer forged`; signed media URL + `?token=foo` | All **`401`** (`UNSUPPORTED_AUTH_TRANSPORT` / `AUTH_INVALID_TOKEN`) | **PASS** |
| 3.10b | **Same-header duplicate `Authorization` conflict over raw HTTP/1.1 (`S2B-NEW-03`)** | Raw TCP: `Authorization: Bearer <aliceJwt>\r\nAuthorization: Bearer <bobJwt>` and `Authorization: Bearer <aliceJwt>\r\nAuthorization: Bearer forged.token.here` on `GET /api/v1/auth/me` | **`200 OK` (`usr_alice_user`)** — Node `http` drops the 2nd `Authorization` header from `req.headers.authorization` while keeping both in `req.rawHeaders`, instead of rejecting conflicting `Authorization` headers with `401` | **`FAIL` (`S2B-NEW-03` — P2)** |

---

## 6. Independent Restricted-Environment Secrets Verification (Section 4)

### 6.1 Secret Enforcement Matrix (`PrivateStorageService` & `ConsentVerificationEngine`)
Verified dynamically across `NODE_ENV` values:

| `NODE_ENV` | `isRestrictedEnvironment` | Missing Secret Throws? | Blank (`"   "`) Throws? | Short (`15` chars) Throws? | Known Dev/Legacy Fallback Literal Throws? | Valid `>= 16`-Char Secret Works? |
|---|---|---|---|---|---|---|
| `'development'` | `false` | `false` (dev fallback) | `false` (dev fallback) | `false` | `false` | `true` |
| `'test'` | `false` | `false` (dev fallback) | `false` (dev fallback) | `false` | `false` | `true` |
| `'staging'` | `true` | **`true`** | **`true`** | **`true`** | **`true`** | `true` |
| `'production'` | `true` | **`true`** | **`true`** | **`true`** | **`true`** | `true` |
| `'qa'` / `'PRODUCTION'` / `''` (explicit unknown) | `true` (fails closed to `'production'`) | **`true`** | **`true`** | **`true`** | **`true`** | `true` |
| `undefined` (unset `NODE_ENV`) | `false` (resolves to `'development'`) | `false` | `false` | `false` | `false` | `true` |

### 6.2 Post-Initialization `NODE_ENV` Transitions & Secret Redaction
- **Post-initialization transition**: Signed download URLs, consent challenges, and consent audit records created under `NODE_ENV=development` or `test` using fallback secrets immediately fail closed (`verifySignedUrl() === false`, `verifyEnrollment()` throws, `isConsentActive() === false`) when `process.env.NODE_ENV` transitions to `'staging'` or `'production'` (both when restricted secrets are unset and when real restricted secrets are configured).
- **Zero secret value leakage**: Intercepted `console.log`, `console.warn`, `console.error`, and thrown error messages across all secret probes; zero secret literals appeared in logs or error payloads.

### 6.3 Confirmed Residual Restricted-Environment Secret Vulnerabilities Outside S2A's Two Remediated Classes
1. **`S2B-NEW-02` (P1 — Confirmed Restricted-Environment Secret Bypass in `AudioWatermarker`)**:
   - In `server/engine/audio/watermark.ts:39-42`, `AudioWatermarker.SIGNING_KEYS` statically binds `'k_prod_2026_v1'` at module import to `process.env.VOICEFORGE_WATERMARK_KEY || 'vf_watermark_hmac_secret_key_prod_8f1b2c3d4e5a'` (and `'k_legacy_2025_v0'` to `'vf_watermark_hmac_secret_key_legacy_rotation'`) with **no `isRestrictedEnvironment(process.env.NODE_ENV)` check** and **no boot check in `server.ts`**.
   - **Live subprocess proof**: Spawned a clean Node/tsx subprocess with `NODE_ENV=production` and `VOICEFORGE_WATERMARK_KEY` unset; `AudioWatermarker.signGeneration(...)` succeeded (`succeededWithoutSecretInProduction: true`, `keyId: "k_prod_2026_v1"`), signing provenance manifests with the publicly committed repository fallback string.
2. **`S2B-NEW-05` (P2 — Weak / Fallback Secret Acceptance in `getAuthSecret()` & Unset `NODE_ENV` Operational Note)**:
   - In `server/auth/auth.ts:38-49`, `getAuthSecret()` checks only `!secret || secret.trim().length === 0`. Under `NODE_ENV=staging`, S2B empirically verified that `getAuthSecret()` **accepts** its own hardcoded repository dev-fallback literal `'vf_auth_secret_phase3a_secure_token_sig_k92m'` (`authAcceptsKnownDevFallbackLiteralInStaging: true`) and a 5-character secret `'short'` (`authAcceptsShort5CharSecretInStaging: true`) without throwing.

---

## 7. Regression, Compatibility & Known Release-Blocker Execution Results (Section 5)

All suites and builds were executed **without modifying any test or source file**, cleaning temporary `dist-server/` and `dist/` output directories afterward and restoring `storage/auth/revoked_tokens.json` after legacy revocation tests:

| Command Executed | Exit Code | Pass / Fail Counts | Classification |
|---|---|---|---|
| `npx tsx --test test/security/phase3c_s1_auth_remediation.test.ts` | `0` | `12 / 12` passed (`0` failed) | **PASS** |
| `npx tsx --test test/security/phase3c_s2a_remediation.test.ts` | `0` | `12 / 12` passed (`0` failed) | **PASS** |
| `npx tsx --test test/security/*.test.ts` (all 5 security suites) | `0` | `49 / 49` passed (`0` failed) | **PASS** |
| `npx tsx --test <all 13 non-PostgreSQL unit + API + security + integration suites>` | `0` | `107 / 107` passed (`0` failed across 13 suites) | **PASS** |
| `npm run lint` (`tsc --noEmit`) | `0` | `0` TypeScript errors | **PASS** |
| `npm run build:server` (`esbuild server.ts ...`) | `0` | Built `dist-server/server.js` (`348.4 KB`, cleaned up after check) | **PASS** |
| `python3 services/omnivoice/tests/run_tests.py` | `0` | `15 / 15` `unittest` cases passed (`0.324s`) | **PASS** |
| `python3 -m pytest services/omnivoice/tests/test_inference.py` | `1` | `No module named pytest` in system Python | **BLOCKED (Env)** |
| `npm run build:client` (`vite build`) | `1` | Fails resolving `react-is` imported by `node_modules/recharts/es6/util/ReactUtils.js` (`dist/` cleaned up) | **FAIL / BLOCKED (Known Non-S2A Blocker)** |
| `npx tsx --test test/integration/postgres_persistence.test.ts` | `1` | `1 / 6` passed, `5 / 6` failed (`ECONNREFUSED` on `127.0.0.1:5433` / `5432`) | **BLOCKED (Known Non-S2A Blocker)** |

---

## 8. Prioritized Newly Discovered Vulnerabilities & Narrow Follow-Up Remediation Plan (Not Implemented in S2B)

| ID | Severity | Location | Confirmed Issue | Narrow Follow-Up Remediation (Phase 3C-S2C Scope) |
|---|---|---|---|---|
| **`S2B-NEW-01`** | **P0 / Critical** | `server/routes/api.ts:2076-2250`, `220-277` | `POST /api/media/transcribe-translate` synthesizes inline WAV (`dubbedAudioUrl: "data:audio/wav;base64,..."`) from a caller's private cloned `dubbingVoiceId` into `memoryStore.transcriptionJobs` (and `transcriptionTranslationJobs`) with no `userId` binding; `GET /api/media/jobs` is unauthenticated, un-scoped, and never checks `isVoiceConsentVerifiedActive(dubbingVoiceId)`, and `purgeVoiceArtifactsAndJobs()` omits `transcriptionJobs` — leaking `730,230` chars of revoked private cloned-voice audio to anonymous callers. | 1) Require authentication (`requireAuth`) when `dubbingVoiceId` references a non-public/cloned voice and bind `userId: req.user?.id` on every `transcriptionJobs` record (or store dubbing WAV in `PrivateStorageService` with `voiceId` rather than inline `data:audio/wav;base64`). 2) Require `requireAuth` + strict owner/admin filtering on `GET /api/media/jobs`. 3) Enforce `isVoiceConsentVerifiedActive(job.dubbingVoiceId)` on `GET /api/media/jobs` and scrub `memoryStore.transcriptionJobs` (plus `transcriptionTranslationJobs` in DB) inside `purgeVoiceArtifactsAndJobs()`. |
| **`S2B-NEW-02`** | **P1 / High** | `server/engine/audio/watermark.ts:38-42`, `server.ts:48-62` | `AudioWatermarker.SIGNING_KEYS` caches hardcoded `'vf_watermark_hmac_secret_key_prod_8f1b2c3d4e5a'` (and legacy `'vf_watermark_hmac_secret_key_legacy_rotation'`) at module import and signs provenance manifests in `staging`/`production` when `VOICEFORGE_WATERMARK_KEY` is unset. | Replace static `SIGNING_KEYS` with dynamic `AudioWatermarker.getSigningKey(keyId)` enforcing `isRestrictedEnvironment(process.env.NODE_ENV)` (rejecting missing, blank, `< 16`-char, and fallback literals in `staging`/`production`, disabling hardcoded legacy fallback key in restricted envs unless explicitly configured via env), and validate at server boot in `server.ts`. |
| **`S2B-NEW-03`** | **P2 / Medium** | `server/auth/auth.ts:505-547` | Duplicate raw HTTP `Authorization` headers (`Bearer <alice>` + `Bearer <bob>` or `Bearer <alice>` + `Bearer forged`) return `200 OK` as `usr_alice_user` because Node drops the 2nd header from `req.headers.authorization`. | Inspect `req.rawHeaders` in `AuthService.parseCredential(req)` and count headers matching `/^authorization$/i`; if count `> 1`, immediately return `{ status: 'invalid', code: 'MALFORMED_AUTH_HEADER', error: '...' }`. |
| **`S2B-NEW-04`** | **P2 / Medium** | `server/storage/privateStorage.ts:198,342-352,669-678` | `PrivateStorageService.invalidatedMedia` is an in-memory `Map`. When `provider.delete()` fails (`cleanupFailed: true`) and the process restarts within the 15-min signed-URL TTL, `isMediaInvalidated()` resets to `false`, `verifySignedUrl()` flips back to `true`, and orphaned `.wav` files remain on disk without startup sweep; `db.delete(schema.privateMedia)` is also un-awaited. | Persist media invalidation tombstones durably (mirrors `DurableRevocationStore` JSON ledger + `await` DB tombstone/delete) and run a startup reconciliation sweep retrying `provider.delete(storageKey)` for any tombstoned entry with `cleanupFailed: true`. |
| **`S2B-NEW-05`** | **P2 / Medium** | `server/auth/auth.ts:38-49`, `server/db/index.ts:43,105`, `server/engine/audio/synthesizer.ts:300,342,350` | `getAuthSecret()` accepts `< 16`-char secrets and its own hardcoded dev-fallback literal in `staging`/`production`; `db/index.ts` and `synthesizer.ts` check literal `'production'`/`'staging'` instead of `isRestrictedEnvironment()`, and `synthesizer.ts:300` checks `status === 'revoked'` rather than `!ConsentVerificationEngine.isConsentActive()`. | Align `getAuthSecret()` with `getSigningSecret()`/`getConsentSecret()` (`trimmed.length < 16` and dev-fallback rejection in `isRestrictedEnvironment`), use `isRestrictedEnvironment()` consistently in `db/index.ts` and `synthesizer.ts`, and enforce `!ConsentVerificationEngine.isConsentActive(voice.id)` in `synthesizer.ts:300`. |
| **`S2B-NEW-06`** | **P3 / Low** | `server/routes/api.ts:1454-1458` | After out-of-band in-memory `ConsentVerificationEngine.revokeConsent()`, `GET /api/v1/media` continues returning `PrivateMediaRecord` metadata (no audio bytes, includes relative `storageKey`) until a download/job check triggers lazy invalidation. | Filter/lazily invalidate `!isVoiceConsentVerifiedActive(m.voiceId)` and `!PrivateStorageService.isMediaInvalidated(m.id)` in `GET /api/v1/media`, and omit internal `storageKey` from client-facing `PrivateMediaRecord` JSON responses. |

---

## 9. Objective-by-Objective & Gate Verdicts

| Objective / Gate | Verdict | Direct Evidence Summary |
|---|---|---|
| **Objective 1**: Private Audio Lifecycle Security (Section 2) | **`FAIL`** | S2A's targeted TTS/media routes (`revoke-consent`, `DELETE /voices/:id`, `DELETE /v1/voices/:id`, `cancel`, `/v1/tts/jobs`, `/v1/media/download/:id`) **PASS** all in-process adversarial checks, **but** **`S2B-NEW-01`** confirms anonymous & post-revocation leakage of `730,230`-char inline cloned-voice WAV via `POST /api/media/transcribe-translate` -> `GET /api/media/jobs`, and **`S2B-NEW-04`** proves in-memory `invalidatedMedia` tombstones are lost across process restarts when `provider.delete()` fails. |
| **Objective 2**: Credential Handling & Transport Discipline (Section 3) | **`FAIL`** | `?token=`, `x-session-token`, whitespace/raw/lowercase/malformed `Authorization`, forged/expired/missing-`exp`/`alg:none`/revoked JWTs, and cross-transport conflicts all **PASS** (`401`, zero anonymous downgrade), **but** **`S2B-NEW-03`** confirms conflicting duplicate raw HTTP `Authorization` headers (`Bearer <alice>` + `Bearer <bob>`/`forged`) return `200 OK` instead of `401`. |
| **Objective 3**: Restricted-Environment Secrets (Section 4) | **`FAIL`** | `PrivateStorageService` and `ConsentVerificationEngine` **PASS** all dynamic secret/env/redaction checks, **but** **`S2B-NEW-02`** confirms `AudioWatermarker` signs production provenance manifests with a hardcoded repository fallback key when `VOICEFORGE_WATERMARK_KEY` is unset, and **`S2B-NEW-05`** confirms `getAuthSecret()` accepts `< 16`-char and known dev-fallback secrets in `staging`/`production`. |
| **Objective 4**: Existing Security, Unit, API, Integration (Non-PG), Lint, Server Build & Python `omnivoice` Suites (Section 5) | **`PASS`** *(with `pytest` runner `BLOCKED`)* | `S1` (`12/12`), `S2A` (`12/12`), all security (`49/49`), all 13 non-PG Node/TS suites (`107/107`), `npm run lint` (`0`), `npm run build:server` (`0`), and `python3 services/omnivoice/tests/run_tests.py` (`15/15`) passed cleanly. |
| **Objective 5**: Known Non-S2A Release Blockers (`build:client` & PostgreSQL `127.0.0.1:5433`) | **`FAIL` / `BLOCKED`** | `npm run build:client` fails (`exit 1`, missing `react-is`); `postgres_persistence.test.ts` fails `5/6` (`exit 1`, `ECONNREFUSED` on `127.0.0.1:5433`). |
| **GATE 1 — Phase 3C-S2 Security Gate** | **`FAIL`** | Marked `FAIL` per S2B rules due to confirmed residual private-audio leak (`S2B-NEW-01`), restricted-environment secret bypasses (`S2B-NEW-02`, `S2B-NEW-05`), duplicate `Authorization` wire ambiguity (`S2B-NEW-03`), and non-durable failed-delete tombstones across restarts (`S2B-NEW-04`). |
| **GATE 2 — Overall Release Gate** | **`FAIL` / `BLOCKED`** | Blocked by both Gate 1 (`FAIL`) and unresolved non-S2A blockers (`build:client` `react-is` and PostgreSQL `127.0.0.1:5433`). |

---

## 10. Non-Modification & Boundary Attestation

1. **Zero code, test, manifest, lockfile, or prior-report edits**: Every existing tracked and untracked file in `/home/user/Voice-clone` (including `package.json`, `bun.lock`, `storage/auth/revoked_tokens.json`, all `server/` and `src/` files, all `test/` files, and `reports/PHASE-0`, `PHASE-3C-S1`, `PHASE-3C-V2`, and `PHASE-3C-S2A`) retains its exact pre-S2B SHA-256 checksum recorded in Section 1.2.
2. **Zero dependency or infrastructure mutations**: No packages were installed, no lockfiles were created or modified, PostgreSQL was not provisioned, no external AI/network endpoints were contacted, and no git commits, branches, tags, pushes, or pull requests were created.
3. **Single Deliverable Created**: `reports/PHASE-3C-S2B-INDEPENDENT-SECURITY-VERIFICATION.md`.
