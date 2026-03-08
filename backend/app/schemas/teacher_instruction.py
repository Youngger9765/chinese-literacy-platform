"""Pydantic schemas for teacher instruction CRUD."""

from datetime import datetime

from pydantic import BaseModel, Field

# Valid instruction types
VALID_INSTRUCTION_TYPES = {"general", "reading", "comprehension", "vocabulary"}


class InstructionCreate(BaseModel):
    classroom_id: int
    instruction_type: str = "general"
    content: str = Field(..., min_length=1, max_length=500)


class InstructionUpdate(BaseModel):
    content: str | None = Field(None, min_length=1, max_length=500)
    instruction_type: str | None = None
    is_active: bool | None = None


class InstructionResponse(BaseModel):
    id: int
    teacher_id: int
    student_id: int
    classroom_id: int
    instruction_type: str
    content: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
