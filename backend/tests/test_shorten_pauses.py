"""Azure leaves ~885 ms of silence at every sentence end. Shorten it.

Measured on a real 139-character paragraph: 29.90 s of audio containing 7.57 s
of silence — 25% of the runtime — in two cleanly separated groups.

    comma pauses     235–288 ms   (5 of them)
    sentence pauses  878–889 ms   (6 of them)

The comma pauses are fine. The sentence pauses are nearly a full second each,
and that is what the owner hears: 「現在句子跟句子之間停頓接近一秒誒」.

I got this wrong once already by treating Azure's own timing as the target —
"our gap is shorter than Azure's natural pause, so leave it alone". Natural for
a news reader is not right for a child following along in a book. The number to
aim at is what sounds right for reading practice, not what the engine defaults
to.

Only long silences are touched, and only down to a floor: a sentence boundary
still needs a beat, or the reading runs together and becomes harder to follow
than it was.
"""
from __future__ import annotations

import pytest

from app.services.tts.pauses import (
    LONG_PAUSE_MS,
    TARGET_PAUSE_MS,
    plan_pause_cuts,
)


def silence(ms: int) -> tuple[int, int]:
    """A (start_ms, duration_ms) silence run, positioned arbitrarily."""
    return (1000, ms)


class TestWhatGetsCut:
    def test_a_sentence_pause_is_shortened_to_the_target(self):
        cuts = plan_pause_cuts([(5000, 885)], total_ms=30000)
        assert cuts == [(5000 + TARGET_PAUSE_MS, 885 - TARGET_PAUSE_MS)]

    def test_a_comma_pause_is_left_alone(self):
        # 235–288 ms measured; these are the rhythm of the sentence, not dead air.
        assert plan_pause_cuts([(5000, 288)], total_ms=30000) == []

    @pytest.mark.parametrize("ms", [289, 400, LONG_PAUSE_MS - 1])
    def test_nothing_below_the_threshold_is_touched(self, ms):
        assert plan_pause_cuts([(5000, ms)], total_ms=30000) == []

    def test_every_long_pause_in_a_paragraph_is_handled(self):
        runs = [(2160, 288), (4380, 885), (8920, 884), (13040, 878)]
        cuts = plan_pause_cuts(runs, total_ms=29900)
        assert len(cuts) == 3, "the three sentence pauses, not the comma"


class TestWhatIsProtected:
    def test_the_leading_silence_is_kept(self):
        """68 ms of head padding is the clip's onset; cutting into it clips the
        first syllable."""
        assert plan_pause_cuts([(0, 900)], total_ms=30000) == []

    def test_the_trailing_silence_is_kept(self):
        """The tail is the gap to the next paragraph, and a paragraph boundary
        is a place a pause belongs."""
        assert plan_pause_cuts([(29110, 792)], total_ms=29900) == []

    def test_a_pause_is_never_removed_entirely(self):
        """A sentence boundary has to stay audible.

        Asserting `kept >= TARGET_PAUSE_MS` is not enough — it holds trivially
        when TARGET_PAUSE_MS is 0, which is exactly the setting that glues the
        sentences together. The floor has to be a number this test owns.
        """
        FLOOR_MS = 200
        assert TARGET_PAUSE_MS >= FLOOR_MS, (
            f"{TARGET_PAUSE_MS} ms leaves no audible sentence boundary"
        )
        for run in [(5000, 885), (5000, 2000), (5000, 5000)]:
            for start, dur in plan_pause_cuts([run], total_ms=30000):
                kept = start - run[0]
                assert kept >= FLOOR_MS, "sentences would run together"


class TestOrdering:
    def test_cuts_come_back_in_playback_order(self):
        """The caller splices by walking forward; out-of-order cuts would
        corrupt the offsets silently."""
        runs = [(13040, 878), (4380, 885), (8920, 884)]
        cuts = plan_pause_cuts(runs, total_ms=29900)
        assert [c[0] for c in cuts] == sorted(c[0] for c in cuts)

    def test_cuts_never_overlap(self):
        runs = [(4380, 885), (8920, 884), (13040, 878)]
        cuts = plan_pause_cuts(runs, total_ms=29900)
        for (s1, d1), (s2, _) in zip(cuts, cuts[1:]):
            assert s1 + d1 <= s2
