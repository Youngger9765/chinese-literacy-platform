"""Pydantic schemas for admin user management endpoints."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserRoleItem(BaseModel):
    """Compact role representation for user list views."""

    role_name: str
    scope_type: str
    scope_id: str | None = None

    model_config = ConfigDict(from_attributes=True)


class UserListItem(BaseModel):
    """User summary for admin list endpoint."""

    id: int
    email: str
    name: str
    is_active: bool
    created_at: datetime
    roles: list[UserRoleItem] = []

    model_config = ConfigDict(from_attributes=True)


class UserListResponse(BaseModel):
    """Paginated response for GET /api/users."""

    items: list[UserListItem]
    total: int


class UserDetailResponse(BaseModel):
    """Full user detail for admin GET /api/users/{user_id}."""

    id: int
    email: str
    name: str
    phone: str | None = None
    avatar_url: str | None = None
    is_active: bool
    email_verified: bool
    last_login_at: datetime | None = None
    created_at: datetime
    roles: list[UserRoleItem] = []

    model_config = ConfigDict(from_attributes=True)


class SchoolMemberResponse(BaseModel):
    """A user with a role scoped to a school."""

    user_id: int
    name: str
    email: str
    role_name: str
    role_display_name: str

    model_config = ConfigDict(from_attributes=True)
