"""
VoiceForge Pluggable Engine Interface
Author: VoiceForge Architecture Team
License: Apache-2.0

Standard abstraction layer allowing transparent swapping between inference backends:
- CosyVoice 2 (Zero-shot flow matching)
- AI4Bharat Indic Parler-TTS / IndicF5
- OpenVoice v2 (Tone Color Converter)
- Cloud / Fast Fallback Engines
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import AsyncGenerator, Dict, List, Optional, Tuple, Union
import numpy as np


class SupportedLanguage(str, Enum):
    ENGLISH = "en"
    HINDI = "hi"
    TAMIL = "ta"
    MALAYALAM = "ml"
    JAPANESE = "ja"


class AudioFormat(str, Enum):
    WAV = "wav"
    MP3 = "mp3"
    OGG_OPUS = "ogg_opus"
    FLAC = "flac"


@dataclass
class VoiceSettings:
    stability: float = 0.75         # 0.0 to 1.0 (higher = more consistent, lower = more expressive variance)
    similarity: float = 0.85        # 0.0 to 1.0 (closeness to target speaker embedding)
    style: float = 0.20             # 0.0 to 1.0 (exaggeration / emotional intensity)
    speed: float = 1.00             # 0.5 to 2.0x playback rate
    pitch: float = 0.00             # -12.0 to +12.0 semitones
    speaker_boost: bool = True      # Enhances high-frequency presence of cloned timbre


@dataclass
class VoiceProfile:
    id: str
    name: str
    language: SupportedLanguage
    speaker_embedding: np.ndarray   # 192-dim ECAPA-TDNN or 512-dim flow latent
    ref_audio_path: Optional[str] = None
    settings: VoiceSettings = field(default_factory=VoiceSettings)


@dataclass
class AudioChunk:
    pcm_bytes: bytes                # Raw 16-bit PCM or encoded audio slice
    sample_rate: int = 24000
    channels: int = 1
    duration_ms: float = 0.0
    is_final: bool = False
    watermark_tag: Optional[str] = None


@dataclass
class AudioQualityReport:
    is_valid: bool
    snr_db: float                   # Signal-to-Noise Ratio (dB) >= 20 required
    duration_seconds: float         # 10 to 60 seconds recommended
    clipping_ratio: float           # Max 0.01 (1%) allowed
    feedback: List[str]


class BaseAudioWatermarker(ABC):
    """Spread-spectrum cryptographic audio watermarking engine."""

    @abstractmethod
    def embed_watermark(self, pcm_audio: np.ndarray, sample_rate: int, payload: str) -> np.ndarray:
        """Embeds imperceptible watermark into audio array without degrading UTMOS score."""
        pass

    @abstractmethod
    def detect_watermark(self, audio_data: np.ndarray, sample_rate: int) -> Optional[str]:
        """Detects and decodes VoiceForge signature payload if present."""
        pass


class BaseSpeakerEmbeddingExtractor(ABC):
    """Extracts speaker identity vectors (ECAPA-TDNN / WavLM)."""

    @abstractmethod
    def extract_embedding(self, audio_path_or_bytes: Union[str, bytes]) -> np.ndarray:
        """Returns 192-dimensional L2-normalized speaker embedding."""
        pass

    @abstractmethod
    def compute_similarity(self, emb_a: np.ndarray, emb_b: np.ndarray) -> float:
        """Returns cosine similarity score between [-1.0, 1.0]. Match threshold >= 0.78."""
        pass


class TTSEngine(ABC):
    """
    Pluggable Engine Interface for Multilingual Voice Synthesis & Cloning.
    All models (CosyVoice, Indic Parler-TTS, etc.) implement this contract.
    """

    @abstractmethod
    def get_supported_languages(self) -> List[SupportedLanguage]:
        """Returns list of supported language codes."""
        pass

    @abstractmethod
    async def synthesize(
        self,
        text: str,
        voice: VoiceProfile,
        lang: SupportedLanguage,
        settings: Optional[VoiceSettings] = None
    ) -> Tuple[bytes, float]:
        """
        Synthesizes complete audio buffer.
        Returns:
            Tuple of (audio_bytes, duration_seconds)
        """
        pass

    @abstractmethod
    async def synthesize_stream(
        self,
        text: str,
        voice: VoiceProfile,
        lang: SupportedLanguage,
        settings: Optional[VoiceSettings] = None
    ) -> AsyncGenerator[AudioChunk, None]:
        """
        Streams audio chunks with low time-to-first-byte (target < 500ms).
        """
        pass

    @abstractmethod
    async def clone_voice(
        self,
        audio_files: List[str],
        voice_name: str,
        target_language: SupportedLanguage = SupportedLanguage.ENGLISH
    ) -> VoiceProfile:
        """
        Extracts voice identity, loudness normalizes, and packages VoiceProfile.
        """
        pass

    @abstractmethod
    def check_audio_quality(self, audio_path: str) -> AudioQualityReport:
        """
        Validates SNR, clipping, background noise, and duration before cloning.
        """
        pass


class SpeechToSpeechEngine(ABC):
    """Speech-to-Speech (Voice Changer) preserving source prosody with target timbre."""

    @abstractmethod
    async def convert_voice(
        self,
        source_audio_bytes: bytes,
        target_voice: VoiceProfile,
        preserve_pitch: bool = True
    ) -> bytes:
        pass


class ASTREngine(ABC):
    """Multilingual Speech-to-Text with word-level timestamps and speaker diarization."""

    @abstractmethod
    async def transcribe(
        self,
        audio_bytes: bytes,
        language: Optional[SupportedLanguage] = None
    ) -> Dict[str, Union[str, List[Dict[str, Union[float, str]]]]]:
        """Returns full text transcription + array of word timestamps."""
        pass
