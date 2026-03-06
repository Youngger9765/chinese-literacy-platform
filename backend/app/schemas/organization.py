from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class OrganizationCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    display_name: str | None = None
    teacher_limit: int | None = None
    description: str | None = None
    tax_id: str | None = Field(None, max_length=20)
    contact_email: str | None = None
    contact_phone: str | None = None
    address: str | None = None
    settings: dict | None = None


class OrganizationUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    display_name: str | None = None
    is_active: bool | None = None
    teacher_limit: int | None = None
    description: str | None = None
    tax_id: str | None = Field(None, max_length=20)
    contact_email: str | None = None
    contact_phone: str | None = None
    address: str | None = None
    settings: dict | None = None


class OrganizationResponse(BaseModel):
    id: str
    name: str
    display_name: str | None = None
    teacher_limit: int | None = None
    is_active: bool
    created_at: datetime
    school_count: int = 0
    description: str | None = None
    tax_id: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    address: str | None = None
    settings: dict | None = None

    model_config = {"from_attributes": True}


class OrganizationDetailResponse(OrganizationResponse):
    """Organization with its schools listed."""
    schools: list[dict[str, Any]] = []


class OrganizationListResponse(BaseModel):
    items: list[OrganizationResponse]
    total: int
