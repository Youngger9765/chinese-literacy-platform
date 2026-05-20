"""
AI comprehension evaluation — Socratic dialogue and comprehension scoring.
"""

import logging

from google.genai import types as genai_types

from .ai_base import (
    CONTENT_FILTER_FRIENDLY_MSG,
    GeminiContentFilterError,
    _check_safety_filter,
    _get_client,
    generate_structured_response,
    capture_usage,
    last_usage,
    sanitize_ai_input,
    sanitize_dialogue_turns,
    TUTOR_PERSONA,
)

logger = logging.getLogger(__name__)

__all__ = [
    "generate_socratic_question",
    "evaluate_comprehension",
    "COMPREHENSION_SCORE_SCHEMA",
]


# Deprecated: use SocraticAgent.process_answer() for new code.
# Kept for backward compatibility with POST /comprehension/question.
async def generate_socratic_question(
    story_title: str,
    story_text: str,
    conversation: list[dict],
) -> str:
    """
    Generate a Socratic follow-up question based on the story and conversation
    history. Returns a warm, encouraging question in Traditional Chinese.

    Args:
        story_title: Title of the story being discussed.
        story_text: Full text of the story (paragraphs joined with newlines).
        conversation: List of {"role": "ai"|"student", "text": str} dicts,
                      ordered oldest-first. Empty for the first question.

    Returns:
        A single Socratic question as a string.
    """
    # Reset usage context var so error paths don't log stale data (FAIL-3 review fix).
    last_usage.set(None)

    system_prompt = f"""{TUTOR_PERSONA}
你擅長用蘇格拉底式問答引導學生思考課文。

課文標題：{story_title}

課文內容：
{story_text}

請根據課文內容和對話歷史，提出一個有意義的問題。

規則：
- 每次只問一個問題
- 問題由淺入深：
  * 第一題：事實性（誰、什麼、在哪裡、發生什麼事）
  * 第二題：推論性（為什麼、怎麼會這樣、有什麼影響）
  * 第三題：評估性（你覺得、如果是你、這個故事告訴我們什麼）
- 語氣溫暖、友善，適合小學高年級至國中生
- 必須使用臺灣繁體中文（zh-TW），嚴禁大陸用語
- 直接輸出問題本身，不要加「好問題！」「你說得對！」等前綴
- 問題長度：15–40 個字"""

    # Build Gemini contents — roles are "user" and "model"
    # Seed with a fixed user message so the conversation always starts with "user"
    contents: list[genai_types.Content] = [
        genai_types.Content(
            role="user",
            parts=[genai_types.Part(text="請開始提問。")],
        )
    ]

    for turn in conversation:
        role = "model" if turn["role"] == "ai" else "user"
        # Sanitize student inputs to prevent prompt injection (Issue #270)
        text = turn["text"]
        if turn["role"] == "student":
            text, _ = sanitize_ai_input(text)
        contents.append(
            genai_types.Content(
                role=role,
                parts=[genai_types.Part(text=text)],
            )
        )

    # Ensure the last content is from "user" so Gemini responds as "model"
    if contents[-1].role == "model":
        contents.append(
            genai_types.Content(
                role="user",
                parts=[genai_types.Part(text="請繼續提問。")],
            )
        )

    client = _get_client()
    response = client.models.generate_content(
        model="gemini-flash-lite-latest",
        contents=contents,
        config=genai_types.GenerateContentConfig(
            system_instruction=system_prompt,
            max_output_tokens=128,
            temperature=0.7,
        ),
    )
    # Guard against safety filter before accessing response.text (#526)
    _check_safety_filter(response)
    # Capture token usage metadata for tracking (Issue #874)
    _prompt_chars = len(system_prompt) if system_prompt else 0
    try:
        for c in contents:
            for p in (c.parts or []):
                if hasattr(p, "text") and p.text:
                    _prompt_chars += len(p.text)
    except Exception:
        pass
    usage_meta = capture_usage(response, model="gemini-flash-lite-latest")
    usage_meta.prompt_char_count = _prompt_chars
    return response.text.strip()


