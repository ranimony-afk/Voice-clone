"""
VoiceForge OmniVoice inference service — FastAPI application.

Deployment contract (ADR-003): this service is a long-lived process, NOT a
serverless function. The model is loaded once (lazy on first use or via
POST /v1/model/warmup) and stays resident. Without weights/hardware the
service still runs and serves analysis endpoints, while every
model-dependent call returns a structured ENGINE_UNAVAILABLE error —
never a simulated substitute.
"""

from __future__ import annotations

import base64
import importlib.util
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import inference
from .audio_processing import AudioDecodeError, analyze_reference
from .config import get_config
from .inference import CancelRegistry, JobCancelledError, PromptNotFoundError, PromptRevokedError, PromptStore
from .model_manager import ModelUnavailableError, get_model_manager, set_model_manager
from .safety import ValidationError
from .schemas import (
    AnalyzeReferenceRequest,
    ClonePromptCreateRequest,
    TTSRequest,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("voiceforge.omnivoice")

cfg = get_config()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.manager = get_model_manager()
    app.state.store = PromptStore(cfg.prompt_store_dir)
    app.state.cancels = CancelRegistry()
    log.info(
        "Service started (engine=%s model=%s device_pref=%s prompt_store=%s)",
        cfg.engine_name, cfg.model_id, cfg.device, os.path.abspath(cfg.prompt_store_dir),
    )
    yield


app = FastAPI(
    title="VoiceForge OmniVoice Inference Service",
    version=cfg.service_version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if cfg.cors_origins == "*" else [o.strip() for o in cfg.cors_origins.split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or f"req_{uuid.uuid4().hex[:16]}"
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    return response


@app.middleware("http")
async def internal_worker_auth(request: Request, call_next):
    """Protect inference/prompt endpoints from direct public access.

    Production must configure a strong shared secret; local development is
    allowed without one. Deploy the worker on a private network regardless.
    """
    protected = (
        request.url.path in {"/v1/tts", "/v1/model/warmup"}
        or request.url.path.startswith("/v1/tts/cancel/")
        or request.url.path.startswith("/v1/clone/")
    )
    secret = os.environ.get("VOICEFORGE_WORKER_API_KEY", "")
    production = os.environ.get("NODE_ENV") == "production"
    if protected and production and not secret:
        return _error("WORKER_AUTH_NOT_CONFIGURED", "Inference worker shared secret is missing.", 503)
    if protected and secret and request.headers.get("x-worker-api-key") != secret:
        return _error("UNAUTHORIZED", "Valid internal worker credentials are required.", 401)
    return await call_next(request)


def _error(code: str, message: str, status: int, details: Optional[dict] = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "details": details}},
    )


@app.exception_handler(ValidationError)
async def policy_validation_handler(_req: Request, exc: ValidationError):
    return _error("VALIDATION_ERROR", str(exc), 422)


@app.exception_handler(RequestValidationError)
async def pydantic_validation_handler(_req: Request, exc: RequestValidationError):
    return _error("VALIDATION_ERROR", "Request body failed schema validation.", 422, {"issues": exc.errors()[:20]})


@app.exception_handler(ModelUnavailableError)
async def model_unavailable_handler(_req: Request, exc: ModelUnavailableError):
    return _error(exc.code, str(exc), 503)


@app.exception_handler(AudioDecodeError)
async def audio_decode_handler(_req: Request, exc: AudioDecodeError):
    return _error("AUDIO_DECODE_FAILED", str(exc), 422)


@app.exception_handler(PromptNotFoundError)
async def prompt_not_found_handler(_req: Request, exc: PromptNotFoundError):
    return _error("PROMPT_NOT_FOUND", f"Voice clone prompt '{exc}' does not exist.", 404)


@app.exception_handler(PromptRevokedError)
async def prompt_revoked_handler(_req: Request, exc: PromptRevokedError):
    return _error(
        "PROMPT_REVOKED",
        f"Voice clone prompt '{exc}' was revoked; consent withdrawal blocks further synthesis.",
        403,
    )


@app.exception_handler(JobCancelledError)
async def cancelled_handler(_req: Request, exc: JobCancelledError):
    return _error("JOB_CANCELLED", str(exc), 499)


# --------------------------------------------------------------------------
# Health & status
# --------------------------------------------------------------------------

@app.get("/healthz")
async def healthz():
    return {"status": "ok", "service": "voiceforge-omnivoice", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


@app.get("/readyz")
async def readyz():
    manager = get_model_manager()
    st = manager.status()
    neural_ready = (
        st["model_state"] == "loaded"
        and st["model_loaded"] is True
        and st["dependencies_ready"] is True
    )
    return JSONResponse(
        status_code=200 if neural_ready else 503,
        content={
            "ready": neural_ready,
            "process_live": True,
            "analysis_ready": True,
            "dependencies_ready": st["dependencies_ready"],
            "model_state": st["model_state"],
            "model_loaded": st["model_loaded"],
            "neural_inference_ready": neural_ready,
            "fallback_available": False,
            "fallback_is_neural": False,
            "engine": cfg.engine_name,
            "model_id": cfg.model_id,
        },
    )


@app.get("/v1/status")
async def status():
    manager = get_model_manager()
    st = manager.status()
    installed_version = None
    if importlib.util.find_spec("omnivoice") is not None:
        try:
            from importlib.metadata import version as pkg_version
            installed_version = pkg_version("omnivoice")
        except Exception:
            installed_version = "unknown"
    return {
        "service": "voiceforge-omnivoice-service",
        "service_version": cfg.service_version,
        "engine": cfg.engine_name,
        "pinned_upstream_git": cfg.pinned_upstream_git,
        "omnivoice_pypi_version_installed": installed_version,
        "model_id": cfg.model_id,
        "model_revision": cfg.model_revision,
        "model_state": st["model_state"],
        "dependencies_ready": st["dependencies_ready"],
        "model_available": st["model_available"],
        "model_loaded": st["model_loaded"],
        "unavailable_reason": st["unavailable_reason"],
        "device": st["device"],
        "dtype": st["dtype"],
        "torch_installed": st["torch_installed"],
        "sampling_rate": st["sampling_rate"],
        "asr_model": cfg.asr_model_name,
        "limits": {
            "max_text_chars": cfg.max_text_chars,
            "max_output_seconds": cfg.max_output_seconds,
            "max_upload_bytes": cfg.max_upload_bytes,
            "ref_min_seconds": cfg.ref_min_seconds,
            "ref_recommended_seconds": cfg.ref_recommended_seconds,
            "ref_max_seconds": cfg.ref_max_seconds,
            "max_concurrency": cfg.max_concurrency,
        },
    }


# --------------------------------------------------------------------------
# Synthesis
# --------------------------------------------------------------------------

@app.post("/v1/tts")
async def tts(req: TTSRequest, request: Request):
    result = inference.generate_speech(
        request.app.state.manager, request.app.state.store, request.app.state.cancels, req, cfg
    )
    return {
        "audio_base64": base64.b64encode(result.wav_bytes).decode("ascii"),
        "format": "wav",
        "sample_rate": result.sample_rate,
        "duration_seconds": result.duration_seconds,
        "engine": "omnivoice",
        "engine_class": "neural",
        "model_id": result.model_id,
        "model_revision": result.model_revision,
        "omnivoice_version": result.omnivoice_version,
        "device": result.device,
        "dtype": result.dtype,
        "params_echo": result.params_echo,
        "warnings": result.warnings,
        "generation_time_ms": result.generation_time_ms,
    }


@app.post("/v1/tts/cancel/{cancel_token}")
async def tts_cancel(cancel_token: str, request: Request):
    request.app.state.cancels.cancel(cancel_token)
    return {
        "cancelled": True,
        "note": "Cooperative cancellation: a running diffusion generate() call cannot be interrupted "
                "mid-flight; the token is honored before start and after completion.",
    }


# --------------------------------------------------------------------------
# Reference analysis (works WITHOUT model weights — real DSP)
# --------------------------------------------------------------------------

@app.post("/v1/reference/analyze")
async def reference_analyze(req: AnalyzeReferenceRequest):
    try:
        raw = base64.b64decode(req.audio_base64, validate=True)
    except Exception as exc:
        return _error("VALIDATION_ERROR", f"audio_base64 is not valid base64: {exc}", 422)
    if len(raw) > cfg.max_upload_bytes:
        return _error("VALIDATION_ERROR", "audio exceeds upload size limit", 413)
    analysis = analyze_reference(
        raw,
        min_seconds=cfg.ref_min_seconds,
        recommended_seconds=cfg.ref_recommended_seconds,
        max_seconds=cfg.ref_max_seconds,
        min_snr_db=cfg.ref_min_snr_db,
        max_clipping_ratio=cfg.ref_max_clipping_ratio,
        max_silence_ratio=cfg.ref_max_silence_ratio,
    )
    return {"analysis": analysis.to_dict(), "analysis_engine": analysis.analysis_engine}


# --------------------------------------------------------------------------
# Reusable voice-clone prompts (requires model — honest 503 otherwise)
# --------------------------------------------------------------------------

@app.post("/v1/clone/prompts")
async def clone_prompt_create(req: ClonePromptCreateRequest, request: Request):
    try:
        meta = inference.create_clone_prompt(
            request.app.state.manager,
            request.app.state.store,
            cfg,
            prompt_id=req.prompt_id,
            audio_b64=req.audio_base64,
            ref_text=req.ref_text,
        )
    except ValueError as exc:
        return _error("VALIDATION_ERROR", str(exc), 422)
    return {"prompt": meta}


@app.get("/v1/clone/prompts/{prompt_id}")
async def clone_prompt_status(prompt_id: str, request: Request):
    return {"prompt": request.app.state.store.meta(prompt_id)}


@app.delete("/v1/clone/prompts/{prompt_id}")
async def clone_prompt_revoke(prompt_id: str, request: Request):
    meta = request.app.state.store.revoke(prompt_id)
    return {"prompt": meta, "note": "Tensor file destroyed; metadata retained for audit."}


# --------------------------------------------------------------------------
# Warm-up (explicit model load; keeps requests off the cold path)
# --------------------------------------------------------------------------

@app.post("/v1/model/warmup")
async def warmup(request: Request):
    manager = request.app.state.manager
    manager.reset()  # allow retry after previous failure
    t0 = time.perf_counter()
    try:
        bundle = manager.ensure_loaded()
    except ModelUnavailableError as exc:
        return _error(exc.code, str(exc), 503)
    return {
        "loaded": True,
        "device": bundle.get("device"),
        "dtype": bundle.get("dtype"),
        "sampling_rate": bundle.get("sampling_rate"),
        "load_time_ms": int((time.perf_counter() - t0) * 1000),
    }


def create_app() -> FastAPI:
    """Factory used by tests to bind an injected ModelManager."""
    return app


def main() -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=os.environ.get("VOICEFORGE_HOST", "0.0.0.0"),
        port=int(os.environ.get("VOICEFORGE_PORT", "8100")),
        log_level="info",
    )


if __name__ == "__main__":
    main()
