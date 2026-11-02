from datetime import datetime

from pydantic import BaseModel, Field


class SchoolClassroomResponse(BaseModel):
    """Classroom summary for school detail view (includes teacher name)."""

    id: int
    name: str
    grade: int | None
    is_active: bool
    teacher_id: int
    teacher_name: str
    student_count: int
    created_at: datetime


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
    join_code: str | None = None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SchoolListResponse(BaseModel):
    items: list[SchoolResponse]
    total: int


# -- MOE school directory search (#3804 §4.2) ---------------------------------
# Deliberately a narrower field set than SchoolResponse: join_code must never
# be exposed on a directory-search endpoint open to any authenticated caller
# (it is a credential for joining THAT school, not public directory metadata —
# see schools.py list_schools()'s note on this same exposure concern).


class SchoolDirectoryItem(BaseModel):
    id: int
    moe_school_code: str
    name: str
    county_name: str | None = None
    school_level: str | None = None
    is_public: bool | None = None

    model_config = {"from_attributes": True}


class SchoolNameSuggestion(BaseModel):
    school_name: str
    reason: str


class SchoolDirectorySearchResponse(BaseModel):
    items: list[SchoolDirectoryItem]
    total: int
    # Only populated when `q` was given and fuzzy matching found 0 results —
    # see app/services/moe_school_suggest.py. None (not []) when the LLM
    # suggestion step was never attempted (q omitted, or fuzzy already found
    # matches); [] when it was attempted but found or returned nothing.
    suggestions: list[SchoolNameSuggestion] | None = None
