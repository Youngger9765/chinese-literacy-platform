import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.jwt import create_access_token
from ..auth.password import hash_password, verify_password
from ..auth.rate_limiter import InMemoryRateLimiter
from ..config import settings
from ..database import get_db
from ..models.user import User, UserRole, Role
from ..models.school import School
from ..schemas.auth import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    GoogleLoginRequest,
    GoogleLoginResponse,
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
from ..utils.password_validator import validate_password_strength
from ..schemas.user import UserResponse

CURRENT_TERMS_VERSION = "1.0"

router = APIRouter(prefix="/auth", tags=["auth"])
rate_limiter = InMemoryRateLimiter()

PASSWORD_RESET_TOKEN_BYTES = 32
PASSWORD_RESET_EXPIRY_HOURS = 1
EMAIL_VERIFICATION_TOKEN_BYTES = 32


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


def _enforce_password_strength(password: str) -> None:
    """Raise HTTP 422 with a Chinese error message if password is too weak."""
    result = validate_password_strength(password)
    if not result.is_valid:
        raise HTTPException(
            status_code=422,
            detail={"errors": result.errors},
        )


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
    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.check(f"register:{client_ip}", max_requests=5, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")

    # Block student self-registration. Students are created by teachers only.
    if req.role is not None and req.role.lower() == "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="學生帳號由老師建立，請聯繫你的老師取得帳號。",
        )

    # Validate password strength before checking for duplicates
    _enforce_password_strength(req.password)

    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    verification_token = secrets.token_hex(EMAIL_VERIFICATION_TOKEN_BYTES)

    user = User(
        email=req.email,
        password_hash=hash_password(req.password),
        name=req.name,
        # Email verification is required before login (issue #460)
        email_verified=False,
        email_verification_token=verification_token,
    )
    db.add(user)
    db.flush()  # get user.id without committing yet

    # Auto-create or join school based on email domain (issue #459)
    _assign_teacher_to_school(db, user)

    db.commit()
    db.refresh(user)

    # TODO(production): send verification email here instead of returning token in response.
    # Example: send_email(to=user.email, subject="驗證您的 Email", body=f"請點擊連結驗證：/auth/verify-email?token={verification_token}")
    return RegisterResponse(
        message="註冊成功！請檢查 Email 並點擊驗證連結完成驗證。（測試模式下 token 直接回傳）",
        verification_token=verification_token,  # Dev/staging only — remove in production
    )


def _validate_teacher_email_domain(school: "School", email_domain: str) -> None:
    """Raise HTTP 403 if the school has domain restrictions and the teacher's domain
    is not in the allowed list.

    Issue #407: schools may configure `allowed_email_domains` to restrict which
    email domains teachers can use to join.  Schools with no configured domains
    (None or empty list) accept any email domain.

    Args:
        school: The existing School record the teacher is trying to join.
        email_domain: Lowercase domain extracted from the teacher's email.

    Raises:
        HTTPException 403: if the domain is not in the allowed list.
    """
    allowed: list[str] | None = school.allowed_email_domains
    if not allowed:
        # No restriction configured — any domain is welcome.
        return

    # Normalise list entries to lowercase for comparison.
    allowed_lower = [d.lower() for d in allowed]
    if email_domain not in allowed_lower:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"您的 Email 網域（@{email_domain}）不在此學校的允許清單中。"
                "請聯繫學校管理員確認您的 Email 網域是否正確，或改用學校核准的 Email 地址註冊。"
            ),
        )


