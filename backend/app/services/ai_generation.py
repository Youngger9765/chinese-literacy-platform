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
    "grade_story_structure",
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
        temperature=0.3,
    )

    # Ensure suggestion is empty string if correct
    if result.get("is_correct") and not result.get("suggestion"):
        result["suggestion"] = ""

    return result


# ── ⑤ 文章重點表 — AI-generated story structure (#615, #1082) ─────────────────

# interactive_type values:
#   "fill_blank" — student types in the answer (open-ended)
#   "checkbox"   — student picks from options (single or multi-select)
#   "display"    — shown as context, not interactive

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
                    "interactive_type": {"type": "string"},
                    "hint": {"type": "string"},
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                        "nullable": True,
                    },
                    "correct_options": {
                        "type": "array",
                        "items": {"type": "integer"},
                        "nullable": True,
                    },
                    "sub_rows": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "value": {"type": "string"},
                                "interactive_type": {"type": "string"},
                                "hint": {"type": "string"},
                                "options": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "nullable": True,
                                },
                                "correct_options": {
                                    "type": "array",
                                    "items": {"type": "integer"},
                                    "nullable": True,
                                },
                            },
                            "required": ["label", "value", "interactive_type"],
                        },
                        "nullable": True,
                    },
                },
                "required": ["label", "value", "interactive_type"],
            },
        }
    },
    "required": ["rows"],
}

_STRUCTURE_PROMPTS = {
    "記敘文": """請根據課文，用繁體中文填寫互動式文章重點表（記敘文格式）。

每個欄位必須包含：
- label：欄位名稱
- value：正確答案（AI 參考答案，15字以內）
- interactive_type：欄位互動類型
- hint：學生填答的提示（10字以內，不透露答案）
- options（當 interactive_type 為 "checkbox" 時必填）：2~4個選項，其中至少1個是干擾選項
- correct_options（當 interactive_type 為 "checkbox" 時必填）：正確答案在 options 中的索引（從0開始）

rows 應包含以下欄位：
1. 主角（interactive_type: "fill_blank"，讓學生自己填入課文主角名稱）
2. 主題（interactive_type: "fill_blank"，讓學生填入核心訊息，hint: "一句話說明課文想告訴我們什麼"）
3. 特色（interactive_type: "fill_blank"，讓學生填入主角特質，hint: "主角有什麼特別的地方？"）
4. 事例（interactive_type: "display"，value: ""，sub_rows 包含：
   - 背景（interactive_type: "checkbox"，提供 3 個選項，其中 1~2 個正確）
   - 經過（interactive_type: "checkbox"，提供 3 個選項，其中 1~2 個正確）
   - 結果（interactive_type: "checkbox"，提供 3 個選項，其中 1 個正確）
）

checkbox 的選項設計原則：
- 選項都要和課文內容相關，不要出現明顯錯誤的干擾項
- 干擾項要讓學生需要仔細閱讀才能判斷
- 使用臺灣繁體中文""",

    "說明文": """請根據課文，用繁體中文填寫互動式文章重點表（說明文格式）。

每個欄位必須包含：
- label：欄位名稱
- value：正確答案（AI 參考答案，20字以內）
- interactive_type：欄位互動類型
- hint：學生填答的提示（10字以內，不透露答案）
- options（當 interactive_type 為 "checkbox" 時必填）：2~4個選項
- correct_options（當 interactive_type 為 "checkbox" 時必填）：正確答案在 options 中的索引（從0開始）

rows 應包含以下欄位：
1. 主題（interactive_type: "fill_blank"，讓學生填入被說明的對象）
2. 重要事實 1（interactive_type: "checkbox"，3個選項，1個正確）
3. 重要事實 2（interactive_type: "checkbox"，3個選項，1個正確）
4. 重要事實 3（interactive_type: "checkbox"，3個選項，1個正確）
5. 結論（interactive_type: "fill_blank"，讓學生填入課文結論，hint: "課文最後想告訴我們什麼？"）

checkbox 選項都要和課文內容相關，使用臺灣繁體中文。""",

    "議論文": """請根據課文，用繁體中文填寫互動式文章重點表（議論文格式）。

每個欄位必須包含：
- label：欄位名稱
- value：正確答案（AI 參考答案，20字以內）
- interactive_type：欄位互動類型
- hint：學生填答的提示（10字以內，不透露答案）
- options（當 interactive_type 為 "checkbox" 時必填）：2~4個選項
- correct_options（當 interactive_type 為 "checkbox" 時必填）：正確答案在 options 中的索引（從0開始）

rows 應包含以下欄位：
1. 論點（interactive_type: "fill_blank"，讓學生填入主要主張，hint: "作者最想說的是什麼？"）
2. 論據 1（interactive_type: "checkbox"，3個選項，1個正確）
3. 論據 2（interactive_type: "checkbox"，3個選項，1個正確）
4. 結論（interactive_type: "fill_blank"，hint: "作者希望讀者怎麼做或怎麼想？"）

checkbox 選項都要和課文內容相關，使用臺灣繁體中文。""",
}

