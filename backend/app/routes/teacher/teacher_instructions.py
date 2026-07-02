"""Teacher instruction endpoints: individualized student instructions CRUD."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...dependencies.tenant import _check_classroom_access, get_owned_resource_or_403
from ...models.school import Classroom, ClassroomStudent
from ...models.teacher_instruction import TeacherInstruction
from ...models.user import User
from ...schemas.teacher_instruction import (
    VALID_INSTRUCTION_TYPES,
    InstructionCreate,
    InstructionResponse,
    InstructionUpdate,
)
from ...services.input_sanitizer import sanitize_ai_input
from ..classrooms import _get_classroom_or_404, _require_owner_or_admin

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)


@router.post(
    "/teacher/students/{student_id}/instructions",
    status_code=201,
    response_model=InstructionResponse,
)
def create_student_instruction(
    student_id: int,
    payload: InstructionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a special instruction for a student. Teacher must own the classroom."""
    # Validate instruction_type
    if payload.instruction_type not in VALID_INSTRUCTION_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid instruction_type. Must be one of: {', '.join(sorted(VALID_INSTRUCTION_TYPES))}",
        )

    # Verify teacher owns the classroom
    classroom = _get_classroom_or_404(payload.classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    # Verify student is enrolled in this classroom
    enrollment = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == payload.classroom_id,
            ClassroomStudent.student_id == student_id,
        )
        .first()
    )
    if not enrollment:
        raise HTTPException(
            status_code=404,
            detail="Student not found in this classroom",
        )

    # Sanitize instruction content — this text is injected into AI prompts
    safe_content, _ = sanitize_ai_input(payload.content, user_id=str(current_user.id))

    instruction = TeacherInstruction(
        teacher_id=current_user.id,
        student_id=student_id,
        classroom_id=payload.classroom_id,
        instruction_type=payload.instruction_type,
        content=safe_content,
    )
    db.add(instruction)
    db.commit()
    db.refresh(instruction)

    logger.info(
        "Created instruction %d for student %d in classroom %d (teacher %d)",
        instruction.id, student_id, payload.classroom_id, current_user.id,
    )
    return instruction


@router.get(
    "/teacher/students/{student_id}/instructions",
    response_model=list[InstructionResponse],
)
def list_student_instructions(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List active instructions for a student. Teacher must own a classroom containing this student."""
    # Verify teacher owns a classroom containing this student
    enrollment = (
        db.query(ClassroomStudent)
        .join(Classroom, ClassroomStudent.classroom_id == Classroom.id)
        .filter(
            ClassroomStudent.student_id == student_id,
            Classroom.teacher_id == current_user.id,
        )
        .first()
    )
    if not enrollment:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to view this student's instructions",
        )

    instructions = (
        db.query(TeacherInstruction)
        .filter(
            TeacherInstruction.student_id == student_id,
            TeacherInstruction.teacher_id == current_user.id,
            TeacherInstruction.is_active == True,  # noqa: E712
        )
        .order_by(TeacherInstruction.created_at.desc())
        .all()
    )
    return instructions


@router.get(
    "/teacher/classrooms/{classroom_id}/instruction-counts",
    response_model=dict[int, int],
)
def get_classroom_instruction_counts(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get active instruction counts for all students in a classroom (bulk, avoids N+1).

    Returns a mapping of student_id -> active_instruction_count.
    Students with zero instructions are included with count 0.
    """
    classroom = _check_classroom_access(current_user, classroom_id, db)

    # Get all student IDs enrolled in this classroom
    student_ids = [
        row[0]
        for row in db.query(ClassroomStudent.student_id)
        .filter(ClassroomStudent.classroom_id == classroom.id)
        .all()
    ]

    if not student_ids:
        return {}

    # Single aggregated query: count active instructions per student
    rows = (
        db.query(
            TeacherInstruction.student_id,
            func.count(TeacherInstruction.id).label("cnt"),
        )
        .filter(
            TeacherInstruction.student_id.in_(student_ids),
            TeacherInstruction.teacher_id == current_user.id,
            TeacherInstruction.is_active == True,  # noqa: E712
        )
        .group_by(TeacherInstruction.student_id)
        .all()
    )

    counts_from_db = {row.student_id: row.cnt for row in rows}

    # Include all students, defaulting to 0 for those with no instructions
    return {sid: counts_from_db.get(sid, 0) for sid in student_ids}


@router.patch(
    "/teacher/instructions/{instruction_id}",
    response_model=InstructionResponse,
)
def update_instruction(
    instruction_id: int,
    payload: InstructionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update an instruction. Only the teacher who created it can update."""
    instruction = get_owned_resource_or_403(
        db, TeacherInstruction, instruction_id, current_user.id,
        not_found_detail="Instruction not found",
        forbidden_detail="Not your instruction",
    )

    # Validate instruction_type if provided
    if payload.instruction_type is not None and payload.instruction_type not in VALID_INSTRUCTION_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid instruction_type. Must be one of: {', '.join(sorted(VALID_INSTRUCTION_TYPES))}",
        )

    update_data = payload.model_dump(exclude_unset=True)
    # Sanitize content field — injected into AI prompts
    if "content" in update_data and update_data["content"]:
        update_data["content"], _ = sanitize_ai_input(
            update_data["content"], user_id=str(current_user.id)
        )
    for field, value in update_data.items():
        setattr(instruction, field, value)

    db.commit()
    db.refresh(instruction)
    logger.info("Updated instruction %d: %s", instruction_id, list(update_data.keys()))
    return instruction


@router.delete(
    "/teacher/instructions/{instruction_id}",
    response_model=InstructionResponse,
)
def delete_instruction(
    instruction_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Soft-delete an instruction by setting is_active = False."""
    instruction = get_owned_resource_or_403(
        db, TeacherInstruction, instruction_id, current_user.id,
        not_found_detail="Instruction not found",
        forbidden_detail="Not your instruction",
    )

    instruction.is_active = False
    db.commit()
    db.refresh(instruction)
    logger.info("Deleted (soft) instruction %d", instruction_id)
    return instruction
