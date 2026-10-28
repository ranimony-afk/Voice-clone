# Multimodal Video Animation Styling, Multilingual Translation & PostgreSQL Persistence

A production-grade implementation completing animated style transformations (Studio Ghibli watercolor, Makoto Shinkai celestial, 90s cel, 3D Pixar, claymation, Spider-Verse, and reverse-cinematic flows), deep multimodal media translation and transcription across global and Indic languages, backed by a persistent PostgreSQL relational schema migration layer with Drizzle ORM.

> [!IMPORTANT]
> **User Review & Confirmed Choices**:
> - **Primary Feature Focus**: Complete video animation styles (bidirectional live-action to anime/Ghibli/claymation and vice versa) and multimodal translation/transcription pipelines with full audio dubbing synthesis.
> - **Backend Architecture Baseline**: Database persistence with PostgreSQL schema migration (Drizzle ORM + PostgreSQL client), replacing transient memory state with persistent tables for video jobs, translation records, voice models, and usage events.
> - **AI Model Selection**: Utilizing `@google/genai` with `gemini-3.8-flash` for high-throughput multimodal frame analysis, prompt styling, and translation, `gemini-3.5-transcribe` for audio transcription, `veo-3.1-generate-preview` / `veo-3.1-lite-generate-preview` for video transformation jobs, and `gemini-3.8-flash-lite-tts` for synthesized voice dubbing.

---

## 1. Overview & Core Concept

### What It Does
- **Video Animation Styling Studio**: Allows users to upload video clips or choose curated live-action & animated test benchmarks, select animation style presets (Studio Ghibli watercolor, Makoto Shinkai celestial, 90s Cel Anime, Cyberpunk Neo-Tokyo, 3D Pixar, Claymation, Spider-Verse, or Japanese Ink Wash) or reverse-prompt (Anime → Photorealistic 35mm film). The engine performs frame decomposition, Gemini multimodal style transfer prompting, Veo video generation or sequential stylized rendering, side-by-side synchronized video comparison playback, and MP4 export.
- **Multimodal Translation & Dubbing Suite**: Allows uploading or recording audio/video in any source language (French, German, Spanish, Mandarin, Arabic, Russian, Japanese, English, Tamil, Hindi, Malayalam), generates accurate timestamped transcription with speaker diarization, translates into target languages, and generates voice-matched audio dubs.
- **Persistent Relational Data Layer**: Establishes PostgreSQL persistence using Drizzle ORM, with migration scripts supporting jobs, media assets, styled video renders, translation segments, user voices, and audit logs.

### Target Audience & Persona
- Content creators, animators, and video editors converting real footage into signature anime aesthetics.
- International media producers and educators localizing video/audio across European, Asian, and Indic languages with preserved voice identities.
- Developers needing an enterprise-grade, auditable media generation backend.

### Key Value
End-to-end multimodal transformation pipeline with visual comparison, progress tracking, downloadable exports, and robust database persistence that survives server restarts.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Video Style Transformation**:
   - User navigates to the **Video Studio** tab.
   - Uploads a local MP4/WebM video or clicks a preset live-action sample (e.g., Tokyo rain street, meadow landscape).
   - Selects a style preset (e.g., *Studio Ghibli Watercolor*) or toggles *Reverse Direction* (Animated $\to$ Photorealistic).
   - Customizes prompt modifiers (brush texture intensity, color saturation, grain) and clicks **Transform Video**.
   - A step-by-step progress monitor shows: *1. Ingestion & Keyframe Analysis* $\to$ *2. Multimodal Style Projection* $\to$ *3. Temporal Coherence & Rendering* $\to$ *4. Output Packaging*.
   - Once complete, a dual-viewport comparison player with a split-slider scrubber lets the user compare the original input with the stylized output.
   - Download button exports the transformed video.

2. **Multilingual Media Transcription & Translation**:
   - User navigates to **Transcribe & Translate** tab.
   - Uploads an audio/video file or selects an international sample.
   - Chooses the target language (Tamil, Hindi, Malayalam, Japanese, English, Spanish, French, German).
   - Clicks **Transcribe & Translate**.
   - Displays real-time synchronized segments: original transcription alongside target translation with timecodes.
   - User can play synthesized dub audio for each segment or download the complete SRT subtitle file, JSON transcript, or merged dubbed media.

3. **Database Records & History**:
   - Both studios query and store transformation tasks in PostgreSQL via Drizzle ORM, displaying a recent jobs queue with status, timestamps, and re-download links.

### Visual Identity & Theme
- **Aesthetic Direction**: Dark slate studio dashboard (`#0b0f17` background, `#111827` surface container) engineered for audio-video editing.
- **Color Tokens**:
  - Primary Canvas: `#090d16`
  - Elevated Surfaces: `#131b2e` with subtle hairline borders (`#1e293b`)
  - Accents: Emerald (`#10b981`) for Ghibli/success, Indigo (`#6366f1`) for Shinkai/processing, Amber (`#f59e0b`) for Retro/warnings.
- **Typography & Hierarchy**:
  - Headings: `Plus Jakarta Sans` / `Manrope` with bold weights and tight tracking.
  - Body: `DM Sans` (14px–15px) for clear reading.
  - Metrics & Timecodes: `font-mono tabular-nums` (e.g., `00:04.28 / 00:15.00`).
