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
  - Fail-closed: on AI error return is_correct=true + neutral 已記錄 feedback so the
    student is never blocked by an AI outage (the step is non-gating)
"""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import ai_limit_10_per_min
from ...database import get_db
from ...models.user import User
from ...services.ai_service import validate_strategy_answer

router = APIRouter()
logger = logging.getLogger(__name__)


class ValidateStrategyRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)
    student_answer: str = Field(..., min_length=1, max_length=500)
    strategy_name: str | None = Field(None, max_length=128)
    story_title: str | None = Field(None, max_length=200)
    passage: str | None = Field(None, max_length=8000)


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
    Fail-closed: never blocks the student on an AI outage.
    """
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
        # Fail-closed toward the student: record the answer, don't block progress.
        return ValidateStrategyResponse(
            is_correct=True,
            feedback="已記錄你的答案，做得好！",
            suggestion="",
        )

    return ValidateStrategyResponse(
        is_correct=bool(result.get("is_correct", True)),
        feedback=str(result.get("feedback", "已記錄你的答案，做得好！")),
        suggestion=str(result.get("suggestion", "")),
    )
