# VoiceForge AI Voice & Multimodal Media Platform

VoiceForge is an in-progress multilingual media-platform prototype. The repository includes a separately deployable OmniVoice adapter and original browser audio visualizer, but genuine neural inference requires model weights and an accelerator that have not been validated in this workspace. Voice cloning, billing, video, dubbing and several multimodal routes are intentionally disabled or explicitly development-only pending authentication, persistent ownership, provider verification and deployment evidence.

> **Not production-ready.** See [`FEATURE_MATRIX.md`](FEATURE_MATRIX.md) and [`docs/RELEASE_READINESS.md`](docs/RELEASE_READINESS.md) for verified, simulated, partial and blocked capabilities. A successful build does not establish production readiness.

---

## Key Capabilities

- **OmniVoice adapter (PARTIAL/BLOCKED)**: source-verified API mapping, lazy model manager, real waveform analysis, prompt store lifecycle, and no fake neural fallback. Actual neural audio requires accessible licensed weights and accelerator hardware.
- **Audio-reactive Visual Studio (REAL, browser component)**: original Web Audio waveform, frequency spectrum and radial particle canvas, driven by a local user-selected audio file.
- **TTS platform bridge (PARTIAL)**: Node forwards configured synthesis requests to the Python worker and returns 503 on missing/unavailable inference; explicit development formant output is non-production only.
- **Cloning, media generation, dubbing, transcription and billing (BLOCKED or SIMULATED)**: clone access and unverified media/billing routes are disabled by default until their safety, provider, auth, and persistence gates pass.
- **Deployment scaffolding (PARTIAL)**: Vercel SPA, persistent API container, GPU inference container, Compose, CI and smoke-test definitions; no external deployment has been performed.

---

## Architecture & Technology Stack

- **Client**: React 19, Vite, Tailwind CSS 4, Motion, Lucide Icons
- **Server**: Express 4, TypeScript, Helmet, CORS, Zod, WebSockets (`ws`)
- **Persistence scaffolding**: PostgreSQL + Drizzle schema exists, but several app routes still use memory; not a durability claim.
- **Speech model**: OmniVoice `omnivoice==0.2.1`, isolated in `services/omnivoice`; model weight licenses and real inference remain blocked pending external verification.
- **Other AI providers**: prototype integrations are not generally release-verified; see `FEATURE_MATRIX.md`.

---

## Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Gemini API key for multimodal analysis, transcription, and Veo operations | Injected by AI Studio |
| `PORT` | HTTP & WebSocket server port | `3000` |
| `NODE_ENV` | Runtime environment (`development`, `production`, `test`) | `development` |
| `DATABASE_URL` | PostgreSQL connection string | Optional for prototype; memory-backed routes are not durable |
| `CORS_ALLOWED_ORIGINS`| Comma-separated exact origins | `*` in prototype only; set exact origins for any deployed API |
| `OMNIVOICE_SERVICE_URL` | Private URL of persistent OmniVoice worker | Unset; synthesis returns HTTP 503 |
| `VOICEFORGE_WORKER_API_KEY` | Shared secret between API and private inference worker | Unset; configure for production |
| `APP_URL` | Public application URL | Current host |

---

## Quick Start

```bash
# 1. Reproducible frontend/API install
npm ci

# 2. Start development UI/API (TTS remains 503 unless worker is configured)
npm run dev

# 3. Build client + compiled production API
npm run build

# 4. Start compiled API
npm start

# 5. In a separate shell, start analysis-capable Python service (no model weights by default)
cd services/omnivoice
python -m pip install -r requirements.lock
uvicorn app.main:app --host 0.0.0.0 --port 8100
```

---

## Security & Compliance

- **HTTP Baseline**: Hardened with Helmet, CORS allowlists, isolated payload parsing, and standard `/healthz` and `/readyz` probes.
- **Cloning safety**: public cloning routes are deliberately blocked (503); the current signal comparison is not biometric identity proof or legal consent verification.
- **Provenance**: generated outputs may carry signed metadata in the WAV container. This is not a robust in-audio watermark and no watermarking compliance claim is made.
- **Licenses**: source-code licenses are documented in `MODEL_AND_MEDIA_LICENSES.md`; model-weight licenses are still BLOCKED and must be captured before commercial use.
