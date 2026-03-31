"""Tests for example_sentence_cache.py (Issue #730, #780).

Tests the JSON file-based caching layer for AI example sentences:
- Cache hit returns stored sentences without calling AI
- Cache miss falls through (returns None)
- TTL expiry causes miss
- Persists to disk after set
- Pre-generated entries never expire (Issue #780)
- bulk_set_pregenerated writes multiple entries atomically

Run with:
    cd backend && python -m pytest tests/test_example_sentence_cache.py -v
"""

import json
import os
import tempfile
from datetime import datetime, timezone, timedelta

import pytest

import app.services.example_sentence_cache as cache_module
from app.services.example_sentence_cache import (
    get_cached,
    set_cached,
    set_pregenerated,
    bulk_set_pregenerated,
    _reset,
    _is_expired,
    _make_key,
)


SAMPLE_RESULT = {
    "sentences": [
        {"sentence": "老師講述這個故事的來源。", "explanation": "來源：事物的起點或出處"},
        {"sentence": "這首歌的靈感來源於童年。", "explanation": "靈感的起點"},
    ]
}


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path):
    """Each test runs with a fresh temp cache file."""
    cache_file = str(tmp_path / "test_cache.json")
    _reset(path=cache_file)
    yield cache_file
    _reset()


# ---------------------------------------------------------------------------
# _is_expired
# ---------------------------------------------------------------------------

class TestIsExpired:
    def test_fresh_entry_not_expired(self):
        entry = {"sentences": [], "cached_at": datetime.now(timezone.utc).isoformat()}
        assert _is_expired(entry) is False

    def test_old_entry_expired(self):
        old_time = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        entry = {"sentences": [], "cached_at": old_time}
        assert _is_expired(entry) is True

    def test_missing_cached_at_is_expired(self):
        entry = {"sentences": []}
        assert _is_expired(entry) is True

    def test_just_under_30_days_not_expired(self):
        # 29 days: age < TTL, should not be expired
        just_under = (datetime.now(timezone.utc) - timedelta(days=29)).isoformat()
        entry = {"sentences": [], "cached_at": just_under}
        assert _is_expired(entry) is False

    def test_31_days_expired(self):
        old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        entry = {"sentences": [], "cached_at": old}
        assert _is_expired(entry) is True


# ---------------------------------------------------------------------------
# get_cached
# ---------------------------------------------------------------------------

class TestGetCached:
    def test_miss_on_empty_cache(self):
        result = get_cached("課文A", "水")
        assert result is None

    def test_hit_after_set(self):
        set_cached("課文A", "水", SAMPLE_RESULT)
        result = get_cached("課文A", "水")
        assert result is not None
        assert result["sentences"] == SAMPLE_RESULT["sentences"]

    def test_miss_different_character(self):
        set_cached("課文A", "水", SAMPLE_RESULT)
        result = get_cached("課文A", "火")
        assert result is None

    def test_miss_different_story(self):
        set_cached("課文A", "水", SAMPLE_RESULT)
        result = get_cached("課文B", "水")
        assert result is None

    def test_miss_empty_sentences_acts_as_placeholder(self, isolated_cache):
        """Entry with empty sentences list should be treated as a cache miss (placeholder)."""
        key = _make_key("課文A", "水")
        with open(isolated_cache, "w", encoding="utf-8") as f:
            json.dump(
                {
                    key: {
                        "sentences": [],
                        "source": "pregenerated",
                        "_placeholder": True,
                        "cached_at": "",
                    }
                },
                f,
            )
        _reset(path=isolated_cache)
        result = get_cached("課文A", "水")
        assert result is None  # placeholder treated as miss → AI fallback

    def test_miss_expired_entry(self, isolated_cache):
        # Manually write an expired entry to the cache file
        key = _make_key("課文A", "水")
        expired_entry = {
            key: {
                "sentences": SAMPLE_RESULT["sentences"],
                "cached_at": (datetime.now(timezone.utc) - timedelta(days=31)).isoformat(),
            }
        }
        with open(isolated_cache, "w", encoding="utf-8") as f:
            json.dump(expired_entry, f)
        # Reload cache from file
        _reset(path=isolated_cache)
        result = get_cached("課文A", "水")
        assert result is None


# ---------------------------------------------------------------------------
# set_cached
# ---------------------------------------------------------------------------

class TestSetCached:
    def test_persists_to_disk(self, isolated_cache):
        set_cached("課文A", "水", SAMPLE_RESULT)
        with open(isolated_cache, "r", encoding="utf-8") as f:
            on_disk = json.load(f)
        key = _make_key("課文A", "水")
        assert key in on_disk
        assert on_disk[key]["sentences"] == SAMPLE_RESULT["sentences"]
        assert "cached_at" in on_disk[key]

    def test_overwrite_existing_entry(self):
        set_cached("課文A", "水", SAMPLE_RESULT)
        new_result = {
            "sentences": [{"sentence": "新例句。", "explanation": "新說明"}]
        }
        set_cached("課文A", "水", new_result)
        result = get_cached("課文A", "水")
        assert result["sentences"] == new_result["sentences"]

    def test_multiple_entries_coexist(self):
        result_b = {"sentences": [{"sentence": "火焰燃燒。", "explanation": "火：火焰"}]}
        set_cached("課文A", "水", SAMPLE_RESULT)
        set_cached("課文A", "火", result_b)
        assert get_cached("課文A", "水")["sentences"] == SAMPLE_RESULT["sentences"]
        assert get_cached("課文A", "火")["sentences"] == result_b["sentences"]

    def test_cached_at_is_recent(self):
        set_cached("課文A", "水", SAMPLE_RESULT)
        key = _make_key("課文A", "水")
        entry = cache_module._cache[key]
        cached_at = datetime.fromisoformat(entry["cached_at"])
        if cached_at.tzinfo is None:
            cached_at = cached_at.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - cached_at
        assert age.total_seconds() < 5


