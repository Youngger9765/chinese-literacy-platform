"""Co-teaching API — invite / accept / change role / remove co-teachers.

Permission model (#3820):
  - Only the classroom owner (primary teacher) or admin can invite, change a
    co-teacher's role, or remove a co-teacher.
  - A co-teacher is one of:
      - 'editor'  — full read/write parity with the owner for day-to-day
                     classroom operations (students, settings, assignments,
                     password resets). Equivalent to the old 'assistant'.
      - 'viewer'  — read-only: can see the classroom, student list,
                     assignments, and reports, but cannot write anything.
  - An invited co-teacher starts as status='pending' and has NO access to the
    classroom at all until they accept. There is no persisted 'rejected'
    state -- rejecting a pending invite (or revoking it, or leaving later) is
    the same DELETE endpoint, just invoked by a different actor.
"""
import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.policies import (
    require_classroom_member,
    require_classroom_owner,
)
from ..database import get_db
from ..models.school import Classroom, ClassroomTeacher
from ..models.user import User
from .classrooms import _get_classroom_or_404

router = APIRouter(tags=["co-teaching"])
logger = logging.getLogger(__name__)

CoTeacherRole = Literal["editor", "viewer"]


# ── Schemas ───────────────────────────────────────────────────────────────────


class ClassroomTeacherResponse(BaseModel):
    id: int
    classroom_id: int
    teacher_id: int
    teacher_name: str
    teacher_email: str
    role: str  # "primary" | "editor" | "viewer"
    status: str  # "pending" | "accepted"
    invited_at: str
    accepted_at: str | None = None

    model_config = {"from_attributes": True}


class InviteTeacherRequest(BaseModel):
    email: EmailStr
    role: CoTeacherRole


class UpdateCoTeacherRoleRequest(BaseModel):
    role: CoTeacherRole


class PendingInvitationResponse(BaseModel):
    classroom_teacher_id: int  # ClassroomTeacher.id — informational, NOT a path param
    classroom_id: int
    teacher_id: int  # == current_user.id; this is what accept/DELETE take in the URL
    classroom_name: str
    role: str
    invited_by_name: str
    invited_at: str


def _classroom_teacher_to_response(ct: ClassroomTeacher) -> ClassroomTeacherResponse:
    return ClassroomTeacherResponse(
        id=ct.id,
        classroom_id=ct.classroom_id,
        teacher_id=ct.teacher_id,
        teacher_name=ct.teacher.name,
        teacher_email=ct.teacher.email,
        role=ct.role,
        status=ct.status,
        invited_at=ct.invited_at.isoformat(),
        accepted_at=ct.accepted_at.isoformat() if ct.accepted_at else None,
    )


def _get_co_teacher_row_or_404(classroom_id: int, teacher_id: int, db: Session) -> ClassroomTeacher:
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
    return ct


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
    """List all teachers (owner + co-teachers, pending and accepted) for a classroom.

    Accessible by the owner, any ACCEPTED co-teacher (editor or viewer), and
    admins -- a still-pending invitee is not a member yet (#3820) and cannot
    reach this endpoint; they see their own invitation via
    ``GET /co-teaching/invitations`` instead.
    """
    classroom = _get_classroom_or_404(classroom_id, db)
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
    """Invite a teacher to co-manage a classroom by email, as 'editor' or 'viewer'.

    Only the classroom owner or admin can invite. The invited user must
    already have an active account. The invitation is created with
    status='pending' and only takes effect once the invitee accepts it via
    ``POST .../teachers/{teacher_id}/accept`` (#3820).
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

    # Check for duplicate invite (pending or already-accepted — either way
    # a new invite would collide with the existing row's unique constraint).
    existing = (
        db.query(ClassroomTeacher)
        .filter(
            ClassroomTeacher.classroom_id == classroom_id,
            ClassroomTeacher.teacher_id == invitee.id,
        )
        .first()
    )
    if existing:
        detail = (
            "This teacher already has a pending invitation to this classroom"
            if existing.status == "pending"
            else "This teacher is already a member of the classroom"
        )
        raise HTTPException(status_code=409, detail=detail)

    ct = ClassroomTeacher(
        classroom_id=classroom_id,
        teacher_id=invitee.id,
        role=payload.role,
        status="pending",
        invited_by=current_user.id,
    )
    db.add(ct)
    db.commit()
    db.refresh(ct)
    logger.info(
        "Teacher %d invited %d as %s (pending) co-teacher of classroom %d",
        current_user.id, invitee.id, payload.role, classroom_id,
    )
    return _classroom_teacher_to_response(ct)


@router.patch(
    "/classrooms/{classroom_id}/teachers/{teacher_id}",
    response_model=ClassroomTeacherResponse,
)
def update_co_teacher_role(
    classroom_id: int,
    teacher_id: int,
    payload: UpdateCoTeacherRoleRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change a co-teacher's role between 'editor' and 'viewer'.

    Owner or admin only. Works regardless of whether the invitation is still
    'pending' or already 'accepted' -- the role change takes effect
    immediately either way (#3820). The primary owner's row cannot be
    retargeted through this endpoint.
    """
    classroom = _get_classroom_or_404(classroom_id, db)
    require_classroom_owner(classroom, current_user, db)

    ct = _get_co_teacher_row_or_404(classroom_id, teacher_id, db)
    if ct.role == "primary":
        raise HTTPException(status_code=400, detail="Cannot change the owner's role")

    ct.role = payload.role
    db.commit()
    db.refresh(ct)
    logger.info(
        "Changed teacher %d's role to %s in classroom %d (by user %d)",
        teacher_id, payload.role, classroom_id, current_user.id,
    )
    return _classroom_teacher_to_response(ct)


