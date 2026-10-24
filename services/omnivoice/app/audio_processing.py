"""
Audio validation, base64 decoding, sample rate conversion, and WAV encoding utilities.
"""

import io
import base64
import numpy as np
import soundfile as sf
from typing import Tuple

TARGET_SAMPLE_RATE = 24000

def decode_audio_base64(audio_b64: str) -> Tuple[np.ndarray, int]:
    """Decodes base64 audio payload to float32 numpy array and sample rate."""
    if "base64," in audio_b64:
        audio_b64 = audio_b64.split("base64,")[1]

    raw_bytes = base64.b64decode(audio_b64)
    with io.BytesIO(raw_bytes) as bio:
        data, sr = sf.read(bio, dtype="float32")

    # Convert stereo to mono if necessary
    if data.ndim > 1:
        data = np.mean(data, axis=1)

    return data, sr

def encode_audio_to_base64(waveform: np.ndarray, sample_rate: int = TARGET_SAMPLE_RATE) -> str:
    """Encodes float32 or int16 numpy waveform to base64 WAV payload."""
    with io.BytesIO() as bio:
        sf.write(bio, waveform, sample_rate, format="WAV", subtype="PCM_16")
        wav_bytes = bio.getvalue()
    return base64.b64encode(wav_bytes).decode("ascii")

def validate_reference_audio(waveform: np.ndarray, sample_rate: int, min_sec: float = 2.0, max_sec: float = 30.0) -> Tuple[bool, str]:
    """Validates acoustic reference audio for voice cloning."""
    duration = len(waveform) / sample_rate
    if duration < min_sec:
        return False, f"Reference audio too short ({duration:.2f}s). Minimum {min_sec:.1f}s required."
    if duration > max_sec:
        return False, f"Reference audio exceeds maximum duration ({duration:.2f}s > {max_sec:.1f}s)."

    # Silence check
    rms = np.sqrt(np.mean(waveform ** 2))
    if rms < 0.005:
        return False, "Audio is nearly silent. Upload clear speech recording."

    return True, "Valid"
