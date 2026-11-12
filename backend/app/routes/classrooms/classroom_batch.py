"""Batch student creation endpoints (JSON payload)."""
import logging
import secrets
import string

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.password import hash_password
from ...auth.rate_limiter import InMemoryRateLimiter
from ...database import get_db
from ...models.assignment import Assignment, AssignmentSubmission
from ...models.school import ClassroomStudent
from ...models.user import Role, StudentProfile, User, UserRole
from ...schemas.classroom import (
    BatchStudentByPrefixRequest,
    BatchStudentCreateRequest,
    BatchStudentCreateResponse,
    BatchStudentError,
    CreatedStudentInfo,
)
from ...services.input_sanitizer import sanitize_ai_input
from .helpers import (
    check_email_domain,
    create_submissions_for_new_student,
    get_classroom_or_404,
    require_editor_or_admin,
)

router = APIRouter(tags=["classrooms"])
logger = logging.getLogger(__name__)

# Junyi-parity batch-by-prefix endpoint (#3991): a dedicated bucket so a
# teacher batch-creating a lot of classes in a row can't starve the
# unrelated roster-based /students/batch endpoint's budget (same reasoning
# as _junyi_import_rate_limiter being separate from the shared ai_rate_
# limiter -- see rate_limiter.py's module docstring).
_batch_prefix_rate_limiter = InMemoryRateLimiter()


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
    Owner, accepted 'editor'-role co-teacher, or system_admin (#3820).
    """
    from ...models.school import School

    classroom = get_classroom_or_404(classroom_id, db)
    require_editor_or_admin(classroom, current_user, db)

    if not classroom.join_code:
        raise HTTPException(
            status_code=400,
            detail="Classroom has no join code; cannot generate student usernames",
        )

    student_role = db.query(Role).filter(Role.name == "student").first()

    school = db.query(School).filter(School.id == classroom.school_id).first()
    school_domain = school.domain if school else None

    created: list[CreatedStudentInfo] = []
    errors: list[BatchStudentError] = []
    warnings: list[str] = []

    for item in payload.students:
        try:
            savepoint = db.begin_nested()
            # Sanitize student name — displayed in reports and potentially used in AI contexts
            safe_name, _ = sanitize_ai_input(item.name, user_id=str(current_user.id))
            username = f"{classroom.join_code}{item.seat_number}"
            email = f"{username.lower()}@student.lingoleap.local"

            existing_user = db.query(User).filter(User.email == email).first()
            if existing_user:
                savepoint.rollback()
                errors.append(BatchStudentError(
                    name=item.name,
                    seat_number=item.seat_number,
                    error=f"User with email {email} already exists",
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
                name=safe_name,
                is_active=True,
                created_by_teacher_id=current_user.id,
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
        "Batch created %d students for classroom %d (errors: %d, warnings: %d)",
        len(created), classroom_id, len(errors), len(warnings),
    )
    return BatchStudentCreateResponse(created=created, errors=errors, warnings=warnings)


@router.post(
    "/classrooms/{classroom_id}/students/batch-by-prefix",
    status_code=201,
    response_model=BatchStudentCreateResponse,
)
def batch_create_students_by_prefix(
    classroom_id: int,
    payload: BatchStudentByPrefixRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Junyi-parity batch creation: teacher-chosen prefix + ONE shared
    password + count -- creates `{prefix}01`..`{prefix}NN` accounts (#3991).

    Unlike `batch_create_students` above (one name + seat_number per
    student, a random per-student password), this mirrors Junyi's
    「不確定學生有沒有帳號：幫學生創建均一帳號」 flow
    (create-studentlist-modal/utils/accountUtils.js generateLists /
    generateChildAccounts): the teacher doesn't name each student up
    front, they pick an account-name prefix and a single initial
    password every generated account starts with.

    Authorization: owner, accepted 'editor'-role co-teacher, or
    system_admin -- same gate as /students/batch (#3820).
    """
    classroom = get_classroom_or_404(classroom_id, db)
    require_editor_or_admin(classroom, current_user, db)

    rl_info = _batch_prefix_rate_limiter.check_with_info(
        f"batch-prefix:{current_user.id}", 10, 60
    )
    if not rl_info.allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please wait before retrying.",
        )

    student_role = db.query(Role).filter(Role.name == "student").first()

    prefix_lower = payload.prefix.lower()
    # Junyi's own default: 2-digit zero padding, widened only if `count`
    # itself needs more digits than that (accountUtils.js generateLists'
    # PREFIX_DEFAULT_LENGTH=2 rule, for the no-trailing-digits case this
    # endpoint always is -- the prefix is schema-validated to letters+
    # digits with no numbering convention of its own).
    digit_width = max(2, len(str(payload.count)))
    # Hashed ONCE outside the loop -- every generated account shares this
    # SAME password by design (that's the whole point of this endpoint vs.
    # the random-per-student /students/batch), and bcrypt is deliberately
    # expensive; hashing an identical value `count` times would be
    # `count`x the cost for the same result.
    password_hash = hash_password(payload.password)

    created: list[CreatedStudentInfo] = []
    errors: list[BatchStudentError] = []

    for i in range(1, payload.count + 1):
        seat_number = str(i).zfill(digit_width)
        username = f"{prefix_lower}{seat_number}".upper()
        email = f"{username.lower()}@student.lingoleap.local"
        savepoint = None
        try:
            savepoint = db.begin_nested()

            existing_user = db.query(User).filter(User.email == email).first()
            if existing_user:
                savepoint.rollback()
                errors.append(BatchStudentError(
                    name=username,
                    seat_number=seat_number,
                    error=f"帳號 {username} 已經存在",
                ))
                continue

            user = User(
                email=email,
                username=username,
                password_hash=password_hash,
                # No real name is collected in this flow -- Junyi's own
                # preview table only ever shows 帳號/密碼, never a name
                # column (StudentsTable.js). The account identifier
                # doubles as the display name; it's already restricted to
                # ASCII letters/digits by the prefix schema validator, so
                # there's nothing here sanitize_ai_input would catch.
                name=username,
                is_active=True,
                created_by_teacher_id=current_user.id,
            )
            db.add(user)
            db.flush()

            profile = StudentProfile(
                user_id=user.id,
                school_id=classroom.school_id,
                student_number=username,
                password_changed=False,
            )
            db.add(profile)

            if student_role:
                db.add(UserRole(
                    user_id=user.id,
                    role_id=student_role.id,
                    scope_type="school",
                    scope_id=str(classroom.school_id),
                    granted_by=current_user.id,
                ))

            db.add(ClassroomStudent(classroom_id=classroom_id, student_id=user.id))
            db.flush()

            # Back-fill submissions for active assignments (#996)
            create_submissions_for_new_student(classroom_id, user.id, db)

            created.append(CreatedStudentInfo(
                name=username,
                seat_number=seat_number,
                username=username,
                password=payload.password,
                user_id=user.id,
            ))
        except IntegrityError:
            # Race condition / DB-level backstop: the pre-check above missed
            # it (concurrent request, or a username collision on a case
            # variant the email-based pre-check didn't catch). Never
            # overwrite or attach to the existing row -- report it the same
            # way as the pre-check's own "already exists" branch.
            if savepoint is not None:
                savepoint.rollback()
            logger.warning(
                "Integrity error creating prefix-batch student %s (classroom %d)",
                username, classroom_id,
            )
            errors.append(BatchStudentError(
                name=username,
                seat_number=seat_number,
                error=f"帳號 {username} 已經存在",
            ))
        except Exception as e:
            if savepoint is not None:
                savepoint.rollback()
            logger.error(
                "Error creating prefix-batch student %s (seat %s): %s",
                username, seat_number, e,
            )
            errors.append(BatchStudentError(
                name=username,
                seat_number=seat_number,
                error=str(e),
            ))

    db.commit()
    logger.info(
        "Batch-by-prefix created %d students for classroom %d (errors: %d)",
        len(created), classroom_id, len(errors),
    )
    return BatchStudentCreateResponse(created=created, errors=errors, warnings=[])
