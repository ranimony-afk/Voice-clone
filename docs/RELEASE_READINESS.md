# VoiceForge release-readiness report — after M0 reconciliation / M1 work in progress

**As of 2026-10-23** · local branch `arena/53108bcd-voice-clone` · HEAD `65eec94fd799a5502a74a24ac7dd805f2d70e517` plus uncommitted work. No commit, push, merge or deployment performed.

## Identity & reconciliation

- origin: `https://github.com/ranimony-afk/Voice-clone.git`
- Arena branch: `arena/53108bcd-voice-clone`
- GitHub `main`: observed SHA `65eec94fd799a5502a74a24ac7dd805f2d70e517`; `git fetch origin --prune` confirmed `origin/main` still resolves exactly to that SHA (no later advance).
- Reconciliation: `git fetch origin --prune`, confirmed local `73c9948` was 0 ahead/1 behind, checked changed path list for collisions with M0 untracked artifacts, then safe `git merge --ff-only origin/main`. All M0 files and both git-ignored provenance clones preserved.
- OmniVoice source: `08be0b4ccbac3e13e374e86fbfead4b4cac343e2` (Apache-2.0). Video reference source: `92aee2f586ac0715cb3cbcb6384834f98a33383d` (MIT index; creator media not included/licensed by that repository license). See the detailed inventory and license matrix.

## Implemented in this uncommitted work

- Aligned root esbuild to `^0.28.0`, generated a reproducible npm lockfile, added explicit client/server build scripts and server start against bundled `dist-server/server.js`.
- New independent Python FastAPI OmniVoice adapter: lazy singleton, source-verified API mapping, reference audio analysis, request validation, prompt save/revoke, health/status, no neural-success simulation.
- Node TTS bridge invokes configured OmniVoice endpoint, validates engine identity and returns 503 on failure; development formant requires explicit non-production opt-in.
- Vercel static SPA config, separate Node API + GPU worker container/Compose drafts, original audio-reactive Canvas visualizer wired into the app, feature-truth matrix, deployment/architecture docs.
- Fail-closed default: public cloning/prompt routes return 503 until auth + persistent owner-scoped media storage are implemented; cost-bearing TTS routes return 503 unless a narrowly gated local-only formant stub is explicitly enabled; unverified media/billing routes always return 503, including when the deprecated simulated-media flag is set. Integration tests assert no provider, SDK method, or inference-worker invocation on denied paths.
- M0 artifacts kept; `third_party/` remains git-ignored and source pins unchanged.

## Evidence actually run

| Evidence | Result |
|---|---|
| `git fetch origin --prune` + origin identity | current main `65eec94`; prior Arena HEAD was 0 ahead / 1 behind |
| `git merge --ff-only origin/main` | PASS; no conflict/rebase/merge commit |
| upstream clones | OmniVoice `08be0b4c…`; video reference `92aee2f5…` (both confirmed in M0) |
| clean dependency install | `npm install` initially still failed on esbuild peer conflict; after pin adjustment a clean `npm install` passed and `npm ci` passed (245 packages) |
| `npm run build:client` | PASS, but large-chunk warning remains |
| `npm run build:server` | PASS (240.4 kB bundle) |
| production backend startup | PASS — `NODE_ENV=production npm start`; `/healthz` 200, `/` static SPA 200, `/api/health` 200 |
| `npm test` | PASS — 46 tests, 0 failures (includes consent-key and provenance-key fail-closed, signature/tamper, safe API failure, and release-gating regressions) |
| `npm run lint` | PASS — TypeScript check |
| `npm run build` | PASS — client and server builds; client retains existing large-chunk warning |
| `git diff --check` | PASS — no whitespace errors |
| Live smoke probes | PASS for expected behavior: API and inference health 200; API static SPA 200; unauthenticated clone blocked 503; unconfigured neural TTS blocked 503; Python `/v1/status` reports `model_available=false`, `torch_installed=false` (honest no-weights environment) |
| Python adapter pytest | PASS — 19 tests, CPU/mocked-model + real DSP/HTTP contract tests; no OmniVoice weights loaded |
| Python Docker image / Vercel preview deployment | NOT RUN — Docker/Vercel credentials and external deployment context unavailable |
| Genuine OmniVoice inference | BLOCKED — no GPU, weights/HF access blocked, model-card licenses unavailable from sandbox |

## Release gate state

