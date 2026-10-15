"""League scoring — read-only, weighted points derived from everyday
learning activity. Modelled on Junyi Academy's 星空探險隊 (see
docs/prd/2026-10-14-chinese-star-league-prd.md §5 for the citations and the
mapping from their mechanics to ours), rescoped per the 2026-10-15 CTO
review (§10):

Reads `LearningSession` DIRECTLY (completed_at / started_at / session_mode /
story_slug) — NOT the StudentXPLog XP ledger. The CTO review's finding #1
was that the XP ledger mixes in unrelated bonuses (streaks, first-story,
accuracy tiers) and has no unique constraint forcing "one completion per
lesson" at the ledger level; `learning_sessions` is the source those XP
rows were themselves derived from, so reading it directly removes a layer
of indirection and the mixed-in bonuses.

Grade comes from the LESSON CATALOGUE (`lesson_loader.get_lesson_by_id`),
not `Text.grade` — CTO finding #2: `Text.grade` is empty for most
second-edition (v2-renumbered) lessons, so it cannot be trusted as the
anti-farming floor's reference point. The floor itself is computed against
the TEAM's declared grade (entered by the teacher at registration, PRD
§7/LeagueTeam.grade), not the individual student's own profile grade.

Anti-farming rules (Young's decision, PRD §11):
    1. Teacher-assigned lessons ALWAYS count (no grade floor).
    2. Self-chosen lessons only count if lesson_grade >= team_grade - 2.
    3. Only the EARLIEST completion of a given lesson, ever, counts (replays
       never re-score — matches Junyi's "first time only").
    4. Max 5 counted lessons per student per calendar day (UTC date of
       completed_at) — lessons beyond the cap for that day are excluded and
       listed as anomalies.
    5. A completion where (completed_at - started_at) < 3 minutes is
       excluded and listed as an anomaly ("too fast to be real reading").

KNOWN LIMITATION (documented, not silently skipped — PRD §10 CTO finding
#4 / §11.2): Young's decision says only completions "by the student's own
account" should count (not a teacher submitting on the student's behalf).
There is currently NO queryable signal anywhere in the schema recording
which actor (student vs. teacher) actually called
POST /api/gamification/session-complete for a given LearningSession — the
route's own authorization (`_assert_can_view`) explicitly allows either,
and does not persist which one occurred. Implementing this rule would
require either (a) adding a new column to `learning_sessions` recorded at
submission time, which touches learning/gamification code (out of scope —
"league must not modify learning/assignment code") and needs its own
migration approval, or (b) parsing structured Cloud Logging audit records
out-of-band (not real-time queryable from this service). This function
therefore does NOT filter by submitting actor — every completion is
treated as the student's own. Flagged here and in the PR description /
final report, not quietly dropped.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..models.session import LearningSession
from ..services.lesson_loader import get_lesson_by_id

DAILY_LESSON_CAP = 5
MIN_COMPLETION_DURATION = timedelta(minutes=3)


@dataclass(frozen=True)
class LeagueWeights:
    version: int
    lesson_complete: float
    assignment_bonus: float
    grade_floor_offset: int
    badge_threshold: float
    treasure_chest_participation_ratio: float

    def to_json(self) -> dict:
        return asdict(self)


LEAGUE_WEIGHTS_V1 = LeagueWeights(
    version=1,
    lesson_complete=10.0,
    assignment_bonus=2.0,
    grade_floor_offset=2,
    badge_threshold=120.0,
    treasure_chest_participation_ratio=0.5,
)

LEAGUE_WEIGHTS_BY_VERSION: dict[int, LeagueWeights] = {1: LEAGUE_WEIGHTS_V1}


def weights_snapshot_for_version(version: int) -> dict:
    weights = LEAGUE_WEIGHTS_BY_VERSION.get(version)
    if weights is None:
        raise ValueError(f"Unknown league weights version: {version}")
    return weights.to_json()


def weights_from_snapshot(snapshot: dict) -> LeagueWeights:
    return LeagueWeights(**snapshot)


@dataclass(frozen=True)
class Anomaly:
    story_slug: str
    reason: str  # "too_fast" | "daily_cap_exceeded"


@dataclass(frozen=True)
class ScoreResult:
    points: float
    lessons_counted: int
    anomalies: list[Anomaly]


def _ensure_aware(dt: datetime) -> datetime:
    """Normalize a datetime read back from the DB to UTC-aware (SQLite has
    no native tz-aware datetime type; Postgres preserves it)."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _lesson_grade(story_slug: str | None) -> int | None:
    """Grade from the in-memory lesson catalogue (not Text.grade — see
    module docstring). Returns None if the slug doesn't resolve to a real
    lesson (e.g. legacy data, or a non-numeric slug)."""
    if not story_slug:
        return None
    try:
        lesson_id = int(story_slug)
    except (TypeError, ValueError):
        return None
    lesson = get_lesson_by_id(lesson_id)
    if not lesson:
        return None
    return lesson.get("grade")


