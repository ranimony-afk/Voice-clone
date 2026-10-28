# VoiceForge — Current Status and Production Readiness

**Audit date:** 2026-10-24  
**Repository:** `https://github.com/ranimony-afk/Voice-clone`  
**Audit scope:** existing checkout and dirty worktree; H9 artifact comparison; M2A-H10 security gates; current app, inference adapter, deployment/configuration, test, and license evidence.  
**Status:** evidence-based snapshot, not a production-readiness certification.

> **Executive conclusion:** VoiceForge is **NOT READY for production**. H9 preservation evidence verifies. H10’s API gates and the consent subject-binding contract now pass the audit’s regression checks, so the **post-fix H10 verdict is PASS WITH CONDITIONS**; cloning, consent, and custom-voice features must remain disabled until authenticated identity and durable owner-scoped storage exist. A client-side pseudo-model export still makes misleading biometric/compliance/offline claims. Public paid-inference/API abuse, absent user authentication and owner-scoped persistence, unverified weights licensing, absent genuine model execution evidence, and operational gaps remain blockers. The API currently fails closed for cloning and several simulated/media/billing routes; those restrictions are not an implemented ownership system.

## A. Verified repository identity and workspace state

| Item | Verified result |
|---|---|
| Workspace root | `/home/user/Voice-clone`; `.git` exists. |
| Branch/status | `arena/53108bcd-voice-clone` (Arena status: active). |
| HEAD | `73c9948049524274d9adac748605b558c8cd9a6f` (object present). |
| Remote | `origin` fetch/push URL `https://github.com/ranimony-afk/Voice-clone.git`. |
| Local remote-tracking refs | `origin/HEAD` and `origin/main` both resolve to `e13b0faeb57124900c07a84b9d39c6c1a6f31422` (object present). No fetch was performed. |
| Shallow/upstream | Shallow checkout; no configured upstream. Local object presence does not prove complete ancestry. |
| Worktree (final audit) | 19 modified tracked paths, 0 staged, 64 untracked paths. This includes earlier M0/M2A work and the new report; it was not created for this audit. |
| Ignored state | 18,455 ignored files, all under `node_modules`; no other ignored files found. `.env.example` exists, but no real `.env*` file was present. |
| Runtime-variable check | In the audit shell, `DATABASE_URL`, `OMNIVOICE_SERVICE_URL`, `VOICEFORGE_WORKER_API_KEY`, `VOICEFORGE_CONSENT_SECRET`, `VOICEFORGE_WATERMARK_KEY`, `GEMINI_API_KEY`, `NODE_ENV`, and `VOICEFORGE_API_HOST` were unset. This says nothing about any production environment; no production secrets were accessed. |
| H10 deliverable artifacts | No separate H10 snapshot/manifest/report existed on disk before this report. H10 was represented by the live workspace and previous conversation record. |

The final Git diff against HEAD includes 19 tracked paths. Its binary SHA-256 was `58e78ed2de26a1cd6bb1bf9ef9b4723ce8fda63db9d4b503e394dafd4f9719c5`; this cumulative diff is not synonymous with the H10 delta. Git diff does not include untracked files: the two consent source/test files and this report are untracked in the checkout, and were kept unstaged.

## B. H9 integrity and H10 security assessment

### H9 evidence

- H9 snapshot: `/home/user/voiceforge-m2a-h9-current-snapshot/`.
- Manifest SHA-256: `309b03d8c2b8f626b4cdf4dafb59f22cbf2c49eec616a015dbb20b9c9a6f4079`; `manifest.sha256` matches.
- Recomputed and verified all **82/82 payload files** and **4/4 evidence artifacts**, including size, SHA-256, and mode. No missing or invalid entries.
- Preserved H9 `tracked-worktree.diff`: 317,998 bytes; SHA-256 `0a57f2c1f11294303843aa48a1ce20a6d3a4fa88504385f8325fa287fd105016`, matching the manifest. The differing hash in the earlier H9 prose was a transcription error.
- Historical patch SHA-256: `bd662b7e9255906ebc08f6a261ec654d34880781b27f035f361d099075446955`.
- Historical archive SHA-256: `8f33310d9502532007fc369bdffbc962142a844af12ffc5508c11dee22ef312d`.
- The intended H10 delta from H9 is `server/routes/api.ts` and `test/api/routes.test.ts`. The later Stage 4 consent-binding fix adds `server/engine/audio/consent.ts` and `test/security/consent.test.ts`; final comparison therefore shows exactly those four payload paths different. No other payload or evidence file differs. The new readiness report is an additional untracked file not in the H9 payload.

### H10 protections verified in code and tests

- `server/routes/api.ts:21-26` defines `OWNER_SCOPED_STORAGE_UNAVAILABLE`; `:230` blocks all `/dictionary` routes before handlers; `:506` blocks voice deletion; `:1440` blocks voice design.
- `GET /voices` returns `DEFAULT_VOICES` only (`:191-194`). TTS looks up the requested ID only in `DEFAULT_VOICES` (`:309-323`); a non-built-in ID returns 503 rather than selecting a custom or fallback voice.
- Clone challenge/analyze/consent/revoke, sample upload, model export, and cross-lingual clone test paths are intercepted by the cloning-unavailable middleware (`:28-38`).
- Existing public `POST /db/migrate` returns `503 DATABASE_MIGRATION_DISABLED` (`:181-189`). Search found one `runMigrations` implementation in `server/db/migrate.ts`, with no alternate public migration route or invocation from server startup.
- Unverified media and billing routes return 503 by default in production (`:40-56`). The explicit simulation opt-in is limited to non-production. Billing remains process-memory simulation, not payment processing.
- The Node integration test `test/api/routes.test.ts` verifies built-in catalogue contents; dictionary GET/POST/import/delete denials; custom design/delete denials; TTS custom-ID denial; dictionary/catalogue/custom-voice state unchanged; and that denied voice deletion/revocation never invokes `ConsentVerificationEngine.revokeConsent`.
- Tests also verify cloning and cross-lingual routes return the cloning-unavailable response.

### H10 blocker reproduced and fixed

Before the Stage 4 fix, `server/engine/audio/consent.ts` verified the challenge HMAC over `challenge.userId` and `challenge.voiceName` but did not compare either to the verification request before creating the audit record. A local-only `npx tsx -e` reproduction used a deterministic test key and synthetic WAVs: a challenge signed for `subject_A` / `Voice A` returned `verified: true` for `subject_B` / `Voice B`, with the audit record attributed to `subject_B`. No network, production DB, or production secret was involved.

**Implemented fix:** immediately after constant-time HMAC verification, `verifyEnrollment` now requires exact canonical `userId` equality with the signed subject and a trimmed voice-name match. Mismatches return `CONSENT_SUBJECT_MISMATCH` before audio validation, nonce consumption, or audit creation. The signing payload, consent key, expiry/replay behavior, and provenance implementation were not changed. Regression tests reject a different subject, a noncanonical subject with trailing whitespace, and a different voice name; then verify that the matching subject can still use the same challenge successfully. The API gate test also proves denied voice deletion/revocation does not call `revokeConsent` or mutate the shared custom-voice state.

The Express cloning gate continues to prevent public requests from reaching this engine. The fix binds the verification request to the signed challenge; it does **not** establish the real-world identity of the caller or legal authority to consent. A future enabled route must derive the subject from an authenticated server-side principal, not trust caller-supplied `userId`.

### H10 verdict

**H10 VERIFICATION: PASS WITH CONDITIONS (post-fix).** The route-level gates and subject/name binding contract pass the audited tests, including no-mutation checks for denied deletion/revocation. Keep cloning, consent, upload, and custom-voice features disabled until authenticated identity and durable owner-scoped storage are implemented and independently tested. The client-side pseudo-model export remains a separate product/security blocker: it does not return server-held custom model data, but it bypasses the user-facing impression that export is disabled and creates misleading artifacts. Do not represent those artifacts as genuine weights, biometric proof, legal consent, compliance, or offline inference.

