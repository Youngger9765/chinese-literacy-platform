from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.jwt import create_access_token
from ..auth.password import hash_password, verify_password
from ..auth.rate_limiter import InMemoryRateLimiter
from ..database import get_db
from ..models.user import User
from ..schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])
rate_limiter = InMemoryRateLimiter()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(req: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    """Register a new user account."""
    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.check(f"register:{client_ip}", max_requests=5, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")

    existing = db.query(User).filter(User.email == req.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = User(
        email=req.email,
        password_hash=hash_password(req.password),
        name=req.name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


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

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()

    # Check if student needs to change their default password
    must_change = False
    if user.student_profile and not user.student_profile.password_changed:
        must_change = True

    token = create_access_token(user.id)
    return TokenResponse(access_token=token, must_change_password=must_change)


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

    current_user.password_hash = hash_password(req.new_password)

    # Mark student password as changed if they have a student profile
    if current_user.student_profile:
        current_user.student_profile.password_changed = True

    db.commit()
    return {"message": "Password updated successfully"}
