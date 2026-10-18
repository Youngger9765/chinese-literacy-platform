"""Student management endpoints: add, remove, list, search students in a classroom."""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.school import Classroom, ClassroomStudent, ClassroomTeacher, School
from ...services.email_domains import is_public_email_domain
from ...auth.policies import is_system_admin
from ...models.user import Role, User, UserRole
from ...schemas.classroom import (
    ClassroomStudentAddRequest,
    StudentInClassroomResponse,
    StudentSearchRequest,
    StudentSearchResult,
)
from ...services.audit_logger import AuditAction, audit_log_endpoint
from .helpers import (
    create_submissions_for_new_student,
    get_classroom_or_404,
    require_member_or_admin,
    require_owner_or_admin,
)

router = APIRouter(tags=["classrooms"])
logger = logging.getLogger(__name__)



def _eligible_student_ids(classroom, teacher_id: int, db: Session):
    """Subquery of students this teacher may find/enrol in `classroom`.

    Students of the classroom's school (#3534). If that "school" is really a public
    mail domain (legacy shared gmail.com 學校 etc.), its members are strangers to each
    other, so narrow further to students this teacher created or already teaches (#3541).
    """
    q = (
        db.query(UserRole.user_id)
        .join(Role, UserRole.role_id == Role.id)
        .filter(
            UserRole.is_active == True,  # noqa: E712
            Role.name == "student",
            UserRole.scope_type == "school",
            UserRole.scope_id == str(classroom.school_id),
        )
    )
    school = db.get(School, classroom.school_id) if classroom.school_id is not None else None
    if school is not None and is_public_email_domain(school.domain):
        my_classrooms = (
            db.query(Classroom.id).filter(Classroom.teacher_id == teacher_id)
            .union(db.query(ClassroomTeacher.classroom_id).filter(ClassroomTeacher.teacher_id == teacher_id))
        )
        taught = db.query(ClassroomStudent.student_id).filter(ClassroomStudent.classroom_id.in_(my_classrooms))
        q = q.filter(or_(UserRole.granted_by == teacher_id, UserRole.user_id.in_(taught)))
    return q.scalar_subquery()


def _is_eligible_student(user_id: int, classroom, teacher_id: int, db: Session) -> bool:
    if classroom.school_id is None:
        return False
    return (
        db.query(User.id)
        .filter(User.id == user_id, User.id.in_(_eligible_student_ids(classroom, teacher_id, db)))
        .first()
        is not None
    )


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
    # Only a student of this classroom's school (#3534). Without this, any user id —
    # another school's child, a teacher, an admin — could be enrolled, after which
    # every "is this my student?" check lets the teacher read their data. Same 404
    # whether the id doesn't exist or isn't eligible, so ids can't be probed.
    if student is None or not (
        is_system_admin(current_user.id, db)
        or _is_eligible_student(student.id, classroom, current_user.id, db)
    ):
        raise HTTPException(status_code=404, detail="找不到這所學校的這位學生")

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
    db.flush()

    # Back-fill submissions for active assignments the student missed (#996)
    create_submissions_for_new_student(classroom_id, payload.student_id, db)

    db.commit()
    db.refresh(cs)
    logger.info(
        "Added student %d to classroom %d (submissions backfilled)",
        payload.student_id, classroom_id,
    )
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
    request: Request,
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

    audit_log_endpoint(
        request=request,
        action=AuditAction.DELETE_STUDENT,
        user_id=current_user.id,
        target_student_id=student_id,
    )
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
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all students enrolled in a classroom. Owner, co-teachers, and admins can access."""
    classroom = get_classroom_or_404(classroom_id, db)
    require_member_or_admin(classroom, current_user, db)

    audit_log_endpoint(
        request=request,
        action=AuditAction.LIST_STUDENTS,
        user_id=current_user.id,
        target_student_id=None,
    )

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
    query = db.query(User).filter(
        User.is_active == True,
        User.id.notin_(enrolled_ids_select.scalar_subquery()),
        or_(
            User.name.ilike(search_pattern),
            User.email.ilike(search_pattern),
        ),
    )
    # Only students of this classroom's school (#3534). Unscoped, any teacher could
    # page through every account's name and email on the platform.
    if not is_system_admin(current_user.id, db):
        query = query.filter(User.id.in_(_eligible_student_ids(classroom, current_user.id, db)))
    results = query.limit(10).all()

    return [
        StudentSearchResult(id=u.id, name=u.name, email=u.email)
        for u in results
    ]
