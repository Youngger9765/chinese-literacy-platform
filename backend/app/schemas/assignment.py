from datetime import datetime

from pydantic import BaseModel, Field


class AssignmentCreateRequest(BaseModel):
    classroom_id: int
    story_id: str = Field(..., min_length=1, max_length=50)
    title: str | None = Field(None, max_length=200)
    description: str | None = None
    assignment_type: str = Field("reading", pattern=r"^(reading|comprehension)$")
    due_date: datetime | None = None


class AssignmentUpdateRequest(BaseModel):
    title: str | None = Field(None, max_length=200)
    description: str | None = None
    due_date: datetime | None = None
    is_active: bool | None = None


class GradeSubmissionRequest(BaseModel):
    score: float | None = Field(None, ge=0, le=100)


class SubmissionResponse(BaseModel):
    id: int
    assignment_id: int
    student_id: int
    student_name: str
    status: str
    submitted_at: datetime | None
    score: float | None

    model_config = {"from_attributes": True}


class AssignmentResponse(BaseModel):
    id: int
    classroom_id: int
    teacher_id: int
    story_id: str
    story_title: str
    title: str | None
    description: str | None
    assignment_type: str
    due_date: datetime | None
    is_active: bool
    created_at: datetime
    submission_count: int
    completed_count: int

    model_config = {"from_attributes": True}


class AssignmentDetailResponse(AssignmentResponse):
    submissions: list[SubmissionResponse]


class AssignmentListResponse(BaseModel):
    items: list[AssignmentResponse]
    total: int


class StudentAssignmentResponse(BaseModel):
    assignment_id: int
    story_id: str
    story_title: str
    title: str | None
    description: str | None
    assignment_type: str
    due_date: datetime | None
    classroom_name: str
    status: str
    submitted_at: datetime | None
    score: float | None

    model_config = {"from_attributes": True}


class StartAssignmentResponse(BaseModel):
    session_id: int
    story_id: str
    status: str
