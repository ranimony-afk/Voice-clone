# VoiceForge feature truth matrix (2026-10-23, branch HEAD `65eec94` + uncommitted changes)

Status meanings: **REAL** = code path performs the stated operation; **PARTIAL** = real subset with important gaps; **SIMULATED** = placeholder/mock/fabricated output; **BLOCKED** = not usable until explicit external prerequisite or implementation; **VERIFIED** = evidence executed in this workspace. This matrix is not a production-readiness declaration.

| Capability | Status | Truth / limitation |
|---|---|---|
| Frontend clean install (`npm ci`) | VERIFIED | Reproducible `package-lock.json` generated after Vite/esbuild alignment (`esbuild ^0.28.0`). |
| Frontend production bundle | VERIFIED | Vite/Rolldown build succeeds; large-chunk warning remains. Compilation is not production readiness. |
| Node API production bundle/start | VERIFIED | esbuild bundles `server.ts`; `node dist-server/server.js` starts and health probes respond. |
| OmniVoice Python adapter | PARTIAL | Written against verified upstream 0.2.1 source API (`OmniVoice.from_pretrained`, `model.generate`, `model.create_voice_clone_prompt`, `VoiceClonePrompt.save/load`). Model is lazily loaded once per process; no weights/GPU here. |
| Genuine OmniVoice neural audio | BLOCKED | This sandbox lacks GPU and HF network access. When configured, `/v1/tts` returns only validated OmniVoice output; failure is HTTP 503. Actual weights, license capture and GPU audio quality have not been verified here. |
| Node TTS → OmniVoice service | PARTIAL | `OMNIVOICE_SERVICE_URL` calls the service and verifies `engine=omnivoice`, `engine_class=neural`. Requires deployment and API authorization hardening. No silent normal fallback. |
| Development formant synthesis | SIMULATED (explicit) | Node API only with `VOICEFORGE_ALLOW_DEV_STUB_ENGINE=true`, non-production `NODE_ENV`, and no OmniVoice worker URL or real Gemini key; labeled `DEV_ONLY`. Disabled by default. |
| Audio upload decoding / quality analysis in Python | REAL | libsndfile + NumPy on decoded audio; unsupported formats fail rather than estimate. SNR is explicitly a frame-energy estimate, not a validated perceptual score. |
| Voice-clone prompt create/store/revoke | PARTIAL / BLOCKED | Uses upstream prompt APIs and revocation destroys local `.pt`; still requires private persistent storage and authenticated owner enforcement before public access. Not production-safe as currently exposed. |
| Consent verification | SIMULATED biometric assurance | Cryptographic challenge/replay records and deterministic acoustic envelope features exist, but custom spectral features are not speaker biometrics and cannot establish identity/legal consent. No similarity score is legal proof. Do not expose as biometric verification. |
| Voice/profile persistence and ownership | PARTIAL | Drizzle schema and optional PostgreSQL exist; routes still use process memory and no authenticated ownership layer. Not release-safe. |
| TTS pre-made voice catalog | PARTIAL | Static profiles; no claim that profile timbre exists in OmniVoice unless mapped to a prompt or supported design instruction. |
| Vercel frontend configuration | PARTIAL | Static Vite deployment plus API/health proxy rules. Must set/verify `VOICEFORGE_API_HOST` in Vercel and configure API CORS/auth; WebSocket is a separate service, not proxied by this config. |
| Visual Studio audio-reactive Canvas | REAL | Original browser Web Audio waveform/spectrum/radial visualizer using user-selected local audio. No reference-collection assets used. |
| Other video/motion templates and rendering | SIMULATED / BLOCKED | Existing large studio screens and some mock operation responses remain; no verified FFmpeg render-to-playable-MP4 pipeline. |
| Transcription/dubbing | PARTIAL / SIMULATED | Some Gemini integrations are real if credentials/provider models are valid; routes include placeholder behavior and are not fully verified. Must remain disabled or explicitly marked preview until tested against provider. |
| Music/image/video generation | PARTIAL / SIMULATED | Provider routes and hardcoded preview/mock results exist; not covered by OmniVoice; no deployable provider evidence in this task. |
| Billing | SIMULATED | Hardcoded usage ledger/plan and in-memory top-up must not be presented as charges or entitlements. |
| CI / integration / E2E / deploy smoke | PARTIAL | Existing Node tests pass (35); Python pytest, CI workflow and smoke scripts are added/planned but outcomes must be reported after execution. No real GPU/weights E2E. |
| Vercel + separate persistent API + WebSocket + GPU worker deployment | BLOCKED | Configuration and container recipes are drafts; no credentials, DB, object store, public host, GPU, deployment, or rollback verification. |

## Release-readiness statement

**Not production-ready.** Inference weights/model-card licenses are unavailable in this environment; auth/ownership for public cloning is absent; consent biometric claims are unsupported; several non-TTS studio features remain simulated; GPU deployment and remote WebSocket/API are untested. Keep these gates BLOCKED. Never infer readiness from the successful frontend/backend build alone.