## C. Feature inventory

| Capability | Current evidence-based classification | Notes |
|---|---|---|
| React/Vite frontend | Implemented and builds; integration partially verified | Uses relative `/api/...` paths. Vercel rewrite requires `VOICEFORGE_API_HOST`; no deployment or live host verification. UI includes flows whose server APIs intentionally return 503. |
| Authentication/accounts | Not implemented | No Express session/JWT/OAuth/user-auth middleware found. Python uses one shared worker key for internal routes in production; that is not user authentication. Caller-supplied `userId` is not proof of identity. |
| Voice owner isolation | Disabled / not implemented | `customVoices`, consent records, and dictionary state include process-memory stores. DB schema has `user_id` columns but handlers do not authenticate or enforce ownership. |
| Built-in voices | Implemented catalogue | Public list exposes `DEFAULT_VOICES`; custom IDs are not accepted by TTS. No independent licensing audit of every voice asset was performed. |
| Voice design | Disabled by API gate; prior code is demo-style | H10 returns owner-scoped-storage 503. No persistent per-user profile creation exists. |
| Voice cloning/upload/export | Disabled at API gate; infrastructure partially scaffolded | Clone, upload, server export, revocation, and cross-lingual clone-test routes are gated. The Python adapter has real model prompt APIs but local-disk storage and no user-level authorization. |
| Client-side voice export | Mock/demo-only and misleading | `src/utils/voiceModelExport.ts` generates deterministic vectors from identifiers, not trained speaker weights; it emits hard-coded `biometricCompliance.verified`, EU AI Act, and offline-ready claims. The cloning UI directly invokes this utility for downloads, so the server export gate does not make the client artifact a genuine model. This requires UI/claims correction before launch. |
| Consent | Partial crypto scaffolding; subject/name binding fixed and regression-tested; not legal/identity proof | Separate `VOICEFORGE_CONSENT_SECRET`, HMAC-SHA256, constant-time signature compare, 5-minute expiry, nonce replay cache, and in-memory revocation exist. The fix rejects subject/name mismatch before audio processing or nonce use. Acoustic feature similarity is not validated speaker biometrics. Public cloning routes remain blocked. |
| Provenance/watermark | Implemented cryptographic metadata checks; partially verified | Separate `VOICEFORGE_WATERMARK_KEY`; fail-closed config; constant-time HMAC compare; current key ID only; retired IDs rejected; raw-string serialization and RIFF metadata contract covered by tests. This is signed metadata/content hashing, not proof of identity, ownership, legal consent, or a perceptual watermark/C2PA certification. `userId` is currently a static placeholder in the Node synthesizer. |
| Node TTS → OmniVoice | Implemented integration path, not operationally verified | Node validates worker response identity (`engine=omnivoice`, `engine_class=neural`) and does not silently substitute normal production output. `OMNIVOICE_SERVICE_URL` was unset in the audit shell. Explicit non-production formant fallback is labelled `DEV_ONLY` and `isNeural:false`. |
| OmniVoice model inference | Blocked/not tested with real weights | Adapter calls real `model.generate()` after lazy load. Python tests use fake model bundles; no weights, GPU, model-card license approval, or genuine audio run was verified. No large model weights were downloaded. |
| Cross-lingual synthesis | Not tested; clone-specific route disabled | Python model is designed for multilingual generation, but actual language quality was not measured. The current cross-lingual clone route is gated. |
| Pronunciation dictionary | Disabled | H10 blocks shared process-global GET/write/import/delete. There is no owner-scoped persistence route. |
| Database/persistence | Partial scaffold, not production persistence | Drizzle schema and optional Postgres connection exist; no audit DB URL was configured. Voice/dictionary/consent paths are not wired to durable owner-scoped storage. Job routes use DB where available and memory fallback elsewhere. Public migration is disabled; no operator migration workflow was validated. TLS verification uses `rejectUnauthorized:false` for non-local DB connections and requires review. |
| Billing/payments | Mock/demo-only and production-gated | Summary/credits/top-up are hard-coded in-memory and do not charge a payment processor or enforce balances. Production media/billing routes return 503. |
| Creative media | Mock/partial and production-gated | Image/video/music/transcription/translation/billing routes include mock/provider behavior; production middleware returns 503 unless code changes. No provider account, spending limits, or outputs were verified. |
| Paper2Audio | Partial/demo and unguarded from media gate | Parse/script may call Gemini if configured; audio uses the shared synthesizer with built-in personas. No authenticated request or rate limit was found. Cost/abuse protection is not established. |
| Live WebSocket | Demo/fallback path, not production-safe | `/live-ws` has no auth/origin check; without Gemini it returns locally generated harmonic PCM. With a key, it may open provider sessions. Neither genuine live inference nor fallback UX was E2E-tested. |
| Deployment | Configuration drafts only | Docker/Compose/Vercel files exist; no container build, external host, GPU, DB, object storage, backup, TLS, rollback, or deployment verification was performed. |

## D. Production-readiness assessment

`PASS` means the narrow property was verified in this workspace; it does not imply overall production readiness. `NOT TESTED` means no evidence was run or supplied. Recommendations are separated from observed facts.

