"""Shared helpers, constants, and permission checks for the classrooms module."""
import logging
import secrets
import string

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user  # noqa: F401 — re-exported for convenience
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
    """Allow classroom teacher (primary) OR system/org admin. Raise 403 otherwise.

    For co-teachers (assistants) use require_member_or_admin which also allows assistants.
    """
    if classroom.teacher_id == current_user.id:
        return
    admin_role = (
        db.query(UserRole)
        .join(Role)
        .filter(
            UserRole.user_id == current_user.id,
            UserRole.is_active == True,
            Role.name.in_(["system_admin", "org_admin"]),
        )
        .first()
    )
    if admin_role:
        return
    raise HTTPException(status_code=403, detail="Not your classroom")


def require_member_or_admin(classroom: Classroom, current_user: User, db: Session) -> None:
    """Allow classroom owner, co-teachers (assistants), or system/org admins.

    Used for read-only endpoints like viewing student progress.
    """
    if classroom.teacher_id == current_user.id:
        return
    ct = (
        db.query(ClassroomTeacher)
        .filter(
            ClassroomTeacher.classroom_id == classroom.id,
            ClassroomTeacher.teacher_id == current_user.id,
        )
        .first()
    )
    if ct:
        return
    admin_role = (
        db.query(UserRole)
        .join(Role)
        .filter(
            UserRole.user_id == current_user.id,
            UserRole.is_active == True,
            Role.name.in_(["system_admin", "org_admin"]),
        )
        .first()
    )
    if admin_role:
        return
    raise HTTPException(status_code=403, detail="Not your classroom")


def is_admin(user_id: int, db: Session) -> bool:
    """Check if a user has system_admin or org_admin role."""
    return (
        db.query(UserRole)
        .join(Role)
        .filter(
            UserRole.user_id == user_id,
            UserRole.is_active == True,
            Role.name.in_(["system_admin", "org_admin"]),
        )
        .first()
    ) is not None


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
