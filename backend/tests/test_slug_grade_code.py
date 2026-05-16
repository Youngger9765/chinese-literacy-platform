r"""Regression tests for normalize_story_slug grade_code handling (#1654).

Bug: `_PUBLISHER_RE` matched the trailing `L\d+` of grade_codes like
`G7-L30`, returning `"30"`. This collided with Layer-1 lesson_number=30
(女性太空人登月) instead of Layer-2 G7-L30 八哥 (lesson_id=1110).

Fix: `normalize_story_slug` now detects grade_code-format input
(`^G\d+-L\d+$`) and routes through `get_lesson_by_code()` to recover
the correct Layer-2 lesson_id when applicable. Existing numeric / L-prefix /
publisher-slug / title-lookup paths are unchanged.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.utils.slug import normalize_story_slug
from app.services.lesson_loader import get_lesson_by_code


# ---------------------------------------------------------------------------
# Bug #1654 — grade_code disambiguation
# ---------------------------------------------------------------------------


def test_grade_code_g7_l30_resolves_to_layer2_lesson_id():
    """G7-L30 must resolve to Layer-2 八哥 (lesson_id=1110), NOT Layer-1 #30."""
    lesson = get_lesson_by_code("G7-L30")
    assert lesson is not None, "G7-L30 should exist in Layer-2 catalogue"
    expected_id = lesson["id"]
    assert expected_id != 30, "Layer-2 G7-L30 must not collide with Layer-1 #30"

    result = normalize_story_slug("G7-L30")
    assert result == str(expected_id), (
        f"normalize_story_slug('G7-L30') returned {result!r}, "
        f"expected {str(expected_id)!r} (Layer-2 八哥). Bug: regex picked up L30 → '30'."
    )


def test_grade_code_zero_padded_form():
    """G7-L01 (zero-padded) should also resolve via get_lesson_by_code."""
    lesson = get_lesson_by_code("G7-L01") or get_lesson_by_code("G7-L1")
    if lesson is None:
        # Skip if the catalogue doesn't include G7-L1 — environment-dependent
        return
    result = normalize_story_slug("G7-L01")
    assert result == str(lesson["id"])


def test_grade_code_unknown_falls_back_to_publisher_regex():
    """Unknown grade_code falls back to numeric extraction (safe fallback)."""
    # If G99-L99 isn't in the catalogue, the function falls back to the existing
    # _PUBLISHER_RE branch which extracts "99". This preserves backward compatibility.
    assert get_lesson_by_code("G99-L99") is None
    result = normalize_story_slug("G99-L99")
    assert result == "99"


# ---------------------------------------------------------------------------
# Existing behaviour — must not regress
# ---------------------------------------------------------------------------


def test_numeric_slug_unchanged():
    assert normalize_story_slug("30") == "30"
    assert normalize_story_slug("6") == "6"
    assert normalize_story_slug("06") == "6"


def test_l_prefix_slug_unchanged():
    assert normalize_story_slug("L6") == "6"
    assert normalize_story_slug("L06") == "6"
    assert normalize_story_slug("l06") == "6"


def test_publisher_slug_unchanged():
    """Real publisher-style slugs (sanmin-5a-L02) still extract trailing number."""
    assert normalize_story_slug("sanmin-5a-L02") == "2"
    assert normalize_story_slug("nani-6b-L10") == "10"


def test_empty_or_falsy_slug():
    assert normalize_story_slug("") == ""