| Area | Evidence inspected | Status | User/production impact | Required remediation and acceptance criteria |
|---|---|---|---|---|
| Authentication | `server.ts`, `server/routes/api.ts`, Python `internal_worker_auth`; source search | **FAIL** | Public API routes lack user identity. Shared worker secret only protects selected internal Python routes when `NODE_ENV=production`. | Select/approve an authentication design. Acceptance: server-established principal on every paid/private route; caller `userId` ignored as authority; negative unauthenticated tests for HTTP and WebSocket routes. |
| Authorization / owner isolation | H10 route gates; schema and in-memory handlers | **FAIL** | No durable proof that a voice, dictionary item, consent, or prompt belongs to caller. | Implement authorization only after identity exists. Acceptance: cross-user read/write/delete/export/revoke tests for every resource; DB queries constrain by server principal; no shared-memory user data. Keep H10 gates until then. |
| Consent | `consent.ts`, regression tests, initial direct mismatch reproduction | **PARTIAL** | Subject/name binding defect was fixed and regression-tested; caller identity and legal consent are still not established. Acoustic score is not legal consent or biometrics. | Before enabling, derive `userId` from an authenticated server-side principal, keep signed subject/name matching, add consent UX and human/legal review, and keep routes disabled until then. |
| Provenance | `watermark.ts`, security tests, synthesizer call site | **PARTIAL** | HMAC verifies integrity under a secret, not creator identity, legal ownership, or actual origin. Server signs placeholder user ID. | Bind provenance to authenticated principal and durable generation record; maintain versioned serialization and key rotation tests; document limitations; independent interoperability/format review. |
| Persistence | `server/db/index.ts`, schema, migration code, compose | **FAIL** | Voice/dictionary/consent data are process-local or local files; restart/scale loses state; no owner isolation. | Approve durable storage architecture. Acceptance: operator-only migration plan, DB integration tests, object-store encryption/ACL, retention/deletion/revocation, backup/restore evidence, owner-scoped queries. |
| Genuine model inference | Node synthesizer, Python manager/inference, tests, GPU CI workflow | **NOT TESTED / BLOCKED** | No actual weights/GPU/audio quality evidence; current local environment has no model URL or weights. | Verify model-card and dependency licenses before weights; run approved manual GPU CI and record actual model revision/device/audio and independent quality metrics. No fallback may be labelled neural. |
| API security | Express middleware, CORS/config, request handlers, Docker/Compose | **FAIL** | No auth/rate limiting; default CORS is `*` with credentials; global JSON/urlencoded limits are 50 MB; some paid inference paths are public; WebSocket lacks origin/auth controls. | Gate paid/provider routes and WebSocket until auth/quota design; exact CORS allowlist; route-specific streaming limits; request validation and abuse controls. Acceptance: unauthorized/cross-origin/oversized/rate-limit tests and no provider call on rejected requests. |
| Data protection | Local Python prompt store; H10 gates; DB schema | **PARTIAL** | Private audio/prompts and generated media do not yet use verified encrypted private object storage; local filesystem mode and retention were not validated. | Implement private object storage only after owner identity design; encryption in transit/at rest, least privilege, retention, secure deletion, consent withdrawal, and access audit tests. |
| Licensing | `MODEL_AND_MEDIA_LICENSES.md`, `THIRD_PARTY_INVENTORY.md`, model Dockerfile | **NOT TESTED / BLOCKED** | OmniVoice source license is documented, but model/tokenizer/ASR weight terms remain unverified in the repository’s own matrix. Commercial use cannot be assumed. | Obtain and archive model-card/license evidence for every weight/dataset/media source; legal review and redistribution notice. Acceptance: all weight terms verified and deployment image notice/attribution test passes. |
| Dependency security | `package-lock.json`, Python lock; `npm audit --audit-level=high` | **PARTIAL** | npm audit currently reports 0 vulnerabilities, but Python/GPU image dependency audits, transitive licenses, container scans, and ongoing monitoring were not run. | Add scheduled lock/container scans and Python/GPU dependency audit. Acceptance: CI blocks critical/high findings and creates an auditable exception process. |
| Configuration/startup | `server/config/env.ts`, `.env.example`, Dockerfiles | **PARTIAL** | Required auth, key, DB, worker, and inference settings are mostly optional; Node config has fallback defaults; `/readyz` does not represent engine readiness. | Validate production configuration deterministically and fail closed; report only variable state, not secret values. Tests cover missing/malformed production configuration. |
| Readiness/health | `server.ts` `/healthz`/`/readyz`; API `/health`; Python `/readyz` | **FAIL** | API health says `healthy` and advertises `gpuTargetRtf:0.25`; Node `/readyz` always returns ready. Python `/readyz` returns `ready:true` when model is unavailable. Model manager does not expose loading state. | Separate process liveness, API readiness, model state and inference readiness. Acceptance: absent/loading/loaded/failed states correctly reported; fallback is explicitly non-neural; no 2xx field implies model ready without a loaded-model proof. |
| Billing/quotas | Billing route and media gates; synthesis response | **FAIL** | TTS reports `creditsCharged` but does not debit a durable balance; no payment provider or per-user quotas. Public calls could consume GPU/provider budget. | Integrate approved payment/quota design behind authenticated principal; reject before inference on exhausted quota; ledger is durable and idempotent. |
| Rate limiting | Source/package search | **FAIL** | No API rate-limit middleware or provider concurrency/spend control at Node layer. Python has an inference semaphore, not per-user quotas. | Add layered per-principal, per-route, and provider quotas after auth. Acceptance: deterministic 429/quota tests and bounded concurrent/cost behavior. |
| Error handling | Express handlers, Python handlers | **PARTIAL** | Mixed error schemas; some handlers return raw `err.message`; no request-correlated production error policy across services. | Standardize safe error codes, request IDs, redaction and client-visible messages; test against secret/path leakage. |
| Observability | Server/Python logging; request ID middleware | **PARTIAL** | Logs exist, but metrics, tracing, alerts, model-load telemetry, audit review and retention were not verified. | Add structured metrics/traces and alerts for model failure, abuse, latency, cost, DB and queue health; acceptance via staging alert test. |
| Backups/recovery | Compose local volumes; docs | **NOT TESTED** | No production DB/object-store backup, restore, RPO/RTO or disaster drill evidence. | Define encrypted backups and retention. Acceptance: documented restore drill meeting approved RPO/RTO with integrity checks. |
| CI | `.github/workflows/ci.yml`; local checks | **PARTIAL** | Workflow covers Node and CPU-mocked adapter; real GPU job is manual and gated by external approval. GitHub CI for this exact dirty state was not run. | Run CI on reviewable commit; keep GPU job manual until licensing approval; attach all check results. |
| End-to-end | `scripts/e2e_smoke.sh`, tests | **NOT TESTED** | No browser, deployed API, real worker, DB, WebSocket, payment or model end-to-end run. | Build browser/API/worker staging smoke with synthetic data and approved test keys; no production credentials. Acceptance: repeatable CI smoke and failure-mode coverage. |
| Deployment/operations | Dockerfile, Compose, Vercel config, docs | **NOT TESTED** | No actual host, TLS, firewall, private worker network, CORS, rollback, scaling, or operational runbook verification. | Stage deployment review after auth, license, model, DB/object store approvals; prove rollback and recovery before launch. |

### Separate real inference and fallback states

- **Process liveness:** Node `/healthz` and Python `/healthz` return 200 when their processes answer.
- **API readiness:** Node `/readyz` is currently unconditional and does not test dependencies.
- **Model state:** Python `ModelManager.status()` reports loaded/not-loaded booleans and an error, but not an explicit `loading` state.
- **Genuine inference:** Python `/v1/tts` calls `model.generate()` only after `ensure_loaded()`; absent dependencies/weights return structured 503. Tests inject fake model objects; no genuine inference result was produced.
- **Node fallback:** deterministic harmonic/formant synthesis is permitted only by explicit non-production `VOICEFORGE_ALLOW_DEV_STUB_ENGINE=true`, returns `DEV_ONLY:development_formant` and `isNeural:false`. It is not neural speech.
- **Misleading readiness:** Node `/api/health` and `/readyz`, and Python `/readyz`, need explicit process-vs-model/inference semantics. A configured URL alone must not count as a loaded model.

## E. Prioritized gap register

### P0 — must resolve before any production exposure

| Gap | Dependency | Measurable completion criteria |
|---|---|---|
| Consent workflow remains unavailable for production use (subject/name binding fix implemented; identity/legal consent still unproven) | No further code dependency for binding; authenticated identity and legal consent UX/review required before enabling | Regression test rejects owner/name mismatch before consuming nonce or creating an audit record; matching request still passes; route-level deletion/revoke tests show no consent mutation. Before enabling, derive subject from authenticated principal and complete legal consent/identity review; keep routes disabled until then. |
| No user authentication/authorization and no durable owner isolation | Architecture/identity approval | Authenticated server principal; no caller-supplied IDs as authority; cross-user CRUD/export/revoke tests; durable owner predicates; object access isolated. Keep sensitive endpoints at 503 until done. |
| Unauthenticated paid inference surfaces | Auth, quota, and spending policy | `/api/tts/synthesize`, Paper2Audio provider routes, and `/live-ws` reject unauthorized callers before provider/worker invocation; tests assert zero provider calls on denial and quotas bound allowed calls. |
| Client-generated pseudo-model export with false biometric/compliance claims | Product/legal decision and genuine model format | No artifact claims verified biometric, legal compliance, or offline inference unless backed by actual measured data and a real compatible runtime. Disable or relabel/remove export until then. |
| Weights/license and genuine inference unverified | Model/provider legal approval, GPU and HF access | Capture every model/tokenizer/ASR license; approved GPU smoke returns validated WAV from exact pinned model revision; no fallback passes as neural. |

### P1 — required before launch

