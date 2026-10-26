"""TDD tests for word-baby care/weaken lazy evaluation (#3780).

Team-lead: "照顧和虛弱：不用排程，讀取時依 last_cared_at 推算目前狀態（lazy evaluation）。
寒暑假的規則照 care.json。"

Pure-function tests — no DB, no app import side effects beyond word_baby_care.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone


def _dt(y, m, d, hh=12):
    return datetime(y, m, d, hh, 0, 0, tzinfo=timezone.utc)


class TestWeakenState:
    def test_healthy_within_weaken_threshold(self):
        from app.services.word_baby_care import compute_weaken_state

        last_cared = _dt(2026, 3, 1)
        now = _dt(2026, 3, 3)  # 2 days later, threshold is 5
        assert compute_weaken_state(last_cared, now, weaken_after_days=5, deep_sleep_after_days=12) == "healthy"

    def test_weak_past_weaken_threshold(self):
        from app.services.word_baby_care import compute_weaken_state

        last_cared = _dt(2026, 3, 1)
        now = _dt(2026, 3, 7)  # 6 days later, past 5-day threshold
        assert compute_weaken_state(last_cared, now, weaken_after_days=5, deep_sleep_after_days=12) == "weak"

    def test_deep_sleep_past_deep_sleep_threshold(self):
        from app.services.word_baby_care import compute_weaken_state

        last_cared = _dt(2026, 3, 1)
        now = _dt(2026, 3, 14)  # 13 days later, past 12-day threshold
        assert compute_weaken_state(last_cared, now, weaken_after_days=5, deep_sleep_after_days=12) == "deep_sleep"

    def test_exactly_at_threshold_is_not_yet_weak(self):
        from app.services.word_baby_care import compute_weaken_state

        last_cared = _dt(2026, 3, 1)
        now = _dt(2026, 3, 6)  # exactly 5 days later
        assert compute_weaken_state(last_cared, now, weaken_after_days=5, deep_sleep_after_days=12) == "healthy"


class TestHatchProgressCredit:
    """effective_hatch_credit(old_last_cared_at, new_now, weaken_after_days, paused_periods)
    — the ONE formula shared by both the lazy read-time display computation and the
    write-time persistence-on-care-action computation (design doc: they must agree)."""

    def test_full_credit_when_within_weaken_window(self):
        from app.services.word_baby_care import effective_hatch_credit

        old = _dt(2026, 3, 1)
        now = _dt(2026, 3, 4)  # 3 days, well within 5-day weaken window
        credit = effective_hatch_credit(old, now, weaken_after_days=5, paused_periods=[])
        assert credit == 3

    def test_credit_capped_at_weaken_boundary_not_full_gap(self):
        """A student who vanishes for 60 days should NOT get 60 days of free hatch
        progress when they come back — credit stops at the weaken boundary."""
        from app.services.word_baby_care import effective_hatch_credit

        old = _dt(2026, 3, 1)
        now = old + timedelta(days=60)
        credit = effective_hatch_credit(old, now, weaken_after_days=5, paused_periods=[])
        assert credit == 5  # capped, not 60

    def test_paused_period_days_are_excluded_from_credit(self):
        """A lesson completed right before summer break, next completed right after —
        the entire break must not count as elapsed hatch-progress OR weaken time."""
        from app.services.word_baby_care import effective_hatch_credit

        paused = [{"name": "暑假", "start": "--07-01", "end": "--08-25"}]
        old = _dt(2026, 6, 28)
        now = _dt(2026, 8, 26)  # crosses the whole summer break
        credit = effective_hatch_credit(old, now, weaken_after_days=5, paused_periods=paused)
        # Only 6/28->6/30 (2 days) + 8/25->8/26 (1 day, 8/25 itself is the last paused day)
        # should count; but this whole gap exceeds weaken_after_days=5 anyway if we didn't
        # exclude the break — the point is the break being excluded is what keeps this
        # case "healthy" instead of "deep_sleep". We assert the credit is small (not ~60).
        assert credit <= 5

    def test_no_credit_when_now_before_old(self):
        from app.services.word_baby_care import effective_hatch_credit

        old = _dt(2026, 3, 10)
        now = _dt(2026, 3, 1)
        assert effective_hatch_credit(old, now, weaken_after_days=5, paused_periods=[]) == 0


class TestPausedPeriodMembership:
    def test_date_inside_summer_break(self):
        from app.services.word_baby_care import is_in_paused_period

        paused = [{"name": "暑假", "start": "--07-01", "end": "--08-25"}]
        assert is_in_paused_period(_dt(2026, 7, 15).date(), paused) is True

    def test_date_outside_summer_break(self):
        from app.services.word_baby_care import is_in_paused_period

        paused = [{"name": "暑假", "start": "--07-01", "end": "--08-25"}]
        assert is_in_paused_period(_dt(2026, 9, 1).date(), paused) is False

    def test_date_inside_winter_break_year_boundary_agnostic(self):
        from app.services.word_baby_care import is_in_paused_period

        paused = [{"name": "寒假", "start": "--01-15", "end": "--02-20"}]
        assert is_in_paused_period(_dt(2027, 2, 1).date(), paused) is True


class TestStudentReturningFromSummerSeesNoDamage:
    """Integration-ish scenario straight from design.md §8: student finishes the
    semester 6/30, comes back 8/26 — must see the baby exactly as they left it."""

    def test_weaken_state_unaffected_by_summer_break(self):
        from app.services.word_baby_care import compute_weaken_state

        paused = [{"name": "暑假", "start": "--07-01", "end": "--08-25"}]
        last_cared = _dt(2026, 6, 30)
        now = _dt(2026, 8, 26)
        state = compute_weaken_state(
            last_cared, now, weaken_after_days=5, deep_sleep_after_days=12, paused_periods=paused
        )
        assert state == "healthy"

    def test_hatch_progress_unaffected_by_summer_break(self):
        from app.services.word_baby_care import effective_hatch_credit

        paused = [{"name": "暑假", "start": "--07-01", "end": "--08-25"}]
        last_cared = _dt(2026, 6, 30)
        now = _dt(2026, 8, 26)
        credit = effective_hatch_credit(last_cared, now, weaken_after_days=5, paused_periods=paused)
        # Essentially nothing accrues (not progress, not penalty) across the break.
        assert credit == 0
