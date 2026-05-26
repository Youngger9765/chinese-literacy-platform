"""Assignment session business logic."""
import logging
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..models.assignment import Assignment, AssignmentSubmission
from ..models.school import Classroom
from ..models.session import LearningSession
from ..schemas.assignment import (
    DEFAULT_TARGET_ACCURACY,
    DEFAULT_TARGET_CPM,
    StartAssignmentResponse,
    StudentAssignmentResponse,
)
from ..services.assignment_queries import (
    resolve_story_slug_for_assignment,
    resolve_title_for_assignment,
)
from ..services.assignment_responses import extract_assignment_progress
from ..utils.slug import normalize_story_slug

logger = logging.getLogger(__name__)


def student_assignment_to_response(
    assignment: Assignment,
    submission: AssignmentSubmission,
    db: Session,
    *,
    classroom: Classroom | None = None,
    classroom_name: str | None = None,
    story_title: str | None = None,
    progress: tuple[int | None, str | None, list[str]] | None = None,
    include_attempt_number: bool = False,
) -> StudentAssignmentResponse:
    if classroom_name is None:
        if classroom is None:
            classroom = (
                db.query(Classroom).filter(Classroom.id == assignment.classroom_id).first()
            )
        classroom_name = classroom.name if classroom else "Unknown"
    if story_title is None:
        story_title = resolve_title_for_assignment(assignment, db)
    if progress is None:
        progress = extract_assignment_progress(submission, db)
    session_id, current_step, steps_completed = progress
    response_data = {
        "assignment_id": assignment.id,
        "story_id": assignment.story_id,
        "text_id": assignment.text_id,
        "story_slug": resolve_story_slug_for_assignment(assignment),
        "story_title": story_title,
        "title": assignment.title,
        "description": assignment.description,
        "assignment_type": assignment.assignment_type,
        "due_date": assignment.due_date,
        "classroom_name": classroom_name,
        "status": submission.status,
        "session_id": session_id,
        "current_step": current_step,
        "steps_completed": steps_completed,
        "submitted_at": submission.submitted_at,
        "score": submission.score,
        "teacher_feedback": submission.teacher_feedback,  # Issue #424
        "target_cpm": assignment.target_cpm,
        "target_accuracy": assignment.target_accuracy,
        "difficulty_label": assignment.difficulty_label,
        "effective_cpm": assignment.target_cpm if assignment.target_cpm is not None else DEFAULT_TARGET_CPM,
        "effective_accuracy": assignment.target_accuracy if assignment.target_accuracy is not None else DEFAULT_TARGET_ACCURACY,
    }
    if include_attempt_number:
        response_data["attempt_number"] = submission.attempt_number
    return StudentAssignmentResponse(**response_data)


def start_assignment_to_response(
    assignment: Assignment,
    session_id: int,
    attempt_number: int,
    *,
    skipped_steps: list[str] | None = None,
) -> StartAssignmentResponse:
    return StartAssignmentResponse(
        session_id=session_id,
        story_id=assignment.story_id,
        text_id=assignment.text_id,
        status="in_progress",
        target_cpm=assignment.target_cpm,
        target_accuracy=assignment.target_accuracy,
        difficulty_label=assignment.difficulty_label,
        effective_cpm=assignment.target_cpm if assignment.target_cpm is not None else DEFAULT_TARGET_CPM,
        effective_accuracy=assignment.target_accuracy if assignment.target_accuracy is not None else DEFAULT_TARGET_ACCURACY,
        session_mode="assignment",
        attempt_number=attempt_number,
        skipped_steps=skipped_steps or [],
    )


def compute_skipped_steps(
    assignment: Assignment,
    student_id: int,
    story_slug: str,
    db: Session,
) -> list[str]:
    """
    Shared helper used by both start and restart.
    Returns sorted list of step names to skip.
    Returns [] if assignment.skip_completed_steps is False.
    """
    skipped_steps: list[str] = []
    if not assignment.skip_completed_steps:
        return skipped_steps

    # Issue #1762 + Fix 1 #1764: compute skipped steps if skip_completed_steps is enabled.
    # EXCLUDE sessions linked to THIS assignment's own prior submissions so that
    # attempt N+1 does not inherit skipped steps from attempt N.
    own_session_ids: set[int] = {
        sub.session_id
        for sub in db.query(AssignmentSubmission)
        .filter(
            AssignmentSubmission.assignment_id == assignment.id,
            AssignmentSubmission.student_id == student_id,
            AssignmentSubmission.session_id.isnot(None),
        )
        .all()
        if sub.session_id is not None
    }
    prior_sessions_query = db.query(LearningSession).filter(
        LearningSession.student_id == student_id,
        LearningSession.story_slug == story_slug,
        LearningSession.status == "completed",
    )
    if own_session_ids:
        prior_sessions_query = prior_sessions_query.filter(
            LearningSession.id.not_in(own_session_ids)
        )
    prior_sessions = prior_sessions_query.all()
    completed_union: set[str] = set()
    for ps in prior_sessions:
        sp = ps.step_progress
        if isinstance(sp, dict):
            steps = sp.get("steps_completed", [])
            if isinstance(steps, list):
                completed_union.update(s for s in steps if isinstance(s, str) and s.strip())
    return sorted(completed_union)


