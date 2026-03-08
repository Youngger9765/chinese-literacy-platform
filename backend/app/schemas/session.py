from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SessionCreateRequest(BaseModel):
    story_slug: str = Field(..., min_length=1, max_length=100)
    story_title: str | None = Field(None, max_length=200)


class SessionUpdateRequest(BaseModel):
    current_step: int | None = Field(None, ge=1, le=6)
    status: str | None = Field(None, pattern=r"^(in_progress|completed|abandoned)$")
    accuracy: float | None = Field(None, ge=0, le=100)
    overall_score: float | None = Field(None, ge=0, le=100)
    reading_result: dict[str, Any] | None = None
    comprehension_result: dict[str, Any] | None = None
    vocab_result: dict[str, Any] | None = None
    full_reading_result: dict[str, Any] | None = None
    completed_at: datetime | None = None


class SessionSummaryResponse(BaseModel):
    id: int
    story_slug: str | None
    status: str
    current_step: int
    accuracy: float | None
    overall_score: float | None
    started_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class SessionDetailResponse(SessionSummaryResponse):
    reading_result: dict[str, Any] | None
    comprehension_result: dict[str, Any] | None
    vocab_result: dict[str, Any] | None
    full_reading_result: dict[str, Any] | None
    # 3-level comprehension scoring (Issue #243)
    comprehension_score: float | None = None
    literal_score: float | None = None
    inferential_score: float | None = None
    evaluative_score: float | None = None
    comprehension_feedback: str | None = None


class SessionListResponse(BaseModel):
    items: list[SessionSummaryResponse]
    total: int


class SessionStatusResponse(BaseModel):
    """Lightweight response for session resume check."""
    id: int
    story_slug: str | None
    current_step: int
    status: str
    is_resumable: bool
    is_completed: bool
    started_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class ComprehensionScoreResponse(BaseModel):
    comprehension_score: float = Field(..., ge=0, le=100)
    literal_score: float = Field(..., ge=0, le=100)
    inferential_score: float = Field(..., ge=0, le=100)
    evaluative_score: float = Field(..., ge=0, le=100)
    feedback: dict[str, str] = Field(default_factory=dict)
