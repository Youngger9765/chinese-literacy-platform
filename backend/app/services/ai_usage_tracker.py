"""AI token usage tracking — DB persistence + structured logging (Issue #874).

Provides:
- `log_ai_usage()` — record a single AI call to DB + structured log
- `estimate_cost()` — calculate estimated USD cost from token counts
- `last_usage` context var — populated by ai_service after each Gemini call
- `_resolve_context()` — best-effort denormalized dimension lookup
"""

import contextvars
import logging
import uuid
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

logger = logging.getLogger("ai_usage")

# Gemini pricing (per 1M tokens) — as of 2026-05
PRICING = {
    "gemini-2.5-flash": {"input": 0.30, "output": 2.50},      # used by OMO services
    "gemini-flash-lite-latest": {"input": 0.25, "output": 1.50},  # default for non-OMO
}

STEP_LABELS = {
    "comprehension": "課文理解",
    "comprehension_question": "理解提問",
    "reading": "朗讀評估",
    "full_reading": "全文朗讀",
    "vocab": "生字練習",
    "vocab_validate": "造句驗證",
    "structure": "文章重點表",
    "exit_ticket": "出場券",
    "analysis": "AI 分析",
    "listening": "聽力理解",
}


@dataclass
class UsageMetadata:
    """Token usage captured from a single Gemini API response."""

    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    model: str = "gemini-flash-lite-latest"
    model_version: str | None = None
    finish_reason: str | None = None
    prompt_char_count: int | None = None
    response_char_count: int | None = None
    content_filtered: bool = False


# Context variable to pass usage metadata from ai_service to route handlers
# without changing function signatures. Reset per-request by the tracker.
last_usage: contextvars.ContextVar[UsageMetadata | None] = contextvars.ContextVar(
    "last_usage", default=None
)


def _extract_usage(response, model: str = "gemini-flash-lite-latest") -> UsageMetadata:
    """Extract token counts from a single Gemini response into a UsageMetadata."""
    meta = UsageMetadata(model=model)
    try:
        usage = response.usage_metadata
        if usage:
            meta.input_tokens = getattr(usage, "prompt_token_count", 0) or 0
            meta.output_tokens = getattr(usage, "candidates_token_count", 0) or 0
            meta.total_tokens = getattr(usage, "total_token_count", 0) or 0
    except Exception:
        pass

    # Model version from API response (if available)
    try:
        meta.model_version = getattr(response, "model_version", None)
    except Exception:
        pass

    # Finish reason from first candidate
    try:
        if response.candidates:
            meta.finish_reason = str(response.candidates[0].finish_reason)
    except Exception:
        pass

    # Response char count
    try:
        if response.text:
            meta.response_char_count = len(response.text)
    except Exception:
        pass

    # Content filter detection
    try:
        if response.candidates:
            fr = str(response.candidates[0].finish_reason)
            if "SAFETY" in fr:
                meta.content_filtered = True
    except Exception:
        pass

    return meta


