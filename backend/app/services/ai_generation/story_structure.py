"""
Story Structure AI generation and grading (#615, #1082).

Schema, prompts, and three public functions:
  generate_story_structure — AI-generated interactive story structure table
  grade_story_structure    — deterministic grading (fill_blank fuzzy + checkbox exact)
  _fuzzy_match_chinese     — internal helper (exported for tests that patch around it)
"""

import logging

from google.genai import types as genai_types

from ..ai_base import (
    generate_structured_response,
)

logger = logging.getLogger(__name__)

__all__ = [
    "STORY_STRUCTURE_SCHEMA",
    "generate_story_structure",
    "grade_story_structure",
]

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
            task="story_structure",
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
    ref_chars = [c for c in reference if c not in _PARTICLES and '一' <= c <= '鿿']
    stu_chars = [c for c in student if c not in _PARTICLES and '一' <= c <= '鿿']

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
