"""
Real audio DSP for the VoiceForge OmniVoice service.

Everything here operates on actual decoded samples — no random numbers,
no fabricated metrics. Decoding uses soundfile (libsndfile): WAV/FLAC/OGG
are fully supported; browser webm/opus recordings must be transcoded
upstream (Node side) before reaching this module — we report that honestly
instead of guessing.
"""

from __future__ import annotations

import io
import math
from dataclasses import dataclass, asdict
from typing import Optional

import numpy as np
import soundfile as sf

TARGET_SAMPLE_RATE = 24000  # OmniVoice audio tokenizer rate (model.sampling_rate)


class AudioDecodeError(ValueError):
    """Raised when bytes cannot be decoded to PCM by libsndfile."""


@dataclass
class ReferenceAnalysis:
    is_valid: bool
    duration_seconds: float
    sample_rate: int
    channels: int
    rms_dbfs: float
    peak_dbfs: float
    dc_offset: float
    clipping_ratio: float
    silence_ratio: float
    snr_db_estimate: float
    feedback: list[str]
    analysis_engine: str = "libsndfile+numpy-deterministic"

    def to_dict(self) -> dict:
        return asdict(self)


def decode_audio(data: bytes) -> tuple[np.ndarray, int]:
    """Decode audio bytes to (float32 mono waveform, sample_rate).

    Raises AudioDecodeError with an actionable message on failure.
    """
    if not data:
        raise AudioDecodeError("Empty audio payload (0 bytes).")
    try:
        with sf.SoundFile(io.BytesIO(data)) as f:
            frames = f.read(always_2d=True)
            sr = f.samplerate
    except Exception as exc:  # libsndfile raises RuntimeError for unknown formats
        raise AudioDecodeError(
            "Could not decode audio with libsndfile (supported: WAV/PCM, FLAC, OGG). "
            "Browser webm/opus recordings must be transcoded to WAV first. "
            f"Decoder error: {exc}"
        ) from exc
    wav = np.asarray(frames, dtype=np.float32)
    if wav.shape[1] > 1:
        wav = wav.mean(axis=1, keepdims=False)  # mono downmix
    else:
        wav = wav[:, 0]
    if not np.isfinite(wav).all():
        raise AudioDecodeError("Audio contains NaN/Inf samples.")
    return wav, int(sr)


def encode_wav(wav: np.ndarray, sample_rate: int) -> bytes:
    """Encode float32 mono waveform to 16-bit PCM WAV bytes."""
    if wav.ndim != 1:
        wav = np.asarray(wav, dtype=np.float32).reshape(-1)
    buf = io.BytesIO()
    sf.write(buf, np.asarray(wav, dtype=np.float32), int(sample_rate), format="WAV", subtype="PCM_16")
    return buf.getvalue()


