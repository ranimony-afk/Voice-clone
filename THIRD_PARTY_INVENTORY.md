# THIRD_PARTY_INVENTORY.md — VoiceForge 2.0 (M0)

Status: **M0 audit artifact** — generated 2026-10-23 from live clones and the GitHub/PyPI APIs.
No content in this file is aspirational; every row was verified by direct inspection on the audit date.

---

## 1. Pinned upstream identities

| Repository | Role | Default branch | Pinned commit SHA | Commit date | Verified via |
|---|---|---|---|---|---|
| `https://github.com/k2-fsa/OmniVoice` | Primary speech engine (TTS / voice cloning / voice design) | `master` | `08be0b4ccbac3e13e374e86fbfead4b4cac343e2` | 2026-08-24 | `git clone` + `git rev-parse HEAD`; cross-checked against `api.github.com/repos/k2-fsa/OmniVoice/commits` |
| `https://github.com/yihui-dev/awesome-opus5-5-videos` | Creative **reference collection** for Visual Studio (research only, not a dependency) | `main` | `92aee2f586ac0715cb3cbcb6384834f98a33383d` | 2026-10-13 | `git clone` + `git rev-parse HEAD`; cross-checked against GitHub API |

Local audit checkouts (NOT committed to VoiceForge; `third_party/` is git-ignored):

```text
third_party/OmniVoice                    3.0 MB  @ 08be0b4c
third_party/awesome-opus5-5-videos       5.0 MB  @ 92aee2f5
```

Neither clone contains model-weight binaries (`*.pt`, `*.bin`, `*.safetensors`): OmniVoice downloads
weights at runtime from Hugging Face (see §4).

---

## 2. Dependency strategy decision (ADR-001)

**Decision: pin `omnivoice` from PyPI inside a separately versioned inference image. Do NOT vendor
upstream source, do NOT add a git submodule, do NOT commit upstream history.**

Rationale:

1. `omnivoice` is published on PyPI; latest release **0.2.1** exactly matches the pinned source tree
   (`third_party/OmniVoice/pyproject.toml` → `version = "0.2.1"`), so a PyPI pin and the git SHA
   describe the same code. Verified releases on PyPI: `0.1.0 … 0.2.1` (via `pypi.org/pypi/omnivoice/json`).
2. Upstream ships a `uv.lock` (3,468 lines) which we adopt as the reference resolution for the GPU
   inference image (`torch==2.8.0`, `torchaudio==2.8.0`, CUDA 12.8 index — see their `pyproject.toml`).
3. A submodule would couple VoiceForge CI to upstream repo availability and add history bloat; vendoring
   would fork maintenance and break the "do not commit entire upstream histories" rule.
4. The pinned git SHA above is recorded for provenance, license text capture, and CVE tracking even
   though the install path is PyPI.

Pin set for `services/omnivoice` (to be created in M2):

```text
omnivoice==0.2.1                 # upstream git SHA 08be0b4ccbac3e13e374e86fbfead4b4cac343e2
torch==2.8.0 / torchaudio==2.8.0 # +cu128 wheels on GPU image; CPU wheels for unit-test image
transformers>=5.3.0 (per upstream constraint)
```

Optional extras pulled in by features we plan to use:

| Extra | Packages | Used for | License note |
|---|---|---|---|
| `omnivoice[tn]` | `WeTextProcessing`, `num2words` | `normalize_text=True` (numbers/dates/currency) | WeTextProcessing: Apache-2.0. **num2words: LGPL-2.1** — acceptable as a runtime-used library, flagged in license matrix |
| `omnivoice[eval]` | `jiwer==3.1.0`, `s3prl`, `funasr`, `zhconv`, `zhon`, `unidecode` | M5 multilingual evaluation harness only | Not shipped in runtime image |
| `omnivoice[lora]` | `peft>=0.20.0` | Fine-tuning (out of scope for M0–M9) | Not shipped |
| FlashInfer | `flashinfer-python==0.6.15.post1` (+`flashinfer-jit-cache` cu128) | Optional 2–2.9× lossless acceleration, NVIDIA only | Upstream-documented versions; license to verify in M2 |

