import csv
import io
import logging
import secrets
import string

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.password import hash_password
from ..database import get_db
from ..models.school import Classroom, ClassroomStudent, ClassroomTeacher, School
from ..models.user import Role, StudentProfile, User, UserRole
from ..schemas.classroom import (
    BatchStudentCreateRequest,
    BatchStudentCreateResponse,
    BatchStudentError,
    ClassroomCreateRequest,
    ClassroomDetailResponse,
    ClassroomJoinRequest,
    ClassroomListResponse,
    ClassroomResponse,
    ClassroomStudentAddRequest,
    ClassroomUpdateRequest,
    CreatedStudentInfo,
    CsvUploadResponse,
    StudentEnrolledClassroom,
    StudentEnrolledClassroomsResponse,
    StudentInClassroomResponse,
    StudentSearchRequest,
    StudentSearchResult,
)

router = APIRouter(tags=["classrooms"])
logger = logging.getLogger(__name__)

_JOIN_CODE_LENGTH = 6
_JOIN_CODE_CHARS = string.ascii_uppercase + string.digits
_JOIN_CODE_MAX_RETRIES = 10


# ── Helpers ──────────────────────────────────────────────────────────────────


def _generate_join_code(db: Session, length: int = _JOIN_CODE_LENGTH) -> str:
    """Generate a unique random join code for a classroom.

    Retries up to _JOIN_CODE_MAX_RETRIES times in case of collision.
    """
    for _ in range(_JOIN_CODE_MAX_RETRIES):
        code = "".join(secrets.choice(_JOIN_CODE_CHARS) for _ in range(length))
        existing = db.query(Classroom).filter(Classroom.join_code == code).first()
        if existing is None:
            return code
    raise HTTPException(
        status_code=500,
        detail="Failed to generate unique join code after multiple retries",
    )


def _get_classroom_or_404(classroom_id: int, db: Session) -> Classroom:
    """Fetch a classroom by ID or raise 404."""
    classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
    if classroom is None:
        raise HTTPException(status_code=404, detail="Classroom not found")
    return classroom


def _require_owner_or_admin(classroom: Classroom, current_user: User, db: Session) -> None:
    """Allow classroom teacher (primary) OR system/org admin. Raise 403 otherwise.

    For co-teachers (assistants) use _require_member_or_admin which also allows assistants.
    """
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


def _require_member_or_admin(classroom: Classroom, current_user: User, db: Session) -> None:
    """Allow classroom owner, co-teachers (assistants), or system/org admins.

    Used for read-only endpoints like viewing student progress.
    """
    if classroom.teacher_id == current_user.id:
        return
    # Check co-teacher membership
    ct = (
        db.query(ClassroomTeacher)
        .filter(
            ClassroomTeacher.classroom_id == classroom.id,
            ClassroomTeacher.teacher_id == current_user.id,
        )
        .first()
    )
    if ct:
        return
    # Check admin role
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


def _student_count(classroom: Classroom, db: Session) -> int:
    """Return the number of enrolled students via a COUNT query."""
    return (
        db.query(func.count(ClassroomStudent.student_id))
        .filter(ClassroomStudent.classroom_id == classroom.id)
        .scalar()
    )


