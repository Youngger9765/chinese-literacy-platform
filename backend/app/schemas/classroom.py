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


class ClassroomJoinPreviewResponse(BaseModel):
    """Read-only lookup by join code (#3081) -- no enrollment side effect.

    Lets a student confirm *which* classroom a scanned QR points at before
    they commit to joining it. The join endpoint itself can't serve this: it
    enrolls on success, so calling it "just to peek" would join the wrong
    class you were trying to rule out.
    """

    id: int
    name: str

    model_config = {"from_attributes": True}


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
    warnings: list[str] = []


# ── Student Search ──────────────────────────────────────────────────────────


class StudentSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=100)


class StudentSearchResult(BaseModel):
    id: int
    name: str
    email: str

    model_config = {"from_attributes": True}


# ── CSV Upload ───────────────────────────────────────────────────────────────


class CsvUploadResponse(BaseModel):
    created_count: int
    skipped_count: int
    errors: list[BatchStudentError]
    created: list[CreatedStudentInfo]
    warnings: list[str] = []


# ── Student Enrolled Classrooms ───────────────────────────────────────────────


class StudentEnrolledClassroom(BaseModel):
    """Classroom info from the student's perspective, including teacher name."""

    id: int
    name: str
    grade: int | None
    teacher_id: int
    teacher_name: str
    is_active: bool
    enrolled_at: datetime

    model_config = {"from_attributes": True}


class StudentEnrolledClassroomsResponse(BaseModel):
    classrooms: list[StudentEnrolledClassroom]
    total: int
