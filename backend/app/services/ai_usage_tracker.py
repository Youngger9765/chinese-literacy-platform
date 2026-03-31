"""AI token usage tracking — DB persistence + structured logging (Issue #874).

Provides:
- `log_ai_usage()` — record a single AI call to DB + structured log
- `estimate_cost()` — calculate estimated USD cost from token counts
- `last_usage` context var — populated by ai_service after each Gemini call
"""

import contextvars
import logging
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

logger = logging.getLogger("ai_usage")

# Gemini 2.5 Flash pricing (per 1M tokens) — as of 2026-03
PRICING = {
    "gemini-2.5-flash": {"input": 0.15, "output": 0.60},
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
    model: str = "gemini-2.5-flash"


# Context variable to pass usage metadata from ai_service to route handlers
# without changing function signatures. Reset per-request by the tracker.
last_usage: contextvars.ContextVar[UsageMetadata | None] = contextvars.ContextVar(
    "last_usage", default=None
)


def capture_usage(response, model: str = "gemini-2.5-flash") -> UsageMetadata:
    """Extract token counts from a Gemini response and store in context var.

    Call this inside ai_service right after a successful generate_content call.
    Route handlers can then read `last_usage.get()` to log the data.
    """
    meta = UsageMetadata(model=model)
    try:
        usage = response.usage_metadata
        if usage:
            meta.input_tokens = getattr(usage, "prompt_token_count", 0) or 0
            meta.output_tokens = getattr(usage, "candidates_token_count", 0) or 0
            meta.total_tokens = getattr(usage, "total_token_count", 0) or 0
    except Exception:
        pass
    last_usage.set(meta)
    return meta


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Calculate estimated USD cost from token counts."""
    pricing = PRICING.get(model, PRICING["gemini-2.5-flash"])
    return (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1_000_000


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
    model: str = "gemini-2.5-flash",
    latency_ms: int = 0,
    success: bool = True,
    error_type: str | None = None,
    action: str | None = None,
    metadata: dict | None = None,
) -> None:
    """Log an AI API call to both DB and structured logs.

    If `db` is None, only structured logging is performed (no DB write).
    DB write failures are non-fatal — they log a warning and continue.
    """
    from ..models.ai_usage import AIUsageLog

    total = input_tokens + output_tokens
    cost = estimate_cost(model, input_tokens, output_tokens)
    step_label = STEP_LABELS.get(step) if step else None

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
            )
            db.add(record)
            db.commit()
        except Exception as e:
            logger.warning("Failed to write AI usage to DB: %s", e)
            try:
                db.rollback()
            except Exception:
                pass

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
            "latency_ms": latency_ms,
            "success": success,
            "error_type": error_type,
        },
    )
