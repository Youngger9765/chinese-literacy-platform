from __future__ import annotations

import logging
import os
from typing import Optional

from .normalization import _cache_key

logger = logging.getLogger(__name__)

_TTS_CACHE: dict[str, bytes] = {}
CACHE_MAX_ENTRIES = 500

TTS_GCS_BUCKET = os.environ.get("TTS_GCS_BUCKET", "lingoleap-tts-cache")

_GCS_UNAVAILABLE = object()
_gcs_client: object = None

_PROVIDERS = ("azure", "gemini31", "google")


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


def _l1_key(key: str, provider: str) -> str:
    """Namespace an L1 entry by the provider that produced it (#2649 item 1).

    Without this, L1 is provider-blind: a momentary Azure failure falls back
    to Google, writes the mainland-accent bytes under the bare text key, and
    every later request — even long after Azure recovers, and without ever
    touching the provider chain again — reads them straight back out. GCS
    already avoids exactly this with a provider-specific blob path
    (_blob_path); this gives the in-process cache the same property, so an
    azure-active lookup can never be satisfied by a google-produced entry.
    """
    return f"{provider} {key}"


def _l1_put(key: str, audio_bytes: bytes, provider: str) -> None:
    l1_key = _l1_key(key, provider)
    if l1_key not in _TTS_CACHE and len(_TTS_CACHE) >= CACHE_MAX_ENTRIES:
        oldest_key = next(iter(_TTS_CACHE))
        del _TTS_CACHE[oldest_key]
    _TTS_CACHE[l1_key] = audio_bytes


def get_cached_tts(text: str, provider: str) -> Optional[bytes]:
    """L1 lookup scoped to *provider* — see _l1_key.

    Callers must pass the provider they intend to serve (normally the
    module's active TTS_PROVIDER); there is no provider-blind overload,
    because a provider-blind read is exactly the bug this exists to close.
    """
    key = _cache_key(text)
    return _TTS_CACHE.get(_l1_key(key, provider))


def delete_tts_cache(text: str) -> dict:
    key = _cache_key(text)
    deleted_paths: list[str] = []

    l1_deleted = False
    for provider in _PROVIDERS:
        l1_key = _l1_key(key, provider)
        if l1_key in _TTS_CACHE:
            del _TTS_CACHE[l1_key]
            l1_deleted = True
            logger.info("L1 cache evicted (key=%s, provider=%s)", key[:8], provider)

    bucket = _get_gcs_bucket()
    if bucket is not None:
        for provider in _PROVIDERS:
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