def _sync_metadata(
    session: LearningSession,
    assignment: Assignment,
    skipped_steps: list[str],
) -> None:
    """Attach assignment metadata + classroom_id to a reused session.

    Ensures both the session's step_progress.__meta points to this assignment
    and classroom_id is backfilled when the session was originally self-practice.
    """
    progress = session.step_progress or {}
    if not isinstance(progress.get("__meta"), dict) or progress["__meta"].get("assignment_id") != assignment.id:
        progress["__meta"] = {"source": "assignment", "assignment_id": assignment.id}
        if skipped_steps:
            progress["skipped_steps"] = skipped_steps
        session.step_progress = progress
        flag_modified(session, "step_progress")
    if session.classroom_id is None and assignment.classroom_id is not None:
        session.classroom_id = assignment.classroom_id
    # Issue #1762: mark session as assignment mode
    session.session_mode = "assignment"


def start_assignment_session(
    assignment: Assignment,
    submission: AssignmentSubmission,
    db: Session,
) -> tuple[LearningSession, list[str]]:
    """
    Returns (learning_session, skipped_steps).
    Handles: idempotent return for in_progress, compute_skipped_steps,
    session reuse or creation, _sync_assignment_metadata inner logic,
    IntegrityError savepoint handling, submission status update.
    Does NOT return StartAssignmentResponse — only sets up DB state.
    """
    # If already in progress with a session, return it (idempotent)
    if submission.status == "in_progress" and submission.session_id is not None:
        learning_session = (
            db.query(LearningSession)
            .filter(LearningSession.id == submission.session_id)
            .first()
        )
        if learning_session is not None:
            return learning_session, []

    # story_slug for LearningSession: use normalized story_id (YAML) or text_id as string
    raw_slug = assignment.story_id or str(assignment.text_id)
    story_slug = normalize_story_slug(raw_slug)

    skipped_steps = compute_skipped_steps(assignment, submission.student_id, story_slug, db)

    # Reuse existing in_progress session for same student + story to avoid
    # duplicates when switching devices (#1074).  Attach assignment metadata
    # so the session is associated with this assignment.
    #
    # Issue #1982: query for ANY in_progress session (not just assignment-mode)
    # to prevent a conflict with the unique index before attempting INSERT.
    # Previously the query filtered by session_mode="assignment", which meant
    # a pre-existing self-study session was not found here and the subsequent
    # INSERT hit the unique partial index on PostgreSQL → IntegrityError →
    # PendingRollbackError → HTTP 500.
    #
    # Fixing the conflict pre-emptively (find → reuse → _sync_metadata) is
    # safer than recovering after IntegrityError because SQLAlchemy's session
    # state management after a flush exception differs between SQLite and
    # PostgreSQL, making post-IntegrityError recovery fragile.
    learning_session = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id == submission.student_id,
            LearningSession.story_slug == story_slug,
            LearningSession.status == "in_progress",
        )
        .order_by(LearningSession.started_at.desc())
        .first()
    )
    if learning_session:
        _sync_metadata(learning_session, assignment, skipped_steps)
        logger.info(
            "Reusing existing session %d (mode=%s) for assignment %d "
            "(student %d, story=%s) #1074 #1982",
            learning_session.id, learning_session.session_mode,
            assignment.id, submission.student_id, story_slug,
        )
    else:
        initial_step_progress: dict = {
            "__meta": {
                "source": "assignment",
                "assignment_id": assignment.id,
                "skip_policy": "snapshot_at_session_creation",  # Fix 2 #1764
            }
        }
        if skipped_steps:
            initial_step_progress["skipped_steps"] = skipped_steps

        learning_session = LearningSession(
            student_id=submission.student_id,
            story_slug=story_slug,
            classroom_id=assignment.classroom_id,
            status="in_progress",
            current_step=1,
            session_mode="assignment",  # Issue #1762
            step_progress=initial_step_progress,
            full_reading_attempts=[],
        )
        db.add(learning_session)
        try:
            # Use a savepoint so that an IntegrityError (concurrent insert
            # hitting the partial unique index from #1179) only rolls back
            # the session INSERT — not the entire outer transaction that also
            # holds the submission update (#1185).
            with db.begin_nested():
                db.flush()  # get learning_session.id; savepoint released on success
        except IntegrityError:
            # True concurrent race: another request inserted a session between
            # our pre-flight query above and this flush.  This path is now rare
            # because the pre-flight query (#1982) already handles the common
            # case (pre-existing self-study session).
            learning_session = (
                db.query(LearningSession)
                .filter(
                    LearningSession.student_id == submission.student_id,
                    LearningSession.story_slug == story_slug,
                    LearningSession.status == "in_progress",
                )
                .order_by(LearningSession.started_at.desc())
                .first()
            )
            if learning_session is None:
                raise
            _sync_metadata(learning_session, assignment, skipped_steps)
            logger.info(
                "Race resolved in start_assignment: reusing session %d for assignment %d "
                "(#1179 #1185)",
                learning_session.id, assignment.id,
            )

    # Update submission
    submission.status = "in_progress"
    submission.session_id = learning_session.id

    db.commit()

    logger.info(
        "Student %d started assignment %d (session=%d, attempt=%d, skipped=%d steps)",
        submission.student_id, assignment.id, learning_session.id,
        submission.attempt_number, len(skipped_steps),
    )
    return learning_session, skipped_steps


