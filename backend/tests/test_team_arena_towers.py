"""TDD for team_arena.towers — PRD §3.1/§3.2 (地圖：四條路線＋主堡, 計分)."""
from __future__ import annotations

import pytest

from app.services.team_arena.teams import PRIMARY_LANES
from app.services.team_arena.towers import (
    BASE_HITS_TO_WIN,
    TOWERS_PER_LANE,
    apply_correct_answer,
    new_path_state,
)


class TestNewPathState:
    def test_starts_with_zero_towers_down_and_zero_base_hits(self):
        state = new_path_state()
        assert state.base_hits == 0
        for lane in PRIMARY_LANES:
            assert state.towers_down[lane] == 0


class TestApplyCorrectAnswerAdvancesOwnLane:
    def test_first_correct_knocks_outer_tower(self):
        state = new_path_state()
        new_state, event = apply_correct_answer(state, "zhuyin")
        assert new_state.towers_down["zhuyin"] == 1
        assert event == "tower_down"
        assert new_state.base_hits == 0

    def test_second_correct_on_same_lane_clears_it(self):
        state = new_path_state()
        state, _ = apply_correct_answer(state, "zhuyin")
        state, event = apply_correct_answer(state, "zhuyin")
        assert state.towers_down["zhuyin"] == TOWERS_PER_LANE
        assert event == "lane_cleared"

    def test_other_lanes_unaffected(self):
        state = new_path_state()
        state, _ = apply_correct_answer(state, "zhuyin")
        assert state.towers_down["vocab_definitions"] == 0
        assert state.towers_down["vocab_application"] == 0
        assert state.towers_down["comprehension"] == 0


class TestLaneClearedThenBaseHits:
    """PRD §3.1: "某條路兩座塔都倒之後，該路之後的答對改打主堡"."""

    def test_third_correct_on_cleared_lane_hits_base(self):
        state = new_path_state()
        state, _ = apply_correct_answer(state, "zhuyin")
        state, _ = apply_correct_answer(state, "zhuyin")  # lane cleared
        state, event = apply_correct_answer(state, "zhuyin")
        assert state.base_hits == 1
        assert event == "base_hit"
        # the lane's own tower count must not keep incrementing past clear
        assert state.towers_down["zhuyin"] == TOWERS_PER_LANE

    def test_base_conquered_at_configured_hits(self):
        state = new_path_state()
        for _ in range(TOWERS_PER_LANE):
            state, _ = apply_correct_answer(state, "zhuyin")
        events = []
        for _ in range(BASE_HITS_TO_WIN):
            state, event = apply_correct_answer(state, "zhuyin")
            events.append(event)
        assert state.base_hits == BASE_HITS_TO_WIN
        assert events[-1] == "base_conquered"
        assert state.is_base_conquered() is True

    def test_base_hits_never_exceed_win_threshold(self):
        """A match that has already ended must not keep accumulating base
        hits if `apply_correct_answer` is (incorrectly) called again — this
        is a defensive cap, the caller (engine, slice 2) is expected to stop
        calling once `is_base_conquered()` is True."""
        state = new_path_state()
        for _ in range(TOWERS_PER_LANE + BASE_HITS_TO_WIN + 3):
            state, _event = apply_correct_answer(state, "zhuyin")
        assert state.base_hits == BASE_HITS_TO_WIN


class TestTwoLanesClearedDoNotDoubleCountBase:
    def test_clearing_two_lanes_then_hitting_base_from_either(self):
        state = new_path_state()
        for lane in ("zhuyin", "vocab_definitions"):
            for _ in range(TOWERS_PER_LANE):
                state, _ = apply_correct_answer(state, lane)
        state, event = apply_correct_answer(state, "vocab_definitions")
        assert event == "base_hit"
        assert state.base_hits == 1
        state, event = apply_correct_answer(state, "zhuyin")
        assert event == "base_conquered"
        assert state.base_hits == 2


class TestInvalidLaneRejected:
    def test_unknown_lane_raises(self):
        state = new_path_state()
        with pytest.raises(ValueError):
            apply_correct_answer(state, "not-a-lane")

    def test_support_lane_is_not_a_tower_lane(self):
        """PRD §3.1: support has no fixed lane of its own — 系統替他挑
        本隊推進最少的那條路出題 (the engine, not this module, resolves
        'support' into one of the PRIMARY_LANES before calling here)."""
        state = new_path_state()
        with pytest.raises(ValueError):
            apply_correct_answer(state, "support")


class TestNoOpAfterBaseConquered:
    """Critic review (slice 1): the original defensive cap only guarded
    repeated calls on the SAME lane that scored the winning hit — a call on
    a DIFFERENT, still-uncleared lane after the base was already conquered
    silently advanced that other lane instead of being a no-op. This is the
    regression lock for that fix."""

    def _conquered_state(self):
        state = new_path_state()
        for _ in range(TOWERS_PER_LANE + BASE_HITS_TO_WIN):
            state, _ = apply_correct_answer(state, "zhuyin")
        assert state.is_base_conquered() is True
        return state

    def test_cross_lane_call_after_conquest_is_a_full_noop(self):
        state = self._conquered_state()
        before = dict(state.towers_down)
        new_state, event = apply_correct_answer(state, "vocab_definitions")
        assert event == "base_conquered"
        assert new_state.towers_down == before
        assert new_state.base_hits == BASE_HITS_TO_WIN

    def test_cross_lane_call_after_conquest_does_not_advance_that_lane(self):
        state = self._conquered_state()
        new_state, _event = apply_correct_answer(state, "comprehension")
        assert new_state.towers_down["comprehension"] == 0


class TestStateIsImmutable:
    def test_apply_correct_answer_does_not_mutate_input(self):
        state = new_path_state()
        before = dict(state.towers_down)
        apply_correct_answer(state, "zhuyin")
        assert state.towers_down == before
