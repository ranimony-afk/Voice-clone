"""
OmniVoice Microservice Unit & Security Tests
Tests audio decoding, reference validation, text sanitization, and fallback synthesis.
"""

import pytest
import numpy as np
from app.audio_processing import (
    encode_audio_to_base64,
    decode_audio_base64,
    validate_reference_audio,
    TARGET_SAMPLE_RATE,
)
from app.safety import sanitize_input_text, sign_synthesis_manifest
from app.inference import generate_lightweight_speech_fallback, run_tts

def test_audio_roundtrip_encoding():
    """Verifies float32 numpy audio encodes and decodes to WAV base64 accurately."""
    duration = 1.0
    t = np.linspace(0, duration, int(TARGET_SAMPLE_RATE * duration), endpoint=False, dtype=np.float32)
    original_wave = 0.5 * np.sin(2 * np.pi * 440.0 * t)

    b64 = encode_audio_to_base64(original_wave, TARGET_SAMPLE_RATE)
    assert isinstance(b64, str)
    assert len(b64) > 100

    decoded_wave, sr = decode_audio_base64(b64)
    assert sr == TARGET_SAMPLE_RATE
    assert len(decoded_wave) == len(original_wave)
    # 16-bit quantization error tolerance
    np.testing.assert_allclose(decoded_wave, original_wave, atol=1e-3)

def test_reference_audio_validation_rejection():
    """Verifies that short (<2s) or silent audio is rejected for voice cloning."""
    # Too short (< 2.0s)
    short_wave = np.ones(int(TARGET_SAMPLE_RATE * 1.0), dtype=np.float32) * 0.1
    valid, msg = validate_reference_audio(short_wave, TARGET_SAMPLE_RATE)
    assert not valid
    assert "too short" in msg

    # Silent audio (RMS < 0.005)
    silent_wave = np.zeros(int(TARGET_SAMPLE_RATE * 5.0), dtype=np.float32)
    valid, msg = validate_reference_audio(silent_wave, TARGET_SAMPLE_RATE)
    assert not valid
    assert "nearly silent" in msg

    # Valid studio sample (5s with speech energy)
    t = np.linspace(0, 5.0, int(TARGET_SAMPLE_RATE * 5.0), endpoint=False, dtype=np.float32)
    good_wave = 0.3 * np.sin(2 * np.pi * 220.0 * t)
    valid, msg = validate_reference_audio(good_wave, TARGET_SAMPLE_RATE)
    assert valid

def test_text_sanitization_preserves_non_verbal_tags():
    """Ensures non-verbal tags like [laughter] and pinyin are preserved."""
    raw = "  [laughter] That was an amazing demonstration!   "
    clean = sanitize_input_text(raw)
    assert clean == "[laughter] That was an amazing demonstration!"

def test_provenance_manifest_signing():
    """Ensures synthesis generates authentic HMAC-SHA256 signature token."""
    manifest = sign_synthesis_manifest("Hello world", 2.5, "auto_voice", "voice_1")
    assert manifest["manifest_version"] == "1.0"
    assert manifest["engine"] == "k2-fsa/OmniVoice-v0.2.1"
    assert len(manifest["signature"]) == 64

def test_lightweight_speech_fallback_properties():
    """Verifies fallback synthesis produces valid 24kHz audio buffer."""
    wave = generate_lightweight_speech_fallback("Test utterance for VoiceForge synthesis", duration_sec=3.0)
    assert isinstance(wave, np.ndarray)
    assert len(wave) == int(TARGET_SAMPLE_RATE * 3.0)
    assert np.max(np.abs(wave)) <= 1.0
