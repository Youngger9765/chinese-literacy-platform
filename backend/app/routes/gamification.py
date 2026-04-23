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
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user, get_user_org_ids
from ..database import get_db
from ..dependencies.tenant import is_system_admin
from ..models.school import Classroom, ClassroomStudent, School
from ..models.user import Role, User, UserRole
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

_ADMIN_ROLES = frozenset({"system_admin", "org_admin", "org_owner"})


def _user_has_admin_role(db: Session, user_id: int) -> bool:
    """Return True if the user has any active admin-level role.

    Issues a single SQL COUNT query (joined to the roles table) instead of
    loading all UserRole rows into Python and doing a set intersection.
    Before this fix each call emitted N lazy SQL fetches — one per UserRole row.
    """
    count = (
        db.query(func.count(UserRole.id))
        .join(Role, Role.id == UserRole.role_id)
        .filter(
            UserRole.user_id == user_id,
            UserRole.is_active == True,
            Role.name.in_(_ADMIN_ROLES),
        )
        .scalar()
    )
    return (count or 0) > 0


def _get_user_org_ids_from_db(user_id: int, db: Session) -> set[str]:
    """Return the set of org scope_ids for a given user (loaded from DB).

    Used to resolve the org(s) a student belongs to without relying on
    eagerly-loaded relationships.
    """
    rows = (
        db.query(UserRole.scope_id)
        .filter(
            UserRole.user_id == user_id,
            UserRole.is_active == True,
            UserRole.scope_type == "organization",
            UserRole.scope_id.isnot(None),
        )
        .all()
    )
    return {r.scope_id for r in rows}


def _get_user_org_ids_from_db(user_id: int, db: Session) -> set[str]:
    """Return the set of org scope_ids for a given user (loaded from DB).

    Used to resolve the org(s) a student belongs to without relying on
    eagerly-loaded relationships.
    """
    rows = (
        db.query(UserRole.scope_id)
        .filter(
            UserRole.user_id == user_id,
            UserRole.is_active == True,
            UserRole.scope_type == "organization",
            UserRole.scope_id.isnot(None),
        )
        .all()
    )
    return {r.scope_id for r in rows}


def _assert_can_view(current_user: User, student_id: int, db: Session) -> None:
    """Raise 403 if the current user cannot view the given student's gamification data.

    Access is granted when the caller is:
    - The student themselves
    - A teacher who has the student in one of their classrooms
    - system_admin (bypasses all scope checks)
    - org_admin / org_owner scoped to an org that the student also belongs to

    Cross-org access by org_admin is explicitly denied (個資法 §20).
    """
    if current_user.id == student_id:
        return  # viewing own data

    # Teacher check: caller teaches a classroom that contains the student
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

    # system_admin bypasses all scope checks
    if is_system_admin(current_user):
        return

    # org_admin / org_owner: must share at least one org with the student
    caller_org_ids = set(get_user_org_ids(current_user) or [])
    if caller_org_ids:
        student_org_ids = _get_user_org_ids_from_db(student_id, db)
        if caller_org_ids & student_org_ids:
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
        # system_admin bypasses all scope checks
        if is_system_admin(current_user):
            pass  # allowed
        else:
            # org_admin / org_owner: classroom's school must belong to caller's org
            caller_org_ids = set(get_user_org_ids(current_user) or [])
            if caller_org_ids:
                school = db.query(School).filter(School.id == classroom.school_id).first()
                if school and school.organization_id in caller_org_ids:
                    pass  # allowed
                else:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN, detail="Access denied"
                    )
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN, detail="Access denied"
                )

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
