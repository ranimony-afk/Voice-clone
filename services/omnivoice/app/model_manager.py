"""OmniVoice Model Lifecycle Manager
Handles singleton model loading, device placement, warm-up, and prompt serialization.
Ensures that model loading failures are cleanly logged and never falsely marked as loaded.
"""

import os
import sys
import logging
from typing import Optional, Dict, Any
from pathlib import Path
from app.config import settings

logger = logging.getLogger("omnivoice.model_manager")


class ModelManager:
    _instance: Optional['ModelManager'] = None
    _model: Any = None
    _is_loaded: bool = False
    _device: str = "cpu"
    _dtype: str = "float32"
    _error_detail: Optional[str] = None
    _prompt_cache: Dict[str, Any] = {}

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ModelManager, cls).__new__(cls)
            cls._instance._init_manager()
        return cls._instance

    def _init_manager(self):
        self._device = settings.device
        self._dtype = settings.dtype
        try:
            os.makedirs(settings.prompt_storage_dir, exist_ok=True)
        except Exception as e:
            logger.warning(f"Failed to create prompt storage dir: {e}")

    @property
    def is_loaded(self) -> bool:
        return self._is_loaded

    @property
    def device(self) -> str:
        return self._device

    @property
    def error_detail(self) -> Optional[str]:
        return self._error_detail

    def load_model(self) -> bool:
        """Loads OmniVoice from pretrained Hugging Face checkpoint."""
        if self._is_loaded and self._model is not None:
            return True

        logger.info(f"Attempting to load OmniVoice model '{settings.model_id}' on {self._device} ({self._dtype})...")
        try:
            import torch
            from omnivoice import OmniVoice

            torch_dtype = torch.float16 if self._dtype == "float16" and self._device.startswith("cuda") else torch.float32
            self._model = OmniVoice.from_pretrained(
                settings.model_id,
                device_map=self._device,
                dtype=torch_dtype
            )
            self._is_loaded = True
            self._error_detail = None
            logger.info("OmniVoice neural model loaded successfully.")
            return True
        except Exception as e:
            # Cleanly record failure and ensure is_loaded remains False
            self._model = None
            self._is_loaded = False
            self._error_detail = f"Model load failed: {type(e).__name__}"
            logger.warning(f"OmniVoice neural model weights unavailable: {e}")
            return False

    def get_model(self):
        """Returns loaded model instance or None."""
        return self._model

    def save_voice_clone_prompt(self, prompt_id: str, prompt_obj: Any) -> str:
        """Persists VoiceClonePrompt object to disk."""
        if prompt_obj is None:
            raise ValueError("Cannot persist null voice clone prompt.")
        target_path = Path(settings.prompt_storage_dir) / f"{prompt_id}.pt"
        prompt_obj.save(str(target_path))
        self._prompt_cache[prompt_id] = prompt_obj
        return str(target_path)

    def load_voice_clone_prompt(self, prompt_id: str):
        """Loads VoiceClonePrompt from cache or disk."""
        if prompt_id in self._prompt_cache:
            return self._prompt_cache[prompt_id]
        target_path = Path(settings.prompt_storage_dir) / f"{prompt_id}.pt"
        if not target_path.exists():
            raise FileNotFoundError(f"Voice clone prompt '{prompt_id}' not found.")
        from omnivoice import VoiceClonePrompt
        prompt = VoiceClonePrompt.load(str(target_path))
        self._prompt_cache[prompt_id] = prompt
        return prompt


model_manager = ModelManager()
