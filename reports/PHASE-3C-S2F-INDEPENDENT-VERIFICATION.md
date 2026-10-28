# Phase 3C-S2F — Independent Adversarial Verification of Phase 3C-S2E

- **Phase**: `Phase 3C-S2F — Independent Adversarial Verification of S2E (Strictly Read-Only for Source & Tests)`
- **Verification Date**: `2026-10-28`
- **Repository Root**: `/home/user/Voice-clone` (`ranimony-afk/Voice-clone`)
- **Active Branch**: `arena/3b3635b6-voice-clone` (status: `active`)
- **Baseline `HEAD` Commit**: `594593a129ee586e29143933e09b4ee634460567`
- **Audited Phase 3C-S2E Report**: `reports/PHASE-3C-S2E-RESTART-DURABILITY-REMEDIATION.md`
  - **Expected SHA-256**: `ec0dc471f4f5154c5ed7df86581e3ca23223e081d398f8dd8631f8bb185c36af`
  - **Verified Pre- & Post-S2F SHA-256**: `ec0dc471f4f5154c5ed7df86581e3ca23223e081d398f8dd8631f8bb185c36af` (**EXACT MATCH**)
- **Historical Phase 3C-S2D Report**: `reports/PHASE-3C-S2D-INDEPENDENT-SECURITY-VERIFICATION.md`
  - **Expected SHA-256**: `1df7ca892a09664d2b649864059914c1002082c930dd6aa42328f755b2098f61`
  - **Verified Pre- & Post-S2F SHA-256**: `1df7ca892a09664d2b649864059914c1002082c930dd6aa42328f755b2098f61` (**EXACT MATCH**)
- **`S2D-NEW-01` Local Restart-Durability Verdict**: **`PASS`** *(Both historical S2D exploit chains — Scenario A unwritable `0o500` shared storage root and Scenario B failed `provider.delete()` + missing `.invalidated_media.json` — plus all 12 adversarial failure modes under `LocalStorageProvider` fail closed with `0` WAV bytes leaked across genuinely separate OS processes; three non-blocking defense-in-depth observations `S2F-OBS-01`..`03` are documented in §5.)*
- **Overall Release Gate Verdict**: **`NO-GO` (`BLOCKED / FAIL` on separate non-S2E gates)** *(Local security blocker `S2D-NEW-01` is closed, **however** live PostgreSQL multi-instance verification `S2B-NEW-04 (4B)` on `127.0.0.1:5433` remains **`BLOCKED`** (`ECONNREFUSED`) and frontend `npm run build:client` remains **`FAIL`** (`react-is` unresolved in `recharts`).)*

---

## 1. Executive Gate Verdict Matrix (Strictly Separated)

| Gate / Scope | S2E Claimed Status | Independent S2F Verdict | Direct Evidence Summary |
|---|---|---|---|
| **`S2D-NEW-01` (`S2B-NEW-04` Sub-Objective 4A)** — Local Shared-Filesystem Restart-Durable Private-Media Invalidation | `PASS` | **`PASS`** | Independently challenged across genuinely separate OS processes (`PID 11365 -> 11394 -> 11419`, `PID 11444 -> 11473`, `PID 11498 -> 11527`, `PID 11578 -> 11607 / 11632`, `PID 11755 -> 11784`, `PID 11809 -> 11838`, `PID 11892 -> 11921`): zero false `200 OK` responses when durability cannot be established (`503`, `success: false`), sticky unhealthy ledger state, pre-initialized `0o600` emergency WAL written & replayed across OS restarts (`403`, `0` WAV bytes), missing ledger with artifacts fails closed (`503`, `0` WAV bytes), and `0` WAV bytes leaked across all 12 challenged failure modes on `LocalStorageProvider`. |
| **`S2B-NEW-04` (Sub-Objective 4B)** — Live PostgreSQL Multi-Instance Durability (`127.0.0.1:5433`) | `BLOCKED` | **`BLOCKED`** | PostgreSQL is not running at `127.0.0.1:5433` (`ECONNREFUSED`); `test/integration/postgres_persistence.test.ts` exits `1` (`1/6` pass, `5/6` fail). Local POSIX durability (`4A`) is not conflated with live PostgreSQL durability (`4B`). |
| **Existing Privacy & Auth Protections** (`PHASE-3C-S1`, `S2A`, `S2C`) | `PASS` | **`PASS`** | `phase3c_s1_auth_remediation.test.ts` (`12/12`), `phase3c_s2a_remediation.test.ts` (`12/12`), `phase3c_s2c_residual_remediation.test.ts` (`8/8`), all 7 security suites (`65/65`), plus independent Campaign 3 cross-tenant, anonymous, expired/tampered signed-URL, and consent-revocation checks all pass with `0` regressions. |
| **Non-PostgreSQL Automated Test Suites** (Node/TS + Python OmniVoice) | `PASS` | **`PASS`** | `123 / 123` Node/TS tests across all 15 non-PostgreSQL suites (`0` failed) + `15 / 15` Python OmniVoice tests (`services/omnivoice/tests/run_tests.py`, `0.345s`, `0` failed). |
| **Lint & Server Build** (`npm run lint`, `npm run build:server`) | `PASS` | **`PASS`** | `tsc --noEmit` exits `0` (`0` errors); `esbuild server.ts ...` builds `dist-server/server.js` (`397.6 KB`, exit `0`; temporary `dist-server/` removed after verification). |
| **Frontend Client Build** (`npm run build:client` — `react-is`) | `FAIL` | **`FAIL`** | Pre-existing separate blocker unchanged: Vite/Rolldown exits `1` failing to resolve `"react-is"` imported by `node_modules/recharts/es6/util/ReactUtils.js` (`dist/` removed after check). |
| **Overall Release Gate** | `NO-GO` | **`NO-GO`** | Release readiness is **not** declared while `S2B-NEW-04 (4B)` remains `BLOCKED` (`127.0.0.1:5433` `ECONNREFUSED`) and `npm run build:client` remains `FAIL` (`react-is`). |

