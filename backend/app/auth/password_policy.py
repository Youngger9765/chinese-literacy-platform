"""Password-change policy helpers — issue #3438.

Shared between POST /auth/login, GET /users/me, and the get_current_user
enforcement gate so the three never drift out of sync on what "must change
password" means. Before this module existed, the same check
(`user.student_profile and not user.student_profile.password_changed`) was
duplicated inline in routes/auth.py's login() only -- /users/me never
computed it at all, and get_current_user had no concept of it.
"""

from ..models.user import User


def compute_must_change_password(user: User) -> bool:
    """Return True if this user must change their password before doing
    anything else.

    Only students carry a student_profile with a password_changed flag
    (teacher-issued batch credentials / teacher-reset passwords). Non-student
    accounts (teachers, admins, parents) have no student_profile and are
    never gated by this check.
    """
    return bool(user.student_profile and not user.student_profile.password_changed)
