"""
Assignment System API — teachers create assignments, students complete them.

副本策略 (Copy Strategy):
- Platform YAML texts: assignment.story_id is set; no DB copy needed.
- DB texts with platform visibility: assignment.text_id → original text.
- DB texts with non-platform visibility: at creation we fork the text
  (see services/assignment_copy_strategy.py) and assignment.text_id
  points to the fork.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.assignment import Assignment, AssignmentSubmission
from ..models.school import Classroom, ClassroomStudent, ClassroomText
from ..models.session import LearningSession, CharacterError, DialogueTurn
from ..models.text import Text
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
    DEFAULT_TARGET_CPM,
    DEFAULT_TARGET_ACCURACY,
)
from ..services.assignment_copy_strategy import resolve_text_for_assignment
from ..services.input_sanitizer import sanitize_ai_input
from ..services.lesson_loader import get_lesson_by_id
from ..services.notification_service import send_assignment_submitted_notification
from ..utils.slug import normalize_story_slug
from .classrooms import _get_classroom_or_404, _require_owner_or_admin

router = APIRouter(tags=["assignments"])
logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _resolve_story_title_from_yaml(story_id: str) -> str | None:
    """Resolve a YAML story_id (lesson_number) to its title.

    Accepts both numeric strings ("6") and L-prefixed format ("L06").
    """
    try:
        story = get_lesson_by_id(int(normalize_story_slug(story_id)))
        if story:
            return story["title"]
    except (ValueError, TypeError):
        pass
    return None


def _resolve_title_for_assignment(assignment: Assignment, db: Session) -> str:
    """Return the display title for an assignment's text source."""
    if assignment.story_id is not None:
        return _resolve_story_title_from_yaml(assignment.story_id) or assignment.story_id
    if assignment.text_id is not None:
        text = db.query(Text).filter(Text.id == assignment.text_id).first()
        if text:
            return text.title
    return "(Unknown)"


def _resolve_story_slug_for_assignment(assignment: Assignment) -> str | None:
    """Return the LearningSession story_slug key used for this assignment."""
    if assignment.story_id is not None:
        return assignment.story_id
    if assignment.text_id is not None:
        return str(assignment.text_id)
    return None


def _assignment_to_response(assignment: Assignment, db: Session) -> AssignmentResponse:
    """Convert an Assignment ORM object to an AssignmentResponse."""
    story_title = _resolve_title_for_assignment(assignment, db)

    submission_count = (
        db.query(func.count(AssignmentSubmission.id))
        .filter(AssignmentSubmission.assignment_id == assignment.id)
        .scalar()
    )
    completed_count = (
        db.query(func.count(AssignmentSubmission.id))
        .filter(
            AssignmentSubmission.assignment_id == assignment.id,
            AssignmentSubmission.status.in_(["submitted", "graded"]),
        )
        .scalar()
    )

    return AssignmentResponse(
        id=assignment.id,
        classroom_id=assignment.classroom_id,
        teacher_id=assignment.teacher_id,
        story_id=assignment.story_id,
        text_id=assignment.text_id,
        story_title=story_title,
        title=assignment.title,
        description=assignment.description,
        assignment_type=assignment.assignment_type,
        due_date=assignment.due_date,
        is_active=assignment.is_active,
        created_at=assignment.created_at,
        submission_count=submission_count,
        completed_count=completed_count,
        # Reading goals (Issue #84)
        target_cpm=assignment.target_cpm,
        target_accuracy=assignment.target_accuracy,
        difficulty_label=assignment.difficulty_label,
        effective_cpm=assignment.target_cpm if assignment.target_cpm is not None else DEFAULT_TARGET_CPM,
        effective_accuracy=assignment.target_accuracy if assignment.target_accuracy is not None else DEFAULT_TARGET_ACCURACY,
    )


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


