"""Junyi class/student import business logic (issue #3380).

On-demand import at request time — no nightly sync, no new DB table, no
migration. Dedup keys:
- students by ``User.junyi_identity_id`` (already unique).
- classrooms by ``(teacher_id, school_id, name)`` — v1, isolated behind
  ``find_existing_imported_classroom`` so it can be swapped for a real
  ``classrooms.junyi_class_id`` column later without touching every call site.

The authoritative allowlist of class ids a teacher may act on is whatever
``bq_client.list_classes_for_teacher()`` returns for THAT teacher's key. Any
requested id outside that set is silently dropped (defense in depth on top of
the parametrised BQ ``WHERE teacher_user_id = @caller`` clause — see the IDOR
test).
"""

import hashlib
import logging
import secrets

from sqlalchemy.orm import Session

from ..auth.password import hash_password
from ..models.school import Classroom, ClassroomStudent, ClassroomTeacher
from ..models.user import Role, StudentProfile, User, UserRole
from ..routes.classrooms.helpers import create_submissions_for_new_student, generate_join_code
from .junyi_bigquery_client import (
    student_identity_id_from_user_id_key,
    teacher_user_id_key,
)

logger = logging.getLogger(__name__)


def find_existing_imported_classroom(
    db: Session, teacher_id: int, school_id: int, class_name: str
) -> Classroom | None:
    """v1 dedup key: (teacher_id, school_id, name). Isolated in this one
    function on purpose — #3380 documents this as a known limitation (a
    renamed Junyi class will not be matched and will create a second
    classroom); replacing it with a real classrooms.junyi_class_id column
    later only requires changing this function, not every call site."""
    return (
        db.query(Classroom)
        .filter(
            Classroom.teacher_id == teacher_id,
            Classroom.school_id == school_id,
            Classroom.name == class_name,
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
    summaries = bq_client.list_classes_for_teacher(teacher_key)

    classes = []
    for summary in summaries:
        existing = find_existing_imported_classroom(
            db, teacher.id, school_id, summary.class_name
        )
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

    teacher_key = teacher_user_id_key(teacher.junyi_identity_id)
    authoritative = bq_client.list_classes_for_teacher(teacher_key)
    # THIS is the authz allowlist. Silently drop any requested id not in
    # valid_ids (do not raise, do not reveal whether it belongs to someone else).
    by_id = {c.junyi_class_id: c for c in authoritative}
    requested = set(requested_class_ids)

    student_role = db.query(Role).filter(Role.name == "student").first()

    added_students = 0
    skipped_existing_students = 0
    classes_created = 0
    classes_reused = 0

    for class_id in requested_class_ids:
        if class_id not in by_id:
            continue  # fail-closed authz: not this teacher's class
        summary = by_id[class_id]

        classroom = find_existing_imported_classroom(
            db, teacher.id, school_id, summary.class_name
        )
        if classroom is None:
            classroom = Classroom(
                name=summary.class_name,
                school_id=school_id,
                teacher_id=teacher.id,
                join_code=generate_join_code(db),
            )
            db.add(classroom)
            db.flush()
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

        rows = bq_client.list_students_for_class(summary.junyi_class_id, teacher_key)
        for row in rows:
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
                    "@student.lingoleap.local"
                )
                student = User(
                    email=synthetic_email,
                    password_hash=hash_password(secrets.token_hex(32)),
                    name=row.student_nickname,
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