| Gap | Dependency | Measurable completion criteria |
|---|---|---|
| Durable voice/consent/dictionary/media persistence and revocation | Approved DB and private object-store architecture | Migration review/approval; integration tests on disposable DB; owner-scoped records and encrypted private media; deletion/revocation propagation and restore tested. |
| TTS billing, rate limits, quotas and abuse controls | Auth and payment provider selection | Per-principal authorization, atomic durable usage ledger, idempotent billing, rate-limit tests, provider-cost ceiling and denial tests. |
| Correct health/readiness and startup validation | Model status contract | Explicit `not_loaded/loading/loaded/failed`; separate API and inference readiness; no inference-ready response without loaded-model proof; production config missing-key tests. |
| Secure production API/WS perimeter | Deployment/reverse-proxy decisions | Exact CORS allowlist; no public worker access; WebSocket auth/origin checks; bounded request sizes; TLS and rate-limit tests. |
| Operator migration/recovery procedure | DB owner/operator approval | Authenticated operator-only migration procedure, backup before migration, rollback plan and tested restore. Public route remains disabled. |
| Client claims and export truthfulness | Product/legal approval | UI cannot claim biometric proof, compliance or model-ready exports without evidence; API and client state agree on disabled capabilities. |

### P2 — hardening and operational maturity

| Gap | Dependency | Measurable completion criteria |
|---|---|---|
| Python/GPU/container dependency and license scanning | CI/security-tool choice | Scheduled SBOM/CVE/license checks; high/critical failures block release or have documented expiry-bound exceptions. |
| Structured observability and incident response | Hosting/monitoring selection | Metrics/traces, secret-redacted logs, provider cost/latency alerts, documented on-call and incident runbook. |
| Backup/restore and disaster recovery | Storage providers and RPO/RTO decision | Encrypted scheduled backups and a successful timed restore drill with integrity checks. |
| E2E/browser and deployment tests | Staging environment, no production secrets | Automated smoke tests for login/ownership, failures, TTS readiness, WebSocket, billing gates, and rollback. |
| Frontend bundle and stale documentation cleanup | Product prioritization | Chunk warning addressed; route and feature claims match actual gated behavior; tests verify copy does not overclaim. |

## F. Validation record — initial audit and post-fix

Stage 1 and Stage 2 were read-only. Stage 4 changed only the consent engine and its consent/API regression tests; no Python, dependency, deployment, or production configuration source was changed.

| Command/check | Exit/result |
|---|---|
| `npm run lint` (post-fix) | 0; TypeScript check passed. |
| `npm test` (post-fix) | 0; **49 passed, 0 failed**. |
| `npx tsx --test test/api/routes.test.ts test/api/db-migration.test.ts test/security/consent.test.ts test/security/watermark.test.ts` (post-fix) | 0; **31 passed, 0 failed**. |
| Vite client production build to external `/tmp` directory (post-fix) | 0; succeeded; emitted 960.77 kB JS chunk (261.72 kB gzip) and existing >500 kB warning. |
| esbuild server bundle to external `/tmp` directory (post-fix) | 0; succeeded; bundle 241.8 kB. |
| `cd services/omnivoice && <isolated-temp-venv>/bin/python -m pytest tests -q` | 0; **19 passed** in Stage 2. Python source was unchanged afterward; no model weights downloaded. |
| Python `compileall` with `PYTHONPYCACHEPREFIX` under `/tmp` | 0; service/test source compiled in Stage 2. |
| `npm audit --audit-level=high --json` | 0; 0 reported vulnerabilities in Stage 2. No dependencies changed afterward. Python/GPU image dependency audit not performed. |
| `git diff --check` | 2; the same seven diagnostics remain across five previously dirty tracked files (`server.ts`, `server/routes/api.ts`, `src/components/Header.tsx`, `src/components/PhoneticLabView.tsx`, `src/components/VoiceCloningLabView.tsx`). No diagnostics in the four H9-compared source/test paths (`git diff --no-index --check`). No unrelated whitespace was edited. |
| H9 manifest/evidence re-verification | All 82 payloads and 4 evidence artifacts pass size/hash/mode checks; exact final H9 payload delta is the four named H10/fix paths in section B. |
| Direct consent mismatch reproduction + regression | Initial unsafe `verified:true` mismatch reproduced before the fix; post-fix direct regression rejects owner, noncanonical-owner, and name mismatches, while the matching request succeeds with the same nonce. |
| GitHub CI / GPU inference / browser E2E / deployment | Not run. |

**No production database, secrets, external inference, GPU/model weights, payment account, or deployment was accessed.** Report creation and passing unit/build checks do not establish production readiness.

## G. GitHub, PR, CI and final verdicts

Read-only GitHub inspection was performed after the implementation and test run:

- `gh auth status`: GitHub authentication is active for `ranimony-afk`; no credential values are included here.
- `git ls-remote --heads origin ...`: remote `main` exists at `e13b0faeb57124900c07a84b9d39c6c1a6f31422`; no remote `arena/53108bcd-voice-clone` branch exists.
- `gh pr list --state all --head arena/53108bcd-voice-clone`: no PR exists for this branch.
- `gh run list --branch arena/53108bcd-voice-clone`: no workflow runs were returned for this branch.
- GitHub compare `main...73c9948049524274d9adac748605b558c8cd9a6f`: status `behind`, 0 commits ahead, 2 behind, 0 changed committed files.
- The checkout has no upstream tracking branch. No `fetch`, staging, commit, push, merge, or PR creation was performed.

**PR decision: NOT CREATED — unsafe to prepare from this checkout.** The branch has no remote head and is two commits behind remote `main`; the intended H10/Stage 4 implementation remains mixed into a dirty worktree containing 19 modified tracked paths and 64 untracked paths, including substantial earlier M0/M2A material. The key consent engine/test files are untracked in Git. Safely isolating an exact reviewed commit would require determining the intended historical base and separating pre-existing work; doing so would risk staging or publishing unrelated user changes. No branch update/rebase or history rewrite was attempted. Preserve the workspace for explicit follow-up review.

### Distinct verdicts

| Deliverable / gate | Verdict | Basis |
|---|---|---|
| H9 historical evidence | **PASS** | 82 payloads and 4 evidence artifacts verified against manifest hashes, sizes and modes. |
| H10 controls (post-fix) | **PASS WITH CONDITIONS** | API gates and consent subject/name binding tests pass; cloning and custom-owner functionality remain disabled pending identity and owner-scoped persistence. Client pseudo-export remains a separate blocker. |
| Status/readiness report | **COMPLETE** | This report records scope, evidence, limitations, exact validation, priorities, and PR/CI safety. |
| Implementation increment | **PASS — local validation only** | Consent subject/name mismatch fix and no-mutation regression tests; 49/49 full Node tests, 31/31 focused tests, TypeScript check and external-temp client/server builds passed. No commit was created. |
| PR / CI | **NOT CREATED / NOT RUN** | No safe isolated commit or remote branch; no CI run exists for this checkout. |
| Production readiness | **NOT READY — BLOCKED** | Authentication/authorization, durable owner-scoped storage, public paid-service abuse protection, truthful export claims, real licensed inference evidence, and operational controls remain open. |

No release, deployment, or production-readiness claim is authorized by this audit.

## H. P0 security verification and readiness continuation — 2026-10-24

This is a dated continuation of the preceding audit, not a replacement. Prior evidence and earlier snapshot verdicts above are preserved; the current status and newly run checks are recorded here.

### Repository and H9 state before/after this continuation

- Work remained on `arena/53108bcd-voice-clone`, HEAD `73c9948049524274d9adac748605b558c8cd9a6f`; checkout is shallow with no upstream. No branch switch, fetch, stage, commit, push, merge, or deploy occurred.
- Before these edits, status showed 19 modified tracked paths, 0 staged, and 64 untracked paths. At final review: **19 modified tracked paths, 0 staged, 68 untracked paths**. This is the pre-existing dirty workspace plus four new source/test paths; all unrelated edits remain untouched.
- Final tracked-diff SHA-256: `786f37b7b6ebb8ffb992a76023a8978e5603f7651a8dadae8b3e06bd8a84dcfd`. Git diff does not include untracked paths.
- Rechecked the H9 manifest and all 82 payloads / 4 evidence artifacts: no invalid artifacts; manifest SHA-256 remains `309b03d8c2b8f626b4cdf4dafb59f22cbf2c49eec616a015dbb20b9c9a6f4079`. The H9 snapshot itself was not modified. Current live files that differ among H9 payloads are `server.ts`, `server/engine/audio/consent.ts`, `server/routes/api.ts`, `services/omnivoice/app/main.py`, `services/omnivoice/app/model_manager.py`, `services/omnivoice/app/schemas.py`, `services/omnivoice/tests/test_service.py`, `test/api/routes.test.ts`, and `test/security/consent.test.ts`. Four additional new paths are outside the H9 payload: the cost-policy/readiness modules and their tests.

