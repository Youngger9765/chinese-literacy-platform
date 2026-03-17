from datetime import datetime

from pydantic import BaseModel, Field, model_validator

# Default reading goals (Issue #84)
DEFAULT_TARGET_CPM = 150        # 流暢朗讀標準：150-180 字/分
DEFAULT_TARGET_ACCURACY = 90.0  # 正確率 > 90%


class AssignmentCreateRequest(BaseModel):
    """Request body for creating an assignment.

    Exactly one of `story_id` (YAML platform text) or `text_id` (DB text)
    must be provided.  The backend will apply the appropriate copy strategy.
    """
    classroom_id: int
    # YAML platform text — lesson_number as string (e.g. "1", "57")
    story_id: str | None = Field(None, min_length=1, max_length=50)
    # DB text — id in the texts table
    text_id: int | None = None
    title: str | None = Field(None, max_length=200)
    description: str | None = None
    assignment_type: str = Field("reading", pattern=r"^(reading|comprehension)$")
    due_date: datetime | None = None
    # Reading goals (Issue #84) — optional; defaults applied at read time
    target_cpm: int | None = Field(None, ge=30, le=600)
    target_accuracy: float | None = Field(None, ge=0, le=100)
    difficulty_label: str | None = None

    @model_validator(mode="after")
    def _exactly_one_text_source(self) -> "AssignmentCreateRequest":
        has_story = self.story_id is not None
        has_text = self.text_id is not None
        if has_story == has_text:  # both set, or neither set
            raise ValueError("Exactly one of story_id or text_id must be provided")
        return self


class AssignmentUpdateRequest(BaseModel):
    title: str | None = Field(None, max_length=200)
    description: str | None = None
    due_date: datetime | None = None
    is_active: bool | None = None
    # Reading goals (Issue #84)
    target_cpm: int | None = Field(None, ge=30, le=600)
    target_accuracy: float | None = Field(None, ge=0, le=100)
    difficulty_label: str | None = None


class GradeSubmissionRequest(BaseModel):
    score: float | None = Field(None, ge=0, le=100)
    teacher_feedback: str | None = Field(None, max_length=2000)  # per-student feedback (Issue #424)


class SubmissionResponse(BaseModel):
    id: int
    assignment_id: int
    student_id: int
    student_name: str
    status: str
    submitted_at: datetime | None
    score: float | None
    # Reading metrics from linked LearningSession (Issue #423)
    reading_accuracy: float | None = None   # LiveTutor accuracy %
    reading_cpm: float | None = None         # chars per minute from reading_result
    reading_error_chars: list[str] = []      # mispronounced/skipped chars
    teacher_feedback: str | None = None  # per-student teacher feedback (Issue #424)

    model_config = {"from_attributes": True}


class AssignmentResponse(BaseModel):
    id: int
    classroom_id: int
    teacher_id: int
    # Resolved text reference — always present after creation
    story_id: str | None      # set for YAML platform texts
    text_id: int | None       # set for DB texts (points to the fork if applicable)
    story_title: str          # resolved display title (from YAML or DB)
    title: str | None
    description: str | None
    assignment_type: str
    due_date: datetime | None
    is_active: bool
    created_at: datetime
    submission_count: int
    completed_count: int
    # Reading goals (Issue #84)
    target_cpm: int | None
    target_accuracy: float | None
    difficulty_label: str | None
    # Effective goals — defaults filled in when teacher hasn't set custom ones
    effective_cpm: int
    effective_accuracy: float

    model_config = {"from_attributes": True}


class AssignmentDetailResponse(AssignmentResponse):
    submissions: list[SubmissionResponse]


class AssignmentListResponse(BaseModel):
    items: list[AssignmentResponse]
    total: int


class StudentAssignmentResponse(BaseModel):
    assignment_id: int
    story_id: str | None
    text_id: int | None
    story_title: str
    title: str | None
    description: str | None
    assignment_type: str
    due_date: datetime | None
    classroom_name: str
    status: str
    submitted_at: datetime | None
    score: float | None
    teacher_feedback: str | None  # per-student teacher feedback (Issue #424)
    # Reading goals (Issue #84)
    target_cpm: int | None
    target_accuracy: float | None
    difficulty_label: str | None
    effective_cpm: int
    effective_accuracy: float

    model_config = {"from_attributes": True}


class StartAssignmentResponse(BaseModel):
    session_id: int
    story_id: str | None      # set if platform text
    text_id: int | None       # set if DB text
    status: str
