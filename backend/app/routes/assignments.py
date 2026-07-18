"""
Assignment System API — teachers create assignments, students complete them.

副本策略 (Copy Strategy):
- Platform YAML texts: assignment.story_id is set; no DB copy needed.
- DB texts with platform visibility: assignment.text_id → original text.
- DB texts with non-platform visibility: at creation we fork the text
  (see services/assignment_copy_strategy.py) and assignment.text_id
  points to the fork.

Split (Issue #1771):
- Response builders → services/assignment_responses.py
- Title/slug query helpers → services/assignment_queries.py
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.assignment import Assignment, AssignmentSubmission
from ..models.school import Classroom, ClassroomStudent
from ..models.session import LearningSession
from ..models.user import User, UserRole, Role
from ..schemas.assignment import (
    AssignmentCreateRequest,
    AssignmentDetailResponse,
    AssignmentListResponse,
    AssignmentResponse,
    AssignmentUpdateRequest,
    GradeSubmissionRequest,
    StartAssignmentResponse,
    StudentAssignmentResponse,
    SubmissionResponse,
)
from ..services.assignment_lifecycle_service import (
    assignment_attempt_groups_to_response,
    create_assignment_with_submissions,
    delete_assignment_with_cleanup,
    grade_assignment_submission,
    list_classroom_assignments_with_counts,
    submission_to_response,
    update_assignment_fields,
)
from ..services.assignment_queries import (
    resolve_story_title_from_yaml,
    resolve_title_for_assignment,
    resolve_story_slug_for_assignment,
)
from ..services.assignment_responses import (
    build_assignment_response,
)
from ..services.assignment_session_service import (
    restart_assignment_session,
    start_assignment_session,
    start_assignment_to_response,
    student_assignment_to_response,
    submit_assignment_session,
)
from ..services.notification_service import send_assignment_submitted_notification
from ..schemas.session import parse_step_progress
from .classrooms import _get_classroom_or_404, _require_owner_or_admin

router = APIRouter(tags=["assignments"])
logger = logging.getLogger(__name__)


# ── Module-private aliases (kept for readability inside this file) ─────────────

def _resolve_story_title_from_yaml(story_id: str) -> str | None:
    return resolve_story_title_from_yaml(story_id)


def _resolve_title_for_assignment(assignment: Assignment, db: Session) -> str:
    return resolve_title_for_assignment(assignment, db)


def _resolve_story_slug_for_assignment(assignment: Assignment) -> str | None:
    return resolve_story_slug_for_assignment(assignment)


def _assignment_to_response(
    assignment: Assignment,
    db: Session,
    *,
    precomputed_counts: dict | None = None,
) -> AssignmentResponse:
    return build_assignment_response(assignment, db, precomputed_counts=precomputed_counts)


# ── Auth helpers ──────────────────────────────────────────────────────────────


def _require_assignment_owner_or_admin(
    assignment: Assignment, current_user: User, db: Session
) -> None:
    """Check that current_user owns the assignment's classroom, or is admin."""
    classroom = (
        db.query(Classroom).filter(Classroom.id == assignment.classroom_id).first()
    )
    if classroom is None:
        raise HTTPException(status_code=404, detail="Classroom not found")
    _require_owner_or_admin(classroom, current_user, db)


def _has_role(user_id: int, role_name: str, db: Session) -> bool:
    """Check if a user has a specific role."""
    return (
        db.query(UserRole)
        .join(Role)
        .filter(
            UserRole.user_id == user_id,
            UserRole.is_active == True,  # noqa: E712
            Role.name == role_name,
        )
        .first()
    ) is not None


# ── Student Endpoints (registered first to avoid path parameter conflicts) ───
# /assignments/my must be registered before /assignments/{assignment_id}
# so FastAPI doesn't try to parse "my" as an integer assignment_id.


