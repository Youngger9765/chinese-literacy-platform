"""Student management endpoints: add, remove, list, search students in a classroom."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.school import ClassroomStudent
from ...models.user import User
from ...schemas.classroom import (
    ClassroomStudentAddRequest,
    StudentInClassroomResponse,
    StudentSearchRequest,
    StudentSearchResult,
)
from .helpers import (
    get_classroom_or_404,
    require_member_or_admin,
    require_owner_or_admin,
)

router = APIRouter(tags=["classrooms"])
logger = logging.getLogger(__name__)


@router.post(
    "/classrooms/{classroom_id}/students",
    status_code=201,
    response_model=StudentInClassroomResponse,
)
def add_student_to_classroom(
    classroom_id: int,
    payload: ClassroomStudentAddRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add a student to a classroom by user ID. Only the classroom's teacher can do this."""
    classroom = get_classroom_or_404(classroom_id, db)
    require_owner_or_admin(classroom, current_user, db)

    student = db.query(User).filter(User.id == payload.student_id).first()
    if student is None:
        raise HTTPException(status_code=404, detail="Student user not found")

    existing = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.student_id == payload.student_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Student already in classroom")

    cs = ClassroomStudent(
        classroom_id=classroom_id,
        student_id=payload.student_id,
    )
    db.add(cs)
    db.commit()
    db.refresh(cs)
    logger.info("Added student %d to classroom %d", payload.student_id, classroom_id)
    return StudentInClassroomResponse(
        id=student.id,
        name=student.name,
        email=student.email,
        enrolled_at=cs.enrolled_at,
    )


@router.delete(
    "/classrooms/{classroom_id}/students/{student_id}",
    status_code=204,
    response_model=None,
)
def remove_student_from_classroom(
    classroom_id: int,
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove a student from a classroom. Only the classroom's teacher can do this."""
    classroom = get_classroom_or_404(classroom_id, db)
    require_owner_or_admin(classroom, current_user, db)

    cs = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.student_id == student_id,
        )
        .first()
    )
    if cs is None:
        raise HTTPException(status_code=404, detail="Student not in classroom")

    db.delete(cs)
    db.commit()
    logger.info("Removed student %d from classroom %d", student_id, classroom_id)
    return None


@router.get(
    "/classrooms/{classroom_id}/students",
    response_model=list[StudentInClassroomResponse],
)
def list_classroom_students(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all students enrolled in a classroom. Owner, co-teachers, and admins can access."""
    classroom = get_classroom_or_404(classroom_id, db)
    require_member_or_admin(classroom, current_user, db)

    enrollments = (
        db.query(ClassroomStudent)
        .options(joinedload(ClassroomStudent.student))
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )

    return [
        StudentInClassroomResponse(
            id=cs.student.id,
            name=cs.student.name,
            email=cs.student.email,
            enrolled_at=cs.enrolled_at,
        )
        for cs in enrollments
    ]


@router.post(
    "/classrooms/{classroom_id}/students/search",
    response_model=list[StudentSearchResult],
)
def search_students_for_classroom(
    classroom_id: int,
    payload: StudentSearchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Search for users by name or email who are NOT already in this classroom.

    Returns up to 10 matching results. Used by the 'add existing student' UI.
    Requires classroom owner or admin.
    """
    from sqlalchemy import or_

    classroom = get_classroom_or_404(classroom_id, db)
    require_owner_or_admin(classroom, current_user, db)

    enrolled_ids_select = (
        db.query(ClassroomStudent.student_id)
        .filter(ClassroomStudent.classroom_id == classroom_id)
    )

    search_pattern = f"%{payload.query}%"
    results = (
        db.query(User)
        .filter(
            User.is_active == True,
            User.id.notin_(enrolled_ids_select.scalar_subquery()),
            or_(
                User.name.ilike(search_pattern),
                User.email.ilike(search_pattern),
            ),
        )
        .limit(10)
        .all()
    )

    return [
        StudentSearchResult(id=u.id, name=u.name, email=u.email)
        for u in results
    ]
