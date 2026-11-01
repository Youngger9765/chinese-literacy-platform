"""Gamification API routes.

Endpoints:
  GET  /api/gamification/summary/{student_id}        — full XP + badges + streak summary
  GET  /api/gamification/points/{student_id}         — XP and level info
  GET  /api/gamification/achievements/{student_id}   — earned and available badges
  GET  /api/gamification/streak/{student_id}         — streak info
  GET  /api/gamification/leaderboard/{classroom_id}  — class leaderboard
  POST /api/gamification/award-xp                    — award XP for an event (internal/admin)
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth.authz import can
from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.school import Classroom, ClassroomStudent
from ..models.session import LearningSession
from ..models.user import User
from ..services.gamification_service import (
    award_xp,
    get_classroom_leaderboard,
    get_student_summary,
    process_session_completion,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/gamification", tags=["gamification"])


# ---------------------------------------------------------------------------
# Request / Response schemas (inline Pydantic for simplicity)
# ---------------------------------------------------------------------------


class AwardXPRequest(BaseModel):
    student_id: int
    event_type: str
    session_id: int | None = None
    note: str | None = None


class SessionCompleteRequest(BaseModel):
    student_id: int
    session_id: int
    reading_accuracy: float | None = None
    comprehension_passed: bool = False
    #: 真實百分比。舊 client 不會送，那時才退回 comprehension_passed（#2904）
    comprehension_score: float | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _assert_can_view(current_user: User, student_id: int, db: Session) -> None:
    """Raise 403 if the current user cannot view the given student's gamification data.

    (#3804) Delegates to the centralized can() policy table — system_admin,
    self, or the owning/co-teaching teacher of a classroom containing the
    student. This also fixes a pre-existing gap: the old inline check here
    only recognized the classroom's *primary* teacher, not co-teachers
    (policies.require_student_visible_to_teacher already covered both). The
    org_admin/org_owner "shares an org with the student" bypass is retired —
    school/org no longer grants reach into a student's data.
    """
    if not can(current_user, "view", "student", student_id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/summary/{student_id}")
def get_summary(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Full gamification summary: XP, level, badges, streak."""
    _assert_can_view(current_user, student_id, db)
    student = db.query(User).filter(User.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return get_student_summary(db, student_id)


@router.get("/points/{student_id}")
def get_points(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Return XP total and level breakdown for a student."""
    _assert_can_view(current_user, student_id, db)
    summary = get_student_summary(db, student_id)
    return {
        "student_id": student_id,
        "total_xp": summary["total_xp"],
        "stories_completed": summary["stories_completed"],
        "level_info": summary["level_info"],
    }


@router.get("/achievements/{student_id}")
def get_achievements(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Return unlocked badges and full badge catalogue for a student."""
    _assert_can_view(current_user, student_id, db)
    summary = get_student_summary(db, student_id)
    return {
        "student_id": student_id,
        "badges": summary["badges"],
        "all_badges": summary["all_badges"],
        "total_unlocked": len(summary["badges"]),
    }


@router.get("/streak/{student_id}")
def get_streak(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Return streak information for a student."""
    _assert_can_view(current_user, student_id, db)
    summary = get_student_summary(db, student_id)
    return {"student_id": student_id, **summary["streak"]}


@router.get("/leaderboard/{classroom_id}")
def get_leaderboard(
    classroom_id: int,
    limit: int = Query(10, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Return class leaderboard ranked by total XP.

    (#3804) Visible to: system_admin, the classroom owner or a co-teacher
    (via can()'s "view"/"classroom" policy — this also fixes a pre-existing
    gap where co-teachers couldn't see the leaderboard at all), or an
    enrolled student. The org_admin/org_owner "classroom's school belongs to
    caller's org" bypass is retired.
    """
    classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    is_student = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.student_id == current_user.id,
        )
        .first()
        is not None
    )
    if not is_student and not can(current_user, "view", "classroom", classroom, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    entries = get_classroom_leaderboard(db, classroom_id, limit=limit)
    return {
        "classroom_id": classroom_id,
        "entries": entries,
        "total_students": len(entries),
    }


@router.post("/session-complete")
def on_session_complete(
    body: SessionCompleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Award XP and badges when a student completes a learning session.

    Can be called by the student themselves or a teacher/admin.
    """
    _assert_can_view(current_user, body.student_id, db)
    # Settlement is idempotent per session_id, so the session must be this student's:
    # otherwise a child could settle a classmate's session for their own XP and the
    # classmate's real completion would then be skipped as "already processed" (#3531).
    session = db.query(LearningSession).filter(LearningSession.id == body.session_id).first()
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if session.student_id != body.student_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Session does not belong to this student")
    result = process_session_completion(
        db,
        student_id=body.student_id,
        session_id=body.session_id,
        reading_accuracy=body.reading_accuracy,
        comprehension_passed=body.comprehension_passed,
        comprehension_score=body.comprehension_score,
    )
    return result
