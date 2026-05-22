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
