"""Error Correction Mechanism routes (Issue #248).

Handles character error patterns, recommended vocabulary, error corrections,
and repeated-error alerts.
"""
import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.session import CharacterError, ErrorCorrection, LearningSession
from ...models.user import User
from ...services.lesson_loader import get_lesson_by_id
from ._helpers import verify_student_access

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Schemas ───────────────────────────────────────────────────────────────────

class ErrorPatternItem(BaseModel):
    character: str
    total_error_count: int
    sessions_with_error: int
    last_error_date: datetime | None
    suggested_practice: bool
    is_corrected: bool


class ErrorPatternsResponse(BaseModel):
    patterns: list[ErrorPatternItem]
    total: int


class RecommendedVocabItem(BaseModel):
    character: str
    error_count: int
    related_words: list[str]
    zhuyin: str | None


class RecommendedVocabResponse(BaseModel):
    items: list[RecommendedVocabItem]
    total: int


class ErrorCorrectionRequest(BaseModel):
    character: str = Field(..., min_length=1, max_length=10)
    correction_type: str = Field("practice", pattern=r"^(practice|mastered)$")


class ErrorCorrectionResponse(BaseModel):
    id: int
    student_id: int
    character: str
    correction_type: str
    created_at: datetime

    model_config = {"from_attributes": True}


class RepeatedErrorAlertItem(BaseModel):
    character: str
    error_count: int


class RepeatedErrorAlertResponse(BaseModel):
    alerts: list[RepeatedErrorAlertItem]
    total: int


