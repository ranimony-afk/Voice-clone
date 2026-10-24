"""
Pydantic Schemas for OmniVoice 2.0 API Contracts
Covers Text-to-Speech, Voice Cloning, Voice Design, and Voice Prompts.
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    device: str
    cudaAvailable: bool
    modelLoaded: bool
    sampleRate: int

class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, description="Target text to synthesize")
    language: Optional[str] = Field(default="en", description="Language code (e.g. en, hi, ta, ml, ja)")
    instruct: Optional[str] = Field(default=None, description="Voice design instruction (e.g. 'female, low pitch, british accent')")
    voice_prompt_id: Optional[str] = Field(default=None, description="ID of reusable voice clone prompt")
    num_step: Optional[int] = Field(default=32, ge=8, le=64, description="Diffusion steps")
    speed: Optional[float] = Field(default=1.0, ge=0.5, le=2.0, description="Speech rate multiplier")
    duration: Optional[float] = Field(default=None, gt=0, description="Optional fixed target duration in seconds")
    normalize_text: Optional[bool] = Field(default=True, description="Enable number and symbol expansion")

class VoiceCloneRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    ref_audio_base64: str = Field(..., description="Base64-encoded reference WAV/audio sample")
    ref_text: Optional[str] = Field(default=None, description="Optional manual transcript of reference audio")
    voice_name: Optional[str] = Field(default="custom_cloned_voice")
    num_step: Optional[int] = Field(default=32)
    speed: Optional[float] = Field(default=1.0)
    save_prompt: Optional[bool] = Field(default=False, description="Whether to serialize reusable prompt")

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
    mode: str  # 'voice_cloning' | 'voice_design' | 'auto_voice'
