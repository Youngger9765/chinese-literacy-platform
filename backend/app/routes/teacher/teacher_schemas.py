"""Shared Pydantic schemas for teacher route sub-modules."""
from datetime import datetime

from pydantic import BaseModel, Field


# ── Student Tags ──────────────────────────────────────────────────────────────


class TagResponse(BaseModel):
    id: int
    student_id: int
    teacher_id: int
    tag_name: str
    color: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AddTagRequest(BaseModel):
    tag_name: str
    color: str = "gray"


# ── Classrooms ────────────────────────────────────────────────────────────────


class TeacherClassroomResponse(BaseModel):
    id: int
    name: str
    school_id: int
    grade: int | None
    is_active: bool
    created_at: datetime
    student_count: int
    assigned_text_count: int

    model_config = {"from_attributes": True}


class StudentProgressResponse(BaseModel):
    student_id: int
    student_name: str
    last_session_date: datetime | None
    last_text_title: str | None
    total_sessions: int
    tags: list[TagResponse] = []

    model_config = {"from_attributes": True}


class ClassroomStatsResponse(BaseModel):
    total_students: int
    total_sessions: int
    active_students: int
    inactive_students: int
    avg_accuracy: float | None
    completion_rate: float
    avg_session_duration_minutes: float | None

    model_config = {"from_attributes": True}


# ── Student Sessions ──────────────────────────────────────────────────────────


class StudentSessionResponse(BaseModel):
    id: int
    story_title: str | None
    started_at: datetime
    completed_at: datetime | None
    overall_score: float | None
    status: str

    model_config = {"from_attributes": True}


# ── Error Vocab ───────────────────────────────────────────────────────────────


class ErrorVocabItem(BaseModel):
    character: str
    error_type: str
    count: int
    student_count: int

    model_config = {"from_attributes": True}


# ── Time Stats ────────────────────────────────────────────────────────────────


class TimeStatsResponse(BaseModel):
    total_hours: float
    avg_minutes_per_session: float | None
    study_days: int
    sessions_this_week: int
    sessions_last_week: int

    model_config = {"from_attributes": True}


# ── Heatmap ───────────────────────────────────────────────────────────────────


