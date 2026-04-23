"""Learning Session CRUD routes.

Handles creating, listing, getting, and updating learning sessions.
"""
import logging
from datetime import datetime, timezone
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.assignment import AssignmentSubmission
from ...models.school import ClassroomStudent
from ...models.session import CharacterError, LearningSession
from ...models.text import Text
from ...models.user import User
from ...services.lesson_loader import get_lesson_by_id
from ...utils.slug import normalize_story_slug
from ...schemas.session import (
    SessionCreateRequest,
    SessionDetailResponse,
    SessionListResponse,
    SessionStatusResponse,
    SessionSummaryResponse,
    SessionUpdateRequest,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _is_assignment_session(
    session: LearningSession,
    assignment_session_ids: set[int],
) -> bool:
    """Return True when a session originates from assignment flow."""
    if session.id in assignment_session_ids:
        return True
    if isinstance(session.step_progress, dict):
        raw_meta = session.step_progress.get("__meta")
        if isinstance(raw_meta, dict) and raw_meta.get("source") == "assignment":
            return True
    return False


@router.post("/learning/sessions", status_code=201, response_model=SessionDetailResponse)
def create_learning_session(
    payload: SessionCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new learning session for the authenticated student.

    Uses a get-or-create pattern: if an in_progress session already exists for
    the same student + story_slug, return that session instead of creating a
    duplicate.  This prevents the race condition described in Issue #984 where
    the frontend fires two concurrent POST requests before the first response
    arrives.
    """
    # Normalize slug using the centralized normalizer (#985 + #984)
    normalized_slug = normalize_story_slug(payload.story_slug) if payload.story_slug else None

    # --- Validate story_slug against texts table (#1135) ---
    # Reject requests whose slug does not resolve to a known Text record so that
    # orphan sessions (sessions with no matching lesson content) cannot be created
    # via the public API.  The normalizer maps "L6" / "06" → "6"; we then look up
    # texts.lesson_number.  Non-numeric slugs that are not resolvable are also
    # rejected because they would never have a backing Text row.
    if normalized_slug:
        try:
            ln = int(normalized_slug)
            text_exists = db.query(Text).filter(Text.lesson_number == ln).first() is not None
        except (ValueError, TypeError):
            text_exists = False
        if not text_exists:
            raise HTTPException(
                status_code=422,
                detail=f"unknown story_slug: {payload.story_slug!r}",
            )

    # --- get-or-create: return existing in_progress session if one exists (#984) ---
    if normalized_slug:
        existing = (
            db.query(LearningSession)
            .filter(
                LearningSession.student_id == current_user.id,
                LearningSession.story_slug == normalized_slug,
                LearningSession.status == "in_progress",
            )
            .order_by(LearningSession.started_at.desc())
            .first()
        )
        if existing:
            logger.info(
                "Returning existing in_progress session %d for user %d, story=%s (dedup #984)",
                existing.id, current_user.id, normalized_slug,
            )
            return existing

    # Auto-fill classroom_id from the student's first active enrollment (if any)
    enrollment = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.student_id == current_user.id)
        .first()
    )
    classroom_id = enrollment.classroom_id if enrollment else None

    # Resolve text_id from normalized story_slug (slug already validated above)
    text_id = None
    if normalized_slug:
        try:
            ln = int(normalized_slug)
            text_record = db.query(Text).filter(Text.lesson_number == ln).first()
            if text_record:
                text_id = text_record.id
        except (ValueError, TypeError):
            pass  # non-numeric slugs have no text_id (blocked above unless normalized_slug is None)

    session = LearningSession(
        student_id=current_user.id,
        story_slug=normalized_slug,
        text_id=text_id,
        status="in_progress",
        current_step=1,
        classroom_id=classroom_id,
    )
    db.add(session)
    try:
        db.commit()
    except IntegrityError:
        # Partial unique index (#1179) caught a concurrent insert; fall back to
        # the existing in_progress session that the other request just created.
        db.rollback()
        if normalized_slug:
            existing = (
                db.query(LearningSession)
                .filter(
                    LearningSession.student_id == current_user.id,
                    LearningSession.story_slug == normalized_slug,
                    LearningSession.status == "in_progress",
                )
                .order_by(LearningSession.started_at.desc())
                .first()
            )
            if existing:
                logger.info(
                    "Race resolved: returning existing session %d for user %d, story=%s (#1179)",
                    existing.id, current_user.id, normalized_slug,
                )
                return existing
        raise
    db.refresh(session)
    logger.info(
        "Created learning session %d for user %d, story=%s",
        session.id, current_user.id, normalized_slug,
    )
    return session


@router.get("/learning/sessions", response_model=SessionListResponse)
def list_my_sessions(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    status: Optional[str] = Query(
        None,
        description="Comma-separated statuses to filter by, e.g. 'in_progress' or 'completed,abandoned'",
    ),
    story_slug: Optional[str] = Query(
        None,
        description="Filter by a specific story_slug",
    ),
    learning_source: Optional[Literal["self", "assignment"]] = Query(
        None,
        description="Filter by session source: self practice or assignment",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List learning sessions for the authenticated student, newest first.

    For assignment sessions, "completed" status is determined by the linked
    AssignmentSubmission.status being 'submitted' or 'graded' — NOT by
    LearningSession.status — because submit_assignment() does not update the
    session status to 'completed' (only process_session_completion() does).
    Issue #1245: this mismatch caused assignment sessions to never appear in
    the learning history page when filtering by status=completed.
    """
    # Fetch all assignment submissions for this student to build two maps:
    # 1. session_id → submission_status (for assignment "completion" logic)
    # 2. assignment_session_ids set (for _is_assignment_session checks)
    submission_rows = (
        db.query(AssignmentSubmission.session_id, AssignmentSubmission.status)
        .filter(
            AssignmentSubmission.student_id == current_user.id,
            AssignmentSubmission.session_id.is_not(None),
        )
        .all()
    )
    assignment_session_ids: set[int] = set()
    # Maps session_id → submission status ('pending','in_progress','submitted','graded')
    assignment_submission_status: dict[int, str] = {}
    for sid, sub_status in submission_rows:
        if sid is not None:
            assignment_session_ids.add(sid)
            assignment_submission_status[sid] = sub_status

    # Whether the caller wants "completed" sessions (includes assignment-submitted ones)
    statuses: list[str] = []
    wants_completed = False
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        wants_completed = "completed" in statuses

    query = db.query(LearningSession).filter(
        LearningSession.student_id == current_user.id,
    )

    if story_slug:
        query = query.filter(LearningSession.story_slug == normalize_story_slug(story_slug))

    # For self-practice sessions, apply the LearningSession.status filter directly.
    # For assignment sessions we apply a custom "completed" definition below.
    # When learning_source=assignment, omit the LearningSession.status filter so
    # we can include sessions that are 'in_progress' on LearningSession but
    # 'submitted'/'graded' on AssignmentSubmission.
    if statuses and learning_source != "assignment":
        query = query.filter(LearningSession.status.in_(statuses))

    all_items = (
        query
        .order_by(LearningSession.started_at.desc())
        .all()
    )

    filtered_items: list[LearningSession] = []
    for s in all_items:
        is_assignment = _is_assignment_session(s, assignment_session_ids)

        # --- source filter ---
        if learning_source == "assignment" and not is_assignment:
            continue
        if learning_source == "self" and is_assignment:
            continue

        # --- status filter (assignment-aware) ---
        if statuses:
            if is_assignment:
                # For assignment sessions, "completed" means the submission is
                # submitted or graded (LearningSession.status may still be
                # 'in_progress' because submit_assignment() does not update it).
                sub_status = assignment_submission_status.get(s.id, "")
                is_submission_done = sub_status in ("submitted", "graded")
                if wants_completed:
                    # Keep if session is completed OR submission is done
                    session_complete = s.status == "completed"
                    if not session_complete and not is_submission_done:
                        continue
                else:
                    # For non-"completed" status filters, apply session status directly
                    if s.status not in statuses:
                        continue
            else:
                # Self-practice: already filtered by DB query above (when
                # learning_source != 'assignment'). When no source filter is set
                # we need to apply the status filter in Python.
                if learning_source is None and s.status not in statuses:
                    continue

        filtered_items.append(s)

    total = len(filtered_items)
    items = filtered_items[offset: offset + limit]

    summaries = []
    for s in items:
        summary = SessionSummaryResponse.model_validate(s)
        summary.learning_source = "assignment" if _is_assignment_session(s, assignment_session_ids) else "self"
        # Resolve human-readable title: prefer linked Text record, else look up YAML lesson
        if s.text is not None:
            summary.story_title = s.text.title
        elif s.story_slug:
            try:
                lesson = get_lesson_by_id(int(normalize_story_slug(s.story_slug)))
                if lesson:
                    summary.story_title = lesson["title"]
            except (ValueError, TypeError):
                pass
        summaries.append(summary)
    return SessionListResponse(items=summaries, total=total)


@router.get("/learning/sessions/reading-history")
def get_reading_history(
    story_slug: str = Query(..., description="Story slug to get reading history for"),
    limit: int = Query(50, ge=1, le=100),
    learning_source: Literal["self", "assignment", "all"] = Query(
        "all",
        description="History source filter. Default all for backward compatibility.",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the student's own reading history for a specific story.

    Returns CPM, accuracy, and match_rate from each completed session,
    enabling progress curve visualisation on the student side.
    """
    assignment_session_ids_query = (
        db.query(AssignmentSubmission.session_id)
        .filter(
            AssignmentSubmission.student_id == current_user.id,
            AssignmentSubmission.session_id.is_not(None),
        )
    )

    sessions_query = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id == current_user.id,
            LearningSession.story_slug == normalize_story_slug(story_slug),
            LearningSession.status == "completed",
        )
    )

    # Push a SQL-level cap to avoid loading the full history for popular stories.
    # We fetch (limit + 50) rows as a buffer because the Python-side learning_source
    # filter (which also checks step_progress.__meta.source) may drop some rows.
    # The final sessions[:limit] slice still caps the result to the requested limit.
    sql_fetch_limit = limit + 50
    all_sessions = (
        sessions_query
        .order_by(LearningSession.started_at.asc())
        .limit(sql_fetch_limit)
        .all()
    )
    assignment_session_ids = {
        sid for (sid,) in assignment_session_ids_query.all() if sid is not None
    }

    sessions: list[LearningSession] = []
    for s in all_sessions:
        is_assignment = _is_assignment_session(s, assignment_session_ids)
        if learning_source == "assignment" and not is_assignment:
            continue
        if learning_source == "self" and is_assignment:
            continue
        sessions.append(s)

    sessions = sessions[:limit]

    results = []
    for s in sessions:
        fr = s.full_reading_result or {}
        rr = s.reading_result or {}
        # Extract CPM — prefer full_reading_result
        cpm = fr.get("cpm") or rr.get("cpm")
        # Extract accuracy
        accuracy = None
        if fr.get("match_rate") is not None:
            accuracy = round(float(fr["match_rate"]) * 100, 1)
        elif fr.get("accuracy") is not None:
            accuracy = round(float(fr["accuracy"]), 1)
        elif rr.get("accuracy") is not None:
            accuracy = round(float(rr["accuracy"]), 1)
        # Extract match_rate raw
        match_rate = fr.get("match_rate") or rr.get("match_rate")

        results.append({
            "session_id": s.id,
            "started_at": s.started_at.isoformat(),
            "cpm": float(cpm) if cpm is not None else None,
            "accuracy": accuracy,
            "match_rate": float(match_rate) if match_rate is not None else None,
            "overall_score": round(s.overall_score, 1) if s.overall_score is not None else None,
        })

    return results


@router.get("/learning/sessions/{session_id}", response_model=SessionDetailResponse)
def get_session_detail(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get full detail of a single learning session (must be own session)."""
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")
    return session


@router.get("/learning/sessions/{session_id}/report", response_model=SessionDetailResponse)
def get_session_report(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get session report (semantic alias for session detail)."""
    return get_session_detail(session_id, current_user, db)


@router.get("/learning/sessions/{session_id}/status", response_model=SessionStatusResponse)
def get_session_status(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get the resumable status of a learning session.

    Returns whether the session can be resumed, the current step, and
    whether it has been completed.  Used by the frontend to show the
    "繼續上次的學習？" prompt.
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    is_completed = session.status == "completed" or session.completed_at is not None
    is_resumable = not is_completed and session.status == "in_progress"

    return SessionStatusResponse(
        id=session.id,
        story_slug=session.story_slug,
        current_step=session.current_step,
        status=session.status,
        is_resumable=is_resumable,
        is_completed=is_completed,
        started_at=session.started_at,
        completed_at=session.completed_at,
    )


@router.patch("/learning/sessions/{session_id}", response_model=SessionDetailResponse)
def update_session(
    session_id: int,
    payload: SessionUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update learning session progress (must be own session).

    When reading_result contains error_chars, automatically creates CharacterError
    rows so that the error-patterns and recommended-vocab endpoints return real data
    (Issue #248: repeated error detection).
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(session, field, value)

    # Auto-set completed_at when status changes to completed (Issue #1070)
    if update_data.get("status") == "completed" and session.completed_at is None:
        session.completed_at = datetime.now(timezone.utc)

    # Auto-persist CharacterError records from reading_result.error_chars (Issue #248)
    if "reading_result" in update_data:
        reading_result = update_data["reading_result"] or {}
        error_chars = reading_result.get("error_chars", [])
        if isinstance(error_chars, list) and error_chars:
            # Delete any existing CharacterError rows for this session to avoid duplicates
            # when the client patches reading_result more than once.
            db.query(CharacterError).filter(CharacterError.session_id == session_id).delete()
            for char in error_chars:
                if isinstance(char, str) and char.strip():
                    db.add(CharacterError(
                        session_id=session_id,
                        character=char.strip(),
                        error_type="reading",
                    ))
            logger.info(
                "Persisted %d CharacterError rows for session %d",
                len(error_chars), session_id,
            )

    db.commit()
    db.refresh(session)
    logger.info("Updated learning session %d: %s", session_id, list(update_data.keys()))
    return session
