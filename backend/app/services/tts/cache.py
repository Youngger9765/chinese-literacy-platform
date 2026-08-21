from __future__ import annotations

import logging
import os
from typing import Optional

from .normalization import _cache_key

logger = logging.getLogger(__name__)

_TTS_CACHE: dict[str, bytes] = {}
CACHE_MAX_ENTRIES = 500

TTS_GCS_BUCKET = os.environ.get("TTS_GCS_BUCKET", "lingoleap-tts-cache")
# 設定的主要 provider。`_gcs_put` 用它判斷「這段音訊是不是 primary 產出的」——
# 不是的話就不寫共用快取（見該函式的說明）。
#
# ⚠️ 預設必須跟 `tts/__init__.py` 的 `TTS_PROVIDER` **同一個值**（"azure"）。
# 第一版我寫成空字串 —— 那讓「沒設 TTS_PROVIDER」的情況落回舊行為，
# 而那正是 2026-08-19 出事的情況（本機沒設，於是中國腔照樣寫進正式快取）。
# 一個防線如果剛好避開它要防的那個場景，等於沒有。
TTS_PRIMARY_PROVIDER = os.environ.get("TTS_PROVIDER", "azure").strip().lower()

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
    # ⛔ **fallback 產出的音訊不寫共用快取。**
    #
    # 2026-08-19：本機沒有 `AZURE_SPEECH_KEY`，而 `TTS_GCS_BUCKET` 預設就是正式那顆。
    # 於是每次朗讀都 Azure 失敗 → 退回 Google `cmn-CN-Chirp3-HD-Sulafat`（中國腔）
    # → 寫進 `gs://lingoleap-tts-cache/tts-cache/`。
    #
    # 讀取路徑在 azure prefix miss 時會回讀 `tts-cache/`，所以**一次短暫失敗就把
    # 那句永久釘在中國腔**，Azure 恢復也救不回（2026-04 盲聽已否決中國腔）。
    #
    # 這個預設值本身就是缺陷：任何人 clone 下來起本機都會做同樣的事，
    # 而且沒有任何警告 —— log 只安靜地寫一行 `GCS cache write`。
    # 記憶體快取不受影響，本機開發照樣順，只是寫不到會影響別人的地方。
    if TTS_PRIMARY_PROVIDER and provider != TTS_PRIMARY_PROVIDER:
        logger.warning(
            "跳過共用快取寫入：這段是 %s 產出的，但設定的 primary 是 %s。"
            "fallback 的音訊寫進去會被永久回讀。",
            provider, TTS_PRIMARY_PROVIDER,
        )
        return
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