| Gate | State |
|---|---|
| npm clean install / lockfile | VERIFIED (M1 worktree; rerun in CI still needed) |
| frontend bundle | VERIFIED (not readiness evidence) |
| Node API build/start | VERIFIED locally; DB/auth/deployed host not verified |
| Python adapter tests | VERIFIED — 19 tests pass locally; adapter uses mocked model only |
| Genuine neural TTS | BLOCKED (GPU + model weights + license evidence) |
| Authentication, authorization and persistent ownership before public cloning | BLOCKED; **public cloning must remain disabled** until implemented and tested |
| Provenance HMAC | SOURCE/TEST VERIFIED — key required, legacy embedded key ID rejected, config/tamper/API failure tests pass; deployed key configuration and retained-artifact history UNKNOWN |
| Consent assurance | BLOCKED for biometric/legal proof; signal features are not biometrics |
| Vercel preview/API proxy/WebSocket | BLOCKED; no deployment performed |
| Durable queue, private object storage, migrations + backups | BLOCKED |
| Visual Studio | PARTIAL; original client canvas component is wired into navigation; browser/E2E verification pending |
| unverified media/dubbing/transcription/billing routes | BLOCKED; always return 503, including with the deprecated simulated-media flag. Integration tests spy on provider and worker calls across every route family and assert no upstream invocation. |
| playable video export | BLOCKED |
| CI workflow | IMPLEMENTED, not run by GitHub Actions in this session; local test/build equivalents pass |
| E2E/deployment smoke | PARTIAL; smoke script and direct local HTTP health/fail-closed probes exist; no Vercel/GPU/deployed-host E2E |
| model/license and third-party notices | PARTIAL; source licenses verified, weight licenses remain BLOCKED |

## Remaining critical risks

1. **No public voice cloning.** Existing Node routes still accept synthetic user IDs and use in-memory voice catalog. A production auth provider/JWT verification, persistent owner checks on every clone/prompt operation, and DB/object store migrations/tests are mandatory before enabling the route.
2. **Model weights and license gate unresolved.** No neural sample was generated in this environment; do not market the inference path as tested.
3. **Consent feature is not speaker biometrics.** Deterministic handcrafted acoustic features cannot establish identity; remove claim or require human/legal-grade process, and never label a similarity score as legal proof.
4. **Vercel rewrite interpolation and WebSocket route are unverified.** Needs preview deployment and separate host test; no deploy authorization was given.
5. **Existing multimodal screens/routes contain mock results and unsupported provider/model labels.** They remain SIMULATED/PARTIAL until isolated behind explicit development flags or made real.
6. **GPU Docker build is a draft.** Validate PyTorch CUDA wheels, model dependencies, memory, licenses and performance on a supported host.

## Consent signing configuration note (security remediation)

The consent challenge and audit-record HMAC now require `VOICEFORGE_CONSENT_SECRET` containing exactly 32 random bytes encoded as 64 hexadecimal characters. Missing, empty, whitespace-only, or malformed values fail closed; the runtime generates no replacement key. The consent routes remain disabled by the API's clone-route gate, and errors are returned without key material. Tests use a deterministic fixture only in the isolated consent test file.

The repository code stores nonce and audit registries in process memory; the schema document's consent table is aspirational and no production consent-record persistence path was found. The repository cannot establish whether a deployed service ever used the prior fallback or whether API consumers retained challenge/audit signatures. Treat existing signatures as potentially exposed. Recommended, if a deployment is later found: inventory the deployment's secret/config history and any external record copies; revoke/expire outstanding challenges; mark historical records signed under the fallback as untrusted, preserve them for audit, and require fresh authorization/re-enrollment for any future use. Rotate only through the deployment's approved secret manager after explicit authorization. No production key was accessed, rotated, or invalidated here.

The provenance signer now requires the existing `VOICEFORGE_WATERMARK_KEY` variable as a raw UTF-8 HMAC key of at least 32 bytes; no runtime key is generated or defaulted. The previous legacy key ID is no longer trusted because its signing material was embedded in public source. Existing WAV manifests signed with the old fallback/legacy key will no longer verify; preserve such files, but treat their authenticity as unverified. Existing records signed with a securely provisioned current key remain verifiable only if the same key is supplied. No production media or records were modified.

Repository code embeds provenance manifests in returned WAVs and returns signature tokens. The ledger is process-local; the generations table's watermark field is schema-only in this checkout, with no confirmed durable write path. It is unknown whether deployed clients or systems retained outputs. Review deployment secret history and external artifacts before key changes; configure a fresh secret only through the approved secret manager and require fresh provenance for newly generated outputs. No production key was accessed or rotated.

## Smallest next action

Install/run the Python service suite and fix every error; then connect `VisualStudioView` in the nav and mark cloning/multimodal/billing endpoints explicitly disabled unless authenticated and backed by persistent ownership. No production rollout until all BLOCKED gates have external evidence.
