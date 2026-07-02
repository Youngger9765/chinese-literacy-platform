"""Reading-spotlight (閱讀聚光燈) strategy free-text grading endpoint (Issue #2192 item 5).

Endpoint:
  POST /api/learning/strategy-practice/validate  — AI grade a free_text guided step

Professor 2026-06-04 demo feedback: 申論/填空只顯示「已記錄你的答案」，沒有即時回饋。
要導入 AI 即時批改，寫到七八成對就給正向回饋。

LLM hardening rules applied (llm-endpoint-hardening skill):
  - Rate limit (ai_limit_10_per_min dependency) — same as sentence-practice/validate
  - Auth: Depends(get_current_user)
  - Input cap: question max 1000, student_answer max 500 (Pydantic Field constraints)
  - Output cap: max_output_tokens=1024 (set in validate_strategy_answer)
  - Fail-OPEN (intentional): on AI error return is_correct=true + neutral 已記錄
    feedback so the student is never blocked by an AI outage. This is safe ONLY
    because this spotlight step is non-gating and its is_correct is never persisted
    as a score or used to unlock progress. If this step ever becomes gating/scored,
    switch to fail-closed (is_correct=false) — auto-passing on error would then be
    a real bug (platform invariant: never auto-pass a graded step on AI failure).
"""

import logging
import time

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import ai_limit_10_per_min
from ...database import get_db
from ...models.user import User
from ...services.ai_service import validate_strategy_answer
from ...services.ai_usage_tracker import last_usage, log_ai_usage

router = APIRouter()
logger = logging.getLogger(__name__)


class ValidateStrategyRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)
    student_answer: str = Field(..., min_length=1, max_length=500)
    strategy_name: str | None = Field(None, max_length=128)
    story_title: str | None = Field(None, max_length=200)
    # Capped at 4000 to match the prompt truncation in validate_strategy_answer
    # (safe_passage[:4000]) — sending more is silently ignored by the grader.
    passage: str | None = Field(None, max_length=4000)


class ValidateStrategyResponse(BaseModel):
    is_correct: bool
    feedback: str
    suggestion: str


@router.post(
    "/learning/strategy-practice/validate",
    response_model=ValidateStrategyResponse,
    dependencies=[Depends(ai_limit_10_per_min)],
)
async def validate_strategy(
    payload: ValidateStrategyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Grade a student's free-text answer to a 閱讀聚光燈 guided step.

    Lenient grading (七八成對 = 正向回饋). Returns encouraging feedback plus a
    gentle hint when off-track. Rate limited: 10 requests per minute per user.
    Fail-OPEN (intentional, non-gating): never blocks the student on an AI outage
    — safe only because is_correct is not persisted as a score here.
    """
    start_time = time.monotonic()
    try:
        result = await validate_strategy_answer(
            question=payload.question,
            student_answer=payload.student_answer,
            strategy_name=payload.strategy_name,
            story_title=payload.story_title,
            passage=payload.passage,
        )
    except Exception as e:
        logger.error("validate_strategy error: %s", e)
        # Fail-OPEN (intentional, non-gating step): record the answer, don't block
        # progress on an AI outage. Safe only because is_correct is not persisted
        # as a score here — see module docstring.
        return ValidateStrategyResponse(
            is_correct=True,
            feedback="已記錄你的答案，做得好！",
            suggestion="",
        )

    # Track AI usage (Issue #874) — consistent with sentence-practice/validate.
    latency_ms = int((time.monotonic() - start_time) * 1000)
    usage = last_usage.get()
    log_ai_usage(
        db,
        endpoint="/learning/strategy-practice/validate",
        step="strategy_validate",
        student_id=current_user.id,
        story_title=payload.story_title,
        input_tokens=usage.input_tokens if usage else 0,
        output_tokens=usage.output_tokens if usage else 0,
        model=usage.model if usage else "gemini-2.5-flash-lite",
        latency_ms=latency_ms,
        success=True,
        model_version=usage.model_version if usage else None,
        prompt_char_count=usage.prompt_char_count if usage else None,
        response_char_count=usage.response_char_count if usage else None,
        content_filtered=usage.content_filtered if usage else False,
        prompt_template_id="strategy_validate_answer",
    )

    return ValidateStrategyResponse(
        is_correct=bool(result.get("is_correct", True)),
        feedback=str(result.get("feedback", "已記錄你的答案，做得好！")),
        suggestion=str(result.get("suggestion", "")),
    )
