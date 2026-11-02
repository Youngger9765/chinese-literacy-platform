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
    create_submissions_for_new_student,
    ensure_school_student_role,
    generate_join_code,
    get_classroom_or_404,
    require_editor_or_admin,
)

router = APIRouter(tags=["classrooms"])
logger = logging.getLogger(__name__)


@router.post("/classrooms/join", status_code=200, response_model=ClassroomResponse)
def join_classroom_by_code(
    payload: ClassroomJoinRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Join a classroom using a join code. Enrolls the current user as a student.

    (#3804) Also grants a school-scoped `student` UserRole if the caller
    doesn't already hold one for this classroom's school — previously this
    endpoint was the one path (unlike teacher-created batch/CSV/Junyi import)
    that enrolled a ClassroomStudent without ever granting the matching
    role, so an SSO-only account (Google/Junyi — neither grants a role on
    account creation either) stayed invisible to every "which school is this
    student in" query forever.

    IMPORTANT: This route MUST appear before /classrooms/{classroom_id}/regenerate-code
    so that FastAPI does not treat "join" as a classroom_id.
    """
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
    db.flush()

    ensure_school_student_role(db, current_user.id, classroom.school_id)

    # Back-fill submissions for active assignments the student missed (#996)
    create_submissions_for_new_student(classroom.id, current_user.id, db)

    db.commit()
    db.refresh(classroom)
    logger.info(
        "User %d joined classroom %d via join code",
        current_user.id, classroom.id,
    )
    return classroom_to_response(classroom, db)


@router.post(
    "/classrooms/{classroom_id}/regenerate-code",
    response_model=ClassroomResponse,
)
def regenerate_classroom_code(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Regenerate the join code for a classroom.

    Owner, accepted 'editor'-role co-teacher, or system_admin (#3820).
    """
    classroom = get_classroom_or_404(classroom_id, db)
    require_editor_or_admin(classroom, current_user, db)

    classroom.join_code = generate_join_code(db)
    db.commit()
    db.refresh(classroom)
    logger.info(
        "Regenerated join code for classroom %d (by user %d)",
        classroom_id, current_user.id,
    )
    return classroom_to_response(classroom, db)