COMPREHENSION_SCORE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "comprehension_score": {
            "type": "NUMBER",
            "description": "Overall comprehension score 0-100",
        },
        "literal_score": {
            "type": "NUMBER",
            "description": "字面理解 score 0-100",
        },
        "inferential_score": {
            "type": "NUMBER",
            "description": "推論理解 score 0-100",
        },
        "evaluative_score": {
            "type": "NUMBER",
            "description": "評鑑理解 score 0-100",
        },
        "feedback": {
            "type": "OBJECT",
            "properties": {
                "literal": {
                    "type": "STRING",
                    "description": "字面理解評語 (Traditional Chinese)",
                },
                "inferential": {
                    "type": "STRING",
                    "description": "推論理解評語 (Traditional Chinese)",
                },
                "evaluative": {
                    "type": "STRING",
                    "description": "評鑑理解評語 (Traditional Chinese)",
                },
                "overall": {
                    "type": "STRING",
                    "description": "整體評語 (Traditional Chinese)",
                },
            },
            "required": ["literal", "inferential", "evaluative", "overall"],
        },
    },
    "required": [
        "comprehension_score",
        "literal_score",
        "inferential_score",
        "evaluative_score",
        "feedback",
    ],
}


async def evaluate_comprehension(
    dialogue_turns: list[dict],
    story_context: dict,
) -> dict:
    """Evaluate student comprehension across 3 levels based on Socratic dialogue.

    Args:
        dialogue_turns: List of {"role": "ai"|"student", "text": str} dicts.
        story_context: {"title": str, "summary": str} with story metadata.

    Returns:
        Dict with comprehension_score, literal_score, inferential_score,
        evaluative_score, and feedback dict.
    """
    # Sanitize student turns before including them in the AI prompt (Issue #270)
    safe_turns = sanitize_dialogue_turns(dialogue_turns)
    formatted_dialogue = "\n".join(
        f"{'AI老師' if t['role'] == 'ai' else '學生'}: {t['text']}"
        for t in safe_turns
    )

    system_prompt = f"""{TUTOR_PERSONA}
你是國語文理解力評量專家。請根據以下蘇格拉底對話記錄，評估學生的三層次理解力。

課文：{story_context['title']}
課文內容摘要：{story_context['summary']}

對話記錄：
{formatted_dialogue}

評分標準（0-100）：
- literal_score（字面理解）：學生能否正確回答課文中明確提到的事實、人物、地點、事件？
- inferential_score（推論理解）：學生能否推測因果關係、角色動機、或隱含的意義？
- evaluative_score（評鑑理解）：學生能否連結自身經驗、提出觀點、或評論課文主題？

評分規則：
- 如果對話中沒有涉及某個層次的問題，給予 50 分（中間值）
- 學生回答正確且詳細 → 80-100 分
- 學生回答正確但簡略 → 60-79 分
- 學生回答部分正確 → 40-59 分
- 學生回答錯誤或敷衍 → 0-39 分
- comprehension_score 是三個分數的加權平均（字面 30% + 推論 40% + 評鑑 30%）
- 必須使用臺灣繁體中文（zh-TW）撰寫評語"""

    contents = [
        genai_types.Content(
            role="user",
            parts=[genai_types.Part(text="請根據以上對話記錄評估學生的理解力。")],
        )
    ]

    result = await generate_structured_response(
        system_prompt=system_prompt,
        contents=contents,
        response_schema=COMPREHENSION_SCORE_SCHEMA,
        max_tokens=2048,
        temperature=0.3,
    )

    # Clamp scores to 0-100 range
    for key in ("comprehension_score", "literal_score", "inferential_score", "evaluative_score"):
        val = result.get(key, 50)
        result[key] = max(0, min(100, float(val)))

    return result
