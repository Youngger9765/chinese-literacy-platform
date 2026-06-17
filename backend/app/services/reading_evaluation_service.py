"""
AI-powered reading evaluation service (Issue #454).

Replaces the pure character-matching approach in stt_service.py with a
Gemini-based semantic evaluation that forgives homophones, near-sounds,
filler words, and common STT errors.

Pipeline:
  1. Normalise inputs (strip punctuation, whitespace).
  2. Call Gemini 2.5 Flash for per-token semantic judgement.
  3. Compute adjusted_match_rate = (correct + forgiven) / target_length.
  4. Apply short-paragraph threshold compensation.
  5. Return structured result with diff_tokens, stats, thresholds.
  6. On any AI failure → fallback to rule-engine (stt_service.py).
     Fallback NEVER auto-passes students (mirrors understood=False principle).
"""

import logging
import re
from typing import Literal

from google.genai import types as genai_types

from .ai_service import generate_structured_response
from .input_sanitizer import sanitize_ai_input
from .persona import TUTOR_PERSONA, Thresholds
from .stt.normalization import normalize_for_comparison
from .stt_service import (
    correct_homophones,
    compute_match_rate,
    get_pinyin,
    is_homophone,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Filler words to strip from spoken text before evaluation
_FILLER_WORDS = {"嗯", "啊", "那", "個", "就", "是", "然", "後", "呢", "哦", "喔"}

# Near-sound pairs (zh↔z, sh↔s, ch↔c, n↔l, ㄣ↔ㄥ families)
# We encode these as pinyin prefix pairs.
_NEAR_SOUND_PAIRS: list[tuple[str, str]] = [
    ("zh", "z"),
    ("sh", "s"),
    ("ch", "c"),
    ("n", "l"),
]

# Gemini response schema for diff tokens
_DIFF_TOKEN_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "char": {"type": "STRING"},
            "type": {"type": "STRING"},   # "correct" | "forgiven" | "wrong" | "missing" | "extra"
            "spoken": {"type": "STRING"},
            "reason": {"type": "STRING"},
        },
        "required": ["char", "type"],
    },
}

_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "diff_tokens": _DIFF_TOKEN_SCHEMA,
        "feedback": {"type": "STRING"},
    },
    "required": ["diff_tokens", "feedback"],
}

# System prompt for Gemini evaluation
_SYSTEM_PROMPT = (
    f"{TUTOR_PERSONA}\n\n"
    "【任務】\n"
    "你是一位「溫暖但堅定」的國語文閱讀評分助教。\n"
    "請比較學生朗讀的 STT 轉錄文字（spoken_text）與課文原文（target_text），\n"
    "判斷每個原文字元是否被正確朗讀，並分類為以下類型：\n\n"
    "【分類標準】\n"
    "- correct：學生念對了，包含兩種情況：\n"
    "    * STT 轉錄與原文完全相同\n"
    "    * STT 常見選字誤差（的/得/地 混淆、一/壹/1）— 學生發音正確，是語音辨識選字問題，不算學生錯誤\n"
    "- forgiven：可通融的錯誤（算作通過），包含：\n"
    "    * 同音字（不同聲調也算，例如：門/們、公/工、完/玩）\n"
    "    * 近音字（zh↔z, sh↔s, ch↔c, n↔l 聲母混淆，例如：刷/耍、字/紙）\n"
    "    * 語氣詞/贅字（嗯、啊、那個、就是、然後）→ 直接忽略，不列入 diff_tokens\n"
    "- wrong：真的念錯（完全不同的字、漏念整個詞）\n"
    "- missing：原文有但學生完全沒念到\n"
    "- extra：學生多念了不在原文中的字（已排除語氣詞）\n\n"
    "【輸出規則】\n"
    "- diff_tokens 的順序必須與 target_text 字元順序對應\n"
    "- 每個 target_text 字元都要有一個對應的 token（type=missing 若未念到）\n"
    "- 若 spoken 與 char 相同則不需填 spoken 欄位\n"
    "- feedback 用繁體中文，1-2 句溫柔鼓勵語，禁止提到具體數字（百分比、字數、字/分鐘），多用「不錯！」「再試試看」「繼續加油」等口吻\n"
    "- 嚴格輸出 JSON，不要加任何說明文字\n"
)


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def _normalize_text(text: str) -> str:
    """Remove punctuation, bopomofo, and whitespace for scoring (matches frontend)."""
    return normalize_for_comparison(text)