### Consent fix and revocation isolation

**Consent fix: VERIFIED.** The current `verifyEnrollment` verifies the challenge HMAC first using the existing constant-time comparison; then trims the request subject/name and signed subject/name and compares the canonical values. A mismatch returns `CONSENT_SUBJECT_MISMATCH` before audio decoding/quality work, nonce consumption, or audit creation. Audit creation uses the normalized subject. Challenge serialization, HMAC payload construction, `VOICEFORGE_CONSENT_SECRET`, TTL, replay-cache semantics, and the provenance key/contract were not changed. HMAC remains neither identity proof nor legal consent.

Regression coverage now proves that an unrelated subject and unrelated voice name fail with no `voiceId` or audit record, and that a matching request with surrounding whitespace can still complete using the same challenge/nonce and creates a record for the canonical subject. Signed challenge `userId`/`voiceName` field tampering is rejected as `CHALLENGE_TAMPERED`. Existing signature-malformation, expiry, replay, identical-audio replay, enrollment/audit, and owner revocation tests still pass.

**API revocation isolation: VERIFIED (current routes fail closed).** `DELETE /voices/:id` returns the owner-scoped-storage 503. Clone/consent revoke is intercepted by the clone-unavailable middleware before the handler. Integration tests assert the HTTP responses, spy that `revokeConsent` is never invoked, and compare the shared voice/dictionary state before and after. The direct engine test additionally proves another owner and the literal string `admin` cannot revoke a real owner’s record, the record stays active and unchanged, and the actual owner can revoke. The handler was hardened so it only removes a catalogue voice after revocation succeeds. This does not make `userId` trustworthy: the API remains disabled until a future route derives it from an authenticated server principal.

### Paid-service exposure review

**Paid-service exposure: CONTROLLED at the Node API boundary; deployment/network isolation NOT VERIFIED.** No payment provider or billing behavior was added.

| Route/surface | Current gate and status | Remaining caveat |
|---|---|---|
| `POST /api/tts/synthesize` | 503 `PAID_FEATURE_DISABLED` unless explicitly using the non-production local formant stub with no configured OmniVoice URL. A configured remote worker cannot be reached through the route even with the stub flag. | Local formant output is not neural. The explicit dev mode is unmetered CPU work and must not be exposed as a public service. |
| `POST /api/speech-to-speech` | Always 503 before synthesis. | No auth, quota or rate limiter exists for a future enablement. |
| `POST /api/paper2audio/{parse,script,synthesize}` | Always 503 before Gemini or synthesis handlers. Static `GET /catalog` is local data. | No auth or provider-spend controls exist. |
| Gemini media APIs (`music`, `images`, `videos`, `media`, `transcribe`, `translate`, dubbing, etc.) | Existing 503 gate remains. The simulated-preview flag now works only outside production when neither Gemini credentials nor a remote OmniVoice service is configured; tests verify configured providers cannot pass through it. | Local simulated routes remain unauthenticated/unmetered when deliberately enabled in non-production; do not expose that mode. |
| `/live-ws` | HTTP 503 before WebSocket upgrade in production or whenever a real Gemini key is present. Policy and 503 response formatting are unit-tested. | In non-production with no real Gemini key, only the harmonic PCM fallback is allowed; it is unauthenticated and unmetered CPU work, not neural speech. |
| Python `/v1/tts`, `/v1/model/warmup`, `/v1/clone/*` | Production middleware requires `VOICEFORGE_WORKER_API_KEY`; Compose exposes worker port 8100 only on its internal network and requires the key. | This is one service-to-service shared key, not user auth or per-user quotas. No deployed network boundary was tested; direct worker exposure must remain private. |
| Billing, image/video/media mock paths | Existing default 503 gates remain; no payment processor or durable credit enforcement exists. | Do not interpret mock credits as billing or quotas. |

The source route inventory found no other public Node route that invokes paid inference outside these gates. The API has no per-user rate limiting, durable quota, or credit enforcement; these remain mandatory before enabling any cost-bearing route. No external API, inference worker, payment account, or production service was called during validation.

### Readiness semantics and genuine-inference status

**Neural readiness reporting: FIXED AND TESTED.**

- Node `/healthz` is liveness only (`process_live`, `alive`). Node `/readyz` and `/api/health` report API readiness separately from worker reachability, worker dependency status, model state, neural inference readiness, and the optional local fallback. A configured `OMNIVOICE_SERVICE_URL` alone is insufficient: Node probes only the worker’s non-generative `/readyz`, accepts readiness only for an explicit HTTP-success `model_state=loaded` plus `neural_inference_ready=true`, and bounds the request to 1.5 seconds. Raw network errors, worker URL, and credentials are not returned.
- OmniVoice `ModelManager` now reports `not_loaded`, `loading`, `loaded`, or `failed`; dependency readiness is unknown before a load result, true after load, and false after failure. Loading state is observed under the existing synchronization lock; reset uses the same load lock.
- OmniVoice `/readyz` means neural-worker readiness: it returns 503 while not loaded, loading, or failed, while still saying the process is live and audio-analysis endpoints are available. It returns 200 only after the model bundle is loaded. `/healthz` remains process liveness. Python has no fallback synthesis.
- Node’s only permitted TTS fallback is the explicit, non-production local formant mode with no remote worker URL; status labels it `development_formant` and `fallback_is_neural=false`. The WebSocket’s development harmonic response is also non-neural.
- Tests cover worker absent, unreachable, generic/unknown, not-loaded, loading, loaded, and failed states; Python tests exercise loading concurrently, failure, not-loaded readiness 503, loaded readiness 200, and failure readiness 503.
- **No real weights or genuine inference were exercised.** “Loaded” is a runtime model-bundle state, not evidence of production audio quality or a successful GPU smoke test. Model/tokenizer/ASR licensing and production hardware remain unverified.

### Authentication, authorization, and persistence actually present

- No user authentication provider, login/session, JWT, OAuth, or per-user authorization middleware was found. `server/config/env.ts` validates configuration only; it does not establish identity.
- Python’s `x-worker-api-key` is a shared internal service credential for selected inference/prompt endpoints in production. It does not establish an end-user identity or owner. No caller-supplied `userId` is accepted as proof.
- Node request handlers still contain placeholder/default IDs such as `user_active` and read IDs from request bodies in the disabled clone/revoke code. The global clone gate and owner-scoped-storage gate keep those handlers unavailable. Dictionaries and custom-voice design/delete remain fail-closed.
- Drizzle/PostgreSQL schema and a `DATABASE_URL` connection scaffold exist, but there is no implemented user authentication flow or demonstrated owner-constrained voice/dictionary/consent repository. Current custom voices, dictionaries and consent audit/nonces include process-memory storage. OmniVoice prompts use a local filesystem `PromptStore` without owner metadata. MinIO appears in Compose scaffolding but is not wired to the voice/prompt routes; no object-store ACL/encryption tests were run.
- No provider or schema was invented. Before enabling a feature, a future approved design must authenticate at the server boundary and derive the principal only from verified credentials; ignore request-body `userId` for authority; constrain every read/write/delete/export/revoke by that principal; store private audio/prompts in durable private storage with retention/deletion controls; and test cross-user denial for each operation. Keep all current custom-voice and dictionary gates until those controls exist.

### Updated remediation register

#### P0 — do not expose production routes until resolved

