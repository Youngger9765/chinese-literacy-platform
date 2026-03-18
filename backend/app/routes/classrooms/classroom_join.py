"""Join code management endpoints: regenerate code, join classroom by code."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.school import Classroom, ClassroomStudent
from ...models.user import User
from ...schemas.classroom import ClassroomJoinRequest, ClassroomResponse
from .helpers import (
    classroom_to_response,
    generate_join_code,
    get_classroom_or_404,
    require_owner_or_admin,
)

router = APIRouter(tags=["classrooms"])
logger = logging.getLogger(__name__)


@router.post(
    "/classrooms/{classroom_id}/regenerate-code",
    response_model=ClassroomResponse,
)
def regenerate_classroom_code(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Regenerate the join code for a classroom. Requires owner or admin."""
    classroom = get_classroom_or_404(classroom_id, db)
    require_owner_or_admin(classroom, current_user, db)

    classroom.join_code = generate_join_code(db)
    db.commit()
    db.refresh(classroom)
    logger.info(
        "Regenerated join code for classroom %d (by user %d)",
        classroom_id, current_user.id,
    )
    return classroom_to_response(classroom, db)


@router.post("/classrooms/join", status_code=200, response_model=ClassroomResponse)
def join_classroom_by_code(
    payload: ClassroomJoinRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Join a classroom using a join code. Enrolls the current user as a student."""
    from ...models.school import School

    classroom = (
        db.query(Classroom)
        .filter(Classroom.join_code == payload.join_code.upper())
        .first()
    )
    if classroom is None or not classroom.is_active:
        raise HTTPException(status_code=404, detail="Invalid join code")

    school = db.query(School).filter(School.id == classroom.school_id).first()
    if school is None or not school.is_active:
        raise HTTPException(status_code=404, detail="Invalid join code")

    existing = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom.id,
            ClassroomStudent.student_id == current_user.id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Already enrolled in this classroom")

    cs = ClassroomStudent(
        classroom_id=classroom.id,
        student_id=current_user.id,
    )
    db.add(cs)
    db.commit()
    db.refresh(classroom)
    logger.info(
        "User %d joined classroom %d via join code",
        current_user.id, classroom.id,
    )
    return classroom_to_response(classroom, db)