def _apply_short_text_compensation(base_threshold: float, target_length: int) -> float:
    """Lower pass threshold for short paragraphs.

    ≤ 5 chars  → base - 0.2
    ≤ 10 chars → base - 0.1
    > 10 chars → unchanged
    """
    if target_length <= 5:
        return max(0.0, base_threshold - 0.2)
    if target_length <= 10:
        return max(0.0, base_threshold - 0.1)
    return base_threshold


def _calculate_tier(
    adjusted_rate: float,
    reading_pass: float,
    reading_excellent: float,
) -> Literal[1, 2, 3]:
    """Map adjusted_match_rate → tier 1 / 2 / 3."""
    if adjusted_rate >= reading_excellent:
        return 1
    if adjusted_rate >= reading_pass:
        return 2
    return 3


def _cpm_from_correct_count(correct_count: int, duration_ms: int | None) -> float | None:
    """CPM from correctly-read chars only (matches frontend fluencyAnalyzer)."""
    if duration_ms is None or duration_ms <= 0:
        return None
    duration_sec = max(duration_ms / 1000, 0.5)
    return round(correct_count / duration_sec * 60, 1)


def _is_near_sound(a: str, b: str) -> bool:
    """Return True if two chars are near-sound (zh↔z, sh↔s, ch↔c, n↔l)."""
    pa, pb = get_pinyin(a), get_pinyin(b)
    if pa is None or pb is None:
        return False
    for x, y in _NEAR_SOUND_PAIRS:
        # Check if one starts with x and the other starts with y,
        # with the same remainder (e.g. "zhi" vs "zi" — different remainder, not near)
        # We only match prefix swaps where the vowel part overlaps
        if pa.startswith(x) and pb.startswith(y):
            return pa[len(x):] == pb[len(y):]
        if pa.startswith(y) and pb.startswith(x):
            return pa[len(y):] == pb[len(x):]
    return False


