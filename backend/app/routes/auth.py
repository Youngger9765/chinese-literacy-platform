"""
routes/auth.py — Thin HTTP boundary for auth endpoints (#1844).

Business logic extracted to focused service modules:
- auth_registration_service: register + school auto-assignment
- password_reset_service: forgot/reset password
- email_verification_service: verify email GET/POST + resend
- sso_login_service: Google + Junyi SSO

This file handles only:
- FastAPI router wiring
- Rate limiting (per-IP, HTTP concern)
- Request → service call → response shaping
- JWT token creation (auth concern, lives near the router)
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from ..auth.classroom_check import compute_has_classroom
from ..auth.dependencies import get_current_user
from ..auth.jwt import create_access_token
from ..auth.password import hash_password, verify_password
from ..auth.rate_limiter import InMemoryRateLimiter, real_client_ip
from ..config import settings
from ..database import get_db
from ..models.user import User, UserRole, Role
from ..schemas.auth import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    GoogleLoginRequest,
    GoogleLoginResponse,
    JunyiLoginRequest,
    JunyiLoginResponse,
    LoginRequest,
    RegisterRequest,
    RegisterResponse,
    ResendVerificationRequest,
    ResetPasswordRequest,
    ResetPasswordResponse,
    TokenResponse,
    VerifyEmailRequest,
    VerifyEmailResponse,
)
from ..schemas.user import UserResponse
from ..services.auth_registration_service import (
    assign_teacher_to_school,
    block_student_self_registration,
    create_teacher_user,
    enforce_password_strength,
)
from ..services.email_verification_service import (
    resend_verification_token,
    verify_email_by_token,
)
from ..services.password_reset_service import (
    apply_password_reset,
    generate_password_reset_token,
    lookup_user_by_identifier,
    validate_reset_token,
)
from ..services.sso_login_service import (
    exchange_junyi_code,
    resolve_google_user,
    resolve_junyi_user,
    verify_google_id_token,
)

CURRENT_TERMS_VERSION = "1.0"

router = APIRouter(prefix="/auth", tags=["auth"])
rate_limiter = InMemoryRateLimiter()


def _has_active_role(db: Session, user_id: int, role_name: str) -> bool:
    """Return whether the user has an active role with the given name."""
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


def _ensure_parent_login_allowed(user: User, db: Session) -> None:
    """Raise 403 when parent logins are temporarily disabled by feature flag."""
    if settings.parent_portal_enabled:
        return

    if _has_active_role(db, user.id, "parent"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="家長功能目前暫時關閉，請聯繫老師或管理員。",
        )


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
def register(req: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    """Register a new teacher account.

    This endpoint is for teacher self-registration only (issue #457).
    Student accounts must be created by teachers via classroom management
    (POST /classrooms/{id}/students or CSV upload).

    Email verification flow (issue #460):
    - Sets email_verified=False and generates a verification token.
    - Dev/staging mode: token is returned in the response body for easy testing.
    - Production: token should be emailed; remove 'verification_token' from response.
    """
    client_ip = real_client_ip(request)
    if not rate_limiter.check(f"register:{client_ip}", max_requests=5, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")

    block_student_self_registration(req.role)
    enforce_password_strength(req.password)

    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user, verification_token = create_teacher_user(
        db=db,
        email=req.email,
        password=req.password,
        name=req.name,
    )

    assign_teacher_to_school(db, user)
    db.commit()
    db.refresh(user)

    # TODO(production): when require_verification=True, send verification email here.
    if settings.require_email_verification:
        return RegisterResponse(
            message="註冊成功！請檢查 Email 並點擊驗證連結完成驗證。（測試模式下 token 直接回傳）",
            verification_token=verification_token if settings.is_dev else None,
        )
    return RegisterResponse(
        message="註冊成功！此環境帳號已自動驗證，請直接登入。",
        verification_token=None,
        auto_verified=True,
    )


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """Authenticate user and return JWT token.

    Accepts either an email address or a username in the `email` field.
    If the value contains '@', it is treated as an email; otherwise as a username.
    """
    client_ip = real_client_ip(request)
    if not rate_limiter.check(f"login:{client_ip}", max_requests=10, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")

    if "@" in req.email:
        user = db.query(User).filter(User.email == req.email, User.is_active == True).first()
    else:
        user = db.query(User).filter(User.username == req.email, User.is_active == True).first()

    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    _ensure_parent_login_allowed(user, db)

    if settings.require_email_verification and not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="請先驗證 Email。請檢查您的信箱並點擊驗證連結。",
        )

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()

    must_change = False
    if user.student_profile and not user.student_profile.password_changed:
        must_change = True

    has_classroom = compute_has_classroom(db, user.id)

    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        must_change_password=must_change,
        has_classroom=has_classroom,
    )


# ---------------------------------------------------------------------------
# Onboarding + Password change
# ---------------------------------------------------------------------------


@router.post("/complete-onboarding")
def complete_onboarding(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark the current user's onboarding as completed."""
    current_user.onboarding_completed = True
    db.commit()
    db.refresh(current_user)
    return {"message": "Onboarding completed", "onboarding_completed": True}


@router.post("/change-password")
def change_password(
    req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change the current user's password."""
    if not verify_password(req.old_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect",
        )

    enforce_password_strength(req.new_password)

    current_user.password_hash = hash_password(req.new_password)

    if current_user.student_profile:
        current_user.student_profile.password_changed = True

    db.commit()
    return {"message": "Password updated successfully"}


# ---------------------------------------------------------------------------
# Password Reset
# ---------------------------------------------------------------------------


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(req: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db)):
    """Initiate a password reset.

    Accepts email or username as `identifier`.
    Always returns HTTP 200 to prevent user enumeration.
    Dev mode: token returned in body. Production: send via email only.
    """
    client_ip = real_client_ip(request)
    if not rate_limiter.check(f"forgot-password:{client_ip}", max_requests=5, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")

    user = lookup_user_by_identifier(db, req.identifier)

    if user is None:
        return ForgotPasswordResponse(
            message="若帳號存在，重設連結已產生（測試模式下直接回傳 token）。",
            reset_token="account-not-found" if settings.is_dev else None,
        )

    reset_token = generate_password_reset_token(db, user)

    return ForgotPasswordResponse(
        message="密碼重設 token 已產生，請在 1 小時內使用。（正式環境將寄送至您的 Email）",
        reset_token=reset_token if settings.is_dev else None,
    )


@router.post("/reset-password", response_model=ResetPasswordResponse)
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Reset password using a valid reset token."""
    user = validate_reset_token(db, req.token)
    enforce_password_strength(req.new_password)
    apply_password_reset(db, user, req.new_password)
    return ResetPasswordResponse(message="密碼已成功重設，請使用新密碼登入。")


# ---------------------------------------------------------------------------
# Email Verification
# ---------------------------------------------------------------------------


@router.get("/verify-email", response_model=VerifyEmailResponse)
def verify_email_get(token: str, db: Session = Depends(get_db)):
    """Verify email address using a token from the verification link.

    GET /auth/verify-email?token=xxx
    Issue #460.
    """
    message = verify_email_by_token(db, token)
    return VerifyEmailResponse(message=message)


@router.post("/verify-email", response_model=VerifyEmailResponse)
def verify_email(req: VerifyEmailRequest, db: Session = Depends(get_db)):
    """Verify email address using a verification token (POST variant for API clients).

    Issue #460.
    """
    message = verify_email_by_token(db, req.token)
    return VerifyEmailResponse(message=message)


@router.post("/resend-verification")
def resend_verification(req: ResendVerificationRequest, request: Request, db: Session = Depends(get_db)):
    """Resend the email verification token.

    Issue #460. Rate-limited. Dev/staging mode: returns token directly.
    """
    client_ip = real_client_ip(request)
    if not rate_limiter.check(f"resend-verification:{client_ip}", max_requests=5, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")

    message, token = resend_verification_token(db, req.email)
    return {"message": message, "verification_token": token}


# ---------------------------------------------------------------------------
# SSO — Google + Junyi
# ---------------------------------------------------------------------------


@router.post("/google", response_model=GoogleLoginResponse)
def google_login(req: GoogleLoginRequest, request: Request, db: Session = Depends(get_db)):
    """Authenticate (or register) a user via Google Sign-In credential (id_token).

    Flow:
    1. Verify the id_token with Google's public keys.
    2. If a user with matching google_id exists -> login.
    3. Else if a user with matching email exists -> link the Google account.
    4. Else -> create a new user account (email_verified=True, no password).
    """
    client_ip = real_client_ip(request)
    if not rate_limiter.check(f"google-login:{client_ip}", max_requests=20, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")

    id_info = verify_google_id_token(req.credential)
    user, is_new_user = resolve_google_user(db, id_info)

    _ensure_parent_login_allowed(user, db)

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    return GoogleLoginResponse(access_token=token, is_new_user=is_new_user)


@router.post("/accept-terms", response_model=UserResponse)
def accept_terms(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record that the current user has accepted the terms of service."""
    current_user.terms_accepted_at = datetime.now(timezone.utc)
    current_user.terms_version = CURRENT_TERMS_VERSION
    db.commit()
    db.refresh(current_user)

    from ..models.user import UserRole, Role as RoleModel
    from ..schemas.user import UserRoleResponse

    user_roles = (
        db.query(UserRole, RoleModel)
        .join(RoleModel, UserRole.role_id == RoleModel.id)
        .filter(UserRole.user_id == current_user.id, UserRole.is_active == True)
        .all()
    )
    roles = [
        UserRoleResponse(
            role_name=role.name,
            role_display_name=role.display_name,
            scope_type=ur.scope_type,
            scope_id=ur.scope_id,
        )
        for ur, role in user_roles
    ]

    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        name=current_user.name,
        phone=current_user.phone,
        avatar_url=current_user.avatar_url,
        is_active=current_user.is_active,
        email_verified=current_user.email_verified,
        last_login_at=current_user.last_login_at,
        terms_accepted_at=current_user.terms_accepted_at,
        terms_version=current_user.terms_version,
        created_at=current_user.created_at,
        roles=roles,
    )


@router.post("/junyi", response_model=JunyiLoginResponse)
def junyi_login(req: JunyiLoginRequest, request: Request, db: Session = Depends(get_db)):
    """Authenticate (or register) a user via Junyi SSO auth code (issue #1198).

    Flow (mirrors jutor.ai reference implementation):
    1. Exchange the one-time code with Junyi's /api/v2/auth/code endpoint.
    2. If a user with matching junyi_identity_id exists -> login.
    3. Else if a user with matching email exists -> link junyi_identity_id + login.
    4. Else -> create a new user account (student role, email_verified=True).

    The code is single-use with a 600s TTL (enforced by Junyi's backend).
    """
    client_ip = real_client_ip(request)
    if not rate_limiter.check(f"junyi-login:{client_ip}", max_requests=20, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")

    junyi_data = exchange_junyi_code(req.code)
    user, is_new_user = resolve_junyi_user(db, junyi_data)

    _ensure_parent_login_allowed(user, db)

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    logger.info(
        "junyi_login: user_id=%s junyi_identity_id=%s is_new=%s",
        user.id,
        junyi_data["userId"],
        is_new_user,
    )
    return JunyiLoginResponse(access_token=token, is_new_user=is_new_user)