@router.get(
    "/assignments/my",
    response_model=list[StudentAssignmentResponse],
)
def get_my_assignments(
    status: str | None = Query(None, pattern=r"^(pending|in_progress|submitted|graded)$"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get all assignments for the current student.

    Batch-loads Assignment (with Text), LearningSession, and Classroom in one pass
    to avoid 2N+1 queries that would otherwise occur when looping through submissions.
    """
    # Eager-load Assignment → Text relationship so _resolve_title_for_assignment
    # never hits DB when assignment.text_id is set.
    query = (
        db.query(AssignmentSubmission)
        .join(Assignment, AssignmentSubmission.assignment_id == Assignment.id)
        .options(
            joinedload(AssignmentSubmission.assignment).joinedload(Assignment.text),
        )
        .filter(
            AssignmentSubmission.student_id == current_user.id,
            Assignment.is_active == True,  # noqa: E712
        )
    )
    if status is not None:
        query = query.filter(AssignmentSubmission.status == status)

    submissions = query.all()

    if not submissions:
        return []

    # Batch-load all linked LearningSession objects in one query
    session_ids = [sub.session_id for sub in submissions if sub.session_id is not None]
    sessions_map: dict[int, LearningSession] = {}
    if session_ids:
        for sess in db.query(LearningSession).filter(LearningSession.id.in_(session_ids)).all():
            sessions_map[sess.id] = sess

    # Batch-load all Classroom objects in one query (de-duplicated)
    classroom_ids = list({sub.assignment.classroom_id for sub in submissions})
    classrooms_map: dict[int, Classroom] = {}
    for cls in db.query(Classroom).filter(Classroom.id.in_(classroom_ids)).all():
        classrooms_map[cls.id] = cls

    results = []
    for sub in submissions:
        assignment = sub.assignment

        # Resolve session fields from pre-loaded map (no DB hit).
        # parse_step_progress logs a WARNING when the value is malformed (Issue #1180).
        session_id: int | None = None
        current_step: str | None = None
        steps_completed: list[str] = []
        if sub.session_id is not None:
            sess = sessions_map.get(sub.session_id)
            if sess is not None:
                session_id = sess.id
                sp = parse_step_progress(
                    sess.step_progress,
                    session_id=sess.id,
                    context="assignments.get_my_assignments",
                )
                if sp is not None:
                    current_step = sp.current_step.strip() if sp.current_step else None
                    steps_completed = [s.strip() for s in sp.steps_completed if s.strip()]
            else:
                session_id = sub.session_id

        # Title resolution: assignment.text already eager-loaded → no extra query
        story_title = _resolve_title_for_assignment(assignment, db)

        classroom = classrooms_map.get(assignment.classroom_id)

        results.append(
            student_assignment_to_response(
                assignment,
                sub,
                db,
                classroom=classroom,
                story_title=story_title,
                progress=(session_id, current_step, steps_completed),
            )
        )

    return results


@router.get(
    "/assignments/my/{assignment_id}",
    response_model=StudentAssignmentResponse,
)
def get_my_assignment_detail(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get detail for one of the current student's assignments."""
    submission = (
        db.query(AssignmentSubmission)
        .filter(
            AssignmentSubmission.assignment_id == assignment_id,
            AssignmentSubmission.student_id == current_user.id,
        )
        .order_by(AssignmentSubmission.attempt_number.desc())  # P0-2: always get latest attempt
        .first()
    )
    if submission is None:
        raise HTTPException(
            status_code=404, detail="Assignment not found or not assigned to you"
        )

    assignment = submission.assignment
    classroom = (
        db.query(Classroom).filter(Classroom.id == assignment.classroom_id).first()
    )
    story_title = _resolve_title_for_assignment(assignment, db)

    return student_assignment_to_response(
        assignment,
        submission,
        db,
        classroom=classroom,
        story_title=story_title,
    )


# ── Teacher Endpoints ────────────────────────────────────────────────────────


@router.post(
    "/classrooms/{classroom_id}/assignments",
    status_code=201,
    response_model=AssignmentResponse,
)
def create_assignment(
    classroom_id: int,
    payload: AssignmentCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new assignment for a classroom.

    Applies the copy strategy:
    - If story_id is provided: validates the YAML text exists, stores story_id.
    - If text_id is provided: looks up the DB text, forks it if mutable
      (non-platform visibility), stores text_id pointing to the fork.

    Then bulk-creates pending submissions for all enrolled students.
    """
    if payload.classroom_id is not None and payload.classroom_id != classroom_id:
        raise HTTPException(
            status_code=422,
            detail="classroom_id in request body must match classroom_id in path",
        )

    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    try:
        assignment = create_assignment_with_submissions(
            classroom_id,
            current_user.id,
            payload,
            db,
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=422,
            detail="Failed to create assignment due to invalid or conflicting classroom/student data",
        )

    return _assignment_to_response(assignment, db)


@router.get(
    "/classrooms/{classroom_id}/assignments",
    response_model=AssignmentListResponse,
)
def list_classroom_assignments(
    classroom_id: int,
    is_active: bool | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List assignments for a classroom with submission and completion counts.

    joinedload(Assignment.text) avoids N+1 queries when _resolve_title_for_assignment
    accesses assignment.text for text_id-based assignments.
    """
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    assignments, precomputed = list_classroom_assignments_with_counts(
        classroom_id,
        is_active,
        db,
    )

    if not assignments:
        return AssignmentListResponse(items=[], total=0)

    return AssignmentListResponse(
        items=[_assignment_to_response(a, db, precomputed_counts=precomputed) for a in assignments],
        total=len(assignments),
    )


@router.get(
    "/assignments/{assignment_id}",
    response_model=AssignmentDetailResponse,
)
def get_assignment_detail(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get assignment detail with all submissions."""
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")

    _require_assignment_owner_or_admin(assignment, current_user, db)

    # Build base response
    base = _assignment_to_response(assignment, db)

    # Issue #1767: eager-load student + session to avoid per-row N+1 queries.
    # joinedload(AssignmentSubmission.student) eliminates per-row User lookups.
    # joinedload(AssignmentSubmission.session) eliminates per-row LearningSession
    # lookups inside _extract_reading_metrics.
    submissions = (
        db.query(AssignmentSubmission)
        .options(
            joinedload(AssignmentSubmission.student),
            joinedload(AssignmentSubmission.session),
        )
        .filter(AssignmentSubmission.assignment_id == assignment_id)
        .all()
    )
    submission_responses = []
    for sub in submissions:
        # student already loaded via joinedload — no extra query
        submission_responses.append(submission_to_response(sub, db, student=sub.student))

    return AssignmentDetailResponse(
        **base.model_dump(),
        submissions=submission_responses,
        submissions_by_student=assignment_attempt_groups_to_response(submissions, db),
    )


@router.patch(
    "/assignments/{assignment_id}",
    response_model=AssignmentResponse,
)
def update_assignment(
    assignment_id: int,
    payload: AssignmentUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update assignment fields (title, description, due_date, is_active, reading goals)."""
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")

    _require_assignment_owner_or_admin(assignment, current_user, db)

    assignment = update_assignment_fields(assignment, payload, current_user.id, db)
    return _assignment_to_response(assignment, db)


# ── Teacher Grading Endpoint ─────────────────────────────────────────────────


@router.patch(
    "/assignments/{assignment_id}/submissions/{submission_id}",
    response_model=SubmissionResponse,
)
def grade_submission(
    assignment_id: int,
    submission_id: int,
    payload: GradeSubmissionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Grade a student submission. Teacher sets score and marks as 'graded'."""
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")

    _require_assignment_owner_or_admin(assignment, current_user, db)

    submission = (
        db.query(AssignmentSubmission)
        .filter(
            AssignmentSubmission.id == submission_id,
            AssignmentSubmission.assignment_id == assignment_id,
        )
        .first()
    )
    if submission is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    submission = grade_assignment_submission(submission, payload, current_user.id, db)

    student = db.query(User).filter(User.id == submission.student_id).first()
    return submission_to_response(submission, db, student=student)


# ── Teacher Delete Endpoint ───────────────────────────────────────────────────


@router.delete(
    "/assignments/{assignment_id}",
    status_code=204,
)
def delete_assignment(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete an assignment and all its submissions (cascade).

    Only the classroom owner or a system admin can delete an assignment.
    Returns 204 No Content on success.
    """
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")

    _require_assignment_owner_or_admin(assignment, current_user, db)
    classroom_id = assignment.classroom_id
    try:
        linked_session_count = delete_assignment_with_cleanup(assignment, db)
    except Exception as exc:
        db.rollback()
        logger.exception(
            "Failed to delete assignment %d with linked cleanup for teacher %d",
            assignment_id,
            current_user.id,
        )
        raise HTTPException(status_code=500, detail="Failed to delete assignment") from exc

    logger.info(
        "Teacher %d deleted assignment %d (classroom=%d, linked_sessions_marked=%d)",
        current_user.id, assignment_id, classroom_id, linked_session_count,
    )
    # FastAPI returns empty 204 response automatically when status_code=204


# ── Student Action Endpoints ─────────────────────────────────────────────────


@router.post(
    "/assignments/{assignment_id}/start",
    response_model=StartAssignmentResponse,
)
def start_assignment(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Start working on an assignment. Creates a LearningSession if needed.

    Idempotent: if already in_progress with a session, returns the existing session.
    """
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")

    if not assignment.is_active:
        raise HTTPException(status_code=400, detail="Assignment is not active")

    # Find the student's latest submission (highest attempt_number)
    submission = (
        db.query(AssignmentSubmission)
        .filter(
            AssignmentSubmission.assignment_id == assignment_id,
            AssignmentSubmission.student_id == current_user.id,
        )
        .order_by(AssignmentSubmission.attempt_number.desc())
        .first()
    )
    if submission is None:
        # Defensive on-demand backfill (#1910): student may have joined the
        # classroom AFTER the assignment was created (late-joiner race condition).
        # If the student IS enrolled in the assignment's classroom, create a
        # pending submission now rather than returning a spurious 403.
        enrollment = (
            db.query(ClassroomStudent)
            .filter(
                ClassroomStudent.classroom_id == assignment.classroom_id,
                ClassroomStudent.student_id == current_user.id,
            )
            .first()
        )
        if enrollment is None:
            raise HTTPException(
                status_code=403, detail="You are not enrolled in this assignment"
            )
        # Student is enrolled — create the missing submission on-demand.
        logger.warning(
            "On-demand submission backfill for student %d, assignment %d "
            "(student joined after assignment was created). #1910",
            current_user.id, assignment_id,
        )
        submission = AssignmentSubmission(
            assignment_id=assignment_id,
            student_id=current_user.id,
            status="pending",
            attempt_number=1,
        )
        db.add(submission)
        db.flush()  # get submission.id for subsequent operations

    if submission.status in ("submitted", "graded"):
        raise HTTPException(
            status_code=400, detail="Assignment already submitted. Use /restart to redo."
        )

    # If already in progress with a session, return it (idempotent)
    if submission.status == "in_progress" and submission.session_id is not None:
        return start_assignment_to_response(
            assignment,
            submission.session_id,
            submission.attempt_number,
        )

    learning_session, skipped_steps = start_assignment_session(assignment, submission, db)
    return start_assignment_to_response(
        assignment,
        learning_session.id,
        submission.attempt_number,
        skipped_steps=skipped_steps,
    )


@router.post(
    "/assignments/{assignment_id}/submit",
    response_model=StudentAssignmentResponse,
)
def submit_assignment(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark an assignment as submitted after the student completes the learning flow.

    Idempotent: if already submitted/graded, returns the current state without error.
    Optionally pulls the accuracy score from the linked LearningSession.

    TODO: Send Email notification to teacher when student submits (future implementation).
    """
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")

    submission = (
        db.query(AssignmentSubmission)
        .filter(
            AssignmentSubmission.assignment_id == assignment_id,
            AssignmentSubmission.student_id == current_user.id,
        )
        .order_by(AssignmentSubmission.attempt_number.desc())  # P0-2: always get latest attempt
        .first()
    )
    if submission is None:
        raise HTTPException(
            status_code=403, detail="You are not enrolled in this assignment"
        )

    if not assignment.is_active:
        raise HTTPException(status_code=400, detail="Assignment is not active")

    # Idempotent: already submitted/graded, just return current state
    if submission.status in ("submitted", "graded"):
        return student_assignment_to_response(assignment, submission, db)

    submission = submit_assignment_session(assignment, submission, db)
    story_title = _resolve_title_for_assignment(assignment, db)

    # Send notification to teacher (log-only for now)
    send_assignment_submitted_notification(
        student_id=current_user.id,
        student_name=current_user.name or str(current_user.id),
        assignment_id=assignment.id,
        story_title=story_title,
        teacher_id=assignment.teacher_id,
        db=db,
    )

    return student_assignment_to_response(
        assignment,
        submission,
        db,
        story_title=story_title,
        include_attempt_number=True,
    )


# ── Issue #1762: Restart Assignment (repeatable submission) ───────────────────


@router.post(
    "/assignments/{assignment_id}/restart",
    response_model=StartAssignmentResponse,
    status_code=201,
)
def restart_assignment(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Restart an already-submitted assignment. Creates a new AssignmentSubmission
    with attempt_number = max existing + 1, plus a fresh LearningSession.

    Only available once the current submission is in 'submitted' or 'graded' state.
    """
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")

    if not assignment.is_active:
        raise HTTPException(status_code=400, detail="Assignment is not active")

    # Find the student's latest submission
    latest_submission = (
        db.query(AssignmentSubmission)
        .filter(
            AssignmentSubmission.assignment_id == assignment_id,
            AssignmentSubmission.student_id == current_user.id,
        )
        .order_by(AssignmentSubmission.attempt_number.desc())
        .first()
    )
    if latest_submission is None:
        raise HTTPException(
            status_code=403, detail="You are not enrolled in this assignment"
        )

    if latest_submission.status not in ("submitted", "graded"):
        raise HTTPException(
            status_code=400,
            detail="Assignment must be submitted or graded before restarting",
        )

    next_attempt = latest_submission.attempt_number + 1

    new_session, skipped_steps = restart_assignment_session(
        assignment,
        current_user.id,
        next_attempt,
        db,
    )
    return start_assignment_to_response(
        assignment,
        new_session.id,
        next_attempt,
        skipped_steps=skipped_steps,
    )
