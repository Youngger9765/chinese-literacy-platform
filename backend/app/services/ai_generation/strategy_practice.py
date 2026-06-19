"""
Reading-spotlight (閱讀聚光燈) strategy free-text grading (Issue #2192 item 5).

Professor 2026-06-04 demo feedback: 填空/申論作答後只顯示「已記錄你的答案」，
沒有即時回饋。要導入 AI 即時批改，寫到七八成對就給正向回饋。

Public function:
  validate_strategy_answer — lenient, encouraging AI grading of a free_text step
"""

import logging

from google.genai import types as genai_types

from ..ai_base import (
    generate_structured_response,
    sanitize_ai_input,
    TUTOR_PERSONA,
)

logger = logging.getLogger(__name__)

__all__ = [
    "STRATEGY_VALIDATION_SCHEMA",
    "validate_strategy_answer",
]

STRATEGY_VALIDATION_SCHEMA = {
    "type": "object",
    "properties": {
        "is_correct": {"type": "boolean"},
        "feedback": {"type": "string"},
        "suggestion": {"type": "string"},
    },
    "required": ["is_correct", "feedback", "suggestion"],
}


async def validate_strategy_answer(
    question: str,
    student_answer: str,
    strategy_name: str | None = None,
    story_title: str | None = None,
    passage: str | None = None,
) -> dict:
    """Grade a student's free-text answer to a reading-spotlight guided step.

    Lenient by design (professor: 「寫到七八成對就給正向回饋」): if the answer
    captures roughly 70%+ of the expected idea it counts as correct and gets pure
    encouragement. Otherwise a gentle, non-negative hint.

    Returns {"is_correct": bool, "feedback": str, "suggestion": str}
    - is_correct: True when the answer reasonably addresses the question
    - feedback: one encouraging sentence (never uses 錯/不對/不正確)
    - suggestion: gentle rewrite hint when not correct (empty string if correct)
    """
    safe_question, _ = sanitize_ai_input(question)
    safe_answer, _ = sanitize_ai_input(student_answer)
    safe_strategy, _ = sanitize_ai_input(strategy_name or "")
    safe_title, _ = sanitize_ai_input(story_title or "")

    system_prompt = f"""{TUTOR_PERSONA}

正在陪學生練習「閱讀聚光燈」策略{f'（{safe_strategy}）' if safe_strategy else ''}{f'，課文：《{safe_title}》' if safe_title else ''}。
學生剛剛用自己的話回答一個開放式問題。

判斷規則（寬鬆，重點在抓到大意）：
- 學生的答案只要抓到問題核心的七八成意思、方向正確，就算對 → is_correct=true
- 不要求一字不差或完整句子；關鍵詞或大意對了就給過
- 完全答非所問、空白、或明顯誤解 → is_correct=false

回覆規則（非常重要）：
- feedback **只能一句話**，不要用「錯」「不對」「不行」「不正確」等否定字眼
- is_correct=true：feedback 是一句純鼓勵（可點出他抓對了什麼）；suggestion 留空字串
- is_correct=false：feedback 是一句溫柔提醒（先肯定再提示，例如「方向對了，再想想看…」）；suggestion 是一句引導提示，幫他往正確方向想（不要直接給答案）
- 一律使用臺灣繁體中文（zh-TW）"""

    if passage:
        safe_passage, _ = sanitize_ai_input(passage)
        system_prompt += f"""

以下是這一課的課文，請依課文內容判斷學生答案是否正確：
\"\"\"
{safe_passage[:4000]}
\"\"\""""

    contents = [
        genai_types.Content(
            role="user",
            parts=[
                genai_types.Part(
                    text=(
                        f"問題：{safe_question}\n"
                        f"學生的答案：「{safe_answer}」\n"
                        "請評估這個答案是否抓到問題核心。"
                    )
                )
            ],
        )
    ]

    result = await generate_structured_response(
        system_prompt=system_prompt,
        contents=contents,
        response_schema=STRATEGY_VALIDATION_SCHEMA,
        max_tokens=1024,
        task="strategy_validate",
        temperature=0.3,
    )

    # Defensive: clear suggestion when correct (in case model violates prompt)
    if result.get("is_correct"):
        result["suggestion"] = ""

    return result
