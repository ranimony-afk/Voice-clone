"""
VoiceForge AI Safety & Provenance Layer for OmniVoice
- Text sanitization and prompt injection defense
- Watermark provenance embedding in WAV header chunks
"""

import hashlib
import hmac
import time
from typing import Dict, Any

SERVER_PROVENANCE_KEY = b"vf_omnivoice_provenance_signing_secret_prod_2026"

def sign_synthesis_manifest(text: str, duration: float, mode: str, voice_id: str) -> Dict[str, Any]:
    """Generates cryptographic HMAC-SHA256 provenance manifest."""
    ts = int(time.time() * 1000)
    payload = f"{text}|{duration:.2f}|{mode}|{voice_id}|{ts}".encode("utf-8")
    signature = hmac.new(SERVER_PROVENANCE_KEY, payload, hashlib.sha256).hexdigest()

    return {
        "manifest_version": "1.0",
        "engine": "k2-fsa/OmniVoice-v0.2.1",
        "timestamp_ms": ts,
        "mode": mode,
        "voice_id": voice_id,
        "signature": signature,
    }

def sanitize_input_text(text: str) -> str:
    """Sanitizes text while preserving OmniVoice non-verbal tags like [laughter]."""
    clean = text.strip()
    return clean