class HeatmapStudentEntry(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class HeatmapStoryEntry(BaseModel):
    id: str
    title: str

    model_config = {"from_attributes": True}


class HeatmapScoreEntry(BaseModel):
    student_id: int
    story_id: str
    score: float
    status: str

    model_config = {"from_attributes": True}


class HeatmapResponse(BaseModel):
    students: list[HeatmapStudentEntry]
    stories: list[HeatmapStoryEntry]
    scores: list[HeatmapScoreEntry]

    model_config = {"from_attributes": True}


# ── Alerts ────────────────────────────────────────────────────────────────────


class StudentAlertResponse(BaseModel):
    student_id: int
    student_name: str
    alert_type: str  # "inactive" | "low_performance" | "declining"
    detail: str
    last_session_date: datetime | None

    model_config = {"from_attributes": True}


# ── Learning Curve ────────────────────────────────────────────────────────────


class LearningCurvePoint(BaseModel):
    date: str  # ISO date string
    score: float
    story_title: str | None
    session_id: int
    story_slug: str | None = None
    cpm: float | None = None
    accuracy: float | None = None

    model_config = {"from_attributes": True}


class LearningCurveResponse(BaseModel):
    data: list[LearningCurvePoint]

    model_config = {"from_attributes": True}


# ── At-Risk Students ──────────────────────────────────────────────────────────


class AtRiskStudentResponse(BaseModel):
    student_id: int
    student_name: str
    risk_level: str          # "low" | "medium" | "high"
    risk_factors: list[str]
    recommended_actions: list[str]
    confidence_score: float
    supporting_data: dict

    model_config = {"from_attributes": True}


# ── Error Heatmap ─────────────────────────────────────────────────────────────


class ErrorHeatmapStudentEntry(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class ErrorHeatmapErrorEntry(BaseModel):
    student_id: int
    character: str
    error_count: int

    model_config = {"from_attributes": True}


class ErrorHeatmapResponse(BaseModel):
    """Student x character error matrix for classroom teachers."""
    students: list[ErrorHeatmapStudentEntry]
    characters: list[str]  # sorted by total error count desc
    errors: list[ErrorHeatmapErrorEntry]  # only non-zero cells

    model_config = {"from_attributes": True}


# ── Dialogue ──────────────────────────────────────────────────────────────────


class TeacherDialogueTurnResponse(BaseModel):
    id: int
    role: str
    content: str = Field(validation_alias="text")
    turn_order: int
    is_correct: bool | None = None
    phase: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class TeacherDialogueHistoryResponse(BaseModel):
    session_id: int
    student_id: int
    story_slug: str | None
    turns: list[TeacherDialogueTurnResponse]
    total: int


# ── Stuck Overview ────────────────────────────────────────────────────────────


class StudentStuckSummary(BaseModel):
    student_id: int
    student_name: str
    story_stuck_count: int
    character_stuck_count: int
    is_declining: bool
    top_stuck_characters: list[str]
    top_recommendations: list[str]


class ClassroomStuckResponse(BaseModel):
    students: list[StudentStuckSummary]
    total_stuck: int


# ── Notifications ─────────────────────────────────────────────────────────────


class NotificationItem(BaseModel):
    alert_key: str  # "{classroom_id}:{student_id}:{alert_type}"
    classroom_id: int
    classroom_name: str
    student_id: int
    student_name: str
    alert_type: str  # "inactive" | "low_performance" | "declining"
    detail: str
    last_session_date: datetime | None
    is_read: bool
    read_at: datetime | None

    model_config = {"from_attributes": True}


class NotificationSummaryResponse(BaseModel):
    total: int
    unread: int
    items: list[NotificationItem]


class MarkReadRequest(BaseModel):
    alert_keys: list[str]


# ── Cross-Text Analysis ───────────────────────────────────────────────────────


class TextPerformanceSummary(BaseModel):
    story_slug: str
    story_title: str | None
    attempt_count: int
    avg_score: float | None
    avg_accuracy: float | None
    avg_comprehension_score: float | None
    first_attempt_at: datetime | None
    last_attempt_at: datetime | None


class StudentCrossTextPattern(BaseModel):
    student_id: int
    student_name: str
    total_texts_attempted: int
    total_sessions: int
    overall_avg_score: float | None
    score_trend: list[dict]  # [{date, score, story_slug, title}] sorted by date
    text_performance: list[TextPerformanceSummary]
    repeated_error_chars: list[dict]  # [{char, error_count, story_count, story_slugs}]
    strong_texts: list[str]   # story_slugs where avg_score >= 80
    weak_texts: list[str]     # story_slugs where avg_score < 60


class ClassroomCrossTextPattern(BaseModel):
    classroom_id: int
    classroom_name: str
    total_students: int
    total_sessions: int
    text_difficulty_ranking: list[dict]  # [{story_slug, title, avg_score, attempt_count}]
    class_score_trend: list[dict]  # [{date, avg_score}]
    common_error_chars: list[dict]  # [{char, student_count, total_errors}]
    student_patterns: list[StudentCrossTextPattern]


# ── Teacher Custom Texts ──────────────────────────────────────────────────────


class TeacherTextCreateRequest(BaseModel):
    title: str
    grade: int
    genre: str
    text_type: str = "單"
    reading_strategy: str | None = None
    paragraphs: list[str]
    vocabulary: list[dict] | None = None


class TeacherTextUpdateRequest(BaseModel):
    title: str | None = None
    grade: int | None = None
    genre: str | None = None
    text_type: str | None = None
    reading_strategy: str | None = None
    paragraphs: list[str] | None = None
    vocabulary: list[dict] | None = None


class TeacherTextItem(BaseModel):
    id: int
    title: str
    grade: int
    grade_code: str
    genre: str
    text_type: str
    paragraph_count: int
    char_count: int
    reading_strategy: str | None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TeacherTextDetail(TeacherTextItem):
    paragraphs: list[str]
    vocabulary: list[dict] | None


class TeacherTextListResponse(BaseModel):
    texts: list[TeacherTextItem]
    total: int


# ── Story Tags ────────────────────────────────────────────────────────────────


class StoryTagUpsertRequest(BaseModel):
    """Request body for setting difficulty and custom tags on a story."""
    difficulty_level: str | None = None  # "easy" / "medium" / "hard" / null to clear
    custom_tags: list[str] | None = None  # up to 10 tags, each max 30 chars


class StoryTagResponse(BaseModel):
    """Response schema for a story tag entry."""
    story_ref: str
    difficulty_level: str | None
    custom_tags: list[str]

    model_config = {"from_attributes": True}
