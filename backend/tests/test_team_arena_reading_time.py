"""TDD for team_arena.reading_time — PRD §3.5/§7 "閱讀時間依題幹長度計算
（#3631，有上下限；老師可選 慢／標準／快）".

#3631 (live_quiz P0 改善) is still OPEN/unmerged as of this slice (verified
2026-10-18 — no remote branch for it yet), so `live_quiz`'s own
`DEFAULT_READING_SECONDS` is still a flat constant, not a by-length
function. This module is a LOCAL, team_arena-only helper that implements
the same intent independently — see the module docstring for the explicit
"replace me once #3631 merges a shared utility" note. It must NOT import
anything from `live_quiz` (independence rule, PRD §7)."""
from __future__ import annotations

import pytest

from app.services.team_arena.reading_time import (
    MAX_READING_SECONDS,
    MIN_READING_SECONDS,
    SPEED_PRESETS,
    reading_seconds_for_stem,
)


class TestBoundsAlwaysRespected:
    @pytest.mark.parametrize("speed", list(SPEED_PRESETS))
    @pytest.mark.parametrize("length", [0, 1, 5, 20, 60, 200, 1000])
    def test_result_is_always_within_bounds(self, speed, length):
        stem = "字" * length
        seconds = reading_seconds_for_stem(stem, speed=speed)
        assert MIN_READING_SECONDS <= seconds <= MAX_READING_SECONDS

    def test_empty_stem_still_returns_the_minimum(self):
        assert reading_seconds_for_stem("", speed="standard") == MIN_READING_SECONDS


class TestLongerStemReadsLonger:
    def test_monotonic_non_decreasing_with_length(self):
        prev = reading_seconds_for_stem("字", speed="standard")
        for length in (5, 10, 20, 40, 80):
            cur = reading_seconds_for_stem("字" * length, speed="standard")
            assert cur >= prev
            prev = cur


class TestSpeedPresetsOrderSlowStandardFast:
    """PRD: 老師可選 慢／標準／快 — 慢 must give MORE time than 標準, which
    must give more than 快, for the SAME stem."""

    def test_same_stem_slow_ge_standard_ge_fast(self):
        stem = "字" * 40
        slow = reading_seconds_for_stem(stem, speed="slow")
        standard = reading_seconds_for_stem(stem, speed="standard")
        fast = reading_seconds_for_stem(stem, speed="fast")
        assert slow >= standard >= fast

    def test_exactly_three_presets_named_per_prd(self):
        assert set(SPEED_PRESETS) == {"slow", "standard", "fast"}


class TestUnknownSpeedRejected:
    def test_unknown_speed_raises(self):
        with pytest.raises(ValueError):
            reading_seconds_for_stem("字字字", speed="turbo")


class TestIndependenceFromLiveQuiz:
    def test_no_live_quiz_import_statement_in_source(self):
        import ast
        import inspect

        from app.services.team_arena import reading_time

        tree = ast.parse(inspect.getsource(reading_time))
        imported_modules = [
            alias.name
            for node in ast.walk(tree)
            if isinstance(node, (ast.Import, ast.ImportFrom))
            for alias in node.names
        ] + [
            node.module
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.module
        ]
        assert not any("live_quiz" in (m or "") for m in imported_modules)
