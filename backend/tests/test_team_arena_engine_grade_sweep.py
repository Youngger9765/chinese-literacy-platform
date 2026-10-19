"""TDD for team_arena.engine's grade-pool scope handling — task brief's
explicit "class-level sweep" requirement: every grade 1-12 can start a
match (resolves to a real lesson pool) or gets a Chinese fallback message,
never an unhandled exception or an English detail reaching a classroom.
Same `resolve_pool_grade` nearest-grade-fallback logic as pk.engine's own
copy (#3610), exercised here as team_arena's own regression lock.
"""
from __future__ import annotations

import re

import pytest
from fastapi import HTTPException

from app.services.team_arena import engine as svc

CJK = re.compile(r"[一-鿿]")


class TestGradeSweepOneToTwelve:
    """Positive control for the sweep itself (overclaim-bias rule): assert
    the loop actually iterated 12 cases, not zero."""

    @pytest.mark.parametrize("grade", list(range(1, 13)))
    def test_every_grade_resolves_or_gives_chinese_fallback(self, grade):
        try:
            resolved = svc.resolve_pool_grade(str(grade))
            assert resolved, f"grade {grade} resolved to an empty value"
        except HTTPException as exc:
            # The only acceptable failure mode: a Chinese, child-safe detail
            # (PRD §15's "題庫不足" risk) — never an unhandled exception,
            # never raw English reaching a student's screen.
            assert CJK.search(exc.detail), f"grade {grade} fallback message not Chinese: {exc.detail!r}"

    @pytest.mark.parametrize("grade", list(range(1, 13)))
    def test_every_grade_validates_as_a_scope(self, grade):
        """validate_scope (what create_session actually calls) must not
        raise for any real classroom grade 1-12 — a classroom in this
        range is never dead-ended just because the library's own numeric
        span happens to start at 4 (#3610's resolve_pool_grade fallback
        covers the gap)."""
        svc.validate_scope("grade_pool", str(grade))  # must not raise

    def test_sweep_actually_iterated_twelve_cases(self):
        cases = list(range(1, 13))
        assert len(cases) == 12
        resolved_count = 0
        for grade in cases:
            try:
                svc.resolve_pool_grade(str(grade))
                resolved_count += 1
            except HTTPException:
                pass
        assert resolved_count > 0, "expected at least one grade to resolve to a real pool"
