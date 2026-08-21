"""Session bootstrap routes — POST /sessions create, list, reading-history.

Extracted from learning_sessions.py (Issue #1955).
"""
import logging
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.assignment import AssignmentSubmission
from ...models.session import LearningSession
from ...models.text import Text
from ...models.user import User
from ...services.lesson_loader import get_lesson_by_id
from ...utils.slug import normalize_story_slug
from ...schemas.session import (
    SessionCreateRequest,
    SessionDetailResponse,
    SessionListResponse,
    SessionSummaryResponse,
)

router = APIRouter()
logger = logging.getLogger(__name__)

# Hard cap on reading-history SQL fetch to bound memory even for abnormally
# re-read stories. A student reading the same text 500+ times is abusive; we
# surface up to MAX_READING_HISTORY_FETCH rows, then let the caller-supplied
# limit cap the final result set.  See #1262 for the heuristic rationale.
MAX_READING_HISTORY_FETCH = 500


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

    # --- Validate story_slug against the stories that exist (#1135, widened #2683) ---
    #
    # This checked the `texts` table alone, and that table holds FIRST-EDITION lesson
    # numbers. The re-ink renumbered every lesson, so no second-edition id is in it and
    # every POST came back 422 — no session, and nothing a student did was recorded, for
    # all 175 lessons. The eleven steps each rendered while this failed underneath, so
    # it survived every check that only looked at whether a page had content.
    #
    # A story served by the catalogue is a real story whether or not a row exists for
    # it: `text_id` is nullable and the list route already titles a session from
    # `get_lesson_by_id` when `text` is None. The gate's purpose is unchanged — a slug
    # naming nothing is still refused.
    if normalized_slug:
        try:
            ln = int(normalized_slug)
        except (ValueError, TypeError):
            ln = None
        known = ln is not None and (
            db.query(Text).filter(Text.lesson_number == ln).first() is not None
            or get_lesson_by_id(ln) is not None
        )
        if not known:
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

    # Self-study sessions are NOT attributed to any classroom.
    classroom_id = None

    # Resolve text_id from normalized story_slug (slug already validated above)
    text_id = None
    if normalized_slug:
        try:
            ln = int(normalized_slug)
            text_record = db.query(Text).filter(Text.lesson_number == ln).first()
            if text_record:
                text_id = text_record.id
        except (ValueError, TypeError):
            pass

    session = LearningSession(
        student_id=current_user.id,
        story_slug=normalized_slug,
        text_id=text_id,
        status="in_progress",
        classroom_id=classroom_id,
    )
    db.add(session)
    try:
        db.commit()
    except IntegrityError:
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
    """List learning sessions for the authenticated student, newest first."""
    submission_rows = (
        db.query(AssignmentSubmission.session_id, AssignmentSubmission.status)
        .filter(
            AssignmentSubmission.student_id == current_user.id,
            AssignmentSubmission.session_id.is_not(None),
        )
        .all()
    )
    assignment_session_ids: set[int] = set()
    assignment_submission_status: dict[int, str] = {}
    for sid, sub_status in submission_rows:
        if sid is not None:
            assignment_session_ids.add(sid)
            assignment_submission_status[sid] = sub_status

    statuses: list[str] = []
    wants_completed = False
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        wants_completed = "completed" in statuses

    query = db.query(LearningSession).options(
        joinedload(LearningSession.text)
    ).filter(
        LearningSession.student_id == current_user.id,
    )

    if story_slug:
        query = query.filter(LearningSession.story_slug == normalize_story_slug(story_slug))

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

        if learning_source == "assignment" and not is_assignment:
            continue
        if learning_source == "self" and is_assignment:
            continue

        if statuses:
            if is_assignment:
                sub_status = assignment_submission_status.get(s.id, "")
                is_submission_done = sub_status in ("submitted", "graded")
                if wants_completed:
                    session_complete = s.status == "completed"
                    if not session_complete and not is_submission_done:
                        continue
                else:
                    if s.status not in statuses:
                        continue
            else:
                if learning_source is None and s.status not in statuses:
                    continue

        filtered_items.append(s)

    total = len(filtered_items)
    items = filtered_items[offset: offset + limit]

    summaries = []
    for s in items:
        summary = SessionSummaryResponse.model_validate(s)
        summary.learning_source = "assignment" if _is_assignment_session(s, assignment_session_ids) else "self"
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
    """Get the student's own reading history for a specific story."""
    assignment_session_ids_query = (
        db.query(AssignmentSubmission.session_id)
        .filter(
            AssignmentSubmission.student_id == current_user.id,
            AssignmentSubmission.session_id.is_not(None),
        )
    )

    sessions_query = (
        db.query(LearningSession)
        .options(joinedload(LearningSession.text))
        .filter(
            LearningSession.student_id == current_user.id,
            LearningSession.story_slug == normalize_story_slug(story_slug),
            LearningSession.status == "completed",
        )
    )

    sql_fetch_limit = min(limit + 50, MAX_READING_HISTORY_FETCH)
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
        cpm = fr.get("cpm") or rr.get("cpm")
        accuracy = None
        if fr.get("match_rate") is not None:
            accuracy = round(float(fr["match_rate"]) * 100, 1)
        elif fr.get("accuracy") is not None:
            accuracy = round(float(fr["accuracy"]), 1)
        elif rr.get("accuracy") is not None:
            accuracy = round(float(rr["accuracy"]), 1)
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
