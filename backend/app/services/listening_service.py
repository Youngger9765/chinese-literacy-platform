"""
Listening comprehension evaluation service.

Evaluates how well a student's retelling captures the key points
of the original story text, using Gemini AI for structured analysis.

Issue #1098 fixes:
- Random/garbage input short-circuits before the LLM call and returns
  a gentle "please try again" instead of a misleading evaluation.
- Pasting the full passage verbatim is detected via difflib similarity
  and returns a high score without an LLM call (deterministic + cheaper).
- reasoning field added to the schema (CLAUDE.md standing rule).
"""

import logging
import re
from difflib import SequenceMatcher

from google.genai import types as genai_types

from .ai_service import generate_structured_response
from .input_sanitizer import sanitize_ai_input
from .persona import TUTOR_PERSONA

logger = logging.getLogger(__name__)

# ── Sanity-check constants ─────────────────────────────────────────────────────

# Minimum number of Chinese characters (or total chars for mixed input) required
# before we bother calling the LLM.  Inputs below this are either empty, purely
# punctuation, or digit-spam like "123".
_MIN_MEANINGFUL_CHARS = 5

# Regex for "only digits, spaces, and punctuation — no CJK, no Latin letters".
# These inputs carry no semantic content and should never score well.
_GARBAGE_PATTERN = re.compile(r"^[\d\s　-〿＀-￯！。，、；：？！「」『』【】〔〕…—~·]+$")

# If the student's retelling shares ≥ this fraction of the original passage via
# SequenceMatcher (roughly character-level longest-common-subsequence), we treat
# it as a verbatim paste and return a high score without an LLM call.
_VERBATIM_SIMILARITY_THRESHOLD = 0.70

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
        "reasoning": {
            "type": "STRING",
            "description": "Internal 1-2 sentence rationale for the score (for teacher auditing)",
        },
    },
    "required": [
        "score",
        "key_points_covered",
        "key_points_missed",
        "feedback",
        "encouragement",
        "reasoning",
    ],
}


def _is_garbage_input(text: str) -> bool:
    """Return True when the input carries no meaningful semantic content.

    Covers:
    - Inputs that are too short to contain any real information.
    - Inputs consisting entirely of digits, spaces, and punctuation
      (e.g. "123", "   ", "！？！？").
    """
    stripped = text.strip()
    if len(stripped) < _MIN_MEANINGFUL_CHARS:
        return True
    if _GARBAGE_PATTERN.fullmatch(stripped):
        return True
    return False


def _is_verbatim_paste(original_text: str, student_retelling: str) -> bool:
    """Return True when the student's text is very similar to the original passage.

    Uses SequenceMatcher ratio (≥ 0.70) to catch copy-paste without requiring
    an exact substring match (minor edits / whitespace differences still match).
    """
    # Normalise whitespace before comparing so line-break differences don't
    # deflate the ratio.
    orig_norm = re.sub(r"\s+", "", original_text)
    ret_norm = re.sub(r"\s+", "", student_retelling)

    # Fast path: if retelling is longer than 120 % of original it can't be a
    # simple paste — skip the expensive ratio calculation.
    if len(ret_norm) > len(orig_norm) * 1.2:
        return False

    ratio = SequenceMatcher(None, orig_norm, ret_norm).ratio()
    return ratio >= _VERBATIM_SIMILARITY_THRESHOLD


async def evaluate_retelling(
    original_text: str,
    student_retelling: str,
    story_title: str = "課文",
) -> dict:
    """Evaluate a student's retelling against the original story text.

    Uses Gemini to assess how completely and accurately the student
    captured the key points from the story they listened to.

    Short-circuits (no LLM call) for:
    - Garbage / digit-only input → score 0, gentle prompt to retry.
    - Verbatim paste of the passage → score 95, positive feedback.

    Args:
        original_text: The full story text the student listened to.
        student_retelling: The student's spoken/typed retelling.
        story_title: Title of the story (for context in prompts).

    Returns:
        Dict with keys: score, key_points_covered, key_points_missed,
                        feedback, encouragement, reasoning.
    """
    # ── Guard 1: garbage / random input ───────────────────────────────────────
    if _is_garbage_input(student_retelling):
        logger.info(
            "Listening eval short-circuit: garbage input (len=%d)",
            len(student_retelling.strip()),
            extra={"event": "listening_eval_garbage"},
        )
        return {
            "score": 0.0,
            "key_points_covered": [],
            "key_points_missed": ["需要用句子描述你記得的課文內容"],
            "feedback": "再試試看！請用自己的話，用一兩句話說說你剛才聽到了什麼。",
            "encouragement": "你一定記得一些內容，大膽說出來吧！",
            "reasoning": "Input failed sanity check: too short or contains only digits/punctuation with no semantic content.",
        }

    # ── Guard 2: verbatim paste of the passage ─────────────────────────────────
    if _is_verbatim_paste(original_text, student_retelling):
        logger.info(
            "Listening eval short-circuit: verbatim paste detected",
            extra={"event": "listening_eval_verbatim"},
        )
        return {
            "score": 95.0,
            "key_points_covered": ["你完整地復述了整篇課文的內容"],
            "key_points_missed": [],
            "feedback": "你完整地復述了課文內容，已掌握所有重點！如果能用自己的話說出來，理解會更深喔。",
            "encouragement": "太棒了，課文內容你已經完全記住了！",
            "reasoning": "Student input has ≥70% character-level similarity to the original passage — treated as verbatim reproduction.",
        }

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
        "- feedback 要具體，說明哪裡做得好、哪裡可以更完整\n"
        "- reasoning 用英文寫 1-2 句，解釋為何給這個分數（供教師稽核）\n"
        "- 評分只看學生是否理解並用自己的話表達；不因答案完整而懲罰高分"
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

    # Ensure reasoning field is always present (schema fallback)
    if not result.get("reasoning"):
        result["reasoning"] = ""

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
