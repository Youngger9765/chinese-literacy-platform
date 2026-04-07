from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SessionCreateRequest(BaseModel):
    story_slug: str = Field(..., min_length=1, max_length=100)
    story_title: str | None = Field(None, max_length=200)


class SessionUpdateRequest(BaseModel):
    current_step: int | None = Field(None, ge=1, le=50)
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
    story_title: str | None = None  # human-readable title, e.g. "第六課 牛頓的故事"
    learning_source: str | None = None  # "self" | "assignment"
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


# ── Step Progress (Issue #660) ────────────────────────────────────────────────

class StepProgressSaveRequest(BaseModel):
    """Body for PUT /api/learning/sessions/{id}/progress.

    Fields mirror the localStorage schema so the frontend can send
    the same object it writes to localStorage.
    """
    current_step: str | None = Field(None, description="Active step path, e.g. 'vocab-definition'")
    steps_completed: list[str] = Field(default_factory=list, description="List of completed step path keys")
    step_data: dict[str, Any] = Field(default_factory=dict, description="Per-step serialised progress data")


class StepProgressResponse(BaseModel):
    """Response for GET /api/learning/sessions/{id}/progress."""
    session_id: int
    step_progress: dict[str, Any] | None

    model_config = {"from_attributes": True}
