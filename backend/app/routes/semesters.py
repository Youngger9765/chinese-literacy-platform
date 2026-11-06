"""Semester management API.

Endpoints:
  GET    /schools/{school_id}/semesters           — list semesters
  POST   /schools/{school_id}/semesters           — create semester
  GET    /schools/{school_id}/semesters/active    — get active semester
  PATCH  /schools/{school_id}/semesters/{id}      — update semester
  POST   /schools/{school_id}/semesters/{id}/activate  — activate semester

Access:
  - system_admin can manage any school's semesters.
  - Read (list/get-active): any active member of the school (#3804 —
    school-as-label model; the old org_admin-of-the-school's-org bypass
    is retired).
  - Write (create/update/activate): find_01DygBxNaTFMHa8cgm2yhHRm
    (medium, CWE-863), 2026-11-06 — tightened from "any member" to a
    verified management relationship, since self-serve school membership
    is a trivial, zero-friction action and this is a write with a much
    bigger blast radius than the read above (see _can_manage_semester's
    own docstring in authz.py for the exact rule). A self-activated
    school has NO member who can write its semesters today; a real
    school requires school.admin_user_id == the caller.
"""

import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy.orm import Session

from ..auth.authz import can
from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.school import School
from ..models.semester import Semester
from ..models.user import User
from ..services.semester_service import (
    SemesterCreateData,
    activate_semester,
    create_semester,
    get_active_semester,
    list_semesters,
)

router = APIRouter(tags=["semesters"])
logger = logging.getLogger(__name__)


# ── Schemas ───────────────────────────────────────────────────────────────────


class SemesterResponse(BaseModel):
    id: int
    school_id: int | None
    name: str
    start_date: date
    end_date: date
    grace_days: int
    is_active: bool
    expires_at_date: date
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class SemesterCreateRequest(BaseModel):
    name: str
    start_date: date
    end_date: date
    grace_days: int = 7
    is_active: bool = False

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be empty")
        return v

    @model_validator(mode="after")
    def end_after_start(self) -> "SemesterCreateRequest":
        if self.end_date <= self.start_date:
            raise ValueError("end_date must be after start_date")
        return self

    @field_validator("end_date")
    @classmethod
    def end_date_not_in_the_past(cls, v: date) -> date:
        """Claude Security find_01DygBxNaTFMHa8cgm2yhHRm (medium, CWE-863),
        recommendation 2: a semester created with is_active=True and an
        already-past end_date immediately stamps expires_at on every
        unstamped ClassroomText at the school (see _propagate_expires_at),
        which a later cleanup run soft-deletes -- an instant mass-expiry,
        regardless of who is authorized to manage the semester. Reject it
        at the schema level, independent of the authz fix above."""
        if v < date.today():
            raise ValueError("end_date must not be in the past")
        return v

    @field_validator("grace_days")
    @classmethod
    def grace_days_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("grace_days must be >= 0")
        return v


class SemesterUpdateRequest(BaseModel):
    name: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    grace_days: int | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _get_school_or_404(school_id: int, db: Session) -> School:
    school = db.query(School).filter(School.id == school_id).first()
    if school is None:
        raise HTTPException(status_code=404, detail="School not found")
    return school


def _require_school_write_access(school: School, current_user: User, db: Session) -> None:
    """Allow system_admin, or a verified management relationship to this
    school -- see authz.py's _can_manage_semester docstring for the exact
    rule (tightened 2026-11-06, find_01DygBxNaTFMHa8cgm2yhHRm). This is
    stricter than bare school membership (which _require_school_read_access
    below still uses) because this gate protects WRITE endpoints that can
    mass-expire every other teacher's classroom texts at the school.
    """
    if not can(current_user, "manage", "semester", school.id, db):
        raise HTTPException(status_code=403, detail="Insufficient permissions")


def _require_school_read_access(school: School, current_user: User, db: Session) -> None:
    """Allow system_admin, or a member of the school (#3804: org_admin bypass retired)."""
    if not can(current_user, "view", "school_roster", school.id, db):
        raise HTTPException(status_code=403, detail="Not authorized for this school")


