"""
AI API calls — all AI model interactions are centralised here.

Rules (from CLAUDE.md):
  - ALL AI API calls must live in this file only.
  - The frontend never calls AI APIs directly.
  - Used for: Socratic comprehension Q&A (Step 3), exit-ticket
    generation and grading (Step 6).
  - STT/TTS use browser-native APIs and are NOT routed through here.
"""

import asyncio
import json
import logging

from google import genai
from google.genai import types as genai_types

from ..config import settings
from .input_sanitizer import sanitize_ai_input, sanitize_dialogue_turns
from .persona import TUTOR_PERSONA

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0  # seconds
GEMINI_TIMEOUT = 30  # seconds

CONTENT_FILTER_FRIENDLY_MSG = "老師小幫手暫時無法回答這個問題，請試試其他問法"


class GeminiContentFilterError(Exception):
    """Raised when Gemini refuses a response due to its safety/content filter.

    This is NOT an API error — Gemini returned a valid response, but blocked
    the content. Callers should return a friendly fallback to the student
    instead of a 500 error.
    """


def _check_safety_filter(response) -> None:
    """Inspect a Gemini response and raise GeminiContentFilterError if blocked.

    Checks three signals (in order of reliability):
    1. response.candidates is empty — entire prompt was blocked
    2. candidates[0].finish_reason == SAFETY — output was blocked mid-generation
    3. response.prompt_feedback.block_reason is set — prompt-level block

    Must be called BEFORE accessing response.text, which raises a confusing
    ValueError when the response has no content due to safety filtering.
    """
    # Signal 1: no candidates at all (prompt-level block)
    if not response.candidates:
        block_reason = None
        try:
            block_reason = str(response.prompt_feedback.block_reason)
        except Exception:
            pass
        logger.warning(
            "Gemini content filter: no candidates returned (block_reason=%s)",
            block_reason,
            extra={"event": "gemini_content_filter", "block_reason": block_reason},
        )
        raise GeminiContentFilterError(
            f"Gemini blocked response (no candidates, block_reason={block_reason})"
        )

    # Signal 2: finish_reason == SAFETY
    finish_reason = str(response.candidates[0].finish_reason)
    if "SAFETY" in finish_reason:
        logger.warning(
            "Gemini content filter: finish_reason=SAFETY",
            extra={"event": "gemini_content_filter", "finish_reason": finish_reason},
        )
        raise GeminiContentFilterError(
            f"Gemini blocked response (finish_reason={finish_reason})"
        )

    # Signal 3: prompt_feedback.block_reason set but candidates exist (edge case)
    try:
        block_reason = response.prompt_feedback.block_reason
        if block_reason and str(block_reason) not in ("0", "BLOCK_REASON_UNSPECIFIED", "None"):
            logger.warning(
                "Gemini content filter: prompt_feedback.block_reason=%s",
                block_reason,
                extra={"event": "gemini_content_filter", "block_reason": str(block_reason)},
            )
            raise GeminiContentFilterError(
                f"Gemini blocked response (prompt_feedback.block_reason={block_reason})"
            )
    except GeminiContentFilterError:
        raise
    except Exception:
        # prompt_feedback attribute may not exist on all response types — safe to ignore
        pass


def _get_client() -> genai.Client:
    """Return a Gemini client via Vertex AI (uses Cloud Run service account)."""
    return genai.Client(vertexai=True, project="lingoleap-dev", location="us-central1")