Base dependencies declared by upstream (all installed automatically with the pin): `torch`,
`torchaudio`, `transformers`, `accelerate`, `pydub`, `gradio`, `tensorboardX`, `webdataset`,
`numpy`, `soundfile`, `librosa`. Note: `gradio`/`tensorboardX`/`webdataset` serve the demo and
training paths; they are hard install-time deps of the wheel. Accepted for M2 (image size cost),
revisit only if image size becomes a deployment problem.

---

## 3. OmniVoice — verified API surface (read from source @ 08be0b4c, not from README alone)

Package exports (`omnivoice/__init__.py`): `OmniVoice`, `OmniVoiceConfig`,
`OmniVoiceGenerationConfig`, `VoiceClonePrompt`.

### 3.1 Model loading — `OmniVoice.from_pretrained` (`omnivoice/models/omnivoice.py:333`)

```python
OmniVoice.from_pretrained(
    "k2-fsa/OmniVoice",          # HF repo; resolved to local cache or downloaded
    device_map="cuda:0",          # "cuda:N" | "mps" | "xpu" | "cpu"
    dtype=torch.float16,
    load_asr=False,               # True → eagerly load Whisper ASR
    asr_model_name=None,          # default "openai/whisper-large-v3-turbo"
    asr_device=None,              # e.g. "cpu" or second GPU
    train=False,
)
```

At load time it also fetches the audio tokenizer **`eustlb/higgs-audio-v2-tokenizer`** (unless bundled
in the model repo dir). Output sampling rate = tokenizer feature-extractor rate (**24 kHz**, exposed as
`model.sampling_rate`). Higgs tokenizer is force-loaded on CPU under MPS (no MPS support upstream).

### 3.2 Generation — `model.generate` (`omnivoice/models/omnivoice.py:584`)

```python
audios: list[np.ndarray] = model.generate(
    text,                        # str or list[str] (batch)
    language=None,               # name ("English") or code ("en"); slight quality boost when set
    ref_text=None, ref_audio=None,          # voice cloning (path str or (torch.Tensor, sr) tuple)
    voice_clone_prompt=None,                # reusable prompt; overrides ref_text/ref_audio
    instruct=None,                          # voice design, e.g. "female, low pitch, british accent"
    duration=None, speed=None,              # float or per-item list; duration overrides speed
    normalize_text=False,                   # requires omnivoice[tn]
    generation_config=None, **kwargs,
)
```

Verified generation-config fields (docs/generation-parameters.md + dataclass source): `num_step` (32),
`denoise` (True), `guidance_scale` (2.0), `t_shift` (0.1), `position_temperature` (5.0),
`class_temperature` (0.0), `layer_penalty_factor` (5.0), `preprocess_prompt` (True),
`postprocess_output` (True), `pad_duration` (0.1), `fade_duration` (0.1), `audio_chunk_duration` (15.0),
`audio_chunk_threshold` (30.0 — long-form auto-chunking above this estimated duration, near-constant VRAM).

Three modes, one API: **voice cloning** (`voice_clone_prompt` or `ref_audio`[+`ref_text`]), **voice
design** (`instruct`), **auto voice** (neither).

### 3.3 Reusable clone prompts — `create_voice_clone_prompt` (`omnivoice/models/omnivoice.py:729`)

```python
prompt = model.create_voice_clone_prompt(ref_audio, ref_text=None, preprocess_prompt=True)
prompt.save("voice.pt");  VoiceClonePrompt.load("voice.pt")   # format-version-checked dict
```

`VoiceClonePrompt` = `{ref_audio_tokens: Tensor (C,T), ref_text: str, ref_rms: float}`. Verified
behaviors in source: mono down-mix, resample to 24 kHz, RMS boost when `0 < rms < 0.1`, silence
removal (200/100/200 ms), auto-trim at largest silence gap when > 20 s **and** `ref_text is None`,
`ValueError` if audio is empty after silence removal. `ref_text=None` → Whisper auto-transcription
(`load_asr_model()` required; default `openai/whisper-large-v3-turbo`).

