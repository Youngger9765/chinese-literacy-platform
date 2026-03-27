"""
TTS service — Azure Speech (primary) + Google Cloud TTS (fallback).

Two-layer cache: GCS (persistent) → in-memory (fast).
1. Check in-memory dict
2. Check GCS bucket  (azure/sentences/{hash}.mp3 or tts-cache/{hash}.mp3)
3. Call Azure Speech API → save to GCS + in-memory
4. If Azure fails → fall back to Google Cloud TTS

Azure voice: zh-TW-HsiaoChenNeural (Taiwan accent, female)
Google voice: cmn-CN-Chirp3-HD-Sulafat (fallback)

Provider auto-detected: Azure if AZURE_SPEECH_KEY is set, otherwise Google

GCS paths:
  Azure  — azure/sentences/{hash}.mp3  (sentence-level, Issue #667)
  Google — tts-cache/{hash}.mp3        (legacy path, unchanged for compatibility)

Auth:
  Azure  — Ocp-Apim-Subscription-Key header (AZURE_SPEECH_KEY env var)
  Google — service-account ADC already available on Cloud Run, no API key needed
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import urllib.error
import urllib.request
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory cache (L1): {text_hash: audio_bytes}
# ---------------------------------------------------------------------------
_TTS_CACHE: dict[str, bytes] = {}
CACHE_MAX_ENTRIES = 500

# ---------------------------------------------------------------------------
# GCS cache (L2)
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


def _gcs_get(key: str, provider: str = "google") -> Optional[bytes]:
    """Try to read cached audio from GCS. Returns None on miss or error.

    GCS paths:
      Azure  — azure/sentences/{key}.mp3  (sentence-level, Issue #667)
      Google — tts-cache/{key}.mp3        (legacy path, unchanged for compatibility)
    """
    bucket = _get_gcs_bucket()
    if bucket is None:
        return None
    if provider == "azure":
        blob_path = f"azure/sentences/{key}.mp3"
    else:
        blob_path = f"tts-cache/{key}.mp3"
    try:
        blob = bucket.blob(blob_path)
        if blob.exists():
            data = blob.download_as_bytes()
            logger.debug("GCS cache hit (provider=%s, key=%s, bytes=%d)", provider, key[:8], len(data))
            return data
    except Exception as exc:
        logger.warning("GCS cache read error: %s", exc)
    return None


def _gcs_put(key: str, audio_bytes: bytes, provider: str = "google") -> None:
    """Write audio to GCS cache. Failures are logged but not raised.

    GCS paths:
      Azure  — azure/sentences/{key}.mp3  (sentence-level, Issue #667)
      Google — tts-cache/{key}.mp3        (legacy path, unchanged for compatibility)
    """
    bucket = _get_gcs_bucket()
    if bucket is None:
        return
    if provider == "azure":
        blob_path = f"azure/sentences/{key}.mp3"
    else:
        blob_path = f"tts-cache/{key}.mp3"
    try:
        blob = bucket.blob(blob_path)
        blob.upload_from_string(audio_bytes, content_type="audio/mpeg")
        logger.debug("GCS cache write (provider=%s, key=%s, bytes=%d)", provider, key[:8], len(audio_bytes))
    except Exception as exc:
        logger.warning("GCS cache write error: %s", exc)


# ---------------------------------------------------------------------------
# Provider config
# ---------------------------------------------------------------------------
# Azure Speech Service (台灣腔，primary if key is set)
AZURE_SPEECH_KEY = os.environ.get("AZURE_SPEECH_KEY", "")
AZURE_SPEECH_REGION = os.environ.get("AZURE_SPEECH_REGION", "eastus")
AZURE_TTS_VOICE = os.environ.get("AZURE_TTS_VOICE", "zh-TW-HsiaoChenNeural")

# Google Cloud TTS (fallback)
TTS_VOICE = os.environ.get("TTS_VOICE", "cmn-CN-Chirp3-HD-Sulafat")
TTS_LANGUAGE_CODE = "cmn-CN"


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------

class TTSError(RuntimeError):
    """Raised when TTS synthesis fails on all providers."""


# ---------------------------------------------------------------------------
# Azure Speech — REST API synthesis
# ---------------------------------------------------------------------------

def _synthesize_azure(text: str) -> bytes:
    """Synthesise text via Azure Speech Service REST API.

    Voice: zh-TW-HsiaoChenNeural (Taiwan accent, female)
    Output: audio-16khz-128kbitrate-mono-mp3
    Rate: 0.95 (slightly slower than natural for reading practice)

    Raises:
        TTSError: if Azure key is missing, HTTP error, or empty audio returned.
    """
    if not AZURE_SPEECH_KEY:
        raise TTSError("AZURE_SPEECH_KEY is not set")

    url = f"https://{AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1"

    # Escape XML special chars in text before embedding in SSML
    text_escaped = (
        text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )

    ssml = (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-TW">'
        f'<voice name="{AZURE_TTS_VOICE}">'
        f'<prosody rate="0.95">{text_escaped}</prosody>'
        "</voice>"
        "</speak>"
    )

    req = urllib.request.Request(
        url,
        data=ssml.encode("utf-8"),
        headers={
            "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-48khz-192kbitrate-mono-mp3",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            audio_bytes = resp.read()
    except urllib.error.HTTPError as exc:
        raise TTSError(f"Azure TTS HTTP error {exc.code}: {exc.reason}") from exc
    except Exception as exc:
        raise TTSError(f"Azure TTS request failed: {exc}") from exc

    if not audio_bytes:
        raise TTSError("Azure TTS returned empty audio content")

    return audio_bytes


# ---------------------------------------------------------------------------
# Google Cloud TTS — lazy-initialise client
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

def _clean_for_tts(text: str) -> str:
    """Strip symbols that TTS would read aloud (e.g. ~~~ → '波浪符波浪符波浪符')."""
    # Remove decorative symbols that aren't meant to be spoken
    text = re.sub(r'[~～]+', '', text)           # tildes (~~~)
    text = re.sub(r'[──—–−]{1,}', '，', text)    # long dashes, minus → pause
    text = re.sub(r'-{2,}', '，', text)           # double hyphens → pause
    text = re.sub(r'[.]{3,}|[…⋯]+', '，', text)  # ellipsis (all variants) → pause
    text = re.sub(r'#', '', text)                 # hashtag symbols (#MeToo → MeToo)
    text = re.sub(r'(\d+)/(\d+)', r'\1 之 \2', text)  # blood pressure 210/120 → 210 之 120
    text = re.sub(r'[/\\|]+', '', text)           # remaining slashes
    text = re.sub(r'[\*\[\]\{\}]+', '', text)     # markdown symbols
    text = re.sub(r'[·‧・°○]+', '', text)        # interpunct, degree, circle
    text = re.sub(r'%', '百分之', text)           # percent → spoken form
    text = re.sub(r'[\uf410\U000E01E0-\U000E01E4]+', '', text)  # invisible/private-use chars
    text = re.sub(r'，{2,}', '，', text)          # collapse multiple pauses
    text = re.sub(r'\s+', ' ', text).strip()      # collapse whitespace
    return text


def _cache_key(text: str) -> str:
    """Return a stable hex SHA-256 digest for *text*."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Sentence splitting — kept for Google Chirp3-HD compatibility.
# Azure has no strict length limit but we keep splitting for consistency.
# ---------------------------------------------------------------------------

MAX_SENTENCE_LEN = 40  # safe threshold (tested: 50 OK, 70 FAIL for Google)


def _split_sentences(text: str) -> list[str]:
    """Split Chinese text into chunks ≤ MAX_SENTENCE_LEN chars.

    Strategy: split by sentence-ending punctuation first, then by
    comma/pause marks if still too long.
    """
    # Split by sentence-ending punctuation
    parts = re.split(r'(?<=[。！？\n])', text)
    sentences = [s.strip() for s in parts if s.strip()]

    result: list[str] = []
    for s in sentences:
        if len(s) <= MAX_SENTENCE_LEN:
            result.append(s)
        else:
            # Split by comma/pause marks
            sub = re.split(r'(?<=[，、；：」）])', s)
            chunk = ""
            for part in sub:
                if len(chunk) + len(part) > MAX_SENTENCE_LEN and chunk:
                    result.append(chunk)
                    chunk = part
                else:
                    chunk += part
            if chunk:
                result.append(chunk)
    return result


# ---------------------------------------------------------------------------
# Single-chunk synthesis — Google Cloud TTS (internal, no splitting)
# ---------------------------------------------------------------------------

def _synthesize_chunk(text: str) -> bytes:
    """Synthesise a single short text chunk via Google Cloud TTS API."""
    try:
        from google.cloud import texttospeech
        client = _get_tts_client()

        response = client.synthesize_speech(
            input=texttospeech.SynthesisInput(text=text),
            voice=texttospeech.VoiceSelectionParams(
                language_code=TTS_LANGUAGE_CODE,
                name=TTS_VOICE,
            ),
            audio_config=texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3,
                speaking_rate=0.9,
                pitch=0.0,
            ),
        )
    except TTSError:
        raise
    except Exception as exc:
        raise TTSError(f"Cloud TTS API error: {exc}") from exc

    audio_bytes = response.audio_content
    if not audio_bytes:
        raise TTSError("Cloud TTS returned empty audio content")
    return audio_bytes


def _synthesize_google(text: str) -> bytes:
    """Synthesise full text via Google Cloud TTS (with sentence splitting)."""
    sentences = _split_sentences(text)
    logger.info(
        "Google TTS API call (len=%d chars, %d chunks, voice=%s)",
        len(text), len(sentences), TTS_VOICE,
    )
    chunks: list[bytes] = []
    for sentence in sentences:
        chunks.append(_synthesize_chunk(sentence))
    return b"".join(chunks)


# ---------------------------------------------------------------------------
# Public synthesis function
# ---------------------------------------------------------------------------

def synthesize_speech(text: str) -> bytes:
    """Synthesise *text* to MP3 audio bytes.

    Provider priority: Azure (primary) → Google Cloud TTS (fallback).
    Provider auto-detected: Azure if AZURE_SPEECH_KEY is set, otherwise Google.

    Two-layer cache: in-memory (L1) → GCS (L2) → API call.
    GCS paths: azure/{hash}.mp3 (Azure) or tts-cache/{hash}.mp3 (Google).

    Args:
        text: Plain text to synthesise (max 5000 chars).

    Returns:
        MP3 audio bytes.

    Raises:
        TTSError: if all providers fail or text is empty after cleaning.
    """
    key = _cache_key(text)

    # L1: in-memory
    if key in _TTS_CACHE:
        logger.debug("L1 cache hit (key=%s)", key[:8])
        return _TTS_CACHE[key]

    # Auto-detect provider: Azure if key is set, otherwise Google
    active_provider = "azure" if AZURE_SPEECH_KEY else "google"

    # L2: GCS — check active provider's path first
    gcs_data = _gcs_get(key, provider=active_provider)
    if gcs_data is not None:
        _l1_put(key, gcs_data)
        return gcs_data

    # If provider is azure, also check legacy google path (serve existing google cache)
    if active_provider == "azure":
        gcs_data = _gcs_get(key, provider="google")
        if gcs_data is not None:
            _l1_put(key, gcs_data)
            return gcs_data

    # Clean text before synthesis
    cleaned = _clean_for_tts(text)
    if not cleaned:
        raise TTSError("Text is empty after cleaning")

    # L3: API call
    audio_bytes: Optional[bytes] = None
    used_provider: str

    if active_provider == "azure":
        # Try Azure first; fall back to Google on any error
        try:
            logger.info(
                "Azure TTS API call (len=%d chars, voice=%s)",
                len(cleaned), AZURE_TTS_VOICE,
            )
            audio_bytes = _synthesize_azure(cleaned)
            used_provider = "azure"
        except TTSError as exc:
            logger.warning("Azure TTS failed, falling back to Google: %s", exc)
            try:
                audio_bytes = _synthesize_google(cleaned)
                used_provider = "google"
            except TTSError as google_exc:
                raise TTSError(
                    f"Both Azure ({exc}) and Google ({google_exc}) TTS failed"
                ) from google_exc
    else:
        # Provider explicitly set to "google" — skip Azure entirely
        audio_bytes = _synthesize_google(cleaned)
        used_provider = "google"

    # Save to both caches (use the provider that actually succeeded)
    _l1_put(key, audio_bytes)
    _gcs_put(key, audio_bytes, provider=used_provider)

    logger.info(
        "TTS synthesis complete (provider=%s, key=%s, bytes=%d)",
        used_provider, key[:8], len(audio_bytes),
    )
    return audio_bytes


def _l1_put(key: str, audio_bytes: bytes) -> None:
    """Store in L1 in-memory cache with eviction."""
    if len(_TTS_CACHE) >= CACHE_MAX_ENTRIES:
        oldest_key = next(iter(_TTS_CACHE))
        del _TTS_CACHE[oldest_key]
    _TTS_CACHE[key] = audio_bytes


# ---------------------------------------------------------------------------
# Sentence-level synthesis — Issue #667
# ---------------------------------------------------------------------------

def synthesize_sentence(text: str) -> bytes:
    """Synthesise a single sentence to MP3 audio bytes.

    Same as synthesize_speech() but explicitly stores under azure/sentences/ path.
    For Azure provider, this is the same behaviour (already uses azure/sentences/).
    For Google fallback, also stores under azure/sentences/ to avoid confusion.

    Backward-compatible: synthesize_speech() also stores under azure/sentences/ now.
    """
    return synthesize_speech(text)


# ---------------------------------------------------------------------------
# Lesson TTS mapping — Issue #667
# ---------------------------------------------------------------------------

def build_lesson_tts_mapping(lesson: dict) -> dict:
    """Build a sentence-level TTS mapping for a lesson.

    Given a lesson dict (from lesson_loader), splits each paragraph into
    sentences and returns a mapping structure with text, hash, and char count
    for each sentence.

    Args:
        lesson: Lesson dict with 'id', 'paragraphs' keys.

    Returns:
        Mapping dict:
        {
            "lesson_id": 1,
            "paragraphs": [
                {
                    "index": 0,
                    "sentences": [
                        {"text": "cleaned sentence", "hash": "sha256hex", "chars": 32}
                    ]
                }
            ]
        }
    """
    lesson_id = lesson.get("id") or lesson.get("lesson_number")
    paragraphs_raw = lesson.get("paragraphs", [])

    mapping_paragraphs = []
    for idx, paragraph in enumerate(paragraphs_raw):
        if not paragraph or not str(paragraph).strip():
            continue
        cleaned_paragraph = _clean_for_tts(str(paragraph))
        if not cleaned_paragraph:
            continue
        sentences = _split_sentences(cleaned_paragraph)
        sentence_entries = []
        for sent in sentences:
            if not sent.strip():
                continue
            h = _cache_key(sent)
            sentence_entries.append({
                "text": sent,
                "hash": h,
                "chars": len(sent),
            })
        if sentence_entries:
            mapping_paragraphs.append({
                "index": idx,
                "sentences": sentence_entries,
            })

    return {
        "lesson_id": lesson_id,
        "paragraphs": mapping_paragraphs,
    }
