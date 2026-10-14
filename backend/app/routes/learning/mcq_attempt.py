"""MCQ Attempt endpoint — records every MCQ choice click (Issue #1507).

Endpoint:
  POST /api/learning/mcq-attempt — log a single answer event

Why
---
5/8 walkthrough decision: students who keep getting MCQs wrong without
engaging the AI rescue tutor are signal teachers/researchers want to see.
The rescue session table only logs cases where the student actually opened
the dialog; this table logs every click so we can compute the gap.

Hardening (general endpoint, no LLM):
  - Auth: Depends(get_current_user)
  - Rate limit: 100/min per IP via general_limit_100_per_min
  - Input cap: lesson_id/question_id/choice/choice_text via Pydantic max_length
  - Idempotent at the DB level (each click is a new row by design)

Issue #3028 — session_id / attempt_no resolved server-side, not sent by the
client
------------------------------------------------------------------------
The frontend only sends `choice_text`. `session_id` and `attempt_no` are
computed here because:

  - The dbSessionId from useLearningSessionBootstrap is not threaded through
    any of the four MCQ writer components today — plumbing it through would
    touch four component trees for no benefit over resolving it server-side
    from (user, lesson) against the one in_progress session we already track.
  - If the client counted attempt_no itself, a page refresh would reset the
    counter to 1 and silently corrupt the star-rating denominator.

Both are nullable: a student can click an MCQ with no in_progress session
(e.g. the practice toolbox), and we never guess — see models/mcq_attempt.py
module docstring on why there is no backfill either.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import general_limit_100_per_min
from ...database import get_db
from ...models.mcq_attempt import McqAttempt
from ...models.session import LearningSession
from ...models.user import User
from ...utils.slug import normalize_story_slug

router = APIRouter()
logger = logging.getLogger(__name__)


class McqAttemptRequest(BaseModel):
    lesson_id: str = Field(..., max_length=128)
    question_id: str = Field(..., max_length=128)
    choice: str = Field(..., max_length=8)
    choice_text: str | None = Field(None, max_length=255)
    is_correct: bool


class McqAttemptResponse(BaseModel):
    id: int


def _resolve_session_id(db: Session, user_id: int, lesson_id: str) -> int | None:
    """The student's in_progress LearningSession for this lesson, or None.

    `mcq_attempt.lesson_id` and `learning_sessions.story_slug` are both
    written from the same normalize_story_slug() output (see
    sessions_bootstrap.create_learning_session), so normalizing here resolves
    both the numeric form ("20011") and the Layer-2 grade-code form
    ("G4-L14") to the same session — without it, the spotlight writers (which
    send the grade-code form) and the comprehension writer (which sends the
    numeric id) would never match the same session even though they're the
    same lesson.

    Returns None (not an error) when there's no matching in_progress
    session — the column is nullable precisely for this case.
    """
    slug = normalize_story_slug(lesson_id) or lesson_id
    row = (
        db.query(LearningSession.id)
        .filter(
            LearningSession.student_id == user_id,
            LearningSession.story_slug == slug,
            LearningSession.status == "in_progress",
        )
        .order_by(LearningSession.started_at.desc())
        .first()
    )
    return row[0] if row else None


def _next_attempt_no(
    db: Session, user_id: int, session_id: int | None, question_id: str
) -> int | None:
    """1-based ordinal of this attempt within (session_id, question_id).

    NULL when session_id is None — we never attribute an attempt count to a
    session we couldn't resolve (same no-guessing principle as session_id
    itself).
    """
    if session_id is None:
        return None
    n = (
        db.query(func.count(McqAttempt.id))
        .filter(
            McqAttempt.user_id == user_id,
            McqAttempt.session_id == session_id,
            McqAttempt.question_id == question_id,
        )
        .scalar()
    ) or 0
    return n + 1


@router.post(
    "/learning/mcq-attempt",
    response_model=McqAttemptResponse,
    dependencies=[Depends(general_limit_100_per_min)],
)
async def record_mcq_attempt(
    payload: McqAttemptRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record a single MCQ attempt for telemetry."""
    session_id = _resolve_session_id(db, current_user.id, payload.lesson_id)
    attempt_no = _next_attempt_no(db, current_user.id, session_id, payload.question_id)
    attempt = McqAttempt(
        user_id=current_user.id,
        lesson_id=payload.lesson_id,
        question_id=payload.question_id,
        choice=payload.choice,
        choice_text=payload.choice_text,
        is_correct=payload.is_correct,
        session_id=session_id,
        attempt_no=attempt_no,
    )
    try:
        db.add(attempt)
        db.commit()
        db.refresh(attempt)
    except SQLAlchemyError as e:
        db.rollback()
        logger.error("mcq_attempt insert failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to record attempt")

    return McqAttemptResponse(id=attempt.id)
