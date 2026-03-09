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

from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.school import Classroom, ClassroomStudent
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _assert_can_view(current_user: User, student_id: int, db: Session) -> None:
    """Raise 403 if the current user is neither the student nor a teacher/admin."""
    if current_user.id == student_id:
        return  # viewing own data

    # Check if current user is a teacher who has this student
    from ..models.school import ClassroomStudent, Classroom

    is_teacher = (
        db.query(Classroom)
        .join(ClassroomStudent, ClassroomStudent.classroom_id == Classroom.id)
        .filter(
            Classroom.teacher_id == current_user.id,
            ClassroomStudent.student_id == student_id,
        )
        .first()
        is not None
    )
    if is_teacher:
        return

    # Check admin roles
    from ..models.user import UserRole
    admin_roles = {"system_admin", "org_admin", "org_owner"}
    user_role_names = {
        ur.role.name
        for ur in db.query(UserRole)
        .filter(UserRole.user_id == current_user.id, UserRole.is_active == True)
        .all()
        if ur.role
    }
    if admin_roles & user_role_names:
        return

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
    """Return class leaderboard ranked by total XP."""
    classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    # Only the classroom teacher, admins, or enrolled students can see the leaderboard
    is_teacher = classroom.teacher_id == current_user.id
    is_student = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.student_id == current_user.id,
        )
        .first()
        is not None
    )
    if not is_teacher and not is_student:
        # Check admin roles
        from ..models.user import UserRole
        admin_roles = {"system_admin", "org_admin", "org_owner"}
        user_role_names = {
            ur.role.name
            for ur in db.query(UserRole)
            .filter(UserRole.user_id == current_user.id, UserRole.is_active == True)
            .all()
            if ur.role
        }
        if not (admin_roles & user_role_names):
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
    result = process_session_completion(
        db,
        student_id=body.student_id,
        session_id=body.session_id,
        reading_accuracy=body.reading_accuracy,
        comprehension_passed=body.comprehension_passed,
    )
    return result
