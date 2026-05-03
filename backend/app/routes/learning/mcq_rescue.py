"""MCQ Rescue endpoints — per-strategy AI tutor for wrong-answer scaffolding.

Endpoints:
  POST /api/learning/mcq-rescue/start    — start rescue session for a wrong MCQ answer
  POST /api/learning/mcq-rescue/respond  — send student response, get next AI turn

LLM hardening rules applied (llm-endpoint-hardening skill):
  - Rate limit AFTER cache check (ai_limit_10_per_min dependency)
  - Auth: Depends(get_current_user) on both endpoints
  - Input cap: student_text max_length=500 (Pydantic Field constraint)
  - Output cap: max_output_tokens=1024 (set in ai_service generate_structured_response)
  - Fail-closed: should_advance=False on AI error (mcq_rescue_agent enforces this)
  - Reasoning field on EVERY response (required in RESCUE_RESPONSE_SCHEMA)
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import ai_limit_10_per_min
from ...database import get_db
from ...models.user import User
from ...services.mcq_rescue_agent import mcq_rescue_agent

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class McqRescueStartRequest(BaseModel):
    question_id: str = Field(..., max_length=128)
    lesson_id: str = Field(..., max_length=128)
    wrong_choice: str = Field(..., max_length=8)
    question_text: str = Field(..., max_length=1000)
    correct_answer: str = Field(..., max_length=8)
    strategy_type: str | None = Field(None, max_length=64)


class McqRescueStartResponse(BaseModel):
    session_id: str
    ai_first_message: str
    current_step: int


class McqRescueRespondRequest(BaseModel):
    session_id: str = Field(..., max_length=200)
    student_text: str = Field(..., max_length=500)  # input cap: 500 chars


class McqRescueRespondResponse(BaseModel):
    current_step: int
    should_advance: bool
    should_terminate: bool
    give_up_detected: bool
    ai_feedback: str
    next_question: str
    reasoning: str    # always present per Young feedback / llm-endpoint-hardening


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/learning/mcq-rescue/start",
    response_model=McqRescueStartResponse,
    dependencies=[Depends(ai_limit_10_per_min)],
)
async def mcq_rescue_start(
    payload: McqRescueStartRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Start (or resume) an MCQ rescue session.

    Called when a student answers an MCQ incorrectly.
    Idempotent: calling again for the same (user, question_id) before the session
    expires returns the last AI message without creating a new session.

    Rate limited: 10 requests per minute per user.
    """
    try:
        session_id, response = await mcq_rescue_agent.start_session(
            user_id=current_user.id,
            question_id=payload.question_id,
            lesson_id=payload.lesson_id,
            wrong_choice=payload.wrong_choice,
            question_text=payload.question_text,
            correct_answer=payload.correct_answer,
            strategy_type=payload.strategy_type,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error("mcq_rescue_start error: %s", e)
        raise HTTPException(status_code=500, detail="AI service error")

    return McqRescueStartResponse(
        session_id=session_id,
        ai_first_message=response.ai_feedback,
        current_step=response.current_step,
    )


@router.post(
    "/learning/mcq-rescue/respond",
    response_model=McqRescueRespondResponse,
    dependencies=[Depends(ai_limit_10_per_min)],
)
async def mcq_rescue_respond(
    payload: McqRescueRespondRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Send a student response in an active MCQ rescue session.

    Returns AI feedback, step state, and termination flags.
    The reasoning field is always present per llm-endpoint-hardening rules.

    Rate limited: 10 requests per minute per user.
    """
    # Verify the session belongs to this user (session_id encodes user_id)
    expected_prefix = f"mcq_rescue_{current_user.id}_"
    if not payload.session_id.startswith(expected_prefix):
        raise HTTPException(status_code=403, detail="Session not found or access denied")

    try:
        response = await mcq_rescue_agent.process_response(
            session_id=payload.session_id,
            student_text=payload.student_text,
        )
    except ValueError as e:
        status = 429 if "Rate limit" in str(e) else 422
        raise HTTPException(status_code=status, detail=str(e))
    except RuntimeError as e:
        # Circuit breaker triggered
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error("mcq_rescue_respond error: %s", e)
        raise HTTPException(status_code=500, detail="AI service error")

    return McqRescueRespondResponse(
        current_step=response.current_step,
        should_advance=response.should_advance,
        should_terminate=response.should_terminate,
        give_up_detected=response.give_up_detected,
        ai_feedback=response.ai_feedback,
        next_question=response.next_question,
        reasoning=response.reasoning,
    )