---

## 2. Mandatory Read-Only Preflight & Workspace Preservation Proof

### 2.1 Repository, Branch, Remote & Worktree Identity
- **Repository Root**: `/home/user/Voice-clone`
- **Branch**: `arena/3b3635b6-voice-clone` (`active`)
- **`HEAD` Commit**: `594593a129ee586e29143933e09b4ee634460567`
- **Configured Remotes**: `origin https://github.com/ranimony-afk/Voice-clone.git` (fetch & push)
- **Target Report Pre-Existence Check**: `reports/PHASE-3C-S2F-INDEPENDENT-VERIFICATION.md` did not exist prior to S2F (`EXISTS=false`).
- **Read-Only Discipline**: Zero application source files, test files, manifests (`package.json`), lockfiles (`bun.lock`), runtime revocation state (`storage/auth/revoked_tokens.json`), or prior phase reports (`PHASE-0` through `PHASE-3C-S2E`) were modified. All external multi-process probes ran via stdin/ephemeral `/tmp/s2f-*` directories outside `/home/user/Voice-clone` and were completely removed after recording structured JSON output.

### 2.2 Pre-S2F vs. Post-S2F SHA-256 Checksums (41 Verified Files)

| File Path | Pre-S2F SHA-256 | Post-S2F SHA-256 | Status |
|---|---|---|---|
| `package.json` | `96cb310c3093ccd9cc352f8bbfd007fdb97c33b88bf1ab0c02839cd74470d400` | `96cb310c3093ccd9cc352f8bbfd007fdb97c33b88bf1ab0c02839cd74470d400` | **IDENTICAL** |
| `bun.lock` | `6dbe0469946c602996493bb706e9eff060cf5ed1afd2c71134b23afdcb826e48` | `6dbe0469946c602996493bb706e9eff060cf5ed1afd2c71134b23afdcb826e48` | **IDENTICAL** |
| `storage/auth/revoked_tokens.json` | `6c29f5194bb7fbe434fe464610eb790756191e31ee6a938c12225b61f3a70e2e` | `6c29f5194bb7fbe434fe464610eb790756191e31ee6a938c12225b61f3a70e2e` | **IDENTICAL** |
| `server.ts` | `b76e5c6188ea390e9af8e46f89b4b5b40cbdf4f6e46b75916d5304449a68e894` | `b76e5c6188ea390e9af8e46f89b4b5b40cbdf4f6e46b75916d5304449a68e894` | **IDENTICAL** |
| `server/auth/auth.ts` | `788b4242ce6f43e2c242816573a0c3080ba782a9c8db89e03cf826f1aac175e3` | `788b4242ce6f43e2c242816573a0c3080ba782a9c8db89e03cf826f1aac175e3` | **IDENTICAL** |
| `server/config/env.ts` | `3bd0bc50c34d2356798fd0ac645cee05625f036abda547d6c1dd122a1a0dcc1a` | `3bd0bc50c34d2356798fd0ac645cee05625f036abda547d6c1dd122a1a0dcc1a` | **IDENTICAL** |
| `server/db/index.ts` | `0d858ac9562833ea1a4c099d1e20562b1d17aec0bab480b11d28d9ee0716f31d` | `0d858ac9562833ea1a4c099d1e20562b1d17aec0bab480b11d28d9ee0716f31d` | **IDENTICAL** |
| `server/engine/audio/consent.ts` | `e7a30d3ffa20f95dde3ff3b253257286b1bd613c3f3a68f3f065ea6dbcebe4e3` | `e7a30d3ffa20f95dde3ff3b253257286b1bd613c3f3a68f3f065ea6dbcebe4e3` | **IDENTICAL** |
| `server/engine/audio/synthesizer.ts` | `acd3bf8fd85cbd2ab1c5ec5758ac780348bad898b2ec56057f89e4bcdc44e862` | `acd3bf8fd85cbd2ab1c5ec5758ac780348bad898b2ec56057f89e4bcdc44e862` | **IDENTICAL** |
| `server/engine/audio/watermark.ts` | `5623bcc5c248f80497f97c283d7cdc763330caca2e7d0f84cc95d5f3c53ecbf5` | `5623bcc5c248f80497f97c283d7cdc763330caca2e7d0f84cc95d5f3c53ecbf5` | **IDENTICAL** |
| `server/routes/api.ts` | `5075602da7bcdaff7de0d76219dc366faab78587ccef3ea88a923cdf9524fa8f` | `5075602da7bcdaff7de0d76219dc366faab78587ccef3ea88a923cdf9524fa8f` | **IDENTICAL** |
| `server/storage/privateStorage.ts` | `e0e733fd831513f91ee67fb43f186096bf0bbb354095076ecd3eee8cc612296d` | `e0e733fd831513f91ee67fb43f186096bf0bbb354095076ecd3eee8cc612296d` | **IDENTICAL** |
| `src/components/Header.tsx` | `bd9093836238ae5c794a94ea6fbe347154910c3ee31ba62b14fde7ec8bec1f60` | `bd9093836238ae5c794a94ea6fbe347154910c3ee31ba62b14fde7ec8bec1f60` | **IDENTICAL** |
| `src/components/MediaTranscribeTranslateView.tsx` | `72686614fa3f53f75d7ff46d1c3ba35fe6c5ee980d46fb5f12c9bea3d6b3f677` | `72686614fa3f53f75d7ff46d1c3ba35fe6c5ee980d46fb5f12c9bea3d6b3f677` | **IDENTICAL** |
| `src/components/VoiceCloningLabView.tsx` | `c455997a773cb054a1fb977c1b1e1183ae0495958d08a7e37609b1c6b53daa1f` | `c455997a773cb054a1fb977c1b1e1183ae0495958d08a7e37609b1c6b53daa1f` | **IDENTICAL** |
| `test/api/routes.test.ts` | `e2a0dd8759cc4749ccd3480f6760c9cb0a5cbf11b47271ba4cff4f6df7d38963` | `e2a0dd8759cc4749ccd3480f6760c9cb0a5cbf11b47271ba4cff4f6df7d38963` | **IDENTICAL** |
| `test/integration/consent_job_race.test.ts` | `3bb1b4d69e0ded548948aeb36f5b365597ecdf581c36632f929952ccf6c15661` | `3bb1b4d69e0ded548948aeb36f5b365597ecdf581c36632f929952ccf6c15661` | **IDENTICAL** |
| `test/integration/durable_revocation.test.ts` | `72555e483060d5ea0e94f37aedd6b87810e5e5a0597f9d3191e213fdd460f79d` | `72555e483060d5ea0e94f37aedd6b87810e5e5a0597f9d3191e213fdd460f79d` | **IDENTICAL** |
| `test/integration/postgres_persistence.test.ts` | `1314fe4313dbd3b92dae4912387e0f704b1b67df8c74f2b78eeb5b3d67c7db5a` | `1314fe4313dbd3b92dae4912387e0f704b1b67df8c74f2b78eeb5b3d67c7db5a` | **IDENTICAL** |
| `test/integration/rate_limit_and_db_fail_closed.test.ts` | `64bdb975f0dda363e2d9f4a84c933529189b939dd5bae8c1c50d843cd4a222cf` | `64bdb975f0dda363e2d9f4a84c933529189b939dd5bae8c1c50d843cd4a222cf` | **IDENTICAL** |
| `test/integration/storage_provider.test.ts` | `b5aee2792f717f588aaad7e8b8d50ccd906f2689b33ec774ba6bfa2d1dc5ea13` | `b5aee2792f717f588aaad7e8b8d50ccd906f2689b33ec774ba6bfa2d1dc5ea13` | **IDENTICAL** |
| `test/security/consent.test.ts` | `68d9cd9ce09ad5eeb869f18947f7ff905bf6c310888fc7d0f3d8ee9292ff3ac3` | `68d9cd9ce09ad5eeb869f18947f7ff905bf6c310888fc7d0f3d8ee9292ff3ac3` | **IDENTICAL** |
| `test/security/phase3a_security.test.ts` | `59ec59bf42e83d7a9619323afba52d851ea0d504e6f2d8f5a164085c503e9e9b` | `59ec59bf42e83d7a9619323afba52d851ea0d504e6f2d8f5a164085c503e9e9b` | **IDENTICAL** |
| `test/security/phase3c_s1_auth_remediation.test.ts` | `8c87298910042b94e3e7af98d54d78ee5ff23dca78a13c3f083e8f255592b7f4` | `8c87298910042b94e3e7af98d54d78ee5ff23dca78a13c3f083e8f255592b7f4` | **IDENTICAL** |
| `test/security/phase3c_s2a_remediation.test.ts` | `2d4ad902f733484d2559a3cf5a5bb4542187e424eba75964ba4c48a5caeeff95` | `2d4ad902f733484d2559a3cf5a5bb4542187e424eba75964ba4c48a5caeeff95` | **IDENTICAL** |
| `test/security/phase3c_s2c_residual_remediation.test.ts` | `bed41adb7868fd5a95c4548359c9c2a347037d1c8743f9de85d033b672b90317` | `bed41adb7868fd5a95c4548359c9c2a347037d1c8743f9de85d033b672b90317` | **IDENTICAL** |
| `test/security/phase3c_s2e_restart_durability.test.ts` | `3320195fa8f2d2120ef1e2b8d8da240a84d65ec5a3ab1e99a5ff0941d57f3841` | `3320195fa8f2d2120ef1e2b8d8da240a84d65ec5a3ab1e99a5ff0941d57f3841` | **IDENTICAL** |
| `test/security/watermark.test.ts` | `1b3645c9318582109a14915d4c8a52ccb1b79231d726551d59349890acb3cd0c` | `1b3645c9318582109a14915d4c8a52ccb1b79231d726551d59349890acb3cd0c` | **IDENTICAL** |
| `test/unit/normalizer.test.ts` | `5f1aee01885d571fa7008316bb541bad47fba75eaa02d9c3baf8d5ce050a2e6a` | `5f1aee01885d571fa7008316bb541bad47fba75eaa02d9c3baf8d5ce050a2e6a` | **IDENTICAL** |
| `test/unit/phonemizer.test.ts` | `6cf9254544866308f914bd8d75de48a18a3f32b1c459f28a1b4b6f43e925fd89` | `6cf9254544866308f914bd8d75de48a18a3f32b1c459f28a1b4b6f43e925fd89` | **IDENTICAL** |
| `test/unit/quality.test.ts` | `f856f5f3ad6f9b69a16fd72bfec4aef28a0c4c38c2e4965077e038188727f6b1` | `f856f5f3ad6f9b69a16fd72bfec4aef28a0c4c38c2e4965077e038188727f6b1` | **IDENTICAL** |
| `services/omnivoice/tests/run_tests.py` | `2822c19f3cbd4f663dad160a94af88d96debcf6da61732b49ad94fe3969e82c9` | `2822c19f3cbd4f663dad160a94af88d96debcf6da61732b49ad94fe3969e82c9` | **IDENTICAL** |
| `services/omnivoice/tests/test_inference.py` | `460539ead735d5c8acc1d1312abae50f27f7273dbd21731438fed43a1acfaae8` | `460539ead735d5c8acc1d1312abae50f27f7273dbd21731438fed43a1acfaae8` | **IDENTICAL** |
| `reports/PHASE-0-NEW-ARENA-BOOTSTRAP-AND-ROADMAP.md` | `2a3672393f93bd4fcb954f024245dec2abec64b789335ece06669f138b5a2772` | `2a3672393f93bd4fcb954f024245dec2abec64b789335ece06669f138b5a2772` | **IDENTICAL** |
| `reports/PHASE-3C-S1-CRITICAL-AUTH-REMEDIATION.md` | `337039b386d156f4e727dd1e8ffadf93bf03e3e1ab86c61d41388f37cae9970e` | `337039b386d156f4e727dd1e8ffadf93bf03e3e1ab86c61d41388f37cae9970e` | **IDENTICAL** |
| `reports/PHASE-3C-V2-INDEPENDENT-VERIFICATION.md` | `d51ebc96781a33a62891610c13a518bfd25d2319dec364f79fca482d046f44ed` | `d51ebc96781a33a62891610c13a518bfd25d2319dec364f79fca482d046f44ed` | **IDENTICAL** |
| `reports/PHASE-3C-S2A-CRITICAL-SECURITY-REMEDIATION.md` | `e984fd03ed34427bd869be765bed8902830d8f9f27157e33b02f7a584703a912` | `e984fd03ed34427bd869be765bed8902830d8f9f27157e33b02f7a584703a912` | **IDENTICAL** |
| `reports/PHASE-3C-S2B-INDEPENDENT-SECURITY-VERIFICATION.md` | `7b07914a5b326283eb185cb76b481ddb70c14afc60bf3d27d09de2ae3eea31f9` | `7b07914a5b326283eb185cb76b481ddb70c14afc60bf3d27d09de2ae3eea31f9` | **IDENTICAL** |
| `reports/PHASE-3C-S2C-RESIDUAL-SECURITY-REMEDIATION.md` | `9b481d0aa8610f180dc472524007f58dde1a0c9314994af039cff9734887b155` | `9b481d0aa8610f180dc472524007f58dde1a0c9314994af039cff9734887b155` | **IDENTICAL** |
| `reports/PHASE-3C-S2D-INDEPENDENT-SECURITY-VERIFICATION.md` | `1df7ca892a09664d2b649864059914c1002082c930dd6aa42328f755b2098f61` | `1df7ca892a09664d2b649864059914c1002082c930dd6aa42328f755b2098f61` | **IDENTICAL** |
| `reports/PHASE-3C-S2E-RESTART-DURABILITY-REMEDIATION.md` | `ec0dc471f4f5154c5ed7df86581e3ca23223e081d398f8dd8631f8bb185c36af` | `ec0dc471f4f5154c5ed7df86581e3ca23223e081d398f8dd8631f8bb185c36af` | **IDENTICAL** |

