"""Student Dashboard routes (Issue #25).

Handles the student progress dashboard with session stats, streaks,
daily activity, and completed story slugs.
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
from ._helpers import verify_student_access

router = APIRouter(tags=["learning"])
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

    # Streak calculation (consecutive days with at least 1 completed session up to today)
    all_completed_days = set()
    for s in completed:
        if s.completed_at:
            all_completed_days.add(s.completed_at.strftime("%Y-%m-%d"))

    streak_days = 0
    check_day = today_start
    for _ in range(365):
        day_str = check_day.strftime("%Y-%m-%d")
        if day_str in all_completed_days:
            if streak_days == 0 and check_day.date() < now.date():
                # Allow a gap of one day (yesterday still counts)
                pass
            streak_days += 1
        else:
            break
        check_day -= timedelta(days=1)

    # Longest streak calculation
    streak_check = 0
    longest_streak = 0
    sorted_days = sorted(all_completed_days)
    for idx, day_str in enumerate(sorted_days):
        if idx == 0:
            streak_check = 1
        else:
            prev = datetime.strptime(sorted_days[idx - 1], "%Y-%m-%d")
            curr = datetime.strptime(day_str, "%Y-%m-%d")
            if (curr - prev).days == 1:
                streak_check += 1
            else:
                streak_check = 1
        longest_streak = max(longest_streak, streak_check)

    # Completed story slugs
    completed_story_slugs = list({
        s.story_slug for s in completed if s.story_slug
    })

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
