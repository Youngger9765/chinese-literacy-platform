"""Shared helpers, constants, and permission checks for the classrooms module."""
import logging
import secrets
import string

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user  # noqa: F401 — re-exported for convenience
from ...auth.policies import (
    require_classroom_member as _require_classroom_member,
    require_classroom_owner as _require_classroom_owner,
)
from ...models.assignment import Assignment, AssignmentSubmission
from ...models.school import Classroom, ClassroomStudent, ClassroomTeacher
from ...models.user import Role, User, UserRole
from ...schemas.classroom import ClassroomDetailResponse, ClassroomResponse, StudentInClassroomResponse

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

_JOIN_CODE_LENGTH = 6
_JOIN_CODE_CHARS = string.ascii_uppercase + string.digits
_JOIN_CODE_MAX_RETRIES = 10

_SYNTHETIC_EMAIL_DOMAIN = "student.lingoleap.local"


# ── Join Code ─────────────────────────────────────────────────────────────────


def generate_join_code(db: Session, length: int = _JOIN_CODE_LENGTH) -> str:
    """Generate a unique random join code for a classroom.

    Retries up to _JOIN_CODE_MAX_RETRIES times in case of collision.
    """
    for _ in range(_JOIN_CODE_MAX_RETRIES):
        code = "".join(secrets.choice(_JOIN_CODE_CHARS) for _ in range(length))
        existing = db.query(Classroom).filter(Classroom.join_code == code).first()
        if existing is None:
            return code
    raise HTTPException(
        status_code=500,
        detail="Failed to generate unique join code after multiple retries",
    )


# ── DB Fetch Helpers ──────────────────────────────────────────────────────────


def get_classroom_or_404(classroom_id: int, db: Session) -> Classroom:
    """Fetch a classroom by ID or raise 404."""
    classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
    if classroom is None:
        raise HTTPException(status_code=404, detail="Classroom not found")
    return classroom


# ── Permission Guards ─────────────────────────────────────────────────────────


def require_owner_or_admin(classroom: Classroom, current_user: User, db: Session) -> None:
    """Delegate to centralized policies. Kept for backwards compatibility."""
    _require_classroom_owner(classroom, current_user, db)


def require_member_or_admin(classroom: Classroom, current_user: User, db: Session) -> None:
    """Delegate to centralized policies. Kept for backwards compatibility."""
    _require_classroom_member(classroom, current_user, db)


def ensure_school_student_role(
    db: Session, user_id: int, school_id: int, granted_by: int | None = None
) -> None:
    """Grant an active `student` role scoped to `school_id`, if not already held.

    (#3804) Mirrors the role-granting block already duplicated in
    classroom_batch.py / classroom_csv.py / junyi_class_import_service.py for
    teacher-created students. The one path that was missing it entirely was
    self-service join-by-code (classroom_join.py) — a student who only ever
    went through Google/Junyi SSO + join-by-code ended up with ZERO UserRole
    rows, invisible to any "which school is this student in" query.
    Idempotent: safe to call even if the role already exists.
    """
    student_role = db.query(Role).filter(Role.name == "student").first()
    if student_role is None:
        return
    existing = (
        db.query(UserRole)
        .filter(
            UserRole.user_id == user_id,
            UserRole.role_id == student_role.id,
            UserRole.scope_type == "school",
            UserRole.scope_id == str(school_id),
            UserRole.is_active == True,  # noqa: E712
        )
        .first()
    )
    if existing is not None:
        return
    db.add(
        UserRole(
            user_id=user_id,
            role_id=student_role.id,
            scope_type="school",
            scope_id=str(school_id),
            granted_by=granted_by,
        )
    )
    db.flush()


# ── Email Helpers ─────────────────────────────────────────────────────────────


def is_synthetic_email(email: str) -> bool:
    """Return True for internally-generated synthetic student emails.

    Synthetic emails use the ``@student.lingoleap.local`` domain and are
    created by the batch / CSV import flows.  They should be exempt from
    school-domain validation because the school may not have a real domain
    configured yet.
    """
    return email.lower().endswith(f"@{_SYNTHETIC_EMAIL_DOMAIN}")


