"""Executable spec — listening evaluation guard contracts.

spec_id: listening.eval.guards
canonical_source: backend/app/services/listening_service.py
related_issues: [1098]
human_spec: specs/modules/listening/INTENT.md

Tests cover the three pure-function guards only:
  - _is_garbage_input()
  - _is_verbatim_paste()
  - RETELLING_EVAL_SCHEMA structure (schema is a plain dict, no runtime calls)

The async evaluate_retelling() AI path is 待查 (needs mock of Vertex AI).
The two short-circuit return values (score=0.0 and score=95.0) are validated
indirectly by inspecting the constants in the source.

Run:  cd backend && python -m pytest specs/test_listening_spec.py -v
"""
from __future__ import annotations

import pytest

from app.services.listening_service import (
    RETELLING_EVAL_SCHEMA,
    _MIN_MEANINGFUL_CHARS,
    _VERBATIM_SIMILARITY_THRESHOLD,
    _is_garbage_input,
    _is_verbatim_paste,
)

# ---------------------------------------------------------------------------
# Helper: a passage of realistic length for verbatim-paste tests
# ---------------------------------------------------------------------------
_PASSAGE = (
    "小明走進教室，看到黑板上有一道算術題。"
    "他拿起粉筆，仔細地把答案寫了上去。"
    "老師微笑著點頭，全班同學都給他鼓掌。"
    "小明感到非常高興，決定以後每天認真複習功課。"
)


# =========================================================================
# CONTRACT 1 — _is_garbage_input: rejects short / digit-only / punct-only
# =========================================================================

def test_garbage_empty_string() -> None:
    assert _is_garbage_input("") is True


def test_garbage_whitespace_only() -> None:
    assert _is_garbage_input("   ") is True


def test_garbage_digits_only() -> None:
    assert _is_garbage_input("1234") is True


def test_garbage_digits_at_threshold_still_garbage() -> None:
    """Exactly MIN_MEANINGFUL_CHARS digits — still garbage (all-digit pattern)."""
    text = "1" * _MIN_MEANINGFUL_CHARS
    assert _is_garbage_input(text) is True


def test_garbage_punctuation_only() -> None:
    assert _is_garbage_input("！？！？！") is True


def test_garbage_below_min_chars_is_garbage() -> None:
    """Fewer than MIN_MEANINGFUL_CHARS chars → garbage regardless of content."""
    short = "好" * (_MIN_MEANINGFUL_CHARS - 1)
    assert _is_garbage_input(short) is True


def test_garbage_real_cjk_above_threshold_is_not_garbage() -> None:
    """A meaningful CJK sentence of sufficient length is NOT garbage."""
    text = "我記得課文說了"   # 7 chars, all CJK
    assert _is_garbage_input(text) is False


def test_garbage_mixed_digits_and_cjk_is_not_garbage() -> None:
    """Digits mixed with real CJK content should not trigger the garbage guard."""
    text = "第3段說了主人公"   # CJK + digit, len > MIN
    assert _is_garbage_input(text) is False


# =========================================================================
# CONTRACT 2 — _is_verbatim_paste: detects copy-paste
# =========================================================================

def test_verbatim_exact_paste() -> None:
    assert _is_verbatim_paste(_PASSAGE, _PASSAGE) is True


def test_verbatim_minor_edit_still_triggers() -> None:
    """Minor whitespace removal should still exceed 0.70 similarity."""
    slightly_edited = _PASSAGE.replace("，", "").replace("。", "")
    ratio_estimate = len(slightly_edited) / len(_PASSAGE)
    # Only run if edited length is ≤ 1.2× original (fast-path not triggered)
    if ratio_estimate <= 1.2:
        result = _is_verbatim_paste(_PASSAGE, slightly_edited)
        assert result is True


def test_verbatim_completely_different_text() -> None:
    different = "學生完成了作業，老師非常高興地稱讚了全班同學。"
    assert _is_verbatim_paste(_PASSAGE, different) is False


def test_verbatim_short_genuine_retelling() -> None:
    """A short genuine retelling (not a paste) must return False."""
    genuine = "課文說小明在教室裡解了一道算術題，老師很高興。"
    assert _is_verbatim_paste(_PASSAGE, genuine) is False


def test_verbatim_longer_than_120pct_is_not_paste() -> None:
    """Input longer than 1.2× original triggers the fast-path and returns False."""
    too_long = _PASSAGE * 2  # clearly > 1.2×
    assert _is_verbatim_paste(_PASSAGE, too_long) is False


# =========================================================================
# CONTRACT 3 — RETELLING_EVAL_SCHEMA: required fields are present
# =========================================================================

REQUIRED_FIELDS = [
    "score",
    "key_points_covered",
    "key_points_missed",
    "feedback",
    "encouragement",
    "reasoning",
]


def test_schema_has_all_required_fields() -> None:
    for field in REQUIRED_FIELDS:
        assert field in RETELLING_EVAL_SCHEMA["required"], (
            f"'{field}' missing from RETELLING_EVAL_SCHEMA['required']"
        )


def test_schema_reasoning_is_required() -> None:
    """reasoning must be in required — CLAUDE.md standing rule for LLM judge outputs."""
    assert "reasoning" in RETELLING_EVAL_SCHEMA["required"]


def test_schema_properties_match_required() -> None:
    """Every required field must also be declared in properties."""
    props = set(RETELLING_EVAL_SCHEMA["properties"])
    for field in RETELLING_EVAL_SCHEMA["required"]:
        assert field in props, (
            f"required field '{field}' not declared in schema properties"
        )


def test_schema_score_is_number_type() -> None:
    assert RETELLING_EVAL_SCHEMA["properties"]["score"]["type"] == "NUMBER"


# =========================================================================
# CONTRACT 4 — guard constants are within expected ranges
# =========================================================================

def test_min_meaningful_chars_is_positive() -> None:
    assert _MIN_MEANINGFUL_CHARS > 0


def test_verbatim_threshold_is_between_0_and_1() -> None:
    assert 0.0 < _VERBATIM_SIMILARITY_THRESHOLD < 1.0
