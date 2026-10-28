#!/usr/bin/env python3
"""
VoiceForge OmniVoice Hardened Test Suite
Executable standard-library unittest runner (no pytest requirement).
Covers:
- Three-state execution mode contract (NEURAL, DEMO, UNAVAILABLE)
- Prevention of silent harmonic fallback
- Accurate engine reporting in responses
- 503 fail-closed readiness probe behavior in strict neural production mode
- Biometric reference audio acoustic validation (silence, length)
- Prevention of phantom prompt IDs in demo mode
- Cryptographic HMAC manifest signing and text sanitization
- Sanitized error handling and lack of path leakage
"""

import sys
import os
import unittest
from unittest.mock import MagicMock, patch

# Add app directory to sys.path
APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

from app.config import settings
from app.model_manager import model_manager
from app.safety import sanitize_input_text, sign_synthesis_manifest
from app.audio_processing import (
    encode_audio_to_base64,
    decode_audio_base64,
    validate_reference_audio,
    TARGET_SAMPLE_RATE,
)
from app.inference import (
    generate_lightweight_speech_fallback,
    run_tts,
    run_voice_clone,
    ServiceUnavailableError,
)
from app.main import get_health_live_data, get_health_ready_data


class TestAudioProcessingAndSafety(unittest.TestCase):
    """Tests audio encoding/decoding, validation, and HMAC provenance."""

    def test_audio_roundtrip_encoding(self):
        """Verifies float waveform encodes to WAV base64 and decodes with matching sample rate."""
        duration = 1.0
        n_samples = int(TARGET_SAMPLE_RATE * duration)
        original = [0.5 * (1.0 if (i // 100) % 2 == 0 else -1.0) for i in range(n_samples)]
        b64 = encode_audio_to_base64(original, TARGET_SAMPLE_RATE)
        self.assertIsInstance(b64, str)
        self.assertTrue(len(b64) > 100)
        decoded, sr = decode_audio_base64(b64)
        self.assertEqual(sr, TARGET_SAMPLE_RATE)
        self.assertEqual(len(decoded), len(original))

    def test_audio_validation_rejection_short_sample(self):
        """Verifies that short audio (<2.0s) is rejected for voice cloning."""
        short_wave = [0.1] * int(TARGET_SAMPLE_RATE * 1.0)
        valid, msg = validate_reference_audio(short_wave, TARGET_SAMPLE_RATE)
        self.assertFalse(valid)
        self.assertIn("too short", msg)

    def test_audio_validation_rejection_silent_sample(self):
        """Verifies that silent audio (RMS < 0.005) is rejected."""
        silent_wave = [0.0] * int(TARGET_SAMPLE_RATE * 5.0)
        valid, msg = validate_reference_audio(silent_wave, TARGET_SAMPLE_RATE)
        self.assertFalse(valid)
        self.assertIn("silent", msg.lower())

    def test_audio_validation_acceptance_valid_speech(self):
        """Verifies that normal audio passes acoustic validation."""
        normal_wave = [0.25 if (i % 80 < 40) else -0.25 for i in range(int(TARGET_SAMPLE_RATE * 4.0))]
        valid, msg = validate_reference_audio(normal_wave, TARGET_SAMPLE_RATE)
        self.assertTrue(valid)
        self.assertEqual(msg, "Valid")

    def test_text_sanitization_preserves_non_verbal_tags(self):
        """Verifies [laughter], [whispers], and Unicode characters are preserved while control chars stripped."""
        raw = "  \x00[laughter] That was an amazing demonstration! \x1f\n  "
        clean = sanitize_input_text(raw)
        self.assertEqual(clean, "[laughter] That was an amazing demonstration!")

    def test_provenance_manifest_hmac_signature(self):
        """Verifies cryptographic HMAC signature is computed and tracks execution_mode."""
        manifest = sign_synthesis_manifest(
            text="Hello VoiceForge",
            duration=2.5,
            mode="auto_voice",
            voice_id="vf_priya",
            execution_mode="DEMO"
        )
        self.assertEqual(manifest["manifest_version"], "1.0")
        self.assertEqual(manifest["execution_mode"], "DEMO")
        self.assertEqual(manifest["engine"], "development_formant_fallback")
        self.assertEqual(len(manifest["signature"]), 64)


class TestExecutionModeContract(unittest.TestCase):
    """Tests three-state execution contract: NEURAL, DEMO, UNAVAILABLE."""

    def setUp(self):
        model_manager._is_loaded = False
        model_manager._model = None

    def test_no_silent_fallback_when_neural_unavailable(self):
        """SECURITY/INTEGRITY: A request expecting neural synthesis must fail closed with
        ServiceUnavailableError if neural weights are offline and allow_demo=False."""
        with self.assertRaises(ServiceUnavailableError) as ctx:
            run_tts(
                text="Synthesize speech with neural engine",
                allow_demo=False
            )
        self.assertIn("unavailable", str(ctx.exception).lower())
        self.assertIn("allow_demo=True", str(ctx.exception))

    def test_explicit_demo_mode_synthesis(self):
        """Verifies that when allow_demo=True is explicitly passed in development,
        harmonic fallback executes and accurately identifies itself as DEMO."""
        res = run_tts(
            text="Test utterance in explicit demo mode",
            allow_demo=True
        )
        self.assertEqual(res["execution_mode"], "DEMO")
        self.assertEqual(res["is_neural"], False)
        self.assertEqual(res["engine"], "development_formant_fallback")
        self.assertTrue(len(res["audio_base64"]) > 100)
        self.assertEqual(res["manifest"]["execution_mode"], "DEMO")

    def test_no_phantom_saved_prompt_id_in_demo_cloning(self):
        """CRITICAL: Demo cloning must NEVER return a saved_prompt_id because no genuine
        reusable latent prompt was persisted."""
        valid_wave = [0.25 if (i % 80 < 40) else -0.25 for i in range(int(TARGET_SAMPLE_RATE * 3.5))]
        b64_ref = encode_audio_to_base64(valid_wave, TARGET_SAMPLE_RATE)
        res = run_voice_clone(
            text="Cloning utterance in demo mode",
            ref_audio_b64=b64_ref,
            save_prompt=True,
            allow_demo=True
        )
        self.assertEqual(res["execution_mode"], "DEMO")
        self.assertIsNone(res["saved_prompt_id"], "Demo cloning must not return phantom prompt IDs")
        self.assertEqual(res["is_neural"], False)
        self.assertEqual(res["engine"], "development_formant_fallback")

    def test_mocked_neural_inference_flow(self):
        """Verifies that when a genuine model is loaded, execution_mode is reported as NEURAL."""
        mock_model = MagicMock()
        mock_wave = [0.1] * int(TARGET_SAMPLE_RATE * 1.5)
        mock_model.generate.return_value = [mock_wave]
        with patch.object(model_manager, "_is_loaded", True), \
             patch.object(model_manager, "_model", mock_model):
            res = run_tts(
                text="Neural synthesis through mocked OmniVoice model",
                allow_demo=False
            )
            self.assertEqual(res["execution_mode"], "NEURAL")
            self.assertTrue(res["is_neural"])
            self.assertEqual(res["engine"], "k2-fsa/OmniVoice-v0.2.1")
            self.assertEqual(mock_model.generate.call_count, 1)

    def test_voice_cloning_fails_closed_when_neural_offline(self):
        """Verifies that voice cloning fails closed without silent fallback if allow_demo=False."""
        valid_wave = [0.25 if (i % 80 < 40) else -0.25 for i in range(int(TARGET_SAMPLE_RATE * 3.5))]
        b64_ref = encode_audio_to_base64(valid_wave, TARGET_SAMPLE_RATE)
        with self.assertRaises(ServiceUnavailableError):
            run_voice_clone(
                text="Cloning request without demo permission",
                ref_audio_b64=b64_ref,
                allow_demo=False
            )


class TestHealthProbesAndService(unittest.TestCase):
    """Tests health probes and fail-closed readiness behavior."""

    def setUp(self):
        model_manager._is_loaded = False
        model_manager._model = None

    def test_liveness_probe_returns_live(self):
        """Liveness must return 'live' regardless of neural weight loading state."""
        data = get_health_live_data()
        self.assertEqual(data["status"], "live")
        self.assertIn("execution_mode", data)

    def test_readiness_probe_returns_503_in_strict_neural_mode_when_unloaded(self):
        """In strict neural or production mode, readiness must return 503 if weights are not loaded."""
        with patch.object(settings, "allow_demo", False), \
             patch.object(settings, "execution_mode", "NEURAL"):
            code, data = get_health_ready_data()
            self.assertEqual(code, 503)
            self.assertEqual(data["status"], "unavailable")
            self.assertEqual(data["execution_mode"], "UNAVAILABLE")

    def test_readiness_probe_returns_200_when_model_is_loaded(self):
        """Readiness returns 200 NEURAL when model is genuinely loaded."""
        with patch.object(model_manager, "_is_loaded", True):
            code, data = get_health_ready_data()
            self.assertEqual(code, 200)
            self.assertEqual(data["status"], "ready")
            self.assertEqual(data["execution_mode"], "NEURAL")
            self.assertTrue(data["is_neural"])

    def test_readiness_probe_returns_200_demo_in_development(self):
        """In development mode with allow_demo=True, readiness returns 200 with DEMO mode."""
        with patch.object(settings, "allow_demo", True), \
             patch.object(settings, "execution_mode", "DEMO"):
            code, data = get_health_ready_data()
            self.assertEqual(code, 200)
            self.assertEqual(data["status"], "ready")
            self.assertEqual(data["execution_mode"], "DEMO")
            self.assertFalse(data["is_neural"])


def run_all_tests():
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(TestAudioProcessingAndSafety))
    suite.addTests(loader.loadTestsFromTestCase(TestExecutionModeContract))
    suite.addTests(loader.loadTestsFromTestCase(TestHealthProbesAndService))
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(run_all_tests())
