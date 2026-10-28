"""
VoiceForge OmniVoice service configuration.

All knobs are environment-driven; defaults are honest and conservative:
- No model is loaded at import time (lazy load on first use / warmup).
- CPU inference is refused by default (a diffusion LM on CPU is not a
  production path); set VOICEFORGE_ALLOW_CPU_INFERENCE=true to override
  for experiments. Limits follow upstream guidance (3-10 s reference
  audio recommended; >20 s auto-trimmed by OmniVoice itself).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env_bool(name: str, default: bool = False) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@dataclass
class ServiceConfig:
    # --- model identity (pinned; see THIRD_PARTY_INVENTORY.md) ---
    model_id: str = field(default_factory=lambda: os.environ.get("OMNIVOICE_MODEL_ID", "k2-fsa/OmniVoice"))
    model_revision: str = field(default_factory=lambda: os.environ.get("OMNIVOICE_MODEL_REVISION", ""))
    asr_model_name: str = field(
        default_factory=lambda: os.environ.get("OMNIVOICE_ASR_MODEL", "openai/whisper-large-v3-turbo")
    )
    asr_device: str = field(default_factory=lambda: os.environ.get("OMNIVOICE_ASR_DEVICE", ""))

    # --- hardware ---
    device: str = field(default_factory=lambda: os.environ.get("OMNIVOICE_DEVICE", "auto"))  # auto|cuda:N|mps|xpu|cpu
    dtype: str = field(default_factory=lambda: os.environ.get("OMNIVOICE_DTYPE", "auto"))  # auto|float16|bfloat16|float32
    allow_cpu_inference: bool = field(default_factory=lambda: _env_bool("VOICEFORGE_ALLOW_CPU_INFERENCE", False))
    max_concurrency: int = field(default_factory=lambda: _env_int("OMNIVOICE_MAX_CONCURRENCY", 1))

    # --- request limits (VoiceForge API policy, not upstream hard limits) ---
    max_text_chars: int = field(default_factory=lambda: _env_int("VOICEFORGE_MAX_TEXT_CHARS", 5000))
    max_output_seconds: float = field(default_factory=lambda: _env_float("VOICEFORGE_MAX_OUTPUT_SECONDS", 600.0))
    max_upload_bytes: int = field(default_factory=lambda: _env_int("VOICEFORGE_MAX_UPLOAD_BYTES", 25 * 1024 * 1024))

    # --- reference audio policy (upstream: 3-10 s recommended, >20 s trimmed) ---
    ref_min_seconds: float = field(default_factory=lambda: _env_float("VOICEFORGE_REF_MIN_SEC", 3.0))
    ref_recommended_seconds: float = field(default_factory=lambda: _env_float("VOICEFORGE_REF_RECOMMENDED_SEC", 10.0))
    ref_max_seconds: float = field(default_factory=lambda: _env_float("VOICEFORGE_REF_MAX_SEC", 20.0))
    ref_min_snr_db: float = field(default_factory=lambda: _env_float("VOICEFORGE_REF_MIN_SNR_DB", 15.0))
    ref_max_clipping_ratio: float = field(default_factory=lambda: _env_float("VOICEFORGE_REF_MAX_CLIP", 0.01))
    ref_max_silence_ratio: float = field(default_factory=lambda: _env_float("VOICEFORGE_REF_MAX_SILENCE", 0.6))

    # --- storage ---
    prompt_store_dir: str = field(
        default_factory=lambda: os.environ.get("VOICEFORGE_PROMPT_STORE", os.path.join(os.path.dirname(__file__), "..", "data", "prompts"))
    )
    cors_origins: str = field(default_factory=lambda: os.environ.get("VOICEFORGE_CORS_ORIGINS", "*"))

    # --- service identity ---
    engine_name: str = "omnivoice"
    service_version: str = "0.1.0"
    pinned_upstream_git: str = "08be0b4ccbac3e13e374e86fbfead4b4cac343e2"  # == omnivoice 0.2.1 on PyPI


def get_config() -> ServiceConfig:
    return ServiceConfig()