---

## 3. Independent Multi-Process Challenge of Both Historical S2D Exploits

### 3.1 Scenario A — Unwritable Shared Storage Root (`0o500`) (`PASS`)

#### A.1 Job Cancellation Under Exact S2D `0o500` Conditions (`CAMPAIGN_1_RESULTS.scenarioA1`)
1. **Process 1 (`PID 11365`)**:
   - Synthesized private TTS job `job_1793186463612_05f7ddc2f5d4` (`med_1793186463652_98ecabe3464eacf4`, pre-fault download `HTTP 200`, `98,934` `RIFF...WAVE` bytes).
   - Applied exact S2D permissions fault: `chmod 0o500` on `<storageRoot>/usr_alice_user` and `chmod 0o500` on `<storageRoot>`.
   - Triggered `POST /api/v1/jobs/job_1793186463612_05f7ddc2f5d4/cancel`:
     - **HTTP Status**: `503 Service Unavailable` (truthful; does **not** return `200 OK` with `cleanupFailed: true` because primary snapshot rename could not complete).
     - **Response Body**: `{"success":false,"error":"Job cancellation took effect in memory, but durable storage invalidation could not be persisted.","code":"STORAGE_UNAVAILABLE","cleanupFailed":true}`.
     - **Ledger Health Indicator**: `PrivateStorageService.isInvalidationLedgerHealthy() === false` (sticky; does **not** reset to `true` by re-reading the stale primary snapshot).
     - **Filesystem & WAL State**: `inPrimaryJson: false` (directory `0o500` blocked temp-file creation/rename), **`inWal: true` (`593` bytes)** — because `storeMedia()` pre-initialized `.invalidated_media.json.wal` (`0o600`) prior to storing the `.wav` file, `fs.openSync(walPath, 'a')` + `writeFileSync` + `fsyncSync` succeeded across directory `+x` traversal without modifying directory entries.
     - **Immediate In-Process Downloads (`PID 11365`)**: Signed URL -> `HTTP 503` (`0` WAV bytes; body `{"error":"Storage backend is currently unavailable","code":"STORAGE_UNAVAILABLE"}`); Owner Bearer download -> `HTTP 503` (`0` WAV bytes).
