"""
OmniVoice Inference Engine Implementation
Handles:
- Text-to-Speech (Auto-voice & Voice Design)
- Zero-Shot Reference-Conditioned Voice Cloning
- Voice Clone Prompt Encoding and Persistence
- Deterministic Fallback Generation for Lightweight CI environments
"""

import time
import tempfile
import os
import numpy as np
from pathlib import Path
from typing import Dict, Any, Optional

from app.model_manager import model_manager
from app.audio_processing import (
    decode_audio_base64,
    encode_audio_to_base64,
    validate_reference_audio,
    TARGET_SAMPLE_RATE,
)
from app.safety import sign_synthesis_manifest, sanitize_input_text

def generate_lightweight_speech_fallback(text: str, duration_sec: Optional[float] = None) -> np.ndarray:
    """Deterministic harmonic speech audio generation when neural weights are offline in CI."""
    clean_text = text.strip()
    est_duration = duration_sec or max(1.5, min(15.0, len(clean_text) * 0.065))
    total_samples = int(TARGET_SAMPLE_RATE * est_duration)
    t = np.linspace(0, est_duration, total_samples, endpoint=False, dtype=np.float32)

    # Fundamental frequency contour with speech intonation modulation
    f0 = 180.0 + 25.0 * np.sin(2.0 * np.pi * 3.5 * t)
    phase_f0 = 2.0 * np.pi * np.cumsum(f0) / TARGET_SAMPLE_RATE

    # Vowel formant resonance filters
    f1 = 580.0
    f2 = 1720.0
    glottal = np.sin(phase_f0) + 0.35 * np.sin(2.0 * phase_f0) + 0.2 * np.sin(3.0 * phase_f0)
    formant1 = np.sin(2.0 * np.pi * f1 * t) * 0.3
    formant2 = np.sin(2.0 * np.pi * f2 * t) * 0.15

    # Syllabic envelope cadence
    envelope = np.abs(np.sin(np.pi * t * 4.0)) ** 0.5 * 0.8
    # Fade in / fade out to avoid clicks
    fade_len = int(TARGET_SAMPLE_RATE * 0.05)
    fade_in = np.linspace(0, 1, fade_len, dtype=np.float32)
    fade_out = np.linspace(1, 0, fade_len, dtype=np.float32)

    waveform = (glottal * 0.5 + formant1 + formant2) * envelope
    waveform[:fade_len] *= fade_in
    waveform[-fade_len:] *= fade_out

    return waveform.astype(np.float32)

def run_tts(
    text: str,
    instruct: Optional[str] = None,
    voice_prompt_id: Optional[str] = None,
    num_step: int = 32,
    speed: float = 1.0,
    duration: Optional[float] = None,
    normalize_text: bool = True,
) -> Dict[str, Any]:
    """Executes OmniVoice neural TTS generation."""
    clean_text = sanitize_input_text(text)
    start_time = time.perf_counter()
    model = model_manager.get_model()

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
        # OmniVoice returns list of np.ndarray
        waveform = audio_output[0] if isinstance(audio_output, list) else audio_output
    else:
        mode = "voice_design" if instruct else "auto_voice"
        waveform = generate_lightweight_speech_fallback(clean_text, duration_sec=duration)

    duration_sec = float(len(waveform) / TARGET_SAMPLE_RATE)
    elapsed_ms = int((time.perf_counter() - start_time) * 1000)
    rtf = round(elapsed_ms / (duration_sec * 1000), 3) if duration_sec > 0 else 0.0

    audio_b64 = encode_audio_to_base64(waveform, sample_rate=TARGET_SAMPLE_RATE)
    manifest = sign_synthesis_manifest(clean_text, duration_sec, mode, voice_prompt_id or "omni_default")

    return {
        "audio_base64": audio_b64,
        "sample_rate": TARGET_SAMPLE_RATE,
        "duration_seconds": round(duration_sec, 2),
        "generation_time_ms": elapsed_ms,
        "rtf": rtf,
        "engine": "k2-fsa/OmniVoice-v0.2.1",
        "is_neural": model_manager.is_loaded,
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
) -> Dict[str, Any]:
    """Executes OmniVoice reference-conditioned zero-shot voice cloning."""
    clean_text = sanitize_input_text(text)
    ref_waveform, ref_sr = decode_audio_base64(ref_audio_b64)
    valid, err_msg = validate_reference_audio(ref_waveform, ref_sr)
    if not valid:
        raise ValueError(f"Invalid reference audio: {err_msg}")

    start_time = time.perf_counter()
    model = model_manager.get_model()

    prompt_id = None
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_wav:
        tmp_wav_path = tmp_wav.name
        import soundfile as sf
        sf.write(tmp_wav_path, ref_waveform, ref_sr)

    try:
        if model is not None and model_manager.is_loaded:
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
        else:
            waveform = generate_lightweight_speech_fallback(clean_text)
            if save_prompt:
                prompt_id = f"prompt_{int(time.time())}_{voice_name.replace(' ', '_')}"
    finally:
        if os.path.exists(tmp_wav_path):
            os.remove(tmp_wav_path)

    duration_sec = float(len(waveform) / TARGET_SAMPLE_RATE)
    elapsed_ms = int((time.perf_counter() - start_time) * 1000)
    rtf = round(elapsed_ms / (duration_sec * 1000), 3) if duration_sec > 0 else 0.0

    audio_b64 = encode_audio_to_base64(waveform, sample_rate=TARGET_SAMPLE_RATE)
    manifest = sign_synthesis_manifest(clean_text, duration_sec, "voice_cloning", voice_name)

    return {
        "audio_base64": audio_b64,
        "sample_rate": TARGET_SAMPLE_RATE,
        "duration_seconds": round(duration_sec, 2),
        "generation_time_ms": elapsed_ms,
        "rtf": rtf,
        "engine": "k2-fsa/OmniVoice-v0.2.1",
        "is_neural": model_manager.is_loaded,
        "mode": "voice_cloning",
        "saved_prompt_id": prompt_id,
        "manifest": manifest,
    }
