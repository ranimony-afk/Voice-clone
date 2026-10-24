# Third-Party Inventory & Upstream Integration Audit

**Date**: October 24, 2026
**Auditor**: VoiceForge Coordinated Senior Engineering Team
**Workspace**: `/app/applet`
**Upstream Inspection Staging**: `voiceforge-work/`

---

## 1. Upstream Repositories

### 1.1 Primary Application: VoiceForge
* **Repository**: `https://github.com/ranimony-afk/Voice-clone.git`
* **Local Working Copy**: `/app/applet` (authoritative application)
* **Clone Verification Path**: `voiceforge-work/Voice-clone`
* **Default Branch**: `main`
* **Checked-out Branch**: `main`
* **HEAD Commit SHA**: `65eec94fd799a5502a74a24ac7dd805f2d70e517`
* **Commit Date / Author**: `Fri Oct 23 20:24:11 2026 +0530` / `ranimony-afk <ranimony@gmail.com>`
* **Commit Subject**: `feat: expand voice platform capabilities`
* **License**: MIT License (Copyright (c) 2026 VoiceForge Contributors)
* **Role**: Primary authoritative full-stack application.

### 1.2 Upstream Speech Engine: OmniVoice
* **Repository**: `https://github.com/k2-fsa/OmniVoice.git`
* **Clone Verification Path**: `voiceforge-work/OmniVoice`
* **Default Branch**: `main`
* **Checked-out Branch**: `main`
* **HEAD Commit SHA**: `08be0b4ccbac3e13e374e86fbfead4b4cac343e2`
* **Commit Date / Author**: `Mon Aug 24 05:03:01 2026 +0200` / `润心 <maosicheng98@gmail.com>`
* **Commit Subject**: `Fix: type of input waveform in process method in denoise_audio.py (#254)`
* **License**: Apache License 2.0 (Copyright (c) 2026 k2-fsa authors)
* **Role**: Upstream mass-multilingual diffusion zero-shot text-to-speech inference engine.
* **Packaging & Manifest**: `pyproject.toml` (version `0.2.1`, requires Python `>=3.10`, `torch>=2.4`, `torchaudio>=2.4`, `transformers>=5.3.0`, `accelerate`, `soundfile`, `numpy`).

### 1.3 Creative Reference Collection: awesome-opus5-5-videos
* **Repository**: `https://github.com/yihui-dev/awesome-opus5-5-videos.git`
* **Clone Verification Path**: `voiceforge-work/awesome-opus5-5-videos`
* **Default Branch**: `main`
* **Checked-out Branch**: `main`
* **HEAD Commit SHA**: `92aee2f586ac0715cb3cbcb6384834f98a33383d`
* **Commit Date / Author**: `Tue Oct 13 22:46:40 2026 +0800` / `yihui <leetanghui424@gmail.com>`
* **Commit Subject**: `Remove 150 entries not made from a plain Opus 5.5 prompt (703 total)`
* **License**: MIT License (Copyright (c) 2026 yihui-dev)
* **Role**: Creative and algorithmic design reference for coded motion-graphics, HTML5 Canvas animation, Web Audio visualization, and timeline composition. Not a model weights repository.

---

## 2. Dependency Manifest & Licensing Matrix

| Component | Source / Package | Declared License | Permitted Commercial Use | Attribution Requirement |
| :--- | :--- | :--- | :--- | :--- |
| **VoiceForge Application** | Local / `Voice-clone` | MIT | Yes | Maintain copyright notice |
| **OmniVoice Engine Source** | `k2-fsa/OmniVoice` | Apache-2.0 | Yes | Include NOTICE, Apache-2.0 license copy |
| **OmniVoice Model Weights** | Hugging Face `k2-fsa/OmniVoice` | Apache-2.0 / Open Access | Yes (under Apache 2.0 terms) | Cite paper (arXiv:2604.00688) |
| **awesome-opus5-5-videos** | `yihui-dev/awesome-opus5-5-videos` | MIT | Reference code only | Keep creator attribution for reference patterns |
| **PyTorch & TorchAudio** | `pytorch.org` (2.4+) | BSD-3-Clause | Yes | Standard BSD notice |
| **Transformers** | Hugging Face (`>=5.3.0`) | Apache-2.0 | Yes | Apache-2.0 notice |
| **SoundFile / libsndfile** | `soundfile` / `libsndfile` | BSD-3-Clause / LGPL | Yes (dynamic link) | Maintain copyright notice |
| **React 19** | Meta Open Source | MIT | Yes | MIT notice |
| **Vite 8** | Yuxi (Evan) You & Vite contributors | MIT | Yes | MIT notice |
| **Express 4** | StrongLoop / OpenJS | MIT | Yes | MIT notice |
| **Drizzle ORM** | Drizzle Team | Apache-2.0 | Yes | Apache-2.0 notice |
| **Google GenAI SDK** | `@google/genai` | Apache-2.0 | Yes | Apache-2.0 notice |

---

## 3. Upstream Engine Architecture & Integration Strategy

### 3.1 OmniVoice Architecture Findings
1. **Model Loader**:
   ```python
   from omnivoice import OmniVoice, VoiceClonePrompt
   model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cuda:0", dtype=torch.float16)
   ```
2. **Execution Modes**:
   - **Zero-Shot Voice Cloning**: `model.generate(text=..., ref_audio=..., ref_text=...)`
   - **Prompt Serialization & Reuse**: `prompt = model.create_voice_clone_prompt(...)` -> `prompt.save("voice.pt")`
   - **Voice Design**: `model.generate(text=..., instruct="female, low pitch, british accent")`
   - **Auto Voice**: `model.generate(text=...)`
3. **Hardware Strategy**:
   - CUDA / NVIDIA GPU is primary target for sub-0.03 RTF.
   - CPU / MPS fallback is supported with float32 for testing/dev environments.
   - Containerization via dedicated Python microservice (`services/omnivoice/`).

### 3.2 Visual Studio Reference Strategy
- The 703 reference entries in `awesome-opus5-5-videos` demonstrate procedural animations without external video generation APIs.
- Techniques extracted into VoiceForge Visual Studio:
  - Web Audio `AnalyserNode` FFT reactive waveforms and frequency spectrum ribbons.
  - Procedural Canvas 2D particle dynamics.
  - SVG and CSS kinetic typography for word-by-word synchronized subtitles.
  - Client-side MediaStream / Canvas compositing for offline MP4/WebM video export.