def _assign_teacher_to_school(db: Session, user: User) -> None:
    """Auto-create a school for the teacher's email domain, or join an existing one.

    Per 方大哥's spec: if this is the first teacher from a school domain,
    the system auto-creates the school and makes the teacher the admin.
    Subsequent teachers with the same domain are added to the existing school.

    Issue #407: if the existing school has `allowed_email_domains` configured,
    the teacher's email domain must match; otherwise registration is rejected.
    """
    # Extract domain from email (e.g. "teacher@school.edu.tw" -> "school.edu.tw")
    domain = user.email.split("@")[-1].lower()

    # Check if a school with this domain already exists
    school = db.query(School).filter(School.domain == domain).first()

    if school is None:
        # First teacher from this domain: create the school (no domain restriction applies)
        school = School(
            name=f"{domain} 學校",
            domain=domain,
            admin_user_id=user.id,
        )
        db.add(school)
        db.flush()  # get school.id
    else:
        # Existing school found — validate domain restriction before joining (issue #407)
        _validate_teacher_email_domain(school, domain)

    # Assign teacher role scoped to this school
    teacher_role = db.query(Role).filter(Role.name == "teacher").first()
    if teacher_role is not None:
        # Avoid duplicate role assignment
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


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """Authenticate user and return JWT token.

    Accepts either an email address or a username in the `email` field.
    If the value contains '@', it is treated as an email; otherwise as a username.
    """
    client_ip = request.client.host if request.client else "unknown"
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

    # Require email verification before allowing login (issue #460).
    # Batch-created student accounts keep email_verified=True (they have no real email).
    if not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="請先驗證 Email。請檢查您的信箱並點擊驗證連結。",
        )

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()

    # Check if student needs to change their default password
    must_change = False
    if user.student_profile and not user.student_profile.password_changed:
        must_change = True

    token = create_access_token(user.id)
    return TokenResponse(access_token=token, must_change_password=must_change)


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

    # Validate new password strength
    _enforce_password_strength(req.new_password)

    current_user.password_hash = hash_password(req.new_password)

    # Mark student password as changed if they have a student profile
    if current_user.student_profile:
        current_user.student_profile.password_changed = True

    db.commit()
    return {"message": "Password updated successfully"}


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(req: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db)):
    """Initiate a password reset.

    Accepts email or username as `identifier`.
    Generates a reset token (expires in 1 hour) and stores it on the user record.

    P0 behaviour: token is returned in the response body.
    In production the token would be sent via email only and this field removed.
    """
    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.check(f"forgot-password:{client_ip}", max_requests=5, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")

    # Lookup by email or username
    if "@" in req.identifier:
        user = db.query(User).filter(User.email == req.identifier, User.is_active == True).first()
    else:
        user = db.query(User).filter(User.username == req.identifier, User.is_active == True).first()

    # Always return a success message to avoid user enumeration attacks.
    # We still generate and return the token so the flow can be tested without email.
    if user is None:
        # Return a plausible-looking token but do nothing in DB
        return ForgotPasswordResponse(
            message="若帳號存在，重設連結已產生（測試模式下直接回傳 token）。",
            reset_token="account-not-found",
        )

    reset_token = secrets.token_hex(PASSWORD_RESET_TOKEN_BYTES)
    user.password_reset_token = reset_token
    user.password_reset_expires = datetime.now(timezone.utc) + timedelta(hours=PASSWORD_RESET_EXPIRY_HOURS)
    db.commit()

    return ForgotPasswordResponse(
        message="密碼重設 token 已產生，請在 1 小時內使用。（正式環境將寄送至您的 Email）",
        reset_token=reset_token,
    )


@router.post("/reset-password", response_model=ResetPasswordResponse)
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Reset password using a valid reset token."""
    user = (
        db.query(User)
        .filter(User.password_reset_token == req.token, User.is_active == True)
        .first()
    )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="無效的重設 token，請重新申請密碼重設。",
        )

    now = datetime.now(timezone.utc)
    expires = user.password_reset_expires
    # Normalise to UTC-aware for comparison
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)

    if expires is None or now > expires:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="重設 token 已過期，請重新申請密碼重設。",
        )

    # Validate new password strength
    _enforce_password_strength(req.new_password)

    user.password_hash = hash_password(req.new_password)
    # Invalidate the token after use
    user.password_reset_token = None
    user.password_reset_expires = None
    db.commit()

    return ResetPasswordResponse(message="密碼已成功重設，請使用新密碼登入。")


@router.get("/verify-email", response_model=VerifyEmailResponse)
def verify_email_get(token: str, db: Session = Depends(get_db)):
    """Verify email address using a token from the verification link.

    This GET endpoint supports clicking a link from an email:
      GET /auth/verify-email?token=xxx

    Issue #460: token is generated at registration and (in production) emailed to the user.
    """
    user = (
        db.query(User)
        .filter(User.email_verification_token == token, User.is_active == True)
        .first()
    )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="無效的驗證 token。",
        )

    if user.email_verified:
        return VerifyEmailResponse(message="電子郵件已驗證。")

    user.email_verified = True
    user.email_verification_token = None
    db.commit()

    return VerifyEmailResponse(message="電子郵件驗證成功！現在可以登入了。")


@router.post("/verify-email", response_model=VerifyEmailResponse)
def verify_email(req: VerifyEmailRequest, db: Session = Depends(get_db)):
    """Verify email address using a verification token (POST variant for API clients).

    Issue #460: Also supports POST body for programmatic verification.
    """
    user = (
        db.query(User)
        .filter(User.email_verification_token == req.token, User.is_active == True)
        .first()
    )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="無效的驗證 token。",
        )

    if user.email_verified:
        return VerifyEmailResponse(message="電子郵件已驗證。")

    user.email_verified = True
    user.email_verification_token = None
    db.commit()

    return VerifyEmailResponse(message="電子郵件驗證成功！現在可以登入了。")


@router.post("/resend-verification")
def resend_verification(req: ResendVerificationRequest, request: Request, db: Session = Depends(get_db)):
    """Resend the email verification token.

    Issue #460: allows a user who hasn't verified yet to request a new token.
    Rate-limited to 5 requests per minute per IP.

    Dev/staging mode: returns the token directly. In production, this would send an email.
    """
    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.check(f"resend-verification:{client_ip}", max_requests=5, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")

    user = db.query(User).filter(User.email == req.email, User.is_active == True).first()

    # Always return a success message to prevent email enumeration.
    if user is None or user.email_verified:
        return {
            "message": "若帳號存在且尚未驗證，驗證信已重新發送。",
            "verification_token": None,
        }

    new_token = secrets.token_hex(EMAIL_VERIFICATION_TOKEN_BYTES)
    user.email_verification_token = new_token
    db.commit()

    # TODO(production): send verification email here instead of returning token.
    return {
        "message": "驗證信已重新發送。（測試模式下 token 直接回傳）",
        "verification_token": new_token,  # Dev/staging only — remove in production
    }



@router.post("/google", response_model=GoogleLoginResponse)
def google_login(req: GoogleLoginRequest, request: Request, db: Session = Depends(get_db)):
    """Authenticate (or register) a user via Google Sign-In credential (id_token).

    Flow:
    1. Verify the id_token with Google's public keys.
    2. If a user with matching google_id exists -> login.
    3. Else if a user with matching email exists -> link the Google account.
    4. Else -> create a new user account (email_verified=True, no password).
    """
    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.check(f"google-login:{client_ip}", max_requests=20, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")

    if not settings.google_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth is not configured on this server.",
        )

    # Verify the Google id_token
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests

        id_info = google_id_token.verify_oauth2_token(
            req.credential,
            google_requests.Request(),
            settings.google_client_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Google credential: {exc}",
        )

    google_sub = id_info["sub"]          # stable unique Google user ID
    email: str = id_info.get("email", "")
    name: str = id_info.get("name", "") or email.split("@")[0]
    picture: str | None = id_info.get("picture")

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google account does not expose an email address.",
        )

    is_new_user = False

    # 1. Look up by google_id (returning user)
    user = db.query(User).filter(User.google_id == google_sub, User.is_active == True).first()

    if user is None:
        # 2. Look up by email (link existing account)
        user = db.query(User).filter(User.email == email, User.is_active == True).first()
        if user is not None:
            _ensure_parent_login_allowed(user, db)
            user.google_id = google_sub
            if picture and not user.avatar_url:
                user.avatar_url = picture
        else:
            # 3. Create new account — no password (use a random unusable hash)
            unusable_hash = hash_password(secrets.token_hex(32))
            user = User(
                email=email,
                password_hash=unusable_hash,
                name=name,
                avatar_url=picture,
                google_id=google_sub,
                email_verified=True,  # Google already verified the email
            )
            db.add(user)
            is_new_user = True
    else:
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

    # Build roles for response
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
