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
  - Input cap: lesson_id/question_id/choice via Pydantic max_length
  - Idempotent at the DB level (each click is a new row by design)
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import general_limit_100_per_min
from ...database import get_db
from ...models.mcq_attempt import McqAttempt
from ...models.user import User

router = APIRouter()
logger = logging.getLogger(__name__)


class McqAttemptRequest(BaseModel):
    lesson_id: str = Field(..., max_length=128)
    question_id: str = Field(..., max_length=128)
    choice: str = Field(..., max_length=8)
    is_correct: bool


class McqAttemptResponse(BaseModel):
    id: int


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
    attempt = McqAttempt(
        user_id=current_user.id,
        lesson_id=payload.lesson_id,
        question_id=payload.question_id,
        choice=payload.choice,
        is_correct=payload.is_correct,
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
