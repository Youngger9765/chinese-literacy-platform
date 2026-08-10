from __future__ import annotations

import logging
import os
import urllib.error
import urllib.request
from typing import Optional

logger = logging.getLogger(__name__)

TTS_PROVIDER = os.environ.get("TTS_PROVIDER", "azure")


class TTSError(RuntimeError):
    """Raised when TTS synthesis fails on all providers."""


from .cache import (  # noqa: E402
    CACHE_MAX_ENTRIES,
    TTS_GCS_BUCKET,
    _GCS_UNAVAILABLE,
    _TTS_CACHE,
    _gcs_client,
    _gcs_get,
    _gcs_put,
    _get_gcs_bucket,
    _l1_put,
    delete_tts_cache,
    get_cached_tts,
)
from .lesson_mapping import (  # noqa: E402
    _SENTENCES_V2_CACHE,
    _SENTENCES_V2_PATH,
    _load_sentences_v2,
    build_lesson_tts_mapping,
    synthesize_sentence,
)
from .pauses import shorten_sentence_pauses
from .normalization import (  # noqa: E402
    MAX_SENTENCE_LEN,
    PHONEME_CORRECTIONS,
    _PHONEME_CORRECTIONS,
    _apply_phoneme_corrections,
    _cache_key,
    _clean_for_tts,
    _has_phoneme_corrections,
    _numbers_to_chinese_tw,
    _split_sentences,
)
from .providers.azure import (  # noqa: E402
    AZURE_SPEECH_KEY,
    AZURE_SPEECH_REGION,
    AZURE_TTS_VOICE,
    _synthesize_azure,
)
from .providers.gemini import (  # noqa: E402
    GCP_PROJECT,
    GEMINI_TTS_MODEL,
    GEMINI_TTS_PROMPT_PREFIX,
    GEMINI_TTS_VOICE,
    _pcm_to_mp3,
    _synthesize_gemini,
)
from .providers.google import (  # noqa: E402
    TTS_LANGUAGE_CODE,
    TTS_VOICE,
    _tts_client,
)


def _blob_path(key: str, provider: str = "google") -> str:
    if provider == "azure":
        return f"azure/sentences/{key}.mp3"
    if provider == "gemini31":
        return f"gemini31-prompt-only-v2/sentences/{key}.mp3"
    return f"tts-cache/{key}.mp3"


def _get_gcs_bucket():
    global _gcs_client
    if _gcs_client is _GCS_UNAVAILABLE:
        return None
    if _gcs_client is None:
        try:
            import google.cloud.storage as storage
            client = storage.Client()
            _gcs_client = client.bucket(TTS_GCS_BUCKET)
            logger.info("GCS TTS cache bucket: %s", TTS_GCS_BUCKET)
        except Exception as exc:
            logger.warning("GCS cache unavailable, falling back to API-only: %s", exc)
            _gcs_client = _GCS_UNAVAILABLE
            return None
    return _gcs_client


def _gcs_get(key: str, provider: str = "google") -> Optional[bytes]:
    bucket = _get_gcs_bucket()
    if bucket is None:
        return None
    blob_path = _blob_path(key, provider)
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
    bucket = _get_gcs_bucket()
    if bucket is None:
        return
    blob_path = _blob_path(key, provider)
    try:
        blob = bucket.blob(blob_path)
        blob.upload_from_string(audio_bytes, content_type="audio/mpeg")
        logger.debug("GCS cache write (provider=%s, key=%s, bytes=%d)", provider, key[:8], len(audio_bytes))
    except Exception as exc:
        logger.warning("GCS cache write error: %s", exc)


def _l1_put(key: str, audio_bytes: bytes) -> None:
    if len(_TTS_CACHE) >= CACHE_MAX_ENTRIES:
        oldest_key = next(iter(_TTS_CACHE))
        del _TTS_CACHE[oldest_key]
    _TTS_CACHE[key] = audio_bytes


def get_cached_tts(text: str) -> Optional[bytes]:
    key = _cache_key(text)
    return _TTS_CACHE.get(key)


