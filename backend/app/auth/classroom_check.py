"""Classroom membership helpers — issue #457.

Extracted here (away from routes/auth.py) so both routes/auth.py and
routes/users.py can import without circular dependencies.
"""

from sqlalchemy.orm import Session

from ..models.school import ClassroomStudent
from ..models.user import UserRole, Role


def has_active_role(db: Session, user_id: int, role_name: str) -> bool:
    """Return True if the user has an active role with the given name."""
    return (
        db.query(UserRole)
        .join(Role, UserRole.role_id == Role.id)
        .filter(
            UserRole.user_id == user_id,
            UserRole.is_active == True,
            Role.name == role_name,
        )
        .first()
        is not None
    )


def compute_has_classroom(db: Session, user_id: int) -> bool:
    """Return True if user is not a student OR if they belong to at least one classroom.

    Issue #457: students who are not yet enrolled in any classroom should see a
    friendly waiting screen on the frontend instead of the full dashboard.
    Teachers, admins, and all other roles always return True (not gated).
    """
    is_student = has_active_role(db, user_id, "student")
    if not is_student:
        # Non-students (teachers, admins, parents, etc.) are never gated
        return True

    enrolled = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.student_id == user_id)
        .first()
    )
    return enrolled is not None
