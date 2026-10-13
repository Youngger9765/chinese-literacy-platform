"""Parent portal routes — invite codes and child progress access.

Endpoints:
  POST /api/parents/invite-codes          — Teacher generates invite code for a student
  GET  /api/parents/invite-codes/student/{id} — Teacher lists codes for a student
  POST /api/parents/link                  — Parent redeems code and links to student
  GET  /api/parents/children              — Parent lists their linked children
  GET  /api/parents/children/{id}/dashboard — Parent views child's progress dashboard
"""

import logging
import secrets
import string
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.parent_link import ParentInviteCode, ParentStudentLink
from ..models.school import Classroom, ClassroomStudent
from ..models.user import Role, User, UserRole
from ..routes.learning import DashboardResponse, get_student_dashboard

router = APIRouter(tags=["parents"])
logger = logging.getLogger(__name__)

_CODE_CHARS = string.ascii_uppercase + string.digits
_CODE_LENGTH = 8
_CODE_EXPIRY_DAYS = 30


# ── Helpers ──────────────────────────────────────────────────────────────────


def _generate_invite_code(db: Session) -> str:
    """Generate a unique 8-char alphanumeric invite code."""
    for _ in range(20):
        code = "".join(secrets.choice(_CODE_CHARS) for _ in range(_CODE_LENGTH))
        if not db.query(ParentInviteCode).filter(ParentInviteCode.code == code).first():
            return code
    raise HTTPException(status_code=500, detail="Failed to generate unique invite code")


def _is_teacher_of_student(teacher: User, student_id: int, db: Session) -> bool:
    """Return True if teacher teaches any classroom that the student is enrolled in."""
    return bool(
        db.query(Classroom)
        .join(ClassroomStudent, ClassroomStudent.classroom_id == Classroom.id)
        .filter(
            ClassroomStudent.student_id == student_id,
            Classroom.teacher_id == teacher.id,
        )
        .first()
    )


def _require_parent_link(parent: User, student_id: int, db: Session) -> ParentStudentLink:
    """Return the active link between parent and student, or raise 403."""
    link = (
        db.query(ParentStudentLink)
        .filter(
            ParentStudentLink.parent_id == parent.id,
            ParentStudentLink.student_id == student_id,
            ParentStudentLink.is_active == True,
        )
        .first()
    )
    if link is None:
        raise HTTPException(status_code=403, detail="Not linked to this student")
    return link


def _has_parent_role(user: User, db: Session) -> bool:
    """Return True if user has the 'parent' role."""
    return bool(
        db.query(UserRole)
        .join(Role, UserRole.role_id == Role.id)
        .filter(
            UserRole.user_id == user.id,
            Role.name == "parent",
            UserRole.is_active == True,
        )
        .first()
    )


def _grant_parent_role(user: User, db: Session) -> None:
    """Ensure the user has the 'parent' role (idempotent)."""
    if _has_parent_role(user, db):
        return
    role = db.query(Role).filter(Role.name == "parent").first()
    if role is None:
        # Auto-create the role if it doesn't exist yet (first-time setup)
        # Two first-ever parents can race here; the loser re-reads the row the
        # winner created instead of failing on the unique name.
        try:
            with db.begin_nested():
                role = Role(
                    name="parent",
                    display_name="家長",
                    scope_level="platform",
                    description="Parent — read-only access to linked children's progress",
                    is_active=True,
                )
                db.add(role)
                db.flush()
        except IntegrityError:
            role = db.query(Role).filter(Role.name == "parent").one()

    user_role = UserRole(
        user_id=user.id,
        role_id=role.id,
        scope_type="platform",
        scope_id=None,
        is_active=True,
    )
    db.add(user_role)
    db.flush()


# ── Schemas ──────────────────────────────────────────────────────────────────


class InviteCodeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    student_id: int
    student_name: str
    expires_at: datetime
    used: bool


class InviteCodeListResponse(BaseModel):
    items: list[InviteCodeResponse]


class RedeemCodeRequest(BaseModel):
    code: str


class LinkedChildResponse(BaseModel):
    student_id: int
    student_name: str
    linked_at: datetime