def _first_completions(
    db: Session, student_id: int
) -> dict[str, tuple[str, datetime, datetime]]:
    """For `student_id`: {story_slug: (session_mode, started_at, completed_at)}
    — the EARLIEST completed_at per lesson, ever. A lesson replayed later
    never earns points again.
    """
    rows = (
        db.query(
            LearningSession.story_slug,
            LearningSession.session_mode,
            LearningSession.started_at,
            LearningSession.completed_at,
        )
        .filter(
            LearningSession.student_id == student_id,
            LearningSession.status == "completed",
            LearningSession.completed_at.isnot(None),
            LearningSession.story_slug.isnot(None),
        )
        .order_by(LearningSession.completed_at.asc())
        .all()
    )
    first: dict[str, tuple[str, datetime, datetime]] = {}
    for slug, mode, started_at, completed_at in rows:
        if slug not in first:  # ascending order — first write wins
            first[slug] = (mode, started_at, completed_at)
    return first


def compute_student_score(
    db: Session,
    student_id: int,
    team_grade: int,
    window_start: datetime,
    window_end: datetime,
    weights: LeagueWeights,
) -> ScoreResult:
    """This student's league points for lessons first-completed within the
    window, subject to anti-farming rules. See module docstring for the
    full rule set and the known "own account" limitation.
    """
    completions = _first_completions(db, student_id)

    # Filter to the window + apply the 3-minute rule + the grade floor,
    # collecting anomalies as we go.
    eligible: list[tuple[str, str, datetime]] = []
    anomalies: list[Anomaly] = []
    for slug, (mode, started_at, completed_at) in completions.items():
        completed_at = _ensure_aware(completed_at)
        started_at = _ensure_aware(started_at)
        if not (window_start <= completed_at < window_end):
            continue

        if completed_at - started_at < MIN_COMPLETION_DURATION:
            anomalies.append(Anomaly(story_slug=slug, reason="too_fast"))
            continue

        if mode != "assignment":
            grade = _lesson_grade(slug)
            floor = team_grade - weights.grade_floor_offset
            if grade is None or grade < floor:
                continue  # below floor — simply doesn't qualify, not an anomaly

        eligible.append((slug, mode, completed_at))

    # Daily cap: process in chronological order so the cap always excludes
    # the LATEST completions of a day, not an arbitrary subset.
    eligible.sort(key=lambda e: e[2])
    per_day_count: dict[object, int] = defaultdict(int)
    counted: list[tuple[str, str]] = []
    for slug, mode, completed_at in eligible:
        day = completed_at.date()
        if per_day_count[day] >= DAILY_LESSON_CAP:
            anomalies.append(Anomaly(story_slug=slug, reason="daily_cap_exceeded"))
            continue
        per_day_count[day] += 1
        counted.append((slug, mode))

    total = sum(
        weights.lesson_complete + (weights.assignment_bonus if mode == "assignment" else 0.0)
        for _slug, mode in counted
    )
    return ScoreResult(points=total, lessons_counted=len(counted), anomalies=anomalies)