2. **Process 2 (`PID 11394` — Fresh OS Process While `0o500` Remains Active)**:
   - `healthyAtBoot: false` (`isLedgerLocationWritableSync` rejects `0o500` directory).
   - Replayed pre-invalidation signed URL -> `HTTP 503` (`0` WAV bytes); Owner Bearer download -> `HTTP 503` (`0` WAV bytes).
3. **Process 3 (`PID 11419` — Fresh OS Process After `chmod 0o700` Permission Restoration, Without Retrying `/cancel`)**:
   - `healthyAtBoot: true`; `ensureTombstonesLoaded()` replayed `.invalidated_media.json.wal`, compacted the entry into `.invalidated_media.json`, and truncated `.wal` (`walSizeAfter: 0`).
   - `reconcilePendingDeletions()` unlinked the orphaned `.wav` file (`{ attempted: 1, resolved: 1, stillFailing: 0 }`, `wavExists: false`).
   - Replayed original signed URL -> **`HTTP 403` (`0` WAV bytes; `MEDIA_ARTIFACT_INVALIDATED`)**; Owner Bearer download -> **`HTTP 403` (`0` WAV bytes)**.

#### A.2 Biometric Consent Revocation Under Exact S2D `0o500` Conditions (`CAMPAIGN_1_RESULTS.scenarioA2_consent`)
- **Process 1 (`PID 11444`)**: Enrolled cloned voice `voice_1793186467677_601ad963`, generated `med_1793186467709_c4c1b50d5eb50f90` (`69,768` bytes), applied `chmod 0o500` on tenant dir + storage root, called `POST /api/voices/clone/revoke-consent` -> **`HTTP 503`** (`{"success":false,"code":"STORAGE_UNAVAILABLE","cleanupFailed":true}`), emergency WAL recorded (`631` bytes), immediate signed URL -> `HTTP 503` (`0` WAV bytes).
- **Process 2 (`PID 11473`, after `chmod 0o700` restore + fresh OS restart)**: `reconcilePendingDeletions()` resolved `1/1`, original signed URL -> **`HTTP 403 CONSENT_REVOKED` (`0` WAV bytes)**.

