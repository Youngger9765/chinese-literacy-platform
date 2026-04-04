"""
AI reading evaluation — pronunciation accuracy, CPM scoring, reading analysis.
"""

import logging

from google.genai import types as genai_types

from .ai_base import (
    CONTENT_FILTER_FRIENDLY_MSG,
    GeminiContentFilterError,
    generate_structured_response,
    TUTOR_PERSONA,
)

logger = logging.getLogger(__name__)

__all__ = [
    "generate_reading_analysis",
]


async def generate_reading_analysis(session_data: dict) -> dict:
    """Generate personalised reading diagnosis and improvement suggestions.

    Uses Gemini to analyse student reading performance and return
    structured feedback including strengths, areas for improvement,
    practice suggestions, and encouragement.

    Args:
        session_data: Dict with keys:
            Required: story_title, accuracy, cpm, error_chars (list[str]),
                      total_characters.
            Optional (Issue #415): comprehension_score (float 0-100),
                      vocab_practiced_count (int), vocab_total_count (int),
                      dictation_correct_count (int), dictation_total_count (int).

    Returns:
        Dict with keys: analysis_summary, strengths, areas_for_improvement,
                        practice_suggestions, encouragement_message.
    """
    story_title = session_data.get("story_title", "未知課文")
    accuracy = session_data.get("accuracy", 0)
    cpm = session_data.get("cpm", 0)
    error_chars = session_data.get("error_chars", [])
    total_characters = session_data.get("total_characters", 0)

    # Optional enrichment fields (Issue #415)
    comprehension_score: float | None = session_data.get("comprehension_score")
    vocab_practiced: int | None = session_data.get("vocab_practiced_count")
    vocab_total: int | None = session_data.get("vocab_total_count")
    dictation_correct: int | None = session_data.get("dictation_correct_count")
    dictation_total: int | None = session_data.get("dictation_total_count")

    error_chars_str = "、".join(error_chars) if error_chars else "無"

    system_prompt = (
        f"{TUTOR_PERSONA}\n\n"
        "你同時也是一位國小國語文教學專家。請根據以下學生朗讀數據，"
        "提供詳細的診斷分析和改善建議。\n\n"
        "回覆規則：\n"
        "- 必須使用臺灣繁體中文（zh-TW），嚴禁大陸用語\n"
        "- 語氣溫暖、鼓勵，適合國小高年級至國中生\n"
        "- 分析要具體，根據數據給出針對性建議\n"
        "- 每項建議都要可執行"
    )

    # Build enriched prompt with all available data
    user_prompt_lines = [
        "學生學習資料：",
        f"- 課文：{story_title}",
        f"- 朗讀正確率：{accuracy}%",
        f"- 朗讀速度：{cpm} 字/分鐘",
        f"- 錯誤字：{error_chars_str}",
        f"- 課文總字數：{total_characters}",
    ]

    # Append optional enrichment data when available (Issue #415)
    if comprehension_score is not None:
        user_prompt_lines.append(f"- 課文理解力評估：{comprehension_score:.0f}%")
    if vocab_practiced is not None and vocab_total is not None:
        pct = round(vocab_practiced / max(vocab_total, 1) * 100)
        user_prompt_lines.append(
            f"- 生字練習完成率：{pct}%（{vocab_practiced}/{vocab_total} 個生字）"
        )
    if dictation_correct is not None and dictation_total is not None:
        d_pct = round(dictation_correct / max(dictation_total, 1) * 100)
        user_prompt_lines.append(
            f"- 聽寫練習正確率：{d_pct}%（{dictation_correct}/{dictation_total} 個詞語）"
        )

    has_enriched_data = any(
        x is not None for x in [comprehension_score, vocab_practiced, dictation_correct]
    )
    if has_enriched_data:
        user_prompt_lines.append(
            "\n請根據以上跨環節的整體學習表現進行綜合分析，"
            "找出學生的強項和需要加強的地方，並給出具體可執行的改善建議。"
        )
    else:
        user_prompt_lines.append("\n請根據以上資料進行分析。")

    user_prompt = "\n".join(user_prompt_lines)

    response_schema = {
        "type": "OBJECT",
        "properties": {
            "analysis_summary": {
                "type": "STRING",
                "description": "整體分析摘要（2-3句話）",
            },
            "strengths": {
                "type": "ARRAY",
                "items": {"type": "STRING"},
                "description": "學生的優點（1-3項）",
            },
            "areas_for_improvement": {
                "type": "ARRAY",
                "items": {"type": "STRING"},
                "description": "待改善的地方（1-3項）",
            },
            "practice_suggestions": {
                "type": "ARRAY",
                "items": {"type": "STRING"},
                "description": "具體練習建議（2-4項）",
            },
            "encouragement_message": {
                "type": "STRING",
                "description": "鼓勵語（1句話）",
            },
        },
        "required": [
            "analysis_summary",
            "strengths",
            "areas_for_improvement",
            "practice_suggestions",
            "encouragement_message",
        ],
    }

    contents = [
        genai_types.Content(
            role="user",
            parts=[genai_types.Part(text=user_prompt)],
        )
    ]

    return await generate_structured_response(
        system_prompt=system_prompt,
        contents=contents,
        response_schema=response_schema,
        max_tokens=2048,
        temperature=0.7,
    )
