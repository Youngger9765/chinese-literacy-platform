from datetime import datetime

from pydantic import BaseModel, model_validator


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
    onboarding_completed: bool = False
    last_login_at: datetime | None = None
    terms_accepted_at: datetime | None = None
    terms_version: str | None = None
    terms_accepted: bool = False
    created_at: datetime
    roles: list[UserRoleResponse] = []

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def compute_terms_accepted(self) -> "UserResponse":
        self.terms_accepted = self.terms_accepted_at is not None
        return self


class UserProfileUpdateRequest(BaseModel):
    """Request body for PATCH /users/me. All fields are optional;
    only provided (non-None) fields will be updated."""

    name: str | None = None
    avatar_url: str | None = None

    model_config = {"json_schema_extra": {"example": {"name": "新名字"}}}


class StudentProfileResponse(BaseModel):
    school_id: int
    student_number: str | None = None
    grade: int | None = None
    password_changed: bool

    model_config = {"from_attributes": True}
