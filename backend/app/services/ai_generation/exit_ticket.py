"""
Exit Ticket AI generation and grading (Issue #463).

Schema, system prompt, and two public functions:
  generate_exit_ticket — MCQ generation
  grade_exit_ticket    — stub (MCQ graded deterministically in route layer)
"""

import logging

from google.genai import types as genai_types

from ..ai_base import (
    generate_structured_response,
    sanitize_ai_input,
)

logger = logging.getLogger(__name__)

__all__ = [
    "EXIT_TICKET_SCHEMA",
    "generate_exit_ticket",
    "grade_exit_ticket",
]

EXIT_TICKET_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "question": {"type": "string"},
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 4,
                        "maxItems": 4,
                    },
                    "correct_index": {"type": "integer"},
                    "explanation": {"type": "string"},
                },
                "required": ["id", "question", "options", "correct_index", "explanation"],
            },
            "minItems": 3,
            "maxItems": 5,
        }
    },
    "required": ["questions"],
}

_EXIT_TICKET_SYSTEM_PROMPT = """你是一位專業的國語文教師，負責出「出場卷」測驗。

根據課文內容，設計 3~5 題選擇題，測驗學生對課文的理解程度。
題目類型應包含：
1. 字面理解題（直接從課文找答案）
2. 推論理解題（需要推理或推斷）
3. 評價理解題（整體評價、主旨、道理）

規則：
- 每題有 4 個選項，只有一個正確答案
- correct_index 從 0 開始（0=第一個選項, 1=第二個, 2=第三個, 3=第四個）
- explanation 用中文說明正確答案的依據（1~2 句）
- 題目難易度適合國小高年級～國中生
- 嚴禁出現與課文無關的問題
- 如果有提供學生讀錯的字，至少出一題考形近字辨識
"""


async def generate_exit_ticket(
    text: str,
    wrong_chars: list[str] | None = None,
) -> dict:
    """
    Generate exit-ticket multiple choice questions for a story text (Issue #463).

    Uses Gemini 2.5 Flash to produce 3-5 multiple choice questions covering
    literal comprehension, inferential comprehension, and evaluative comprehension
    (三層次理解). If wrong_chars are provided, includes at least one character
    recognition question based on the student's errors.

    Args:
        text: Story/lesson content (joined paragraphs)
        wrong_chars: Optional list of characters the student mispronounced

    Returns:
        {"questions": [{"id", "question", "options", "correct_index", "explanation"}, ...]}
        On AI failure: {"questions": [], "fallback": True}
        NEVER returns auto-pass data on failure.
    """
    sanitized_text, _ = sanitize_ai_input(text[:3000])
    wrong_chars_info = ""
    if wrong_chars:
        wrong_chars_info = f"\n\n【學生朗讀時讀錯的字】：{', '.join(wrong_chars[:10])}\n請至少出一題考這些字的辨識（形近字選擇）。"

    contents = [
        genai_types.Content(
            role="user",
            parts=[
                genai_types.Part(
                    text=f"以下是課文內容：\n\n{sanitized_text}{wrong_chars_info}\n\n請根據課文出 3~5 題選擇題。",
                ),
            ],
        )
    ]

    try:
        result = await generate_structured_response(
            system_prompt=_EXIT_TICKET_SYSTEM_PROMPT,
            contents=contents,
            response_schema=EXIT_TICKET_SCHEMA,
            max_tokens=2048,
            temperature=0.5,
            task="exit_ticket_generate",
        )
        questions = result.get("questions", [])
        if not questions:
            logger.warning("generate_exit_ticket: AI returned empty questions list")
            return {"questions": [], "fallback": True}
        # Clamp correct_index to valid range 0-3
        for q in questions:
            q["correct_index"] = max(0, min(3, int(q.get("correct_index", 0))))
        return {"questions": questions}
    except Exception as e:
        logger.error("generate_exit_ticket AI call failed: %s", e)
        return {"questions": [], "fallback": True}


async def grade_exit_ticket(question: str, student_answer: str, reference_text: str) -> dict:
    """
    Grade a student's exit-ticket answer.

    For multiple-choice exit tickets, grading is done deterministically
    by comparing selected_index to correct_index (handled in the route/service).
    This function is preserved for potential future open-ended answer grading.
    """
    return {"score": 0, "feedback": "此函式保留給未來開放式題型批改使用"}
