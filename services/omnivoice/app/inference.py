"""OmniVoice Inference Engine Implementation
Strictly implements the three-state execution contract:
NEURAL: Real model and weights loaded.
DEMO: Explicitly authorized development-only harmonic generation (never implicit).
UNAVAILABLE: Neural requested but weights offline -> raises ServiceUnavailableError.
"""

import time
import tempfile
import os
import math
import io
import struct
import wave
from pathlib import Path
from typing import Dict, Any, Optional, List

from app.config import settings
from app.model_manager import model_manager
from app.audio_processing import (
    decode_audio_base64,
    encode_audio_to_base64,
    validate_reference_audio,
    TARGET_SAMPLE_RATE,
    HAS_NUMPY,
)
from app.safety import sign_synthesis_manifest, sanitize_input_text

try:
    import numpy as np
except ImportError:
    np = None  # type: ignore


class ServiceUnavailableError(Exception):
    """Raised when neural inference is requested but weights or hardware are offline."""
    pass


def generate_lightweight_speech_fallback(text: str, duration_sec: Optional[float] = None) -> Any:
    """Deterministic harmonic speech audio generation for explicit DEMO mode."""
    clean_text = text.strip()
    est_duration = duration_sec or max(1.5, min(15.0, len(clean_text) * 0.065))
    total_samples = int(TARGET_SAMPLE_RATE * est_duration)
    
    if HAS_NUMPY and np is not None:
        t = np.linspace(0, est_duration, total_samples, endpoint=False, dtype=np.float32)
        f0 = 180.0 + 25.0 * np.sin(2.0 * np.pi * 3.5 * t)
        phase_f0 = 2.0 * np.pi * np.cumsum(f0) / TARGET_SAMPLE_RATE
        
        f1 = 580.0
        f2 = 1720.0
        glottal = np.sin(phase_f0) + 0.35 * np.sin(2.0 * phase_f0) + 0.2 * np.sin(3.0 * phase_f0)
        formant1 = np.sin(2.0 * np.pi * f1 * t) * 0.3
        formant2 = np.sin(2.0 * np.pi * f2 * t) * 0.15
        
        envelope = np.abs(np.sin(np.pi * t * 4.0)) ** 0.5 * 0.8
        fade_len = int(TARGET_SAMPLE_RATE * 0.05)
        fade_in = np.linspace(0, 1, fade_len, dtype=np.float32)
        fade_out = np.linspace(1, 0, fade_len, dtype=np.float32)
        
        waveform = (glottal * 0.5 + formant1 + formant2) * envelope
        waveform[:fade_len] *= fade_in
        waveform[-fade_len:] *= fade_out
        return waveform.astype(np.float32)
    
    # Pure Python fallback for environments without numpy
    samples: List[float] = []
    phase_f0 = 0.0
    fade_len = int(TARGET_SAMPLE_RATE * 0.05)
    for i in range(total_samples):
        t_sec = i / float(TARGET_SAMPLE_RATE)
        f0_val = 180.0 + 25.0 * math.sin(2.0 * math.pi * 3.5 * t_sec)
        phase_f0 += 2.0 * math.pi * f0_val / float(TARGET_SAMPLE_RATE)
        glottal = math.sin(phase_f0) + 0.35 * math.sin(2.0 * phase_f0) + 0.2 * math.sin(3.0 * phase_f0)
        formant1 = math.sin(2.0 * math.pi * 580.0 * t_sec) * 0.3
        formant2 = math.sin(2.0 * math.pi * 1720.0 * t_sec) * 0.15
        envelope = math.sqrt(abs(math.sin(math.pi * t_sec * 4.0))) * 0.8
        val = (glottal * 0.5 + formant1 + formant2) * envelope
        if i < fade_len:
            val *= (i / float(fade_len))
        elif i > total_samples - fade_len:
            val *= ((total_samples - i) / float(fade_len))
        samples.append(max(-1.0, min(1.0, val)))
    return samples


def run_tts(
    text: str,
    instruct: Optional[str] = None,
    voice_prompt_id: Optional[str] = None,
    num_step: int = 32,
    speed: float = 1.0,
    duration: Optional[float] = None,
    normalize_text: bool = True,
    allow_demo: bool = False,
) -> Dict[str, Any]:
    """Executes OmniVoice TTS synthesis with strict three-state execution enforcement."""
    clean_text = sanitize_input_text(text)
    if not clean_text:
        raise ValueError("Input text cannot be empty.")
    
    start_time = time.perf_counter()
    model = model_manager.get_model()
    
    # 1. Check for genuine neural model availability
    if model is not None and model_manager.is_loaded:
        kwargs: Dict[str, Any] = {
            "text": clean_text,
            "num_step": num_step,
            "speed": speed,
            "normalize_text": normalize_text,
        }
        if duration is not None:
            kwargs["duration"] = duration
        if voice_prompt_id:
            mode = "voice_prompt"
            prompt = model_manager.load_voice_clone_prompt(voice_prompt_id)
            kwargs["voice_clone_prompt"] = prompt
        elif instruct:
            mode = "voice_design"
            kwargs["instruct"] = instruct
        else:
            mode = "auto_voice"
        
        audio_output = model.generate(**kwargs)
        waveform = audio_output[0] if isinstance(audio_output, list) else audio_output
        execution_mode = "NEURAL"
        engine_label = "k2-fsa/OmniVoice-v0.2.1"
        is_neural = True
    
    # 2. Check for explicitly allowed development harmonic demo fallback
    elif (allow_demo or settings.execution_mode == "DEMO") and settings.allow_demo:
        mode = "voice_design" if instruct else "auto_voice"
        waveform = generate_lightweight_speech_fallback(clean_text, duration_sec=duration)
        execution_mode = "DEMO"
        engine_label = "development_formant_fallback"
        is_neural = False
    
    # 3. Fail closed if neural requested but unavailable and demo not explicitly requested
    else:
        raise ServiceUnavailableError(
            "OmniVoice neural TTS engine is unavailable: Model weights are not loaded. "
            "In development mode, pass allow_demo=True to explicitly permit harmonic demo synthesis."
        )

    duration_sec = float(len(waveform) / float(TARGET_SAMPLE_RATE))
    elapsed_ms = int((time.perf_counter() - start_time) * 1000)
    rtf = round(elapsed_ms / (duration_sec * 1000), 3) if duration_sec > 0 else 0.0
    audio_b64 = encode_audio_to_base64(waveform, sample_rate=TARGET_SAMPLE_RATE)
    manifest = sign_synthesis_manifest(
        clean_text,
        duration_sec,
        mode,
        voice_prompt_id or "omni_default",
        execution_mode=execution_mode
    )

    return {
        "audio_base64": audio_b64,
        "sample_rate": TARGET_SAMPLE_RATE,
        "duration_seconds": round(duration_sec, 2),
        "generation_time_ms": elapsed_ms,
        "rtf": rtf,
        "engine": engine_label,
        "is_neural": is_neural,
        "execution_mode": execution_mode,
        "mode": mode,
        "manifest": manifest,
    }


