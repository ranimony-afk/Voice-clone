# MODEL_AND_MEDIA_LICENSES.md — VoiceForge 2.0 (M0 license matrix)

Audit date: 2026-10-23. Verification key:

- **VERIFIED** = license text or machine-readable license field read directly (clone, PyPI, or GitHub API) during this audit.
- **REPORTED** = claimed by upstream docs/metadata; primary source not yet read.
- **UNVERIFIED / BLOCKED** = primary source unreachable from the audit sandbox; must be verified before the dependent release gate passes.

This matrix exists because a repository license does **not** automatically grant rights to model
weights, datasets, hot-linked media, or creator-owned content referenced by that repository.

---

## 1. Code licenses

| Component | Version/SHA | License | Status | Evidence / obligation |
|---|---|---|---|---|
| VoiceForge app (this repo) | `73c9948` | **none declared** | GAP | No LICENSE file at repo root. Owner must choose before any external distribution (M9). |
| k2-fsa/OmniVoice (source) | `08be0b4c` / PyPI 0.2.1 | Apache-2.0 | VERIFIED | `LICENSE` file + `pyproject.toml license = "Apache-2.0"`. Obligations: retain license/copyright/patent notices in redistributed images; state changes (Apache-2.0 §4). Commercial use permitted. |
| yihui-dev/awesome-opus5-5-videos | `92aee2f5` | MIT (© 2026 yihui-dev) | VERIFIED | `LICENSE` file + GitHub API `license.spdx_id=MIT`. Covers README/JSON/prompt text only — see §4 for media. |
| express, react, vite, tailwind, motion, dotenv | see THIRD_PARTY_INVENTORY §6 | MIT / ISC / Apache-2.0 | REPORTED (well-known SPDX) | Standard npm notice bundling in M9. |
| typescript | 7.0.2 | Apache-2.0 | REPORTED | |
| @google/genai | 2.x | Apache-2.0 | REPORTED | Dependency slated for **removal** (dead code) in M1 — will drop from matrix then. |
| WeTextProcessing (`omnivoice[tn]`) | upstream-pinned | Apache-2.0 | REPORTED | Only in inference image if `[tn]` extra enabled. |
| num2words (`omnivoice[tn]`) | upstream-pinned | **LGPL-2.1** | REPORTED | LGPL use as unmodified library via normal import is compliant; do **not** statically link/modify without care. Document in NOTICE. |
| jiwer / s3prl / funasr / zhconv / zhon / unidecode (`[eval]`) | upstream-pinned | mixed (Apache-2.0/MIT/BSD) | REPORTED | Eval-only; never shipped in runtime images. |
| flashinfer-python | 0.6.15.post1 | Apache-2.0 | REPORTED — verify at install in M2 | Optional NVIDIA acceleration. |

## 2. Model weights (the critical section)

| Weights | Publisher | Needed by | License | Status | Notes |
|---|---|---|---|---|---|
| `k2-fsa/OmniVoice` | k2-fsa (HF) | all synthesis | **?** | **BLOCKED** — huggingface.co unreachable from audit sandbox (`SSL_ERROR_SYSCALL`) | Must read HF model-card `license:` field in M2 before deployment. Repo Apache-2.0 covers *code*; k2-fsa projects sometimes use separate weight terms. Do not assume. |
| `eustlb/higgs-audio-v2-tokenizer` | eustlb / Boson AI ecosystem (HF) | audio tokenizer (auto-download) | **?** | **BLOCKED** — same | Third-party weight dependency pulled implicitly by `from_pretrained`; treat as its own license line item. |
| `openai/whisper-large-v3-turbo` | OpenAI (HF) | ref-audio auto-transcription | MIT (reported) | **BLOCKED** — verify model card in M2 | Whisper code+weights historically MIT; confirm for the v3-turbo checkpoint. |
| Training data provenance of OmniVoice (581k h, 646 langs incl. Emilia) | upstream paper/dataset | — | **?** | UNVERIFIED | Relevant for commercial-risk assessment; upstream README disclaimer places compliance duty on deployers. Record as residual risk (SECURITY.md later). |

**Rule adopted:** no gate that depends on weight licensing passes until the HF model-card license
fields are captured (screenshot/JSON) into this file. A BLOCKED row stays BLOCKED — it is never
rewritten to PASS without evidence.

## 3. Datasets & evaluation media

| Item | Use | Status |
|---|---|---|
| seed-tts eval set (referenced in upstream benchmarks) | comparison only; not redistributed | n/a to us unless M5 re-runs their bench — then verify dataset terms |
| VoiceForge M5 evaluation sentences (`docs/EVALUATION_BENCHMARK_SPEC.md`) | internal test text | Original text, no third-party rights; outputs are model-generated (see §5) |
| Any reference audio used in demos/tests | cloning tests | Must be **self-recorded or licensed with written consent**; never scraped celebrity/third-party audio. Enforced by consent workflow (M4). |

## 4. Media & branding from the video collection

| Item | Rights | VoiceForge policy |
|---|---|---|
| 703 prompts (`prompts/*.md`, `data/videos.json`) | MIT collection, but each prompt authored by its creator | Read for research. No verbatim copying into product UI/docs without attribution; no bulk republication. |
| Preview videos/posters on `media.skillry.dev`, originals on X/Twitter | **Creator-owned / Skillry-hosted — NOT covered by the repo MIT license** | Do not download, hot-link, embed, re-host, or re-publish. Reference by link with creator attribution when studied. |
| "Skillry" name, branding, site design | Skillry | Do not clone or imitate. VoiceForge Visual Studio ships only original templates. |

## 5. Rights in VoiceForge-generated output

- Generated speech: rights/obligations follow the OmniVoice weight license (BLOCKED pending §2) and
  applicable law; the upstream **Disclaimer** prohibits unauthorized cloning, impersonation, fraud.
  VoiceForge enforces this via consent gating (M4) and abuse controls (M8), and must label AI-generated
  media (provenance strategy — signed metadata now, real audio watermarking evaluated in M8; the
  current length-check "watermark" is removed in M1 as fraudulent).
- Rendered videos: composites of user text, user-consented voice audio, and original VoiceForge
  template code → no third-party media embedded; fonts under OFL 1.1 (self-host or keep Google Fonts
  hot-link with its license intact).

## 6. Attribution file (to ship with product)

A `NOTICE` / third-party notices screen will be generated in M9 bundling: OmniVoice Apache-2.0 notice
+ citation (Zhu et al., arXiv:2604.00688), num2words LGPL notice, npm license notices, Google Fonts
OFL, and the awesome-opus5-5-videos MIT + creator-credits statement for any studied techniques.
