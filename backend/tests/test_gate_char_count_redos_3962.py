r"""ReDoS regression lock for reading_transcription_service.gate_char_count (#3962).

`gate_char_count` used to strip bracket spans with a regex --
`_re_mod.compile(r"[（(\[【《][^）)\]】》]*[）)\]】》]")`. That pattern looks
"safe" (one negated-class `*`, no nested/ambiguous quantifiers), but on an
adversarial input with no closing bracket (a long run of unmatched opening
brackets) the engine still backtracks once per start offset -- O(n²) worst
case (CodeQL `py/polynomial-redos`, alert #24, high).

A length guard alone doesn't change the regex's *shape*, so CodeQL kept
flagging the alert even with one in place (confirmed: the first attempt at
this fix added `_GATE_MAX_INPUT_CHARS` but left the regex untouched, and the
re-scan still flagged it). The actual fix replaces the regex with
`_strip_bracket_spans` -- a single forward pass over the text plus a
precomputed "next closer index" array, both O(n), no backtracking possible.

This test proves: (1) the new function reproduces the OLD regex's exact
output across tens of thousands of fuzzed inputs, (2) the adversarial case
that used to hang now completes in linear time, (3) real content is
unaffected.
"""
from __future__ import annotations

import os
import random
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.reading_transcription_service import (
    gate_char_count,
    _GATE_MAX_INPUT_CHARS,
    _GATE_OPENERS,
    _GATE_CLOSERS,
    _strip_bracket_spans,
)

# The original (pre-fix) regex, kept here ONLY as a fuzz-comparison oracle --
# never used in production code. This is what _strip_bracket_spans replaces.
_ORIGINAL_REGEX = re.compile(r"[（(\[【《][^）)\]】》]*[）)\]】》]")


class TestStripBracketSpansMatchesOriginalRegex:
    """_strip_bracket_spans must be byte-for-byte equivalent to the regex it
    replaces -- this is a rewrite, not a new algorithm, and gate_char_count's
    existing 329-lesson fixture depends on exact parity."""

    def test_edge_cases(self):
        cases = [
            "",
            "（",
            "）",
            "（）",
            "()",
            "（）（）",
            "（（）",
            "（））",
            "（（（（",
            "））））",
            "（abc）（def）",
            "（abc",
            "abc）",
            "（如慢跑、游泳）課文內容",
            "晉平公.問於祁黃羊曰.",
            "（（（（（abc）",
            "[【《（abc）》】]",
            "（[abc)]",
            "abc（）def（）ghi",
        ]
        for s in cases:
            expected = _ORIGINAL_REGEX.sub("", s)
            actual = _strip_bracket_spans(s, _GATE_OPENERS, _GATE_CLOSERS)
            assert actual == expected, (s, expected, actual)

    def test_fuzz_against_the_original_regex(self):
        random.seed(20260308)
        alphabet = list("ab（([【《）)]】》 ")
        mismatches = []
        for _ in range(30_000):
            length = random.randint(0, 40)
            s = "".join(random.choice(alphabet) for _ in range(length))
            expected = _ORIGINAL_REGEX.sub("", s)
            actual = _strip_bracket_spans(s, _GATE_OPENERS, _GATE_CLOSERS)
            if actual != expected:
                mismatches.append((s, expected, actual))
        assert not mismatches, f"{len(mismatches)} mismatches, first 5: {mismatches[:5]}"


class TestGateCharCountRedosBound:
    def test_adversarial_input_completes_in_linear_time(self):
        """A few hundred thousand unmatched "（" characters must not hang.
        Uses a 2M-char input (well above _GATE_MAX_INPUT_CHARS) to prove the
        underlying algorithm is linear, not just bounded by the length
        guard -- the regex this replaces never completed 300k chars within
        40s; this completes 2M chars in well under 1s."""
        adversarial = "（" * 2_000_000
        start = time.monotonic()
        _strip_bracket_spans(adversarial, _GATE_OPENERS, _GATE_CLOSERS)
        elapsed = time.monotonic() - start
        assert elapsed < 1.0, (
            f"_strip_bracket_spans took {elapsed:.2f}s on a 2M-char "
            f"adversarial input -- no longer linear"
        )

    def test_gate_char_count_itself_completes_in_bounded_time(self):
        adversarial = "（" * 300_000
        start = time.monotonic()
        gate_char_count(adversarial)
        elapsed = time.monotonic() - start
        assert elapsed < 2.0, (
            f"gate_char_count took {elapsed:.2f}s on a 300k-char adversarial input"
        )

    def test_length_guard_caps_at_the_documented_constant(self):
        """The guard must actually be applied -- not a constant that exists
        but is never read. (Now a cheap extra backstop on top of the linear
        algorithm, not the fix itself.)"""
        under_cap = "（" * (_GATE_MAX_INPUT_CHARS - 1)
        at_cap = "（" * _GATE_MAX_INPUT_CHARS
        over_cap = "（" * (_GATE_MAX_INPUT_CHARS * 10)
        assert gate_char_count(at_cap) == gate_char_count(over_cap)
        assert gate_char_count(under_cap) <= gate_char_count(at_cap)


class TestGateCharCountRealisticLengthsUnaffected:
    """Positive control: real content must be unaffected by this rewrite."""

    def test_passage_at_the_existing_route_level_cap_is_unaffected(self):
        realistic_long_passage = "今天天氣真好，" * 400  # ~2800 chars, under 3000
        assert len(realistic_long_passage) < 3000
        start = time.monotonic()
        count = gate_char_count(realistic_long_passage)
        elapsed = time.monotonic() - start
        assert count > 0
        assert elapsed < 0.5

    def test_existing_duration_gate_fixture_values_are_unchanged(self):
        """A couple of real-content examples -- confirms the rewrite doesn't
        shift real-content counting at all (identical to the pre-fix regex
        output, per the fuzz/edge-case tests above)."""
        assert gate_char_count("晉平公.問於祁黃羊曰.") == 9
        assert gate_char_count("日暈ㄩㄣˋ三更雨") == 5
        assert gate_char_count("（如慢跑、游泳）") == 0
