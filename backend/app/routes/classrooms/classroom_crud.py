"""Classroom CRUD endpoints: create, list, get detail, update."""
import logging

from fastapi import APIRouter, Depends, Query
from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.school import Classroom, ClassroomStudent, ClassroomTeacher
from ...models.user import User
from ...schemas.classroom import (
    ClassroomCreateRequest,
    ClassroomDetailResponse,
    ClassroomListResponse,
    ClassroomResponse,
    ClassroomUpdateRequest,
    StudentEnrolledClassroom,
    StudentEnrolledClassroomsResponse,
)
from .helpers import (
    classroom_to_detail_response,
    classroom_to_response,
    generate_join_code,
    get_classroom_or_404,
    is_admin,
    require_member_or_admin,
    require_owner_or_admin,
)

router = APIRouter(tags=["classrooms"])
logger = logging.getLogger(__name__)


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
    from ...models.school import School

    school = db.query(School).filter(School.id == payload.school_id).first()
    if school is None:
        raise HTTPException(status_code=404, detail="School not found")

    effective_teacher_id = current_user.id
    if payload.teacher_id is not None and payload.teacher_id != current_user.id:
        if not is_admin(current_user.id, db):
            raise HTTPException(
                status_code=403,
                detail="Only admins can create classrooms for other teachers",
            )
        target_teacher = db.query(User).filter(User.id == payload.teacher_id).first()
        if target_teacher is None:
            raise HTTPException(status_code=404, detail="Teacher user not found")
        effective_teacher_id = payload.teacher_id

    join_code = generate_join_code(db)
    classroom = Classroom(
        name=payload.name,
        school_id=payload.school_id,
        teacher_id=effective_teacher_id,
        grade=payload.grade,
        join_code=join_code,
    )
    db.add(classroom)
    db.flush()

    primary_ct = ClassroomTeacher(
        classroom_id=classroom.id,
        teacher_id=effective_teacher_id,
        role="primary",
        invited_by=current_user.id,
    )
    db.add(primary_ct)
    db.commit()
    db.refresh(classroom)
    logger.info(
        "Created classroom %d '%s' for teacher %d in school %d (by user %d)",
        classroom.id, classroom.name, effective_teacher_id, payload.school_id, current_user.id,
    )
    return classroom_to_response(classroom, db)


@router.get("/classrooms", response_model=ClassroomListResponse)
def list_my_classrooms(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List classrooms where the current teacher is owner or co-teacher."""
    co_teacher_classroom_ids = (
        db.query(ClassroomTeacher.classroom_id)
        .filter(ClassroomTeacher.teacher_id == current_user.id)
        .scalar_subquery()
    )
    query = db.query(Classroom).filter(
        or_(
            Classroom.teacher_id == current_user.id,
            Classroom.id.in_(co_teacher_classroom_ids),
        )
    )
    total = query.count()
    items = query.order_by(Classroom.created_at.desc()).offset(offset).limit(limit).all()

    if not items:
        return ClassroomListResponse(items=[], total=total)

    classroom_ids = [c.id for c in items]
    student_count_rows = (
        db.query(ClassroomStudent.classroom_id, func.count(ClassroomStudent.id).label("cnt"))
        .filter(ClassroomStudent.classroom_id.in_(classroom_ids))
        .group_by(ClassroomStudent.classroom_id)
        .all()
    )
    student_counts = {row.classroom_id: row.cnt for row in student_count_rows}

    return ClassroomListResponse(
        items=[
            ClassroomResponse(
                id=c.id,
                name=c.name,
                school_id=c.school_id,
                teacher_id=c.teacher_id,
                grade=c.grade,
                join_code=c.join_code,
                is_active=c.is_active,
                created_at=c.created_at,
                student_count=student_counts.get(c.id, 0),
            )
            for c in items
        ],
        total=total,
    )


@router.get("/classrooms/csv-template")
def download_csv_template(
    current_user: User = Depends(get_current_user),
):
    """Return a sample CSV template for batch student import.

    IMPORTANT: This route MUST appear before /classrooms/{classroom_id} so that
    FastAPI does not try to parse 'csv-template' as an integer classroom_id.

    The template contains a header row and two example rows.
    Encoded as UTF-8 with BOM so Excel opens it correctly.
    """
    import csv
    import io

    from fastapi.responses import StreamingResponse

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["name", "seat_number"])
    writer.writerow(["王小明", "01"])
    writer.writerow(["李小美", "02"])
    csv_content = output.getvalue()
    output.close()

    return StreamingResponse(
        iter([csv_content.encode("utf-8-sig")]),
        media_type="text/csv; charset=UTF-8",
        headers={"Content-Disposition": 'attachment; filename="student-import-template.csv"'},
    )


@router.get("/classrooms/my-enrollments", response_model=StudentEnrolledClassroomsResponse)
def list_my_enrolled_classrooms(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the classrooms the current user is enrolled in as a student.

    IMPORTANT: This route MUST appear before /classrooms/{classroom_id} so that
    FastAPI does not try to parse 'my-enrollments' as an integer classroom_id.

    Returns classroom details including teacher name for the student dashboard.
    """
    rows = (
        db.query(ClassroomStudent, Classroom, User)
        .join(Classroom, Classroom.id == ClassroomStudent.classroom_id)
        .join(User, User.id == Classroom.teacher_id)
        .filter(ClassroomStudent.student_id == current_user.id)
        .order_by(ClassroomStudent.enrolled_at.desc())
        .all()
    )

    classrooms = [
        StudentEnrolledClassroom(
            id=classroom.id,
            name=classroom.name,
            grade=classroom.grade,
            teacher_id=classroom.teacher_id,
            teacher_name=teacher.name,
            is_active=classroom.is_active,
            enrolled_at=cs.enrolled_at,
        )
        for cs, classroom, teacher in rows
    ]

    return StudentEnrolledClassroomsResponse(classrooms=classrooms, total=len(classrooms))


@router.get("/classrooms/{classroom_id}", response_model=ClassroomDetailResponse)
def get_classroom_detail(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get classroom detail including student list. Owner, co-teachers, and admins can access."""
    classroom = (
        db.query(Classroom)
        .options(
            joinedload(Classroom.classroom_students).joinedload(ClassroomStudent.student)
        )
        .filter(Classroom.id == classroom_id)
        .first()
    )
    if classroom is None:
        raise HTTPException(status_code=404, detail="Classroom not found")
    require_member_or_admin(classroom, current_user, db)
    return classroom_to_detail_response(classroom)


@router.patch("/classrooms/{classroom_id}", response_model=ClassroomResponse)
def update_classroom(
    classroom_id: int,
    payload: ClassroomUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update classroom fields (name, grade, is_active). Only the teacher can update."""
    classroom = get_classroom_or_404(classroom_id, db)
    require_owner_or_admin(classroom, current_user, db)

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(classroom, field, value)

    db.commit()
    db.refresh(classroom)
    logger.info("Updated classroom %d: %s", classroom_id, list(update_data.keys()))
    return classroom_to_response(classroom, db)