def _repair_json(raw: str) -> str | None:
    """Attempt basic JSON repair on a potentially truncated/malformed string.

    Strategy:
    1. Strip markdown code fences (```json ... ```)
    2. Walk forward tracking bracket depth and string state, recording every
       position where the outermost bracket closes (depth == 0).
    3. If the outermost bracket never closes (truncated mid-content), scan
       backwards from the end for the last close bracket (`}` or `]`) that is
       not inside a string. Truncate there, strip trailing commas, then append
       the closing brackets needed to balance the open bracket stack.

    Returns the repaired JSON string if successful, None otherwise.
    """
    text = raw.strip()

    # Strip markdown code fences
    if text.startswith("```"):
        # Remove opening fence (```json or ```)
        text = text[text.find("\n") + 1:] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[: text.rfind("```")]
    text = text.strip()

    if not text:
        return None

    # Must start with a JSON container
    if not text.startswith("{") and not text.startswith("["):
        return None

    # Walk forward tracking brackets and string state.
    # Build a stack of open brackets and record positions where depth returns to 0.
    last_balanced_pos = -1
    # close_positions: list of (pos, bracket_stack_snapshot_after_close)
    # We only need the last close position outside a string.
    last_outer_close_pos = -1  # last pos of any `}` or `]` outside a string
    in_string = False
    escape_next = False
    bracket_stack: list[str] = []

    for i, ch in enumerate(text):
        if escape_next:
            escape_next = False
            continue
        if ch == "\\" and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in ("{", "["):
            bracket_stack.append(ch)
        elif ch in ("}", "]"):
            if bracket_stack:
                bracket_stack.pop()
            if not bracket_stack:
                last_balanced_pos = i
            # Record last close bracket outside a string regardless of depth
            last_outer_close_pos = i

    # Case 1: JSON was complete — return the complete portion
    if last_balanced_pos != -1:
        return text[: last_balanced_pos + 1]

    # Case 2: Truncated — find the last close bracket, truncate there,
    # strip trailing comma/whitespace, then close all open brackets.
    if last_outer_close_pos == -1:
        return None

    truncated = text[: last_outer_close_pos + 1].rstrip().rstrip(",").rstrip()

    # Rebuild bracket_stack for the truncated portion to know what to close
    in_string = False
    escape_next = False
    close_stack: list[str] = []

    for ch in truncated:
        if escape_next:
            escape_next = False
            continue
        if ch == "\\" and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in ("{", "["):
            close_stack.append(ch)
        elif ch in ("}", "]"):
            if close_stack:
                close_stack.pop()

    # Append the matching closing brackets in reverse
    closing = ""
    for opener in reversed(close_stack):
        closing += "}" if opener == "{" else "]"

    candidate = truncated + closing
    try:
        json.loads(candidate)
        return candidate
    except Exception:
        pass

    return None


async def generate_structured_response(
    system_prompt: str,
    contents: list[genai_types.Content],
    response_schema: dict,
    max_tokens: int = 4096,
    temperature: float = 0.7,
) -> dict:
    """Call Gemini with JSON mode, return parsed dict.

    Uses response_mime_type="application/json" and response_schema
    to get structured JSON output from Gemini.
    """
    client = _get_client()
    last_error = None

    for attempt in range(MAX_RETRIES):
        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(
                    client.models.generate_content,
                    model="gemini-2.5-flash",
                    contents=contents,
                    config=genai_types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        response_mime_type="application/json",
                        response_schema=response_schema,
                        max_output_tokens=max_tokens,
                        temperature=temperature,
                    ),
                ),
                timeout=GEMINI_TIMEOUT,
            )

            # Check for safety filter BEFORE accessing response.text.
            # When Gemini blocks content, response.text raises a confusing
            # ValueError. We intercept this with a clear, named exception.
            _check_safety_filter(response)

            # Extract finish_reason for diagnostics (MAX_TOKENS = truncated output)
            finish_reason = None
            if response.candidates:
                finish_reason = str(response.candidates[0].finish_reason)

            # Log raw response for debugging (truncated to avoid log spam)
            raw_text = response.text if response.text is not None else ""
            logger.debug(
                "Gemini raw response finish_reason=%s length=%d (first 500 chars): %s",
                finish_reason,
                len(raw_text),
                raw_text[:500],
                extra={
                    "event": "gemini_raw_response",
                    "finish_reason": finish_reason,
                    "length": len(raw_text),
                },
            )

            if not raw_text:
                raise ValueError("Gemini returned empty/None response text")

            # When finish_reason is MAX_TOKENS the output was cut mid-stream.
            # Attempt JSON repair immediately before trying json.loads so we
            # can recover partial responses without burning a retry cycle.
            if finish_reason == "FinishReason.MAX_TOKENS":
                logger.warning(
                    "Gemini finish_reason=MAX_TOKENS — output was truncated "
                    "(max_tokens=%d, raw_len=%d). Attempting JSON repair.",
                    max_tokens,
                    len(raw_text),
                    extra={
                        "event": "gemini_max_tokens_truncation",
                        "max_tokens": max_tokens,
                        "raw_len": len(raw_text),
                        "attempt": attempt + 1,
                    },
                )
                repaired = _repair_json(raw_text)
                if repaired is not None:
                    try:
                        result = json.loads(repaired)
                        logger.warning(
                            "JSON repair after MAX_TOKENS succeeded "
                            "(original_len=%d, repaired_len=%d)",
                            len(raw_text),
                            len(repaired),
                            extra={"event": "gemini_json_repair_success"},
                        )
                        return result
                    except json.JSONDecodeError:
                        pass
                # Repair failed — fall through to regular json.loads which
                # will raise and trigger the retry loop.

            try:
                return json.loads(raw_text)
            except json.JSONDecodeError as json_err:
                logger.warning(
                    "JSON parse failed finish_reason=%s (%s), attempting repair. "
                    "Raw (first 200): %s",
                    finish_reason,
                    json_err,
                    raw_text[:200],
                    extra={"event": "gemini_json_repair_attempt", "finish_reason": finish_reason},
                )
                repaired = _repair_json(raw_text)
                if repaired is not None:
                    try:
                        result = json.loads(repaired)
                        logger.warning(
                            "JSON repair succeeded (original_len=%d, repaired_len=%d)",
                            len(raw_text),
                            len(repaired),
                            extra={"event": "gemini_json_repair_success"},
                        )
                        return result
                    except json.JSONDecodeError:
                        pass
                # Repair failed — raise original error so retry logic handles it
                raise json_err

        except GeminiContentFilterError:
            # Safety filter is deterministic — no point retrying.
            # Propagate immediately so callers can return a friendly response.
            raise
        except asyncio.TimeoutError:
            logger.error(
                "Gemini API timeout after %ds",
                GEMINI_TIMEOUT,
                extra={
                    "event": "gemini_timeout",
                    "timeout_seconds": GEMINI_TIMEOUT,
                    "attempt": attempt + 1,
                },
            )
            raise TimeoutError(f"AI response timeout ({GEMINI_TIMEOUT}s)")
        except Exception as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning(
                    "Gemini API attempt %d failed: %s. Retrying in %.1fs",
                    attempt + 1,
                    e,
                    delay,
                    extra={
                        "event": "gemini_retry",
                        "attempt": attempt + 1,
                        "error": str(e),
                        "retry_delay_seconds": delay,
                    },
                )
                await asyncio.sleep(delay)
            else:
                logger.error(
                    "Gemini API failed after %d attempts: %s",
                    MAX_RETRIES,
                    e,
                    extra={
                        "event": "gemini_failure",
                        "total_attempts": MAX_RETRIES,
                        "error": str(e),
                    },
                )

    raise last_error


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
        model="gemini-2.5-flash",
        contents=contents,
        config=genai_types.GenerateContentConfig(
            system_instruction=system_prompt,
            max_output_tokens=128,
            temperature=0.7,
        ),
    )
    # Guard against safety filter before accessing response.text (#526)
    _check_safety_filter(response)
    return response.text.strip()


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


