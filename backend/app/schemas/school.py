from datetime import datetime

from pydantic import BaseModel, Field


class SchoolCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    organization_id: str | None = None
    address: str | None = None
    phone: str | None = None


class SchoolUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    display_name: str | None = None
    address: str | None = None
    phone: str | None = None
    is_active: bool | None = None


class SchoolResponse(BaseModel):
    id: int
    name: str
    display_name: str | None = None
    organization_id: str | None = None
    address: str | None = None
    phone: str | None = None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SchoolListResponse(BaseModel):
    items: list[SchoolResponse]
    total: int
