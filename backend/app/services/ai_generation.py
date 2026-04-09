"""
AI content generation — MCQ, story structure, fill-in-blank, vocabulary, sentences.
"""

import logging

from google.genai import types as genai_types

from .ai_base import (
    CONTENT_FILTER_FRIENDLY_MSG,
    GeminiContentFilterError,
    generate_structured_response,
    sanitize_ai_input,
    TUTOR_PERSONA,
)

logger = logging.getLogger(__name__)

__all__ = [
    "generate_exit_ticket",
    "grade_exit_ticket",
    "generate_example_sentences",
    "validate_student_sentence",
    "generate_story_structure",
    "generate_teacher_comment",
    "EXIT_TICKET_SCHEMA",
    "EXAMPLE_SENTENCES_SCHEMA",
    "SENTENCE_VALIDATION_SCHEMA",
    "STORY_STRUCTURE_SCHEMA",
]


# ── Exit Ticket (Issue #463) ─────────────────────────────────────────────────

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


# ── Sentence Practice (Issue #109) ──────────────────────────────────────────

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

你是一位親切的國語文老師，正在批改學生的造句練習。

目標詞語：「{safe_word}」
課文：《{safe_title}》

評估標準：
1. 句子是否包含目標詞語「{safe_word}」
2. 句子是否語法正確、語意通順
3. 目標詞語的用法是否恰當
4. 適合國小高年級～國中程度
5. 句子必須是學生自己創作的，不能是從課文或例句中抄寫或稍微改寫的

請給予鼓勵性的評語，用繁體中文（zh-TW）回覆。
- 若造句正確：is_correct=true，給予鼓勵
- 若有問題：is_correct=false，指出問題並提供改進建議

注意：只要學生的句子基本語法正確、有使用目標詞語，就算通過。
不要過度嚴格，給予適度的鼓勵。"""

    if passage_sentences:
        passage_ref = "\n".join(f"- {s}" for s in passage_sentences[:5])
        system_prompt += f"""

以下是課文或例句中包含「{safe_word}」的句子片段（供參考比對）：
{passage_ref}

如果學生的句子與上述片段高度相似（只改了幾個字但意思和結構幾乎一樣），判定 is_correct=false，
並在 feedback 中提示學生「不要照抄課文或例句」，請用自己的話造句。
注意：feedback 中不要具體指出是「跟課文裡的某某詞像」，因為來源也可能是例句，請統一說「和課文或例句太相似」。"""

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
        temperature=0.3,
    )

    # Ensure suggestion is empty string if correct
    if result.get("is_correct") and not result.get("suggestion"):
        result["suggestion"] = ""

    return result


# ── ⑤ 文章重點表 — AI-generated story structure (#615) ────────────────────────

STORY_STRUCTURE_SCHEMA = {
    "type": "object",
    "properties": {
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "value": {"type": "string"},
                    "sub_rows": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "value": {"type": "string"},
                            },
                            "required": ["label", "value"],
                        },
                        "nullable": True,
                    },
                },
                "required": ["label", "value"],
            },
        }
    },
    "required": ["rows"],
}

_STRUCTURE_PROMPTS = {
    "記敘文": """請根據課文，用繁體中文填寫文章重點表（記敘文格式）：
rows 應包含：
- 主角（課文的主要人物）
- 主題（一句話說明課文的核心訊息）
- 特色（主角的特質或行為模式）
- 事例，sub_rows 包含：
  - 背景（故事發生的情境/時間/地點）
  - 經過（主角遇到的挑戰及如何因應）
  - 結果（最終的結果或影響）
每格 value 控制在 20 字以內，使用臺灣繁體中文。""",

    "說明文": """請根據課文，用繁體中文填寫文章重點表（說明文格式）：
rows 應包含：
- 主題（被說明的對象是什麼）
- 重要事實 1（最重要的說明內容）
- 重要事實 2（第二重要的說明內容）
- 重要事實 3（第三重要的說明內容）
- 結論（課文想讓讀者知道或做的事）
每格 value 控制在 25 字以內，使用臺灣繁體中文。""",

    "議論文": """請根據課文，用繁體中文填寫文章重點表（議論文格式）：
rows 應包含：
- 論點（作者的主要主張是什麼）
- 論據 1（支持論點的第一個理由或例子）
- 論據 2（支持論點的第二個理由或例子）
- 結論（作者希望讀者怎麼做或怎麼想）
每格 value 控制在 25 字以內，使用臺灣繁體中文。""",
}

_DEFAULT_STRUCTURE_PROMPT = """請根據課文，用繁體中文填寫文章重點表：
rows 應包含：主題、重要內容 1、重要內容 2、結論。
每格 value 控制在 25 字以內，使用臺灣繁體中文。"""


async def generate_story_structure(
    story_title: str,
    story_text: str,
    genre: str | None = None,
) -> dict:
    """Generate a structured story summary table for ⑤ 文章重點表 (#615).

    Returns a dict with 'rows', each row having 'label', 'value',
    and optionally 'sub_rows' for nested entries (e.g. 事例).
    """
    prompt_instruction = _STRUCTURE_PROMPTS.get(genre or "", _DEFAULT_STRUCTURE_PROMPT)

    system_prompt = (
        "你是國語文教學助手，專門幫學生整理課文重點。"
        "請務必使用臺灣繁體中文，禁止大陸用語。"
        "每個 value 盡量簡潔，讓國小高年級學生容易理解。"
    )
    user_msg = (
        f"課文標題：{story_title}\n\n"
        f"課文內容：\n{story_text}\n\n"
        f"{prompt_instruction}"
    )

    contents = [
        genai_types.Content(
            role="user",
            parts=[genai_types.Part(text=user_msg)],
        )
    ]

    try:
        result = await generate_structured_response(
            system_prompt=system_prompt,
            contents=contents,
            response_schema=STORY_STRUCTURE_SCHEMA,
            max_tokens=1024,
            temperature=0.3,
        )
        return result
    except Exception as e:
        logger.warning("generate_story_structure failed: %s", e)
        return {"rows": [{"label": "錯誤", "value": "無法載入文章重點表，請稍後再試"}]}


# ── Teacher Comment Generation (Issue #993) ──────────────────────────────────

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
        )
        return result.get("comment", "")
    except Exception as e:
        logger.warning("generate_teacher_comment failed: %s", e)
        return ""
