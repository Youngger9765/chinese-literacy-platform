import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.school import Classroom, ClassroomStudent, School
from ..models.user import Role, User, UserRole
from ..schemas.classroom import (
    ClassroomCreateRequest,
    ClassroomDetailResponse,
    ClassroomListResponse,
    ClassroomResponse,
    ClassroomStudentAddRequest,
    ClassroomUpdateRequest,
    StudentInClassroomResponse,
)

router = APIRouter(tags=["classrooms"])
logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _get_classroom_or_404(classroom_id: int, db: Session) -> Classroom:
    """Fetch a classroom by ID or raise 404."""
    classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
    if classroom is None:
        raise HTTPException(status_code=404, detail="Classroom not found")
    return classroom


def _require_owner_or_admin(classroom: Classroom, current_user: User, db: Session) -> None:
    """Allow classroom teacher OR system/org admin. Raise 403 otherwise."""
    if classroom.teacher_id == current_user.id:
        return
    # Check if user has admin role
    admin_role = (
        db.query(UserRole)
        .join(Role)
        .filter(
            UserRole.user_id == current_user.id,
            UserRole.is_active == True,
            Role.name.in_(["system_admin", "org_admin"]),
        )
        .first()
    )
    if admin_role:
        return
    raise HTTPException(status_code=403, detail="Not your classroom")


def _is_admin(user_id: int, db: Session) -> bool:
    """Check if a user has system_admin or org_admin role."""
    return (
        db.query(UserRole)
        .join(Role)
        .filter(
            UserRole.user_id == user_id,
            UserRole.is_active == True,
            Role.name.in_(["system_admin", "org_admin"]),
        )
        .first()
    ) is not None


def _student_count(classroom: Classroom) -> int:
    """Return the number of enrolled students."""
    return len(classroom.classroom_students)


def _classroom_to_response(classroom: Classroom) -> ClassroomResponse:
    """Convert a Classroom ORM object to a ClassroomResponse."""
    return ClassroomResponse(
        id=classroom.id,
        name=classroom.name,
        school_id=classroom.school_id,
        teacher_id=classroom.teacher_id,
        grade=classroom.grade,
        is_active=classroom.is_active,
        created_at=classroom.created_at,
        student_count=_student_count(classroom),
    )


def _classroom_to_detail_response(classroom: Classroom) -> ClassroomDetailResponse:
    """Convert a Classroom ORM object to a ClassroomDetailResponse with students."""
    students = [
        StudentInClassroomResponse(
            id=cs.student.id,
            name=cs.student.name,
            email=cs.student.email,
            enrolled_at=cs.enrolled_at,
        )
        for cs in classroom.classroom_students
    ]
    return ClassroomDetailResponse(
        id=classroom.id,
        name=classroom.name,
        school_id=classroom.school_id,
        teacher_id=classroom.teacher_id,
        grade=classroom.grade,
        is_active=classroom.is_active,
        created_at=classroom.created_at,
        student_count=_student_count(classroom),
        students=students,
    )


# ── Classroom CRUD ───────────────────────────────────────────────────────────


@router.post("/classrooms", status_code=201, response_model=ClassroomResponse)
def create_classroom(
    payload: ClassroomCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new classroom.

    teacher_id defaults to the current user. Admins (system_admin / org_admin)
    may specify a different teacher_id to create classrooms on behalf of a teacher.
    """
    # Verify school exists
    school = db.query(School).filter(School.id == payload.school_id).first()
    if school is None:
        raise HTTPException(status_code=404, detail="School not found")

    # Determine the effective teacher_id
    effective_teacher_id = current_user.id
    if payload.teacher_id is not None and payload.teacher_id != current_user.id:
        if not _is_admin(current_user.id, db):
            raise HTTPException(
                status_code=403,
                detail="Only admins can create classrooms for other teachers",
            )
        # Validate that the target teacher user exists
        target_teacher = db.query(User).filter(User.id == payload.teacher_id).first()
        if target_teacher is None:
            raise HTTPException(status_code=404, detail="Teacher user not found")
        effective_teacher_id = payload.teacher_id

    classroom = Classroom(
        name=payload.name,
        school_id=payload.school_id,
        teacher_id=effective_teacher_id,
        grade=payload.grade,
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)
    logger.info(
        "Created classroom %d '%s' for teacher %d in school %d (by user %d)",
        classroom.id, classroom.name, effective_teacher_id, payload.school_id, current_user.id,
    )
    return _classroom_to_response(classroom)


@router.get("/classrooms", response_model=ClassroomListResponse)
def list_my_classrooms(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List classrooms owned by the current teacher."""
    query = db.query(Classroom).filter(Classroom.teacher_id == current_user.id)
    total = query.count()
    items = query.order_by(Classroom.created_at.desc()).offset(offset).limit(limit).all()
    return ClassroomListResponse(
        items=[_classroom_to_response(c) for c in items],
        total=total,
    )


@router.get("/classrooms/{classroom_id}", response_model=ClassroomDetailResponse)
def get_classroom_detail(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get classroom detail including student list. Only the classroom's teacher can access."""
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)
    return _classroom_to_detail_response(classroom)


@router.patch("/classrooms/{classroom_id}", response_model=ClassroomResponse)
def update_classroom(
    classroom_id: int,
    payload: ClassroomUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update classroom fields (name, grade, is_active). Only the teacher can update."""
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(classroom, field, value)

    db.commit()
    db.refresh(classroom)
    logger.info("Updated classroom %d: %s", classroom_id, list(update_data.keys()))
    return _classroom_to_response(classroom)


# ── Classroom Student Management ─────────────────────────────────────────────


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
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    # Verify the student user exists
    student = db.query(User).filter(User.id == payload.student_id).first()
    if student is None:
        raise HTTPException(status_code=404, detail="Student user not found")

    # Check for duplicate enrollment
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
    logger.info(
        "Added student %d to classroom %d", payload.student_id, classroom_id,
    )
    return StudentInClassroomResponse(
        id=student.id,
        name=student.name,
        email=student.email,
        enrolled_at=cs.enrolled_at,
    )


@router.delete(
    "/classrooms/{classroom_id}/students/{student_id}",
    status_code=200,
)
def remove_student_from_classroom(
    classroom_id: int,
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove a student from a classroom. Only the classroom's teacher can do this."""
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

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
    return {"message": "Student removed from classroom"}


@router.get(
    "/classrooms/{classroom_id}/students",
    response_model=list[StudentInClassroomResponse],
)
def list_classroom_students(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all students enrolled in a classroom. Only the classroom's teacher can access."""
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    return [
        StudentInClassroomResponse(
            id=cs.student.id,
            name=cs.student.name,
            email=cs.student.email,
            enrolled_at=cs.enrolled_at,
        )
        for cs in classroom.classroom_students
    ]
