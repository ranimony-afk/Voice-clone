# VoiceForge AI Voice & Multimodal Media Platform

VoiceForge is a production-grade, multilingual audio and video platform featuring neural speech synthesis (TTS), zero-shot voice cloning with biometric consent records, video animation styling (bidirectional Live-Action $\leftrightarrow$ Anime/Ghibli), cross-lingual transcription and dubbing, and a relational PostgreSQL database persistence layer.

---

## Key Capabilities

- **Multilingual TTS Engine**: High-fidelity neural speech synthesis covering English, Tamil (தமிழ்), Hindi (हिन्दी), Malayalam (മലയാളം), and Japanese (日本語).
- **Zero-Shot Voice Cloning**: Instant voice profile generation with SNR/clipping acoustic quality checks, biometric consent verification, and portable model export (`.json` and `.bin` weights).
- **Multimodal Video Animation Studio**: Bidirectional video stylization across Studio Ghibli watercolor, Makoto Shinkai celestial, 90s Cel Anime, 3D Pixar, Claymation, Spider-Verse, and reverse Anime $\to$ Photorealistic 35mm film. Features an interactive synchronized split-slider comparison scrubber.
- **Universal Transcriber & Cross-Lingual Dubber**: Multimodal speech-to-text (ASR) in 100+ languages, automated translation, voice-matched audio dubbing, and SRT subtitle export.
- **Relational Persistence**: PostgreSQL with Drizzle ORM schema migrations for jobs, voices, consent records, dictionaries, and audit events.
- **Gemini Live Agent**: Real-time bidirectional voice conversation streaming via WebSockets.

---

## Architecture & Technology Stack

- **Client**: React 19, Vite, Tailwind CSS 4, Motion, Lucide Icons
- **Server**: Express 4, TypeScript, Helmet, CORS, Zod, WebSockets (`ws`)
- **Database**: PostgreSQL 15+ with Drizzle ORM (with automatic fallback to in-memory store)
- **AI Models**: Google GenAI SDK (`gemini-3.8-flash`, `veo-3.1-fast-generate-preview`, `gemini-3.5-transcribe`, `gemini-3.8-live`, `lyria-3-pro-preview`)

---

## Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Gemini API key for multimodal analysis, transcription, and Veo operations | Injected by AI Studio |
| `PORT` | HTTP & WebSocket server port | `3000` |
| `NODE_ENV` | Runtime environment (`development`, `production`, `test`) | `development` |
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/voiceforge`) | Optional (in-memory fallback) |
| `CORS_ALLOWED_ORIGINS`| Comma-separated allowed origins or `*` | `*` |
| `APP_URL` | Public application URL | Current host |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the development server (Express + Vite + WebSockets)
npm run dev

# 3. Build for production
npm run build

# 4. Start production server
npm start
```

---

## Security & Compliance

- **HTTP Baseline**: Hardened with Helmet, CORS allowlists, isolated payload parsing, and standard `/healthz` and `/readyz` probes.
- **AI Safety & Consent**: Ethical biometric verification requiring spoken consent phrases before cloning voice timbre.
- **Audio Watermarking**: Cryptographic watermark signatures embedded in audio synthesis outputs.
- **Licenses**: Fully compliant with permissive commercial licenses (Apache 2.0 and MIT). Non-commercial models (such as XTTS-v2 and MMS-TTS) are strictly excluded.
