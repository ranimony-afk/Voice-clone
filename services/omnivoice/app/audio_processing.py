"""Audio validation, base64 decoding, sample rate conversion, and WAV encoding utilities.
Provides dual-mode operation: leverages numpy/soundfile when available, with pure Python
standard library (wave/struct/math) fallback for zero-dependency test execution.
"""

import io
import base64
import math
import struct
import wave
from typing import Tuple, List, Any, Union

TARGET_SAMPLE_RATE = 24000

# Optional imports with fallbacks
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    np = None  # type: ignore
    HAS_NUMPY = False

try:
    import soundfile as sf
    HAS_SOUNDFILE = True
except ImportError:
    sf = None  # type: ignore
    HAS_SOUNDFILE = False


def decode_audio_base64(audio_b64: str) -> Tuple[Union[List[float], Any], int]:
    """Decodes base64 audio payload to float32 samples and sample rate."""
    if "base64," in audio_b64:
        audio_b64 = audio_b64.split("base64,")[1]
    raw_bytes = base64.b64decode(audio_b64)
    
    if HAS_SOUNDFILE and HAS_NUMPY:
        with io.BytesIO(raw_bytes) as bio:
            data, sr = sf.read(bio, dtype="float32")
        if data.ndim > 1:
            data = np.mean(data, axis=1)
        return data, sr
    
    # Standard library wave fallback
    with io.BytesIO(raw_bytes) as bio:
        with wave.open(bio, "rb") as wf:
            sr = wf.getframerate()
            num_channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            num_frames = wf.getnframes()
            frames = wf.readframes(num_frames)
            
            samples: List[float] = []
            if sampwidth == 2:  # 16-bit PCM
                step = 2 * num_channels
                for i in range(0, len(frames), step):
                    channel_sum = 0.0
                    for ch in range(num_channels):
                        idx = i + ch * 2
                        if idx + 2 <= len(frames):
                            val, = struct.unpack_from("<h", frames, idx)
                            channel_sum += val / 32768.0
                    samples.append(channel_sum / num_channels)
            else:
                # 8-bit unsigned PCM fallback
                step = num_channels
                for i in range(0, len(frames), step):
                    channel_sum = 0.0
                    for ch in range(num_channels):
                        idx = i + ch
                        if idx < len(frames):
                            val = frames[idx]
                            channel_sum += (val - 128) / 128.0
                    samples.append(channel_sum / num_channels)
            return samples, sr


def encode_audio_to_base64(waveform: Union[List[float], Any], sample_rate: int = TARGET_SAMPLE_RATE) -> str:
    """Encodes float waveform to base64 WAV payload."""
    if HAS_SOUNDFILE and HAS_NUMPY and isinstance(waveform, np.ndarray):
        with io.BytesIO() as bio:
            sf.write(bio, waveform, sample_rate, format="WAV", subtype="PCM_16")
            wav_bytes = bio.getvalue()
        return base64.b64encode(wav_bytes).decode("ascii")
    
    # Standard library wave encoding fallback
    bio = io.BytesIO()
    with wave.open(bio, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        n_samples = len(waveform)
        raw_buf = bytearray(n_samples * 2)
        for i in range(n_samples):
            val = float(waveform[i])
            clamped = max(-1.0, min(1.0, val))
            ival = int(clamped * 32767.0)
            struct.pack_into("<h", raw_buf, i * 2, ival)
        wf.writeframes(raw_buf)
    wav_bytes = bio.getvalue()
    return base64.b64encode(wav_bytes).decode("ascii")


def validate_reference_audio(
    waveform: Union[List[float], Any],
    sample_rate: int,
    min_sec: float = 2.0,
    max_sec: float = 30.0
) -> Tuple[bool, str]:
    """Validates acoustic reference audio for zero-shot voice cloning.
    Enforces minimum/maximum duration and audio energy (rejects silent recordings).
    """
    n_samples = len(waveform)
    duration = float(n_samples) / float(sample_rate)
    
    if duration < min_sec:
        return False, f"Reference audio too short ({duration:.2f}s). Minimum {min_sec:.1f}s required."
    if duration > max_sec:
        return False, f"Reference audio exceeds maximum duration ({duration:.2f}s > {max_sec:.1f}s)."
    
    # Energy / silence validation
    if HAS_NUMPY and isinstance(waveform, np.ndarray):
        rms = float(np.sqrt(np.mean(waveform ** 2)))
    else:
        sum_sq = sum(float(x) ** 2 for x in waveform)
        rms = math.sqrt(sum_sq / max(1, n_samples))
    
    if rms < 0.005:
        return False, "Audio is nearly silent. Upload clear speech recording."
    
    return True, "Valid"
