"""
Spec: example-sentence-cache — TTL and pre-generated cache contracts.

Canonical source: backend/app/services/example_sentence_cache.py
Related issue: #780
Module spec: specs/modules/example-sentence-cache/INTENT.md

These tests are pure-function, no DB, no AI.
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Make app importable regardless of invocation cwd
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.services.example_sentence_cache import CACHE_TTL_DAYS, _is_expired


# ---------------------------------------------------------------------------
# I-1: Cache TTL constant is 30 days
# ---------------------------------------------------------------------------

class TestCacheTtlConstant:
    def test_cache_ttl_days(self):
        assert CACHE_TTL_DAYS == 30


# ---------------------------------------------------------------------------
# I-2: Runtime-generated entries expire after TTL
# ---------------------------------------------------------------------------

class TestRuntimeEntryExpiry:
    def test_entry_older_than_ttl_is_expired(self):
        entry = {
            "cached_at": (
                datetime.now(timezone.utc) - timedelta(days=CACHE_TTL_DAYS, seconds=1)
            ).isoformat(),
        }
        assert _is_expired(entry) is True

    def test_fresh_entry_is_not_expired(self):
        entry = {"cached_at": datetime.now(timezone.utc).isoformat()}
        assert _is_expired(entry) is False

    def test_missing_cached_at_is_expired(self):
        assert _is_expired({}) is True

    def test_invalid_cached_at_is_expired(self):
        assert _is_expired({"cached_at": "not-a-date"}) is True


# ---------------------------------------------------------------------------
# I-3: Pre-generated entries are curated content and never expire
# ---------------------------------------------------------------------------

class TestPregeneratedEntryExpiry:
    def test_pregenerated_entry_never_expires_regardless_of_age(self):
        entry = {
            "source": "pregenerated",
            "cached_at": "2000-01-01T00:00:00+00:00",
        }
        assert _is_expired(entry) is False