1. **Identity and owner isolation:** choose and approve an authentication provider/trust boundary; implement server-established principals and cross-user tests for voices, dictionaries, consent, revocation, uploads, and exports. Do not trust `userId` from clients.
2. **Durable private persistence:** select/approve a DB and private object-storage design, migrations, encryption, retention, and deletion; demonstrate owner-scoped queries and restore. Keep routes at 503 until proven.
3. **Cost control before re-enabling inference:** paid routes are now gated, but authentication, quotas/rate limits, provider spend ceilings, and concurrency controls do not exist. Keep TTS, Paper2Audio, speech-to-speech, Gemini provider routes, and paid live sessions disabled until those are implemented and tested. Decide product/quota policy; no payment system was assumed.
4. **Truthful export claims:** client-side `voiceModelExport.ts` still emits fabricated embeddings and biometric/consent/compliance/offline claims. Disable or truthfully relabel/remove the pseudo-export before presenting it as a model; legal/product approval is required.
5. **Weights and genuine inference:** verify every model/tokenizer/ASR license before downloading weights. After approval, run a pinned-revision GPU smoke and record real audio/quality evidence. No real inference is currently verified.

#### P1 — required before launch

- Use the readiness probe states in deployment monitoring, define which API dependencies are required, and exercise absent/loading/loaded/failed and worker-unreachable alarms in staging.
- Verify worker private-network reachability, production shared-key rotation, TLS, CORS allowlists, WebSocket origin/auth policy, request/body limits, and no direct worker exposure.
- Implement an operator-only migration procedure, encrypted backups, tested restore, retention/deletion and revocation propagation.
- Add durable idempotent quota accounting and layered rate limits before lifting paid-route gates.
- Add end-to-end browser/API/worker/database tests with synthetic inputs and approved keys; test no provider call on denied requests.

#### P2 — operational hardening

- Add Python/GPU/container CVE, SBOM and license scans; scheduled dependency monitoring.
- Add metrics/tracing and alerts for load state, inference failures, spend, latency, abuse, DB and storage health.
- Document incident response, on-call, RPO/RTO, rollback and recovery drills.
- Address the existing Vite >500 kB chunk warning and remove stale UI claims once product decisions are made.

### Exact files changed in this continuation

- `server/engine/audio/consent.ts`
- `test/security/consent.test.ts`
- `server/routes/api.ts`
- `test/api/routes.test.ts`
- `server/security/costPolicy.ts` (new)
- `test/security/costPolicy.test.ts` (new)
- `server.ts`
- `server/engine/audio/readiness.ts` (new)
- `test/security/readiness.test.ts` (new)
- `services/omnivoice/app/model_manager.py`
- `services/omnivoice/app/main.py`
- `services/omnivoice/app/schemas.py`
- `services/omnivoice/tests/test_service.py`
- This report, appended after its contents were inspected.

### Validation and remaining verification limits

| Command/check | Result |
|---|---|
| `npx tsx --test test/api/routes.test.ts test/api/db-migration.test.ts test/security/consent.test.ts test/security/watermark.test.ts test/security/costPolicy.test.ts test/security/readiness.test.ts` | Exit 0; **41 passed, 0 failed**. |
| `npm test` | Exit 0; **59 passed, 0 failed**. |
| `npm run lint` | Exit 0. |
| `npx tsc --noEmit` | Exit 0. |
| Vite client build to external `/tmp` directory | Exit 0; built successfully; 960.77 kB JS (261.72 kB gzip); >500 kB chunk warning remains. |
| `npx esbuild server.ts --bundle --platform=node --target=node22 --format=esm --packages=external --outfile=<external-temp-path>` | Exit 0; server bundle 246.5 kB. |
| `cd services/omnivoice && PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider' /tmp/voiceforge-p0-python.fZw55o/bin/python -m pytest tests -q` | Exit 0; **21 passed**. |
| `PYTHONPYCACHEPREFIX=/tmp/voiceforge-p0-python.fZw55o/pycache /tmp/voiceforge-p0-python.fZw55o/bin/python -m compileall -q app tests` (from `services/omnivoice`) | Exit 0. |
| `git diff --check` | Exit 2; the same seven pre-existing blank-line/trailing-whitespace diagnostics in `server.ts`, `server/routes/api.ts`, `src/components/Header.tsx`, `src/components/PhoneticLabView.tsx`, and `src/components/VoiceCloningLabView.tsx`. No diagnostic in changed/new source/test paths; these legacy whitespace lines were not edited. |
| New report content whitespace check | Original untracked report preamble lines 3–5 contain three Markdown hard-break trailing spaces; preserved unchanged. The appended H section was independently checked and has no whitespace diagnostics. |
| GPU inference, real weights, deployment, external provider calls, production DB/secrets, payment integration, CI and browser E2E | Not run; no weights or production resources were accessed. |

### Current required verdicts

| Gate | Verdict | Reason |
|---|---|---|
| Consent fix | **VERIFIED** | Canonical subject/name checks occur after HMAC authentication and before audio/nonce/audit work; mismatch and same-challenge recovery tests pass; signing/key contract preserved. |
| API revocation isolation | **VERIFIED** | HTTP gates deny before handler; no revocation call or shared-state mutation; direct cross-owner and admin-label attempts leave the owner’s consent active. |
| Paid-service exposure | **CONTROLLED** | Public paid HTTP routes are fail-closed; paid live WebSocket sessions are denied; provider-enabled preview flags cannot bypass gates. Deployment/network isolation and user quotas remain unverified. |
| Neural readiness reporting | **FIXED AND TESTED** | Process/API/worker dependency/model/fallback states are distinct; neural readiness requires worker’s explicit loaded response. Real model inference itself is not verified. |
| Status report | **UPDATED** | This continuation preserves prior evidence and appends current findings and validation. |
| PR | **NOT SAFE FROM CURRENT BRANCH** | No remote branch or PR; local HEAD is 0 ahead / 2 behind remote `main`, no upstream, 19 modified tracked and 68 untracked paths. GH auth is active, but no CI run exists. Safely isolating this increment would risk publishing pre-existing unrelated work. No stage, commit, push, rebase, merge, or PR action occurred. |
| Production readiness | **NOT READY** | Authentication, owner isolation, durable persistence, licensing, genuine inference, quotas/rate limits, operational recovery, and critical end-to-end/deployment evidence remain outstanding. |

No release, merge, deployment, or production-readiness claim is authorized.

## I. Independent provider-path audit and acceptance gate — 2026-10-24

This section records a fresh inspection of the actual files and a new validation run in response to the review concern about alternate provider paths. It supersedes the simulated-preview allowance described in Section H; all preceding evidence remains preserved as historical evidence.

Final repository identity after this continuation: branch `arena/53108bcd-voice-clone`, HEAD `73c9948049524274d9adac748605b558c8cd9a6f`, no upstream; 19 modified tracked paths, 0 staged, 70 untracked; tracked-diff SHA-256 `fe1ab9c639a1b83419eb60e72c4d6bc2f1471bb51a6774d06d592a928a240d9b`. The H9 manifest and all 82 payloads / 4 evidence artifacts revalidate with no corruption (manifest SHA-256 `309b03d8c2b8f626b4cdf4dafb59f22cbf2c49eec616a015dbb20b9c9a6f4079`). Current live H9-payload differences are `.env.example`, `FEATURE_MATRIX.md`, `docs/RELEASE_READINESS.md`, `server.ts`, `server/engine/audio/consent.ts`, `server/routes/api.ts`, `services/omnivoice/app/main.py`, `services/omnivoice/app/model_manager.py`, `services/omnivoice/app/schemas.py`, `services/omnivoice/tests/test_service.py`, `test/api/routes.test.ts`, and `test/security/consent.test.ts`. The snapshot/evidence files were not modified. Six new security-policy/readiness/WebSocket implementation and test paths are outside the H9 payload (`server/security/costPolicy.ts`, `server/engine/audio/readiness.ts`, and their two tests, plus `server/security/liveWebSocketUpgrade.ts` and `test/security/liveWebSocket.test.ts`); they remain untracked along with the pre-existing worktree artifacts.

