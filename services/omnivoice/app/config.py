"""
VoiceForge OmniVoice Service Configuration
Handles hardware detection (CUDA, MPS, XPU, CPU), model paths, and environment settings.
"""

import os
from pydantic import BaseModel, Field

class Settings(BaseModel):
    app_name: str = "VoiceForge OmniVoice Inference Service"
    version: str = "0.2.1"
    host: str = Field(default_factory=lambda: os.getenv("HOST", "0.0.0.0"))
    port: int = Field(default_factory=lambda: int(os.getenv("PORT", "8001")))
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