def check_email_domain(email: str, school_domain: str | None) -> str | None:
    """Validate that *email* belongs to *school_domain*.

    Returns a warning string if the domains do not match, otherwise None.
    Skips validation when:
    - school_domain is None / empty (school has no domain configured)
    - email is synthetic (``@student.lingoleap.local``)
    """
    if not school_domain:
        return None
    if is_synthetic_email(email):
        return None
    email_domain = email.split("@", 1)[-1].lower() if "@" in email else ""
    if email_domain != school_domain.lower().lstrip("@"):
        return f"學生 {email} 的 email 不屬於學校 domain ({school_domain})"
    return None


# ── Late-join Assignment Submissions ─────────────────────────────────────────


def create_submissions_for_new_student(
    classroom_id: int, student_id: int, db: Session
) -> int:
    """Create AssignmentSubmission records for active assignments the student missed.

    When a student joins a classroom after assignments have already been created,
    they won't have submission records. This helper back-fills them so the student
    can see and complete those assignments.

    Returns the number of submissions created.
    """
    active_assignments = (
        db.query(Assignment)
        .filter(
            Assignment.classroom_id == classroom_id,
            Assignment.is_active == True,
            # Issue #3393: only whole-class assignments back-fill late joiners.
            # A "part of the class" assignment (student_ids selected at creation)
            # must stay scoped to whoever the teacher picked at the time -- a
            # student enrolling afterwards was never selected for it.
            Assignment.assigned_to_all == True,
        )
        .all()
    )
    if not active_assignments:
        return 0

    # Fetch any existing submissions for this student in this classroom
    # (defensive: should be empty for a brand-new enrollment, but guard anyway)
    existing_assignment_ids = set(
        row[0]
        for row in db.query(AssignmentSubmission.assignment_id)
        .filter(
            AssignmentSubmission.student_id == student_id,
            AssignmentSubmission.assignment_id.in_(
                [a.id for a in active_assignments]
            ),
        )
        .all()
    )

    created = 0
    for assignment in active_assignments:
        if assignment.id in existing_assignment_ids:
            continue
        db.add(
            AssignmentSubmission(
                assignment_id=assignment.id,
                student_id=student_id,
                status="pending",
            )
        )
        created += 1

    if created:
        logger.info(
            "Created %d assignment submissions for late-joining student %d in classroom %d",
            created, student_id, classroom_id,
        )
    return created


# ── Response Converters ───────────────────────────────────────────────────────


def student_count(classroom: Classroom, db: Session) -> int:
    """Return the number of enrolled students via a COUNT query."""
    return (
        db.query(func.count(ClassroomStudent.student_id))
        .filter(ClassroomStudent.classroom_id == classroom.id)
        .scalar()
    )


def classroom_to_response(classroom: Classroom, db: Session) -> ClassroomResponse:
    """Convert a Classroom ORM object to a ClassroomResponse."""
    return ClassroomResponse(
        id=classroom.id,
        name=classroom.name,
        school_id=classroom.school_id,
        teacher_id=classroom.teacher_id,
        grade=classroom.grade,
        join_code=classroom.join_code,
        is_active=classroom.is_active,
        created_at=classroom.created_at,
        student_count=student_count(classroom, db),
    )


def classroom_to_detail_response(classroom: Classroom) -> ClassroomDetailResponse:
    """Convert a Classroom ORM object to a ClassroomDetailResponse with students."""
    students = [
        StudentInClassroomResponse(
            id=cs.student.id,
            name=cs.student.name,
            email=cs.student.email,
            enrolled_at=cs.enrolled_at,
        )
        for cs in classroom.classroom_students
    ]
    return ClassroomDetailResponse(
        id=classroom.id,
        name=classroom.name,
        school_id=classroom.school_id,
        teacher_id=classroom.teacher_id,
        grade=classroom.grade,
        join_code=classroom.join_code,
        is_active=classroom.is_active,
        created_at=classroom.created_at,
        student_count=len(students),
        students=students,
    )
