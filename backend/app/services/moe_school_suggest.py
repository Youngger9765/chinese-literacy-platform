"""LLM fallback suggestions for the school directory search (#3804 §4.2).

Called ONLY when fuzzy matching (school_directory_search.search_school_directory)
returns zero results for a given query — this is a last-resort "did you
mean" helper, not a correctness-critical judgement, so it follows
llm-endpoint-hardening Rule 6 ("fail closed") in the sense appropriate to a
pure enhancement: any failure (oversized input, LLM error, malformed
response) returns an empty suggestion list rather than raising. The caller
(the route) already has its real answer — "0 matches" — before this is
even invoked; this can only ever make the response slightly more helpful,
never less correct.

llm-endpoint-hardening checklist applied:
  Rule 2 (auth)         — enforced by the caller (route requires login)
  Rule 3 (input cap)    — MAX_QUERY_CHARS, checked BEFORE the LLM call
  Rule 4 (output cap)   — max_tokens=512, a handful of short suggestions
  Rule 6 (fail-closed)  — any exception -> [] (see docstring above)
  Rule 7 (sanitize)     — the query is already a short free-text search
                          term from an authenticated teacher, not user-
                          controlled content injected into a shared prompt
"""
import logging

from google.genai import types as genai_types

from .ai_base import generate_structured_response

logger = logging.getLogger(__name__)

MAX_QUERY_CHARS = 100

SUGGEST_SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "maxItems": 5,
            "items": {
                "type": "object",
                "properties": {
                    "school_name": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["school_name", "reason"],
            },
        },
    },
    "required": ["suggestions"],
}

_SYSTEM_PROMPT = """你是台灣國民中小學學校名錄的查詢助手。
使用者輸入的學校名稱可能有錯字、簡稱、或拼音近似的誤植。
請根據使用者輸入，推測他最可能想找的台灣真實國小／國中／高中校名（最多 5 個）。

規則：
- 只建議台灣真實存在的學校名稱（校名格式例如「○○國小」「○○國中」）
- reason 用一句話說明為什麼推測是這間（例如字形相近、同音字、常見簡稱）
- 如果完全無法判斷，回傳空陣列，不要亂猜
"""


async def suggest_school_names(query: str, county: str | None = None) -> list[dict]:
    """Return up to 5 {school_name, reason} suggestions, or [] on any
    failure (oversized input, LLM error, malformed response).

    `county` (#3817) is an optional hint telling the LLM which county the
    caller already selected, so its first guess is more likely to be
    correct. This is a quality improvement only — it is NOT the
    correctness guarantee against a cross-county suggestion. The caller
    (app/routes/school_directory.py) deterministically filters the
    returned suggestions against the real directory for that county
    afterwards, because an LLM can still ignore this hint.
    """
    if not query or len(query) > MAX_QUERY_CHARS:
        return []

    try:
        user_text = f"使用者輸入：{query}"
        if county:
            user_text += f"\n使用者已選擇的縣市：{county}（請只建議這個縣市的學校）"
        contents = [
            genai_types.Content(
                role="user",
                parts=[genai_types.Part(text=user_text)],
            )
        ]
        result = await generate_structured_response(
            system_prompt=_SYSTEM_PROMPT,
            contents=contents,
            response_schema=SUGGEST_SCHEMA,
            max_tokens=512,
            temperature=0.3,
            task="school_name_suggest",
        )
        return result.get("suggestions", [])
    except Exception as e:
        logger.warning("suggest_school_names failed for query=%r: %s", query, e)
        return []
