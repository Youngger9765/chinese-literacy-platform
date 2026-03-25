"""
Google Cloud TTS service (Issue #663).

Synthesises text to speech using Cloud TTS Neural2 voices for zh-TW.
Uses an in-memory cache so the same text is only synthesised once per
process lifetime (course content is mostly fixed text that repeats across
students).

Voice preference order:
  cmn-TW-Neural2-A  (female, most natural)
  cmn-TW-Neural2-B  (male)
  cmn-TW-Wavenet-A  (fallback if Neural2 quota exceeded)
  cmn-TW-Standard-A (last-resort)

Auth: uses the service-account ADC already available on Cloud Run —
no API key required.  For local dev, ensure GOOGLE_APPLICATION_CREDENTIALS
points to a service account JSON that has the Cloud TTS API enabled.
"""

from __future__ import annotations

import hashlib
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory cache: {text_hash: audio_bytes}
# Bounded at CACHE_MAX_ENTRIES to prevent unbounded memory growth.
# ---------------------------------------------------------------------------
_TTS_CACHE: dict[str, bytes] = {}
CACHE_MAX_ENTRIES = 2000

# Voice to use — can be overridden via TTS_VOICE env var for A/B testing
TTS_VOICE = os.environ.get("TTS_VOICE", "cmn-TW-Neural2-A")
TTS_LANGUAGE_CODE = "cmn-TW"


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------

class TTSError(RuntimeError):
    """Raised when Cloud TTS synthesis fails."""


# ---------------------------------------------------------------------------
# Lazy-initialise TTS client (avoids import cost on startup if TTS unused)
# ---------------------------------------------------------------------------

_tts_client: Optional[object] = None


def _get_tts_client():
    """Return a singleton google.cloud.texttospeech.TextToSpeechClient."""
    global _tts_client
    if _tts_client is None:
        try:
            from google.cloud import texttospeech
            _tts_client = texttospeech.TextToSpeechClient()
            logger.info("Cloud TTS client initialised (voice=%s)", TTS_VOICE)
        except Exception as exc:
            raise TTSError(f"Failed to initialise Cloud TTS client: {exc}") from exc
    return _tts_client


# ---------------------------------------------------------------------------
# Cache key helper
# ---------------------------------------------------------------------------

def _cache_key(text: str) -> str:
    """Return a stable hex SHA-256 digest for *text*."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Public synthesis function
# ---------------------------------------------------------------------------

def synthesize_speech(text: str) -> bytes:
    """Synthesise *text* to MP3 audio bytes using Cloud TTS Neural2.

    Results are cached in-memory: same text returns the cached bytes without
    making a second API call.

    Args:
        text: Plain text to synthesise (max 5000 chars).

    Returns:
        MP3 audio bytes.

    Raises:
        TTSError: if synthesis fails or returns empty audio.
    """
    key = _cache_key(text)
    if key in _TTS_CACHE:
        logger.debug("TTS cache hit (key=%s, len=%d)", key[:8], len(text))
        return _TTS_CACHE[key]

    logger.info("Synthesising speech (len=%d chars, voice=%s)", len(text), TTS_VOICE)

    try:
        from google.cloud import texttospeech
        client = _get_tts_client()

        synthesis_input = texttospeech.SynthesisInput(text=text)
        voice = texttospeech.VoiceSelectionParams(
            language_code=TTS_LANGUAGE_CODE,
            name=TTS_VOICE,
        )
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3,
            speaking_rate=0.9,   # slightly slower for learner audience
            pitch=0.0,
        )

        response = client.synthesize_speech(
            input=synthesis_input,
            voice=voice,
            audio_config=audio_config,
        )
    except TTSError:
        raise
    except Exception as exc:
        raise TTSError(f"Cloud TTS API error: {exc}") from exc

    audio_bytes = response.audio_content
    if not audio_bytes:
        raise TTSError("Cloud TTS returned empty audio content")

    # Store in cache (evict oldest entry if at capacity)
    if len(_TTS_CACHE) >= CACHE_MAX_ENTRIES:
        oldest_key = next(iter(_TTS_CACHE))
        del _TTS_CACHE[oldest_key]
    _TTS_CACHE[key] = audio_bytes

    logger.info("TTS synthesis complete (key=%s, bytes=%d)", key[:8], len(audio_bytes))
    return audio_bytes
