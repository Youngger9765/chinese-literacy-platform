from datetime import datetime

from pydantic import BaseModel


class RoleResponse(BaseModel):
    id: int
    name: str
    display_name: str
    scope_level: str

    model_config = {"from_attributes": True}


class UserRoleAssignRequest(BaseModel):
    user_id: int
    role_name: str  # e.g. 'teacher', 'student'
    scope_type: str  # 'platform', 'organization', 'school'
    scope_id: str | None = None


class UserRoleDetailResponse(BaseModel):
    id: int
    user_id: int
    role_id: int
    role_name: str
    role_display_name: str
    scope_type: str
    scope_id: str | None = None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
