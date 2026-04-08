"""CSV upload endpoint and parsing logic for batch student import."""
import csv
import io
import logging
import secrets
import string

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.school import ClassroomStudent
from ...models.user import Role, StudentProfile, User, UserRole
from ...schemas.classroom import BatchStudentError, CreatedStudentInfo, CsvUploadResponse
from ...auth.password import hash_password
from .helpers import (
    check_email_domain,
    create_submissions_for_new_student,
    get_classroom_or_404,
    require_owner_or_admin,
)

router = APIRouter(tags=["classrooms"])
logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

_CSV_MAX_FILE_BYTES = 1_000_000  # 1 MB
_CSV_MAX_STUDENTS = 100

# Recognised header aliases (case-insensitive) for the two columns
_NAME_HEADERS = {"name", "姓名", "student_name", "學生姓名"}
_SEAT_HEADERS = {"seat_number", "seat", "座號", "no", "number", "編號"}


# ── CSV Parsing ───────────────────────────────────────────────────────────────


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

    first = [cell.strip().lower() for cell in rows[0]]
    has_header = any(cell in _NAME_HEADERS or cell in _SEAT_HEADERS for cell in first)
    data_rows = rows[1:] if has_header else rows

    results: list[tuple[str, str, str | None]] = []
    for idx, row in enumerate(data_rows, start=2 if has_header else 1):
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


# ── Endpoint ──────────────────────────────────────────────────────────────────


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
    from ...models.school import School

    classroom = get_classroom_or_404(classroom_id, db)
    require_owner_or_admin(classroom, current_user, db)

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

    # ── 3. Batch-create students ──────────────────────────────────────────────
    student_role = db.query(Role).filter(Role.name == "student").first()

    school = db.query(School).filter(School.id == classroom.school_id).first()
    school_domain = school.domain if school else None

    created: list[CreatedStudentInfo] = []
    errors: list[BatchStudentError] = []
    warnings: list[str] = []

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

            domain_warning = check_email_domain(email, school_domain)
            if domain_warning:
                warnings.append(domain_warning)

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

            # Back-fill submissions for active assignments (#996)
            create_submissions_for_new_student(classroom_id, user.id, db)

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
        "CSV upload: created %d, skipped %d, warnings %d for classroom %d (by user %d)",
        len(created), skipped_count, len(warnings), classroom_id, current_user.id,
    )
    return CsvUploadResponse(
        created_count=len(created),
        skipped_count=skipped_count,
        errors=errors,
        created=created,
        warnings=warnings,
    )