class LinkedChildrenResponse(BaseModel):
    children: list[LinkedChildResponse]


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.post("/parents/invite-codes", response_model=InviteCodeResponse, status_code=201)
def generate_invite_code(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Teacher generates a parent invite code for a specific student.

    Only teachers who teach the student can generate codes.
    """
    student = db.query(User).filter(User.id == student_id, User.is_active == True).first()
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found")

    if not _is_teacher_of_student(current_user, student_id, db):
        raise HTTPException(
            status_code=403,
            detail="You are not a teacher of this student",
        )

    code = _generate_invite_code(db)
    expires_at = datetime.now(timezone.utc) + timedelta(days=_CODE_EXPIRY_DAYS)

    invite = ParentInviteCode(
        code=code,
        student_id=student_id,
        created_by=current_user.id,
        expires_at=expires_at,
        used=False,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)

    logger.info(
        "Teacher %d generated parent invite code %s for student %d",
        current_user.id, code, student_id,
    )
    return InviteCodeResponse(
        id=invite.id,
        code=invite.code,
        student_id=invite.student_id,
        student_name=student.name,
        expires_at=invite.expires_at,
        used=invite.used,
    )


@router.get(
    "/parents/invite-codes/student/{student_id}",
    response_model=InviteCodeListResponse,
)
def list_invite_codes_for_student(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all invite codes a teacher has generated for a specific student."""
    student = db.query(User).filter(User.id == student_id, User.is_active == True).first()
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found")

    if not _is_teacher_of_student(current_user, student_id, db):
        raise HTTPException(status_code=403, detail="You are not a teacher of this student")

    codes = (
        db.query(ParentInviteCode)
        .filter(ParentInviteCode.student_id == student_id)
        .order_by(ParentInviteCode.created_at.desc())
        .all()
    )

    return InviteCodeListResponse(
        items=[
            InviteCodeResponse(
                id=c.id,
                code=c.code,
                student_id=c.student_id,
                student_name=student.name,
                expires_at=c.expires_at,
                used=c.used,
            )
            for c in codes
        ]
    )


@router.post("/parents/link", response_model=LinkedChildResponse, status_code=201)
def redeem_invite_code(
    payload: RedeemCodeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Parent redeems an invite code to link to a student.

    On success:
    - The invite code is marked as used.
    - A ParentStudentLink row is created (or re-activated if it already exists).
    - The parent role is granted to current_user if not already held.
    """
    now = datetime.now(timezone.utc)
    invite = (
        db.query(ParentInviteCode)
        .filter(ParentInviteCode.code == payload.code.upper().strip())
        .first()
    )
    if invite is None or invite.used:
        raise HTTPException(
            status_code=400,
            detail="Invalid, expired, or already-used invite code",
        )
    # Normalize expires_at for timezone-naive DB (e.g., SQLite in tests)
    expires_at = invite.expires_at
    if expires_at.tzinfo is None:
        now_cmp = now.replace(tzinfo=None)
    else:
        now_cmp = now
    if expires_at < now_cmp:
        raise HTTPException(
            status_code=400,
            detail="Invalid, expired, or already-used invite code",
        )

    # Prevent a student from linking to themselves
    if current_user.id == invite.student_id:
        raise HTTPException(status_code=400, detail="Students cannot link to themselves")

    # Mark invite as used
    invite.used = True
    invite.used_by = current_user.id
    invite.used_at = now_cmp

    # Create or re-activate link
    existing_link = (
        db.query(ParentStudentLink)
        .filter(
            ParentStudentLink.parent_id == current_user.id,
            ParentStudentLink.student_id == invite.student_id,
        )
        .first()
    )
    if existing_link:
        existing_link.is_active = True
        link = existing_link
    else:
        link = ParentStudentLink(
            parent_id=current_user.id,
            student_id=invite.student_id,
        )
        db.add(link)

    # Grant parent role
    _grant_parent_role(current_user, db)

    db.commit()
    db.refresh(link)

    student = db.query(User).filter(User.id == invite.student_id).first()
    logger.info(
        "Parent %d linked to student %d via invite code",
        current_user.id, invite.student_id,
    )
    return LinkedChildResponse(
        student_id=link.student_id,
        student_name=student.name if student else "Unknown",
        linked_at=link.linked_at,
    )


class StudentParentLink(BaseModel):
    link_id: int
    parent_name: str
    parent_email: str
    linked_at: datetime


def _require_teacher_of_student(teacher: User, student_id: int, db: Session) -> None:
    if not _is_teacher_of_student(teacher, student_id, db):
        raise HTTPException(status_code=403, detail="You are not a teacher of this student")


@router.get("/parents/students/{student_id}/links", response_model=list[StudentParentLink])
def list_student_parent_links(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """#3517: the student's teacher sees which parents are linked."""
    _require_teacher_of_student(current_user, student_id, db)
    rows = (
        db.query(ParentStudentLink, User)
        .join(User, User.id == ParentStudentLink.parent_id)
        .filter(ParentStudentLink.student_id == student_id, ParentStudentLink.is_active == True)  # noqa: E712
        .order_by(ParentStudentLink.linked_at)
        .all()
    )
    return [
        StudentParentLink(link_id=link.id, parent_name=parent.name or "", parent_email=parent.email or "", linked_at=link.linked_at)
        for link, parent in rows
    ]


@router.delete("/parents/students/{student_id}/links/{link_id}", status_code=204)
def revoke_student_parent_link(
    student_id: int,
    link_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """#3517: the student's teacher cuts a parent off; the parent loses access at once."""
    _require_teacher_of_student(current_user, student_id, db)
    link = (
        db.query(ParentStudentLink)
        .filter(ParentStudentLink.id == link_id, ParentStudentLink.student_id == student_id)
        .first()
    )
    if link is None:
        raise HTTPException(status_code=404, detail="Link not found")
    link.is_active = False
    db.commit()
    logger.info("Teacher %d revoked parent link %d (student %d)", current_user.id, link_id, student_id)


@router.get("/parents/children", response_model=LinkedChildrenResponse)
def list_linked_children(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all students linked to this parent account."""
    links = (
        db.query(ParentStudentLink)
        .filter(
            ParentStudentLink.parent_id == current_user.id,
            ParentStudentLink.is_active == True,
        )
        .all()
    )

    children = []
    for link in links:
        student = db.query(User).filter(User.id == link.student_id).first()
        if student:
            children.append(
                LinkedChildResponse(
                    student_id=link.student_id,
                    student_name=student.name,
                    linked_at=link.linked_at,
                )
            )

    return LinkedChildrenResponse(children=children)


@router.get("/parents/children/{student_id}/assignments")
def get_child_assignments(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The linked child's assignments (#3515): what the teacher assigned, due, done or not.

    Read-only; the parent must hold an active link to this child.
    """
    from .assignments import list_assignments_for_student

    _require_parent_link(current_user, student_id, db)
    return list_assignments_for_student(student_id, db)


@router.get("/parents/children/{student_id}/dashboard", response_model=DashboardResponse)
def get_child_dashboard(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return progress dashboard for a linked child. Read-only parent access."""
    _require_parent_link(current_user, student_id, db)
    return get_student_dashboard(student_id, current_user, db)
