"""
Input safety and validation policy for the OmniVoice service.

Only parameters that exist in the verified upstream API surface
(omnivoice 0.2.1, git 08be0b4c — see THIRD_PARTY_INVENTORY.md §3) are
accepted. Nothing here invents OmniVoice parameters. Voice-design
vocabulary is exactly the documented attribute table (docs/voice-design.md):
gender / age / pitch / style(whisper) / English accents / Chinese dialects.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

# --- Voice-design vocabulary (upstream docs/voice-design.md, verified) ---
VOICE_DESIGN_TOKENS_EN = {
    # gender
    "male", "female",
    # age
    "child", "teenager", "young adult", "middle-aged", "elderly",
    # pitch
    "very low pitch", "low pitch", "moderate pitch", "high pitch", "very high pitch",
    # style
    "whisper",
    # english accents (effective for English text only)
    "american accent", "british accent", "australian accent", "canadian accent",
    "indian accent", "chinese accent", "korean accent", "japanese accent",
    "portuguese accent", "russian accent",
}
VOICE_DESIGN_TOKENS_ZH = {
    "男", "女", "儿童", "少年", "青年", "中年", "老年",
    "极低音调", "低音调", "中音调", "高音调", "极高音调", "耳语",
    "河南话", "陕西话", "四川话", "贵州话", "云南话", "桂林话", "济南话", "石家庄话", "甘肃话",
}
VOICE_DESIGN_TOKENS = VOICE_DESIGN_TOKENS_EN | VOICE_DESIGN_TOKENS_ZH

# Non-verbal inline tags supported by the model (README, verified). These are
# allowed inside text, so the control-character scrubber must keep brackets.
NON_VERBAL_TAGS = {
    "[laughter]", "[sigh]", "[confirmation-en]", "[question-en]", "[question-ah]",
    "[question-oh]", "[question-ei]", "[question-yi]", "[surprise-ah]", "[surprise-oh]",
    "[surprise-wa]", "[surprise-yo]", "[dissatisfaction-hnn]",
}

_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class ValidationError(ValueError):
    """Policy violation — surfaced as HTTP 422 with code VALIDATION_ERROR."""


@dataclass
class CleanedText:
    text: str
    warnings: list[str]


def clean_text(text: str, *, max_chars: int) -> CleanedText:
    if not isinstance(text, str):
        raise ValidationError("text must be a string")
    warnings: list[str] = []
    normalized = unicodedata.normalize("NFC", text)
    scrubbed = _CONTROL_CHAR_RE.sub("", normalized)
    if scrubbed != normalized:
        warnings.append("Control characters were stripped from the input text.")
    stripped = scrubbed.strip()
    if not stripped:
        raise ValidationError("text is empty or whitespace-only")
    if len(stripped) > max_chars:
        raise ValidationError(
            f"text exceeds the {max_chars}-character limit (got {len(stripped)}). "
            "Split long scripts into multiple jobs."
        )
    return CleanedText(text=stripped, warnings=warnings)


def validate_instruct(instruct: str) -> list[str]:
    """Validate a voice-design instruction against the documented vocabulary.

    Returns warnings (e.g. accent used with non-English text is caller-side
    knowledge, so here we only validate token membership). Raises
    ValidationError listing supported values when unknown tokens appear —
    we refuse to forward invented attributes to the model.
    """
    if not isinstance(instruct, str) or not instruct.strip():
        raise ValidationError("instruct must be a non-empty string")
    tokens = [t.strip().lower() for t in instruct.split(",") if t.strip()]
    if not tokens:
        raise ValidationError("instruct contains no attributes")
    unknown = [t for t in tokens if t not in VOICE_DESIGN_TOKENS]
    if unknown:
        raise ValidationError(
            "Unsupported voice-design attribute(s): "
            + ", ".join(repr(u) for u in unknown)
            + ". Supported (upstream docs/voice-design.md): gender (male/female), age "
            "(child/teenager/young adult/middle-aged/elderly), pitch (very low..very high pitch), "
            "style (whisper), English accents (american/british/australian/canadian/indian/chinese/"
            "korean/japanese/portuguese/russian accent), Chinese dialects (四川话 etc.)."
        )
    warnings: list[str] = []
    if len(set(tokens)) != len(tokens):
        warnings.append("Duplicate voice-design attributes were de-duplicated.")
    return warnings


def validate_language(language: str | None) -> str | None:
    """Pass through upstream language names/IDs (646 supported; the model
    validates). We only sanitize the shape: short alphabetic ID or a
    reasonable human-readable name."""
    if language is None:
        return None
    if not isinstance(language, str):
        raise ValidationError("language must be a string or null")
    lang = language.strip()
    if not lang:
        return None
    if len(lang) > 64 or not re.match(r"^[A-Za-z\- ]+$", lang):
        raise ValidationError(
            "language must be an OmniVoice language ID (e.g. 'en', 'ta', 'hi', 'ja', 'ml') "
            "or English language name (e.g. 'Tamil')"
        )
    return lang


def validate_generation_params(params: dict) -> dict:
    """Validate the OmniVoice generation parameters we expose. Ranges are
    VoiceForge API policy; the parameter NAMES and semantics are exactly the
    verified upstream ones (num_step, guidance_scale, speed, duration,
    normalize_text, denoise, postprocess_output)."""
    allowed = {
        "text", "language", "instruct", "voice_prompt_id", "cancel_token",
        "num_step", "guidance_scale", "speed", "duration", "normalize_text",
        "denoise", "postprocess_output",
    }
    unknown = set(params) - allowed
    if unknown:
        raise ValidationError(
            "Unsupported generation parameter(s): " + ", ".join(sorted(unknown))
            + ". Only the verified OmniVoice API parameters are accepted."
        )
    out: dict = {}

    def num(name: str, lo: float, hi: float, cast):
        if name in params and params[name] is not None:
            v = params[name]
            try:
                v = cast(v)
            except (TypeError, ValueError):
                raise ValidationError(f"{name} must be a number")
            if not (lo <= v <= hi):
                raise ValidationError(f"{name} must be within [{lo}, {hi}] (got {v})")
            out[name] = v

    num("num_step", 1, 128, int)
    num("guidance_scale", 0.0, 10.0, float)
    num("speed", 0.5, 2.0, float)
    num("duration", 0.5, 600.0, float)

    for flag in ("normalize_text", "denoise", "postprocess_output"):
        if flag in params and params[flag] is not None:
            if not isinstance(params[flag], bool):
                raise ValidationError(f"{flag} must be a boolean")
            out[flag] = params[flag]

    if "duration" in out and "speed" in out:
        # Upstream: duration overrides speed. Keep both but note it.
        out.setdefault("_warnings", []).append(
            "Both duration and speed provided; upstream gives duration priority and ignores speed."
        )
    return out
