"""Vocabulary and Listening routes.

Handles sentence practice (Issue #109) and listening comprehension evaluation (Issue #251).
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import ai_limit_5_per_min, ai_limit_10_per_min
from ...database import get_db
from ...models.user import User
from ...services.ai_service import generate_example_sentences, validate_student_sentence
from ...services.listening_service import evaluate_retelling

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Sentence Practice (Issue #109) ──────────────────────────────────────────

class ExampleSentencesRequest(BaseModel):
    character: str = Field(..., min_length=1, max_length=1, description="The Chinese character to generate sentences for")
    story_title: str = Field(..., min_length=1, max_length=100)


class ExampleSentenceItem(BaseModel):
    sentence: str
    explanation: str


class ExampleSentencesResponse(BaseModel):
    sentences: list[ExampleSentenceItem]


class ValidateSentenceRequest(BaseModel):
    character: str = Field(..., min_length=1, max_length=1, description="The target character that must appear in the sentence")
    student_sentence: str = Field(..., min_length=1, max_length=200, description="The student's composed sentence")
    story_title: str = Field(..., min_length=1, max_length=100)


class ValidateSentenceResponse(BaseModel):
    is_correct: bool
    feedback: str
    suggestion: str


@router.post(
    "/learning/sentence-practice/example-sentences",
    response_model=ExampleSentencesResponse,
    dependencies=[Depends(ai_limit_10_per_min)],
)
async def get_example_sentences(
    payload: ExampleSentencesRequest,
    current_user: User = Depends(get_current_user),
):
    """Generate 2 AI example sentences for a vocabulary character.

    Used in the sentence practice phase after stroke order practice (Issue #109).
    Rate limited: 10 requests per minute per user/IP.
    """
    try:
        result = await generate_example_sentences(
            character=payload.character,
            story_title=payload.story_title,
        )
    except TimeoutError:
        raise HTTPException(status_code=503, detail="AI service timeout")
    except Exception as e:
        logger.error("Example sentence generation failed for char=%s: %s", payload.character, e)
        raise HTTPException(status_code=503, detail="AI service unavailable")

    return ExampleSentencesResponse(
        sentences=[ExampleSentenceItem(**s) for s in result.get("sentences", [])],
    )


@router.post(
    "/learning/sentence-practice/validate",
    response_model=ValidateSentenceResponse,
    dependencies=[Depends(ai_limit_10_per_min)],
)
async def validate_sentence(
    payload: ValidateSentenceRequest,
    current_user: User = Depends(get_current_user),
):
    """Validate a student's composed sentence for a vocabulary character.

    Returns AI feedback on whether the sentence is grammatically correct
    and uses the target character appropriately (Issue #109).
    Rate limited: 10 requests per minute per user/IP.
    """
    # Basic check: target character must appear in the sentence
    if payload.character not in payload.student_sentence:
        return ValidateSentenceResponse(
            is_correct=False,
            feedback="你的句子裡沒有包含目標生字喔！",
            suggestion=f"請記得在句子中使用「{payload.character}」這個字。",
        )

    try:
        result = await validate_student_sentence(
            character=payload.character,
            student_sentence=payload.student_sentence,
            story_title=payload.story_title,
        )
    except TimeoutError:
        raise HTTPException(status_code=503, detail="AI service timeout")
    except Exception as e:
        logger.error(
            "Sentence validation failed for char=%s sentence=%s: %s",
            payload.character, payload.student_sentence[:50], e,
        )
        raise HTTPException(status_code=503, detail="AI service unavailable")

    return ValidateSentenceResponse(
        is_correct=result.get("is_correct", True),
        feedback=result.get("feedback", "做得好！"),
        suggestion=result.get("suggestion", ""),
    )


# ── Listening Comprehension (Issue #251) ─────────────────────────────────────

class ListeningEvaluateRequest(BaseModel):
    story_title: str = Field(..., max_length=200)
    original_text: str = Field(..., max_length=10000)
    student_retelling: str = Field(..., min_length=1, max_length=2000)


class ListeningEvaluateResponse(BaseModel):
    score: float
    key_points_covered: list[str]
    key_points_missed: list[str]
    feedback: str
    encouragement: str


@router.post(
    "/learning/listening/evaluate",
    response_model=ListeningEvaluateResponse,
    dependencies=[Depends(ai_limit_5_per_min)],
)
async def evaluate_listening_retelling(
    payload: ListeningEvaluateRequest,
    current_user: User = Depends(get_current_user),
    _db: Session = Depends(get_db),
):
    """Evaluate a student's retelling of a story they listened to.

    Uses Gemini AI to assess how completely the student captured key points
    from the original text. Rate limited: 5 requests per minute.

    Returns a score (0-100), covered/missed key points, and feedback.
    """
    try:
        result = await evaluate_retelling(
            original_text=payload.original_text,
            student_retelling=payload.student_retelling,
            story_title=payload.story_title,
        )
    except TimeoutError:
        raise HTTPException(status_code=503, detail="AI service timeout")
    except Exception as e:
        logger.error("Listening evaluation failed: %s", e)
        raise HTTPException(status_code=503, detail="AI service unavailable")

    logger.info(
        "Listening eval for user %d, story=%s: score=%.1f",
        current_user.id,
        payload.story_title,
        result["score"],
    )

    return ListeningEvaluateResponse(
        score=result["score"],
        key_points_covered=result.get("key_points_covered", []),
        key_points_missed=result.get("key_points_missed", []),
        feedback=result.get("feedback", ""),
        encouragement=result.get("encouragement", ""),
    )