def _build_fallback_result(spoken_text: str, target_text: str) -> dict:
    """Rule-engine fallback when Gemini is unavailable.

    Uses existing stt_service homophone correction + match_rate computation.
    Per the 'understood=False' principle: fallback NEVER inflates scores.
    """
    target_norm = _normalize_text(target_text)
    corrected = correct_homophones(spoken_text, target_norm)
    match_rate = compute_match_rate(corrected, target_text)

    # Build per-char diff tokens using simple alignment
    diff_tokens: list[dict] = []
    stats = {
        "correct_count": 0,
        "forgiven_count": 0,
        "wrong_count": 0,
        "missing_count": 0,
        "extra_count": 0,
    }

    target_chars = list(target_norm)
    spoken_norm = _normalize_text(spoken_text)
    spoken_chars = list(spoken_norm)

    # Levenshtein alignment to build diff tokens
    t_len = len(target_chars)
    s_len = len(spoken_chars)

    if t_len == 0:
        return {
            "match_rate": 0.0,
            "adjusted_match_rate": 0.0,
            "tier": 3,
            "feedback": "請再試一次！",
            "cpm": None,
            "diff_tokens": [],
            "stats": stats,
            "thresholds": {
                "reading_pass": Thresholds.READING_PASS,
                "reading_excellent": Thresholds.READING_EXCELLENT,
            },
            "evaluation_method": "fallback",
        }

    # Build DP table
    dp = [[0] * (s_len + 1) for _ in range(t_len + 1)]
    for i in range(t_len + 1):
        dp[i][0] = i
    for j in range(s_len + 1):
        dp[0][j] = j
    for i in range(1, t_len + 1):
        for j in range(1, s_len + 1):
            cost = 0 if target_chars[i - 1] == spoken_chars[j - 1] else 1
            dp[i][j] = min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost,
            )

    # Backtrack — prefer target gaps (漏字) over matching distant duplicates (frontend parity)
    alignment: list[tuple[str | None, str | None]] = []  # (target_char, spoken_char)
    i, j = t_len, s_len
    while i > 0 or j > 0:
        if i > 0 and (j == 0 or dp[i][j] == dp[i - 1][j] + 1):
            alignment.append((target_chars[i - 1], None))
            i -= 1
            continue
        if j > 0 and (i == 0 or dp[i][j] == dp[i][j - 1] + 1):
            alignment.append((None, spoken_chars[j - 1]))
            j -= 1
            continue
        if i > 0 and j > 0:
            cost = 0 if target_chars[i - 1] == spoken_chars[j - 1] else 1
            alignment.append((target_chars[i - 1], spoken_chars[j - 1]))
            i -= 1
            j -= 1
            continue
        break
    alignment.reverse()

    # Count totals for adjusted_match_rate calculation
    correct = 0
    forgiven = 0
    wrong = 0

    for t_ch, s_ch in alignment:
        if t_ch is None:
            # Extra char spoken (not in target)
            stats["extra_count"] += 1
            diff_tokens.append({"char": s_ch, "type": "extra"})
        elif s_ch is None:
            # Missing char
            stats["missing_count"] += 1
            diff_tokens.append({"char": t_ch, "type": "missing"})
            wrong += 1
        elif t_ch == s_ch:
            stats["correct_count"] += 1
            diff_tokens.append({"char": t_ch, "type": "correct"})
            correct += 1
        elif is_homophone(t_ch, s_ch) or _is_near_sound(t_ch, s_ch):
            stats["forgiven_count"] += 1
            diff_tokens.append({
                "char": t_ch,
                "type": "forgiven",
                "spoken": s_ch,
                "reason": "同音字" if is_homophone(t_ch, s_ch) else "近音字",
            })
            forgiven += 1
        else:
            stats["wrong_count"] += 1
            diff_tokens.append({"char": t_ch, "type": "wrong", "spoken": s_ch})
            wrong += 1

    # adjusted_match_rate: correct + forgiven over target length
    adjusted_match_rate = (correct + forgiven) / t_len if t_len > 0 else 0.0

    reading_pass = _apply_short_text_compensation(Thresholds.READING_PASS, t_len)
    tier = _calculate_tier(adjusted_match_rate, reading_pass, Thresholds.READING_EXCELLENT)

    tier_feedback = {
        1: "唸得很棒！繼續下一段。",
        2: "唸得不錯！繼續加油。",
        3: "再試一次，你可以的！",
    }

    return {
        "match_rate": round(match_rate, 4),
        "adjusted_match_rate": round(adjusted_match_rate, 4),
        "tier": tier,
        "feedback": tier_feedback[tier],
        "cpm": None,
        "diff_tokens": diff_tokens,
        "stats": stats,
        "thresholds": {
            "reading_pass": round(reading_pass, 4),
            "reading_excellent": Thresholds.READING_EXCELLENT,
        },
        "evaluation_method": "fallback",
    }


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def evaluate_reading_with_ai(
    spoken_text: str,
    target_text: str,
    duration_ms: int | None = None,
) -> dict:
    """Evaluate student reading using Gemini 2.5 Flash semantic analysis.

    Args:
        spoken_text: Raw STT transcription from the student.
        target_text: The correct paragraph text from the lesson.
        duration_ms: Optional reading duration in milliseconds (for CPM calc).

    Returns:
        Dict with keys: match_rate, adjusted_match_rate, tier, feedback,
        cpm, diff_tokens, stats, thresholds, evaluation_method.
    """
    target_norm = _normalize_text(target_text)
    t_len = len(target_norm)

    # Calculate effective pass threshold (short paragraph compensation)
    reading_pass = _apply_short_text_compensation(Thresholds.READING_PASS, t_len)

    # Alignment preview for CPM (chars actually read, not full target length)
    alignment_preview = _build_fallback_result(spoken_text, target_text)
    cpm = _cpm_from_correct_count(alignment_preview["stats"]["correct_count"], duration_ms)

    # Sanitise inputs before sending to AI
    safe_spoken = sanitize_ai_input(spoken_text)
    safe_target = sanitize_ai_input(target_text)

    # Build user message
    user_message = (
        f"target_text（課文原文）: {safe_target}\n"
        f"spoken_text（學生朗讀 STT）: {safe_spoken}\n\n"
        "請根據以上規則評分，輸出 JSON。"
    )

    # Dynamic token budget for per-char diff output.
    # 81 chars can already produce large JSON arrays; fixed 1024 is often too tight.
    ai_max_tokens = max(1024, min(4096, t_len * 24 + 256))

    contents = [
        genai_types.Content(
            role="user",
            parts=[genai_types.Part(text=user_message)],
        )
    ]

    try:
        ai_result = await generate_structured_response(
            system_prompt=_SYSTEM_PROMPT,
            contents=contents,
            response_schema=_RESPONSE_SCHEMA,
            max_tokens=ai_max_tokens,
            temperature=0.1,  # Low temp for deterministic evaluation
        )

        diff_tokens: list[dict] = ai_result.get("diff_tokens", [])
        feedback: str = ai_result.get("feedback", "繼續加油！")

        # Compute stats from diff_tokens
        stats = {
            "correct_count": 0,
            "forgiven_count": 0,
            "wrong_count": 0,
            "missing_count": 0,
            "extra_count": 0,
        }
        correct = 0
        forgiven = 0

        for token in diff_tokens:
            token_type = token.get("type", "wrong")
            if token_type == "correct":
                stats["correct_count"] += 1
                correct += 1
            elif token_type == "forgiven":
                stats["forgiven_count"] += 1
                forgiven += 1
            elif token_type == "wrong":
                stats["wrong_count"] += 1
            elif token_type == "missing":
                stats["missing_count"] += 1
            elif token_type == "extra":
                stats["extra_count"] += 1

        # Denominator = target-position tokens only (correct + forgiven + wrong + missing),
        # excluding `extra` (贅字). This keeps numerator and denominator on the SAME basis:
        # both count target positions, so (correct + forgiven) <= denominator is guaranteed
        # → adjusted_match_rate <= 1.0 by construction, not by a min(1.0, ...) clamp.
        #
        # Issue #2253: previously the denominator was t_len (原文字數) while the numerator
        # came from Gemini token counts. When STT produced 贅字/重複字 and Gemini tagged them
        # correct/forgiven, the numerator could exceed t_len → rate > 100% (seen 150%–300%).
        target_tokens = (
            correct + forgiven + stats["wrong_count"] + stats["missing_count"]
        )
        denominator = target_tokens if target_tokens > 0 else 1

        # Raw match rate (correct only)
        match_rate = correct / denominator
        # Adjusted rate (correct + forgiven)
        adjusted_match_rate = (correct + forgiven) / denominator

        tier = _calculate_tier(adjusted_match_rate, reading_pass, Thresholds.READING_EXCELLENT)

        logger.info(
            "AI reading eval: spoken=%r target=%r match=%.2f adjusted=%.2f tier=%d",
            spoken_text[:20],
            target_text[:20],
            match_rate,
            adjusted_match_rate,
            tier,
            extra={
                "event": "reading_eval_ai",
                "match_rate": match_rate,
                "adjusted_match_rate": adjusted_match_rate,
                "tier": tier,
                "target_length": t_len,
            },
        )

        return {
            "match_rate": round(match_rate, 4),
            "adjusted_match_rate": round(adjusted_match_rate, 4),
            "tier": tier,
            "feedback": feedback,
            "cpm": cpm,
            "diff_tokens": diff_tokens,
            "stats": stats,
            "thresholds": {
                "reading_pass": round(reading_pass, 4),
                "reading_excellent": Thresholds.READING_EXCELLENT,
            },
            "evaluation_method": "ai",
        }

    except Exception as exc:
        logger.warning(
            "Gemini reading eval failed, using fallback: %s",
            exc,
            extra={"event": "reading_eval_fallback", "error": str(exc)},
        )
        result = alignment_preview
        result["cpm"] = cpm
        return result
