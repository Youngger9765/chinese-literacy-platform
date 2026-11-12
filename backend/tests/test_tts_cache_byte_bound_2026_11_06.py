"""L1 TTS cache must be bounded by total bytes, not just entry count.

Claude Security finding find_014TkDM4cNsqXZB2ViMmYtmr (medium, CWE-770):
CACHE_MAX_ENTRIES (500) bounds how many distinct clips are kept, but says
nothing about how BIG each one is. An attacker sending distinct maximal-
length texts could fill the process with a handful of multi-MB MP3 clips
and OOM a 1Gi Cloud Run instance well before hitting 500 entries.

Fixed: _l1_put now also tracks a running total of bytes held and evicts
oldest-first (same FIFO order as the existing count-based eviction) once
the total exceeds CACHE_MAX_BYTES, independent of how many entries that is.
"""
from app.services.tts import cache as tts_cache_module


def _reset_cache():
    tts_cache_module._TTS_CACHE.clear()
    tts_cache_module._cache_total_bytes = 0


class TestCacheByteBound:
    def setup_method(self):
        _reset_cache()

    def teardown_method(self):
        _reset_cache()

    def test_filling_the_cache_with_oversized_clips_plateaus_total_bytes(self):
        """The core fix criteria: resident bytes must plateau at the budget,
        not grow unbounded with distinct cache keys."""
        clip_size = 2 * 1024 * 1024  # 2 MiB per fake clip
        n_clips_to_exceed_budget = (tts_cache_module.CACHE_MAX_BYTES // clip_size) + 20

        for i in range(n_clips_to_exceed_budget):
            tts_cache_module._l1_put(f"key-{i}", b"x" * clip_size, provider="azure")

        assert tts_cache_module._cache_total_bytes <= tts_cache_module.CACHE_MAX_BYTES, (
            f"resident bytes {tts_cache_module._cache_total_bytes} exceeded "
            f"the budget {tts_cache_module.CACHE_MAX_BYTES}"
        )
        # the tracked total must also match reality (sum of what's actually held)
        actual = sum(len(v) for v in tts_cache_module._TTS_CACHE.values())
        assert tts_cache_module._cache_total_bytes == actual

    def test_oldest_entries_are_evicted_first_by_bytes_too(self):
        """Same FIFO order the existing count-based eviction already uses --
        this is an additional eviction trigger, not a different policy."""
        clip_size = tts_cache_module.CACHE_MAX_BYTES // 3 + 1  # 3 of these exceed budget

        tts_cache_module._l1_put("oldest", b"x" * clip_size, provider="azure")
        tts_cache_module._l1_put("middle", b"x" * clip_size, provider="azure")
        tts_cache_module._l1_put("newest", b"x" * clip_size, provider="azure")

        assert "azure oldest" not in tts_cache_module._TTS_CACHE, "oldest entry should have been evicted"
        assert "azure newest" in tts_cache_module._TTS_CACHE, "newest entry must survive"

    def test_small_real_world_entries_never_trigger_byte_eviction(self):
        """Normal traffic (real lesson sentences/paragraphs, measured max
        1671 chars ~= a few hundred KB of MP3 at most) must never come near
        the budget -- this is purely an abuse-case bound."""
        realistic_clip = b"x" * (200 * 1024)  # 200 KiB, generous for a paragraph-level clip
        for i in range(50):
            tts_cache_module._l1_put(f"realistic-{i}", realistic_clip, provider="azure")

        assert len(tts_cache_module._TTS_CACHE) == 50, "no entries should have been evicted"
