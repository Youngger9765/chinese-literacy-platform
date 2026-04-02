"""Vocabulary and Listening routes.

Handles sentence practice (Issue #109) and listening comprehension evaluation (Issue #251).
"""
import logging
import time
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import ai_limit_5_per_min, ai_limit_10_per_min, ai_rate_limiter
from ...database import get_db
from ...models.user import User
from ...services.ai_service import generate_example_sentences, validate_student_sentence
from ...services.ai_usage_tracker import last_usage, log_ai_usage
from ...services.example_sentence_cache import get_cached, set_cached
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
    source: str = Field(default="ai", description="'pregenerated' if from cache/JSON, 'ai' if generated in real-time")


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
)
async def get_example_sentences(
    request: Request,
    payload: ExampleSentencesRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate 2 AI example sentences for a vocabulary character.

    Returns cached result if available (TTL 30 days) to avoid repeated Gemini
    API calls for the same character + story (Issue #730).
    Rate limited: 10 requests per minute per user/IP (cache miss only, Issue #911).
    """
    # 1. Cache hit — return immediately without calling AI (no rate limit)
    cached = get_cached(story_title=payload.story_title, character=payload.character)
    if cached is not None:
        logger.debug(
            "Example sentence cache hit: char=%s story=%s source=%s",
            payload.character,
            payload.story_title,
            cached.get("source", "ai"),
        )
        def _to_item(s: object) -> ExampleSentenceItem:
            # Pre-generated cache stores plain strings; AI-generated cache stores dicts.
            if isinstance(s, str):
                return ExampleSentenceItem(sentence=s, explanation="")
            return ExampleSentenceItem(**s)

        # Determine source: explicitly-tagged pregenerated entries keep "pregenerated";
        # all other cache hits (AI results stored after first call) are treated as "pregenerated"
        # because they return instantly without an AI call.
        cache_source = cached.get("source", "pregenerated")
        return ExampleSentencesResponse(
            sentences=[_to_item(s) for s in cached.get("sentences", [])],
            source=cache_source,
        )

    # 2. Cache miss — enforce rate limit before calling AI (Issue #911)
    user_id = getattr(request.state, "user_id", None)
    rl_key = f"ai:user:{user_id}" if user_id else f"ai:ip:{request.client.host if request.client else 'unknown'}"
    if not ai_rate_limiter.check(rl_key, max_requests=10, window_seconds=60):
        raise HTTPException(status_code=429, detail="AI endpoint rate limit exceeded. Please wait before retrying.")
    start_time = time.monotonic()
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

    # Track AI usage (Issue #874)
    latency_ms = int((time.monotonic() - start_time) * 1000)
    usage = last_usage.get()
    log_ai_usage(
        db,
        endpoint="/learning/sentence-practice/example-sentences",
        step="vocab",
        student_id=current_user.id,
        story_title=payload.story_title,
        input_tokens=usage.input_tokens if usage else 0,
        output_tokens=usage.output_tokens if usage else 0,
        model=usage.model if usage else "gemini-2.5-flash",
        latency_ms=latency_ms,
        success=True,
        model_version=usage.model_version if usage else None,
        prompt_char_count=usage.prompt_char_count if usage else None,
        response_char_count=usage.response_char_count if usage else None,
        content_filtered=usage.content_filtered if usage else False,
        prompt_template_id="vocab_example_sentences",
    )

    # 3. Store in cache for next request
    try:
        set_cached(
            story_title=payload.story_title,
            character=payload.character,
            result=result,
        )
    except Exception as exc:
        # Cache write failure is non-fatal — log and continue
        logger.warning("Failed to write example sentence cache: %s", exc)

    return ExampleSentencesResponse(
        sentences=[ExampleSentenceItem(**s) for s in result.get("sentences", [])],
        source="ai",
    )


@router.post(
    "/learning/sentence-practice/validate",
    response_model=ValidateSentenceResponse,
    dependencies=[Depends(ai_limit_10_per_min)],
)
async def validate_sentence(
    payload: ValidateSentenceRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
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

    start_time = time.monotonic()
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

    # Track AI usage (Issue #874)
    latency_ms = int((time.monotonic() - start_time) * 1000)
    usage = last_usage.get()
    log_ai_usage(
        db,
        endpoint="/learning/sentence-practice/validate",
        step="vocab_validate",
        student_id=current_user.id,
        story_title=payload.story_title,
        input_tokens=usage.input_tokens if usage else 0,
        output_tokens=usage.output_tokens if usage else 0,
        model=usage.model if usage else "gemini-2.5-flash",
        latency_ms=latency_ms,
        success=True,
        model_version=usage.model_version if usage else None,
        prompt_char_count=usage.prompt_char_count if usage else None,
        response_char_count=usage.response_char_count if usage else None,
        content_filtered=usage.content_filtered if usage else False,
        prompt_template_id="vocab_validate_sentence",
    )

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
    db: Session = Depends(get_db),
):
    """Evaluate a student's retelling of a story they listened to.

    Uses Gemini AI to assess how completely the student captured key points
    from the original text. Rate limited: 5 requests per minute.

    Returns a score (0-100), covered/missed key points, and feedback.
    """
    start_time = time.monotonic()
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

    # Track AI usage (Issue #874)
    latency_ms = int((time.monotonic() - start_time) * 1000)
    usage = last_usage.get()
    log_ai_usage(
        db,
        endpoint="/learning/listening/evaluate",
        step="listening",
        student_id=current_user.id,
        story_title=payload.story_title,
        input_tokens=usage.input_tokens if usage else 0,
        output_tokens=usage.output_tokens if usage else 0,
        model=usage.model if usage else "gemini-2.5-flash",
        latency_ms=latency_ms,
        success=True,
        model_version=usage.model_version if usage else None,
        prompt_char_count=usage.prompt_char_count if usage else None,
        response_char_count=usage.response_char_count if usage else None,
        content_filtered=usage.content_filtered if usage else False,
        prompt_template_id="vocab_listening_evaluate",
    )

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