def delete_tts_cache(text: str) -> dict:
    key = _cache_key(text)
    deleted_paths: list[str] = []

    l1_deleted = key in _TTS_CACHE
    if l1_deleted:
        del _TTS_CACHE[key]
        logger.info("L1 cache evicted (key=%s)", key[:8])

    bucket = _get_gcs_bucket()
    if bucket is not None:
        for provider in ("azure", "gemini31", "google"):
            blob_path = _blob_path(key, provider)
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
# NOTE: _synthesize_azure lives in providers/azure.py and is imported above.
# A second copy used to be defined here, which silently shadowed the import —
# every fix made to the provider file did nothing at runtime. Do not re-add it.


def _get_tts_client():
    global _tts_client
    if _tts_client is None:
        try:
            from google.cloud import texttospeech
            _tts_client = texttospeech.TextToSpeechClient()
            logger.info("Cloud TTS client initialised (voice=%s)", TTS_VOICE)
        except Exception as exc:
            raise TTSError(f"Failed to initialise Cloud TTS client: {exc}") from exc
    return _tts_client


def _synthesize_chunk(text: str) -> bytes:
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
                # #2082 A1: brisker pace ~260-270 字/分 (product-tunable; was 0.9)
                speaking_rate=1.05,
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
    sentences = _split_sentences(text)
    logger.info(
        "Google TTS API call (len=%d chars, %d chunks, voice=%s)",
        len(text), len(sentences), TTS_VOICE,
    )
    chunks: list[bytes] = []
    for sentence in sentences:
        chunks.append(_synthesize_chunk(sentence))
    return b"".join(chunks)


def synthesize_speech(text: str) -> bytes:
    key = _cache_key(text)

    if key in _TTS_CACHE:
        logger.debug("L1 cache hit (key=%s)", key[:8])
        return _TTS_CACHE[key]

    active_provider = TTS_PROVIDER

    gcs_data = _gcs_get(key, provider=active_provider)
    if gcs_data is not None:
        _l1_put(key, gcs_data)
        return gcs_data

    # No cross-prefix read-through (#2649 item 4).
    #
    # Azure misses used to fall back to the google prefix. The two prefixes hold
    # different voices — zh-TW-HsiaoChenNeural vs cmn-CN-Chirp3-HD, and the
    # mainland accent was rejected in 2026-04 — so that fallback made a brief
    # Azure outage permanent: the failure writes a mainland-accent object, every
    # later request finds it, and Azure recovering never undoes it. 22 sentences
    # reached production that way.
    #
    # A miss now costs one synthesis. That is the correct price for always
    # shipping the voice we chose.

    cleaned = _clean_for_tts(text)
    if not cleaned:
        raise TTSError("Text is empty after cleaning")

    audio_bytes: Optional[bytes] = None
    used_provider: str

    if active_provider == "gemini31":
        audio_bytes = _synthesize_gemini(cleaned)
        used_provider = "gemini31"
    elif active_provider == "azure":
        try:
            logger.info(
                "Azure TTS API call (len=%d chars, voice=%s)",
                len(cleaned), AZURE_TTS_VOICE,
            )
            audio_bytes = _synthesize_azure(cleaned)
            # Azure leaves ~885 ms of silence at every sentence end — a quarter
            # of a paragraph's runtime is dead air, and it is what makes a
            # whole-lesson reading drag. Shortened here, once, on the way into
            # the cache, so no listener ever waits for the re-encode.
            audio_bytes = shorten_sentence_pauses(audio_bytes)
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
        audio_bytes = _synthesize_google(cleaned)
        used_provider = "google"

    _l1_put(key, audio_bytes)
    _gcs_put(key, audio_bytes, provider=used_provider)

    logger.info(
        "TTS synthesis complete (provider=%s, key=%s, bytes=%d)",
        used_provider, key[:8], len(audio_bytes),
    )
    return audio_bytes


__all__ = [
    "synthesize_speech",
    "get_cached_tts",
    "delete_tts_cache",
    "synthesize_sentence",
    "build_lesson_tts_mapping",
    "TTSError",
]
