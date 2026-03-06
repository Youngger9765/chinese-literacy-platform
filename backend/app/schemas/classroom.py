from datetime import datetime

from pydantic import BaseModel, Field


class ClassroomCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    school_id: int
    grade: int | None = Field(None, ge=1, le=12)
    teacher_id: int | None = None  # Admin-only: create classroom for another teacher


class ClassroomUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    grade: int | None = Field(None, ge=1, le=12)
    is_active: bool | None = None


class ClassroomStudentAddRequest(BaseModel):
    student_id: int


class ClassroomJoinRequest(BaseModel):
    join_code: str = Field(..., min_length=1, max_length=8)


class StudentInClassroomResponse(BaseModel):
    id: int
    name: str
    email: str
    enrolled_at: datetime

    model_config = {"from_attributes": True}


class ClassroomResponse(BaseModel):
    id: int
    name: str
    school_id: int
    teacher_id: int
    grade: int | None
    join_code: str | None = None
    is_active: bool
    created_at: datetime
    student_count: int

    model_config = {"from_attributes": True}


class ClassroomDetailResponse(ClassroomResponse):
    students: list[StudentInClassroomResponse]


class ClassroomListResponse(BaseModel):
    items: list[ClassroomResponse]
    total: int


# ── Batch Student Creation ──────────────────────────────────────────────────


class BatchStudentItem(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    seat_number: str = Field(..., min_length=1, max_length=10)


class BatchStudentCreateRequest(BaseModel):
    students: list[BatchStudentItem] = Field(..., min_length=1)


class CreatedStudentInfo(BaseModel):
    name: str
    seat_number: str
    username: str
    password: str
    user_id: int


class BatchStudentError(BaseModel):
    name: str
    seat_number: str
    error: str


class BatchStudentCreateResponse(BaseModel):
    created: list[CreatedStudentInfo]
    errors: list[BatchStudentError]


# ── Student Search ──────────────────────────────────────────────────────────


class StudentSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=100)


class StudentSearchResult(BaseModel):
    id: int
    name: str
    email: str

    model_config = {"from_attributes": True}
