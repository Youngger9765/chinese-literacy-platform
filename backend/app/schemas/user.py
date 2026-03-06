from datetime import datetime

from pydantic import BaseModel


class UserRoleResponse(BaseModel):
    role_name: str
    role_display_name: str
    scope_type: str
    scope_id: str | None = None

    model_config = {"from_attributes": True}


class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    phone: str | None = None
    avatar_url: str | None = None
    is_active: bool
    email_verified: bool
    last_login_at: datetime | None = None
    created_at: datetime
    roles: list[UserRoleResponse] = []

    model_config = {"from_attributes": True}


class StudentProfileResponse(BaseModel):
    school_id: int
    student_number: str | None = None
    grade: int | None = None
    password_changed: bool

    model_config = {"from_attributes": True}
