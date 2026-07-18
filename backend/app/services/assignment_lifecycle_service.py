"""Assignment lifecycle business logic."""
import logging
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..models.assignment import Assignment, AssignmentSubmission
from ..models.school import Classroom, ClassroomStudent, ClassroomText
from ..models.session import CharacterError, DialogueTurn, LearningSession
from ..models.text import Text
from ..models.user import User
from ..schemas.assignment import (
    AssignmentCreateRequest,
    AssignmentUpdateRequest,
    AttemptResponse,
    GradeSubmissionRequest,
    StudentAttemptGroup,
    SubmissionResponse,
)
from ..models.session import ReadingAttemptHistory
from ..services.assignment_responses import extract_reading_metrics
from ..services.assignment_copy_strategy import resolve_text_for_assignment
from ..services.assignment_queries import resolve_title_for_assignment
from ..services.audio_upload_service import delete_gcs_blobs_for_paths
from ..services.input_sanitizer import sanitize_ai_input
from ..services.lesson_loader import get_lesson_by_id
from ..services.notification_service import (
    send_assignment_graded_notification,
    send_new_assignment_notification,
)
from ..utils.slug import normalize_story_slug

logger = logging.getLogger(__name__)


def submission_to_response(
    submission: AssignmentSubmission,
    db: Session,
    *,
    student: User | None = None,
) -> SubmissionResponse:
    if student is None:
        student = db.query(User).filter(User.id == submission.student_id).first()
    r_accuracy, r_cpm, r_error_chars = extract_reading_metrics(submission, db)
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


def assignment_attempt_groups_to_response(
    submissions: list[AssignmentSubmission],
    db: Session,
) -> list[StudentAttemptGroup]:
    # Issue #1764 Fix 4: group submissions by student
    student_subs: dict[int, list[AssignmentSubmission]] = defaultdict(list)
    for sub in submissions:
        student_subs[sub.student_id].append(sub)

    groups: list[StudentAttemptGroup] = []
    for student_id, subs in student_subs.items():
        # student already loaded via joinedload — no extra query
        student = subs[0].student
        subs_sorted = sorted(subs, key=lambda s: s.attempt_number, reverse=True)
        latest = subs_sorted[0]
        attempt_list: list[AttemptResponse] = []
        for sub in subs_sorted:
            r_acc, r_cpm, r_err = extract_reading_metrics(sub, db)
            attempt_list.append(
                AttemptResponse(
                    id=sub.id,
                    attempt_number=sub.attempt_number,
                    status=sub.status,
                    submitted_at=sub.submitted_at,
                    score=sub.score,
                    reading_accuracy=r_acc,
                    reading_cpm=r_cpm,
                    reading_error_chars=r_err,
                    teacher_feedback=sub.teacher_feedback,
                )
            )
        groups.append(
            StudentAttemptGroup(
                student_id=student_id,
                student_name=student.name if student else "Unknown",
                latest_status=latest.status,
                latest_score=latest.score,
                latest_attempt_number=latest.attempt_number,
                attempts=attempt_list,
            )
        )
    return groups


def list_classroom_assignments_with_counts(
    classroom_id: int,
    is_active: bool | None,
    db: Session,
) -> tuple[list[Assignment], dict[int, dict]]:
    """List classroom assignments with precomputed submission counts."""
    query = (
        db.query(Assignment)
        .options(joinedload(Assignment.text))
        .filter(Assignment.classroom_id == classroom_id)
    )
    if is_active is not None:
        query = query.filter(Assignment.is_active == is_active)

    assignments = query.order_by(Assignment.created_at.desc()).all()
    if not assignments:
        return [], {}

    assignment_ids = [a.id for a in assignments]

    # ── Issue #1766: bulk-precompute counts to avoid N+1 ──────────────────────
    # assigned_student_count: classroom-level (same for all assignments in classroom)
    enrolled_count: int = (
        db.query(func.count(func.distinct(ClassroomStudent.student_id)))
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .scalar() or 0
    )

    # submitted_student_count per assignment
    submitted_rows = (
        db.query(
            AssignmentSubmission.assignment_id,
            func.count(func.distinct(AssignmentSubmission.student_id)).label("cnt"),
        )
        .filter(
            AssignmentSubmission.assignment_id.in_(assignment_ids),
            AssignmentSubmission.status.in_(["submitted", "graded"]),
        )
        .group_by(AssignmentSubmission.assignment_id)
        .all()
    )
    submitted_map: dict[int, int] = {row.assignment_id: row.cnt for row in submitted_rows}

    # total_attempts per assignment
    attempts_rows = (
        db.query(
            AssignmentSubmission.assignment_id,
            func.count(AssignmentSubmission.id).label("cnt"),
        )
        .filter(AssignmentSubmission.assignment_id.in_(assignment_ids))
        .group_by(AssignmentSubmission.assignment_id)
        .all()
    )
    attempts_map: dict[int, int] = {row.assignment_id: row.cnt for row in attempts_rows}

    precomputed: dict[int, dict] = {
        a_id: {
            "assigned_student_count": enrolled_count,
            "submitted_student_count": submitted_map.get(a_id, 0),
            "total_attempts": attempts_map.get(a_id, 0),
        }
        for a_id in assignment_ids
    }
    # ─────────────────────────────────────────────────────────────────────────
    return assignments, precomputed