#### A.3 Adversarial Escalation — Total Write Lockout (`0o500` Directories + `0o400` `.json` + `0o400` `.wal`, `walBytes = 0`) (`CAMPAIGN_1_RESULTS.scenarioA3_totalLockout`)
- Tested the physical limit where **neither** `.invalidated_media.json` **nor** `.invalidated_media.json.wal` can accept a single byte (`walSizeDuringTotalLockout: 0`):
  - **Process 1 (`PID 11498`)**: `POST /api/v1/jobs/:id/cancel` returned **`HTTP 503 { success: false, code: 'STORAGE_UNAVAILABLE', cleanupFailed: true }`** (explicitly informing the caller that durable storage invalidation **failed** to persist) and blocked downloads (`HTTP 503`, `0` WAV bytes).
  - **Process 2 (`PID 11527`, fresh OS process while locked)**: Blocked downloads (`HTTP 503`, `0` WAV bytes).
  - **In-Process Permission Repair**: `ensureTombstonesLoaded()` automatically flushes `unpersistedInvalidationsByPath` to `.invalidated_media.json` before serving any request (`HTTP 403`, `0` WAV bytes), and client retry of the failed `503` request returns `HTTP 200` (`403` across subsequent restarts).
  - **Physical Boundary Note**: Only if 100% of disk writes are rejected by the OS kernel (`503`, `success: false`), Process 1 terminates before repair, permissions are externally restored, and the caller never retries the failed `503` mutation does a fresh Process 3 (`PID 11552`) have zero on-disk record of that uncommitted `503` attempt (`200 OK`). Because Process 1 explicitly returned `503` (`success: false`), no false-durability promise occurs.

---

### 3.2 Scenario B — Missing Ledger (`ENOENT`) After Failed Physical Deletion (`PASS`)

- **Process 1 (`PID 11578`, `CAMPAIGN_1_RESULTS.scenarioB`)**:
  - Forced `provider.delete()` to return `false` (`wavStillOnDisk: true`, `109,878` bytes).
  - `POST /api/v1/jobs/:id/cancel` durably persisted the tombstone into `.invalidated_media.json` and returned `HTTP 200` (`{ success: true, cleanupFailed: true }`).
- **Process 2A (`PID 11607`, `.invalidated_media.json` deleted while `.wav` and `.wal` remain)**:
  - `healthyAtBoot: false` (`MEDIA_TOMBSTONE_LEDGER_MISSING_WITH_ARTIFACTS`).
  - Replayed pre-invalidation signed URL -> **`HTTP 503 STORAGE_UNAVAILABLE` (`0` WAV bytes)**; Owner Bearer download -> **`HTTP 503` (`0` WAV bytes)**.
