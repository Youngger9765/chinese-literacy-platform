"""Executable spec — lesson code normalization contracts.

spec_id: lesson.code.normalization
canonical_source: backend/app/services/lesson_code_normalization.py
owns_code: backend/app/services/lesson_code_normalization.py
related_issues: [1889, 1669]
human_spec: specs/modules/lesson-code-normalization/INTENT.md

All functions under test are pure (no DB, no network) — every contract here
is a hard assertion with no xfail markers.

Run:  cd backend && python -m pytest specs/test_lesson_code_normalization_spec.py -v
"""
from __future__ import annotations

import pytest

from app.services.lesson_code_normalization import (
    CATALOG_TO_PARSED_OVERRIDE,
    MULTI_LESSON_MAP,
    MULTI_LESSON_PRIMARY,
    halfwidth,
    normalize_manifest_code,
)


# === CONTRACT 1 — normalize_manifest_code: leading-zero stripping ===

@pytest.mark.parametrize("raw,expected", [
    ("G4-L01",  "G4-L1"),
    ("G4-L1",   "G4-L1"),   # already normalized
    ("G4-L03a", "G4-L3a"),
    ("G6-L01",  "G6-L1"),
    ("G8-L04",  "G8-L4"),
    ("G5-L20",  "G5-L20"),  # no leading zero — unchanged
    ("G9-L05",  "G9-L5"),
    # Classical-Chinese 文 prefix must strip leading zeros too, else 文-L08
    # stays padded and never matches the unpadded parsed YAML 文-L8.yml,
    # splitting one lesson into a duplicate the content gate misses (#2397).
    ("文-L08",  "文-L8"),
    ("文-L01",  "文-L1"),
    ("文-L10",  "文-L10"),  # two digits — unchanged
    ("文-L1",   "文-L1"),   # already normalized
])
def test_normalize_strips_leading_zero(raw: str, expected: str) -> None:
    assert normalize_manifest_code(raw) == expected


# === CONTRACT 2 — normalize_manifest_code: WW→文 prefix conversion ===

@pytest.mark.parametrize("raw,expected", [
    ("WW-L01", "文-L1"),
    ("WW-L10", "文-L10"),
    ("WW-L03", "文-L3"),
])
def test_normalize_converts_ww_prefix(raw: str, expected: str) -> None:
    assert normalize_manifest_code(raw) == expected


# === CONTRACT 3 — normalize_manifest_code: idempotency ===
# Normalising an already-normalised code must be a no-op.

@pytest.mark.parametrize("raw", [
    "G4-L01", "G4-L1", "G4-L03a", "WW-L01", "WW-L10",
    "G8-L04", "G5-L20", "G9-L05", "文-L08", "文-L8", "文-L10",
])
def test_normalize_is_idempotent(raw: str) -> None:
    once = normalize_manifest_code(raw)
    twice = normalize_manifest_code(once)
    assert once == twice, (
        f"normalize is not idempotent: {raw!r} -> {once!r} -> {twice!r}"
    )


# === CONTRACT 4 — normalize_manifest_code: pass-through for non-matching codes ===
# Unknown / malformed codes must be returned unchanged, never raise.

@pytest.mark.parametrize("raw", [
    "RANDOM", "totally-wrong", "G4", "L01", "WW-NONUM",
])
def test_normalize_passthrough_unrecognised(raw: str) -> None:
    result = normalize_manifest_code(raw)
    assert result == raw, f"expected pass-through for {raw!r}, got {result!r}"


def test_normalize_does_not_raise_on_empty_string() -> None:
    # Empty string: no match → pass-through, no exception.
    result = normalize_manifest_code("")
    assert isinstance(result, str)


# === CONTRACT 5 — halfwidth: full-to-half conversion ===

@pytest.mark.parametrize("raw,expected", [
    ("ＡＢＣ", "ABC"),
    ("Ａ",     "A"),
    ("ａ",     "a"),
    ("ABC",    "ABC"),   # already halfwidth — unchanged
    ("",       ""),      # empty — no crash
    ("Ｇ４-Ｌ０１", "G4-L01"),
])
def test_halfwidth_conversion(raw: str, expected: str) -> None:
    assert halfwidth(raw) == expected


# === CONTRACT 6 — halfwidth: idempotency ===

@pytest.mark.parametrize("raw", [
    "ＡＢＣ", "ABC", "Ａ", "ａ", "",
])
def test_halfwidth_is_idempotent(raw: str) -> None:
    once = halfwidth(raw)
    twice = halfwidth(once)
    assert once == twice, (
        f"halfwidth is not idempotent: {raw!r} -> {once!r} -> {twice!r}"
    )


# === CONTRACT 7 — halfwidth: does not alter non-fullwidth characters ===

def test_halfwidth_preserves_chinese_characters() -> None:
    """CJK characters must pass through halfwidth unchanged."""
    cjk_input = "山水花鳥"
    assert halfwidth(cjk_input) == cjk_input


# === CONTRACT 8 — CATALOG_TO_PARSED_OVERRIDE: keys are post-normalize form ===
# Every key in the override map must already be in normalized form.
# If a key re-normalizes to something different, the loader would look up the
# wrong key and silently miss the override.

def test_catalog_override_keys_are_already_normalized() -> None:
    drifted = []
    for key in CATALOG_TO_PARSED_OVERRIDE:
        renorm = normalize_manifest_code(key)
        if renorm != key:
            drifted.append((key, renorm))
    assert not drifted, (
        f"CATALOG_TO_PARSED_OVERRIDE keys that are NOT in normalized form: {drifted}"
    )


# === CONTRACT 9 — CATALOG_TO_PARSED_OVERRIDE: no key == value (self-mapping) ===
# A key that maps to itself is a no-op entry and should not exist.

def test_catalog_override_no_self_mapping() -> None:
    self_maps = [(k, v) for k, v in CATALOG_TO_PARSED_OVERRIDE.items() if k == v]
    assert not self_maps, (
        f"CATALOG_TO_PARSED_OVERRIDE has self-mapping entries: {self_maps}"
    )


# === CONTRACT 10 — MULTI_LESSON_MAP: secondary keys are disjoint from PRIMARY keys ===
# A code should not appear as both a primary slot and a secondary (redirect) slot.

def test_multi_lesson_maps_are_disjoint() -> None:
    overlap = set(MULTI_LESSON_MAP) & set(MULTI_LESSON_PRIMARY)
    assert not overlap, (
        f"Codes appear in both MULTI_LESSON_MAP and MULTI_LESSON_PRIMARY: {overlap}"
    )