def _semester_to_response(s: Semester) -> SemesterResponse:
    return SemesterResponse(
        id=s.id,
        school_id=s.school_id,
        name=s.name,
        start_date=s.start_date,
        end_date=s.end_date,
        grace_days=s.grace_days,
        is_active=s.is_active,
        expires_at_date=s.expires_at_date,
        created_at=s.created_at.isoformat(),
        updated_at=s.updated_at.isoformat(),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get(
    "/schools/{school_id}/semesters",
    response_model=list[SemesterResponse],
    summary="List semesters for a school",
)
def list_school_semesters(
    school_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return all semesters for a school, newest first."""
    school = _get_school_or_404(school_id, db)
    _require_school_read_access(school, current_user, db)
    semesters = list_semesters(school_id, db)
    return [_semester_to_response(s) for s in semesters]


@router.post(
    "/schools/{school_id}/semesters",
    status_code=201,
    response_model=SemesterResponse,
    summary="Create a semester",
)
def create_school_semester(
    school_id: int,
    payload: SemesterCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new semester for a school.

    If is_active=True, deactivates all other semesters for this school and
    sets expires_at on ClassroomText rows for this school's classrooms.
    """
    school = _get_school_or_404(school_id, db)
    _require_school_write_access(school, current_user, db)

    data = SemesterCreateData(
        school_id=school_id,
        name=payload.name,
        start_date=payload.start_date,
        end_date=payload.end_date,
        grace_days=payload.grace_days,
        is_active=payload.is_active,
        created_by_id=current_user.id,
    )
    semester = create_semester(data, db)
    logger.info(
        "User %d created semester %d for school %d",
        current_user.id, semester.id, school_id,
    )
    return _semester_to_response(semester)


@router.get(
    "/schools/{school_id}/semesters/active",
    response_model=SemesterResponse | None,
    summary="Get active semester for a school",
)
def get_school_active_semester(
    school_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the currently active semester, or null if none."""
    school = _get_school_or_404(school_id, db)
    _require_school_read_access(school, current_user, db)
    semester = get_active_semester(school_id, db)
    if semester is None:
        return None
    return _semester_to_response(semester)


@router.patch(
    "/schools/{school_id}/semesters/{semester_id}",
    response_model=SemesterResponse,
    summary="Update a semester",
)
def update_school_semester(
    school_id: int,
    semester_id: int,
    payload: SemesterUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update semester name/dates/grace_days. Does NOT change is_active."""
    school = _get_school_or_404(school_id, db)
    _require_school_write_access(school, current_user, db)

    semester = db.query(Semester).filter(
        Semester.id == semester_id,
        Semester.school_id == school_id,
    ).first()
    if semester is None:
        raise HTTPException(status_code=404, detail="Semester not found")

    update_data = payload.model_dump(exclude_unset=True)

    # Validate date ordering if either date is being updated
    new_start = update_data.get("start_date", semester.start_date)
    new_end = update_data.get("end_date", semester.end_date)
    if new_end <= new_start:
        raise HTTPException(status_code=422, detail="end_date must be after start_date")

    # find_01DygBxNaTFMHa8cgm2yhHRm recommendation 2: same past-date reject
    # as SemesterCreateRequest -- a PATCH can set end_date into the past on
    # an ALREADY-active semester just as easily as a fresh create can.
    if new_end < date.today():
        raise HTTPException(status_code=422, detail="end_date must not be in the past")

    for field, value in update_data.items():
        setattr(semester, field, value)

    db.commit()
    db.refresh(semester)
    logger.info("User %d updated semester %d: %s", current_user.id, semester_id, list(update_data.keys()))
    return _semester_to_response(semester)


@router.post(
    "/schools/{school_id}/semesters/{semester_id}/activate",
    response_model=SemesterResponse,
    summary="Activate a semester",
)
def activate_school_semester(
    school_id: int,
    semester_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Activate a semester.

    Deactivates all sibling semesters for this school and propagates
    expires_at to ClassroomText rows that don't have an explicit expiry.
    """
    school = _get_school_or_404(school_id, db)
    _require_school_write_access(school, current_user, db)

    # Verify the semester belongs to this school
    semester = db.query(Semester).filter(
        Semester.id == semester_id,
        Semester.school_id == school_id,
    ).first()
    if semester is None:
        raise HTTPException(status_code=404, detail="Semester not found")

    # find_01DygBxNaTFMHa8cgm2yhHRm recommendation 2: activating a semester
    # whose end_date is already in the past immediately propagates
    # expires_at to every unstamped ClassroomText at the school -- reject
    # it here too, since a semester's end_date could have been in the
    # future at creation time and drifted into the past before someone
    # calls activate (or been set in the past via a since-reverted bug).
    if semester.end_date < date.today():
        raise HTTPException(
            status_code=422,
            detail="Cannot activate a semester whose end_date is already in the past",
        )

    activated = activate_semester(semester_id, db)
    logger.info(
        "User %d activated semester %d for school %d",
        current_user.id, semester_id, school_id,
    )
    return _semester_to_response(activated)
