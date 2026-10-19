"""五人對抗賽：依題幹長度計算閱讀時間 — PRD §3.5/§7.

⚠️ TEMPORARY LOCAL HELPER. PRD §7 says this should reuse "#3631 的閱讀時間
計算（依題幹字數，同一個函式，不複製）" — but #3631 (live_quiz P0 改善) is
still open with no remote branch as of this slice (verified 2026-10-18),
so there is no shared function to call yet. `live_quiz.round_types.choice`
still ships a flat `DEFAULT_READING_SECONDS = 4`.

This module exists so team_arena is not blocked on that PR, but it is a
DUPLICATE of intent, not of code — once #3631 merges a shared by-length
reading-time utility, this module should be deleted and team_arena should
import that one instead (PRD §7's "不改引擎" independence rule only says
team_arena must not need to modify live_quiz's engine to add a lane; it does
not forbid later consolidating two genuinely identical helpers).

This module must never import from `app.services.live_quiz` — that is what
test_team_arena_reading_time.py::TestIndependenceFromLiveQuiz locks.
"""
from __future__ import annotations

# A student reading a short MCQ stem at a comfortable pace — these numbers
# are this implementation's own estimate (not sourced from #3631, which has
# no merged formula to cite yet). Chosen to keep team_arena's rounds in the
# same rough 20-45s budget PRD §3.5 describes without the reading phase
# alone ever exceeding it.
_CHARS_PER_SECOND = {
    "slow": 3.0,
    "standard": 5.0,
    "fast": 8.0,
}
_BASE_SECONDS = 1.5

SPEED_PRESETS: tuple[str, ...] = tuple(_CHARS_PER_SECOND)
MIN_READING_SECONDS = 2
MAX_READING_SECONDS = 15


def reading_seconds_for_stem(stem: str, *, speed: str = "standard") -> int:
    """`speed` is the teacher's PRD §3.5 慢／標準／快 picker. Returns an
    integer second count clamped to [MIN_READING_SECONDS,
    MAX_READING_SECONDS] — the bound exists so neither an empty stem (too
    short to be worth a reading phase) nor an unusually long comprehension
    passage stem can push a single round outside the mode's time budget.
    """
    if speed not in _CHARS_PER_SECOND:
        raise ValueError(f"Unknown reading speed {speed!r}, expected one of {SPEED_PRESETS}")
    chars_per_second = _CHARS_PER_SECOND[speed]
    raw = _BASE_SECONDS + len(stem) / chars_per_second
    return max(MIN_READING_SECONDS, min(MAX_READING_SECONDS, round(raw)))
