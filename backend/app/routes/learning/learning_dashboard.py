"""Student Dashboard routes (Issue #25).

Handles the student progress dashboard with session stats, streaks,
daily activity, and completed story slugs.

Issue #982: streak_days / longest_streak now delegate to the StudentStreak
table via gamification_service so that this endpoint and
GET /api/gamification/streak/{id} always return the same values.
"""
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel
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

    def _ensure_aware(dt: datetime | None) -> datetime | None:
        """Make naive datetimes UTC-aware to prevent comparison errors."""
        if dt is None:
            return None
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt

    # All sessions for this student
    all_sessions = (
        db.query(LearningSession)
        .filter(LearningSession.student_id == student_id)
        .all()
    )

    total_sessions = len(all_sessions)
    completed = [s for s in all_sessions if s.status == "completed"]
    completed_sessions = len(completed)

    scores = [s.overall_score for s in completed if s.overall_score is not None]
    avg_score = round(sum(scores) / len(scores), 1) if scores else None

    today_sessions = sum(
        1 for s in completed
        if s.completed_at and _ensure_aware(s.completed_at) >= today_start
    )
    week_sessions = sum(
        1 for s in completed
        if s.completed_at and _ensure_aware(s.completed_at) >= week_start
    )

    # Daily activity for past 30 days
    day_sessions: dict[str, list[float]] = defaultdict(list)
    for s in completed:
        if s.completed_at and _ensure_aware(s.completed_at) >= thirty_days_ago:
            day_key = s.completed_at.strftime("%Y-%m-%d")
            day_sessions[day_key].append(s.overall_score if s.overall_score is not None else 0)

    daily_activity: list[DailyActivity] = []
    for i in range(30):
        day = (thirty_days_ago + timedelta(days=i)).strftime("%Y-%m-%d")
        scores_for_day = day_sessions.get(day, [])
        daily_activity.append(DailyActivity(
            date=day,
            sessions_completed=len(scores_for_day),
            avg_score=round(sum(scores_for_day) / len(scores_for_day), 1) if scores_for_day else None,
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
