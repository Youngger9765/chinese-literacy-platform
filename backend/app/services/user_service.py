from sqlalchemy.orm import Session

from ..auth.password import hash_password
from ..models.user import User, UserRole, Role, StudentProfile


def create_user(db: Session, email: str, password: str, name: str) -> User:
    """Create a new user."""
    user = User(
        email=email,
        password_hash=hash_password(password),
        name=name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_user_by_email(db: Session, email: str) -> User | None:
    """Get a user by email address."""
    return db.query(User).filter(User.email == email).first()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    """Get a user by ID."""
    return db.query(User).filter(User.id == user_id).first()


def assign_role(
    db: Session,
    user_id: int,
    role_name: str,
    scope_type: str,
    scope_id: str | None = None,
    granted_by: int | None = None,
) -> UserRole:
    """Assign a role to a user."""
    role = db.query(Role).filter(Role.name == role_name).first()
    if not role:
        raise ValueError(f"Role '{role_name}' not found")

    user_role = UserRole(
        user_id=user_id,
        role_id=role.id,
        scope_type=scope_type,
        scope_id=scope_id,
        granted_by=granted_by,
    )
    db.add(user_role)
    db.commit()
    db.refresh(user_role)
    return user_role


def get_user_roles(db: Session, user_id: int) -> list[tuple[UserRole, Role]]:
    """Get all active roles for a user."""
    return (
        db.query(UserRole, Role)
        .join(Role, UserRole.role_id == Role.id)
        .filter(UserRole.user_id == user_id, UserRole.is_active == True)
        .all()
    )
