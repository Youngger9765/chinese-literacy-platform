from datetime import datetime
from typing import Any, Literal
import logging

from pydantic import BaseModel, Field, ValidationError, model_validator

logger = logging.getLogger(__name__)


# ── StepProgressData — canonical shape of the step_progress JSONB column ─────

class StepProgressData(BaseModel):
    """Pydantic model for the expected shape of LearningSession.step_progress.

    Used to explicitly validate JSONB on read, replacing silent isinstance() fallbacks.
    When validation fails a WARNING is logged with session context so the corruption
    is surfaced in prod logs instead of disappearing silently.
    """
    current_step: str | None = None
    steps_completed: list[str] = Field(default_factory=list)
    step_data: dict[str, Any] = Field(default_factory=dict)
    version: int | None = None
    # Internal metadata — preserved but not validated strictly
    meta: dict[str, Any] = Field(default_factory=dict, alias="__meta")

    model_config = {"populate_by_name": True, "extra": "allow"}


def parse_step_progress(
    raw: Any,
    session_id: int | None = None,
    *,
    context: str = "",
) -> StepProgressData | None:
    """Parse a raw step_progress value from the DB.

    - Returns None when raw is None (fresh session, no progress saved yet — not an error).
    - Returns a validated StepProgressData when raw is a well-formed dict.
    - Logs a WARNING and returns None when raw is a non-None, non-dict value or when the
      dict fails Pydantic validation.  The caller falls back to integer current_step as before,
      but now the corruption is visible in logs.

    Args:
        raw: The raw value from session.step_progress (may be None, dict, str, int, …)
        session_id: DB session id for log context (pass None when not available)
        context: Short label identifying the call site (e.g. "assignments.get_my_assignments")
    """
    if raw is None:
        return None

    if not isinstance(raw, dict):
        logger.warning(
            "step_progress corrupt (session_id=%s, site=%s): expected dict, got %s | value=%.200r",
            session_id,
            context or "unknown",
            type(raw).__name__,
            raw,
        )
        return None

    try:
        return StepProgressData.model_validate(raw)
    except ValidationError as exc:
        logger.warning(
            "step_progress schema invalid (session_id=%s, site=%s): %s | raw=%.200r",
            session_id,
            context or "unknown",
            exc,
            raw,
        )
        return None


class SessionCreateRequest(BaseModel):
    story_slug: str = Field(..., min_length=1, max_length=100)
    story_title: str | None = Field(None, max_length=200)


class SessionUpdateRequest(BaseModel):
    # DEPRECATED (#1182): current_step integer writes are disabled. Field kept for
    # backwards-compat so existing callers don't get 422, but the value is ignored
    # when writing — step position is derived from step_progress.steps_completed.
    current_step: int | None = Field(None, ge=1, le=50, deprecated=True)
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
    learning_source: Literal["self", "assignment"] | None = None
    status: str
    current_step: int
    accuracy: float | None
    overall_score: float | None
    started_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _use_derived_step(cls, v: Any) -> Any:
        """Use current_step_derived (from step_progress JSONB) instead of the
        deprecated integer column when building from an ORM instance. (#1182)

        Pydantic's from_attributes reader will access the 'current_step' attribute,
        which is the SQLAlchemy column descriptor (stale integer).  To override it
        without an Alembic migration, we convert the ORM object to a flat dict here
        so Pydantic reads our overridden current_step value.

        Dict inputs (e.g. unit tests constructing the response directly) are passed
        through unchanged.
        """
        if isinstance(v, dict):
            return v
        if not hasattr(v, "current_step_derived"):
            return v
        # Build a dict from all attributes that SessionSummaryResponse (and its
        # subclasses) might need.  Use getattr with a sentinel so missing attrs
        # return None rather than raising AttributeError for optional fields.
        _MISSING = object()

        def _get(attr: str, default: Any = None) -> Any:
            val = getattr(v, attr, _MISSING)
            return default if val is _MISSING else val

        return {
            # identity
            "id": _get("id"),
            "story_slug": _get("story_slug"),
            "story_title": _get("story_title"),
            "learning_source": _get("learning_source"),
            "status": _get("status"),
            # derived (not the column) — this is the whole point of #1182
            "current_step": v.current_step_derived,
            "accuracy": _get("accuracy"),
            "overall_score": _get("overall_score"),
            "started_at": _get("started_at"),
            "completed_at": _get("completed_at"),
            # SessionDetailResponse extra fields (no-op for parent class)
            "reading_result": _get("reading_result"),
            "comprehension_result": _get("comprehension_result"),
            "vocab_result": _get("vocab_result"),
            "full_reading_result": _get("full_reading_result"),
            "comprehension_score": _get("comprehension_score"),
            "literal_score": _get("literal_score"),
            "inferential_score": _get("inferential_score"),
            "evaluative_score": _get("evaluative_score"),
            "comprehension_feedback": _get("comprehension_feedback"),
            "teacher_reviewed_at": _get("teacher_reviewed_at"),
            "teacher_comment": _get("teacher_comment"),
        }


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
    # Teacher review (Issue #993)
    teacher_reviewed_at: datetime | None = None
    teacher_comment: str | None = None


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
    # Optimistic concurrency version (#1187): monotonically increasing counter from client.
    # Backend rejects writes where incoming version < stored version to prevent stale
    # overwrites after a previous save failure.
    version: int | None = Field(None, ge=0, description="Client-side version counter")


class StepProgressResponse(BaseModel):
    """Response for GET /api/learning/sessions/{id}/progress."""
    session_id: int
    step_progress: dict[str, Any] | None

    model_config = {"from_attributes": True}
