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
    is_active: bool
    created_at: datetime
    student_count: int

    model_config = {"from_attributes": True}


class ClassroomDetailResponse(ClassroomResponse):
    students: list[StudentInClassroomResponse]


class ClassroomListResponse(BaseModel):
    items: list[ClassroomResponse]
    total: int
