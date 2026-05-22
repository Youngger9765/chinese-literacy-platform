"""
Characterization tests for backend/app/services/tts/cache.py (refactor #1833).

Verifies:
  - L1 in-memory cache eviction at CACHE_MAX_ENTRIES
  - _blob_path returns correct GCS path per provider
  - GCS unavailability sentinel (no retry after first failure)
  - get_cached_tts and _l1_put behavior

Run: cd backend && python -m pytest tests/test_characterization_tts_cache.py -v
"""

import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# _blob_path
# ---------------------------------------------------------------------------

class TestBlobPath:
    """_blob_path must return the correct GCS path prefix per provider."""

    def test_google_default_path(self):
        from app.services.tts.cache import _blob_path
        path = _blob_path("abc123", provider="google")
        assert path.startswith("tts-cache/")
        assert path.endswith(".mp3")

    def test_azure_path_prefix(self):
        from app.services.tts.cache import _blob_path
        path = _blob_path("abc123", provider="azure")
        assert path.startswith("azure/")

    def test_gemini31_path_prefix(self):
        from app.services.tts.cache import _blob_path
        path = _blob_path("abc123", provider="gemini31")
        assert path.startswith("gemini31-")

    def test_key_is_in_path(self):
        from app.services.tts.cache import _blob_path
        key = "deadbeef1234"
        path = _blob_path(key, provider="google")
        assert key in path

    def test_tautology_break_provider_must_differentiate_paths(self):
        """MUST fail if all providers return the same path prefix."""
        from app.services.tts.cache import _blob_path
        google_path = _blob_path("key", provider="google")
        azure_path = _blob_path("key", provider="azure")
        assert google_path != azure_path


# ---------------------------------------------------------------------------
# L1 cache (_l1_put + get_cached_tts)
# ---------------------------------------------------------------------------

class TestL1Cache:
    """L1 in-memory cache must store and retrieve audio bytes by text."""

    def setup_method(self):
        """Clear L1 cache before each test to avoid cross-test pollution."""
        import app.services.tts.cache as cache_mod
        cache_mod._TTS_CACHE.clear()

    def test_l1_put_stores_by_key(self):
        import app.services.tts.cache as cache_mod
        from app.services.tts.cache import _l1_put, get_cached_tts
        from app.services.tts.normalization import _cache_key

        text = "測試L1快取"
        key = _cache_key(text)
        _l1_put(key, b"AUDIO_DATA")

        result = get_cached_tts(text)
        assert result == b"AUDIO_DATA"

    def test_cache_miss_returns_none(self):
        from app.services.tts.cache import get_cached_tts
        result = get_cached_tts("這段文字沒有在快取")
        assert result is None

    def test_l1_evicts_oldest_when_at_max(self):
        """When L1 reaches CACHE_MAX_ENTRIES, adding one more evicts the oldest."""
        import app.services.tts.cache as cache_mod
        from app.services.tts.cache import _l1_put, get_cached_tts, CACHE_MAX_ENTRIES
        from app.services.tts.normalization import _cache_key

        # Fill cache exactly to max
        first_key = _cache_key("第一個進來的")
        _l1_put(first_key, b"FIRST")

        # Fill up remaining slots
        for i in range(CACHE_MAX_ENTRIES - 1):
            _l1_put(_cache_key(f"fill_{i}"), b"FILLER")

        # Cache should be at max
        assert len(cache_mod._TTS_CACHE) == CACHE_MAX_ENTRIES

        # Add one more — oldest (first_key) should be evicted
        _l1_put(_cache_key("最新進來的"), b"NEW")

        assert len(cache_mod._TTS_CACHE) == CACHE_MAX_ENTRIES
        assert first_key not in cache_mod._TTS_CACHE

    def test_tautology_break_cache_must_not_return_wrong_audio(self):
        """MUST fail if L1 cache returns audio for wrong key."""
        import app.services.tts.cache as cache_mod
        from app.services.tts.cache import _l1_put, get_cached_tts
        from app.services.tts.normalization import _cache_key

        _l1_put(_cache_key("text A"), b"AUDIO_A")
        result = get_cached_tts("text B")
        assert result != b"AUDIO_A"


# ---------------------------------------------------------------------------
# GCS sentinel behavior
# ---------------------------------------------------------------------------

class TestGCSSentinel:
    """_get_gcs_bucket must return None immediately after first connection failure."""

    def test_sentinel_set_after_connection_failure(self):
        import app.services.tts.cache as cache_mod

        original = cache_mod._gcs_client
        cache_mod._gcs_client = None  # force re-init attempt

        try:
            with patch.dict("sys.modules", {"google.cloud.storage": MagicMock(
                Client=MagicMock(side_effect=Exception("no credentials"))
            )}):
                result = cache_mod._get_gcs_bucket()
                assert result is None
                assert cache_mod._gcs_client is cache_mod._GCS_UNAVAILABLE
        finally:
            cache_mod._gcs_client = original

    def test_sentinel_prevents_retry(self):
        """After sentinel is set, _get_gcs_bucket must not attempt to connect again."""
        import app.services.tts.cache as cache_mod

        original = cache_mod._gcs_client
        cache_mod._gcs_client = cache_mod._GCS_UNAVAILABLE

        try:
            mock_storage = MagicMock()
            with patch.dict("sys.modules", {"google.cloud.storage": mock_storage}):
                result = cache_mod._get_gcs_bucket()
                assert result is None
                mock_storage.Client.assert_not_called()
        finally:
            cache_mod._gcs_client = original
