# VoiceForge: Technical Decisions, Engine Selection & License Audit

## 1. Executive Summary & Engine Recommendation Matrix

VoiceForge requires a high-throughput, expressive, zero-shot multilingual TTS engine with first-class support for **English (en-US/en-IN), Hindi (hi-IN), Tamil (ta-IN), Malayalam (ml-IN), and Japanese (ja-JP)**. The system must support instant voice cloning (10–60s reference audio), cross-lingual voice identity transfer, low latency (<500 ms TTFB), and commercial deployability.

| Model / Component | Primary Architecture | Multilingual Coverage | Zero-Shot Cloning | Latency / RTF | License | Commercial Permitted? | Recommendation & Role in VoiceForge |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **CosyVoice 2** (Alibaba) | DiT + Flow Matching + Speech Tokenizer | EN, ZH, JA, Yue (extensible to Indic via fine-tuning) | Excellent (3s prompt) | RTF ~0.15, TTFB ~280ms | **Apache 2.0** | **YES (Fully Permitted)** | **RECOMMENDED PRIMARY CORE ENGINE** for multilingual zero-shot cloning and streaming. |
| **F5-TTS / E2-TTS** | Non-autoregressive Flow Matching + ConvNeXt | EN, ZH (community checkpoints for JA, HI) | Very High | RTF ~0.18, TTFB ~350ms | **MIT / CC-BY-NC-4.0** (Check model weights!) | **CHECK WEIGHTS** (Base code is MIT, but some public checkpoints carry CC-BY-NC). | Used as secondary flow-matching engine; trained with custom Indic weights. |
| **XTTS-v2** (Coqui) | Autoregressive GPT + VITS vocoder | 17 languages (includes EN, JA, HI; missing TA, ML) | High | RTF ~0.35, TTFB ~650ms | **CPML (Coqui Public Model License)** | **NO (Commercial Use Forbidden without paid license)** | **REJECTED FOR PRODUCTION CORE** due to CPML commercial restrictions and lack of Tamil/Malayalam. |
| **Fish-Speech v1.5** | Dual-autoregressive VQ-VAE + LLaMA backbone | EN, ZH, JA (good Japanese pitch) | High | RTF ~0.30, TTFB ~450ms | **Apache 2.0 / CC-BY-NC-SA** | **RESTRICTED** | Retained for Japanese pitch accent reference experiments; not default commercial driver. |
| **Indic Parler-TTS / IndicF5** (AI4Bharat) | Parler-TTS / Flow Matching tuned on Indic speech | Hindi, Tamil, Malayalam, Telugu, etc. (22 Indic languages) | High for Indic accents | RTF ~0.22 | **MIT / Apache 2.0** | **YES** | **RECOMMENDED INDIC CO-ENGINE**: Deployed in tandem for native Tamil & Malayalam nuance. |
| **StyleTTS 2** | Diffusion-based Style Modeling + SLM | EN, JA (monolingual finetuned models) | Medium (needs fine-tuning) | RTF ~0.10 (Ultra-fast) | **MIT** | **YES** | Ideal for ultra-low latency voice design and fixed persona narration. |
| **VITS / MMS-TTS** (Meta) | VAE + Normalizing Flows + Adversarial | 1,000+ languages including TA, HI, ML | Poor (fixed speaker embeddings) | RTF ~0.08 | **CC-BY-NC 4.0** | **NO** | Rejected for commercial voice cloning. |
| **OpenVoice v2** | Tone Color Converter (Separation of style & timbre) | Any language (cross-lingual) | Excellent cross-lingual | RTF ~0.05 (post-filter) | **MIT** | **YES** | **RECOMMENDED FOR TONE-COLOR CROSS-LINGUAL TRANSFER**: converts any native Indic/JA output into target speaker timbre. |
| **Vocoder: BigVGAN v2 / Vocos** | Periodic activation BigVGAN / Fourier Vocos | Universal audio reconstruction | N/A | RTF < 0.02 on GPU | **MIT / Apache 2.0** | **YES** | **RECOMMENDED VOCODER**: Vocos for ultra-fast streaming (<20ms chunks); BigVGAN for 44.1kHz studio master. |
| **ASR: Whisper-large-v3-turbo / faster-whisper** | Encoder-decoder Transformer with CTranslate2 | Superb for all 5 languages | N/A | RTF ~0.05 on GPU | **MIT** | **YES** | **RECOMMENDED STT & DUBBING ALIGNER**: Provides word timestamps and language ID. |
| **Speaker Embeddings: ECAPA-TDNN / Res2Net** | SpeechBrain SincNet + TDNN | Language-agnostic voiceprints | N/A | < 15ms per 10s audio | **Apache 2.0** | **YES** | **RECOMMENDED FOR CONSENT VERIFICATION & CLUSTERING**. |
| **Vocal Separation: Demucs v4 (Hybrid Transformer)** | Dual-domain U-Net (HT-Demucs) | Audio stems separation | N/A | RTF ~0.12 | **MIT** | **YES** | **RECOMMENDED FOR DUBBING BACKGROUND EXTRACTION**. |

---

## 2. Selected VoiceForge Hybrid Architecture

To overcome the single-model limitation where no individual open-source model simultaneously achieves commercial compliance, zero-shot cloning, and native accent mastery across Hindi, Tamil, Malayalam, Japanese, and English, VoiceForge adopts a **Tiered Pluggable Engine Architecture**:

### Engine 1: Unified Flow Engine (CosyVoice 2 + OpenVoice v2 Tone-Color Converter)
- **Primary Function**: Zero-shot voice cloning from 10–60s reference clips.
- **Cross-Lingual Magic**: Text is synthesized using language-native front-ends and phonetic tokens, then passed through the OpenVoice tone-color converter or CosyVoice cross-lingual speaker latent to retain timbre across language boundaries.

### Engine 2: Indic Acoustic Engine (AI4Bharat Indic Parler / IndicF5)
- **Primary Function**: Deep Indic script phonemization and natural prosodic cadence for Tamil, Malayalam, and Hindi.
- **Integration**: Generates native acoustic mel-spectrograms which are steered by the target speaker's ECAPA-TDNN embedding vector.

### Engine 3: Cloud & Gemini Multimodal Fallback Engine
- **Primary Function**: Immediate server-side generation, conversational barge-in, and zero-GPU local environments.
- **Integration**: Leverages server-side Gemini API multimodal capabilities for instant streaming TTS in all 5 languages.

---

## 3. License Compliance & Legal Summary

1. **XTTS-v2 Warning**: The Coqui Public Model License (CPML) strictly prohibits commercial deployment without a negotiated enterprise license from the defunct Coqui entity. **We explicitly exclude XTTS-v2 from the commercial production runtime.**
2. **Audio Watermarking Requirement**: In compliance with EU AI Act Article 50 and Indian DPDP guidelines, VoiceForge embeds a cryptographic spread-spectrum high-frequency watermark into all generated WAV/MP3 outputs (`vforge_wm_v1`), allowing deterministic origin verification via `POST /v1/audio/verify-watermark`.
3. **Consent Mandate**: Zero-shot cloning requires voice biometric consent verification (cosine similarity $\ge 0.78$ against a live spoken consent phrase) before generating custom speaker tokens.