_DEFAULT_STRUCTURE_PROMPT = """請根據課文，用繁體中文填寫互動式文章重點表。

每個欄位必須包含：
- label：欄位名稱
- value：正確答案（15字以內）
- interactive_type："fill_blank" 或 "checkbox"
- hint：學生填答的提示

rows 應包含：
1. 主題（interactive_type: "fill_blank"）
2. 重要內容 1（interactive_type: "checkbox"，3個選項，1個正確，含 options 和 correct_options）
3. 重要內容 2（interactive_type: "checkbox"，3個選項，1個正確，含 options 和 correct_options）
4. 結論（interactive_type: "fill_blank"）

使用臺灣繁體中文。"""


async def generate_story_structure(
    story_title: str,
    story_text: str,
    genre: str | None = None,
) -> dict:
    """Generate an interactive story structure table for ⑤ 文章重點表 (#615, #1082).

    Returns a dict with 'rows', each row having 'label', 'value', 'interactive_type',
    optional 'hint', 'options', 'correct_options', and optional 'sub_rows'.

    interactive_type:
      - "fill_blank": student types the answer (graded by fuzzy text match)
      - "checkbox": student picks from options (graded by correct_options index match)
      - "display": shown as context, not interactive
    """
    prompt_instruction = _STRUCTURE_PROMPTS.get(genre or "", _DEFAULT_STRUCTURE_PROMPT)

    system_prompt = (
        "你是國語文教學助手，專門幫學生整理課文重點。"
        "請務必使用臺灣繁體中文，禁止大陸用語。"
        "每個 value（正確答案）盡量簡潔，讓國小高年級學生容易理解。"
        "interactive_type 必須是以下三種之一：fill_blank、checkbox、display。"
        "若 interactive_type 為 checkbox，則 options 和 correct_options 為必填。"
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
            max_tokens=2048,
            temperature=0.3,
        )
        # Ensure every row has interactive_type (backward compat guard)
        for row in result.get("rows", []):
            if "interactive_type" not in row:
                row["interactive_type"] = "fill_blank"
            for sub in row.get("sub_rows") or []:
                if "interactive_type" not in sub:
                    sub["interactive_type"] = "fill_blank"
        return result
    except Exception as e:
        logger.warning("generate_story_structure failed: %s", e)
        return {"rows": [{"label": "錯誤", "value": "無法載入文章重點表，請稍後再試", "interactive_type": "display"}]}


