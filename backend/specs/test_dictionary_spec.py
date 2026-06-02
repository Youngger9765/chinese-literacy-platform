"""Executable spec — dictionary service contracts.

spec_id: dictionary.lookup
canonical_source: backend/app/services/dictionary_service.py
human_spec: specs/modules/dictionary/INTENT.md

Only pure, DB-free / network-free functions are tested here:
  - _strip_markup()
  - _has_real_definition()
  - _parse_moe_response()
  - lookup_character() input-validation (ValueError path — no DB needed)

The network / cache paths are 待查 (integration tests needed with mock httpx).

Run:  cd backend && python -m pytest specs/test_dictionary_spec.py -v
"""
from __future__ import annotations

import pytest

from app.services.dictionary_service import (
    _has_real_definition,
    _parse_moe_response,
    _strip_markup,
    lookup_character,
)


# =========================================================================
# CONTRACT 1 — _strip_markup: removes moedict backtick/tilde annotations
# =========================================================================

def test_strip_markup_removes_backtick_tilde_pairs() -> None:
    # moedict format: `word~ -> word
    raw = "\x60陸地~\x60上~\x60高~\x60起~"
    result = _strip_markup(raw)
    assert result == "陸地上高起"


def test_strip_markup_passthrough_no_markup() -> None:
    plain = "陸地上高起的部分。"
    assert _strip_markup(plain) == plain


def test_strip_markup_empty_string_is_safe() -> None:
    assert _strip_markup("") == ""


def test_strip_markup_strips_stray_backtick_and_tilde() -> None:
    """Remaining stray markers (after pair removal) are removed."""
    raw = "test`only"
    result = _strip_markup(raw)
    assert "`" not in result
    assert "~" not in result


# =========================================================================
# CONTRACT 2 — _has_real_definition: filters pronunciation-only heteronyms
# =========================================================================

def test_has_real_definition_returns_false_for_pron_note() -> None:
    hetero = {"d": [{"f": "(一)之讀音。", "type": ""}]}
    assert _has_real_definition(hetero) is False


def test_has_real_definition_returns_true_for_real_definition() -> None:
    hetero = {"d": [{"f": "陸地上高起的部分。", "type": "名"}]}
    assert _has_real_definition(hetero) is True


def test_has_real_definition_returns_false_for_empty_d() -> None:
    assert _has_real_definition({"d": []}) is False


def test_has_real_definition_returns_false_for_missing_d() -> None:
    assert _has_real_definition({}) is False


@pytest.mark.parametrize("note", [
    "(一)之讀音。",
    "(二)之又音。",
    "(三)之俗音。",
])
def test_has_real_definition_handles_all_pron_note_patterns(note: str) -> None:
    hetero = {"d": [{"f": note, "type": ""}]}
    assert _has_real_definition(hetero) is False


# =========================================================================
# CONTRACT 3 — _parse_moe_response: well-formed output structure
# =========================================================================

_MINIMAL_MOE_RESPONSE = {
    "c": "3",
    "h": [
        {
            "b": "ㄕㄢ",
            "d": [
                {
                    "f": "陸地上高起的部分。",
                    "type": "名",
                    "q": ["這座山很高。"],
                    "e": [],
                }
            ],
        }
    ],
}


def test_parse_moe_returns_zhuyin() -> None:
    parsed = _parse_moe_response(_MINIMAL_MOE_RESPONSE)
    assert parsed["zhuyin"] == "ㄕㄢ"


def test_parse_moe_returns_stroke_count_as_int() -> None:
    parsed = _parse_moe_response(_MINIMAL_MOE_RESPONSE)
    assert parsed["stroke_count"] == 3
    assert isinstance(parsed["stroke_count"], int)


def test_parse_moe_definitions_is_list() -> None:
    parsed = _parse_moe_response(_MINIMAL_MOE_RESPONSE)
    assert isinstance(parsed["definitions"], list)


def test_parse_moe_definition_entry_has_required_keys() -> None:
    parsed = _parse_moe_response(_MINIMAL_MOE_RESPONSE)
    assert parsed["definitions"], "expected at least one definition"
    entry = parsed["definitions"][0]
    for key in ("type", "definition", "examples"):
        assert key in entry, f"missing key {key!r} in definition entry"


def test_parse_moe_empty_heteronyms_returns_empty_definitions() -> None:
    """An API response with no heteronyms must not crash."""
    parsed = _parse_moe_response({"h": []})
    assert parsed["definitions"] == []
    assert parsed["zhuyin"] is None
    assert parsed["stroke_count"] is None


def test_parse_moe_skips_pron_note_heteronym() -> None:
    """When first heteronym is a pron-note, pick the next one with real defs."""
    raw = {
        "c": "2",
        "h": [
            {"b": "wǒ", "d": [{"f": "(一)之讀音。", "type": ""}]},
            {"b": "ㄨㄛˇ", "d": [{"f": "代詞。", "type": "代"}]},
        ],
    }
    parsed = _parse_moe_response(raw)
    assert parsed["zhuyin"] == "ㄨㄛˇ"
    assert any(d["definition"] == "代詞。" for d in parsed["definitions"])


def test_parse_moe_missing_stroke_count_is_none() -> None:
    raw = {"h": [{"b": "ㄕㄢ", "d": [{"f": "山。", "type": "名"}]}]}
    parsed = _parse_moe_response(raw)
    assert parsed["stroke_count"] is None


# =========================================================================
# CONTRACT 4 — lookup_character: ValueError on invalid input
# =========================================================================

def test_lookup_character_raises_on_empty_string() -> None:
    with pytest.raises(ValueError, match="single Chinese character"):
        lookup_character("", None)  # type: ignore[arg-type]


def test_lookup_character_raises_on_multi_char() -> None:
    with pytest.raises(ValueError, match="single Chinese character"):
        lookup_character("山水", None)  # type: ignore[arg-type]


def test_lookup_character_raises_on_two_char_string() -> None:
    with pytest.raises(ValueError):
        lookup_character("ab", None)  # type: ignore[arg-type]
