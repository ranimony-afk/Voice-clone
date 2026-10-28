"""VoiceForge OmniVoice Service Configuration
Handles hardware detection (CUDA, MPS, XPU, CPU), model paths, execution mode, and environment settings.
"""

import os
from typing import Optional

try:
    from pydantic import BaseModel, Field
except ImportError:
    # Minimal fallback shim for environments without pydantic installed
    class BaseModel:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)
        def dict(self):
            return self.__dict__
        def model_dump(self):
            return self.__dict__

    def Field(default=None, default_factory=None, **kwargs):
        if default_factory is not None:
            return default_factory()
        return default


class Settings(BaseModel):
    app_name: str = "VoiceForge OmniVoice Inference Service"
    version: str = "0.2.1"
    host: str = Field(default_factory=lambda: os.getenv("HOST", "0.0.0.0"))
    port: int = Field(default_factory=lambda: int(os.getenv("PORT", "8001")))
    environment: str = Field(default_factory=lambda: os.getenv("ENVIRONMENT", os.getenv("NODE_ENV", "development")).lower())
    
    # Execution mode contract: 'NEURAL' (strict real weights), 'DEMO' (development harmonic), or 'AUTO'
    execution_mode: str = Field(default_factory=lambda: os.getenv("EXECUTION_MODE", "AUTO").upper())
    
    # Allow demo harmonic synthesis only in non-production environments
    allow_demo: bool = Field(default_factory=lambda: (
        os.getenv("ENVIRONMENT", os.getenv("NODE_ENV", "development")).lower() != "production" and
        os.getenv("ALLOW_DEMO", "true").lower() in ("true", "1", "yes")
    ))
    
    # Model & hardware settings
    model_id: str = Field(default_factory=lambda: os.getenv("OMNIVOICE_MODEL_ID", "k2-fsa/OmniVoice"))
    device: str = Field(default_factory=lambda: os.getenv("DEVICE", "auto"))
    dtype: str = Field(default_factory=lambda: os.getenv("DTYPE", "float16"))
    max_text_length: int = Field(default_factory=lambda: int(os.getenv("MAX_TEXT_LENGTH", "2000")))
    max_ref_audio_sec: float = Field(default_factory=lambda: float(os.getenv("MAX_REF_AUDIO_SEC", "30.0")))
    min_ref_audio_sec: float = Field(default_factory=lambda: float(os.getenv("MIN_REF_AUDIO_SEC", "2.0")))
    default_diffusion_steps: int = Field(default_factory=lambda: int(os.getenv("DIFFUSION_STEPS", "32")))
    fast_diffusion_steps: int = Field(default_factory=lambda: int(os.getenv("FAST_DIFFUSION_STEPS", "16")))
    sample_rate: int = 24000
    prompt_storage_dir: str = Field(default_factory=lambda: os.getenv("PROMPT_STORAGE_DIR", "/tmp/voiceforge_prompts"))
    
    # Configured CORS origins
    cors_allowed_origins: str = Field(default_factory=lambda: os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173"
    ))


def detect_device() -> str:
    """Detect available hardware accelerator."""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda:0"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
        if hasattr(torch, "xpu") and torch.xpu.is_available():
            return "xpu"
    except ImportError:
        pass
    return "cpu"


settings = Settings()
if settings.device == "auto":
    settings.device = detect_device()