@router.post(
    "/classrooms/{classroom_id}/teachers/{teacher_id}/accept",
    response_model=ClassroomTeacherResponse,
)
def accept_co_teacher_invitation(
    classroom_id: int,
    teacher_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Accept a pending co-teaching invitation.

    Only the invitee themselves can accept their own invitation. The
    invitation must still be 'pending' -- the only action available for an
    unwanted invite is to DELETE it (reject), not accept-then-undo (#3820).
    """
    if current_user.id != teacher_id:
        raise HTTPException(
            status_code=403,
            detail="Only the invited teacher can accept this invitation",
        )

    # 404 if the classroom itself doesn't exist, before touching the invite row.
    _get_classroom_or_404(classroom_id, db)
    ct = _get_co_teacher_row_or_404(classroom_id, teacher_id, db)
    if ct.status != "pending":
        raise HTTPException(status_code=409, detail="This invitation is not pending")

    ct.status = "accepted"
    ct.accepted_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(ct)
    logger.info(
        "Teacher %d accepted co-teaching invitation for classroom %d",
        teacher_id, classroom_id,
    )
    return _classroom_teacher_to_response(ct)


@router.get(
    "/co-teaching/invitations",
    response_model=list[PendingInvitationResponse],
)
def list_my_pending_invitations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List the current user's own pending co-teaching invitations (any classroom).

    A pending invitee has no read access to the classroom yet (#3820), so
    this is the only way they can discover it in order to accept or reject.
    """
    rows = (
        db.query(ClassroomTeacher, Classroom)
        .join(Classroom, Classroom.id == ClassroomTeacher.classroom_id)
        .filter(
            ClassroomTeacher.teacher_id == current_user.id,
            ClassroomTeacher.status == "pending",
        )
        .all()
    )
    results = []
    for ct, classroom in rows:
        inviter = db.query(User).filter(User.id == ct.invited_by).first() if ct.invited_by else None
        results.append(
            PendingInvitationResponse(
                classroom_teacher_id=ct.id,
                classroom_id=classroom.id,
                teacher_id=ct.teacher_id,
                classroom_name=classroom.name,
                role=ct.role,
                invited_by_name=inviter.name if inviter else "",
                invited_at=ct.invited_at.isoformat(),
            )
        )
    return results


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
    """Remove a co-teacher from a classroom -- this is also how reject/revoke/leave work.

    - The classroom owner can revoke a pending invite or remove an accepted co-teacher.
    - A co-teacher can remove themselves: reject (while pending) or leave (once accepted).
    - The primary teacher (owner) cannot be removed via this endpoint.
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

    ct = _get_co_teacher_row_or_404(classroom_id, teacher_id, db)

    db.delete(ct)
    db.commit()
    logger.info(
        "Removed teacher %d from classroom %d (by user %d)",
        teacher_id, classroom_id, current_user.id,
    )
    return None
