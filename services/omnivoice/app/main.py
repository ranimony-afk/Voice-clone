"""VoiceForge OmniVoice 2.0 FastAPI Microservice Entrypoint
Provides hardened REST endpoints for:
- Live & readiness probes with 503 fail-closed behavior in strict neural production mode
- Standard TTS (Auto-voice & Voice Design)
- Zero-Shot Voice Cloning
- Reusable Voice Prompt serialization and retrieval
"""

import sys
import logging
from typing import List, Dict, Any, Tuple

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
from app.inference import run_tts, run_voice_clone, ServiceUnavailableError

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("omnivoice.api")


def get_health_live_data() -> Dict[str, Any]:
    """Generates liveness payload independent of framework transport."""
    exec_mode = "NEURAL" if model_manager.is_loaded else ("DEMO" if settings.allow_demo else "UNAVAILABLE")
    return {
        "status": "live",
        "service": settings.app_name,
        "version": settings.version,
        "execution_mode": exec_mode,
        "is_neural": model_manager.is_loaded,
        "device": model_manager.device,
        "cudaAvailable": model_manager.device.startswith("cuda"),
        "modelLoaded": model_manager.is_loaded,
        "sampleRate": settings.sample_rate,
    }


def get_health_ready_data() -> Tuple[int, Dict[str, Any]]:
    """Evaluates readiness status and returns (http_status_code, payload).
    In production or strict neural mode, returns (503, error_dict) if weights are offline.
    """
    if model_manager.is_loaded:
        return 200, {
            "status": "ready",
            "service": settings.app_name,
            "version": settings.version,
            "execution_mode": "NEURAL",
            "is_neural": True,
            "device": model_manager.device,
            "cudaAvailable": model_manager.device.startswith("cuda"),
            "modelLoaded": True,
            "sampleRate": settings.sample_rate,
        }
    elif settings.allow_demo and settings.execution_mode in ("DEMO", "AUTO"):
        return 200, {
            "status": "ready",
            "service": settings.app_name,
            "version": settings.version,
            "execution_mode": "DEMO",
            "is_neural": False,
            "device": model_manager.device,
            "cudaAvailable": model_manager.device.startswith("cuda"),
            "modelLoaded": False,
            "sampleRate": settings.sample_rate,
            "note": "Operating in explicit development harmonic demo mode",
        }
    else:
        # Production or strict neural mode with missing weights -> 503
        return 503, {
            "status": "unavailable",
            "service": settings.app_name,
            "version": settings.version,
            "execution_mode": "UNAVAILABLE",
            "is_neural": False,
            "detail": "OmniVoice neural inference engine is unavailable: Model weights are not loaded.",
        }


# Optional FastAPI framework mounting
try:
    from fastapi import FastAPI, HTTPException, status, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    from contextlib import asynccontextmanager
    HAS_FASTAPI = True
except ImportError:
    FastAPI = None  # type: ignore
    HTTPException = None  # type: ignore
    status = None  # type: ignore
    CORSMiddleware = None  # type: ignore
    JSONResponse = None  # type: ignore
    HAS_FASTAPI = False


if HAS_FASTAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logger.info(f"Initializing OmniVoice service (env: {settings.environment}, mode: {settings.execution_mode})...")
        model_manager.load_model()
        yield
        logger.info("Shutting down OmniVoice service.")

    app = FastAPI(
        title=settings.app_name,
        version=settings.version,
        description="Hardened inference service for OmniVoice 600+ language zero-shot TTS and voice cloning.",
        lifespan=lifespan,
    )

    # Environment-configured CORS policy
    allowed_origins = [o.strip() for o in settings.cors_allowed_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins if allowed_origins else ["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/health/live", response_model=HealthResponse)
    def health_live():
        """Liveness probe: verifies process is alive regardless of model state."""
        return HealthResponse(**get_health_live_data())

    @app.get("/health/ready", response_model=HealthResponse)
    def health_ready():
        """Readiness probe: returns 200 only if configured service is genuinely ready.
        In production or strict neural mode, returns 503 if weights are offline.
        """
        code, data = get_health_ready_data()
        if code != 200:
            raise HTTPException(status_code=code, detail=data.get("detail", "Service unavailable"))
        return HealthResponse(**data)

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
                allow_demo=bool(req.allow_demo),
            )
            return TTSResponse(**result)
        except ServiceUnavailableError as sue:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(sue))
        except ValueError as ve:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
        except Exception as e:
            # Sanitize internal error to avoid leaking server paths or secrets
            logger.error(f"Internal synthesis failure: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Inference request failed due to an internal server error."
            )

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
                allow_demo=bool(req.allow_demo),
            )
            return TTSResponse(**result)
        except ServiceUnavailableError as sue:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(sue))
        except ValueError as ve:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
        except Exception as e:
            logger.error(f"Internal voice cloning failure: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Voice cloning request failed due to an internal server error."
            )
else:
    app = None  # type: ignore


if __name__ == "__main__":
    if HAS_FASTAPI:
        import uvicorn
        uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)
    else:
        print("FastAPI is not installed in the global environment.")