def _extract_reading_metrics(
    sub: AssignmentSubmission, db: Session
) -> tuple[float | None, float | None, list[str]]:
    """Extract reading metrics (accuracy, cpm, error_chars) from the linked LearningSession.

    Returns (reading_accuracy, reading_cpm, reading_error_chars).
    All values are None/[] when no session exists or data hasn't been recorded yet.
    """
    if sub.session_id is None:
        return None, None, []

    session = (
        db.query(LearningSession)
        .filter(LearningSession.id == sub.session_id)
        .first()
    )
    if session is None:
        return None, None, []

    accuracy = session.accuracy  # stored directly on session
    cpm: float | None = None
    error_chars: list[str] = []

    if session.reading_result and isinstance(session.reading_result, dict):
        cpm = session.reading_result.get("cpm")
        raw_errors = session.reading_result.get("error_chars", [])
        if isinstance(raw_errors, list):
            error_chars = [str(c) for c in raw_errors]

    return accuracy, cpm, error_chars


def _extract_assignment_progress(
    sub: AssignmentSubmission, db: Session
) -> tuple[int | None, str | None, list[str]]:
    """Extract durable step progress for assignment list/resume UI.

    Returns (session_id, current_step_path, steps_completed).
    """
    if sub.session_id is None:
        return None, None, []

    session = (
        db.query(LearningSession)
        .filter(LearningSession.id == sub.session_id)
        .first()
    )
    if session is None:
        return sub.session_id, None, []

    current_step: str | None = None
    steps_completed: list[str] = []
    if isinstance(session.step_progress, dict):
        raw_current = session.step_progress.get("current_step")
        if isinstance(raw_current, str) and raw_current.strip():
            current_step = raw_current.strip()
        raw_completed = session.step_progress.get("steps_completed", [])
        if isinstance(raw_completed, list):
            steps_completed = [
                step.strip()
                for step in raw_completed
                if isinstance(step, str) and step.strip()
            ]

    return session.id, current_step, steps_completed


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
    """Get all assignments for the current student."""
    query = (
        db.query(AssignmentSubmission)
        .join(Assignment, AssignmentSubmission.assignment_id == Assignment.id)
        .filter(
            AssignmentSubmission.student_id == current_user.id,
            Assignment.is_active == True,  # noqa: E712
        )
    )
    if status is not None:
        query = query.filter(AssignmentSubmission.status == status)

    submissions = query.all()

    results = []
    for sub in submissions:
        assignment = sub.assignment
        session_id, current_step, steps_completed = _extract_assignment_progress(sub, db)
        classroom = (
            db.query(Classroom).filter(Classroom.id == assignment.classroom_id).first()
        )
        story_title = _resolve_title_for_assignment(assignment, db)

        results.append(
            StudentAssignmentResponse(
                assignment_id=assignment.id,
                story_id=assignment.story_id,
                text_id=assignment.text_id,
                story_slug=_resolve_story_slug_for_assignment(assignment),
                story_title=story_title,
                title=assignment.title,
                description=assignment.description,
                assignment_type=assignment.assignment_type,
                due_date=assignment.due_date,
                classroom_name=classroom.name if classroom else "Unknown",
                status=sub.status,
                session_id=session_id,
                current_step=current_step,
                steps_completed=steps_completed,
                submitted_at=sub.submitted_at,
                score=sub.score,
                teacher_feedback=sub.teacher_feedback,  # Issue #424
                # Reading goals (Issue #84)
                target_cpm=assignment.target_cpm,
                target_accuracy=assignment.target_accuracy,
                difficulty_label=assignment.difficulty_label,
                effective_cpm=assignment.target_cpm if assignment.target_cpm is not None else DEFAULT_TARGET_CPM,
                effective_accuracy=assignment.target_accuracy if assignment.target_accuracy is not None else DEFAULT_TARGET_ACCURACY,
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
        .first()
    )
    if submission is None:
        raise HTTPException(
            status_code=404, detail="Assignment not found or not assigned to you"
        )

    assignment = submission.assignment
    session_id, current_step, steps_completed = _extract_assignment_progress(submission, db)
    classroom = (
        db.query(Classroom).filter(Classroom.id == assignment.classroom_id).first()
    )
    story_title = _resolve_title_for_assignment(assignment, db)

    return StudentAssignmentResponse(
        assignment_id=assignment.id,
        story_id=assignment.story_id,
        text_id=assignment.text_id,
        story_slug=_resolve_story_slug_for_assignment(assignment),
        story_title=story_title,
        title=assignment.title,
        description=assignment.description,
        assignment_type=assignment.assignment_type,
        due_date=assignment.due_date,
        classroom_name=classroom.name if classroom else "Unknown",
        status=submission.status,
        session_id=session_id,
        current_step=current_step,
        steps_completed=steps_completed,
        submitted_at=submission.submitted_at,
        score=submission.score,
        teacher_feedback=submission.teacher_feedback,  # Issue #424
        target_cpm=assignment.target_cpm,
        target_accuracy=assignment.target_accuracy,
        difficulty_label=assignment.difficulty_label,
        effective_cpm=assignment.target_cpm if assignment.target_cpm is not None else DEFAULT_TARGET_CPM,
        effective_accuracy=assignment.target_accuracy if assignment.target_accuracy is not None else DEFAULT_TARGET_ACCURACY,
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

    # Sanitize teacher-provided text fields
    safe_title, _ = sanitize_ai_input(payload.title, user_id=str(current_user.id)) if payload.title else (payload.title, False)
    safe_description = payload.description
    if safe_description:
        safe_description, _ = sanitize_ai_input(safe_description, user_id=str(current_user.id))

    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    resolved_story_id: str | None = None
    resolved_text_id: int | None = None

    if payload.story_id is not None:
        # --- Platform YAML text path ---
        # Normalize slug ("L06" / "06" → "6") before lookup and storage
        try:
            story = get_lesson_by_id(int(normalize_story_slug(payload.story_id)))
        except (ValueError, TypeError):
            story = None
        if not story:
            raise HTTPException(status_code=422, detail="Invalid story_id: story not found")
        resolved_story_id = normalize_story_slug(payload.story_id)

    else:
        # --- DB text path (with copy strategy) ---
        text = db.query(Text).filter(Text.id == payload.text_id).first()
        if text is None:
            raise HTTPException(status_code=422, detail="Invalid text_id: text not found")

        # Apply copy strategy: fork mutable texts
        assigned_text = resolve_text_for_assignment(text, current_user.id, classroom_id, db)
        db.flush()  # get assigned_text.id if it's a new fork
        resolved_text_id = assigned_text.id

    assignment = Assignment(
        classroom_id=classroom_id,
        teacher_id=current_user.id,
        story_id=resolved_story_id,
        text_id=resolved_text_id,
        title=safe_title,
        description=safe_description,
        assignment_type=payload.assignment_type,
        due_date=payload.due_date,
        # Reading goals (Issue #84)
        target_cpm=payload.target_cpm,
        target_accuracy=payload.target_accuracy,
        difficulty_label=payload.difficulty_label,
    )
    db.add(assignment)
    db.flush()  # get assignment.id

    # Sync story_id to classroom_texts so the library page shows it (#997)
    if resolved_story_id is not None:
        existing_ct = (
            db.query(ClassroomText)
            .filter(
                ClassroomText.classroom_id == classroom_id,
                ClassroomText.text_id == resolved_story_id,
                ClassroomText.deleted_at.is_(None),
            )
            .first()
        )
        if existing_ct is None:
            db.add(ClassroomText(
                classroom_id=classroom_id,
                text_id=resolved_story_id,
                assigned_by=current_user.id,
                expires_at=payload.due_date,
            ))

    # Bulk-create submissions for all enrolled students
    enrollments = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )
    # Defensive dedupe: legacy/corrupt data may contain repeated student links.
    # Avoid unique constraint conflicts on (assignment_id, student_id).
    unique_student_ids: set[int] = set()
    for enrollment in enrollments:
        if enrollment.student_id in unique_student_ids:
            continue
        unique_student_ids.add(enrollment.student_id)
        submission = AssignmentSubmission(
            assignment_id=assignment.id,
            student_id=enrollment.student_id,
            status="pending",
        )
        db.add(submission)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=422,
            detail="Failed to create assignment due to invalid or conflicting classroom/student data",
        )
    db.refresh(assignment)

    logger.info(
        "Created assignment %d for classroom %d (story=%s, text_id=%s, students=%d)",
        assignment.id, classroom_id, resolved_story_id, resolved_text_id, len(enrollments),
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
    """List assignments for a classroom with submission and completion counts."""
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    query = db.query(Assignment).filter(Assignment.classroom_id == classroom_id)
    if is_active is not None:
        query = query.filter(Assignment.is_active == is_active)

    assignments = query.order_by(Assignment.created_at.desc()).all()

    return AssignmentListResponse(
        items=[_assignment_to_response(a, db) for a in assignments],
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

    # Build submissions list
    submissions = (
        db.query(AssignmentSubmission)
        .filter(AssignmentSubmission.assignment_id == assignment_id)
        .all()
    )
    submission_responses = []
    for sub in submissions:
        student = db.query(User).filter(User.id == sub.student_id).first()
        r_accuracy, r_cpm, r_error_chars = _extract_reading_metrics(sub, db)
        submission_responses.append(
            SubmissionResponse(
                id=sub.id,
                assignment_id=sub.assignment_id,
                student_id=sub.student_id,
                student_name=student.name if student else "Unknown",
                status=sub.status,
                submitted_at=sub.submitted_at,
                score=sub.score,
                # Reading metrics (Issue #423)
                reading_accuracy=r_accuracy,
                reading_cpm=r_cpm,
                reading_error_chars=r_error_chars,
                teacher_feedback=sub.teacher_feedback,
            )
        )

    return AssignmentDetailResponse(
        **base.model_dump(),
        submissions=submission_responses,
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

    update_data = payload.model_dump(exclude_unset=True)
    # Sanitize text fields in update payload
    for text_field in ("title", "description"):
        if text_field in update_data and update_data[text_field]:
            update_data[text_field], _ = sanitize_ai_input(
                update_data[text_field], user_id=str(current_user.id)
            )
    for field, value in update_data.items():
        setattr(assignment, field, value)

    db.commit()
    db.refresh(assignment)

    logger.info("Updated assignment %d: %s", assignment_id, list(update_data.keys()))
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

    if payload.score is not None:
        submission.score = payload.score
    # Persist per-student feedback (Issue #424); None keeps existing value unchanged
    if payload.teacher_feedback is not None:
        safe_feedback, _ = sanitize_ai_input(payload.teacher_feedback, user_id=str(current_user.id))
        submission.teacher_feedback = safe_feedback
    submission.status = "graded"

    db.commit()
    db.refresh(submission)

    student = db.query(User).filter(User.id == submission.student_id).first()
    r_accuracy, r_cpm, r_error_chars = _extract_reading_metrics(submission, db)
    logger.info(
        "Teacher %d graded submission %d (score=%s, feedback=%s)",
        current_user.id, submission_id, payload.score,
        "set" if payload.teacher_feedback else "not set",
    )
    return SubmissionResponse(
        id=submission.id,
        assignment_id=submission.assignment_id,
        student_id=submission.student_id,
        student_name=student.name if student else "Unknown",
        status=submission.status,
        submitted_at=submission.submitted_at,
        score=submission.score,
        # Reading metrics (Issue #423)
        reading_accuracy=r_accuracy,
        reading_cpm=r_cpm,
        reading_error_chars=r_error_chars,
        teacher_feedback=submission.teacher_feedback,
    )


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
    try:
        linked_session_ids = [
            sid
            for (sid,) in (
                db.query(AssignmentSubmission.session_id)
                .filter(
                    AssignmentSubmission.assignment_id == assignment_id,
                    AssignmentSubmission.session_id.is_not(None),
                )
                .all()
            )
            if sid is not None
        ]

        if linked_session_ids:
            (
                db.query(CharacterError)
                .filter(CharacterError.session_id.in_(linked_session_ids))
                .delete(synchronize_session=False)
            )
            (
                db.query(DialogueTurn)
                .filter(DialogueTurn.learning_session_id.in_(linked_session_ids))
                .delete(synchronize_session=False)
            )

            linked_sessions = (
                db.query(LearningSession)
                .filter(LearningSession.id.in_(linked_session_ids))
                .all()
            )
            for linked_session in linked_sessions:
                raw_meta = None
                if isinstance(linked_session.step_progress, dict):
                    raw_meta = linked_session.step_progress.get("__meta")
                meta = raw_meta if isinstance(raw_meta, dict) else {}
                meta.update(
                    {
                        "source": "assignment",
                        "assignment_id": assignment_id,
                        "assignment_deleted": True,
                        "records_cleared": True,
                        "cleared_at": datetime.now(tz=timezone.utc).isoformat(),
                    }
                )

                # Clear all learning artifacts for this assignment session.
                linked_session.current_step = 1
                linked_session.accuracy = None
                linked_session.overall_score = None
                linked_session.reading_result = None
                linked_session.comprehension_result = None
                linked_session.vocab_result = None
                linked_session.full_reading_result = None
                linked_session.dialogue_state = None
                linked_session.ai_analysis = None
                linked_session.comprehension_score = None
                linked_session.literal_score = None
                linked_session.inferential_score = None
                linked_session.evaluative_score = None
                linked_session.comprehension_feedback = None
                linked_session.completed_at = None

                linked_session.step_progress = {
                    "current_step": None,
                    "steps_completed": [],
                    "step_data": {},
                    "__meta": meta,
                }
                linked_session.status = "abandoned"

        db.delete(assignment)
        db.commit()
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
        current_user.id, assignment_id, assignment.classroom_id, len(linked_session_ids),
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

    # Find the student's submission
    submission = (
        db.query(AssignmentSubmission)
        .filter(
            AssignmentSubmission.assignment_id == assignment_id,
            AssignmentSubmission.student_id == current_user.id,
        )
        .first()
    )
    if submission is None:
        raise HTTPException(
            status_code=403, detail="You are not enrolled in this assignment"
        )

    if submission.status in ("submitted", "graded"):
        raise HTTPException(
            status_code=400, detail="Assignment already submitted"
        )

    # If already in progress with a session, return it (idempotent)
    if submission.status == "in_progress" and submission.session_id is not None:
        return StartAssignmentResponse(
            session_id=submission.session_id,
            story_id=assignment.story_id,
            text_id=assignment.text_id,
            status="in_progress",
            target_cpm=assignment.target_cpm,
            target_accuracy=assignment.target_accuracy,
            difficulty_label=assignment.difficulty_label,
            effective_cpm=assignment.target_cpm if assignment.target_cpm is not None else DEFAULT_TARGET_CPM,
            effective_accuracy=assignment.target_accuracy if assignment.target_accuracy is not None else DEFAULT_TARGET_ACCURACY,
        )

    # story_slug for LearningSession: use normalized story_id (YAML) or text_id as string
    raw_slug = assignment.story_id or str(assignment.text_id)
    story_slug = normalize_story_slug(raw_slug)

    # Create a new LearningSession
    learning_session = LearningSession(
        student_id=current_user.id,
        story_slug=story_slug,
        classroom_id=assignment.classroom_id,
        status="in_progress",
        current_step=1,
        step_progress={
            "__meta": {
                "source": "assignment",
                "assignment_id": assignment.id,
            }
        },
    )
    db.add(learning_session)
    db.flush()  # get learning_session.id

    # Update submission
    submission.status = "in_progress"
    submission.session_id = learning_session.id

    db.commit()

    logger.info(
        "Student %d started assignment %d (session=%d)",
        current_user.id, assignment_id, learning_session.id,
    )
    return StartAssignmentResponse(
        session_id=learning_session.id,
        story_id=assignment.story_id,
        text_id=assignment.text_id,
        status="in_progress",
        target_cpm=assignment.target_cpm,
        target_accuracy=assignment.target_accuracy,
        difficulty_label=assignment.difficulty_label,
        effective_cpm=assignment.target_cpm if assignment.target_cpm is not None else DEFAULT_TARGET_CPM,
        effective_accuracy=assignment.target_accuracy if assignment.target_accuracy is not None else DEFAULT_TARGET_ACCURACY,
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
        .first()
    )
    if submission is None:
        raise HTTPException(
            status_code=403, detail="You are not enrolled in this assignment"
        )

    # Idempotent: already submitted/graded, just return current state
    if submission.status in ("submitted", "graded"):
        classroom = (
            db.query(Classroom).filter(Classroom.id == assignment.classroom_id).first()
        )
        story_title = _resolve_title_for_assignment(assignment, db)
        session_id, current_step, steps_completed = _extract_assignment_progress(submission, db)
        return StudentAssignmentResponse(
            assignment_id=assignment.id,
            story_id=assignment.story_id,
            text_id=assignment.text_id,
            story_slug=_resolve_story_slug_for_assignment(assignment),
            story_title=story_title,
            title=assignment.title,
            description=assignment.description,
            assignment_type=assignment.assignment_type,
            due_date=assignment.due_date,
            classroom_name=classroom.name if classroom else "Unknown",
            status=submission.status,
            session_id=session_id,
            current_step=current_step,
            steps_completed=steps_completed,
            submitted_at=submission.submitted_at,
            score=submission.score,
            teacher_feedback=submission.teacher_feedback,  # Issue #424
            target_cpm=assignment.target_cpm,
            target_accuracy=assignment.target_accuracy,
            difficulty_label=assignment.difficulty_label,
            effective_cpm=assignment.target_cpm if assignment.target_cpm is not None else DEFAULT_TARGET_CPM,
            effective_accuracy=assignment.target_accuracy if assignment.target_accuracy is not None else DEFAULT_TARGET_ACCURACY,
        )

    # Pull score from linked LearningSession if available
    score: float | None = None
    if submission.session_id is not None:
        learning_session = (
            db.query(LearningSession)
            .filter(LearningSession.id == submission.session_id)
            .first()
        )
        if learning_session and learning_session.overall_score is not None:
            score = float(learning_session.overall_score)

    submission.status = "submitted"
    submission.submitted_at = datetime.now(tz=timezone.utc)
    if score is not None:
        submission.score = score

    db.commit()
    db.refresh(submission)

    classroom = (
        db.query(Classroom).filter(Classroom.id == assignment.classroom_id).first()
    )
    story_title = _resolve_title_for_assignment(assignment, db)
    session_id, current_step, steps_completed = _extract_assignment_progress(submission, db)

    logger.info(
        "Student %d submitted assignment %d (score=%s)",
        current_user.id, assignment_id, score,
    )

    # Send notification to teacher (log-only for now)
    send_assignment_submitted_notification(
        student_id=current_user.id,
        student_name=current_user.name or str(current_user.id),
        assignment_id=assignment.id,
        story_title=story_title,
        teacher_id=assignment.teacher_id,
        db=db,
    )

    return StudentAssignmentResponse(
        assignment_id=assignment.id,
        story_id=assignment.story_id,
        text_id=assignment.text_id,
        story_slug=_resolve_story_slug_for_assignment(assignment),
        story_title=story_title,
        title=assignment.title,
        description=assignment.description,
        assignment_type=assignment.assignment_type,
        due_date=assignment.due_date,
        classroom_name=classroom.name if classroom else "Unknown",
        status=submission.status,
        session_id=session_id,
        current_step=current_step,
        steps_completed=steps_completed,
        submitted_at=submission.submitted_at,
        score=submission.score,
        teacher_feedback=submission.teacher_feedback,  # Issue #424
        target_cpm=assignment.target_cpm,
        target_accuracy=assignment.target_accuracy,
        difficulty_label=assignment.difficulty_label,
        effective_cpm=assignment.target_cpm if assignment.target_cpm is not None else DEFAULT_TARGET_CPM,
        effective_accuracy=assignment.target_accuracy if assignment.target_accuracy is not None else DEFAULT_TARGET_ACCURACY,
    )
