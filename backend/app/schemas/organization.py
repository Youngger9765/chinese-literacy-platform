from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class OrganizationCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    display_name: str | None = None


class OrganizationUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    display_name: str | None = None
    is_active: bool | None = None


class OrganizationResponse(BaseModel):
    id: str
    name: str
    display_name: str | None = None
    is_active: bool
    created_at: datetime
    school_count: int = 0

    model_config = {"from_attributes": True}


class OrganizationDetailResponse(OrganizationResponse):
    """Organization with its schools listed."""
    schools: list[dict[str, Any]] = []


class OrganizationListResponse(BaseModel):
    items: list[OrganizationResponse]
    total: int
