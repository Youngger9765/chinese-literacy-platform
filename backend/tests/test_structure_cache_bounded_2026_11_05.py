"""Claude Security finding find_0143q5urPhQLE871jkbgHpRy (high, CWE-770):
"Story structure cache keyed on raw story_id and free-form p grows without
eviction".

The in-memory `_structure_cache` in app/routes/stories.py used to be keyed
on the raw `story_id` path segment (many spellings alias to one lesson via
`normalize_story_slug`) and the raw, unvalidated `p` query value (an unknown
`p` silently fell back to the base table but still minted a new permanent
key). A logged-in attacker -- self-registration is open and auto-verified,
so anyone can get one -- could grow the cache without bound and OOM the
backend instance.

Two independent fixes, each covered here:
  1. The cache key is now built only from the canonical numeric lesson id
     and a `p` validated against the lesson's own `repeat_rounds` -- an
     alias or an unrecognised `p` must collapse to the SAME key the base
     request would use.
  2. The cache is now a bounded LRU (`_CACHE_MAX_ENTRIES`), so no sequence
     of requests for distinct keys can grow it past a fixed ceiling.

Unit-level (direct function calls, no HTTP/auth plumbing needed), same
style as test_yaml_first_structure.py.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from app.routes.stories import (
    _canonical_structure_cache_key,
    _get_cached_structure,
    _set_cached_structure,
    _structure_cache,
    _CACHE_MAX_ENTRIES,
)


def _reset_cache():
    _structure_cache.clear()


class TestCanonicalCacheKeyCollapsesAliases:
    def test_no_p_gives_the_bare_numeric_id(self):
        story = {"repeat_rounds": {}}
        assert _canonical_structure_cache_key(42, story, None) == "42"
        assert _canonical_structure_cache_key(42, story, "") == "42"

    def test_unrecognised_p_collapses_to_the_same_key_as_no_p(self):
        """The real attack: an attacker sends a new random `p` on every
        request. Before the fix, each one minted a distinct, permanent
        cache entry even though the response is identical to the base
        table every time."""
        story = {"repeat_rounds": {"real-article": {"story_structure_table": []}}}
        base_key = _canonical_structure_cache_key(42, story, None)
        for junk_p in ("a" * 500, "attacker-1", "attacker-2", "日本語テスト", "🎲🎲🎲"):
            assert _canonical_structure_cache_key(42, story, junk_p) == base_key, (
                f"an unrecognised p={junk_p!r} must collapse to the base key, "
                f"not mint a new one"
            )

    def test_a_real_repeat_round_gets_its_own_key_distinct_from_base(self):
        """Positive control: this isn't "p is always ignored" -- a real,
        known round genuinely gets its own cache entry, separate from the
        base table (#2930: different articles must not share a cache)."""
        story = {"repeat_rounds": {"round-a": {"story_structure_table": []}, "round-b": {}}}
        base_key = _canonical_structure_cache_key(42, story, None)
        key_a = _canonical_structure_cache_key(42, story, "round-a")
        key_b = _canonical_structure_cache_key(42, story, "round-b")
        assert len({base_key, key_a, key_b}) == 3, "each real round must get its own key"

    def test_different_numeric_ids_never_collide(self):
        story = {"repeat_rounds": {}}
        assert _canonical_structure_cache_key(1, story, None) != _canonical_structure_cache_key(2, story, None)


class TestCacheIsBounded:
    def test_cache_never_exceeds_max_entries_under_unbounded_distinct_keys(self):
        """The real attack, end to end: an attacker who can make the
        process store a distinct entry per request (e.g. via junk `p`
        values, pre-canonicalization) must not be able to grow the dict
        past a fixed ceiling no matter how many requests they send."""
        _reset_cache()
        try:
            for i in range(_CACHE_MAX_ENTRIES + 500):
                _set_cached_structure(f"attacker-key-{i}", {"rows": []})
            assert len(_structure_cache) <= _CACHE_MAX_ENTRIES, (
                f"cache grew to {len(_structure_cache)} entries, "
                f"past the {_CACHE_MAX_ENTRIES} cap"
            )
        finally:
            _reset_cache()

    def test_eviction_drops_the_oldest_entry_not_a_random_one(self):
        _reset_cache()
        try:
            for i in range(_CACHE_MAX_ENTRIES):
                _set_cached_structure(f"k{i}", {"rows": [i]})
            # one more push should evict exactly the oldest (k0)
            _set_cached_structure("k-new", {"rows": ["new"]})
            assert _get_cached_structure("k0") is None, "oldest entry should have been evicted"
            assert _get_cached_structure("k-new") is not None
            assert _get_cached_structure(f"k{_CACHE_MAX_ENTRIES - 1}") is not None, (
                "most recently written entries must survive eviction"
            )
        finally:
            _reset_cache()

    def test_reading_an_entry_protects_it_from_eviction_lru(self):
        """True LRU, not FIFO: reading the OLDEST entry must move it to the
        back of the eviction queue, so the NEXT eviction takes the
        second-oldest entry instead -- proving rank is reordered by reads,
        not fixed at insertion order."""
        _reset_cache()
        try:
            for i in range(_CACHE_MAX_ENTRIES):
                _set_cached_structure(f"f{i}", {"rows": [i]})  # f0 oldest .. f{N-1} newest

            # Touch the OLDEST entry -- this must move it to the newest end.
            assert _get_cached_structure("f0") is not None

            # One more insertion evicts whatever is now oldest. If the touch
            # worked, that's f1 (not f0, which was just promoted).
            _set_cached_structure("k-new", {"rows": ["new"]})

            assert _get_cached_structure("f0") is not None, (
                "f0 was just read -- it must survive this eviction round "
                "(FIFO would have evicted it regardless of the read)"
            )
            assert _get_cached_structure("f1") is None, (
                "f1 was never touched -- it must be the one evicted now "
                "that f0 was promoted ahead of it"
            )
        finally:
            _reset_cache()
