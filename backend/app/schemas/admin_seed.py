"""Pydantic schemas for the admin demo-seed endpoint (Issue #989 minimal version).

Only the completed-profile demo scenario is covered here.
Full spec (quality distribution, per-step data, AI analysis) is post-demo work.
"""
from pydantic import BaseModel, Field


class DemoStudentSeedRequest(BaseModel):
    classroom_id: int = Field(..., description="Target classroom ID")
    count: int = Field(default=3, ge=1, le=10, description="Number of demo students to create")
    prefix: str = Field(default="demo", max_length=20, description="Email prefix (e.g. 'demo' → demo01@testdata.lingoleap.dev)")


class SeededStudentInfo(BaseModel):
    user_id: int
    email: str
    name: str
    session_id: int


class DemoStudentSeedResponse(BaseModel):
    classroom_id: int
    students_created: int
    sessions_created: int
    students: list[SeededStudentInfo]
    story_slug: str | None
    note: str