- **Process 2B (`PID 11632`, BOTH `.invalidated_media.json` and `.invalidated_media.json.wal` deleted while `usr_alice_user/*.wav` remains)**:
  - `healthyAtBoot: false` (`directoryContainsNonTrivialEntriesSync` detects `usr_alice_user`).
  - Replayed pre-invalidation signed URL -> **`HTTP 503 STORAGE_UNAVAILABLE` (`0` WAV bytes)**.
- **Contextual Empty-Store `ENOENT` Control (`PID 11657`)**:
  - Fresh empty storage directory (`entriesBeforeStore: []`) reports `healthyBeforeStore: true`, distinguishing a verified empty store from a populated store missing its ledger.

---

## 4. Adversarial Evaluation of All 12 Challenged Failure Modes

| # | Challenged Failure Mode | How Challenged (Code + Multi-Process Harness) | Empirical Outcome | Verdict |
|---|---|---|---|---|
| **1** | WAL append partially succeeds or fails during write, flush, or `fsync` | Wrote truncated JSON line `{"v":1,"entry":{"id":"med_..."` to `.invalidated_media.json.wal` and booted fresh OS process (`PID 11730`); also inspected `appendEmergencyWalSync` (`privateStorage.ts:489-519`) + `persistTombstonesSync` (`819-858`). | `persistTombstonesSync()` unconditionally returns `false` and marks `tombstoneLedgerHealthy = false` whenever primary write fails (`503`). Truncated WAL at boot sets `healthy: false` (`MEDIA_TOMBSTONE_WAL_CORRUPTED`), returning `HTTP 503` (`0` WAV bytes). | **`PASS`** |
| **2** | Process termination between invalidation, WAL persistence, ledger compaction, and cleanup | Spawned child OS process (`PID 11755`) and delivered real `process.kill(process.pid, 'SIGKILL')` inside `provider.delete()` (after Step 1 snapshot write, before `.wav` unlink), then booted fresh OS process (`PID 11784`). | Restarted `PID 11784` loaded the Step 1 tombstone and denied the signed URL with **`HTTP 403 MEDIA_ARTIFACT_INVALIDATED` (`0` WAV bytes)**. *(See non-blocking hygiene note `S2F-OBS-02` regarding `cleanupFailed: false` on orphaned `.wav`.)* | **`PASS`** *(with `S2F-OBS-02`)* |
| **3** | Ledger compaction succeeds (`renameSync`) but WAL truncation or replacement fails | Injected `EIO` fault into `fs.ftruncateSync` inside `clearWalFileSync` (`PID 11809`) after `fs.renameSync(tmpPath, targetPath)` succeeded, plus appended untruncated duplicate WAL line and booted `PID 11838`. | `PID 11809` failed closed (`cancelStatus: 503`, `healthyAfterTruncFail: false`, `dlInP1Status: 503`, `0` WAV bytes). `PID 11838` idempotently merged `.json` + `.wal`, compacted & truncated `.wal` (`walSizeAfterBoot: 0`), and returned `HTTP 403` (`0` WAV bytes). | **`PASS`** |
| **4** | Ledger or WAL missing, corrupted, truncated, replaced with symlink, or changed between validation and use | Tested `0`-byte truncated `.json`, malformed JSON, symlink `.invalidated_media.json` -> valid file, symlink `.invalidated_media.json.wal` -> valid file, and runtime disk corruption (`mode4_and_mode6`), plus async `StorageProvider` race (`INFLIGHT_PROBE`). | All symlink (`ENOTREG` / `ENOTREG_WAL`), `0`-byte, corrupt, and missing-with-artifacts states returned **`HTTP 503` (`0` WAV bytes)** via `lstatSync`. Under `LocalStorageProvider`, `readFileSync` is synchronous after ledger validation; see `S2F-OBS-01` for custom async `StorageProvider.retrieve()` hardening. | **`PASS`** *(on `LocalStorageProvider`; see `S2F-OBS-01`)* |
| **5** | File or directory permissions change while requests are in flight | Tested `chmod 0o000` on `.wav`, `chmod 0o500` on `usr_alice_user/`, and `chmod 0o500` on `storageRoot` on live server (`PATH_LEAK_PROBE`, `mode10`). | `LocalStorageProvider` wraps `readFileSync`/`writeFileSync` errors in `StorageUnavailableError` (`HTTP 503`, `0` WAV bytes, `0` leaked paths). *(See `S2F-OBS-01` for async `StorageProvider` mid-retrieve `chmod`.)* | **`PASS`** *(on `LocalStorageProvider`; see `S2F-OBS-01`)* |
| **6** | Ledger-health check is cached and becomes stale before authorization | Overwrote `.invalidated_media.json` **in place (`r+`) with exact same byte length** immediately after a `200 OK` cached read (`mode4_and_mode6`), and toggled directory/WAL permissions without writes. | `computeLedgerDiskSignatureSync()` uses `fs.lstatSync(..., { bigint: true })` (`ino`, `size`, `mtimeNs`, `ctimeNs`) + `isLedgerLocationWritableSync()` on every check: same-size in-place corruption immediately returned **`HTTP 503` (`0` WAV bytes)**. | **`PASS`** |
| **7** | Concurrent invalidation operations update or compact the ledger | Fired 11 simultaneous invalidations (`POST /cancel`, `DELETE /api/v1/voices/:id`, `DELETE /api/voices/:id`) + concurrent downloads (`PID 11892`), then restarted in `PID 11921`. | All 11 mutations returned `200`, `0` tombstones were lost, and **all 12 invalidated signed URLs returned `HTTP 403` (`0` WAV bytes)** in `PID 11921` while the active control artifact returned `200 OK` (`66,102` WAV bytes). | **`PASS`** |
| **8** | Startup reconciliation fails or runs concurrently with incoming private-media requests | Tested `PID 11921` with `/readyz` + `60ms`-delayed `reconcilePendingDeletions()` running concurrently with 12 invalidated + 1 valid signed-URL requests; also tested startup under `0o500` & corrupted ledger. | `/readyz` returned `503` during reconciliation and `200` afterward; all 12 invalidated URLs hit during active startup reconciliation returned **`HTTP 403` (`0` WAV bytes)** because `ensureTombstonesLoaded()` executes synchronously on the first request. | **`PASS`** |
| **9** | Valid pre-invalidation signed URL is replayed after restart | Replayed pre-invalidation signed URLs in fresh OS processes across `POST /api/v1/jobs/:id/cancel`, `POST /api/voices/clone/revoke-consent`, `DELETE /api/voices/:id`, and `DELETE /api/v1/voices/:id`. | Every replayed pre-invalidation signed URL returned **`HTTP 403` (`0` WAV bytes)** (`MEDIA_ARTIFACT_INVALIDATED` or `CONSENT_REVOKED`). | **`PASS`** |
| **10** | Failed cleanup is retried after permission repair | Locked only `usr_alice_user/` (`0o500`) while `storageRoot` stayed `0o700` (`mode10_cleanupRetryAfterRepair`): cancelled job (`200`, `cleanupFailed: true`), repaired `0o700`, probed before & after `reconcilePendingDeletions()` and repeat `/cancel`. | While orphaned: `403` (`0` WAV bytes). Immediately after `chmod 0o700` before retry: `403` (`0` WAV bytes — zero access window). After reconcile + repeat cancel: `.wav` deleted (`wavExistsAfterReconcile: false`), `c2Status: 200`, `c2CleanupFailed: false`. | **`PASS`** |
| **11** | Corrupted or unavailable ledger is followed by a second invalidation request | Corrupted `.wal` (`PID 11730`) and `.json` (`S2E-05`), then issued a second `POST /api/v1/jobs/:j2/cancel`. | `checkDiskRecoverableAndMergeUnseenSync()` refused to overwrite corrupted/missing-with-artifacts ledgers: second cancel returned **`HTTP 503` (`success: false`)**, `healthyAfterSecondCancel: false`, and both `j1` and `j2` downloads returned `HTTP 503` (`0` WAV bytes). | **`PASS`** |
| **12** | Crash occurs after an API response is generated before state is durable | Instrumented `fs.renameSync` vs HTTP response receipt with `process.hrtime.bigint()` (`PID 11892`) and traced all 4 lifecycle handlers (`api.ts:1166-1231`, `1344-1425`, `3725-3780`). | `persistTombstonesSync()` (`writeFileSync` + `fsyncSync(fd)` + `renameSync` + `fsyncSync(dir)`) runs synchronously **before** `res.json(...)` (`durableBeforeResponse: true`). | **`PASS`** |

