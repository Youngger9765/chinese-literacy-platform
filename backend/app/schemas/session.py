from datetime import datetime
from typing import Any, Literal
import logging

from pydantic import BaseModel, Field, StringConstraints, ValidationError, field_validator
from typing import Annotated

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
    # Canonical slug derived from FK relationship (#1188).  Prefers text.lesson_number;
    # falls back to story_slug for rows without text_id.  New consumers should prefer this.
    story_slug_derived: str | None = None
    story_title: str | None = None  # human-readable title, e.g. "第六課 牛頓的故事"
    learning_source: Literal["self", "assignment"] | None = None
    status: str
    # Read from `current_step_derived`, not the column of the same name. #1182 made
    # `step_progress.steps_completed` the single source of truth and stopped syncing the
    # integer column — which this schema kept reading, so every session in the list and
    # detail responses reported step 1 no matter how far the student had got. The
    # `/status` endpoint passes the derived value explicitly and was the only one telling
    # the truth. #1182 says plainly: do NOT read the deprecated column from application
    # code. This is application code.
    current_step: int = Field(validation_alias="current_step_derived")
    accuracy: float | None
    overall_score: float | None
    started_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True, "populate_by_name": True}


class SessionDetailResponse(SessionSummaryResponse):
    reading_result: dict[str, Any] | None
    comprehension_result: dict[str, Any] | None
    vocab_result: dict[str, Any] | None
    full_reading_result: dict[str, Any] | None
    # Bug C fix (#1378): array of per-attempt snapshots, capped at 4.
    # Backward compat: full_reading_result above still = latest attempt.
    full_reading_attempts: list[dict[str, Any]] = []
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

# Issue #3682: steps_completed is a monotonic union on the server, so anything a
# client writes there stays forever. Bound the sizes so a bad client cannot grow a
# session's progress without limit. Generous on purpose: a multi-passage lesson has
# about 11 steps per passage.
MAX_PROGRESS_ITEMS = 200
_StepId = Annotated[str, StringConstraints(max_length=128)]


class StepProgressSaveRequest(BaseModel):
    """Body for PUT /api/learning/sessions/{id}/progress.

    Fields mirror the localStorage schema so the frontend can send
    the same object it writes to localStorage.
    """
    current_step: _StepId | None = Field(None, description="Active step path, e.g. 'vocab-definition'")
    steps_completed: list[_StepId] = Field(default_factory=list, max_length=MAX_PROGRESS_ITEMS, description="List of completed step path keys")
    step_data: dict[str, Any] = Field(default_factory=dict, description="Per-step serialised progress data")
    # Optimistic concurrency version (#1187): monotonically increasing counter from client.
    # Backend rejects writes where incoming version < stored version to prevent stale
    # overwrites after a previous save failure.
    version: int | None = Field(None, ge=0, description="Client-side version counter")
    # Issue #3682 follow-up: steps_completed is now a monotonic union (never shrinks
    # on a plain save, to survive the #3682 premature-empty-save race). That union
    # would also silently undo a DELIBERATE un-complete — e.g. useStepProgressPersistence
    # .resetTutorStep's 「再讀一次」 redo flow (#2532/#2533), which removes
    # 'paragraph-reading' from steps_completed on purpose. `reset_steps` makes that
    # intent explicit: any step id named here is dropped from the stored list even
    # though the union would otherwise keep it (a plain omission, with nothing named
    # here, still only ever grows the list).
    reset_steps: list[_StepId] = Field(default_factory=list, max_length=MAX_PROGRESS_ITEMS, description="Step ids to deliberately un-complete")

    @field_validator("step_data")
    @classmethod
    def _cap_step_data_keys(cls, v: dict[str, Any]) -> dict[str, Any]:
        if len(v) > MAX_PROGRESS_ITEMS:
            raise ValueError(f"step_data has more than {MAX_PROGRESS_ITEMS} keys")
        return v

    # Issue #3695 (reported as part of #3682): true when the frontend's own
    # required-step check (every non-cover step for this lesson, see
    # stepConfig.ts filterRequiredAssignmentSteps) says this session is
    # complete. This is a HINT ONLY (team-lead review, integrity follow-up) —
    # the backend does NOT trust it for the actual submit decision. It's used
    # purely to avoid recomputing readiness on every single progress save;
    # maybe_auto_submit_assignment_session independently verifies readiness
    # server-side against the session's own stored steps_completed and this
    # assignment's own required-step list (loaded from the lesson's data, not
    # from this flag or anything else the client sent). A forged/stale flag
    # with genuinely-missing steps is therefore a silent no-op, not a
    # submission — see assignment_queries.is_assignment_ready_for_submit.
    assignment_ready_for_submit: bool = Field(
        False,
        description="Hint only — true when the frontend's own required-step check reports completion. The backend independently re-verifies before submitting.",
    )


class ReadingBabyGrowthEvent(BaseModel):
    """一個站這次 save 真的新寫入的閱讀寶貝成長證據（#3780 第一階段，
    取代 v1 的 `WordBabyRewardItem`）。

    只會出現「這次呼叫真的寫入」的站——冪等重跑（特別是每次 save 都會
    重新嘗試一次的 lesson-intro）不會重複出現，見
    `reading_baby_service.record_station_evidence` 的 docstring。"""
    station: str
    #: 課綱學習表現代碼（如 "5-Ⅲ-6"），不是能力家族字母。
    ability_id: str
    #: 這次是不是「做得好」——completion 型態的站（沒有對錯可判）永遠是
    #: False，只代表「有參與」（game-design.md §2）。
    quality_passed: bool


class StepProgressResponse(BaseModel):
    """Response for GET/PUT /api/learning/sessions/{id}/progress."""
    session_id: int
    step_progress: dict[str, Any] | None
    #: XP newly awarded by THIS save for newly-completed steps (Issue #3024).
    #: Always 0 for GET responses and for saves that completed nothing new —
    #: added fields default so pre-#3024 clients that don't read them see no
    #: behavior change.
    xp_awarded: int = 0
    #: Badge keys newly unlocked by THIS save (Issue #3024). Empty for GET
    #: responses and for saves that unlocked nothing.
    badges_unlocked: list[str] = Field(default_factory=list)
    #: Reading-baby growth events genuinely recorded by THIS save (Issue #3780
    #: 第一階段，取代 v1 的 `word_baby_rewards`). Always [] for GET responses
    #: and for saves that recorded nothing new.
    reading_baby_events: list[ReadingBabyGrowthEvent] = Field(default_factory=list)

    model_config = {"from_attributes": True}
