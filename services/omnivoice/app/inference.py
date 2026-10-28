"""
Inference orchestration: maps validated requests onto the verified OmniVoice
0.2.1 API (see THIRD_PARTY_INVENTORY.md §3) and manages the reusable
voice-clone prompt store.

Honesty rules:
- Only real model output is ever returned. If the model cannot load, callers
  get ModelUnavailableError (HTTP 503) — never a synthesized substitute.
- Cancellation is cooperative around the blocking generate() call: a single
  diffusion generate cannot be interrupted mid-flight; we check the cancel
  registry immediately before and after, and report that limitation.
"""

from __future__ import annotations

import base64
import json
import os
import threading
import time
from dataclasses import dataclass
from typing import Optional

import numpy as np

from . import safety
from .audio_processing import TARGET_SAMPLE_RATE, analyze_reference, decode_audio, encode_wav
from .config import ServiceConfig
from .model_manager import ModelManager, ModelUnavailableError
from .schemas import TTSRequest


class PromptNotFoundError(KeyError):
    pass


class PromptRevokedError(PermissionError):
    pass


# --------------------------------------------------------------------------
# Voice-clone prompt store (VoiceClonePrompt .pt files + JSON sidecar metadata)
# --------------------------------------------------------------------------

class PromptStore:
    def __init__(self, root_dir: str):
        self.root = os.path.abspath(root_dir)
        os.makedirs(self.root, exist_ok=True)
        self._lock = threading.Lock()

    def _pt_path(self, prompt_id: str) -> str:
        return os.path.join(self.root, f"{prompt_id}.pt")

    def _meta_path(self, prompt_id: str) -> str:
        return os.path.join(self.root, f"{prompt_id}.json")

    def _safe_id(self, prompt_id: str) -> str:
        # Schema already restricts to [A-Za-z0-9_-]{1,128}; belt & braces:
        if not prompt_id or "/" in prompt_id or "\\" in prompt_id or ".." in prompt_id:
            raise PromptNotFoundError(prompt_id)
        return prompt_id

    def exists(self, prompt_id: str) -> bool:
        prompt_id = self._safe_id(prompt_id)
        return os.path.isfile(self._pt_path(prompt_id))

    def meta(self, prompt_id: str) -> dict:
        prompt_id = self._safe_id(prompt_id)
        mp = self._meta_path(prompt_id)
        if not os.path.isfile(mp):
            raise PromptNotFoundError(prompt_id)
        with open(mp, "r", encoding="utf-8") as f:
            return json.load(f)

    def save(self, prompt_id: str, prompt_obj, *, ref_text_present: bool, ref_duration: Optional[float],
             sample_rate: Optional[int], model_id: str, analysis: Optional[dict]) -> dict:
        prompt_id = self._safe_id(prompt_id)
        with self._lock:
            pt = self._pt_path(prompt_id)
            prompt_obj.save(pt)  # upstream VoiceClonePrompt.save (format-versioned)
            meta = {
                "prompt_id": prompt_id,
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "ref_text_present": ref_text_present,
                "ref_duration_seconds": ref_duration,
                "sample_rate": sample_rate,
                "model_id": model_id,
                "stored_bytes": os.path.getsize(pt),
                "revoked": False,
                "reference_analysis": analysis,
            }
            with open(self._meta_path(prompt_id), "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2)
        return meta

    def revoke(self, prompt_id: str) -> dict:
        prompt_id = self._safe_id(prompt_id)
        with self._lock:
            meta = self.meta(prompt_id)
            meta["revoked"] = True
            meta["revoked_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            # Destroy the tensor file immediately; keep metadata for audit.
            pt = self._pt_path(prompt_id)
            if os.path.isfile(pt):
                os.remove(pt)
            with open(self._meta_path(prompt_id), "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2)
        return meta

    def load_prompt(self, prompt_id: str):
        """Load the upstream VoiceClonePrompt object. Refuses revoked prompts."""
        prompt_id = self._safe_id(prompt_id)
        meta = self.meta(prompt_id)
        if meta.get("revoked"):
            raise PromptRevokedError(prompt_id)
        pt = self._pt_path(prompt_id)
        if not os.path.isfile(pt):
            raise PromptNotFoundError(prompt_id)
        from omnivoice import VoiceClonePrompt  # lazy: requires torch at runtime

        return VoiceClonePrompt.load(pt)


# --------------------------------------------------------------------------
# Cancellation registry (cooperative; see module docstring)
# --------------------------------------------------------------------------

class CancelRegistry:
    def __init__(self) -> None:
        self._cancelled: set[str] = set()
        self._lock = threading.Lock()

    def cancel(self, token: str) -> None:
        with self._lock:
            self._cancelled.add(token)

    def is_cancelled(self, token: Optional[str]) -> bool:
        if not token:
            return False
        with self._lock:
            return token in self._cancelled

    def clear(self, token: str) -> None:
        with self._lock:
            self._cancelled.discard(token)


class JobCancelledError(RuntimeError):
    pass


# --------------------------------------------------------------------------
# Generation
# --------------------------------------------------------------------------

@dataclass
class GenerationResult:
    wav_bytes: bytes
    sample_rate: int
    duration_seconds: float
    device: str
    dtype: str
    model_id: str
    model_revision: str
    omnivoice_version: str
    params_echo: dict
    warnings: list[str]
    generation_time_ms: int


def generate_speech(
    manager: ModelManager,
    store: PromptStore,
    cancels: CancelRegistry,
    req: TTSRequest,
    cfg: ServiceConfig,
) -> GenerationResult:
    warnings: list[str] = []

    cleaned = safety.clean_text(req.text, max_chars=cfg.max_text_chars)
    warnings.extend(cleaned.warnings)
    language = safety.validate_language(req.language)
    instruct = None
    if req.instruct is not None:
        instruct = req.instruct.strip()
        warnings.extend(safety.validate_instruct(instruct))
        warnings.append(
            "Voice design is trained on Chinese & English data; expect reduced stability "
            "in other languages (upstream docs/voice-design.md)."
        )

    params = safety.validate_generation_params(req.model_dump())
    param_warnings = params.pop("_warnings", [])
    warnings.extend(param_warnings)

    if cancels.is_cancelled(req.cancel_token):
        raise JobCancelledError("Job was cancelled before generation started.")

    bundle = manager.ensure_loaded()  # raises ModelUnavailableError honestly
    model = bundle["model"]
    sample_rate = int(bundle.get("sampling_rate") or TARGET_SAMPLE_RATE)

    kwargs: dict = {"text": cleaned.text}
    if language:
        kwargs["language"] = language
    if instruct:
        kwargs["instruct"] = instruct
    for key in ("num_step", "guidance_scale", "speed", "duration", "normalize_text", "denoise", "postprocess_output"):
        if key in params:
            kwargs[key] = params[key]
    if req.voice_prompt_id:
        kwargs["voice_clone_prompt"] = store.load_prompt(req.voice_prompt_id)

    acquired = manager.concurrency_gate().acquire(timeout=120)
    if not acquired:
        raise ModelUnavailableError(
            "GPU concurrency limit reached (queue timeout). Retry later or raise OMNIVOICE_MAX_CONCURRENCY.",
            code="ENGINE_BUSY",
        )
    try:
        if cancels.is_cancelled(req.cancel_token):
            raise JobCancelledError("Job was cancelled while queued.")
        t0 = time.perf_counter()
        audios = model.generate(**kwargs)  # verified upstream API → list[np.ndarray] @ sampling_rate
        gen_ms = int((time.perf_counter() - t0) * 1000)
    finally:
        manager.concurrency_gate().release()

    if cancels.is_cancelled(req.cancel_token):
        raise JobCancelledError("Job was cancelled; generated audio discarded.")
    if req.cancel_token:
        cancels.clear(req.cancel_token)

    if not isinstance(audios, (list, tuple)) or len(audios) == 0:
        raise ModelUnavailableError("Model returned no audio (empty result list).", code="ENGINE_ERROR")
    wav_np = np.asarray(audios[0], dtype=np.float32)
    if wav_np.ndim != 1 or wav_np.size == 0:
        raise ModelUnavailableError("Model returned an empty or non-1-D waveform.", code="ENGINE_ERROR")

    wav_bytes = encode_wav(wav_np, sample_rate)
    duration = wav_np.size / float(sample_rate)

    return GenerationResult(
        wav_bytes=wav_bytes,
        sample_rate=sample_rate,
        duration_seconds=round(duration, 3),
        device=str(bundle.get("device")),
        dtype=str(bundle.get("dtype")),
        model_id=cfg.model_id,
        model_revision=cfg.model_revision,
        omnivoice_version=str(bundle.get("omnivoice_version", "unknown")),
        params_echo={k: v for k, v in kwargs.items() if k not in ("text", "voice_clone_prompt")},
        warnings=warnings,
        generation_time_ms=gen_ms,
    )


def create_clone_prompt(
    manager: ModelManager,
    store: PromptStore,
    cfg: ServiceConfig,
    *,
    prompt_id: str,
    audio_b64: str,
    ref_text: Optional[str],
) -> dict:
    """Validate the reference audio, then create + persist a reusable
    VoiceClonePrompt via the documented upstream mechanism."""
    try:
        raw = base64.b64decode(audio_b64, validate=True)
    except Exception as exc:
        raise ValueError(f"audio_base64 is not valid base64: {exc}") from exc
    if len(raw) > cfg.max_upload_bytes:
        raise ValueError(f"reference audio exceeds {cfg.max_upload_bytes // (1024 * 1024)} MB limit")

    analysis = analyze_reference(
        raw,
        min_seconds=cfg.ref_min_seconds,
        recommended_seconds=cfg.ref_recommended_seconds,
        max_seconds=cfg.ref_max_seconds,
        min_snr_db=cfg.ref_min_snr_db,
        max_clipping_ratio=cfg.ref_max_clipping_ratio,
        max_silence_ratio=cfg.ref_max_silence_ratio,
    )
    if not analysis.is_valid:
        raise ValueError("Reference audio failed quality validation: " + " ".join(analysis.feedback))

    bundle = manager.ensure_loaded()
    model = bundle["model"]
    wav, sr = decode_audio(raw)

    # Upstream accepts (waveform_tensor, sample_rate); pass numpy — create_voice_clone_prompt
    # converts torch tensors, but accepts ndarray paths through its numpy handling. To stay
    # strictly within the verified API we pass a torch tensor when torch is present.
    torch = bundle.get("torch")
    ref_audio = (torch.from_numpy(wav), sr) if torch is not None else (wav, sr)

    prompt_obj = model.create_voice_clone_prompt(
        ref_audio=ref_audio,
        ref_text=ref_text.strip() if ref_text else None,  # None → Whisper auto-transcription upstream
        preprocess_prompt=True,
    )
    return store.save(
        prompt_id,
        prompt_obj,
        ref_text_present=bool(ref_text and ref_text.strip()),
        ref_duration=analysis.duration_seconds,
        sample_rate=analysis.sample_rate,
        model_id=cfg.model_id,
        analysis=analysis.to_dict(),
    )