---

## 5. False-Success, Recovery, Scope-Isolation Audit & Non-Blocking Observations

### 5.1 Route-by-Route False-Success & Recovery Audit (`PASS`)
- **Audited Lifecycle Mutation Routes**:
  1. `POST /api/v1/jobs/:id/cancel` (`server/routes/api.ts:3695-3790`)
  2. `POST /api/voices/clone/revoke-consent` (`server/routes/api.ts:1098-1235`)
  3. `DELETE /api/voices/:id` (`server/routes/api.ts:1239-1325`)
  4. `DELETE /api/v1/voices/:id` (`server/routes/api.ts:1328-1445`)
- **Verified Properties (`CAMPAIGN_3_RESULTS`)**:
  - All four routes track pending media/voices across failed attempts (`pendingCancelledJobMedia`, `pendingRevokedVoiceMedia`, `pendingDeletedVoices`) so **repeated calls while storage remains unwritable continue returning `HTTP 503` (`rev1Status: 503`, `rev2StillFaultedStatus: 503`, `del1Status: 503`, `del2StillFaultedStatus: 503`)** rather than falsely returning `200 alreadyRevoked` or `404 Voice not found`.
  - Once permissions are repaired (`0o700`), idempotent repeat calls return **`HTTP 200` (`rev3RepairedStatus: 200`, `del3RepairedStatus: 200`)**, finalize durable tombstones + physical deletion (`cloneDlAfter: 403`, `legacyDlAfter: 403`), and leave unrelated active artifacts intact (`ctrlDlAfterStatus: 200`, `58,038` WAV bytes).
  - Scope isolation remains intact: anonymous sees public catalog (`true`) and zero private voices (`false`); cross-tenant Bob receives `403` on download, cancel, and delete of Alice's resources; expired (`-10s`) and HMAC-tampered signed URLs return `403`; error bodies leak zero WAV headers (`RIFF`), filesystem paths, or signing secrets.