def _send_new_assignment_notifications_best_effort(
    assignment: Assignment,
    student_ids: list[int],
    db: Session,
) -> None:
    try:
        classroom = db.query(Classroom).filter(Classroom.id == assignment.classroom_id).first()
        students = db.query(User).filter(User.id.in_(student_ids)).all() if student_ids else []
        students_by_id = {student.id: student for student in students}
        story_title = resolve_title_for_assignment(assignment, db)
        classroom_name = classroom.name if classroom else f"Classroom #{assignment.classroom_id}"

        for student_id in student_ids:
            student = students_by_id.get(student_id)
            try:
                send_new_assignment_notification(
                    student_id=student_id,
                    student_name=student.name if student else str(student_id),
                    story_title=story_title,
                    classroom_name=classroom_name,
                    due_date=assignment.due_date,
                    assignment_type=assignment.assignment_type,
                    db=db,
                )
            except Exception:
                logger.warning(
                    "Failed to send new assignment notification for assignment %d student %d",
                    assignment.id,
                    student_id,
                    exc_info=True,
                )
    except Exception:
        logger.warning(
            "Failed to send new assignment notifications for assignment %d",
            assignment.id,
            exc_info=True,
        )


def _send_assignment_graded_notification_best_effort(
    submission: AssignmentSubmission,
    db: Session,
) -> None:
    try:
        student = db.query(User).filter(User.id == submission.student_id).first()
        assignment = (
            db.query(Assignment)
            .filter(Assignment.id == submission.assignment_id)
            .first()
        )
        story_title = (
            resolve_title_for_assignment(assignment, db)
            if assignment is not None
            else f"Assignment #{submission.assignment_id}"
        )
        send_assignment_graded_notification(
            student_id=submission.student_id,
            student_name=student.name if student else str(submission.student_id),
            story_title=story_title,
            score=submission.score,
            db=db,
        )
    except Exception:
        logger.warning(
            "Failed to send assignment graded notification for submission %d",
            submission.id,
            exc_info=True,
        )