# ---------------------------------------------------------------------------
# Cache file resilience
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Pre-generated entries (Issue #780)
# ---------------------------------------------------------------------------

PREGENERATED_SENTENCES = [
    {"sentence": "他勇敢地挑戰新事物。", "explanation": "勇：有勇氣、無所畏懼"},
    {"sentence": "這位選手展現了勇氣。", "explanation": "勇：勇敢的精神"},
]


class TestPregenerated:
    def test_pregenerated_entry_never_expires(self, isolated_cache):
        """Pre-generated entries with source=pregenerated are served regardless of age."""
        key = _make_key("課文X", "勇")
        very_old = (datetime.now(timezone.utc) - timedelta(days=3650)).isoformat()
        with open(isolated_cache, "w", encoding="utf-8") as f:
            json.dump(
                {
                    key: {
                        "sentences": PREGENERATED_SENTENCES,
                        "source": "pregenerated",
                        "cached_at": very_old,
                    }
                },
                f,
            )
        _reset(path=isolated_cache)
        result = get_cached("課文X", "勇")
        assert result is not None
        assert result["sentences"] == PREGENERATED_SENTENCES

    def test_is_expired_returns_false_for_pregenerated(self):
        """_is_expired should return False for any entry with source=pregenerated."""
        very_old = (datetime.now(timezone.utc) - timedelta(days=9999)).isoformat()
        entry = {
            "sentences": PREGENERATED_SENTENCES,
            "source": "pregenerated",
            "cached_at": very_old,
        }
        assert _is_expired(entry) is False

    def test_set_pregenerated_stores_with_source_flag(self, isolated_cache):
        set_pregenerated("課文X", "勇", PREGENERATED_SENTENCES)
        key = _make_key("課文X", "勇")
        assert cache_module._cache[key]["source"] == "pregenerated"
        assert cache_module._cache[key]["sentences"] == PREGENERATED_SENTENCES

    def test_set_pregenerated_does_not_overwrite_existing(self, isolated_cache):
        """Calling set_pregenerated twice should not replace non-empty existing data."""
        original = [{"sentence": "原始句。", "explanation": "原始"}]
        new_data = [{"sentence": "新句子。", "explanation": "新的"}]
        set_pregenerated("課文X", "勇", original)
        set_pregenerated("課文X", "勇", new_data)
        result = get_cached("課文X", "勇")
        assert result["sentences"] == original

    def test_set_pregenerated_overwrites_placeholder(self, isolated_cache):
        """Empty placeholder entries (sentences=[]) should be overwritten."""
        # Write a placeholder entry
        key = _make_key("課文X", "勇")
        with open(isolated_cache, "w", encoding="utf-8") as f:
            json.dump(
                {key: {"sentences": [], "source": "pregenerated", "_placeholder": True, "cached_at": ""}},
                f,
            )
        _reset(path=isolated_cache)
        set_pregenerated("課文X", "勇", PREGENERATED_SENTENCES)
        result = get_cached("課文X", "勇")
        assert result["sentences"] == PREGENERATED_SENTENCES

    def test_bulk_set_pregenerated_writes_multiple(self, isolated_cache):
        entries = {
            "課文A:水": [{"sentence": "水流湍急。", "explanation": "水：液體"}],
            "課文A:火": [{"sentence": "火焰熊熊燃燒。", "explanation": "火：燃燒的火焰"}],
        }
        count = bulk_set_pregenerated(entries)
        assert count == 2
        assert get_cached("課文A", "水")["sentences"] == entries["課文A:水"]
        assert get_cached("課文A", "火")["sentences"] == entries["課文A:火"]

    def test_bulk_set_pregenerated_skips_existing(self, isolated_cache):
        """Existing pre-generated entries with sentences should not be overwritten."""
        original = [{"sentence": "原始水句。", "explanation": "原始"}]
        set_pregenerated("課文A", "水", original)
        entries = {
            "課文A:水": [{"sentence": "新水句。", "explanation": "新"}],
        }
        count = bulk_set_pregenerated(entries)
        assert count == 0  # nothing written
        assert get_cached("課文A", "水")["sentences"] == original

    def test_bulk_set_pregenerated_persists_to_disk(self, isolated_cache):
        entries = {
            "課文A:水": [{"sentence": "水句。", "explanation": "水"}],
        }
        bulk_set_pregenerated(entries)
        with open(isolated_cache, encoding="utf-8") as f:
            on_disk = json.load(f)
        assert "課文A:水" in on_disk
        assert on_disk["課文A:水"]["source"] == "pregenerated"

    def test_normal_cache_entry_still_expires(self):
        """Non-pregenerated entries should still be subject to TTL."""
        very_old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        entry = {"sentences": PREGENERATED_SENTENCES, "cached_at": very_old}
        assert _is_expired(entry) is True


class TestCacheResilience:
    def test_corrupt_json_starts_empty(self, isolated_cache):
        with open(isolated_cache, "w") as f:
            f.write("{invalid json")
        _reset(path=isolated_cache)
        result = get_cached("課文A", "水")
        assert result is None

    def test_missing_file_starts_empty(self):
        result = get_cached("課文A", "水")
        assert result is None

    def test_creates_file_on_first_write(self, isolated_cache):
        # File doesn't exist yet
        if os.path.exists(isolated_cache):
            os.remove(isolated_cache)
        _reset(path=isolated_cache)
        set_cached("課文A", "水", SAMPLE_RESULT)
        assert os.path.exists(isolated_cache)
