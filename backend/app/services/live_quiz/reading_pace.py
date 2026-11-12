"""issue #3631 P0 #1: "選項出現時間依題目長度" — how long a question's stem is
shown ALONE (no options, server-enforced — see ``round_types/choice.player_view``)
before the answer window opens, computed per question from its own length
and a teacher-picked pace preset, instead of one fixed value
(``DEFAULT_READING_SECONDS`` in ``round_types/choice.py``) applied to every
round in a game regardless of how long that round's stem actually is.

Only ``round_types/choice.generate_rounds`` calls this — a round type is
free not to (PK deliberately bypasses it entirely via an explicit
``settings["reading_seconds"]`` override, see that module's
``generate_rounds`` docstring).

chars_per_second basis (labelled an ESTIMATE, not a validated norm — no
first-party measurement of students' SILENT recognition speed on a short
quiz stem exists on this platform yet):

  This codebase's only calibrated reading-speed number is the ORAL fluency
  CPM table (`frontend/src/utils/personaConfig.ts` ``GRADE_CPM_DEFAULTS``,
  ~190-220 CPM across grades 4-9 — itself flagged there as "死的：沒有正式
  消費端" but still the one number grounded in anything). Silently
  recognising a short multiple-choice stem is faster than reading it aloud
  (no vocalisation, no fluency scoring pressure), so each preset here is
  pitched AT OR ABOVE that oral average, not below it:

    慢   (slow):     3.5 char/s = 210 CPM  (~= the oral average itself —
                      "slow" for a silent reader is still as fast as a
                      fluent student reading aloud)
    標準 (standard):  5.0 char/s = 300 CPM  (~1.4x the oral average)
    快   (fast):      7.0 char/s = 420 CPM  (~2x the oral average)

MIN/MAX basis (measured, 2026-10-18, against the live production question
pool — ``backend/data/lessons``, 179 lessons, scorable-char stem lengths
across all four live-quiz source modules: min 1 / p50 16 / p90 30 / p99 37 /
max 103 characters — see ``test_live_quiz_reading_pace_3631.py``'s
class-level sweep for the test that keeps this honest as content changes):

  MIN_READING_SECONDS=2 — even a one-character stem needs a moment to
    register as "a new question just appeared" before anyone could read it.
  MAX_READING_SECONDS=20 — the slowest preset on the single longest
    measured stem (103 chars) would compute to ceil(103/3.5)+1 = 31s, which
    would stall a live, Kahoot-paced room; 20s is a deliberate ceiling, not
    a claim that every stem fits the formula without clamping. Still well
    under the ENGINE's own hard validation bound for the (separate, opt-in)
    explicit-override path — `live_quiz/engine.py`'s own
    `MAX_READING_SECONDS = 30` constant — so the two bounds never conflict.

BASE_SECONDS=1 — a small constant "a new question just rendered, before
  reading starts" orientation beat, applied uniformly regardless of pace.
"""
from __future__ import annotations

import math

from ..reading_transcription_service import scorable_char_count

CHARS_PER_SECOND: dict[str, float] = {
    "slow": 3.5,
    "standard": 5.0,
    "fast": 7.0,
}
DEFAULT_PACE = "standard"
VALID_PACES: tuple[str, ...] = tuple(CHARS_PER_SECOND)

BASE_SECONDS = 1
MIN_READING_SECONDS = 2
MAX_READING_SECONDS = 20


def compute_reading_seconds(stem: str, pace: str = DEFAULT_PACE) -> int:
    """Pure function of (stem, pace) — same inputs always give the same
    answer, so a round's frozen ``rounds_snapshot`` payload stays
    deterministic and replayable like everything else in this module
    (external review #2's recomputability requirement).

    An unrecognised ``pace`` string falls back to ``DEFAULT_PACE`` rather
    than raising — the one caller (``round_types/choice.generate_rounds``)
    already validates the value at ``engine.create_game`` time; this
    function stays defensive on its own so it is safe to call from a test
    or a future caller without re-deriving that validation here too.
    """
    chars_per_second = CHARS_PER_SECOND.get(pace, CHARS_PER_SECOND[DEFAULT_PACE])
    char_count = scorable_char_count(stem or "")
    raw = math.ceil(char_count / chars_per_second) + BASE_SECONDS
    return max(MIN_READING_SECONDS, min(MAX_READING_SECONDS, raw))
