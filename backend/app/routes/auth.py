from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.jwt import create_access_token
from ..auth.password import hash_password, verify_password
from ..database import get_db
from ..models.user import Role, User, UserRole
from ..schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    """Register a new user account."""
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

    # Auto-assign 'teacher' role (temporary default until role selection during registration)
    teacher_role = db.query(Role).filter(Role.name == "teacher").first()
    if teacher_role:
        user_role = UserRole(
            user_id=user.id,
            role_id=teacher_role.id,
            scope_type="platform",
            scope_id=None,
            granted_by=None,
        )
        db.add(user_role)
        db.commit()

    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate user and return JWT token."""
    user = db.query(User).filter(User.email == req.email, User.is_active == True).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()

    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


@router.post("/change-password")
def change_password(
    req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change the current user's password."""
    if not verify_password(req.old_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    current_user.password_hash = hash_password(req.new_password)
    db.commit()
    return {"message": "Password updated successfully"}
