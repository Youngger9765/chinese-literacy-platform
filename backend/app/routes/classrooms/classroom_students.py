"""Student management endpoints: add, remove, list, search students in a classroom."""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.school import Classroom, ClassroomStudent, ClassroomTeacher, School
from ...services.email_domains import is_public_email_domain
from ...auth.policies import is_system_admin
from ...models.user import Role, User, UserRole
from ...schemas.classroom import (
    ClassroomBatchRemoveRequest,
    ClassroomBatchRemoveResponse,
    ClassroomStudentAddRequest,
    ClassroomStudentMoveRequest,
    ClassroomStudentMoveResponse,
    ClassroomStudentRenameRequest,
    ClassroomStudentSeatRequest,
    StudentInClassroomResponse,
    StudentSearchRequest,
    StudentSearchResult,
)
from ...services.audit_logger import AuditAction, audit_log_endpoint
from .helpers import (
    create_submissions_for_new_student,
    get_classroom_or_404,
    require_editor_or_admin,
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

    (#3804 security review, 2026-11-02, finding 4) That narrowing used to
    fire ONLY for public-email-domain schools -- it assumed any OTHER school
    was a verified, shared community where same-school teachers trust each
    other. Self-serve activation (POST /users/me/activate-teacher) breaks
    that assumption for schools born that way: anyone who types a matching
    name becomes a "member", the same way a public-email-domain account
    used to accidentally become one. So the narrowing must also fire for
    schools marked `settings.created_via == "self_activation"` (see
    auth_registration_service.py::activate_teacher_for_schools). This is
    deliberately NOT "any school with domain=None" -- plenty of pre-#3804
    schools (admin-created via POST /schools, CSV/bulk-import setups, test
    fixtures) already represent a genuinely-shared institutional school
    with domain=None and no email-domain concept, where same-school
    teachers are SUPPOSED to see each other's enrolled students; blanket
    -narrowing those broke 15 pre-existing tests the first time this was
    tried. The explicit marker scopes the fix to exactly the new risk.
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
    is_self_activated = bool(school and school.settings and school.settings.get("created_via") == "self_activation")
    if school is not None and (is_self_activated or is_public_email_domain(school.domain)):
        my_classrooms = (
            db.query(Classroom.id).filter(Classroom.teacher_id == teacher_id)
            .union(
                db.query(ClassroomTeacher.classroom_id).filter(
                    ClassroomTeacher.teacher_id == teacher_id,
                    # #3820: a still-pending co-teaching invite must not widen
                    # this teacher's "classrooms I already teach" set -- that
                    # would let a merely-invited (not yet accepted) teacher
                    # pull another classroom's students into their own
                    # search/add-student flow before they've accepted anything.
                    ClassroomTeacher.status == "accepted",
                )
            )
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
    """Add a student to a classroom by user ID.

    Owner, accepted 'editor'-role co-teacher, or system_admin (#3820).
    """
    classroom = get_classroom_or_404(classroom_id, db)
    require_editor_or_admin(classroom, current_user, db)

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
    """Remove a student from a classroom.

    Owner, accepted 'editor'-role co-teacher, or system_admin (#3820).
    """
    classroom = get_classroom_or_404(classroom_id, db)
    require_editor_or_admin(classroom, current_user, db)

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


def _get_enrollment_or_404(classroom_id: int, student_id: int, db: Session) -> ClassroomStudent:
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
    return cs


@router.patch(
    "/classrooms/{classroom_id}/students/{student_id}/name",
    response_model=StudentInClassroomResponse,
)
def rename_student(
    classroom_id: int,
    student_id: int,
    payload: ClassroomStudentRenameRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Teacher-edit a student's display name (#3826).

    Updates ``User.name`` -- the same field shown everywhere on the
    platform (there is no separate per-classroom nickname) -- NOT the
    login username/email, so the account the family was given on the
    credential card keeps working.
    """
    classroom = get_classroom_or_404(classroom_id, db)
    require_owner_or_admin(classroom, current_user, db)

    cs = _get_enrollment_or_404(classroom_id, student_id, db)

    cs.student.name = payload.name
    audit_log_endpoint(
        request=request,
        action=AuditAction.RENAME_STUDENT,
        user_id=current_user.id,
        target_student_id=student_id,
    )
    db.commit()
    db.refresh(cs)
    db.refresh(cs.student)
    logger.info("Renamed student %d in classroom %d", student_id, classroom_id)
    return StudentInClassroomResponse(
        id=cs.student.id,
        name=cs.student.name,
        email=cs.student.email,
        enrolled_at=cs.enrolled_at,
        seat_number=cs.seat_number,
    )


@router.patch(
    "/classrooms/{classroom_id}/students/{student_id}/seat",
    response_model=StudentInClassroomResponse,
)
def set_student_seat_number(
    classroom_id: int,
    student_id: int,
    payload: ClassroomStudentSeatRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Teacher-edit a student's seat number within THIS classroom (#3826).

    Scoped to the enrollment row (ClassroomStudent), not the student
    account, so a seat number never carries over when a student moves
    classrooms (#3819) or is re-enrolled after a batch-remove (#3821).
    ``seat_number: null`` clears it -- the roster then falls back to
    displaying the row's array index, same as every pre-#3826 row.
    """
    classroom = get_classroom_or_404(classroom_id, db)
    require_owner_or_admin(classroom, current_user, db)

    cs = _get_enrollment_or_404(classroom_id, student_id, db)

    if payload.seat_number is not None:
        conflict = (
            db.query(ClassroomStudent)
            .filter(
                ClassroomStudent.classroom_id == classroom_id,
                ClassroomStudent.seat_number == payload.seat_number,
                ClassroomStudent.id != cs.id,
            )
            .first()
        )
        if conflict is not None:
            raise HTTPException(
                status_code=409,
                detail=f"座號 {payload.seat_number} 在這個班級已經有人使用",
            )

    cs.seat_number = payload.seat_number
    audit_log_endpoint(
        request=request,
        action=AuditAction.SET_SEAT_NUMBER,
        user_id=current_user.id,
        target_student_id=student_id,
    )
    try:
        db.commit()
    except IntegrityError:
        # Belt-and-suspenders against the rare race between the SELECT-based
        # conflict check above and this commit (two concurrent requests
        # both picking the same free seat_number): the app-level check is
        # the normal path, the DB's UniqueConstraint is the actual source of
        # truth and raises here instead of silently corrupting data -- turn
        # it into the same 409 a non-racing duplicate request would get,
        # not an unhandled 500.
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"座號 {payload.seat_number} 在這個班級已經有人使用",
        )
    db.refresh(cs)
    logger.info(
        "Set seat_number=%s for student %d in classroom %d",
        payload.seat_number, student_id, classroom_id,
    )
    return StudentInClassroomResponse(
        id=cs.student.id,
        name=cs.student.name,
        email=cs.student.email,
        enrolled_at=cs.enrolled_at,
        seat_number=cs.seat_number,
    )


@router.post(
    "/classrooms/{from_classroom_id}/students/{student_id}/move",
    response_model=ClassroomStudentMoveResponse,
)
def move_student_between_classrooms(
    from_classroom_id: int,
    student_id: int,
    payload: ClassroomStudentMoveRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Move a student from one of the teacher's classrooms to another (#3819).

    One operation = remove-from-source + add-to-destination, done in a single
    transaction, so the student is never visibly "deleted" mid-flight. Learning
    history (AssignmentSubmission, LearningSession, ...) is untouched — it hangs
    off student_id/assignment_id, not classroom enrollment.
    """
    from_classroom = get_classroom_or_404(from_classroom_id, db)
    require_owner_or_admin(from_classroom, current_user, db)

    to_classroom = get_classroom_or_404(payload.to_classroom_id, db)
    require_owner_or_admin(to_classroom, current_user, db)

    # Restricting to the same school keeps this endpoint from entangling with
    # the eligible-student-by-school checks the add-student endpoint enforces —
    # a cross-school move would need to re-run that eligibility logic, which is
    # out of scope here (#3819 PRD explicitly excludes cross-school moves).
    if to_classroom.school_id != from_classroom.school_id:
        raise HTTPException(
            status_code=400,
            detail="不支援跨校換班，目的班級必須和原班級同一所學校",
        )

    source_enrollment = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == from_classroom_id,
            ClassroomStudent.student_id == student_id,
        )
        .first()
    )
    if source_enrollment is None:
        raise HTTPException(status_code=404, detail="Student not in source classroom")

    existing_in_destination = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == payload.to_classroom_id,
            ClassroomStudent.student_id == student_id,
        )
        .first()
    )
    if existing_in_destination is not None:
        raise HTTPException(status_code=409, detail="Student already in destination classroom")

    db.delete(source_enrollment)
    db.flush()

    new_enrollment = ClassroomStudent(
        classroom_id=payload.to_classroom_id,
        student_id=student_id,
    )
    db.add(new_enrollment)
    db.flush()

    # Back-fill submissions for the destination's active whole-class assignments,
    # same as any other new enrollment (#996).
    create_submissions_for_new_student(payload.to_classroom_id, student_id, db)

    audit_log_endpoint(
        request=request,
        action=AuditAction.MOVE_STUDENT,
        user_id=current_user.id,
        target_student_id=student_id,
    )

    db.commit()
    db.refresh(new_enrollment)
    logger.info(
        "Moved student %d from classroom %d to classroom %d",
        student_id, from_classroom_id, payload.to_classroom_id,
    )
    return ClassroomStudentMoveResponse(
        student_id=student_id,
        from_classroom_id=from_classroom_id,
        to_classroom_id=payload.to_classroom_id,
        enrolled_at=new_enrollment.enrolled_at,
    )


@router.post(
    "/classrooms/{classroom_id}/students/batch-remove",
    response_model=ClassroomBatchRemoveResponse,
)
def batch_remove_students_from_classroom(
    classroom_id: int,
    payload: ClassroomBatchRemoveRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove several students from a classroom in one call (#3821).

    Only unenrolls them from THIS classroom -- the account, their other
    classroom memberships, and their learning history are all untouched.
    Unknown/not-enrolled ids are reported back in not_found_ids instead of
    failing the whole batch, so one stale checkbox selection can't block
    removing the rest.
    """
    classroom = get_classroom_or_404(classroom_id, db)
    require_owner_or_admin(classroom, current_user, db)

    # De-dupe while preserving a stable order for the not_found_ids report.
    seen: set[int] = set()
    student_ids: list[int] = []
    for sid in payload.student_ids:
        if sid not in seen:
            seen.add(sid)
            student_ids.append(sid)

    enrolled = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.student_id.in_(student_ids),
        )
        .all()
    )
    found_student_ids = {cs.student_id for cs in enrolled}
    not_found_ids = [sid for sid in student_ids if sid not in found_student_ids]

    for cs in enrolled:
        db.delete(cs)

    audit_log_endpoint(
        request=request,
        action=AuditAction.BATCH_REMOVE_STUDENTS,
        user_id=current_user.id,
        target_student_id=None,
    )

    db.commit()
    logger.info(
        "Batch-removed %d students from classroom %d (%d not found)",
        len(enrolled), classroom_id, len(not_found_ids),
    )
    return ClassroomBatchRemoveResponse(
        removed_count=len(enrolled),
        not_found_ids=not_found_ids,
    )


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
            seat_number=cs.seat_number,
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
    Owner, accepted 'editor'-role co-teacher, or system_admin (#3820) --
    gated the same as actually adding the student, since this search exists
    only to feed that action.
    """
    from sqlalchemy import or_

    classroom = get_classroom_or_404(classroom_id, db)
    require_editor_or_admin(classroom, current_user, db)

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
