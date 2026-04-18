"""
TTS service — three providers: Azure Speech, Google Cloud TTS, Gemini 3.1 Flash TTS.

Two-layer cache: GCS (persistent) → in-memory (fast).
1. Check in-memory dict
2. Check GCS bucket  (azure/sentences/{hash}.mp3, gemini31/sentences/{hash}.mp3,
   or tts-cache/{hash}.mp3)
3. Call active provider API → save to GCS + in-memory
4. If Azure fails → fall back to Google Cloud TTS

Provider selection:
  TTS_PROVIDER env var (default: "azure")
    "azure"    — Azure Speech primary, Google fallback
    "google"   — Google Cloud TTS only
    "gemini31" — Gemini 3.1 Flash TTS (no sentence splitting needed)

Azure voice: zh-TW-HsiaoChenNeural (Taiwan accent, female)
Google voice: cmn-CN-Chirp3-HD-Sulafat (fallback)
Gemini voice: Aoede (prebuilt voice, PCM→MP3 via ffmpeg subprocess)

GCS paths:
  Azure    — azure/sentences/{hash}.mp3    (sentence-level, Issue #667)
  Gemini31 — gemini31/sentences/{hash}.mp3 (new, Issue #1107)
  Google   — tts-cache/{hash}.mp3          (legacy path, unchanged for compatibility)

Auth:
  Azure    — Ocp-Apim-Subscription-Key header (AZURE_SPEECH_KEY env var)
  Google   — service-account ADC already available on Cloud Run, no API key needed
  Gemini31 — Vertex AI ADC (google-genai SDK, vertexai=True, us-central1)
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import subprocess
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
      Azure    — azure/sentences/{key}.mp3    (sentence-level, Issue #667)
      Gemini31 — gemini31/sentences/{key}.mp3 (Issue #1107)
      Google   — tts-cache/{key}.mp3          (legacy path, unchanged for compatibility)
    """
    bucket = _get_gcs_bucket()
    if bucket is None:
        return None
    if provider == "azure":
        blob_path = f"azure/sentences/{key}.mp3"
    elif provider == "gemini31":
        blob_path = f"gemini31/sentences/{key}.mp3"
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
      Azure    — azure/sentences/{key}.mp3    (sentence-level, Issue #667)
      Gemini31 — gemini31/sentences/{key}.mp3 (Issue #1107)
      Google   — tts-cache/{key}.mp3          (legacy path, unchanged for compatibility)
    """
    bucket = _get_gcs_bucket()
    if bucket is None:
        return
    if provider == "azure":
        blob_path = f"azure/sentences/{key}.mp3"
    elif provider == "gemini31":
        blob_path = f"gemini31/sentences/{key}.mp3"
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
# Active provider: "azure" | "google" | "gemini31"  (default: "azure")
TTS_PROVIDER = os.environ.get("TTS_PROVIDER", "azure")

# Azure Speech Service (台灣腔，primary if key is set)
AZURE_SPEECH_KEY = os.environ.get("AZURE_SPEECH_KEY", "")
AZURE_SPEECH_REGION = os.environ.get("AZURE_SPEECH_REGION", "eastus")
AZURE_TTS_VOICE = os.environ.get("AZURE_TTS_VOICE", "zh-TW-HsiaoChenNeural")

# Google Cloud TTS (fallback)
TTS_VOICE = os.environ.get("TTS_VOICE", "cmn-CN-Chirp3-HD-Sulafat")
TTS_LANGUAGE_CODE = "cmn-CN"

# Gemini 3.1 Flash TTS (Issue #1107)
GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview"
GEMINI_TTS_VOICE = "Aoede"
GCP_PROJECT = os.environ.get("GCP_PROJECT", "lingoleap-dev")

# Singleton Gemini client (lazy init to avoid import error if SDK not installed)
_gemini_client = None


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------

class TTSError(RuntimeError):
    """Raised when TTS synthesis fails on all providers."""


# ---------------------------------------------------------------------------
# Phoneme correction — Issue #765
# ---------------------------------------------------------------------------
# Azure SSML phoneme tag format (zh-TW Zhuyin):
#   <phoneme alphabet="x-microsoft-zhuyin" ph="ㄏㄜˋ">喝</phoneme>
#
# Each entry is (pattern, replacement_ssml).
# Patterns are matched in order; first match wins for each occurrence.
# The replacement is raw SSML (already XML-safe) that replaces the matched text.

_PHONEME_CORRECTIONS: list[tuple[str, str]] = [
    # 喝采 / 喝彩 — 喝 should be hè (ㄏㄜˋ), not hē (ㄏㄜ)
    (
        "喝采",
        '<phoneme alphabet="x-microsoft-zhuyin" ph="ㄏㄜˋ">喝</phoneme>采',
    ),
    (
        "喝彩",
        '<phoneme alphabet="x-microsoft-zhuyin" ph="ㄏㄜˋ">喝</phoneme>彩',
    ),
    # 打得漂亮 / 打的漂亮 — 的/得 should be neutral tone "de", not dì/dí
    # Cover both orthographies since the source text may use either
    (
        "打的漂亮",
        '打<phoneme alphabet="x-microsoft-zhuyin" ph="˙ㄉㄜ">的</phoneme>漂亮',
    ),
    (
        "打得漂亮",
        '打<phoneme alphabet="x-microsoft-zhuyin" ph="˙ㄉㄜ">得</phoneme>漂亮',
    ),
]


def _apply_phoneme_corrections(text_escaped: str) -> str:
    """Apply known phoneme corrections to XML-escaped SSML content.

    Scans *text_escaped* (already XML-escaped plain text) for known
    mispronunciation patterns and wraps them with Azure SSML <phoneme> tags.

    The replacements are inserted as raw SSML markup so they must NOT be
    re-escaped after this step.

    Args:
        text_escaped: XML-escaped text (& → &amp; etc. already applied).

    Returns:
        SSML fragment with phoneme corrections applied.
    """
    result = text_escaped
    for pattern, replacement in _PHONEME_CORRECTIONS:
        if pattern in result:
            result = result.replace(pattern, replacement)
            logger.debug("Phoneme correction applied: %r → %r", pattern, replacement)
    return result


def _has_phoneme_corrections(text: str) -> bool:
    """Return True if *text* contains any known mispronunciation patterns."""
    return any(pattern in text for pattern, _ in _PHONEME_CORRECTIONS)


# ---------------------------------------------------------------------------
# Azure Speech — REST API synthesis
# ---------------------------------------------------------------------------

def _synthesize_azure(text: str) -> bytes:
    """Synthesise text via Azure Speech Service REST API.

    Voice: zh-TW-HsiaoChenNeural (Taiwan accent, female)
    Output: audio-48khz-192kbitrate-mono-mp3
    Rate: 0.95 (slightly slower than natural for reading practice)

    When *text* contains known mispronunciation patterns (see
    _PHONEME_CORRECTIONS), the SSML body is enriched with <phoneme> tags
    so Azure reads the characters with the correct tones.

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

    # Apply phoneme corrections (inserts raw SSML tags — must come after escaping)
    ssml_body = _apply_phoneme_corrections(text_escaped)

    ssml = (
        '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-TW">'
        f'<voice name="{AZURE_TTS_VOICE}">'
        f'<prosody rate="0.95">{ssml_body}</prosody>'
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
# Gemini 3.1 Flash TTS — Issue #1107
# ---------------------------------------------------------------------------

def _pcm_to_mp3(pcm_data: bytes, sample_rate: int = 24000) -> bytes:
    """Convert raw L16 PCM bytes to MP3 using ffmpeg subprocess.

    Requires ffmpeg installed in the Docker image (Dockerfile: apt-get install ffmpeg).

    Args:
        pcm_data: Raw signed 16-bit little-endian PCM samples.
        sample_rate: Sample rate in Hz (Gemini outputs 24000 Hz mono).

    Returns:
        MP3 bytes.

    Raises:
        TTSError: if ffmpeg fails or is not installed.
    """
    result = subprocess.run(
        [
            "ffmpeg",
            "-f", "s16le",
            "-ar", str(sample_rate),
            "-ac", "1",
            "-i", "pipe:0",
            "-f", "mp3",
            "-q:a", "2",
            "pipe:1",
        ],
        input=pcm_data,
        capture_output=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise TTSError(f"ffmpeg PCM→MP3 failed: {result.stderr.decode('utf-8', errors='replace')}")
    if not result.stdout:
        raise TTSError("ffmpeg produced empty MP3 output")
    return result.stdout


def _synthesize_gemini(text: str) -> bytes:
    """Synthesise text via Gemini 3.1 Flash TTS (Vertex AI).

    Uses the google-genai SDK in Vertex AI mode. The API returns raw L16 PCM
    at 24 kHz mono, which is converted to MP3 via ffmpeg subprocess.

    No sentence splitting is needed — Gemini TTS has no strict length limit.

    Voice: Aoede (prebuilt English/Mandarin voice)
    Model: gemini-3.1-flash-tts-preview
    Location: us-central1

    Args:
        text: Plain text to synthesise (already cleaned by _clean_for_tts).

    Returns:
        MP3 bytes.

    Raises:
        TTSError: if the API call fails, returns empty audio, or ffmpeg conversion fails.
    """
    try:
        import google.genai as genai
        from google.genai import types as genai_types
    except ImportError as exc:
        raise TTSError(f"google-genai SDK not installed: {exc}") from exc

    global _gemini_client
    try:
        if _gemini_client is None:
            _gemini_client = genai.Client(
                vertexai=True,
                project=GCP_PROJECT,
                location="us-central1",
            )
        logger.info(
            "Gemini TTS API call (model=%s, voice=%s, len=%d chars)",
            GEMINI_TTS_MODEL, GEMINI_TTS_VOICE, len(text),
        )
        response = _gemini_client.models.generate_content(
            model=GEMINI_TTS_MODEL,
            contents=text,
            config=genai_types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=genai_types.SpeechConfig(
                    voice_config=genai_types.VoiceConfig(
                        prebuilt_voice_config=genai_types.PrebuiltVoiceConfig(
                            voice_name=GEMINI_TTS_VOICE,
                        ),
                    ),
                ),
            ),
        )
    except Exception as exc:
        raise TTSError(f"Gemini TTS API error: {exc}") from exc

    # Extract raw PCM from the response
    try:
        pcm_data = response.candidates[0].content.parts[0].inline_data.data
    except (AttributeError, IndexError, TypeError) as exc:
        raise TTSError(f"Gemini TTS unexpected response structure: {exc}") from exc

    if not pcm_data:
        raise TTSError("Gemini TTS returned empty audio content")

    return _pcm_to_mp3(pcm_data)


# ---------------------------------------------------------------------------
# Public synthesis function
# ---------------------------------------------------------------------------

def synthesize_speech(text: str) -> bytes:
    """Synthesise *text* to MP3 audio bytes.

    Provider selection via TTS_PROVIDER env var (default: "azure"):
      "azure"    — Azure Speech primary, Google Cloud TTS fallback
      "google"   — Google Cloud TTS only (with sentence splitting)
      "gemini31" — Gemini 3.1 Flash TTS (no sentence splitting, Vertex AI)

    Two-layer cache: in-memory (L1) → GCS (L2) → API call.
    GCS paths:
      azure    — azure/sentences/{hash}.mp3
      gemini31 — gemini31/sentences/{hash}.mp3
      google   — tts-cache/{hash}.mp3 (legacy)

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

    active_provider = TTS_PROVIDER  # "azure" | "google" | "gemini31"

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

    if active_provider == "gemini31":
        try:
            audio_bytes = _synthesize_gemini(cleaned)
            used_provider = "gemini31"
        except TTSError as gemini_exc:
            logger.warning("Gemini TTS failed, falling back to Azure→Google: %s", gemini_exc)
            try:
                audio_bytes = _synthesize_azure(cleaned)
                used_provider = "azure"
            except TTSError as azure_exc:
                logger.warning("Azure TTS also failed: %s", azure_exc)
                try:
                    audio_bytes = _synthesize_google(cleaned)
                    used_provider = "google"
                except TTSError as google_exc:
                    raise TTSError(
                        f"All TTS providers failed — Gemini ({gemini_exc}), "
                        f"Azure ({azure_exc}), Google ({google_exc})"
                    ) from google_exc
    elif active_provider == "azure":
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


def delete_tts_cache(text: str) -> dict:
    """Delete cached audio for *text* from L1 and GCS (both azure and google paths).

    Used by the /api/tts/regenerate admin endpoint to force re-synthesis
    after phoneme corrections are added.

    Args:
        text: The exact text whose cache should be invalidated.

    Returns:
        Dict with keys "key", "l1_deleted" (bool), "gcs_deleted" (list of paths deleted).
    """
    key = _cache_key(text)
    deleted_paths: list[str] = []

    # L1 eviction
    l1_deleted = key in _TTS_CACHE
    if l1_deleted:
        del _TTS_CACHE[key]
        logger.info("L1 cache evicted (key=%s)", key[:8])

    # GCS deletion — try all provider paths
    bucket = _get_gcs_bucket()
    if bucket is not None:
        for provider in ("azure", "gemini31", "google"):
            if provider == "azure":
                blob_path = f"azure/sentences/{key}.mp3"
            elif provider == "gemini31":
                blob_path = f"gemini31/sentences/{key}.mp3"
            else:
                blob_path = f"tts-cache/{key}.mp3"
            try:
                blob = bucket.blob(blob_path)
                if blob.exists():
                    blob.delete()
                    deleted_paths.append(blob_path)
                    logger.info("GCS cache deleted: %s", blob_path)
            except Exception as exc:
                logger.warning("GCS cache delete error (%s): %s", blob_path, exc)

    return {
        "key": key,
        "l1_deleted": l1_deleted,
        "gcs_deleted": deleted_paths,
    }


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
