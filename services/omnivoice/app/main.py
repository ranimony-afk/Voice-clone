"""
VoiceForge OmniVoice 2.0 FastAPI Microservice Entrypoint
Provides REST endpoints for:
- Live & readiness probes
- Standard TTS (Auto-voice & Voice Design)
- Zero-Shot Voice Cloning
- Reusable Voice Prompt serialization and retrieval
"""

import sys
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.schemas import (
    HealthResponse,
    TTSRequest,
    TTSResponse,
    VoiceCloneRequest,
    CreatePromptRequest,
    VoicePromptResponse,
)
from app.model_manager import model_manager
from app.inference import run_tts, run_voice_clone

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("omnivoice.api")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing OmniVoice service...")
    # Attempt to load model at service startup (non-fatal if offline)
    model_manager.load_model()
    yield
    logger.info("Shutting down OmniVoice service.")

app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description="Production-grade inference service for OmniVoice 600+ language zero-shot TTS and voice cloning.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health/live", response_model=HealthResponse)
def health_live():
    """Liveness probe: verifies process is responsive."""
    return HealthResponse(
        status="live",
        service=settings.app_name,
        version=settings.version,
        device=model_manager.device,
        cudaAvailable=model_manager.device.startswith("cuda"),
        modelLoaded=model_manager.is_loaded,
        sampleRate=settings.sample_rate,
    )

@app.get("/health/ready", response_model=HealthResponse)
def health_ready():
    """Readiness probe: verifies service is ready to accept inference requests."""
    return HealthResponse(
        status="ready" if model_manager.is_loaded else "degraded",
        service=settings.app_name,
        version=settings.version,
        device=model_manager.device,
        cudaAvailable=model_manager.device.startswith("cuda"),
        modelLoaded=model_manager.is_loaded,
        sampleRate=settings.sample_rate,
    )

@app.post("/tts/synthesize", response_model=TTSResponse)
def synthesize_tts(req: TTSRequest):
    """Executes Auto-voice, Voice Design, or Voice Prompt TTS."""
    try:
        result = run_tts(
            text=req.text,
            instruct=req.instruct,
            voice_prompt_id=req.voice_prompt_id,
            num_step=req.num_step or settings.default_diffusion_steps,
            speed=req.speed or 1.0,
            duration=req.duration,
            normalize_text=req.normalize_text if req.normalize_text is not None else True,
        )
        return TTSResponse(**result)
    except Exception as e:
        logger.error(f"TTS synthesis failed: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@app.post("/voices/clone", response_model=TTSResponse)
def clone_voice(req: VoiceCloneRequest):
    """Executes zero-shot reference voice cloning."""
    try:
        result = run_voice_clone(
            text=req.text,
            ref_audio_b64=req.ref_audio_base64,
            ref_text=req.ref_text,
            num_step=req.num_step or settings.default_diffusion_steps,
            speed=req.speed or 1.0,
            save_prompt=req.save_prompt or False,
            voice_name=req.voice_name or "custom_voice",
        )
        return TTSResponse(**result)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.error(f"Voice cloning failed: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)
