"""
auth_registration_service.py — Registration flow for #1844.

Extracted from routes/auth.py. Handles:
- Student self-registration blocking
- Password strength enforcement
- User creation with email verification token
- Teacher school auto-creation/join and role assignment
- Domain restriction enforcement

The router in routes/auth.py calls these functions and handles
HTTP request/response details.
"""

import logging
import secrets

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..auth.password import hash_password
from ..config import settings
from ..models.user import User, UserRole, Role
from ..models.school import School
from ..services.input_sanitizer import sanitize_ai_input
from ..utils.password_validator import validate_password_strength

logger = logging.getLogger(__name__)

EMAIL_VERIFICATION_TOKEN_BYTES = 32


def enforce_password_strength(password: str) -> None:
    """Raise HTTP 422 with a Chinese error message if password is too weak."""
    result = validate_password_strength(password)
    if not result.is_valid:
        raise HTTPException(
            status_code=422,
            detail={"errors": result.errors},
        )


def block_student_self_registration(role: str | None) -> None:
    """Raise 403 if the requested role is 'student'.

    Students are created by teachers only (issue #457).
    This check is case-insensitive to guard against bypasses.
    """
    if role is not None and role.lower() == "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="學生帳號由老師建立，請聯繫你的老師取得帳號。",
        )


def validate_teacher_email_domain(school: School, email_domain: str) -> None:
    """Raise HTTP 403 if the school has domain restrictions and the teacher's
    domain is not in the allowed list.

    Issue #407: schools may configure `allowed_email_domains` to restrict
    which email domains teachers can use to join. Schools with no configured
    domains (None or empty list) accept any email domain.

    Args:
        school: The existing School record the teacher is trying to join.
        email_domain: Lowercase domain extracted from the teacher's email.

    Raises:
        HTTPException 403: if the domain is not in the allowed list.
    """
    allowed: list[str] | None = school.allowed_email_domains
    if not allowed:
        return

    allowed_lower = [d.lower() for d in allowed]
    if email_domain not in allowed_lower:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"您的 Email 網域（@{email_domain}）不在此學校的允許清單中。"
                "請聯繫學校管理員確認您的 Email 網域是否正確，或改用學校核准的 Email 地址註冊。"
            ),
        )


def assign_teacher_to_school(db: Session, user: User) -> None:
    """Auto-create a school for the teacher's email domain, or join an existing one.

    Per 方大哥's spec: if this is the first teacher from a school domain,
    the system auto-creates the school and makes the teacher the admin.
    Subsequent teachers with the same domain are added to the existing school.

    Issue #407: if the existing school has `allowed_email_domains` configured,
    the teacher's email domain must match; otherwise registration is rejected.
    """
    domain = user.email.split("@")[-1].lower()

    school = db.query(School).filter(School.domain == domain).first()

    if school is None:
        school = School(
            name=f"{domain} 學校",
            domain=domain,
            admin_user_id=user.id,
        )
        db.add(school)
        db.flush()
    else:
        validate_teacher_email_domain(school, domain)

    teacher_role = db.query(Role).filter(Role.name == "teacher").first()
    if teacher_role is not None:
        existing_role = (
            db.query(UserRole)
            .filter(
                UserRole.user_id == user.id,
                UserRole.role_id == teacher_role.id,
                UserRole.scope_type == "school",
                UserRole.scope_id == str(school.id),
            )
            .first()
        )
        if existing_role is None:
            user_role = UserRole(
                user_id=user.id,
                role_id=teacher_role.id,
                scope_type="school",
                scope_id=str(school.id),
            )
            db.add(user_role)


def create_teacher_user(
    db: Session,
    email: str,
    password: str,
    name: str | None,
) -> tuple[User, str | None]:
    """Create a new teacher user record and return (user, verification_token).

    Handles:
    - Name sanitization (AI injection prevention)
    - Password hashing
    - Email verification token generation (controlled by REQUIRE_EMAIL_VERIFICATION flag)
    - DB flush (without commit — caller commits after assigning school)

    Returns:
        (user, verification_token) where verification_token is None when
        REQUIRE_EMAIL_VERIFICATION=False (auto-verified).
    """
    safe_name, _ = sanitize_ai_input(name, user_id=email) if name else (name, False)

    require_verification = settings.require_email_verification

    if require_verification:
        verification_token: str | None = secrets.token_hex(EMAIL_VERIFICATION_TOKEN_BYTES)
        auto_verified = False
    else:
        verification_token = None
        auto_verified = True

    user = User(
        email=email,
        password_hash=hash_password(password),
        name=safe_name,
        email_verified=auto_verified,
        email_verification_token=verification_token,
    )
    db.add(user)
    db.flush()
    return user, verification_token
