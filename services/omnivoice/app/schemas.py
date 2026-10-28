"""Pydantic request/response schemas — strict, versioned, honest."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class ErrorDetail(BaseModel):
    code: str = Field(description="Machine-readable error code")
    message: str
    details: Optional[dict] = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


class TTSRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1)
    language: Optional[str] = None
    instruct: Optional[str] = Field(
        default=None,
        description="Voice-design attributes (comma-separated). Trained on zh/en; may be unstable in other languages.",
    )
    voice_prompt_id: Optional[str] = Field(
        default=None,
        description="ID of a stored VoiceClonePrompt created via POST /v1/clone/prompts",
    )
    # Verified upstream generation params only (omnivoice 0.2.1):
    num_step: Optional[int] = Field(default=None, ge=1, le=128)
    guidance_scale: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    speed: Optional[float] = Field(default=None, ge=0.5, le=2.0)
    duration: Optional[float] = Field(default=None, ge=0.5, le=600.0)
    normalize_text: Optional[bool] = None
    denoise: Optional[bool] = None
    postprocess_output: Optional[bool] = None
    cancel_token: Optional[str] = Field(
        default=None, description="Cooperative cancellation handle echoed by the worker"
    )


class TTSResponse(BaseModel):
    audio_base64: str
    format: str = "wav"
    sample_rate: int
    duration_seconds: float
    engine: str = "omnivoice"
    engine_class: str = "neural"
    model_id: str
    model_revision: str = ""
    device: str
    dtype: str
    params_echo: dict
    warnings: list[str] = Field(default_factory=list)
    generation_time_ms: int


class AnalyzeReferenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    audio_base64: str


class AnalyzeReferenceResponse(BaseModel):
    analysis: dict
    analysis_engine: str = "libsndfile+numpy-deterministic"


class ClonePromptCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt_id: str = Field(pattern=r"^[A-Za-z0-9_\-]{1,128}$")
    audio_base64: str
    ref_text: Optional[str] = Field(default=None, max_length=2000)


class ClonePromptStatus(BaseModel):
    prompt_id: str
    created_at: str
    ref_text_present: bool
    ref_duration_seconds: Optional[float] = None
    sample_rate: Optional[int] = None
    stored_bytes: int
    model_id: str
    revoked: bool = False


class StatusResponse(BaseModel):
    service: str
    service_version: str
    engine: str
    pinned_upstream_git: str
    omnivoice_pypi_version_installed: Optional[str] = None
    model_id: str
    model_revision: str
    model_state: Literal['not_loaded', 'loading', 'loaded', 'failed']
    dependencies_ready: Optional[bool] = None
    model_available: bool
    model_loaded: bool
    unavailable_reason: Optional[str] = None
    device: Optional[str] = None
    dtype: Optional[str] = None
    torch_installed: bool
    sampling_rate: Optional[int] = None
    asr_model: str
    limits: dict


class HealthResponse(BaseModel):
    status: str
    timestamp: str