async def generate_example_sentences(character: str, story_title: str) -> dict:
    """Generate 2 example sentences for a Chinese character.

    Returns {"sentences": [{"sentence": str, "explanation": str}, ...]}
    Each sentence uses the target character in a contextually appropriate way
    suited for elementary/middle school students.
    """
    safe_char, _ = sanitize_ai_input(character)
    safe_title, _ = sanitize_ai_input(story_title)

    system_prompt = f"""{TUTOR_PERSONA}

你是一位專業的國語文教師，請為學生示範如何使用生字造句。

目標生字：「{safe_char}」
課文名稱：《{safe_title}》

請造 2 個包含目標生字的例句，要求：
1. 符合國小高年級～國中的語文程度
2. 句子自然流暢，生動有趣
3. 幫助學生理解這個字的用法
4. 用繁體中文（zh-TW）

請以 JSON 格式輸出，包含 sentences 陣列，每個元素有：
- sentence（例句）
- explanation（簡短說明這個字在句中的意思）"""

    contents = [
        genai_types.Content(
            role="user",
            parts=[genai_types.Part(text=f"請為生字「{safe_char}」造兩個例句。")],
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
    character: str,
    student_sentence: str,
    story_title: str,
) -> dict:
    """Validate a student's sentence for a given character.

    Returns {"is_correct": bool, "feedback": str, "suggestion": str}
    - is_correct: True if grammatically correct and uses the character appropriately
    - feedback: encouraging feedback message (in Chinese)
    - suggestion: improvement hint if not correct (empty string if correct)
    """
    safe_char, _ = sanitize_ai_input(character)
    safe_sentence, _ = sanitize_ai_input(student_sentence)
    safe_title, _ = sanitize_ai_input(story_title)

    system_prompt = f"""{TUTOR_PERSONA}

你是一位親切的國語文老師，正在批改學生的造句練習。

目標生字：「{safe_char}」
課文：《{safe_title}》

評估標準：
1. 句子是否包含目標生字「{safe_char}」
2. 句子是否語法正確、語意通順
3. 目標生字的用法是否恰當
4. 適合國小高年級～國中程度

請給予鼓勵性的評語，用繁體中文（zh-TW）回覆。
- 若造句正確：is_correct=true，給予鼓勵
- 若有問題：is_correct=false，指出問題並提供改進建議

注意：只要學生的句子基本語法正確、有使用目標生字，就算通過。
不要過度嚴格，給予適度的鼓勵。"""

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