- **Zero-Pill Discipline**:
  - Categories, timestamps, and statuses rendered as unboxed text separated by `·` dots.
  - Interactive tabs and segmented buttons styled as crisp toggle groups, never candy badges.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Drizzle ORM with PostgreSQL Connection**:
  - *Chosen Approach*: Define standard Drizzle schemas (`src/db/schema.ts` and `src/db/index.ts`) with robust connection pooling (`pg` / `postgres`) and an automatic fallback to an in-memory/sqlite persistent adapter when a live remote PG instance is initializing.
  - *Why*: Provides clean TypeScript type safety, migration files (`drizzle/`), and zero ORM overhead while matching enterprise production standards.
  - *Alternatives Considered*: Prisma was considered but introduces heavy binary engines; raw SQL lacks compile-time type safety.

- **Decision 2: Dual Mode Video Styling (Veo API + Multimodal Keyframe Synthesis)**:
  - *Chosen Approach*: Server uses Gemini 3.8 Flash multimodal analysis to describe motion and framing, then orchestrates Veo video generation (`veo-3.1-lite-generate-preview` or `veo-3.1-generate-preview`) with reference image assets, while providing an instant keyframe preview mode for immediate UI feedback.
  - *Why*: Real video diffusion takes 30-90 seconds; providing keyframe preview + polling keeps the user engaged without UI timeouts.

- **Decision 3: Synchronized Split-Screen Video Scrubber**:
  - *Chosen Approach*: Custom HTML5 video sync controller locking both `<video>` elements to identical `currentTime` and `playbackRate`, overlaid with an interactive draggable vertical divider.
  - *Why*: Allows creators to inspect frame-by-frame texture conversion (e.g. skin to watercolor pigment, real clouds to Ghibli cumulus puffs).

---

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram
```
┌────────────────────────────────────────────────────────────────────────┐
│                        React 19 Client Dashboard                      │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌────────────┐  │
│  │    VideoStudioView    │  │ MediaTranscribeView   │  │ JobHistory │  │
│  │ (Style/Reverse, Sync) │  │  (SRT, Dubbing, Audio)│  │ (Status)   │  │
│  └───────────┬───────────┘  └───────────┬───────────┘  └─────┬──────┘  │
└──────────────┼──────────────────────────┼────────────────────┼─────────┘
               │                          │                    │
               ▼                          ▼                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Express 4 API Server                             │
│  ┌───────────────────────┐  ┌───────────────────────┐  ┌────────────┐  │
│  │  /api/video/transform │  │ /api/media/transcribe │  │ /api/jobs  │  │
│  │  /api/video/status    │  │ /api/media/translate  │  │ /api/health│  │
│  └───────────┬───────────┘  └───────────┬───────────┘  └─────┬──────┘  │
└──────────────┼──────────────────────────┼────────────────────┼─────────┘
               │                          │                    │
        ┌──────┴──────┐            ┌──────┴──────┐      ┌──────┴───────┐
        ▼             ▼            ▼             ▼      ▼              ▼
 ┌─────────────┐ ┌─────────┐ ┌───────────┐ ┌─────────┐ ┌────────────────┐
 │ Gemini 3.8  │ │ Veo 3.1 │ │Gemini 3.5 │ │ Gemini  │ │ PostgreSQL +  │
 │ Multimodal  │ │ Video   │ │Transcribe │ │ 3.8 TTS │ │  Drizzle ORM  │
 └─────────────┘ └─────────┘ └───────────┘ └─────────┘ └────────────────┘
```

### PostgreSQL Drizzle Data Model
- `video_transform_jobs`: `id`, `user_id`, `input_url`, `style_preset`, `reverse_mode`, `custom_prompt`, `status` (`pending`, `processing`, `completed`, `failed`), `output_url`, `preview_frames`, `duration_seconds`, `created_at`, `updated_at`.
- `transcription_translation_jobs`: `id`, `media_url`, `source_lang`, `target_lang`, `transcript_json`, `translated_json`, `dubbed_audio_url`, `srt_content`, `created_at`.
- `voices`: `id`, `name`, `language`, `gender`, `accent`, `sample_url`, `embedding_vector`, `consent_recorded`, `created_at`.
- `pronunciation_dictionaries`: `id`, `user_id`, `word`, `phonemes`, `language`, `notes`, `created_at`.

### Component & Interactive State Mapping
- `VideoStudioView.tsx`:
  - `selectedPreset`: Active animation style preset (Ghibli, Makoto Shinkai, etc.)
  - `isReverse`: Boolean toggle for Realism $\leftrightarrow$ Animation
  - `activeJob`: Current transformation job status polling every 3 seconds
  - `splitPosition`: Scrub bar percentage (0% to 100%) for interactive A/B comparison
- `MediaTranscribeTranslateView.tsx`:
  - `targetLanguage`: Selected destination language
  - `segments`: Live transcript list with interactive inline editing
  - `dubbingVoiceId`: Voice selected for synthesized audio dubbing
  - `exportFormat`: Subtitles (SRT/VTT), Audio (WAV/MP3), or Text transcript (JSON/TXT)
- `db/schema.ts` & `server/routes/api.ts`:
  - API endpoints wired to persist records in PostgreSQL tables with full Zod input validation.