### Material correction from route tracing

The previous report’s conclusion that the explicit simulated-media flag was safe when no key/worker was configured was not sufficiently evidenced. Direct source tracing found that the router middleware allowed that flag to `next()`, while several media handlers called the Gemini SDK first and returned deterministic/mock fallback content only after an SDK error. Thus a “simulated” response did not establish a provider-free request; the SDK path could still attempt an outbound call. No paid credential was available or used in this audit, and no production provider was contacted.

**Fail-closed correction:** all creative-media, transcription/translation, dubbing, sound-effects/isolation, video-operation, and billing routes now return 503 unconditionally until a genuinely local implementation is separated and tested. `VOICEFORGE_ALLOW_SIMULATED_MEDIA` is deprecated/ignored in the sample environment. Tests deliberately set it to `true` and still require 503. The media provider methods, Paper2Audio provider/synthesis methods, `VoiceForgeSynthesizer.synthesize`, and global `fetch` are instrumented in API integration tests; the entire route matrix asserts both provider-method and fetch counters stay at zero. This is stricter than the prior preview behavior.

### Route-to-provider trace, verified against current source

| Entry point | Underlying path | Current control and evidence |
|---|---|---|
| `POST /api/tts/synthesize` | `VoiceForgeSynthesizer.synthesize` → `fetch(OMNIVOICE_SERVICE_URL/v1/tts)` when configured. Its current orchestrator otherwise permits only an explicit local formant fallback; the `GeminiNeuralSpeechEngine` class is not selected by this orchestrator. | API middleware returns 503 unless explicit non-production local formant is allowed. The bypass requires no worker URL and no real Gemini key; placeholder `MY_GEMINI_API_KEY` is not treated as a live credential. Test uses a configured worker URL plus both bypass flags and observes 503 with zero synthesizer/fetch calls. |
| `POST /api/speech-to-speech` | Calls `VoiceForgeSynthesizer.synthesize`. | 503 before handler; included in zero-call API matrix. |
| `POST /api/paper2audio/parse` and `/script` | `Paper2AudioEngine.parsePaperText` / `generateScript` can call `GoogleGenAI.models.generateContent`; their catches produce fallback content only after the provider attempt. | 503 before handler, even if simulation flags are set; provider-method counter stays zero. |
| `POST /api/paper2audio/synthesize` | `Paper2AudioEngine.synthesizeDialogueAudio` calls the synthesizer for turns. | 503 before handler; both Paper2Audio and synthesis spies remain at zero. |
| Music, image, video create/animate/status/stylize, transcription/translation/media, dubbing, sound effects/isolation, and billing route families | `GeminiMultimodalEngine` calls SDK methods such as `generateContent`, `generateContentStream`, `generateVideos` and operation polling. Several handlers catch provider errors and then manufacture preview results. `sfx` is local harmonic audio, but is also gated. | All paths return 503 without entering handler code. Integration matrix covers 19 methods/paths (including video polling/jobs and billing summary/top-up), with SDK-method spies plus a global-fetch spy; both call counts remain zero. The deprecated media flag is tested as `true`. |
| `/live-ws` | Actual server upgrade → `WebSocketServer.handleUpgrade` → `connection` callback → `GoogleGenAI.live.connect` only when a real Gemini key exists; without a key the server generates local harmonic PCM. | Upgrade handler was factored into `attachLiveWebSocketUpgradeHandler`, which is used by `server.ts` and exercised through a real ephemeral HTTP/WebSocket upgrade test. Production and configured-key requests receive raw HTTP 503 before WSS connection; provider-initialization/connection callback count remains zero. Development no-key mode is still an unauthenticated, unmetered harmonic fallback, not paid neural audio. |
| Direct OmniVoice worker `/v1/tts`, warmup, cancel, and `/v1/clone/prompts/*` | `inference.generate_speech` → `ModelManager.ensure_loaded` → upstream `model.generate`; prompt creation/revocation mutates the worker filesystem store. | With `NODE_ENV=production`, the worker returns 503 when its server key is absent; when configured, requests without a key to all tested protected endpoints and a wrong-key TTS request receive 401 before model loading. The injected loader count remains zero. Compose keeps worker 8100 internal (`expose`, not host-published) and requires the shared key. This is service-to-service authentication only, not user identity or per-owner authorization; non-production without a key intentionally does not require authentication, so never expose that mode. |

Other route families reviewed are local/read-only or feature-gated: health/readiness probes make only a bounded non-generative worker `/readyz` request; public built-in voice catalogue and frontend text analysis are local; dictionary, custom voice, clone, upload, export, and revocation remain fail-closed. No provider API, inference worker, production database, or paid infrastructure was called during these tests.

### Readiness state validation

**Neural readiness remains FIXED AND TESTED (reporting semantics only).** Both Node’s worker probe and OmniVoice `/readyz` now require a successful HTTP response plus all three state signals: `model_state == loaded`, `dependencies_ready == true`, and the explicit neural-ready flag/model-loaded boolean. Node tests reject loaded responses whose dependency state is false or missing. Python endpoint tests cover `not_loaded` → 503, `loading` → 503, `loaded` with dependencies ready → 200, `failed` → 503, and contradictory loaded/dependency states → 503. Status/liveness remains distinct from inference readiness.

These tests use injected/fake model bundles. A loaded bundle is not a completed inference canary: no weights, CUDA/GPU, real upstream model, or deployment environment was exercised. Before a production readiness claim, run an authorized pinned-version GPU smoke that creates a bounded known-good waveform, verifies non-empty valid WAV bytes, sample rate and duration, records model/tokenizer/ASR revisions and licenses, and confirms a restart/reload recovery path. Keep model-dependent readiness false until that real canary succeeds (or define a separate `loaded` vs `inference_canary_passed` signal).

### Architecture and operational gaps rechecked

- **Identity/ownership:** no user login/session/JWT/OAuth provider or server-verified principal exists. The Python worker’s shared key is not an end-user identity. Clone/dictionary/custom-voice routes must remain unavailable. Request-body `userId` and placeholder `user_active` cannot authorize access.
- **Persistence:** Node consent registry/nonces, custom voice catalogue, dictionaries, and several job paths include process-memory fallbacks. OmniVoice `PromptStore` writes `.pt` tensors and JSON metadata to a local filesystem directory without owner IDs; its `revoke` removes the tensor but leaves audit metadata. Compose’s PostgreSQL/Redis/MinIO volumes are scaffolding, not proof that these feature records are wired, owner-filtered, encrypted, backed up, or recoverable. MinIO’s 9000/9001 ports are host-published in the draft Compose file.
- **Deployment boundary:** Compose sets production mode and requires the worker shared key, and the worker has no host-published port. However, the API maps `3000:3000` directly despite its comment saying not to expose it without an authenticated TLS reverse proxy. There is no such auth/proxy configuration in this workspace. Do not deploy this Compose file as a public service unchanged.
- **Licensing:** the worktree contains an untracked root `LICENSE` with Apache-2.0 text; it is not part of the committed repository identity and the existing license matrix still records the app’s license as undecided at the base revision. The OmniVoice source license is recorded as Apache-2.0, but OmniVoice weights, the Higgs audio tokenizer, Whisper checkpoint terms, and training-data provenance remain blocked/unverified in `MODEL_AND_MEDIA_LICENSES.md` / `THIRD_PARTY_INVENTORY.md`. Do not fetch weights or distribute until the owner approves the app license and primary model-card terms are captured.
- **Input/resource limits:** Express parses up to 50 MB JSON and URL-encoded bodies before API-router gates run; large denied payloads can still consume parser memory. The Python defaults expose 5,000 text characters, up to 600 seconds output, 25 MiB decoded upload, one inference at a time, a 120-second semaphore wait, and a Node-to-worker timeout default of 300 seconds. The Node development formant path has no equivalent text/output ceiling; WebSocket fallback has no per-user connection cap, and no API rate limit, global concurrency budget, provider spend budget, or container memory/CPU limit is configured. These are resource-abuse gaps even while paid routes are gated.
- **Recovery:** Compose declares persistent volumes for Postgres, Redis, MinIO and model cache, but no scheduled encrypted backup, restore exercise, deletion/revocation recovery test, or approved RPO/RTO was found. The default local prompt store is not mounted as a durable volume in Compose.
- **Consent/revocation:** fresh file inspection confirms HMAC verification and constant-time signature comparison precede normalized subject/name binding; failed mismatches do not consume nonce or create audit records. Expiry, replay and audit semantics remain in place. Owner-only direct engine revocation and route-level denial/no-mutation tests pass. This still does not establish identity or legal consent; no public enrollment or revoke feature is enabled.

