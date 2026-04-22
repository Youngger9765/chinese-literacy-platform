"""Student Dashboard routes (Issue #25).

Handles the student progress dashboard with session stats, streaks,
daily activity, and completed story slugs.

Issue #982: streak_days / longest_streak now delegate to the StudentStreak
table via gamification_service so that this endpoint and
GET /api/gamification/streak/{id} always return the same values.

Issue #1224: Cumulative stats and daily activity now use SQL aggregates
instead of loading all rows into Python and iterating.
"""
import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.session import LearningSession
from ...models.user import User
from ...services.gamification_service import _get_or_create_streak  # noqa: WPS450
from ...services.learning_stats_service import get_completed_story_slugs
from ._helpers import verify_student_access

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Schemas ───────────────────────────────────────────────────────────────────

class DailyActivity(BaseModel):
    date: str  # ISO date string YYYY-MM-DD
    sessions_completed: int
    avg_score: float | None


class DashboardResponse(BaseModel):
    # Cumulative stats
    total_sessions: int
    completed_sessions: int
    avg_score: float | None
    # Period stats
    today_sessions: int
    week_sessions: int
    # Streak
    streak_days: int
    longest_streak: int
    # Recent 30-day activity for chart
    daily_activity: list[DailyActivity]
    # Slugs of completed stories (for "already read" badges)
    completed_story_slugs: list[str]


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/learning/students/{student_id}/dashboard", response_model=DashboardResponse)
def get_student_dashboard(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a progress summary for the student dashboard.

    Includes:
    - Cumulative / period session counts
    - Learning streak (consecutive days with at least one completed session)
    - Daily activity for the last 30 days (for Recharts line chart)
    - List of completed story slugs (for completion badges in StoryLibrary)
    """
    verify_student_access(student_id, current_user, db)

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())  # Monday
    thirty_days_ago = today_start - timedelta(days=29)

    # ── Cumulative stats via SQL aggregates (Issue #1224) ─────────────────────
    # Single query replaces: .all() + Python iteration over every row.
    cumulative = (
        db.query(
            func.count(LearningSession.id).label("total_sessions"),
            func.sum(
                case((LearningSession.status == "completed", 1), else_=0)
            ).label("completed_sessions"),
            func.avg(
                case(
                    (LearningSession.status == "completed", LearningSession.overall_score),
                    else_=None,
                )
            ).label("avg_score_raw"),
            func.sum(
                case(
                    (
                        (LearningSession.status == "completed")
                        & (LearningSession.completed_at >= today_start),
                        1,
                    ),
                    else_=0,
                )
            ).label("today_sessions"),
            func.sum(
                case(
                    (
                        (LearningSession.status == "completed")
                        & (LearningSession.completed_at >= week_start),
                        1,
                    ),
                    else_=0,
                )
            ).label("week_sessions"),
        )
        .filter(LearningSession.student_id == student_id)
        .one()
    )

    total_sessions: int = cumulative.total_sessions or 0
    completed_sessions: int = cumulative.completed_sessions or 0
    avg_score: float | None = (
        round(float(cumulative.avg_score_raw), 1) if cumulative.avg_score_raw is not None else None
    )
    today_sessions: int = cumulative.today_sessions or 0
    week_sessions: int = cumulative.week_sessions or 0

    # ── Daily activity via SQL group_by (Issue #1224) ─────────────────────────
    # One query groups completed sessions by date; the Python loop below only
    # fills in the fixed 30-day window — no per-day DB round-trips.
    daily_rows = (
        db.query(
            func.date(LearningSession.completed_at).label("day"),
            func.count(LearningSession.id).label("cnt"),
            func.avg(LearningSession.overall_score).label("avg"),
        )
        .filter(
            LearningSession.student_id == student_id,
            LearningSession.status == "completed",
            LearningSession.completed_at >= thirty_days_ago,
        )
        .group_by(func.date(LearningSession.completed_at))
        .all()
    )

    # Build lookup: "YYYY-MM-DD" → (count, avg_score)
    day_map: dict[str, tuple[int, float | None]] = {}
    for row in daily_rows:
        day_key = str(row.day)[:10]  # func.date may return date or str
        cnt = row.cnt or 0
        avg = round(float(row.avg), 1) if row.avg is not None else None
        day_map[day_key] = (cnt, avg)

    daily_activity: list[DailyActivity] = []
    for i in range(30):
        day = (thirty_days_ago + timedelta(days=i)).strftime("%Y-%m-%d")
        cnt, avg = day_map.get(day, (0, None))
        daily_activity.append(DailyActivity(
            date=day,
            sessions_completed=cnt,
            avg_score=avg,
        ))

    # Streak data — delegate to StudentStreak table (Issue #982: single source of truth).
    # Both GET /api/learning/students/{id}/dashboard and
    # GET /api/gamification/streak/{id} now read from the same row.
    streak_record = _get_or_create_streak(db, student_id)
    streak_days = streak_record.current_streak
    longest_streak = streak_record.longest_streak

    # Completed story slugs — use canonical query (Issue #981)
    completed_story_slugs = get_completed_story_slugs(db, student_id)

    return DashboardResponse(
        total_sessions=total_sessions,
        completed_sessions=completed_sessions,
        avg_score=avg_score,
        today_sessions=today_sessions,
        week_sessions=week_sessions,
        streak_days=streak_days,
        longest_streak=longest_streak,
        daily_activity=daily_activity,
        completed_story_slugs=completed_story_slugs,
    )
