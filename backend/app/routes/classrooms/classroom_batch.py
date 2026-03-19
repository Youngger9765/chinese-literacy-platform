"""Batch student creation endpoint (JSON payload)."""
import logging
import secrets
import string

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.password import hash_password
from ...database import get_db
from ...models.school import ClassroomStudent
from ...models.user import Role, StudentProfile, User, UserRole
from ...schemas.classroom import (
    BatchStudentCreateRequest,
    BatchStudentCreateResponse,
    BatchStudentError,
    CreatedStudentInfo,
)
from .helpers import (
    check_email_domain,
    get_classroom_or_404,
    require_owner_or_admin,
)

router = APIRouter(tags=["classrooms"])
logger = logging.getLogger(__name__)


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
    from ...models.school import School

    classroom = get_classroom_or_404(classroom_id, db)
    require_owner_or_admin(classroom, current_user, db)

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
                name=item.name,
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
