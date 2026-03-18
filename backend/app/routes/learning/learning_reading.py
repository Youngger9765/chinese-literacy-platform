"""AI Reading Analysis routes (Step 6).

Handles AI-powered reading diagnosis and improvement suggestions.
"""
import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import ai_limit_5_per_min
from ...database import get_db
from ...models.session import LearningSession
from ...models.user import User
from ...services.ai_service import generate_reading_analysis

router = APIRouter(tags=["learning"])
logger = logging.getLogger(__name__)


class AIAnalysisRequest(BaseModel):
    story_title: str = Field(..., max_length=200)
    accuracy: float = Field(..., ge=0, le=100)
    cpm: float = Field(..., ge=0)
    error_chars: list[str] = Field(default_factory=list)
    total_characters: int = Field(..., ge=0)
    # Optional enrichment fields — Issue #415: comprehensive AI analysis
    comprehension_score: float | None = Field(None, ge=0, le=100)
    vocab_practiced_count: int | None = Field(None, ge=0)
    vocab_total_count: int | None = Field(None, ge=0)
    dictation_correct_count: int | None = Field(None, ge=0)
    dictation_total_count: int | None = Field(None, ge=0)


class AIAnalysisResponse(BaseModel):
    analysis_summary: str
    strengths: list[str]
    areas_for_improvement: list[str]
    practice_suggestions: list[str]
    encouragement_message: str


@router.post(
    "/learning/sessions/{session_id}/ai-analysis",
    response_model=AIAnalysisResponse,
    dependencies=[Depends(ai_limit_5_per_min)],
)
async def get_ai_analysis(
    session_id: int,
    payload: AIAnalysisRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate AI reading diagnosis and improvement suggestions.

    If the session already has a cached analysis, returns it immediately
    without calling Gemini again. Otherwise calls Gemini and caches the
    result in the session's ai_analysis column.

    Rate limited: 5 requests per minute per user/IP.
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    # Return cached result if available
    if session.ai_analysis:
        try:
            cached = json.loads(session.ai_analysis)
            return AIAnalysisResponse(**cached)
        except (json.JSONDecodeError, TypeError):
            # Corrupted cache — regenerate
            logger.warning("Corrupted ai_analysis cache for session %d, regenerating", session_id)

    # Call Gemini
    try:
        analysis = await generate_reading_analysis({
            "story_title": payload.story_title,
            "accuracy": payload.accuracy,
            "cpm": payload.cpm,
            "error_chars": payload.error_chars,
            "total_characters": payload.total_characters,
            # Optional enrichment (Issue #415)
            "comprehension_score": payload.comprehension_score,
            "vocab_practiced_count": payload.vocab_practiced_count,
            "vocab_total_count": payload.vocab_total_count,
            "dictation_correct_count": payload.dictation_correct_count,
            "dictation_total_count": payload.dictation_total_count,
        })
    except TimeoutError:
        raise HTTPException(status_code=503, detail="AI service timeout")
    except Exception as e:
        logger.error("AI analysis generation failed for session %d: %s", session_id, e)
        raise HTTPException(status_code=503, detail="AI service unavailable")

    # Cache the result
    session.ai_analysis = json.dumps(analysis, ensure_ascii=False)
    db.commit()

    logger.info("Generated AI analysis for session %d", session_id)
    return AIAnalysisResponse(**analysis)


@router.post(
    "/learning/ai-analysis",
    response_model=AIAnalysisResponse,
    dependencies=[Depends(ai_limit_5_per_min)],
)
async def get_ai_analysis_standalone(
    payload: AIAnalysisRequest,
    current_user: User = Depends(get_current_user),
):
    """Generate AI reading diagnosis without requiring a backend session.

    This endpoint is for the frontend learning flow which manages sessions
    in-memory. No caching — analysis is generated fresh each call.

    Rate limited: 5 requests per minute per user/IP.
    """
    try:
        analysis = await generate_reading_analysis({
            "story_title": payload.story_title,
            "accuracy": payload.accuracy,
            "cpm": payload.cpm,
            "error_chars": payload.error_chars,
            "total_characters": payload.total_characters,
            # Optional enrichment (Issue #415)
            "comprehension_score": payload.comprehension_score,
            "vocab_practiced_count": payload.vocab_practiced_count,
            "vocab_total_count": payload.vocab_total_count,
            "dictation_correct_count": payload.dictation_correct_count,
            "dictation_total_count": payload.dictation_total_count,
        })
    except TimeoutError:
        raise HTTPException(status_code=503, detail="AI service timeout")
    except Exception as e:
        logger.error("Standalone AI analysis generation failed: %s", e)
        raise HTTPException(status_code=503, detail="AI service unavailable")

    logger.info("Generated standalone AI analysis for user %d", current_user.id)
    return AIAnalysisResponse(**analysis)