### Measurable acceptance criteria before reconsidering production

| Gate | Required evidence to pass (all criteria, not a plan to enable now) |
|---|---|
| Verified identity and ownership | An owner-approved identity provider; server derives principal from verified credentials; body/query IDs never authorize. For each voice, prompt, dictionary, consent, upload, export and delete/revoke operation, automated A/B tests prove A can access only A’s records, spoofed IDs and role labels fail, and denied attempts make zero writes. |
| Durable private storage | Voice/prompt/dictionary/consent repositories persist across process restart and two API replicas; DB queries include authenticated owner predicates; object storage is private/encrypted; deletion/revocation is durable and verified; migration is operator-only and a restore exercise passes. |
| Cost and abuse controls | Keep every provider route 503 until denial tests assert zero SDK/fetch/worker calls (current Node route matrix passes). Before any enablement, specify product-approved per-user and global spend ceilings, request/concurrency/rate limits, maximum input/output size, provider timeouts/retry policy, and alert/kill switch; test boundary and overload behavior. Shared worker-key access is restricted to private API-to-worker traffic and rotated through an approved secret manager. |
| Neural inference | Capture approved weight/tokenizer/ASR licenses and immutable revisions; real target-GPU smoke creates valid bounded speech and proves inference, not merely model load; readiness is green only after that canary; worker restart, failed load, GPU exhaustion and recovery are exercised. |
| Resource ceilings | Reject oversized requests before expensive body parsing; decide/test maximum local-stub text/audio work; enforce WebSocket message/connection caps; add API rate/concurrency controls and container CPU/RAM/GPU memory limits; verify 413/429/503 outcomes without provider invocation. Current 50 MB parser and unbounded local stub do not pass. |
| Licensing | Owner-approved repository license is tracked; source notices are shipped; primary licenses and commercial/redistribution terms for every model weight, tokenizer, ASR checkpoint, training dataset and third-party media are recorded with revision and evidence. Any blocked item keeps the dependent feature off. |
| Recovery and operations | Approved numeric RPO/RTO; encrypted scheduled DB/object-store backups; successful restore and deletion/revocation drills; on-call/runbooks/metrics cover load failures, spend and abuse. Compose’s named volumes alone are not evidence. |
| PR isolation | Exact reviewed files are isolated from unrelated work without resetting, staging, or rewriting user changes; run full CI on that isolated increment and compare its base/head. Current dirty branch remains unsafe. |

### Files changed in this continuation

- `.env.example` (mark the preview flag deprecated/ignored)
- `FEATURE_MATRIX.md` and `docs/RELEASE_READINESS.md` (correct feature-gate claims)
- `server/routes/api.ts`, `server/security/costPolicy.ts`, `server/security/liveWebSocketUpgrade.ts`, `server.ts`, `server/engine/audio/readiness.ts`
- `services/omnivoice/app/main.py`
- `test/api/routes.test.ts`, `test/security/costPolicy.test.ts`, `test/security/liveWebSocket.test.ts`, `test/security/readiness.test.ts`
- `services/omnivoice/tests/test_service.py`
- This report; previous sections and evidence were preserved.

### Validation performed in this continuation

| Command/check | Result |
|---|---|
| `npm test` | Exit 0; **61 passed, 0 failed**. |
| `npx tsx --test test/api/routes.test.ts test/api/db-migration.test.ts test/security/consent.test.ts test/security/watermark.test.ts test/security/costPolicy.test.ts test/security/readiness.test.ts test/security/liveWebSocket.test.ts` | Exit 0; **42 passed, 0 failed**. Includes API provider spies, 503 matrix, WebSocket raw-upgrade denial, readiness contradictions, consent signing/replay/owner checks. |
| `npm run lint && npx tsc --noEmit` | Exit 0. |
| Vite build to `/tmp/voiceforge-p0-next-build.5Qdi0r/client` | Exit 0; prior >500 kB JS chunk warning remains. |
| `npx esbuild server.ts --bundle --platform=node --target=node22 --format=esm --packages=external --outfile=/tmp/voiceforge-p0-next-build.5Qdi0r/server/server.js` | Exit 0; 246.6 kB bundle. |
| OmniVoice pytest (`PYTHONDONTWRITEBYTECODE=1`, isolated `/tmp/voiceforge-p0-python.fZw55o`) | Exit 0; **24 passed**, including loading-state HTTP readiness and unauthorized direct-worker no-load tests. |
| `python -m compileall -q app tests` with external pycache prefix | Exit 0. |
| `git diff --check` | Exit 2 with the same seven pre-existing whitespace diagnostics in `server.ts`, `server/routes/api.ts`, `Header.tsx`, `PhoneticLabView.tsx`, and `VoiceCloningLabView.tsx`; not changed. |
| Real credentials/provider/GPU/DB/deployment/restore tests | Not run; no credentials, production resources, paid infrastructure, weights, or migrations were accessed. |

### Updated gate verdicts after this independent pass

| Gate | Current verdict | Evidence/limit |
|---|---|---|
| Consent fix | **VERIFIED** | Source and full tests independently rechecked; HMAC/signature contract unchanged. Identity/legal proof remains outside this check. |
| API revocation isolation | **VERIFIED (fail-closed routes)** | Direct owner isolation plus route-level no-handler/no-mutation tests pass; no authenticated principal exists, so operation remains disabled. |
| Paid-service exposure | **CONTROLLED (code boundary)** | Unconditional 503 for unsafe media paths, paid Node routes fail closed, provider/worker/fetch counters remain zero, actual WebSocket upgrade rejects before connection, and direct production worker requests without/wrong key do not load model. Deployment exposure, shared-key compromise, and quotas are not verified. |
| Neural readiness | **FIXED AND TESTED (state semantics)** | Node/Python require loaded state and dependencies ready; all four lifecycle states plus inconsistent state are tested. No real inference canary was run. |
| Status report | **UPDATED** | This section corrects the prior preview-path conclusion and records route evidence, concrete remaining gaps, and pass criteria. |
| PR | **NOT SAFE FROM CURRENT BRANCH** | Final read-only check: no remote session branch, PR, or workflow run; local HEAD is 0 ahead / 2 behind remote `main`, with no upstream. Worktree remains 19 modified tracked, 0 staged, 70 untracked; tracked-diff SHA-256 `fe1ab9c639a1b83419eb60e72c4d6bc2f1471bb51a6774d06d592a928a240d9b`. No staging, commit, push, rebase, or history manipulation. |
| Production readiness | **NOT READY** | Authenticated ownership, wired durable storage, primary model licenses, genuine inference, resource ceilings, backup/restore and deployment boundary still fail acceptance criteria. |

No custom voice or dictionary operation has been enabled. No production deployment, migration, secret change, commit, push, PR, or merge was performed.
