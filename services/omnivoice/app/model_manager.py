"""
Lazy, thread-safe OmniVoice model manager.

Design rules (from the master plan and M0 ADR-003):
- The model is loaded ONCE (module-level singleton per process), never per request.
- `import omnivoice`/`import torch` happen inside the loader so this module —
  and therefore the whole service and its test-suite — imports and runs on a
  machine without torch installed. In that case every model-dependent call
  raises ModelUnavailableError with an honest reason; nothing is simulated.
- Device selection: explicit OMNIVOICE_DEVICE or auto-detect cuda > mps > xpu > cpu.
- CPU inference is refused unless VOICEFORGE_ALLOW_CPU_INFERENCE=true.
"""

from __future__ import annotations

import importlib
import logging
import threading
from typing import Any, Callable, Optional

from .config import ServiceConfig, get_config

log = logging.getLogger("voiceforge.omnivoice.model_manager")


class ModelUnavailableError(RuntimeError):
    def __init__(self, reason: str, code: str = "ENGINE_UNAVAILABLE"):
        super().__init__(reason)
        self.reason = reason
        self.code = code


def detect_device(preference: str = "auto") -> tuple[str, Optional[Any]]:
    """Return (device_string, torch_module). torch import failure => (None-ish, None)."""
    try:
        torch = importlib.import_module("torch")
    except Exception as exc:  # pragma: no cover - exercised via fake loader in tests
        return "unavailable", None
    if preference and preference != "auto":
        return preference, torch
    try:
        if torch.cuda.is_available():
            return "cuda:0", torch
        mps = getattr(torch.backends, "mps", None)
        if mps is not None and mps.is_available():
            return "mps", torch
        xpu = getattr(torch, "xpu", None)
        if xpu is not None and xpu.is_available():
            return "xpu", torch
    except Exception:
        pass
    return "cpu", torch


def _default_loader(cfg: ServiceConfig) -> dict:
    """Real loader: imports torch + omnivoice and loads pinned weights.

    Returns a bundle dict {model, torch, device, dtype, sampling_rate}.
    Raises ModelUnavailableError with precise, honest reasons.
    """
    device, torch = detect_device(cfg.device)
    if torch is None:
        raise ModelUnavailableError(
            "PyTorch/omnivoice are not installed in this runtime. This instance can only "
            "serve audio-analysis endpoints. Deploy the GPU image (Dockerfile.gpu) for neural synthesis.",
            code="ENGINE_NOT_INSTALLED",
        )
    if device == "cpu" and not cfg.allow_cpu_inference:
        raise ModelUnavailableError(
            "No CUDA/MPS/XPU device detected and VOICEFORGE_ALLOW_CPU_INFERENCE is not set. "
            "OmniVoice is a diffusion language model; CPU inference is not a supported production path.",
            code="NO_ACCELERATOR",
        )
    try:
        omnivoice = importlib.import_module("omnivoice")
    except Exception as exc:
        raise ModelUnavailableError(
            f"omnivoice package import failed ({exc}). Install with the [engine] extra "
            "(omnivoice==0.2.1, pinned to upstream git 08be0b4c).",
            code="ENGINE_NOT_INSTALLED",
        ) from exc

    dtype = torch.float32
    if cfg.dtype == "auto":
        dtype = torch.float16 if str(device).startswith("cuda") else torch.float32
    elif cfg.dtype == "float16":
        dtype = torch.float16
    elif cfg.dtype == "bfloat16":
        dtype = torch.bfloat16

    kwargs: dict[str, Any] = {"device_map": device, "dtype": dtype}
    if cfg.model_revision:
        kwargs["revision"] = cfg.model_revision
    if cfg.asr_model_name:
        kwargs["asr_model_name"] = cfg.asr_model_name
    if cfg.asr_device:
        kwargs["asr_device"] = cfg.asr_device

    log.info("Loading OmniVoice model %s on %s (%s)…", cfg.model_id, device, dtype)
    try:
        model = omnivoice.OmniVoice.from_pretrained(cfg.model_id, **kwargs)
    except Exception as exc:
        raise ModelUnavailableError(
            f"Model load failed for '{cfg.model_id}': {type(exc).__name__}: {exc}. "
            "Check HF credentials/network (weights are downloaded at first load), disk cache space, "
            "and GPU memory.",
            code="MODEL_LOAD_FAILED",
        ) from exc

    return {
        "model": model,
        "torch": torch,
        "device": device,
        "dtype": str(dtype).replace("torch.", ""),
        "sampling_rate": int(getattr(model, "sampling_rate", 24000) or 24000),
        "omnivoice_version": getattr(omnivoice, "__version__", "unknown"),
    }


