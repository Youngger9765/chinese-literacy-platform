"""Example sentence cache service — JSON file-based.

Caches AI-generated example sentences in a local JSON file to avoid
repeated Gemini API calls for the same vocabulary word (Issue #730, #780, #927).

Cache strategy:
- Key: "{story_title}:{word}" (includes story context for accuracy)
- Storage: backend/data/example_sentence_cache.json
- TTL: 30 days for runtime-generated entries (checked at read time)
- Pre-generated entries (source="pregenerated") never expire
- Thread-safe: file writes use a lock
"""

import json
import logging
import os
import threading
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

CACHE_TTL_DAYS = 30

# Resolve cache file path relative to this module's location
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR = os.path.join(_THIS_DIR, "..", "..", "data")
DEFAULT_CACHE_PATH = os.path.join(_DATA_DIR, "example_sentence_cache.json")

_lock = threading.Lock()

# In-memory cache loaded once at module import
_cache: dict = {}
_cache_path: str = DEFAULT_CACHE_PATH
_loaded: bool = False


def _load(path: Optional[str] = None) -> None:
    """Load cache from JSON file into memory. Safe to call multiple times."""
    global _cache, _cache_path, _loaded
    if path:
        _cache_path = path
    if os.path.exists(_cache_path):
        try:
            with open(_cache_path, "r", encoding="utf-8") as f:
                _cache = json.load(f)
            logger.info(
                "Loaded example sentence cache: %d entries from %s",
                len(_cache),
                _cache_path,
            )
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Failed to load example sentence cache: %s — starting empty", exc)
            _cache = {}
    else:
        _cache = {}
    _loaded = True


def _ensure_loaded() -> None:
    if not _loaded:
        _load()


def _save() -> None:
    """Persist in-memory cache to disk. Must be called under _lock."""
    try:
        os.makedirs(os.path.dirname(_cache_path), exist_ok=True)
        with open(_cache_path, "w", encoding="utf-8") as f:
            json.dump(_cache, f, ensure_ascii=False, indent=2)
    except OSError as exc:
        logger.warning("Failed to save example sentence cache: %s", exc)


def _is_expired(entry: dict) -> bool:
    """Return True if cache entry is older than CACHE_TTL_DAYS.

    Pre-generated entries (source="pregenerated") never expire — they are
    curated content produced by scripts/pre-generate-example-sentences.py
    and should always be served (Issue #780).
    """
    if entry.get("source") == "pregenerated":
        return False
    cached_at_str = entry.get("cached_at")
    if not cached_at_str:
        return True
    try:
        cached_at = datetime.fromisoformat(cached_at_str)
        if cached_at.tzinfo is None:
            cached_at = cached_at.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - cached_at
        return age > timedelta(days=CACHE_TTL_DAYS)
    except (ValueError, TypeError):
        return True


def _make_key(story_title: str, word: str) -> str:
    return f"{story_title}:{word}"


def get_cached(story_title: str, word: str) -> Optional[dict]:
    """Return cached sentences if present, not expired, and non-empty, else None.

    An entry with an empty sentences list (e.g. a placeholder written by
    scripts/pre-generate-example-sentences.py --mode placeholder) is treated
    as a cache miss so the live AI fallback is used until real sentences are
    populated (Issue #780).

    Returns:
        {"sentences": [{"sentence": str, "explanation": str}, ...]} or None
    """
    _ensure_loaded()
    key = _make_key(story_title, word)
    entry = _cache.get(key)
    if entry is None:
        return None
    if _is_expired(entry):
        logger.debug("Cache expired for key: %s", key)
        return None
    sentences = entry.get("sentences") or []
    if not sentences:
        logger.debug("Cache entry has no sentences (placeholder?), treating as miss: %s", key)
        return None
    logger.debug("Cache hit for key: %s", key)
    return {"sentences": sentences}


def set_cached(story_title: str, word: str, result: dict) -> None:
    """Store AI result in cache and persist to disk.

    Args:
        story_title: Lesson title.
        word: Chinese vocabulary word.
        result: {"sentences": [{"sentence": str, "explanation": str}, ...]}
    """
    _ensure_loaded()
    key = _make_key(story_title, word)
    entry = {
        "sentences": result.get("sentences", []),
        "cached_at": datetime.now(timezone.utc).isoformat(),
    }
    with _lock:
        _cache[key] = entry
        _save()
    logger.info("Cached example sentences for key: %s", key)


def set_pregenerated(story_title: str, word: str, sentences: list) -> None:
    """Store a pre-generated sentence list that never expires (Issue #780).

    Used by scripts/pre-generate-example-sentences.py to bulk-load curated
    sentences into the cache.  Pre-generated entries are served indefinitely
    without further AI calls.

    Args:
        story_title: Lesson title (must match story lookup key exactly).
        word: Chinese vocabulary word.
        sentences: list of {"sentence": str, "explanation": str} dicts.
    """
    _ensure_loaded()
    key = _make_key(story_title, word)
    # Skip if pre-generated entry already exists — don't overwrite curated data
    existing = _cache.get(key, {})
    if existing.get("source") == "pregenerated" and existing.get("sentences"):
        logger.debug("Pre-generated entry already exists, skipping: %s", key)
        return
    entry = {
        "sentences": sentences,
        "source": "pregenerated",
        "cached_at": datetime.now(timezone.utc).isoformat(),
    }
    with _lock:
        _cache[key] = entry
        _save()
    logger.info("Stored pre-generated example sentences for key: %s", key)


def bulk_set_pregenerated(entries: dict) -> int:
    """Bulk-load pre-generated sentences from a dict mapping cache_key -> sentences.

    Args:
        entries: {"{story_title}:{character}": [{"sentence": str, "explanation": str}]}

    Returns:
        Number of new entries written (skips already-present pre-generated keys).
    """
    _ensure_loaded()
    written = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    with _lock:
        for key, sentences in entries.items():
            existing = _cache.get(key, {})
            if existing.get("source") == "pregenerated" and existing.get("sentences"):
                continue
            _cache[key] = {
                "sentences": sentences,
                "source": "pregenerated",
                "cached_at": now_iso,
            }
            written += 1
        if written:
            _save()
    logger.info("bulk_set_pregenerated: wrote %d new entries", written)
    return written


# Expose for testing
def _reset(path: Optional[str] = None) -> None:
    """Reset in-memory state. Test use only."""
    global _cache, _cache_path, _loaded
    _cache = {}
    _loaded = False
    if path:
        _cache_path = path
    else:
        _cache_path = DEFAULT_CACHE_PATH
