"""
Listening comprehension evaluation service.

Evaluates how well a student's retelling captures the key points
of the original story text, using Gemini AI for structured analysis.
"""

import logging

from google.genai import types as genai_types

from .ai_service import generate_structured_response
from .input_sanitizer import sanitize_ai_input
from .persona import TUTOR_PERSONA

logger = logging.getLogger(__name__)

RETELLING_EVAL_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "score": {
            "type": "NUMBER",
            "description": "Overall retelling score 0-100",
        },
        "key_points_covered": {
            "type": "ARRAY",
            "items": {"type": "STRING"},
            "description": "Key points the student successfully captured",
        },
        "key_points_missed": {
            "type": "ARRAY",
            "items": {"type": "STRING"},
            "description": "Key points the student missed or stated incorrectly",
        },
        "feedback": {
            "type": "STRING",
            "description": "Warm, encouraging feedback in Traditional Chinese (2-4 sentences)",
        },
        "encouragement": {
            "type": "STRING",
            "description": "Short encouragement message (1 sentence)",
        },
    },
    "required": [
        "score",
        "key_points_covered",
        "key_points_missed",
        "feedback",
        "encouragement",
    ],
}


async def evaluate_retelling(
    original_text: str,
    student_retelling: str,
    story_title: str = "課文",
) -> dict:
    """Evaluate a student's retelling against the original story text.

    Uses Gemini to assess how completely and accurately the student
    captured the key points from the story they listened to.

    Args:
        original_text: The full story text the student listened to.
        student_retelling: The student's spoken/typed retelling.
        story_title: Title of the story (for context in prompts).

    Returns:
        Dict with keys: score, key_points_covered, key_points_missed,
                        feedback, encouragement.
    """
    # Sanitise student input to prevent prompt injection
    sanitized_retelling, _ = sanitize_ai_input(student_retelling)

    system_prompt = (
        f"{TUTOR_PERSONA}\n\n"
        "你同時也是一位國小國語文聽力理解評估專家。\n\n"
        "任務：評估學生在聽完課文後的覆述內容。\n\n"
        "評分標準：\n"
        "- 90-100分：覆述涵蓋所有主要情節、人物、事件，細節豐富\n"
        "- 75-89分：涵蓋大部分主要情節，偶有遺漏次要細節\n"
        "- 60-74分：涵蓋部分重要情節，有明顯遺漏\n"
        "- 45-59分：只覆述了少數關鍵訊息\n"
        "- 0-44分：覆述內容極少或與原文無關\n\n"
        "評估重點：\n"
        "1. 主要事件是否被提及\n"
        "2. 人物角色是否正確\n"
        "3. 因果關係是否理解\n"
        "4. 重要細節是否掌握\n\n"
        "回覆規則：\n"
        "- 必須使用臺灣繁體中文（zh-TW），嚴禁大陸用語\n"
        "- 語氣溫暖、鼓勵，適合國小高年級至國中生\n"
        "- key_points_covered 和 key_points_missed 各列 1-5 點\n"
        "- feedback 要具體，說明哪裡做得好、哪裡可以更完整"
    )

    user_prompt = (
        f"課文標題：{story_title}\n\n"
        f"原始課文：\n{original_text}\n\n"
        f"學生覆述：\n{sanitized_retelling}\n\n"
        "請評估學生的覆述品質，給出分數和詳細回饋。"
    )

    contents = [
        genai_types.Content(
            role="user",
            parts=[genai_types.Part(text=user_prompt)],
        )
    ]

    result = await generate_structured_response(
        system_prompt=system_prompt,
        contents=contents,
        response_schema=RETELLING_EVAL_SCHEMA,
        max_tokens=1024,
        temperature=0.5,
    )

    # Clamp score to [0, 100]
    result["score"] = max(0, min(100, float(result.get("score", 0))))

    logger.info(
        "Listening evaluation complete: score=%.1f, covered=%d, missed=%d",
        result["score"],
        len(result.get("key_points_covered", [])),
        len(result.get("key_points_missed", [])),
        extra={
            "event": "listening_eval_complete",
            "score": result["score"],
        },
    )

    return result