def submit_assignment_session(
    assignment: Assignment,
    submission: AssignmentSubmission,
    db: Session,
) -> AssignmentSubmission:
    """
    Handles: score pull from LearningSession, session status → completed,
    submission status → submitted, submitted_at. Commits. Returns updated submission.
    Does NOT handle the idempotent "already submitted" early return (route handles that).
    """
    # Pull score from linked LearningSession if available; also sync session status.
    score: float | None = None
    if submission.session_id is not None:
        learning_session = (
            db.query(LearningSession)
            .filter(LearningSession.id == submission.session_id)
            .first()
        )
        if learning_session:
            if learning_session.overall_score is not None:
                score = float(learning_session.overall_score)
            # Issue #1181: sync session status/completed_at at write time so all
            # read paths (dashboard, list_sessions) agree without extra joins.
            if learning_session.status == "in_progress":
                learning_session.status = "completed"
                if learning_session.completed_at is None:
                    learning_session.completed_at = datetime.now(tz=timezone.utc)

    submission.status = "submitted"
    submission.submitted_at = datetime.now(tz=timezone.utc)
    if score is not None:
        submission.score = score

    db.commit()
    db.refresh(submission)

    logger.info(
        "Student %d submitted assignment %d (score=%s)",
        submission.student_id, assignment.id, score,
    )
    return submission


def restart_assignment_session(
    assignment: Assignment,
    student_id: int,
    next_attempt: int,
    db: Session,
) -> tuple[LearningSession, list[str]]:
    """
    Returns (new_session, skipped_steps).
    Handles: compute_skipped_steps, create new LearningSession,
    create new AssignmentSubmission. Commits. Returns both.
    """
    # story_slug for new LearningSession
    raw_slug = assignment.story_id or str(assignment.text_id)
    story_slug = normalize_story_slug(raw_slug)

    # Issue #1762 + Fix 1 #1764: compute skipped steps if enabled.
    # EXCLUDE sessions linked to THIS assignment's own prior submissions so that
    # restart attempt N+1 does not inherit skipped steps from attempt N.
    skipped_steps = compute_skipped_steps(assignment, student_id, story_slug, db)

    initial_step_progress: dict = {
        "__meta": {
            "source": "assignment",
            "assignment_id": assignment.id,
            "attempt_number": next_attempt,
            "skip_policy": "snapshot_at_session_creation",  # Fix 2 #1764
        }
    }
    if skipped_steps:
        initial_step_progress["skipped_steps"] = skipped_steps

    new_session = LearningSession(
        student_id=student_id,
        story_slug=story_slug,
        classroom_id=assignment.classroom_id,
        status="in_progress",
        current_step=1,
        session_mode="assignment",  # Issue #1762
        step_progress=initial_step_progress,
        full_reading_attempts=[],
    )
    db.add(new_session)
    db.flush()  # get new_session.id

    new_submission = AssignmentSubmission(
        assignment_id=assignment.id,
        student_id=student_id,
        attempt_number=next_attempt,
        status="in_progress",
        session_id=new_session.id,
    )
    db.add(new_submission)
    db.commit()

    logger.info(
        "Student %d restarted assignment %d (new_session=%d, attempt=%d, skipped=%d steps)",
        student_id, assignment.id, new_session.id, next_attempt, len(skipped_steps),
    )
    return new_session, skipped_steps
