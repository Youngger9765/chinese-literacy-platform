"""
Teacher Comment AI generation (Issue #993).

Schema, system prompt, and one public function:
  generate_teacher_comment — personalized teacher comment for a learning session
"""

import logging

from google.genai import types as genai_types

from ..ai_base import (
    generate_structured_response,
    sanitize_ai_input,
)

logger = logging.getLogger(__name__)

__all__ = [
    "TEACHER_COMMENT_SCHEMA",
    "generate_teacher_comment",
]

TEACHER_COMMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "comment": {"type": "string"},
    },
    "required": ["comment"],
}

_TEACHER_COMMENT_SYSTEM_PROMPT = """你是一位專業的國語文教師助理。
根據學生的朗讀表現數據，撰寫一段簡短的個人化評語（100-200字），供教師參考。

規則：
- 語氣溫暖、正面鼓勵，同時具體指出可改進之處
- 先肯定優點，再建議改進方向
- 用「你」稱呼學生
- 適合國小高年級～國中生閱讀
- 不要使用表情符號
- 如果有錯字資料，具體提到哪些字需要多練習
"""


async def generate_teacher_comment(
    story_title: str,
    accuracy: float | None,
    cpm: float | None,
    error_chars: list[str] | None = None,
    comprehension_score: float | None = None,
) -> str:
    """Generate an AI comment for a learning session to assist teacher review (Issue #993)."""
    # Don't generate if there's no meaningful data
    if accuracy is None and cpm is None and comprehension_score is None:
        return ""

    parts = [f"課文：{sanitize_ai_input(story_title[:100])[0]}"]
    if accuracy is not None:
        parts.append(f"朗讀正確率：{accuracy:.0f}%")
    if cpm is not None:
        parts.append(f"朗讀速度：每分鐘 {cpm:.0f} 字")
    if comprehension_score is not None:
        parts.append(f"課文理解分數：{comprehension_score:.0f}/100")
    if error_chars:
        chars_str = "、".join(error_chars[:15])
        parts.append(f"讀錯的字：{chars_str}")

    user_msg = "\n".join(parts) + "\n\n請撰寫教師評語。"

    try:
        contents = [
            genai_types.Content(
                role="user",
                parts=[genai_types.Part(text=user_msg)],
            )
        ]
        result = await generate_structured_response(
            system_prompt=_TEACHER_COMMENT_SYSTEM_PROMPT,
            contents=contents,
            response_schema=TEACHER_COMMENT_SCHEMA,
            max_tokens=512,
            temperature=0.7,
            task="teacher_comment",
        )
        return result.get("comment", "")
    except Exception as e:
        logger.warning("generate_teacher_comment failed: %s", e)
        return ""
