# Model and Media Licenses

**Date**: October 24, 2026
**Project**: VoiceForge 2.0 Multilingual AI Voice Platform

---

## 1. Speech Synthesis Models

### 1.1 OmniVoice (`k2-fsa/OmniVoice`)
* **Upstream Organization**: k2-fsa / Open Source Speech Community
* **Model Checkpoint Repository**: `https://huggingface.co/k2-fsa/OmniVoice`
* **License**: Apache License 2.0
* **Commercial Use**: Permitted under Apache 2.0 terms with trademark and patent non-assertion clauses.
* **Citation**:
  ```bibtex
  @article{zhu2026omnivoice,
    title={OmniVoice: Towards Omnilingual Zero-Shot Text-to-Speech with Diffusion Language Models},
    author={Zhu, Han and others},
    journal={arXiv preprint arXiv:2604.00688},
    year={2026}
  }
  ```
* **Training Data & Restrictions**:
  - Voice design capability is primarily trained on Chinese and English datasets; low-resource languages should rely on zero-shot reference audio cloning for highest phonetic accuracy.
  - Ethical usage policy forbids non-consensual voice generation, fraud, deepfakes, or biometric spoofing.

### 1.2 Whisper ASR (`openai/whisper-large-v3-turbo`)
* **Role**: Automatic transcription of reference voice audio in OmniVoice inference pipeline.
* **License**: MIT License
* **Commercial Use**: Permitted.

---

## 2. Creative Reference Media (`awesome-opus5-5-videos`)

* **Upstream Maintainer**: yihui-dev (`https://github.com/yihui-dev/awesome-opus5-5-videos`)
* **License**: MIT License (for the repository structure and curation metadata).
* **Media Assets Policy**:
  - The repository links to third-party creator posts on X/Twitter and preview WebP animations hosted on `media.skillry.dev`.
  - **VoiceForge Compliance Decision**: VoiceForge **does not republish, hotlink, or vendor external creator video files or proprietary branding**.
  - All visual templates in VoiceForge Visual Studio are **original clean-room procedural implementations** (HTML5 Canvas 2D, Web Audio API, SVG, CSS keyframe animations) inspired by the creative motion patterns documented in the catalog.

---

## 3. Provenance & Attribution Enforcement

VoiceForge includes a cryptographic audio watermarking engine (`server/engine/audio/watermark.ts`) that embeds HMAC-SHA256 authenticated provenance metadata and content hashes in all generated WAV files (`VFPR` RIFF chunk), ensuring compliance with content authenticity and provenance standards (C2PA-inspired).
