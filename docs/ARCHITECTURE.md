# VoiceForge Architecture Specification

## 1. High-Level System Architecture

```mermaid
flowchart TB
    subgraph Clients["Clients & SDKs"]
        WebUI["Web App (Next.js / Vite SPA)<br/>Waveform + Studio + Voice Lab"]
        PySDK["Python SDK (voiceforge-python)"]
        JsSDK["Node / Web SDK (@voiceforge/sdk)"]
        RestAPI["Direct REST / WebSocket Clients"]
    end

    subgraph GatewayLayer["API Gateway & Ingress"]
        Nginx["Reverse Proxy / Nginx + TLS"]
        AuthMid["Auth & Rate Limiter<br/>JWT / Bearer API Keys (Redis Token Bucket)"]
        AuditLog["Audit & Metering Logger<br/>Credit Deductions"]
    end

    subgraph AppCluster["Backend Services (FastAPI / Express)"]
        APIServer["API Orchestrator<br/>/v1/tts, /v1/voices, /v1/dubbing"]
        TextFrontend["Multilingual Text Normalizer & G2P<br/>EN • HI • TA • ML • JA"]
        DictionaryEngine["Pronunciation Dictionary (PLS / IPA Engine)"]
    end

    subgraph AsyncWorker["Task Queues (Celery / Redis)"]
        RedisQueue[("Redis Cache & Task Broker")]
        WorkerClone["Worker: Voice Cloning & Consent Verification"]
        WorkerDub["Worker: Demucs Vocal Split + ASR + Alignment"]
        WorkerStudio["Worker: Long-form Studio Audio Rendering"]
    end

    subgraph InferenceCluster["GPU Inference Engine Cluster (Triton / PyTorch)"]
        Router["Model Router (Language & Voice ID)"]
        CosyVoice["Engine 1: CosyVoice 2 (Zero-shot Flow Matching)"]
        IndicEngine["Engine 2: AI4Bharat Indic Parler-TTS"]
        ToneColor["Tone-Color Transfer (OpenVoice v2)"]
        Vocos["Vocoder: Vocos / BigVGAN v2 (Chunked Stream)"]
        WhisperASR["ASR: faster-whisper large-v3-turbo"]
        ECAPA["Biometrics: ECAPA-TDNN Speaker Embeddings"]
    end

    subgraph StorageLayer["Data & Asset Storage"]
        Postgres[("PostgreSQL 16 Database<br/>Users, Voices, Projects, Logs")]
        S3Bucket[("S3 / MinIO Object Storage<br/>Audio Files, Reference Samples, Watermarked Masters")]
    end

    Clients --> Nginx
    Nginx --> AuthMid --> AuditLog --> APIServer
    APIServer --> TextFrontend
    TextFrontend --> DictionaryEngine
    APIServer --> RedisQueue
    RedisQueue --> WorkerClone
    RedisQueue --> WorkerDub
    RedisQueue --> WorkerStudio

    APIServer -. Streaming TTS Chunk .-> Router
    Router --> CosyVoice & IndicEngine
    CosyVoice --> ToneColor --> Vocos
    IndicEngine --> ToneColor --> Vocos

    WorkerClone --> ECAPA
    WorkerDub --> WhisperASR

    APIServer <--> Postgres
    WorkerClone & WorkerDub & APIServer <--> S3Bucket
```

---

## 2. Low-Latency Streaming TTS Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor Client as Web / API Client
    participant API as API Server (/v1/tts/stream)
    participant Normalizer as Text Front-End (EN/HI/TA/ML/JA)
    participant Model as Acoustic Model (CosyVoice / Indic)
    participant Vocoder as Vocos Streaming Vocoder
    participant WM as Audio Watermarker

    Client->>API: POST /v1/tts/stream (text, voice_id, lang, stream=true)
    API->>API: Deduct pending credits & check rate limit
    API->>Normalizer: Normalize numbers, currency, code-switch segmentation
    Normalizer-->>API: Yield sentence/clause chunks [<50 chars each]
    
    loop For each text chunk
        API->>Model: Infer acoustic tokens (KV-cached mel features)
        Model->>Vocoder: Stream 40ms audio frames
        Vocoder->>WM: Inject inaudible spread-spectrum watermark
        WM-->>API: PCM16 / Opus frame buffer
        API-->>Client: HTTP Chunk / WebSocket frame (TTFB < 380ms)
    end
    API->>Client: Stream Complete (EOF + usage event recorded)
```

---

## 3. Instant Voice Cloning & Biometric Consent Verification

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Creator
    participant UI as Voice Lab UI
    participant Backend as VoiceForge Backend
    participant AudioClean as Audio Pre-processor
    participant Bio as ECAPA-TDNN Biometric Engine
    participant DB as Postgres & S3

    User->>UI: Upload reference audio (10–60s)
    UI->>Backend: POST /v1/voices/clone/analyze
    Backend->>AudioClean: Run VAD trim, SNR calculation, Loudness normalization (EBU R128)
    AudioClean-->>UI: Quality report: SNR 28dB (Good), Duration 42s, Clipping 0%
    
    Backend->>UI: Issue Random Consent Sentence:<br/>"I authorize VoiceForge to generate a synthetic voice clone of my speech on [Today's Date]."
    User->>UI: Record live consent sentence
    UI->>Backend: Submit consent audio + reference samples
    
    Backend->>Bio: Extract embedding(Reference) & embedding(Consent)
    Bio->>Bio: Calculate Cosine Similarity
    alt Cosine Similarity < 0.78 (Voice mismatch)
        Bio-->>Backend: REJECT: Biometric mismatch (score: 0.54)
        Backend-->>UI: Error 403: Consent audio does not match uploaded voice reference
    else Cosine Similarity >= 0.78 (Match verified)
        Bio-->>Backend: APPROVED: Biometric matched (score: 0.89)
        Backend->>DB: Store consent_records (immutable audit hash, IP, timestamp)
        Backend->>DB: Save voice record & 192-dim speaker embedding vector
        Backend-->>UI: Voice clone created successfully!
    end
```

---

## 4. AI Dubbing & Video Vocal Muxing Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Content Creator
    participant Dub as Dubbing Service
    participant Demucs as Demucs Vocal Separator
    participant ASR as Whisper large-v3-turbo
    participant Trans as Translation & Alignment Engine
    participant TTS as Multilingual Cross-Lingual TTS
    participant FFmpeg as FFmpeg Video Muxer

    User->>Dub: Upload video (e.g., English presentation)
    Dub->>Demucs: Separate stems: vocal.wav + background_music.wav
    Dub->>ASR: Transcribe vocal.wav with word timestamps
    ASR-->>User: Editable transcript + timeline segments
    User->>Dub: Select target language (Tamil / Japanese / Hindi)
    Dub->>Trans: Translate while preserving segment duration constraints
    Dub->>TTS: Synthesize translated segments with original speaker voice embedding
    TTS->>Trans: Dynamic time-stretching / silence insertion to match original sync
    Dub->>FFmpeg: Mux: new_dialogue.wav + background_music.wav + original_video.mp4
    FFmpeg-->>User: Download synchronized dubbed video (MP4)
```
