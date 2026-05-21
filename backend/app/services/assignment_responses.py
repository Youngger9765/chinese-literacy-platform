"""
Assignment response builders — converts ORM objects to Pydantic response models.

Extracted from routes/assignments.py (Issue #1771) as a pure-refactor step.
Zero behavior change; all public names are re-exported from the routes file.
"""
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models.assignment import Assignment, AssignmentSubmission
from ..models.school import ClassroomStudent
from ..models.session import LearningSession
from ..schemas.assignment import (
    AssignmentResponse,
    DEFAULT_TARGET_CPM,
    DEFAULT_TARGET_ACCURACY,
)
from ..schemas.session import parse_step_progress
from .assignment_queries import resolve_title_for_assignment


def build_assignment_response(
    assignment: Assignment,
    db: Session,
    *,
    precomputed_counts: dict | None = None,
) -> AssignmentResponse:
    """Convert an Assignment ORM object to an AssignmentResponse.

    precomputed_counts — optional dict keyed by assignment.id with keys:
      assigned_student_count, submitted_student_count, total_attempts.
    When provided (bulk list path) the per-row COUNT queries are skipped,
    eliminating the N+1 pattern (Issue #1766).
    """
    story_title = resolve_title_for_assignment(assignment, db)

    if precomputed_counts is not None and assignment.id in precomputed_counts:
        counts = precomputed_counts[assignment.id]
        assigned_student_count: int = counts["assigned_student_count"]
        submitted_student_count: int = counts["submitted_student_count"]
        total_attempts: int = counts["total_attempts"]
    else:
        # Single-assignment path: fall back to per-row queries (Issue #1764 Fix 3)
        assigned_student_count = (
            db.query(func.count(func.distinct(ClassroomStudent.student_id)))
            .filter(ClassroomStudent.classroom_id == assignment.classroom_id)
            .scalar() or 0
        )
        submitted_student_count = (
            db.query(func.count(func.distinct(AssignmentSubmission.student_id)))
            .filter(
                AssignmentSubmission.assignment_id == assignment.id,
                AssignmentSubmission.status.in_(["submitted", "graded"]),
            )
            .scalar() or 0
        )
        total_attempts = (
            db.query(func.count(AssignmentSubmission.id))
            .filter(AssignmentSubmission.assignment_id == assignment.id)
            .scalar() or 0
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
        # Issue #1764 Fix 3: split counts
        assigned_student_count=assigned_student_count,
        submitted_student_count=submitted_student_count,
        total_attempts=total_attempts,
        # Back-compat aliases for existing frontend
        submission_count=total_attempts,
        completed_count=submitted_student_count,
        # Reading goals (Issue #84)
        target_cpm=assignment.target_cpm,
        target_accuracy=assignment.target_accuracy,
        difficulty_label=assignment.difficulty_label,
        effective_cpm=assignment.target_cpm if assignment.target_cpm is not None else DEFAULT_TARGET_CPM,
        effective_accuracy=assignment.target_accuracy if assignment.target_accuracy is not None else DEFAULT_TARGET_ACCURACY,
        # Issue #1762
        skip_completed_steps=assignment.skip_completed_steps,
    )


def extract_reading_metrics(
    sub: AssignmentSubmission, db: Session
) -> tuple[float | None, float | None, list[str]]:
    """Extract reading metrics (accuracy, cpm, error_chars) from the linked LearningSession.

    Returns (reading_accuracy, reading_cpm, reading_error_chars).
    All values are None/[] when no session exists or data hasn't been recorded yet.

    Issue #1767: uses sub.session (already eager-loaded via joinedload in
    get_assignment_detail) when available, avoiding a per-row DB query.
    Falls back to an explicit query for callers that did not eager-load.
    """
    if sub.session_id is None:
        return None, None, []

    # Use already-loaded relationship value if present (avoids N+1)
    from sqlalchemy.orm.base import instance_state
    state = instance_state(sub)
    if "session" in state.dict:
        # relationship was eager-loaded
        session = sub.session
    else:
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


def extract_assignment_progress(
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

    # parse_step_progress logs a WARNING when value is malformed (Issue #1180).
    sp = parse_step_progress(
        session.step_progress,
        session_id=session.id,
        context="assignments._get_session_step_info",
    )
    current_step: str | None = sp.current_step.strip() if sp is not None and sp.current_step else None
    steps_completed: list[str] = (
        [s.strip() for s in sp.steps_completed if s.strip()]
        if sp is not None
        else []
    )

    return session.id, current_step, steps_completed