Upstream guidance (README/tips): **3–10 s reference clips**; longer audio slows inference and may
degrade quality; same-language reference for standard pronunciation (cross-lingual clones carry the
reference language's accent); short 1–2 s outputs are unreliable without reference audio.

### 3.4 Voice design attributes (docs/voice-design.md) — trained on **Chinese + English only**

| Category | Values |
|---|---|
| gender | male / female (男/女) |
| age | child, teenager, young adult, middle-aged, elderly |
| pitch | very low / low / moderate / high / very high pitch |
| style | whisper |
| English accent (EN text only) | american, british, australian, canadian, **indian**, chinese, korean, japanese, portuguese, russian |
| Chinese dialect (ZH text only) | 河南话, 陕西话, 四川话, 贵州话, 云南话, 桂林话, 济南话, 石家庄话, 甘肃话 |

Upstream explicitly warns: voice design generalizes to other languages but "may produce unstable
results for some low-resource languages or edge cases" → VoiceForge must label voice design as
zh/en-first in the UI (planned M5).

### 3.5 Fine-grained text control (README, verified as documented behavior)

- Non-verbal tags: `[laughter] [sigh] [confirmation-en] [question-en] [question-ah] [question-oh]
  [question-ei] [question-yi] [surprise-ah] [surprise-oh] [surprise-wa] [surprise-yo]
  [dissatisfaction-hnn]`
- Pronunciation: pinyin+tone-number inline (Chinese); CMU-dict uppercase bracketed, e.g. `[B EY1 S]` (English).
- CLI: `omnivoice-infer`, `omnivoice-infer-batch` (multi-GPU JSONL batch, optional
  `--enable_flashinfer true`), `omnivoice-demo` (Gradio), `omnivoice-merge-lora`.
- `ref_audio` + `instruct` together: reference wins on conflict; consistent instruct improves stability (docs/tips.md).

### 3.6 Language coverage for VoiceForge targets (docs/languages.md, 646 languages, 581k h total)

| Language | OmniVoice ID | ISO 639-3 | Upstream training hours | Data tier |
|---|---|---|---:|---|
| English | `en` | eng | (high-resource; see languages.md) | Tier 1 |
| Japanese | `ja` | jpn | **36,914.4 h** | Tier 1 |
| Chinese | `zh` | cmn | (high-resource) | Tier 1 |
| Tamil | `ta` | tam | **423.1 h** | Tier 2 — usable, empirically evaluate in M5 |
| Malayalam | `ml` | mal | **166.6 h** | Tier 3 — lowest of our targets; evaluate before promising |
| Hindi | `hi` | hin | **117.2 h** | Tier 3 — note: fewer hours than Tamil despite larger speaker base |

Consequence for planning: the legacy app's claim of "flawless Tamil / native Devanagari cadence" is
not backed by engine selection; with OmniVoice, **ja/en are the strong targets, ta is plausible,
hi/ml need empirical validation** (M5 evaluation gate, honest reporting required).

### 3.7 Hardware & runtime facts (from README/pyproject)

- NVIDIA: torch 2.8.0+cu128; `device_map="cuda:N"`; fp16. Intel Arc XPU supported (falls back to SDPA).
- Apple Silicon: `device_map="mps"`, torch 2.8.0 (no CUDA on macOS); Higgs tokenizer runs on CPU there.
- Benchmarks (single H100, fp16, num_step=32, seed-tts zh): baseline RTF 0.0899 @ batch 1 →
  0.0115 @ batch 8 with FlashInfer (2.6×). README headline: RTF as low as 0.025.
- Model weights are **not** in the git repo; runtime download from HF (`k2-fsa/OmniVoice`,
  `eustlb/higgs-audio-v2-tokenizer`, optionally `openai/whisper-large-v3-turbo`).

---

## 4. Model weights required at runtime (download gate)

| Weight | Source | Needed for | Reachable from audit sandbox? | License status |
|---|---|---|---|---|
| `k2-fsa/OmniVoice` | huggingface.co | All synthesis | **NO** (huggingface.co blocked: `SSL_ERROR_SYSCALL`) | **UNVERIFIED** — must read HF model-card license field before any deployment (M2 gate) |
| `eustlb/higgs-audio-v2-tokenizer` | huggingface.co | Audio tokenization (auto-downloaded by `from_pretrained`) | NO | **UNVERIFIED** |
| `openai/whisper-large-v3-turbo` | huggingface.co | `ref_text` auto-transcription | NO | Reported MIT (OpenAI Whisper); **UNVERIFIED** here |

Upstream README carries an explicit **Disclaimer** prohibiting unauthorized voice cloning,
impersonation, fraud/scams; VoiceForge's consent workflow (§6 of the master plan) must implement it,
not just quote it.

---

## 5. awesome-opus5-5-videos — content audit (@ 92aee2f5)

- **What it is:** an index of 703 creator-made "Claude Opus 5.5" animation videos with the prompts
  behind them; 418 have live remakes on skillry.dev. It contains **no models, no code libraries, no
  renderable media** — only `README.md`, `data/videos.json`, and 703 `prompts/*.md` text files.
- **Structure of `data/videos.json`** (verified): list of 703 objects with keys
  `slug, author, author_url, post_url, category, tech_tags, prompt, prompt_partial, poster_url,
  skillry_url, added, has_remake`.
- **Categories:** motion 369, 3d 117, explainer 116, interactive 101.
- **Tech tags:** canvas 267, svg 183, threejs 131, shader 92, gsap 86, css 57, **audio 39**,
  playable 22, **particles 17**, pixel 15, webgl 9, physics 9, ai-image 6.
- 207 of 703 prompts are marked `prompt_partial: true` (creator shared only part).
- Preview posters/clips are hot-linked to `media.skillry.dev`; originals live in creator X/Twitter posts.

**Usage decision (ADR-002):** research & inspiration only. VoiceForge Visual Studio (M6/M7) will
implement **original** audio-reactive and motion-graphics templates (Canvas/SVG/CSS/Web Audio; GSAP
and Three.js only where justified). We will NOT copy prompts verbatim into the product, NOT
hot-link/re-publish creator videos or posters, NOT clone Skillry branding or presentation. Where a
technique pattern is studied from an entry, attribution goes in
`docs/VISUAL_STUDIO_REFERENCES.md` (M6) linking the creator's original post per the collection's
Credits convention.

---

## 6. Existing runtime dependencies of the VoiceForge app (audited from `package.json` @ HEAD)

| Package | Declared | Installed (legacy-peer-deps probe) | License | Note |
|---|---|---|---|---|
| react / react-dom | ^19.0.1 | 19.3.1 | MIT | keep |
| vite | ^8.3.0 | 8.3.5 | MIT | **peer conflict with declared esbuild — breaks clean install (M1 fix)** |
| esbuild (devDep) | ^0.25.0 | 0.25.12 | MIT | vite 8.3.5 wants `^0.27‖^0.28`; remove or bump in M1 |
| typescript (devDep) | ^7.0.2 | 7.0.2 | Apache-2.0 | TS 7 (native); `tsc --noEmit` passes |
| tsx (devDep) | ^4.21.0 | 4.23.15 | MIT | only working server runtime today |
| express | ^4.21.2 | 4.22.3 | MIT | API server |
| dotenv | ^17.2.3 | 17.x | BSD-2 | |
| @tailwindcss/vite, tailwindcss | ^4.3.3 | 4.3.x | MIT | |
| lucide-react | ^0.546.0 | 0.546.x | ISC | icons |
| motion | ^12.23.24 | 12.x | MIT | animation lib already present (usable for Visual Studio) |
| @google/genai | ^2.4.0 | 2.x | Apache-2.0 | **dead code path in current synthesizer; slated for removal in M1** |
| autoprefixer | ^10.4.21 | 10.x | MIT | |
| @types/* | — | — | MIT | |

Fonts: Google Fonts (Inter, Fira Code, Noto Sans Devanagari/JP/Malayalam/Tamil) — SIL OFL 1.1, hot-linked
from `fonts.googleapis.com` in `index.html`. Avatars in `server/data/voices.ts` hot-link
`images.unsplash.com` (Unsplash License) — replace with locally hosted/generated assets in M3.

---

## 7. Notices carried forward

- OmniVoice LICENSE: Apache-2.0 (full text captured in clone; also declared in `pyproject.toml`).
  Apache-2.0 §4 requires preserving copyright/patent notices in derivative distributions →
  inference image must bundle upstream LICENSE + NOTICE behavior.
- awesome-opus5-5-videos LICENSE: MIT © 2026 yihui-dev — covers the **collection text/data**;
  individual videos/prompts remain the property of their creators (repo Credits section), and
  hosted previews belong to Skillry. MIT on the repo does **not** transfer rights to linked media.
- VoiceForge repo itself currently has **no LICENSE file** — flagged as an M9 gap (owner decision).
