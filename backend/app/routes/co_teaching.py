"""Co-teaching API — invite / remove / list co-teachers for a classroom.

Permission model:
  - Only the classroom owner (primary teacher) or admin can invite/remove co-teachers.
  - Co-teachers (assistants) can view student progress but not modify classroom settings.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.policies import (
    is_admin,
    require_classroom_member,
    require_classroom_owner,
)
from ..database import get_db
from ..models.school import Classroom, ClassroomTeacher
from ..models.user import User
from .classrooms import _get_classroom_or_404

router = APIRouter(tags=["co-teaching"])
logger = logging.getLogger(__name__)


# ── Schemas ───────────────────────────────────────────────────────────────────


class ClassroomTeacherResponse(BaseModel):
    id: int
    classroom_id: int
    teacher_id: int
    teacher_name: str
    teacher_email: str
    role: str  # "primary" | "assistant"
    invited_at: str

    model_config = {"from_attributes": True}


class InviteTeacherRequest(BaseModel):
    email: EmailStr


def _classroom_teacher_to_response(ct: ClassroomTeacher) -> ClassroomTeacherResponse:
    return ClassroomTeacherResponse(
        id=ct.id,
        classroom_id=ct.classroom_id,
        teacher_id=ct.teacher_id,
        teacher_name=ct.teacher.name,
        teacher_email=ct.teacher.email,
        role=ct.role,
        invited_at=ct.invited_at.isoformat(),
    )


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get(
    "/classrooms/{classroom_id}/teachers",
    response_model=list[ClassroomTeacherResponse],
)
def list_classroom_teachers(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all teachers (owner + co-teachers) for a classroom.

    Accessible by any classroom member (owner or co-teacher) and admins.
    """
    classroom = _get_classroom_or_404(classroom_id, db)

    # Allow owner, co-teachers, and admins to view
    require_classroom_member(classroom, current_user, db)

    teachers = (
        db.query(ClassroomTeacher)
        .filter(ClassroomTeacher.classroom_id == classroom_id)
        .all()
    )
    return [_classroom_teacher_to_response(ct) for ct in teachers]


@router.post(
    "/classrooms/{classroom_id}/teachers",
    status_code=201,
    response_model=ClassroomTeacherResponse,
)
def invite_co_teacher(
    classroom_id: int,
    payload: InviteTeacherRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Invite a teacher to co-manage a classroom by email.

    Only the classroom owner or admin can invite. The invited user must already
    have a teacher account. Invited teacher gets role='assistant'.
    """
    classroom = _get_classroom_or_404(classroom_id, db)
    require_classroom_owner(classroom, current_user, db)

    # Look up the invited teacher by email
    invitee = db.query(User).filter(User.email == payload.email, User.is_active == True).first()
    if invitee is None:
        raise HTTPException(
            status_code=404,
            detail="No active user found with that email address",
        )

    # Cannot invite yourself (already the owner)
    if invitee.id == classroom.teacher_id:
        raise HTTPException(
            status_code=409,
            detail="This teacher is already the classroom owner",
        )

    # Check for duplicate invite
    existing = (
        db.query(ClassroomTeacher)
        .filter(
            ClassroomTeacher.classroom_id == classroom_id,
            ClassroomTeacher.teacher_id == invitee.id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail="This teacher is already a member of the classroom",
        )

    ct = ClassroomTeacher(
        classroom_id=classroom_id,
        teacher_id=invitee.id,
        role="assistant",
        invited_by=current_user.id,
    )
    db.add(ct)
    db.commit()
    db.refresh(ct)
    logger.info(
        "Teacher %d invited %d as co-teacher of classroom %d",
        current_user.id, invitee.id, classroom_id,
    )
    return _classroom_teacher_to_response(ct)


@router.delete(
    "/classrooms/{classroom_id}/teachers/{teacher_id}",
    status_code=204,
    response_model=None,
)
def remove_co_teacher(
    classroom_id: int,
    teacher_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove a co-teacher from a classroom.

    The classroom owner can remove any co-teacher.
    A co-teacher can remove themselves (leave the classroom).
    The primary teacher (owner) cannot be removed via this endpoint.
    """
    classroom = _get_classroom_or_404(classroom_id, db)

    # Cannot remove the primary owner via this endpoint
    if teacher_id == classroom.teacher_id:
        raise HTTPException(
            status_code=400,
            detail="Cannot remove the classroom owner. Transfer ownership first.",
        )

    # Permission: owner, admin, or the co-teacher themselves
    # require_classroom_owner covers owner+admin; self-removal is a co-teaching-specific rule.
    is_self = teacher_id == current_user.id
    if not is_self:
        require_classroom_owner(classroom, current_user, db)

    ct = (
        db.query(ClassroomTeacher)
        .filter(
            ClassroomTeacher.classroom_id == classroom_id,
            ClassroomTeacher.teacher_id == teacher_id,
        )
        .first()
    )
    if ct is None:
        raise HTTPException(status_code=404, detail="Co-teacher not found in this classroom")

    db.delete(ct)
    db.commit()
    logger.info(
        "Removed teacher %d from classroom %d (by user %d)",
        teacher_id, classroom_id, current_user.id,
    )
    return None
