"""Vocabulary and Listening routes.

Handles sentence practice (Issue #109) and listening comprehension evaluation (Issue #251).
"""
import logging
import time
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import ai_limit_5_per_min, ai_limit_10_per_min, ai_rate_limiter, get_client_key
from ...database import get_db
from ...models.user import User
from ...services.ai_service import generate_example_sentences, validate_student_sentence
from ...services.lesson_loader import get_lesson_by_title
from ...services.ai_usage_tracker import last_usage, log_ai_usage
from ...services.example_sentence_cache import get_cached, set_cached
from ...services.input_sanitizer import sanitize_ai_input
from ...services.listening_service import evaluate_retelling

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Sentence Practice (Issue #109) ──────────────────────────────────────────

class ExampleSentencesRequest(BaseModel):
    word: str = Field(..., min_length=1, max_length=10, description="The Chinese vocabulary word to generate sentences for")
    story_title: str = Field(..., min_length=1, max_length=100)


class ExampleSentenceItem(BaseModel):
    sentence: str
    explanation: str


class ExampleSentencesResponse(BaseModel):
    sentences: list[ExampleSentenceItem]
    source: str = Field(default="ai", description="'pregenerated' if from cache/JSON, 'ai' if generated in real-time")


class ValidateSentenceRequest(BaseModel):
    word: str = Field(..., min_length=1, max_length=10, description="The target vocabulary word that must appear in the sentence")
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
    """Generate 2 AI example sentences for a vocabulary word.

    Returns cached result if available (TTL 30 days) to avoid repeated Gemini
    API calls for the same word + story (Issue #730).
    Rate limited: 10 requests per minute per user/IP (cache miss only, Issue #911).
    """
    # 1. Cache hit — return immediately without calling AI (no rate limit)
    cached = get_cached(story_title=payload.story_title, word=payload.word)
    if cached is not None:
        logger.debug(
            "Example sentence cache hit: word=%s story=%s source=%s",
            payload.word,
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
    rl_key = f"ai:{get_client_key(request)}"
    if not ai_rate_limiter.check(rl_key, max_requests=10, window_seconds=60):
        raise HTTPException(status_code=429, detail="AI endpoint rate limit exceeded. Please wait before retrying.")
    start_time = time.monotonic()
    try:
        result = await generate_example_sentences(
            word=payload.word,
            story_title=payload.story_title,
        )
    except TimeoutError:
        raise HTTPException(status_code=503, detail="AI service timeout")
    except Exception as e:
        logger.error("Example sentence generation failed for word=%s: %s", payload.word, e)
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
            word=payload.word,
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
    """Validate a student's composed sentence for a vocabulary word.

    Returns AI feedback on whether the sentence is grammatically correct
    and uses the target word appropriately (Issue #109, #927).
    Rate limited: 10 requests per minute per user/IP.
    """
    # Sanitize student input before sending to AI
    safe_sentence, _ = sanitize_ai_input(payload.student_sentence, user_id=str(current_user.id))
    safe_story_title, _ = sanitize_ai_input(payload.story_title, user_id=str(current_user.id))

    # Basic check: target word must appear in the sentence
    if payload.word not in safe_sentence:
        return ValidateSentenceResponse(
            is_correct=False,
            feedback="你的句子裡沒有包含目標詞語喔！",
            suggestion=f"請記得在句子中使用「{payload.word}」這個詞。",
        )

    # Copy-paste detection: reject sentences lifted from the passage (#928)
    import re

    passage_sentences: list[str] = []
    lesson = get_lesson_by_title(payload.story_title)
    if lesson is None:
        logger.warning("copy_detect: lesson not found for title=%r, skipping", payload.story_title)
    if lesson:
        full_text = lesson.get("full_text") or ""
        paragraphs = lesson.get("paragraphs") or []

        # Normalize: strip trailing punctuation for comparison
        normalized = safe_sentence.strip().rstrip("。！？，、；：「」『』")

        # Check: sentence is a substring of the passage (exact copy)
        if normalized and len(normalized) >= 4 and normalized in full_text:
            return ValidateSentenceResponse(
                is_correct=False,
                feedback="這個句子好像是從課文或例句中複製的喔！請試著用自己的話造一個新句子。",
                suggestion=f"試著用「{payload.word}」描述你自己的生活經驗或想像一個新的情境。",
            )

        # Check: sentence matches a paragraph substring
        for para in paragraphs:
            if normalized and len(normalized) >= 4 and normalized in para:
                return ValidateSentenceResponse(
                    is_correct=False,
                    feedback="這個句子和課文或例句內容太相似了，請用自己的話重新造句。",
                    suggestion=f"嘗試用「{payload.word}」造一個和課文、例句不同情境的句子。",
                )

        # Extract passage sentences containing the target word for AI cross-reference
        raw_sentences = re.split(r"[。！？]", full_text)
        passage_sentences = [
            s.strip() for s in raw_sentences
            if payload.word in s and s.strip()
        ][:5]

    start_time = time.monotonic()
    try:
        result = await validate_student_sentence(
            word=payload.word,
            student_sentence=safe_sentence,
            story_title=safe_story_title,
            passage_sentences=passage_sentences,
        )
    except TimeoutError:
        raise HTTPException(status_code=503, detail="AI service timeout")
    except Exception as e:
        logger.error(
            "Sentence validation failed for word=%s sentence=%s: %s",
            payload.word, payload.student_sentence[:50], e,
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
    # Sanitize student retelling before sending to AI
    safe_retelling, _ = sanitize_ai_input(payload.student_retelling, user_id=str(current_user.id))
    safe_story_title_listen, _ = sanitize_ai_input(payload.story_title, user_id=str(current_user.id))

    start_time = time.monotonic()
    try:
        result = await evaluate_retelling(
            original_text=payload.original_text,
            student_retelling=safe_retelling,
            story_title=safe_story_title_listen,
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