def resample_linear(wav: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    """Dependency-free linear resample (adequate for analysis; the model path
    uses torchaudio resampling inside OmniVoice itself)."""
    if sr_in == sr_out or wav.size == 0:
        return wav
    n_out = max(1, int(round(wav.size * sr_out / sr_in)))
    x_in = np.linspace(0.0, 1.0, num=wav.size, endpoint=False)
    x_out = np.linspace(0.0, 1.0, num=n_out, endpoint=False)
    return np.interp(x_out, x_in, wav).astype(np.float32)


def _dbfs(x: float) -> float:
    if x <= 1e-12:
        return -120.0
    return 20.0 * math.log10(x)


def analyze_reference(
    data: bytes,
    *,
    min_seconds: float = 3.0,
    recommended_seconds: float = 10.0,
    max_seconds: float = 20.0,
    min_snr_db: float = 15.0,
    max_clipping_ratio: float = 0.01,
    max_silence_ratio: float = 0.6,
) -> ReferenceAnalysis:
    """Deterministic quality analysis of a voice-clone reference recording."""
    feedback: list[str] = []
    wav, sr = decode_audio(data)
    duration = wav.size / float(sr) if sr else 0.0

    rms = float(np.sqrt(np.mean(wav.astype(np.float64) ** 2))) if wav.size else 0.0
    peak = float(np.max(np.abs(wav))) if wav.size else 0.0
    dc = float(np.mean(wav)) if wav.size else 0.0
    clipping_ratio = float(np.mean(np.abs(wav) >= 0.999)) if wav.size else 0.0

    # Frame-based VAD-ish stats (20 ms frames, -50 dBFS gate)
    frame = max(1, int(sr * 0.02))
    n_frames = wav.size // frame
    silence_ratio = 1.0
    snr_est = 0.0
    if n_frames > 0:
        frames = wav[: n_frames * frame].reshape(n_frames, frame)
        frame_rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
        frame_db = np.array([_dbfs(v) for v in frame_rms])
        active = frame_db > -50.0
        silence_ratio = float(1.0 - np.mean(active))
        if active.any() and (~active).any():
            speech_pow = float(np.mean(frame_rms[active] ** 2))
            noise_pow = float(np.mean(frame_rms[~active] ** 2))
            snr_est = 10.0 * math.log10(max(speech_pow, 1e-12) / max(noise_pow, 1e-12))
        elif active.all():
            # No measurable noise floor: report upper bound honestly
            snr_est = float("inf")

    is_valid = True
    if duration < min_seconds:
        is_valid = False
        feedback.append(
            f"Duration {duration:.2f}s is below the {min_seconds:.0f}s minimum. "
            f"Upstream OmniVoice recommends 3-10s reference clips."
        )
    elif duration > max_seconds:
        is_valid = False
        feedback.append(
            f"Duration {duration:.2f}s exceeds the {max_seconds:.0f}s VoiceForge reference limit; "
            "OmniVoice can trim long input, but this API rejects it rather than silently changing user audio. "
            "Trim to 3-10s for best cloning."
        )
    elif duration <= recommended_seconds:
        feedback.append(f"Duration {duration:.2f}s is within the upstream-recommended 3-10s window.")
    else:
        feedback.append(f"Duration {duration:.2f}s is acceptable (recommended window is 3-10s).")

    if peak < 1e-4:
        is_valid = False
        feedback.append("Audio is effectively silent (peak < -80 dBFS). Record actual speech.")
    if clipping_ratio > max_clipping_ratio:
        is_valid = False
        feedback.append(
            f"Clipping detected on {clipping_ratio * 100:.2f}% of samples (> {max_clipping_ratio * 100:.1f}% limit). "
            "Lower input gain and re-record."
        )
    if silence_ratio > max_silence_ratio:
        is_valid = False
        feedback.append(
            f"{silence_ratio * 100:.0f}% of the clip is silence (> {max_silence_ratio * 100:.0f}% limit). "
            "Speak continuously or trim the recording."
        )
    if rms < 1e-3 and peak >= 1e-4:
        feedback.append("Very low recording level; consider moving closer to the microphone.")
    if not math.isinf(snr_est) and snr_est < min_snr_db:
        is_valid = False
        feedback.append(
            f"Estimated SNR {snr_est:.1f} dB is below the {min_snr_db:.0f} dB floor. Record in a quieter room."
        )
    elif math.isinf(snr_est):
        feedback.append("No silent frames found — SNR could not be estimated from a noise floor (reported as +inf).")
    else:
        feedback.append(f"Estimated SNR {snr_est:.1f} dB (frame-energy method, not a validated perceptual metric).")
    if abs(dc) > 0.01:
        feedback.append(f"DC offset {dc:+.4f} detected; a high-pass filter is recommended.")

    return ReferenceAnalysis(
        is_valid=is_valid,
        duration_seconds=round(duration, 3),
        sample_rate=sr,
        channels=1,
        rms_dbfs=round(_dbfs(rms), 2),
        peak_dbfs=round(_dbfs(peak), 2),
        dc_offset=round(dc, 5),
        clipping_ratio=round(clipping_ratio, 6),
        silence_ratio=round(silence_ratio, 4),
        snr_db_estimate=(None if math.isinf(snr_est) else round(snr_est, 2)) if snr_est != 0.0 else round(snr_est, 2),
        feedback=feedback,
    )
