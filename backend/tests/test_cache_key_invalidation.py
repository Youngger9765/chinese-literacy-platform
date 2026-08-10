"""Changing how a sentence is pronounced must change its cache key.

The key was `sha256(text)` alone. Nothing else — not the voice, not the
`<prosody rate="1.08">` the code itself calls "product-tunable", and not the
pronunciation correction table.

So adding a correction fixed nothing that was already cached. Every stored clip
containing that word kept serving the old, wrong reading forever, because its
key had not moved. The only escape was remembering to delete those objects by
hand, and the person who forgets is the person who just changed the table.

That is not hypothetical here: it is the mechanism behind the mispronunciations
that were reported. A pre-generated file predated a fix by two days and nobody
could tell by looking.

Putting a fingerprint of the corrections into the key makes stale audio
*unreachable* rather than *wrong*. Regenerating the whole corpus costs roughly
$2, which is not a number worth designing around.
"""
from __future__ import annotations

from unittest.mock import patch

from app.services.tts import normalization as norm


class TestKeyDependsOnPronunciation:
    def test_same_text_same_table_is_stable(self):
        """Otherwise every deploy would silently re-synthesize everything."""
        assert norm._cache_key("小戴相信攻擊。") == norm._cache_key("小戴相信攻擊。")

    def test_changing_the_table_changes_the_key(self):
        before = norm._cache_key("小戴相信攻擊。")

        with patch.object(norm, "CORRECTIONS_FINGERPRINT", "different"):
            after = norm._cache_key("小戴相信攻擊。")

        assert before != after, (
            "a corrections change left the key untouched — every already-cached "
            "clip would keep serving the old reading"
        )

    def test_different_text_still_differs(self):
        assert norm._cache_key("第一句。") != norm._cache_key("第二句。")

    def test_whitespace_is_still_ignored(self):
        # Pre-existing behaviour: surrounding whitespace must not fork the cache.
        assert norm._cache_key("  你好  ") == norm._cache_key("你好")


class TestFingerprint:
    def test_it_actually_reflects_the_table(self):
        """A constant would satisfy every test above while doing nothing."""
        original = norm.CORRECTIONS_FINGERPRINT

        with patch.object(norm, "PHONEME_CORRECTIONS", norm.PHONEME_CORRECTIONS[:-1]):
            recomputed = norm._compute_corrections_fingerprint()

        assert recomputed != original, (
            "dropping an entry did not move the fingerprint — it is not derived "
            "from the table"
        )

    def test_it_is_short_enough_to_read_in_a_path(self):
        assert 8 <= len(norm.CORRECTIONS_FINGERPRINT) <= 16

    def test_order_does_not_matter(self):
        """The table is sorted by length; a tie could reorder between runs and
        must not invalidate the entire cache for nothing."""
        shuffled = list(reversed(norm.PHONEME_CORRECTIONS))
        with patch.object(norm, "PHONEME_CORRECTIONS", shuffled):
            assert norm._compute_corrections_fingerprint() == norm.CORRECTIONS_FINGERPRINT
