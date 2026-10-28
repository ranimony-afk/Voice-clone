# VoiceForge OmniVoice service

Independent FastAPI service wrapping the verified upstream `k2-fsa/OmniVoice` API (`omnivoice==0.2.1`, upstream git `08be0b4ccbac3e13e374e86fbfead4b4cac343e2`, Apache-2.0). See root `THIRD_PARTY_INVENTORY.md` §3 and `MODEL_AND_MEDIA_LICENSES.md`.

## Honest behavior

- The service boots without torch/model weights, reports `model_available: false`, and serves health/reference-audio analysis.
- Neural routes fail with structured HTTP 503 until the pinned engine and weights are loadable. There is no fake audio fallback.
- Model loads lazily once per process; `/v1/model/warmup` explicitly triggers load. GPU default concurrency is one.
- CPU inference refuses by default. Set `VOICEFORGE_ALLOW_CPU_INFERENCE=true` only for an experiment, never as a silent deployment fallback.
- Local prompt store is for development only. Use encrypted private object storage + DB ownership in production.

## API (adapter contracts)

- `GET /healthz`, `GET /readyz`, `GET /v1/status`
- `POST /v1/tts` — text, optional language/instruct/voice prompt ID and only verified generation parameters (`num_step`, `guidance_scale`, `speed`, `duration`, `normalize_text`, `denoise`, `postprocess_output`). Returns base64 WAV only after real `model.generate()` output.
- `POST /v1/reference/analyze` — actual decoded waveform analysis; no identity/consent determination.
- `POST /v1/clone/prompts` — real upstream `create_voice_clone_prompt`; requires authenticated ownership at API gateway before public exposure.
- `GET|DELETE /v1/clone/prompts/{id}` — local status/revocation; replacement with owner-checked DB/object storage is required before public exposure.
- `POST /v1/model/warmup` — real model load; returns 503 with reason if unavailable.

## Run

```sh
python -m pip install -r requirements.lock
uvicorn app.main:app --host 0.0.0.0 --port 8100
```

For actual inference, install the `[engine]` dependency set and use a supported accelerator, accessible model weights, captured model licenses and adequate GPU memory. `Dockerfile.cpu-test` excludes model weights; `Dockerfile.gpu` is a deployment draft and must be built/validated on a CUDA host before release.
