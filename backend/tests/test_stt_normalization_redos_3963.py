r"""ReDoS regression lock for stt/normalization.py's normalize_for_comparison (#3963).

`_strip_decorative_symbols`'s `re.sub(r"（[^）]*）", "", t)` and
`re.sub(r"\([^)]*\)", "", t)` are the same negated-class bracket-stripping
shape as the sibling fix in reading_transcription_service.py's `_GATE_PAREN`
(#3962) -- already "safe" in the sense CodeQL generally wants, but on an
adversarial run of unmatched opening brackets the engine still backtracks
once per start offset (O(n²) worst case, CodeQL `py/polynomial-redos`,
alerts #22-#23, high).

This test proves the cost is bounded after the fix and documents it was NOT
bounded before -- `normalize_for_comparison` is the single public entry
point every STT consumer (stt_service.py, reading_evaluation_service.py,
stt/algorithm.py, stt/evaluate.py) goes through.
"""
from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.stt.normalization import (
    normalize_for_comparison,
    _NORMALIZE_MAX_INPUT_CHARS,
)


class TestNormalizeForComparisonRedosBound:
    def test_adversarial_cjk_paren_input_completes_in_bounded_time(self):
        """A few hundred thousand unmatched "（" characters must not hang."""
        adversarial = "（" * 300_000
        start = time.monotonic()
        normalize_for_comparison(adversarial)
        elapsed = time.monotonic() - start
        assert elapsed < 2.0, (
            f"normalize_for_comparison took {elapsed:.2f}s on a 300k-char "
            f"adversarial CJK-paren input -- the length guard isn't bounding "
            f"the regex cost"
        )

    def test_adversarial_ascii_paren_input_completes_in_bounded_time(self):
        """Same adversarial shape with the ASCII paren variant."""
        adversarial = "(" * 300_000
        start = time.monotonic()
        normalize_for_comparison(adversarial)
        elapsed = time.monotonic() - start
        assert elapsed < 2.0, (
            f"normalize_for_comparison took {elapsed:.2f}s on a 300k-char "
            f"adversarial ASCII-paren input"
        )

    def test_length_guard_caps_at_the_documented_constant(self):
        under_cap = "（" * (_NORMALIZE_MAX_INPUT_CHARS - 1)
        at_cap = "（" * _NORMALIZE_MAX_INPUT_CHARS
        over_cap = "（" * (_NORMALIZE_MAX_INPUT_CHARS * 10)
        assert normalize_for_comparison(at_cap) == normalize_for_comparison(over_cap)
        assert len(normalize_for_comparison(under_cap)) <= len(normalize_for_comparison(at_cap))


class TestNormalizeForComparisonRealisticLengthsUnaffected:
    """Positive control: real STT transcripts / lesson passages are far
    below the 5000-char guard, so normal content must be unaffected."""

    def test_realistic_passage_is_unaffected_and_fast(self):
        realistic = "今天天氣真好，我們去公園散步。" * 150  # ~2250 chars
        assert len(realistic) < 3000
        start = time.monotonic()
        result = normalize_for_comparison(realistic)
        elapsed = time.monotonic() - start
        assert result
        assert elapsed < 0.5

    def test_existing_behavior_examples_are_unchanged(self):
        """A couple of plain-sentence examples -- confirms the guard didn't
        shift real-content normalization (both well under the cap)."""
        assert normalize_for_comparison("你好，世界！") == "你好世界"
        assert normalize_for_comparison("（如慢跑、游泳）課文內容") == "課文內容"
        assert normalize_for_comparison("這是2026年") == "這是二千零二十六年"


class TestDropBracketGroupsMatchesRegex:
    """The linear helper must give exactly what the old regexes gave."""

    def test_equivalent_to_regex_on_random_inputs(self):
        import random
        import re

        from app.services.stt.normalization import _drop_bracket_groups

        rng = random.Random(3963)
        alphabet = "ab（）()字 "
        for _ in range(5000):
            s = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 30)))
            assert _drop_bracket_groups(s, "（", "）") == re.sub(r"（[^）]*）", "", s), s
            assert _drop_bracket_groups(s, "(", ")") == re.sub(r"\([^)]*\)", "", s), s

    def test_unmatched_openers_are_linear(self):
        from app.services.stt.normalization import _drop_bracket_groups

        s = "(" * 200_000
        t0 = time.perf_counter()
        assert _drop_bracket_groups(s, "(", ")") == s
        assert time.perf_counter() - t0 < 1.0
