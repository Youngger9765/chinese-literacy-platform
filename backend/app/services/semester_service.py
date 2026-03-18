"""Semester service — business logic for creating/managing semesters.

Design decisions:
- Semesters are school-scoped (school_id).
- Only one semester per school can be is_active=True at a time.
  Activating a semester deactivates all others for that school.
- Expiry propagation: when a semester is activated, all ClassroomText rows
  whose classroom belongs to that school get expires_at set to
  semester.end_date + grace_days (if expires_at is not already set).
- No hard deletes; is_active=False is the "archived" state.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta

from sqlalchemy.orm import Session

from ..models.semester import Semester
from ..models.school import Classroom, ClassroomText

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _deactivate_school_semesters(school_id: int | None, db: Session) -> None:
    """Set is_active=False for all semesters belonging to school_id."""
    db.query(Semester).filter(
        Semester.school_id == school_id,
        Semester.is_active == True,  # noqa: E712
    ).update({"is_active": False})


def _propagate_expires_at(semester: Semester, db: Session) -> int:
    """Set expires_at on ClassroomText rows for classrooms in this school.

    Only rows where expires_at is NULL are updated; rows that already have an
    explicit expiry (e.g. manually set) are left unchanged.

    Returns the number of rows updated.
    """
    if semester.school_id is None:
        return 0

    expires_dt = datetime.combine(
        semester.expires_at_date, datetime.min.time(), tzinfo=timezone.utc
    )

    # Collect classroom IDs for this school
    classroom_ids = [
        row.id
        for row in db.query(Classroom.id).filter(
            Classroom.school_id == semester.school_id
        ).all()
    ]
    if not classroom_ids:
        return 0

    updated = (
        db.query(ClassroomText)
        .filter(
            ClassroomText.classroom_id.in_(classroom_ids),
            ClassroomText.expires_at.is_(None),
            ClassroomText.deleted_at.is_(None),
        )
        .update({"expires_at": expires_dt}, synchronize_session=False)
    )
    logger.info(
        "propagate_expires_at: semester=%d school=%d updated %d ClassroomText rows",
        semester.id,
        semester.school_id,
        updated,
    )
    return updated


# ── Public API ────────────────────────────────────────────────────────────────


@dataclass
class SemesterCreateData:
    name: str
    start_date: object  # datetime.date
    end_date: object    # datetime.date
    grace_days: int = 7
    is_active: bool = False
    school_id: int | None = None
    created_by_id: int | None = None


def create_semester(data: SemesterCreateData, db: Session) -> Semester:
    """Create a new semester.

    If is_active=True, deactivates all other semesters for the same school
    and propagates expires_at to ClassroomText rows.
    """
    if data.is_active:
        _deactivate_school_semesters(data.school_id, db)

    semester = Semester(
        school_id=data.school_id,
        name=data.name,
        start_date=data.start_date,
        end_date=data.end_date,
        grace_days=data.grace_days,
        is_active=data.is_active,
        created_by_id=data.created_by_id,
    )
    db.add(semester)
    db.flush()

    if data.is_active:
        _propagate_expires_at(semester, db)

    db.commit()
    db.refresh(semester)
    logger.info("Created semester %d '%s' (school=%s, active=%s)", semester.id, semester.name, data.school_id, data.is_active)
    return semester


def activate_semester(semester_id: int, db: Session) -> Semester:
    """Activate a semester, deactivating siblings and propagating expiry dates."""
    semester = db.query(Semester).filter(Semester.id == semester_id).first()
    if semester is None:
        raise ValueError(f"Semester {semester_id} not found")

    _deactivate_school_semesters(semester.school_id, db)
    semester.is_active = True
    db.flush()

    propagated = _propagate_expires_at(semester, db)
    db.commit()
    db.refresh(semester)
    logger.info(
        "Activated semester %d '%s'; propagated expiry to %d ClassroomText rows",
        semester.id, semester.name, propagated,
    )
    return semester


def list_semesters(school_id: int | None, db: Session) -> list[Semester]:
    """Return all semesters for a school, newest first."""
    return (
        db.query(Semester)
        .filter(Semester.school_id == school_id)
        .order_by(Semester.start_date.desc())
        .all()
    )


def get_active_semester(school_id: int | None, db: Session) -> Semester | None:
    """Return the currently active semester for a school, or None."""
    return (
        db.query(Semester)
        .filter(
            Semester.school_id == school_id,
            Semester.is_active == True,  # noqa: E712
        )
        .first()
    )
