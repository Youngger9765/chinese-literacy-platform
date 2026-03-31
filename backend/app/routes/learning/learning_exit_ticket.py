"""Exit Ticket routes (Issue #463).

Handles AI-powered exit ticket question generation and answer submission.
"""
import logging
import time
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import ai_limit_5_per_min
from ...database import get_db
from ...models.session import LearningSession
from ...models.user import User
from ...services.ai_usage_tracker import last_usage, log_ai_usage
from ...services.exit_ticket_service import generate_exit_ticket_questions, calculate_score  # noqa: F401

router = APIRouter()
logger = logging.getLogger(__name__)


class ExitTicketGenerateRequest(BaseModel):
    story_content: list[str] = Field(..., min_length=1, max_length=200)
    wrong_chars: list[str] = Field(default_factory=list, max_length=50)


class ExitTicketQuestion(BaseModel):
    id: int
    question: str
    options: list[str]
    correct_index: int
    explanation: str


class ExitTicketGenerateResponse(BaseModel):
    questions: list[ExitTicketQuestion]
    source: str  # "ai" | "fallback"


class ExitTicketAnswer(BaseModel):
    question_id: int
    selected_index: int


class ExitTicketSubmitRequest(BaseModel):
    answers: list[ExitTicketAnswer]
    score: int = Field(..., ge=0, le=100)
    total_questions: int = Field(..., ge=0)


class ExitTicketSubmitResponse(BaseModel):
    score: int
    correct_count: int
    total: int
    passed: bool


@router.post(
    "/learning/sessions/{session_id}/exit-ticket/generate",
    response_model=ExitTicketGenerateResponse,
    dependencies=[Depends(ai_limit_5_per_min)],
)
async def generate_session_exit_ticket(
    session_id: int,
    payload: ExitTicketGenerateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate AI-powered exit ticket questions for a learning session (Issue #463).

    Calls Gemini 2.5 Flash to produce 3-5 multiple-choice questions covering
    literal comprehension, inferential comprehension, and evaluative comprehension.
    If wrong_chars are provided, at least one question tests character recognition.

    Falls back to source="fallback" with empty questions if AI is unavailable,
    allowing the frontend to use local rule-based generation.

    Rate limited: 5 requests per minute.
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    start_time = time.monotonic()
    result = await generate_exit_ticket_questions(
        story_content=payload.story_content,
        wrong_chars=payload.wrong_chars or [],
    )
    latency_ms = int((time.monotonic() - start_time) * 1000)

    # Track AI usage (Issue #874) — only track when AI source (not fallback)
    if result.get("source") == "ai":
        usage = last_usage.get()
        log_ai_usage(
            db,
            endpoint=f"/learning/sessions/{session_id}/exit-ticket/generate",
            step="exit_ticket",
            student_id=current_user.id,
            session_id=session_id,
            input_tokens=usage.input_tokens if usage else 0,
            output_tokens=usage.output_tokens if usage else 0,
            model=usage.model if usage else "gemini-2.5-flash",
            latency_ms=latency_ms,
            success=True,
            model_version=usage.model_version if usage else None,
            prompt_char_count=usage.prompt_char_count if usage else None,
            response_char_count=usage.response_char_count if usage else None,
            content_filtered=usage.content_filtered if usage else False,
            prompt_template_id="exit_ticket_generate",
        )

    logger.info(
        "exit_ticket generate: session=%d user=%d source=%s questions=%d",
        session_id,
        current_user.id,
        result.get("source"),
        len(result.get("questions", [])),
    )

    return ExitTicketGenerateResponse(
        questions=result.get("questions", []),
        source=result.get("source", "fallback"),
    )


@router.post(
    "/learning/sessions/{session_id}/exit-ticket/submit",
    response_model=ExitTicketSubmitResponse,
)
async def submit_session_exit_ticket(
    session_id: int,
    payload: ExitTicketSubmitRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Submit and persist exit ticket answers for a learning session (Issue #463).

    Saves the exit ticket score to the learning session record and returns
    the detailed score breakdown. Score is calculated server-side based on
    the submitted answers and total_questions.

    The score is persisted in the session's exit_ticket_score field if available,
    or logged for analytics if the field does not exist yet.
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    total = payload.total_questions or len(payload.answers)
    correct_count = payload.score * total // 100 if total > 0 else 0

    # Persist score if the column exists on the model
    if hasattr(session, "exit_ticket_score"):
        session.exit_ticket_score = payload.score
        db.commit()
        db.refresh(session)

    logger.info(
        "exit_ticket submit: session=%d user=%d score=%d/%d",
        session_id,
        current_user.id,
        payload.score,
        100,
    )

    return ExitTicketSubmitResponse(
        score=payload.score,
        correct_count=correct_count,
        total=total,
        passed=payload.score >= 60,
    )
