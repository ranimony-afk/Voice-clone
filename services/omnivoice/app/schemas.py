"""Pydantic Schemas for OmniVoice 2.0 API Contracts
Strictly distinguishes operation mode ('auto_voice', 'voice_design', 'voice_prompt', 'voice_cloning')
from execution mode ('NEURAL', 'DEMO', 'UNAVAILABLE').
"""

from typing import Optional, List, Dict, Any

try:
    from pydantic import BaseModel, Field
except ImportError:
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


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    execution_mode: str = "NEURAL"  # "NEURAL" | "DEMO" | "UNAVAILABLE"
    is_neural: bool = False
    device: str
    cudaAvailable: bool
    modelLoaded: bool
    sampleRate: int
    note: Optional[str] = None


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, description="Target text to synthesize")
    language: Optional[str] = Field(default="en", description="Language code (e.g. en, hi, ta, ml, ja)")
    instruct: Optional[str] = Field(default=None, description="Voice design instruction (e.g. 'female, low pitch, warm tone')")
    voice_prompt_id: Optional[str] = Field(default=None, description="ID of reusable voice clone prompt")
    num_step: Optional[int] = Field(default=32, ge=8, le=64, description="Diffusion steps")
    speed: Optional[float] = Field(default=1.0, ge=0.5, le=2.0, description="Speech rate multiplier")
    duration: Optional[float] = Field(default=None, gt=0, description="Optional fixed target duration in seconds")
    normalize_text: Optional[bool] = Field(default=True, description="Enable number and symbol expansion")
    allow_demo: Optional[bool] = Field(default=False, description="Explicitly allow development harmonic fallback if neural weights are offline")


class VoiceCloneRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    ref_audio_base64: str = Field(..., description="Base64-encoded reference WAV/audio sample")
    ref_text: Optional[str] = Field(default=None, description="Optional manual transcript of reference audio")
    voice_name: Optional[str] = Field(default="custom_cloned_voice")
    num_step: Optional[int] = Field(default=32)
    speed: Optional[float] = Field(default=1.0)
    save_prompt: Optional[bool] = Field(default=False, description="Whether to serialize reusable prompt")
    allow_demo: Optional[bool] = Field(default=False, description="Explicitly allow development harmonic fallback if neural weights are offline")


class CreatePromptRequest(BaseModel):
    voice_id: str
    voice_name: str
    ref_audio_base64: str
    ref_text: Optional[str] = None
    user_id: Optional[str] = "user_active"


class VoicePromptResponse(BaseModel):
    prompt_id: str
    voice_id: str
    voice_name: str
    created_at: str
    reference_duration_sec: float
    status: str = "active"


class TTSResponse(BaseModel):
    audio_base64: str
    sample_rate: int = 24000
    duration_seconds: float
    generation_time_ms: int
    rtf: float
    engine: str = "k2-fsa/OmniVoice-v0.2.1"
    is_neural: bool = True
    execution_mode: str = "NEURAL"  # "NEURAL" | "DEMO" | "UNAVAILABLE"
    mode: str = "auto_voice"        # 'auto_voice' | 'voice_design' | 'voice_prompt' | 'voice_cloning'
    saved_prompt_id: Optional[str] = None
    manifest: Optional[Dict[str, Any]] = None
