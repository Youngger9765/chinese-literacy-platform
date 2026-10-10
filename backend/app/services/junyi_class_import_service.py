"""On-demand Junyi import with one combined student query (issue #3380).

Classrooms are keyed by teacher and Junyi class ID. Students are resolved by
Junyi ID, then created with a synthetic email and a shared unusable password
hash. A pre-existing email account may remain separate until a verified
account-linking method exists; this deliberate limitation is tracked in the
follow-up issue to #3380. Names come from the BigQuery
nickname/username chain, then a numbered placeholder. The list endpoint uses
the cheaper class-summary query.
"""

import hashlib
import logging
import secrets
from functools import lru_cache

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth.password import hash_password
from ..models.school import Classroom, ClassroomStudent, ClassroomTeacher
from ..models.user import Role, StudentProfile, User, UserRole
from .junyi_bigquery_client import (
    SYNTHETIC_STUDENT_EMAIL_DOMAIN,
    JunyiClassStudentImportRow,
    student_identity_id_from_user_id_key,
    teacher_user_id_key,
)

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _synthetic_account_password_hash() -> str:
    """One bcrypt hash shared by every Junyi-imported synthetic student
    account (#3380). These accounts authenticate via Junyi SSO / teacher
    enrollment, never password login -- computing bcrypt once instead of
    once per student cuts a 71-student import from ~26s to ~1s. The
    plaintext input is a process-local random secret immediately
    discarded, so this hash is not a valid password for any login
    attempt (see TestSyntheticAccountsCannotPasswordLogin)."""
    return hash_password(secrets.token_hex(32))


def find_existing_imported_classroom(
    db: Session, teacher_id: int, junyi_class_id: str
) -> Classroom | None:
    return (
        db.query(Classroom)
        .filter(
            Classroom.teacher_id == teacher_id,
            Classroom.junyi_class_id == junyi_class_id,
        )
        .first()
    )


def list_importable_classes(db: Session, teacher: User, school_id: int, bq_client) -> dict:
    """Returns {"linked": bool, "classes": [JunyiImportableClass-shaped dicts]}.

    linked=False (classes=[]) when teacher.junyi_identity_id is None — not an error.
    Each class dict includes already_imported via find_existing_imported_classroom.
    """
    if teacher.junyi_identity_id is None:
        return {"linked": False, "classes": []}

    teacher_key = teacher_user_id_key(teacher.junyi_identity_id)
    summaries = bq_client.list_class_summaries_for_teacher(teacher_key)

    classes = []
    for summary in summaries:
        existing = find_existing_imported_classroom(db, teacher.id, summary.junyi_class_id)
        classes.append(
            {
                "junyi_class_id": summary.junyi_class_id,
                "class_name": summary.class_name,
                "class_code": summary.class_code,
                "student_count": summary.student_count,
                "already_imported": existing is not None,
            }
        )
    return {"linked": True, "classes": classes}


def import_junyi_classes(
    db: Session,
    teacher: User,
    school_id: int,
    requested_class_ids: list[str],
    bq_client,
) -> dict:
    """Returns {"added_students": int, "skipped_existing_students": int,
    "classes_created": int, "classes_reused": int}.

    See module docstring and #3380 for the full rationale. Fail-closed on the
    ID mapping: a row whose student_user_id lacks the expected prefix is
    skipped silently (not imported, not an error).
    """
    if teacher.junyi_identity_id is None:
        raise ValueError("Teacher is not linked to a Junyi identity")

    from ..routes.classrooms.helpers import create_submissions_for_new_student, generate_join_code

    teacher_key = teacher_user_id_key(teacher.junyi_identity_id)
    # This call happening first is what guarantees PRD R7's 'nothing written on BQ error' -- do not move DB writes before this line.
    rows = bq_client.list_class_and_student_rows_for_import(teacher_key)
    by_class: dict[str, list[JunyiClassStudentImportRow]] = {}
    for row in rows:
        by_class.setdefault(row.junyi_class_id, []).append(row)

    student_role = db.query(Role).filter(Role.name == "student").first()

    added_students = 0
    skipped_existing_students = 0
    classes_created = 0
    classes_reused = 0
    counter = 0

    for class_id in requested_class_ids:
        if class_id not in by_class:
            continue  # fail-closed authz: not this teacher's class
        rows_for_class = by_class[class_id]
        summary = rows_for_class[0]

        classroom = find_existing_imported_classroom(db, teacher.id, class_id)
        if classroom is None:
            classroom = Classroom(
                name=summary.class_name,
                school_id=school_id,
                teacher_id=teacher.id,
                join_code=generate_join_code(db),
                junyi_class_id=class_id,
            )
            db.add(classroom)
            try:
                db.flush()
            except IntegrityError:
                db.rollback()
                classroom = find_existing_imported_classroom(db, teacher.id, class_id)
                classes_reused += 1
            else:
                db.add(
                    ClassroomTeacher(
                        classroom_id=classroom.id,
                        teacher_id=teacher.id,
                        role="primary",
                        invited_by=teacher.id,
                    )
                )
                classes_created += 1
        else:
            classes_reused += 1

        for row in rows_for_class:
            counter += 1
            identity_id = student_identity_id_from_user_id_key(row.student_user_id)
            if identity_id is None:
                # Fail-closed: unverified mapping didn't match — skip, don't crash.
                continue

            student = (
                db.query(User)
                .filter(User.junyi_identity_id == identity_id)
                .first()
            )
            if student is None:
                synthetic_email = (
                    f"junyi-{hashlib.sha256(identity_id.encode()).hexdigest()[:16]}"
                    f"{SYNTHETIC_STUDENT_EMAIL_DOMAIN}"
                )
                student = User(
                    email=synthetic_email,
                    password_hash=_synthetic_account_password_hash(),
                    name=(row.display_name or "").strip() or f"均一學生 {counter}",
                    junyi_identity_id=identity_id,
                    email_verified=True,
                )
                db.add(student)
                db.flush()
                db.add(
                    StudentProfile(
                        user_id=student.id,
                        school_id=school_id,
                        student_number=None,
                    )
                )

            # Grant the school-scoped student role if not already present
            # (reuse pattern from classroom_csv.py upload_csv_students).
            if student_role is not None:
                has_role = (
                    db.query(UserRole)
                    .filter(
                        UserRole.user_id == student.id,
                        UserRole.role_id == student_role.id,
                        UserRole.scope_type == "school",
                        UserRole.scope_id == str(school_id),
                    )
                    .first()
                )
                if has_role is None:
                    db.add(
                        UserRole(
                            user_id=student.id,
                            role_id=student_role.id,
                            scope_type="school",
                            scope_id=str(school_id),
                            granted_by=teacher.id,
                        )
                    )

            existing_enrollment = (
                db.query(ClassroomStudent)
                .filter(
                    ClassroomStudent.classroom_id == classroom.id,
                    ClassroomStudent.student_id == student.id,
                )
                .first()
            )
            if existing_enrollment is None:
                db.add(
                    ClassroomStudent(
                        classroom_id=classroom.id,
                        student_id=student.id,
                    )
                )
                db.flush()
                create_submissions_for_new_student(classroom.id, student.id, db)
                added_students += 1
            else:
                skipped_existing_students += 1

    db.commit()
    logger.info(
        "Junyi import by teacher %d school %d: +%d students, %d skipped, "
        "%d classes created, %d reused",
        teacher.id, school_id, added_students, skipped_existing_students,
        classes_created, classes_reused,
    )
    return {
        "added_students": added_students,
        "skipped_existing_students": skipped_existing_students,
        "classes_created": classes_created,
        "classes_reused": classes_reused,
    }