def _classroom_to_response(classroom: Classroom, db: Session) -> ClassroomResponse:
    """Convert a Classroom ORM object to a ClassroomResponse."""
    return ClassroomResponse(
        id=classroom.id,
        name=classroom.name,
        school_id=classroom.school_id,
        teacher_id=classroom.teacher_id,
        grade=classroom.grade,
        join_code=classroom.join_code,
        is_active=classroom.is_active,
        created_at=classroom.created_at,
        student_count=_student_count(classroom, db),
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
        join_code=classroom.join_code,
        is_active=classroom.is_active,
        created_at=classroom.created_at,
        student_count=len(students),
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

    join_code = _generate_join_code(db)
    classroom = Classroom(
        name=payload.name,
        school_id=payload.school_id,
        teacher_id=effective_teacher_id,
        grade=payload.grade,
        join_code=join_code,
    )
    db.add(classroom)
    db.flush()  # Get classroom.id before adding junction row

    # Auto-insert primary teacher into classroom_teachers junction table
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
    return _classroom_to_response(classroom, db)


@router.get("/classrooms", response_model=ClassroomListResponse)
def list_my_classrooms(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List classrooms where the current teacher is owner or co-teacher."""
    # Classrooms where user is co-teacher (via classroom_teachers)
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
    return ClassroomListResponse(
        items=[_classroom_to_response(c, db) for c in items],
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
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_member_or_admin(classroom, current_user, db)
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
    return _classroom_to_response(classroom, db)


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
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_member_or_admin(classroom, current_user, db)

    return [
        StudentInClassroomResponse(
            id=cs.student.id,
            name=cs.student.name,
            email=cs.student.email,
            enrolled_at=cs.enrolled_at,
        )
        for cs in classroom.classroom_students
    ]


# ── Join Code Management ────────────────────────────────────────────────────


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
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    classroom.join_code = _generate_join_code(db)
    db.commit()
    db.refresh(classroom)
    logger.info(
        "Regenerated join code for classroom %d (by user %d)",
        classroom_id, current_user.id,
    )
    return _classroom_to_response(classroom, db)


@router.post("/classrooms/join", status_code=200, response_model=ClassroomResponse)
def join_classroom_by_code(
    payload: ClassroomJoinRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Join a classroom using a join code. Enrolls the current user as a student."""
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

    # Check for duplicate enrollment
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
    return _classroom_to_response(classroom, db)


# ── Batch Student Creation ──────────────────────────────────────────────────


@router.post(
    "/classrooms/{classroom_id}/students/batch",
    status_code=201,
    response_model=BatchStudentCreateResponse,
)
def batch_create_students(
    classroom_id: int,
    payload: BatchStudentCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Batch-create student accounts and enroll them in a classroom.

    For each student, generates a unique email and random password.
    Requires classroom owner or admin.
    """
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    if not classroom.join_code:
        raise HTTPException(
            status_code=400,
            detail="Classroom has no join code; cannot generate student usernames",
        )

    # Find the student role for assignment
    student_role = db.query(Role).filter(Role.name == "student").first()

    created: list[CreatedStudentInfo] = []
    errors: list[BatchStudentError] = []

    for item in payload.students:
        try:
            savepoint = db.begin_nested()
            username = f"{classroom.join_code}{item.seat_number}"
            email = f"{username.lower()}@student.lingoleap.local"

            # Check if email already exists
            existing_user = db.query(User).filter(User.email == email).first()
            if existing_user:
                savepoint.rollback()
                errors.append(BatchStudentError(
                    name=item.name,
                    seat_number=item.seat_number,
                    error=f"User with email {email} already exists",
                ))
                continue

            # Generate random password (8-char uppercase + digits)
            password = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))
            user = User(
                email=email,
                username=username.upper(),
                password_hash=hash_password(password),
                name=item.name,
                is_active=True,
            )
            db.add(user)
            db.flush()  # Get user.id

            # Create student profile (use username as student_number for school-level uniqueness)
            profile = StudentProfile(
                user_id=user.id,
                school_id=classroom.school_id,
                student_number=username.upper(),
                password_changed=False,
            )
            db.add(profile)

            # Assign student role scoped to the classroom's school
            if student_role:
                user_role = UserRole(
                    user_id=user.id,
                    role_id=student_role.id,
                    scope_type="school",
                    scope_id=str(classroom.school_id),
                    granted_by=current_user.id,
                )
                db.add(user_role)

            # Enroll in classroom
            cs = ClassroomStudent(
                classroom_id=classroom_id,
                student_id=user.id,
            )
            db.add(cs)
            db.flush()

            created.append(CreatedStudentInfo(
                name=item.name,
                seat_number=item.seat_number,
                username=username,
                password=password,
                user_id=user.id,
            ))
        except Exception as e:
            savepoint.rollback()
            logger.error(
                "Error creating student %s (seat %s): %s",
                item.name, item.seat_number, e,
            )
            errors.append(BatchStudentError(
                name=item.name,
                seat_number=item.seat_number,
                error=str(e),
            ))

    db.commit()
    logger.info(
        "Batch created %d students for classroom %d (errors: %d)",
        len(created), classroom_id, len(errors),
    )
    return BatchStudentCreateResponse(created=created, errors=errors)


# ── Student Search ──────────────────────────────────────────────────────────


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
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    # Get IDs of students already in this classroom
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


# ── CSV Upload ───────────────────────────────────────────────────────────────

_CSV_MAX_FILE_BYTES = 1_000_000  # 1 MB
_CSV_MAX_STUDENTS = 100

# Recognised header aliases (case-insensitive) for the two columns
_NAME_HEADERS = {"name", "姓名", "student_name", "學生姓名"}
_SEAT_HEADERS = {"seat_number", "seat", "座號", "no", "number", "編號"}


def _parse_csv_rows(content: str) -> list[tuple[str, str, str | None]]:
    """Parse CSV content into (name, seat_number, error) tuples.

    Returns a list of tuples:
      - (name, seat_number, None) for valid rows
      - ("", "", error_msg)       for invalid rows
    If the first row looks like a header, it is skipped.
    """
    reader = csv.reader(io.StringIO(content))
    rows = list(reader)
    if not rows:
        return []

    # Detect header row: if first row contains recognised header keywords
    first = [cell.strip().lower() for cell in rows[0]]
    has_header = any(cell in _NAME_HEADERS or cell in _SEAT_HEADERS for cell in first)
    data_rows = rows[1:] if has_header else rows

    results: list[tuple[str, str, str | None]] = []
    for idx, row in enumerate(data_rows, start=2 if has_header else 1):
        # Skip entirely blank lines
        if all(cell.strip() == "" for cell in row):
            continue

        if len(row) < 2:
            results.append(("", "", f"第 {idx} 行：欄位數不足（需要 姓名, 座號）"))
            continue

        name = row[0].strip()
        seat_number = row[1].strip()

        if not name:
            results.append(("", seat_number, f"第 {idx} 行：姓名不能為空"))
            continue

        if not seat_number:
            results.append((name, "", f"第 {idx} 行：座號不能為空"))
            continue

        results.append((name, seat_number, None))

    return results


@router.post(
    "/classrooms/{classroom_id}/students/upload-csv",
    status_code=201,
    response_model=CsvUploadResponse,
)
async def upload_csv_students(
    classroom_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Batch-create student accounts from an uploaded CSV file.

    CSV format (header row optional):
        name,seat_number

    Rules:
    - Max file size: 1 MB
    - Max students per upload: 100
    - Rows with invalid data are skipped and reported in errors[]
    - Duplicate seat numbers (same classroom join_code) are skipped

    Returns created_count, skipped_count, errors[], created[].
    """
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    if not classroom.join_code:
        raise HTTPException(
            status_code=400,
            detail="Classroom has no join code; cannot generate student usernames",
        )

    # ── 1. Read and size-check the file ──────────────────────────────────────
    raw_bytes = await file.read()

    if len(raw_bytes) == 0:
        raise HTTPException(status_code=422, detail="上傳的 CSV 檔案是空的")

    if len(raw_bytes) > _CSV_MAX_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"檔案過大（最大 {_CSV_MAX_FILE_BYTES // 1_000_000} MB）",
        )

    # Decode: try utf-8-sig first (strips BOM), fall back to utf-8
    try:
        content = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            content = raw_bytes.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(status_code=422, detail="檔案編碼不支援，請使用 UTF-8")

    # ── 2. Parse rows ─────────────────────────────────────────────────────────
    parsed = _parse_csv_rows(content)

    valid_rows = [(name, seat) for name, seat, err in parsed if err is None]
    invalid_rows = [(name, seat, err) for name, seat, err in parsed if err is not None]

    if len(valid_rows) > _CSV_MAX_STUDENTS:
        raise HTTPException(
            status_code=422,
            detail=f"一次最多可匯入 {_CSV_MAX_STUDENTS} 位學生（本次 CSV 含 {len(valid_rows)} 筆有效資料）",
        )

    # ── 3. Batch-create students (same logic as JSON batch endpoint) ──────────
    student_role = db.query(Role).filter(Role.name == "student").first()

    created: list[CreatedStudentInfo] = []
    errors: list[BatchStudentError] = []

    # Carry forward parse errors as skipped entries
    for _name, _seat, err_msg in invalid_rows:
        errors.append(BatchStudentError(
            name=_name or "(未知)",
            seat_number=_seat or "(未知)",
            error=err_msg or "格式錯誤",
        ))

    for name, seat_number in valid_rows:
        try:
            savepoint = db.begin_nested()
            username = f"{classroom.join_code}{seat_number}"
            email = f"{username.lower()}@student.lingoleap.local"

            existing_user = db.query(User).filter(User.email == email).first()
            if existing_user:
                savepoint.rollback()
                errors.append(BatchStudentError(
                    name=name,
                    seat_number=seat_number,
                    error=f"座號 {seat_number} 已存在（帳號 {username} 重複）",
                ))
                continue

            password = "".join(
                secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8)
            )
            user = User(
                email=email,
                username=username.upper(),
                password_hash=hash_password(password),
                name=name,
                is_active=True,
            )
            db.add(user)
            db.flush()

            profile = StudentProfile(
                user_id=user.id,
                school_id=classroom.school_id,
                student_number=username.upper(),
                password_changed=False,
            )
            db.add(profile)

            if student_role:
                user_role = UserRole(
                    user_id=user.id,
                    role_id=student_role.id,
                    scope_type="school",
                    scope_id=str(classroom.school_id),
                    granted_by=current_user.id,
                )
                db.add(user_role)

            cs = ClassroomStudent(
                classroom_id=classroom_id,
                student_id=user.id,
            )
            db.add(cs)
            db.flush()

            created.append(CreatedStudentInfo(
                name=name,
                seat_number=seat_number,
                username=username,
                password=password,
                user_id=user.id,
            ))
        except Exception as exc:
            savepoint.rollback()
            logger.error(
                "CSV upload: error creating student %s (seat %s): %s",
                name, seat_number, exc,
            )
            errors.append(BatchStudentError(
                name=name,
                seat_number=seat_number,
                error=str(exc),
            ))

    db.commit()
    skipped_count = len(errors)
    logger.info(
        "CSV upload: created %d, skipped %d for classroom %d (by user %d)",
        len(created), skipped_count, classroom_id, current_user.id,
    )
    return CsvUploadResponse(
        created_count=len(created),
        skipped_count=skipped_count,
        errors=errors,
        created=created,
    )