def run_voice_clone(
    text: str,
    ref_audio_b64: str,
    ref_text: Optional[str] = None,
    num_step: int = 32,
    speed: float = 1.0,
    save_prompt: bool = False,
    voice_name: str = "custom_cloned_voice",
    allow_demo: bool = False,
) -> Dict[str, Any]:
    """Executes reference-conditioned zero-shot voice cloning with strict three-state execution enforcement."""
    clean_text = sanitize_input_text(text)
    if not clean_text:
        raise ValueError("Input text cannot be empty.")
    
    ref_waveform, ref_sr = decode_audio_base64(ref_audio_b64)
    valid, err_msg = validate_reference_audio(ref_waveform, ref_sr)
    if not valid:
        raise ValueError(f"Invalid reference audio: {err_msg}")

    start_time = time.perf_counter()
    model = model_manager.get_model()
    prompt_id: Optional[str] = None
    
    # 1. Genuine Neural Voice Cloning
    if model is not None and model_manager.is_loaded:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_wav:
            tmp_wav_path = tmp_wav.name
            if HAS_NUMPY and np is not None and isinstance(ref_waveform, np.ndarray):
                import soundfile as sf
                sf.write(tmp_wav_path, ref_waveform, ref_sr)
            else:
                with wave.open(tmp_wav_path, "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(ref_sr)
                    raw_buf = bytearray(len(ref_waveform) * 2)
                    for i, s in enumerate(ref_waveform):
                        ival = int(max(-1.0, min(1.0, float(s))) * 32767.0)
                        struct.pack_into("<h", raw_buf, i * 2, ival)
                    wf.writeframes(raw_buf)
        try:
            kwargs = {
                "text": clean_text,
                "ref_audio": tmp_wav_path,
                "num_step": num_step,
                "speed": speed,
            }
            if ref_text:
                kwargs["ref_text"] = ref_text
            audio_output = model.generate(**kwargs)
            waveform = audio_output[0] if isinstance(audio_output, list) else audio_output
            if save_prompt:
                prompt_obj = model.create_voice_clone_prompt(ref_audio=tmp_wav_path, ref_text=ref_text)
                prompt_id = f"prompt_{int(time.time())}_{voice_name.replace(' ', '_')}"
                model_manager.save_voice_clone_prompt(prompt_id, prompt_obj)
        finally:
            if os.path.exists(tmp_wav_path):
                os.remove(tmp_wav_path)
        execution_mode = "NEURAL"
        engine_label = "k2-fsa/OmniVoice-v0.2.1"
        is_neural = True
        
    # 2. Explicit Development Harmonic Demo Cloning
    elif (allow_demo or settings.execution_mode == "DEMO") and settings.allow_demo:
        waveform = generate_lightweight_speech_fallback(clean_text)
        execution_mode = "DEMO"
        engine_label = "development_formant_fallback"
        is_neural = False
        # Acceptance criterion #8: NEVER issue a phantom saved_prompt_id in demo mode
        prompt_id = None
        
    # 3. Fail closed if neural requested but offline
    else:
        raise ServiceUnavailableError(
            "OmniVoice neural voice cloning is unavailable: Model weights are not loaded. "
            "In development mode, pass allow_demo=True to explicitly permit harmonic demo cloning."
        )

    duration_sec = float(len(waveform) / float(TARGET_SAMPLE_RATE))
    elapsed_ms = int((time.perf_counter() - start_time) * 1000)
    rtf = round(elapsed_ms / (duration_sec * 1000), 3) if duration_sec > 0 else 0.0
    audio_b64 = encode_audio_to_base64(waveform, sample_rate=TARGET_SAMPLE_RATE)
    manifest = sign_synthesis_manifest(
        clean_text,
        duration_sec,
        "voice_cloning",
        voice_name,
        execution_mode=execution_mode
    )

    return {
        "audio_base64": audio_b64,
        "sample_rate": TARGET_SAMPLE_RATE,
        "duration_seconds": round(duration_sec, 2),
        "generation_time_ms": elapsed_ms,
        "rtf": rtf,
        "engine": engine_label,
        "is_neural": is_neural,
        "execution_mode": execution_mode,
        "mode": "voice_cloning",
        "saved_prompt_id": prompt_id,
        "manifest": manifest,
    }