def capture_usage(response, model: str = "gemini-flash-lite-latest") -> UsageMetadata:
    """Capture and accumulate usage metadata from a Gemini response.

    Call this inside ai_service right after a successful generate_content call.
    Route handlers can then read `last_usage.get()` to log the data.

    When multiple Gemini calls occur in a single request (e.g. socratic_agent
    making evaluation + question calls), tokens are accumulated so the final
    log_ai_usage call captures the total. The `last_usage.set(None)` reset at
    the start of each generate_structured_response call ensures accumulation
    is per-request, not cross-request.
    """
    new_usage = _extract_usage(response, model=model)
    existing = last_usage.get()
    if existing and new_usage:
        # Accumulate tokens from multiple calls in the same request
        new_usage = UsageMetadata(
            input_tokens=existing.input_tokens + new_usage.input_tokens,
            output_tokens=existing.output_tokens + new_usage.output_tokens,
            total_tokens=existing.total_tokens + new_usage.total_tokens,
            model=new_usage.model,
            model_version=new_usage.model_version or existing.model_version,
            finish_reason=new_usage.finish_reason,
            prompt_char_count=(existing.prompt_char_count or 0) + (new_usage.prompt_char_count or 0),
            response_char_count=(existing.response_char_count or 0) + (new_usage.response_char_count or 0),
            content_filtered=existing.content_filtered or new_usage.content_filtered,
        )
    last_usage.set(new_usage)
    return new_usage


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Calculate estimated USD cost from token counts."""
    pricing = PRICING.get(model, PRICING["gemini-flash-lite-latest"])
    return (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1_000_000


def _resolve_context(
    db: Session | None,
    student_id: int | None = None,
    story_id: str | None = None,
    # Caller-provided values to avoid re-querying the User table (review concern fix).
    user_display_name: str | None = None,
    user_role: str | None = None,
) -> dict:
    """Resolve denormalized dimension values from related tables.

    Best-effort: if any lookup fails, the field is simply omitted (left NULL).
    Never let this crash the main request.

    When ``user_display_name`` is provided (from ``current_user`` in the route
    handler), the User table query is skipped entirely.
    """
    result: dict = {}
    if not db:
        # Even without a DB session, accept caller-provided values.
        if user_display_name:
            result["student_name"] = user_display_name
        return result

    try:
        if student_id:
            if user_display_name:
                # Route handler already resolved the user — skip DB query.
                result["student_name"] = user_display_name
                # grade_level still needs a DB lookup if we don't have it.
                # Acceptable trade-off: skip for now, populate when we add
                # grade_level to the current_user dependency.
            else:
                from ..models.user import User

                user = db.query(User).filter(User.id == student_id).first()
                if user:
                    result["student_name"] = getattr(user, "display_name", None) or getattr(user, "username", None)
                    result["grade_level"] = getattr(user, "grade_level", None)

                # TODO: resolve teacher_id, teacher_name, org_id, school_name,
                # classroom_name from ClassroomMembership -> Classroom -> teacher.
                # For now these remain NULL — the column exists for future population.
    except Exception as e:
        logger.debug("_resolve_context student lookup failed: %s", e)

    try:
        if story_id:
            # Try to get genre from story loader
            from ..routes.stories import get_lesson_by_id

            from ..utils.slug import normalize_story_slug
            numeric_id = int(normalize_story_slug(story_id))
            story = get_lesson_by_id(numeric_id)
            if story:
                result["genre"] = story.get("genre")
    except Exception as e:
        logger.debug("_resolve_context story lookup failed: %s", e)

    return result


def log_ai_usage(
    db: Session | None,
    *,
    endpoint: str,
    step: str | None = None,
    student_id: int | None = None,
    user_role: str | None = None,
    story_id: str | None = None,
    story_title: str | None = None,
    session_id: int | None = None,
    classroom_id: int | None = None,
    assignment_id: int | None = None,
    request_url: str | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    model: str = "gemini-flash-lite-latest",
    latency_ms: int = 0,
    success: bool = True,
    error_type: str | None = None,
    action: str | None = None,
    metadata: dict | None = None,
    # ── New analytics fields ──
    model_version: str | None = None,
    prompt_template_id: str | None = None,
    prompt_char_count: int | None = None,
    response_char_count: int | None = None,
    retry_count: int = 0,
    content_filtered: bool = False,
    cache_hit: bool = False,
    request_payload: dict | None = None,
    response_payload: dict | None = None,
    request_id: str | None = None,
    parent_request_id: str | None = None,
    # Caller-provided user info to avoid re-querying (review concern fix)
    user_display_name: str | None = None,
) -> None:
    """Log an AI API call to both DB and structured logs.

    If `db` is None, only structured logging is performed (no DB write).
    DB write failures are non-fatal — they log a warning and continue.
    """
    from ..models.ai_usage import AIUsageLog

    total = input_tokens + output_tokens
    cost = estimate_cost(model, input_tokens, output_tokens)
    step_label = STEP_LABELS.get(step) if step else None

    # Auto-generate request_id for correlation if not provided
    if not request_id:
        request_id = str(uuid.uuid4())

    # Best-effort denormalized context resolution
    ctx = _resolve_context(
        db, student_id=student_id, story_id=story_id,
        user_display_name=user_display_name, user_role=user_role,
    )

    # 1. DB write (non-blocking, don't fail the request if logging fails)
    if db is not None:
        try:
            record = AIUsageLog(
                student_id=student_id,
                user_role=user_role,
                endpoint=endpoint,
                action=action or "generate",
                model=model,
                latency_ms=latency_ms,
                story_id=story_id,
                story_title=story_title,
                session_id=session_id,
                step=step,
                step_label=step_label,
                classroom_id=classroom_id,
                assignment_id=assignment_id,
                request_url=request_url,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total,
                estimated_cost_usd=cost,
                success=success,
                error_type=error_type,
                metadata_=metadata,
                # Denormalized dimensions
                student_name=ctx.get("student_name"),
                grade_level=ctx.get("grade_level"),
                teacher_id=ctx.get("teacher_id"),
                teacher_name=ctx.get("teacher_name"),
                org_id=ctx.get("org_id"),
                school_name=ctx.get("school_name"),
                classroom_name=ctx.get("classroom_name"),
                genre=ctx.get("genre"),
                # Model details
                model_version=model_version,
                prompt_template_id=prompt_template_id,
                # Additional measures
                prompt_char_count=prompt_char_count,
                response_char_count=response_char_count,
                retry_count=retry_count,
                # Quality flags
                content_filtered=content_filtered,
                cache_hit=cache_hit,
                # Raw payloads
                request_payload=request_payload,
                response_payload=response_payload,
                # Correlation
                request_id=request_id,
                parent_request_id=parent_request_id,
            )
            # Use SAVEPOINT so a failure here only rolls back the usage insert,
            # not the caller's outer transaction (FAIL-1 review fix).
            with db.begin_nested():
                db.add(record)
            db.commit()
        except Exception as e:
            logger.warning("Failed to write AI usage to DB: %s", e)

    # 2. Structured logging (always, even if DB fails or db is None)
    logger.info(
        "ai_call",
        extra={
            "endpoint": endpoint,
            "step": step,
            "step_label": step_label,
            "student_id": student_id,
            "story_id": story_id,
            "story_title": story_title,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total,
            "estimated_cost_usd": float(cost),
            "model": model,
            "model_version": model_version,
            "latency_ms": latency_ms,
            "success": success,
            "error_type": error_type,
            "request_id": request_id,
            "cache_hit": cache_hit,
            "content_filtered": content_filtered,
            "prompt_char_count": prompt_char_count,
            "response_char_count": response_char_count,
        },
    )