def _fuzzy_match_chinese(student: str, reference: str, story_text: str = "") -> bool:
    """Check if student answer is semantically close to the reference answer.

    Matching strategies (any one passing = correct):
    1. Exact match or containment (either direction)
    2. Nickname/abbreviation: student answer appears in story_text AND shares
       at least one key character with reference (handles 小戴 vs 戴資穎)
    3. Character overlap >= 50% of reference key characters
    """
    if not student or not reference:
        return False

    # Normalize
    student = student.strip()
    reference = reference.strip()

    # Strategy 1: Exact match or containment
    if student == reference or reference in student or student in reference:
        return True

    _PARTICLES = set("的了在是有和與也都就把被讓給從到著過嗎呢吧啊、，。！？")
    ref_chars = [c for c in reference if c not in _PARTICLES and '\u4e00' <= c <= '\u9fff']
    stu_chars = [c for c in student if c not in _PARTICLES and '\u4e00' <= c <= '\u9fff']

    if not ref_chars:
        return len(student) > 0

    # Strategy 2: Nickname/abbreviation — student answer appears in story text
    # and shares at least one key character with reference
    if story_text and student in story_text:
        shared = sum(1 for c in stu_chars if c in reference)
        if shared >= 1:
            return True

    # Strategy 3: Character-level overlap >= 50%
    matched = sum(1 for c in ref_chars if c in student)
    return matched / len(ref_chars) >= 0.5


async def grade_story_structure(
    structure: dict,
    answers: list[dict],
    story_text: str = "",
) -> dict:
    """Grade student answers against the AI-generated structure reference.

    Args:
        structure: The cached structure dict (with 'rows' containing reference answers)
        answers: List of answer objects:
        story_text: Original story text for nickname/abbreviation matching
            - For top-level rows: {"row_index": int, "value": str}
            - For sub-rows: {"row_index": int, "sub_row_index": int, "selected_options": [int, ...]}
            - For checkbox rows: {"row_index": int, "selected_options": [int, ...]}

    Returns:
        {
            "results": [{"row_index": int, "sub_row_index"?: int, "correct": bool, "feedback": str, "correct_answer": str}],
            "score": int  # 0-100
        }
    """
    rows = structure.get("rows", [])
    results = []
    total = 0
    correct_count = 0

    for answer in answers:
        row_idx = answer.get("row_index")
        sub_idx = answer.get("sub_row_index")

        if row_idx is None or row_idx >= len(rows):
            continue

        row = rows[row_idx]

        # Resolve the target row (top-level or sub-row)
        if sub_idx is not None:
            sub_rows = row.get("sub_rows") or []
            if sub_idx >= len(sub_rows):
                continue
            target = sub_rows[sub_idx]
        else:
            target = row

        interactive_type = target.get("interactive_type", "fill_blank")

        # Skip display rows — they're not graded
        if interactive_type == "display":
            continue

        total += 1
        correct_answer = target.get("value", "")
        result_entry: dict = {"row_index": row_idx}
        if sub_idx is not None:
            result_entry["sub_row_index"] = sub_idx

        if interactive_type == "checkbox":
            selected = set(answer.get("selected_options") or [])
            expected = set(target.get("correct_options") or [])
            is_correct = selected == expected
            result_entry["correct"] = is_correct
            result_entry["correct_answer"] = correct_answer
            if is_correct:
                result_entry["feedback"] = "答對了！"
            else:
                # Build correct answer display from options
                options = target.get("options") or []
                correct_texts = [options[i] for i in sorted(expected) if i < len(options)]
                result_entry["feedback"] = f"正確答案是：{'、'.join(correct_texts)}"
        else:
            # fill_blank: fuzzy text match
            student_value = str(answer.get("value") or "").strip()
            is_correct = _fuzzy_match_chinese(student_value, correct_answer, story_text)
            result_entry["correct"] = is_correct
            result_entry["correct_answer"] = correct_answer
            if is_correct:
                result_entry["feedback"] = "答對了！"
            else:
                result_entry["feedback"] = f"參考答案：{correct_answer}"

        if result_entry["correct"]:
            correct_count += 1
        results.append(result_entry)

    score = round((correct_count / total) * 100) if total > 0 else 0
    return {"results": results, "score": score}


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