class ModelManager:
    """Process-wide singleton holding at most one loaded model + a concurrency gate."""

    def __init__(self, cfg: Optional[ServiceConfig] = None, loader: Optional[Callable[[ServiceConfig], dict]] = None):
        self.cfg = cfg or get_config()
        self._loader = loader or _default_loader
        self._bundle: Optional[dict] = None
        self._load_error: Optional[ModelUnavailableError] = None
        self._loading = False
        self._lock = threading.Lock()
        # Serialize expensive load calls; without this second lock two first
        # requests could each allocate a full model on the same accelerator.
        self._load_lock = threading.Lock()
        self._semaphore = threading.Semaphore(max(1, self.cfg.max_concurrency))

    # --- status (never loads the model) ---
    def status(self) -> dict:
        with self._lock:
            loaded = self._bundle is not None
            loading = self._loading
            err = self._load_error
            bundle = self._bundle or {}
        torch_installed = importlib.util.find_spec("torch") is not None
        model_state = "loaded" if loaded else "loading" if loading else "failed" if err else "not_loaded"
        dependencies_ready = True if loaded else False if err else None
        return {
            "model_state": model_state,
            "dependencies_ready": dependencies_ready,
            "model_available": loaded,
            "model_loaded": loaded,
            "unavailable_reason": (err.reason if err and not loaded else None),
            "unavailable_code": (err.code if err and not loaded else None),
            "device": bundle.get("device"),
            "dtype": bundle.get("dtype"),
            "sampling_rate": bundle.get("sampling_rate"),
            "omnivoice_version": bundle.get("omnivoice_version"),
            "torch_installed": torch_installed,
        }

    # --- lazy load (idempotent, thread-safe) ---
    def ensure_loaded(self) -> dict:
        with self._load_lock:
            with self._lock:
                if self._bundle is not None:
                    return self._bundle
                if self._load_error is not None:
                    # Fail fast on repeated requests after a hard failure; a warmup
                    # call resets the error to retry (e.g. after fixing HF network).
                    raise self._load_error
                self._loading = True
            try:
                bundle = self._loader(self.cfg)
            except ModelUnavailableError as exc:
                with self._lock:
                    self._load_error = exc
                    self._loading = False
                raise
            except Exception as exc:
                err = ModelUnavailableError(f"Unexpected loader failure: {exc}", code="MODEL_LOAD_FAILED")
                with self._lock:
                    self._load_error = err
                    self._loading = False
                raise err from exc
            with self._lock:
                self._bundle = bundle
                self._load_error = None
                self._loading = False
            log.info("OmniVoice model ready on %s", bundle.get("device"))
            return bundle

    def reset(self) -> None:
        """Clear cached load/error state (used by warmup retries and tests)."""
        with self._load_lock:
            with self._lock:
                self._bundle = None
                self._load_error = None
                self._loading = False

    def concurrency_gate(self) -> threading.Semaphore:
        return self._semaphore


_singleton: Optional[ModelManager] = None
_singleton_lock = threading.Lock()


def get_model_manager() -> ModelManager:
    global _singleton
    with _singleton_lock:
        if _singleton is None:
            _singleton = ModelManager()
        return _singleton


def set_model_manager(manager: ModelManager) -> None:
    """Dependency-injection point used by tests (and only tests)."""
    global _singleton
    with _singleton_lock:
        _singleton = manager