### 5.2 Non-Blocking Defense-in-Depth Observations (Recorded for Future Hardening — Do Not Reopen `S2D-NEW-01`)
1. **`S2F-OBS-01` (P2/P3 Defense-in-Depth — Post-Await Re-Check for Future Non-Blocking `StorageProvider`s)**:
   - In `PrivateStorageService.getMedia()` (`server/storage/privateStorage.ts:1303-1323`) and `GET /api/v1/media/download/:id` (`server/routes/api.ts:1651-1655`), `assertInvalidationLedgerHealthy()` and `this.invalidatedMedia.get(mediaId)` are checked *before* `await this.provider.retrieve(meta.storageKey)` and not re-checked after `await` resolves. Under `LocalStorageProvider` (the only functional provider in the repo), `fs.readFileSync` is synchronous so no HTTP request can interleave. However, before introducing any genuinely asynchronous cloud `StorageProvider` (e.g., S3/GCS stream), `getMedia()` / `download` should re-verify `assertInvalidationLedgerHealthy()` and `!isMediaInvalidated(id)` immediately prior to `res.send(buffer)` (synthetic `40ms` slow-retrieve probe showed an in-flight download completing `35ms` after `POST /cancel` would otherwise still send its already-fetched buffer).
2. **`S2F-OBS-02` (P3 Storage-Hygiene — Pessimistic `cleanupFailed: true` Before `provider.delete()`)**:
   - In `PrivateStorageService.invalidateAndDeleteMedia()` (`server/storage/privateStorage.ts:1456, 1465`), Step 1 writes `cleanupFailed: false` to the ledger *before* `await this.provider.delete(meta.storageKey)`. As proven in `mode2_sigkillMidDelete` (`PID 11755 -> 11784`), if `SIGKILL` terminates the process mid-`provider.delete()`, **authorization remains 100% denied (`HTTP 403`, `0` WAV bytes)**, but `reconcilePendingDeletions()` reports `attempted: 0` and leaves the inaccessible `.wav` orphan on disk (`wavStillOnDisk: true`). Writing `cleanupFailed: true` in Step 1 and clearing it to `false` in Step 3 only after `!stillExists` would ensure crash-interrupted deletes are also garbage-collected at startup.
3. **`S2F-OBS-03` (P3 Fail-Closed UX Side-Effect — Polling Active Jobs During Transient Ledger Fault)**:
   - Because `PrivateStorageService.isMediaInvalidated()` (`privateStorage.ts:897-904`) returns `true` (fail-closed) when `tombstoneLedgerHealthy === false`, polling `GET /api/v1/tts/jobs` (`api.ts:1894-1898`) or `GET /api/v1/jobs/:id` (`api.ts:3682-3685`) during a transient `0o500` storage fault calls `scrubJobAudioArtifactsInMemory()`, permanently mutating an un-cancelled in-memory job's status to `'cancelled'` (fail-closed direction; leaks `0` bytes).

---

## 6. Independent Test, Build & Separate Blocker Execution Summary

| Command / Gate | Exit Code | Result |
|---|---|---|
| `./node_modules/.bin/tsx --test test/security/phase3c_s2e_restart_durability.test.ts` | `0` | **`8 / 8` passed** (`22.3s`) |
| `./node_modules/.bin/tsx --test test/security/phase3c_s1_auth_remediation.test.ts test/security/phase3c_s2a_remediation.test.ts test/security/phase3c_s2c_residual_remediation.test.ts` | `0` | **`32 / 32` passed** (`12` S1 + `12` S2A + `8` S2C) |
| `./node_modules/.bin/tsx --test test/security/*.test.ts` (all 7 security suites) | `0` | **`65 / 65` passed** (`0` failed) |
| `./node_modules/.bin/tsx --test --test-concurrency=1 <all 15 non-PG suites>` | `0` | **`123 / 123` passed** across 15 suites (`40.2s`) |
| `python3 services/omnivoice/tests/run_tests.py` | `0` | **`15 / 15` passed** (`0.345s`) |
| `npm run lint` (`tsc --noEmit`) | `0` | **`0` TypeScript errors** |
| `npm run build:server` (`esbuild server.ts ...`) | `0` | Built `dist-server/server.js` (`397.6 KB`, cleaned up) |
| `npm run build:client` *(separate frontend blocker)* | `1` | **`FAIL`**: Rolldown failed to resolve `"react-is"` from `recharts` (`dist/` cleaned up) |
| `./node_modules/.bin/tsx --test test/integration/postgres_persistence.test.ts` *(separate PG blocker)* | `1` | **`BLOCKED`**: `1 / 6` passed, `5 / 6` failed (`ECONNREFUSED` on `127.0.0.1:5433`) |

---

## 7. Remaining Release Blockers Before Overall Release `GO`

1. **`S2B-NEW-04 (Sub-Objective 4B)` — Live PostgreSQL Multi-Instance Verification (`BLOCKED`)**:
   - Provision reachable PostgreSQL at `127.0.0.1:5433` and verify `test/integration/postgres_persistence.test.ts` (`6/6`) plus multi-instance PostgreSQL-backed media invalidation durability.
2. **Frontend Production Build — `npm run build:client` (`FAIL`)**:
   - Authorize manifest/dependency remediation for the missing `"react-is"` package required by `recharts` so `vite build` exits `0`.
3. **Optional Non-Blocking Hardening (`S2F-OBS-01`..`03`)**:
   - If authorized in a future hardening pass (not required to close `S2D-NEW-01` on `LocalStorageProvider`), re-assert ledger health & invalidation status after `await this.provider.retrieve(...)` in `getMedia()`, initialize Step 1 tombstones with `cleanupFailed: true` prior to `provider.delete()`, and avoid mutating non-cancelled job status in memory when `isInvalidationLedgerHealthy() === false`.