def create_assignment_with_submissions(
    classroom_id: int,
    teacher_id: int,
    payload: AssignmentCreateRequest,
    db: Session,
) -> Assignment:
    """
    Handles: story_id vs text_id resolution, sanitize title/description,
    copy strategy (resolve_text_for_assignment), ClassroomText sync,
    bulk-create AssignmentSubmission for all enrolled students.
    Raises ValueError on bad story_id/text_id.
    Raises IntegrityError (let caller handle -> 422).
    """
    # Sanitize teacher-provided text fields
    safe_title, _ = sanitize_ai_input(payload.title, user_id=str(teacher_id)) if payload.title else (payload.title, False)
    safe_description = payload.description
    if safe_description:
        safe_description, _ = sanitize_ai_input(safe_description, user_id=str(teacher_id))

    resolved_story_id: str | None = None
    resolved_text_id: int | None = None

    if payload.story_id is not None:
        # --- Platform YAML text path ---
        # Normalize slug ("L06" / "06" -> "6") before lookup and storage
        try:
            story = get_lesson_by_id(int(normalize_story_slug(payload.story_id)))
        except (ValueError, TypeError):
            story = None
        if not story:
            raise ValueError("Invalid story_id: story not found")
        resolved_story_id = normalize_story_slug(payload.story_id)

    else:
        # --- DB text path (with copy strategy) ---
        text = db.query(Text).filter(Text.id == payload.text_id).first()
        if text is None:
            raise ValueError("Invalid text_id: text not found")

        # Apply copy strategy: fork mutable texts
        assigned_text = resolve_text_for_assignment(text, teacher_id, classroom_id, db)
        db.flush()  # get assigned_text.id if it's a new fork
        resolved_text_id = assigned_text.id

    assignment = Assignment(
        classroom_id=classroom_id,
        teacher_id=teacher_id,
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
        # Issue #1762: smart skip setting
        skip_completed_steps=payload.skip_completed_steps,
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
                assigned_by=teacher_id,
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
    notified_student_ids: list[int] = []
    for enrollment in enrollments:
        if enrollment.student_id in unique_student_ids:
            continue
        unique_student_ids.add(enrollment.student_id)
        notified_student_ids.append(enrollment.student_id)
        submission = AssignmentSubmission(
            assignment_id=assignment.id,
            student_id=enrollment.student_id,
            status="pending",
        )
        db.add(submission)

    db.commit()
    db.refresh(assignment)
    _send_new_assignment_notifications_best_effort(
        assignment,
        notified_student_ids,
        db,
    )

    logger.info(
        "Created assignment %d for classroom %d (story=%s, text_id=%s, students=%d)",
        assignment.id, classroom_id, resolved_story_id, resolved_text_id, len(enrollments),
    )
    return assignment


def update_assignment_fields(
    assignment: Assignment,
    payload: AssignmentUpdateRequest,
    user_id: int,
    db: Session,
) -> Assignment:
    """
    Handles: exclude_unset, sanitize title/description, setattr loop.
    Commits and refreshes. Returns updated assignment.
    """
    update_data = payload.model_dump(exclude_unset=True)
    # Sanitize text fields in update payload
    for text_field in ("title", "description"):
        if text_field in update_data and update_data[text_field]:
            update_data[text_field], _ = sanitize_ai_input(
                update_data[text_field], user_id=str(user_id)
            )
    for field, value in update_data.items():
        setattr(assignment, field, value)

    db.commit()
    db.refresh(assignment)

    logger.info("Updated assignment %d: %s", assignment.id, list(update_data.keys()))
    return assignment


def delete_assignment_with_cleanup(
    assignment: Assignment,
    db: Session,
) -> int:
    """
    Handles: collect linked_session_ids, delete CharacterError + DialogueTurn,
    mark LearningSession as abandoned + clear artifacts, delete assignment.
    Commits. Returns count of linked sessions cleaned.
    Raises Exception (let caller handle -> 500).
    """
    assignment_id = assignment.id
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

    # ── Issue #2266: cascade-delete GCS audio before removing DB rows ─────────
    # Collect audio_gcs_path from:
    #   (a) AssignmentSubmission.audio_gcs_path (submission-level recording)
    #   (b) ReadingAttemptHistory.audio_gcs_path for each linked session
    # This runs BEFORE db.delete(assignment) so the paths are still accessible.
    # Failures are best-effort: one GCS failure never blocks the DB delete.
    audio_paths_to_delete: list[str] = []

    # (a) Submission-level paths
    submissions = (
        db.query(AssignmentSubmission)
        .filter(AssignmentSubmission.assignment_id == assignment_id)
        .all()
    )
    for sub in submissions:
        if sub.audio_gcs_path:
            audio_paths_to_delete.append(sub.audio_gcs_path)

    # (b) Attempt-level paths from linked sessions
    if linked_session_ids:
        attempt_paths = (
            db.query(ReadingAttemptHistory.audio_gcs_path)
            .filter(
                ReadingAttemptHistory.session_id.in_(linked_session_ids),
                ReadingAttemptHistory.audio_gcs_path.is_not(None),
            )
            .all()
        )
        audio_paths_to_delete.extend(p for (p,) in attempt_paths if p)

    if audio_paths_to_delete:
        delete_gcs_blobs_for_paths(audio_paths_to_delete)

    db.delete(assignment)
    db.commit()
    return len(linked_session_ids)


def grade_assignment_submission(
    submission: AssignmentSubmission,
    payload: GradeSubmissionRequest,
    user_id: int,
    db: Session,
) -> AssignmentSubmission:
    """
    Handles: score update, teacher_feedback sanitize, status = "graded".
    Commits and refreshes. Returns updated submission.
    """
    if payload.score is not None:
        submission.score = payload.score
    # Persist per-student feedback (Issue #424); None keeps existing value unchanged
    if payload.teacher_feedback is not None:
        safe_feedback, _ = sanitize_ai_input(payload.teacher_feedback, user_id=str(user_id))
        submission.teacher_feedback = safe_feedback
    submission.status = "graded"

    db.commit()
    db.refresh(submission)
    _send_assignment_graded_notification_best_effort(submission, db)
    logger.info(
        "Teacher %d graded submission %d (score=%s, feedback=%s)",
        user_id, submission.id, payload.score,
        "set" if payload.teacher_feedback else "not set",
    )
    return submission
