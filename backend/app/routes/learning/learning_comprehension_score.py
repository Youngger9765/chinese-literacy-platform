"""Comprehension Dialogue History and Scoring routes.

Handles dialogue turn history retrieval (Issue #242) and
comprehension scoring across 3 levels (Issue #243).
"""
import json
import logging
import time
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import ai_limit_5_per_min
from ...database import get_db
from ...models.session import DialogueTurn, LearningSession
from ...models.user import User
from ...schemas.session import ComprehensionScoreResponse
from ...services.ai_service import evaluate_comprehension
from ...services.ai_usage_tracker import last_usage, log_ai_usage
from ...services.input_sanitizer import sanitize_ai_input
from ._helpers import ConversationTurn

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Dialogue history (Issue #242) ─────────────────────────────────────────────

class DialogueTurnResponse(BaseModel):
    id: int
    turn_order: int
    role: str
    text: str
    is_correct: bool | None
    phase: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class DialogueHistoryResponse(BaseModel):
    session_id: int
    story_slug: str | None
    turns: list[DialogueTurnResponse]
    total: int


@router.get(
    "/learning/sessions/{session_id}/dialogue",
    response_model=DialogueHistoryResponse,
)
def get_dialogue_history(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the full Socratic dialogue Q&A history for a learning session.

    Returns turns in order (turn_order ASC).
    Returns an empty list if the session exists but has no recorded dialogue.
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    turns = (
        db.query(DialogueTurn)
        .filter(DialogueTurn.learning_session_id == session_id)
        .order_by(DialogueTurn.turn_order)
        .all()
    )

    return DialogueHistoryResponse(
        session_id=session_id,
        story_slug=session.story_slug,
        turns=[DialogueTurnResponse.model_validate(t) for t in turns],
        total=len(turns),
    )


# ── Comprehension Scoring (Issue #243) ────────────────────────────────────────

class ComprehensionScoreRequest(BaseModel):
    story_title: str
    story_text: str = Field(..., max_length=10000)
    dialogue_turns: list[ConversationTurn] = Field(..., min_length=1)


@router.post(
    "/learning/sessions/{session_id}/comprehension-score",
    response_model=ComprehensionScoreResponse,
    dependencies=[Depends(ai_limit_5_per_min)],
)
async def score_comprehension(
    session_id: int,
    payload: ComprehensionScoreRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Score a student's comprehension across 3 levels after Socratic dialogue.

    Rate limited: 5 requests per minute per user/IP.

    If scores already exist for this session (cached), returns them without
    re-calling Gemini. Otherwise calls Gemini to evaluate and caches in DB.
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    # Return cached scores if they exist
    if session.comprehension_score is not None:
        feedback = {}
        if session.comprehension_feedback:
            try:
                feedback = json.loads(session.comprehension_feedback)
            except (json.JSONDecodeError, TypeError):
                feedback = {}
        return ComprehensionScoreResponse(
            comprehension_score=session.comprehension_score,
            literal_score=session.literal_score or 0,
            inferential_score=session.inferential_score or 0,
            evaluative_score=session.evaluative_score or 0,
            feedback=feedback,
        )

    # Sanitize user-provided text before sending to AI
    safe_story_title, _ = sanitize_ai_input(payload.story_title, user_id=str(current_user.id))
    safe_story_text, _ = sanitize_ai_input(payload.story_text, user_id=str(current_user.id))

    # Build story context
    story_context = {
        "title": safe_story_title,
        "summary": safe_story_text[:500],  # Use first 500 chars as summary
    }

    # Build dialogue turns list — sanitize student turns
    dialogue_turns = []
    for t in payload.dialogue_turns:
        turn = t.model_dump()
        if turn.get("role") == "student" and turn.get("text"):
            turn["text"], _ = sanitize_ai_input(turn["text"], user_id=str(current_user.id))
        dialogue_turns.append(turn)

    start_time = time.monotonic()
    try:
        result = await evaluate_comprehension(
            dialogue_turns=dialogue_turns,
            story_context=story_context,
        )
    except Exception as e:
        logger.error("Comprehension scoring error: %s", e)
        raise HTTPException(status_code=503, detail="AI service unavailable")

    # Track AI usage (Issue #874)
    latency_ms = int((time.monotonic() - start_time) * 1000)
    usage = last_usage.get()
    log_ai_usage(
        db,
        endpoint=f"/learning/sessions/{session_id}/comprehension-score",
        step="comprehension",
        student_id=current_user.id,
        story_title=payload.story_title,
        session_id=session_id,
        input_tokens=usage.input_tokens if usage else 0,
        output_tokens=usage.output_tokens if usage else 0,
        model=usage.model if usage else "gemini-flash-lite-latest",
        latency_ms=latency_ms,
        success=True,
        model_version=usage.model_version if usage else None,
        prompt_char_count=usage.prompt_char_count if usage else None,
        response_char_count=usage.response_char_count if usage else None,
        content_filtered=usage.content_filtered if usage else False,
        prompt_template_id="comprehension_score",
    )

    # Cache scores in DB
    session.comprehension_score = result["comprehension_score"]
    session.literal_score = result["literal_score"]
    session.inferential_score = result["inferential_score"]
    session.evaluative_score = result["evaluative_score"]
    session.comprehension_feedback = json.dumps(result.get("feedback", {}), ensure_ascii=False)
    db.commit()
    db.refresh(session)

    logger.info(
        "Scored comprehension for session %d: overall=%.1f, literal=%.1f, "
        "inferential=%.1f, evaluative=%.1f",
        session_id,
        result["comprehension_score"],
        result["literal_score"],
        result["inferential_score"],
        result["evaluative_score"],
    )

    return ComprehensionScoreResponse(
        comprehension_score=result["comprehension_score"],
        literal_score=result["literal_score"],
        inferential_score=result["inferential_score"],
        evaluative_score=result["evaluative_score"],
        feedback=result.get("feedback", {}),
    )