REPEATED_ERROR_THRESHOLD = 3  # characters wrong >= this many times trigger a modal


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/learning/students/{student_id}/story-slugs")
def get_student_story_slugs(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get distinct story slugs from the student's learning sessions.

    Used by the vocabulary filter dropdown to list courses the student has studied.
    Returns slugs with resolved titles sorted alphabetically, excluding null values.
    """
    verify_student_access(student_id, current_user, db)

    rows = (
        db.query(LearningSession.story_slug)
        .filter(
            LearningSession.student_id == student_id,
            LearningSession.story_slug.isnot(None),
        )
        .distinct()
        .order_by(LearningSession.story_slug)
        .limit(5000)
        .all()
    )
    slugs = []
    stories = []
    for r in rows:
        slug = r.story_slug
        slugs.append(slug)
        title = slug
        try:
            story = get_lesson_by_id(int(slug))
            if story:
                title = story["title"]
        except (ValueError, TypeError):
            pass
        stories.append({"slug": slug, "title": title})
    return {"slugs": slugs, "stories": stories, "total": len(slugs)}


@router.get("/learning/students/{student_id}/error-patterns", response_model=ErrorPatternsResponse)
def get_error_patterns(
    student_id: int,
    story_slug: str | None = Query(None, description="Filter errors by story slug"),
    limit: int = Query(50, ge=1, le=200, description="Max patterns to return"),
    offset: int = Query(0, ge=0, description="Number of patterns to skip"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get characters that the student repeatedly gets wrong (error_count >= 2).

    Returns characters sorted by error count descending.
    When story_slug is provided, only errors from sessions of that story are returned
    (minimum error threshold is lowered to 1 for per-story view).
    """
    verify_student_access(student_id, current_user, db)

    base_query = (
        db.query(
            CharacterError.character,
            sa_func.count(CharacterError.id).label("total_error_count"),
            sa_func.count(sa_func.distinct(CharacterError.session_id)).label("sessions_with_error"),
            sa_func.max(LearningSession.started_at).label("last_error_date"),
        )
        .join(LearningSession, CharacterError.session_id == LearningSession.id)
        .filter(LearningSession.student_id == student_id)
    )

    if story_slug:
        base_query = base_query.filter(LearningSession.story_slug == story_slug)
        min_errors = 1
    else:
        min_errors = 2

    error_groups = (
        base_query
        .group_by(CharacterError.character)
        .having(sa_func.count(CharacterError.id) >= min_errors)
        .order_by(sa_func.count(CharacterError.id).desc())
        .limit(5000)
        .all()
    )

    mastered_chars = set()
    mastered_rows = (
        db.query(ErrorCorrection.character)
        .filter(
            ErrorCorrection.student_id == student_id,
            ErrorCorrection.correction_type == "mastered",
        )
        .limit(5000)
        .all()
    )
    for row in mastered_rows:
        mastered_chars.add(row.character)

    all_patterns = []
    for row in error_groups:
        is_corrected = row.character in mastered_chars
        all_patterns.append(ErrorPatternItem(
            character=row.character,
            total_error_count=row.total_error_count,
            sessions_with_error=row.sessions_with_error,
            last_error_date=row.last_error_date,
            suggested_practice=not is_corrected,
            is_corrected=is_corrected,
        ))

    total = len(all_patterns)
    patterns = all_patterns[offset:offset + limit]
    return ErrorPatternsResponse(patterns=patterns, total=total)


@router.get("/learning/students/{student_id}/recommended-vocab", response_model=RecommendedVocabResponse)
def get_recommended_vocab(
    student_id: int,
    limit: int = Query(10, ge=1, le=50, description="Max vocab items to return"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Recommend vocabulary for practice based on error patterns.

    Returns top 10 most-errored characters from the last 30 days,
    excluding characters already marked as mastered.
    """
    verify_student_access(student_id, current_user, db)

    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)

    mastered_chars = set()
    mastered_rows = (
        db.query(ErrorCorrection.character)
        .filter(
            ErrorCorrection.student_id == student_id,
            ErrorCorrection.correction_type == "mastered",
        )
        .limit(5000)
        .all()
    )
    for row in mastered_rows:
        mastered_chars.add(row.character)

    error_groups = (
        db.query(
            CharacterError.character,
            sa_func.count(CharacterError.id).label("error_count"),
        )
        .join(LearningSession, CharacterError.session_id == LearningSession.id)
        .filter(
            LearningSession.student_id == student_id,
            LearningSession.started_at >= thirty_days_ago,
        )
        .group_by(CharacterError.character)
        .order_by(sa_func.count(CharacterError.id).desc())
        .limit(5000)
        .all()
    )

    items = []
    for row in error_groups:
        if row.character in mastered_chars:
            continue
        if len(items) >= limit:
            break
        items.append(RecommendedVocabItem(
            character=row.character,
            error_count=row.error_count,
            related_words=[],
            zhuyin=None,
        ))

    return RecommendedVocabResponse(items=items, total=len(items))


@router.post(
    "/learning/students/{student_id}/error-corrections",
    status_code=201,
    response_model=ErrorCorrectionResponse,
)
def mark_error_corrected(
    student_id: int,
    payload: ErrorCorrectionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark a character as practiced or mastered.

    Only the student themselves can mark corrections.
    """
    if current_user.id != student_id:
        raise HTTPException(status_code=403, detail="Can only mark corrections for yourself")

    correction = ErrorCorrection(
        student_id=student_id,
        character=payload.character,
        correction_type=payload.correction_type,
    )
    db.add(correction)
    db.commit()
    db.refresh(correction)
    logger.info(
        "Student %d marked '%s' as %s",
        student_id, payload.character, payload.correction_type,
    )
    return correction


@router.get(
    "/learning/students/{student_id}/repeated-errors-alert",
    response_model=RepeatedErrorAlertResponse,
)
def get_repeated_errors_alert(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return characters that have reached the >=3 repeated-error threshold.

    Used by the frontend to show the post-session modal:
    "這個字你讀錯 3 次了，建議加強生字練習"

    Characters already marked as mastered are excluded.
    Results sorted by error_count descending.
    """
    verify_student_access(student_id, current_user, db)

    mastered_chars: set[str] = set()
    for row in (
        db.query(ErrorCorrection.character)
        .filter(
            ErrorCorrection.student_id == student_id,
            ErrorCorrection.correction_type == "mastered",
        )
        .limit(5000)
        .all()
    ):
        mastered_chars.add(row.character)

    rows = (
        db.query(
            CharacterError.character,
            sa_func.count(CharacterError.id).label("error_count"),
        )
        .join(LearningSession, CharacterError.session_id == LearningSession.id)
        .filter(LearningSession.student_id == student_id)
        .group_by(CharacterError.character)
        .having(sa_func.count(CharacterError.id) >= REPEATED_ERROR_THRESHOLD)
        .order_by(sa_func.count(CharacterError.id).desc())
        .limit(5000)
        .all()
    )

    alerts = [
        RepeatedErrorAlertItem(character=row.character, error_count=row.error_count)
        for row in rows
        if row.character not in mastered_chars
    ]

    return RepeatedErrorAlertResponse(alerts=alerts, total=len(alerts))
