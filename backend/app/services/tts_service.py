"""
Google Cloud TTS service (Issue #663).

Two-layer cache: GCS (persistent) → in-memory (fast).
1. Check in-memory dict
2. Check GCS bucket
3. Call Cloud TTS API → save to GCS + in-memory

Voice: cmn-CN-Chirp3-HD-Sulafat (female, highest quality)
  - Chirp3-HD is Google's latest and most natural voice
  - Uses cmn-CN locale but pronunciation is standard Mandarin (same as cmn-TW)

Override via TTS_VOICE env var, e.g. TTS_VOICE=cmn-CN-Chirp3-HD-Aoede

Auth: uses the service-account ADC already available on Cloud Run —
no API key required.
"""

from __future__ import annotations

import hashlib
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory cache (L1): {text_hash: audio_bytes}
# ---------------------------------------------------------------------------
_TTS_CACHE: dict[str, bytes] = {}
CACHE_MAX_ENTRIES = 500

# ---------------------------------------------------------------------------
# GCS cache (L2): gs://{bucket}/tts-cache/{hash}.mp3
# ---------------------------------------------------------------------------
TTS_GCS_BUCKET = os.environ.get("TTS_GCS_BUCKET", "lingoleap-tts-cache")

# Sentinel: once GCS init fails, stop retrying for this process lifetime.
_GCS_UNAVAILABLE = object()

_gcs_client: object = None  # None = not yet attempted, _GCS_UNAVAILABLE = failed


def _get_gcs_bucket():
    """Return a lazy-initialised GCS bucket object, or None if unavailable."""
    global _gcs_client
    if _gcs_client is _GCS_UNAVAILABLE:
        return None
    if _gcs_client is None:
        try:
            from google.cloud import storage
            client = storage.Client()
            _gcs_client = client.bucket(TTS_GCS_BUCKET)
            logger.info("GCS TTS cache bucket: %s", TTS_GCS_BUCKET)
        except Exception as exc:
            logger.warning("GCS cache unavailable, falling back to API-only: %s", exc)
            _gcs_client = _GCS_UNAVAILABLE
            return None
    return _gcs_client


def _gcs_get(key: str) -> Optional[bytes]:
    """Try to read cached audio from GCS. Returns None on miss or error."""
    bucket = _get_gcs_bucket()
    if bucket is None:
        return None
    try:
        blob = bucket.blob(f"tts-cache/{key}.mp3")
        if blob.exists():
            data = blob.download_as_bytes()
            logger.debug("GCS cache hit (key=%s, bytes=%d)", key[:8], len(data))
            return data
    except Exception as exc:
        logger.warning("GCS cache read error: %s", exc)
    return None


def _gcs_put(key: str, audio_bytes: bytes) -> None:
    """Write audio to GCS cache. Failures are logged but not raised."""
    bucket = _get_gcs_bucket()
    if bucket is None:
        return
    try:
        blob = bucket.blob(f"tts-cache/{key}.mp3")
        blob.upload_from_string(audio_bytes, content_type="audio/mpeg")
        logger.debug("GCS cache write (key=%s, bytes=%d)", key[:8], len(audio_bytes))
    except Exception as exc:
        logger.warning("GCS cache write error: %s", exc)


# ---------------------------------------------------------------------------
# Voice config
# ---------------------------------------------------------------------------
TTS_VOICE = os.environ.get("TTS_VOICE", "cmn-CN-Chirp3-HD-Sulafat")
TTS_LANGUAGE_CODE = "cmn-CN"


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------

class TTSError(RuntimeError):
    """Raised when Cloud TTS synthesis fails."""


# ---------------------------------------------------------------------------
# Lazy-initialise TTS client
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
    """Synthesise *text* to MP3 audio bytes using Cloud TTS Chirp3-HD.

    Two-layer cache: in-memory (L1) → GCS (L2) → API call.
    Results are persisted to GCS so they survive deploys and cold starts.

    Args:
        text: Plain text to synthesise (max 5000 chars).

    Returns:
        MP3 audio bytes.

    Raises:
        TTSError: if synthesis fails or returns empty audio.
    """
    key = _cache_key(text)

    # L1: in-memory
    if key in _TTS_CACHE:
        logger.debug("L1 cache hit (key=%s)", key[:8])
        return _TTS_CACHE[key]

    # L2: GCS
    gcs_data = _gcs_get(key)
    if gcs_data is not None:
        _l1_put(key, gcs_data)
        return gcs_data

    # L3: API call
    logger.info("TTS cache miss, calling API (len=%d chars, voice=%s)", len(text), TTS_VOICE)

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
            speaking_rate=0.9,
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

    # Save to both caches
    _l1_put(key, audio_bytes)
    _gcs_put(key, audio_bytes)

    logger.info("TTS synthesis complete (key=%s, bytes=%d)", key[:8], len(audio_bytes))
    return audio_bytes


def _l1_put(key: str, audio_bytes: bytes) -> None:
    """Store in L1 in-memory cache with eviction."""
    if len(_TTS_CACHE) >= CACHE_MAX_ENTRIES:
        oldest_key = next(iter(_TTS_CACHE))
        del _TTS_CACHE[oldest_key]
    _TTS_CACHE[key] = audio_bytes
