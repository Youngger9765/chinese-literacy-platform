"""
Sentence Practice AI generation and validation (Issue #109).

Schema, prompts, and two public functions:
  generate_example_sentences  — two example sentences for a vocabulary word
  validate_student_sentence   — AI evaluation of student's sentence
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
    "EXAMPLE_SENTENCES_SCHEMA",
    "SENTENCE_VALIDATION_SCHEMA",
    "generate_example_sentences",
    "validate_student_sentence",
]

EXAMPLE_SENTENCES_SCHEMA = {
    "type": "object",
    "properties": {
        "sentences": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "sentence": {"type": "string"},
                    "explanation": {"type": "string"},
                },
                "required": ["sentence", "explanation"],
            },
            "minItems": 2,
            "maxItems": 2,
        }
    },
    "required": ["sentences"],
}

SENTENCE_VALIDATION_SCHEMA = {
    "type": "object",
    "properties": {
        "is_correct": {"type": "boolean"},
        "feedback": {"type": "string"},
        "suggestion": {"type": "string"},
    },
    "required": ["is_correct", "feedback", "suggestion"],
}


async def generate_example_sentences(word: str, story_title: str) -> dict:
    """Generate 2 example sentences for a Chinese vocabulary word.

    Returns {"sentences": [{"sentence": str, "explanation": str}, ...]}
    Each sentence uses the target word in a contextually appropriate way
    suited for elementary/middle school students.
    """
    safe_word, _ = sanitize_ai_input(word)
    safe_title, _ = sanitize_ai_input(story_title)

    system_prompt = f"""{TUTOR_PERSONA}

你是一位專業的國語文教師，請為學生示範如何使用詞語造句。

目標詞語：「{safe_word}」
課文名稱：《{safe_title}》

請造 2 個包含目標詞語的例句，要求：
1. 符合國小高年級～國中的語文程度
2. 句子自然流暢，生動有趣
3. 幫助學生理解這個詞語的用法
4. 用繁體中文（zh-TW）

請以 JSON 格式輸出，包含 sentences 陣列，每個元素有：
- sentence（例句）
- explanation（簡短說明這個詞語在句中的意思）"""

    contents = [
        genai_types.Content(
            role="user",
            parts=[genai_types.Part(text=f"請為詞語「{safe_word}」造兩個例句。")],
        )
    ]

    result = await generate_structured_response(
        system_prompt=system_prompt,
        contents=contents,
        response_schema=EXAMPLE_SENTENCES_SCHEMA,
        max_tokens=2048,
        temperature=0.8,
        task="example_sentences",
    )
    return result


async def validate_student_sentence(
    word: str,
    student_sentence: str,
    story_title: str,
    passage_sentences: list[str] | None = None,
) -> dict:
    """Validate a student's sentence for a given vocabulary word.

    Returns {"is_correct": bool, "feedback": str, "suggestion": str}
    - is_correct: True if grammatically correct and uses the word appropriately
    - feedback: encouraging feedback message (in Chinese)
    - suggestion: improvement hint if not correct (empty string if correct)
    """
    safe_word, _ = sanitize_ai_input(word)
    safe_sentence, _ = sanitize_ai_input(student_sentence)
    safe_title, _ = sanitize_ai_input(story_title)

    system_prompt = f"""{TUTOR_PERSONA}

正在陪學生練習用「{safe_word}」造句（課文：《{safe_title}》）。

判斷規則：
- 句子有用到「{safe_word}」、語法基本通順、是學生自己寫的（沒抄課文或例句）→ is_correct=true
- 否則 → is_correct=false

回覆規則（非常重要）：
- feedback **只能一句話**，不要用「錯」「不對」「不行」「不正確」等否定字眼
- is_correct=true：feedback 是一句純鼓勵（不要加提醒）；suggestion 留空字串
- is_correct=false：feedback 是一句溫柔提醒（先肯定再提示，例如「再想想看…」「換個說法可能更順喔」）；suggestion 是一句改寫提示
- 一律使用臺灣繁體中文（zh-TW）"""

    if passage_sentences:
        passage_ref = "\n".join(f"- {s}" for s in passage_sentences[:5])
        system_prompt += f"""

以下是課文或例句中含「{safe_word}」的片段（供比對是否抄寫）：
{passage_ref}

若學生的句子與上述片段意思和結構幾乎一樣，判 is_correct=false，
feedback 統一說「和課文或例句有點像，試試看用自己的話說說看」，不要點名是哪一句。"""

    contents = [
        genai_types.Content(
            role="user",
            parts=[genai_types.Part(text=f"學生的造句：「{safe_sentence}」\n請評估這個造句是否正確。")],
        )
    ]

    result = await generate_structured_response(
        system_prompt=system_prompt,
        contents=contents,
        response_schema=SENTENCE_VALIDATION_SCHEMA,
        max_tokens=1024,
        task="sentence_validate",
        temperature=0.3,
    )

    # Ensure suggestion is empty string if correct (defensive, in case model violates prompt)
    if result.get("is_correct"):
        result["suggestion"] = ""

    return result
