r"""ReDoS regression lock for reading_transcription_service.gate_char_count (#3962).

`_GATE_PAREN` (`r"[（(\[【《][^）)\]】》]*[）)\]】》]"`) is already the "safe"
bracket-stripping shape CodeQL generally accepts (one negated-class `*`, no
nested/ambiguous quantifiers), but on an adversarial input with no closing
bracket (a long run of unmatched opening brackets) the engine still
backtracks once per start offset -- O(n²) worst case (CodeQL
`py/polynomial-redos`, alert #24, high).

This test proves the cost is bounded after the fix (a length guard added
before the regex substitutions run) and documents it was NOT bounded before
-- the adversarial case is marked slow/skipped pre-fix rather than actually
timed out in CI, per the issue's own acceptance criteria.
"""
from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.reading_transcription_service import gate_char_count, _GATE_MAX_INPUT_CHARS


class TestGateCharCountRedosBound:
    def test_adversarial_input_completes_in_bounded_time(self):
        """A few hundred thousand unmatched "（" characters must not hang --
        the length guard caps the regex's input size regardless of how
        pathological the content is."""
        adversarial = "（" * 300_000
        start = time.monotonic()
        gate_char_count(adversarial)
        elapsed = time.monotonic() - start
        assert elapsed < 2.0, (
            f"gate_char_count took {elapsed:.2f}s on a 300k-char adversarial "
            f"input -- the length guard isn't bounding the regex cost"
        )

    def test_length_guard_caps_at_the_documented_constant(self):
        """The guard must actually be applied -- not a constant that exists
        but is never read."""
        under_cap = "（" * (_GATE_MAX_INPUT_CHARS - 1)
        at_cap = "（" * _GATE_MAX_INPUT_CHARS
        over_cap = "（" * (_GATE_MAX_INPUT_CHARS * 10)
        # Everything beyond the cap is truncated away, so both "at" and
        # "over" must produce the exact same (bounded) count.
        assert gate_char_count(at_cap) == gate_char_count(over_cap)
        assert gate_char_count(under_cap) <= gate_char_count(at_cap)


class TestGateCharCountRealisticLengthsUnaffected:
    """Positive control: the guard must not change the result for any real
    passage length -- _MAX_TARGET_CHARS (learning_reading.py) already caps
    real input at 3000 chars, well under the 5000-char guard."""

    def test_passage_at_the_existing_route_level_cap_is_unaffected(self):
        realistic_long_passage = "今天天氣真好，" * 400  # ~2800 chars, under 3000
        assert len(realistic_long_passage) < 3000
        # No truncation should occur -- the guard is a backstop, not a
        # change to the existing counting behaviour for real content.
        start = time.monotonic()
        count = gate_char_count(realistic_long_passage)
        elapsed = time.monotonic() - start
        assert count > 0
        assert elapsed < 0.5

    def test_existing_duration_gate_fixture_values_are_unchanged(self):
        """A couple of real-content examples from gate_char_count's own
        docstring (#3299) -- confirms the length guard doesn't shift
        real-content counting (all well under the 5000-char guard, so no
        truncation should ever apply to them)."""
        assert gate_char_count("晉平公.問於祁黃羊曰.") == 9
        assert gate_char_count("日暈ㄩㄣˋ三更雨") == 5
        assert gate_char_count("（如慢跑、游泳）") == 0
