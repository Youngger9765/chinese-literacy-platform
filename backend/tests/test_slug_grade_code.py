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


# ---------------------------------------------------------------------------
# Bug #1666 — Layer-2 enrichment shadow
# ---------------------------------------------------------------------------


def test_shadowed_grade_codes_inherit_layer2_step_sequence():
    """Layer-1 lessons with matching-title Layer-2 yml must inherit step_sequence.

    Before #1666: _load_layer2_lessons skipped Layer-2 entries when title matched
    a Layer-1 lesson, leaving the catalogue with Layer-1 entry only (no
    step_sequence). API returned step_sequence=null for 14+ lessons.

    Fix: _load_lessons now merges Layer-2 enrichment fields (step_sequence,
    worksheet_*, lesson_intro, layout_mode, etc.) into matching Layer-1 entries.
    """
    # Sample 3 known-shadowed codes from the #1666 audit
    shadowed_codes = ["G6-L10", "G4-L13", "G6-L13"]
    for code in shadowed_codes:
        lesson = get_lesson_by_code(code)
        assert lesson is not None, f"{code} must exist in catalogue"
        assert lesson.get("step_sequence"), (
            f"{code} (Layer-1 id={lesson['id']}, title={lesson['title']!r}) "
            f"must inherit step_sequence from Layer-2 _parsed_ yml. "
            f"Got: {lesson.get('step_sequence')!r}"
        )
        # Sanity: Layer-1 id preserved (DB FK back-compat)
        assert lesson["id"] < 1000, (
            f"{code} should keep Layer-1 id (< 1000) for session FK compat, "
            f"got id={lesson['id']}"
        )


def test_layer2_only_lessons_still_resolve():
    """Layer-2-only lessons (no Layer-1 equivalent) must still work post-fix."""
    # G7-L30 (八哥, Layer-2 only) — verified by #1654 test, but re-check
    lesson = get_lesson_by_code("G7-L30")
    assert lesson is not None
    assert lesson["id"] == 1110
    assert lesson.get("step_sequence"), "Layer-2 G7-L30 must have step_sequence"


def test_no_duplicate_titles_after_merge():
    """Merging Layer-2 enrichment into Layer-1 must not cause duplicate catalogue entries."""
    from app.services.lesson_loader import get_all_lessons
    from collections import Counter

    titles = [l["title"] for l in get_all_lessons() if l.get("title")]
    counts = Counter(titles)
    duplicates = {t: c for t, c in counts.items() if c > 1}
    assert not duplicates, f"Duplicate titles after merge: {duplicates}"


# ---------------------------------------------------------------------------
# Bug #1669 — G8 catalog↔Layer-2 offset + G8 a/b sub-letter routing
# ---------------------------------------------------------------------------


def test_g8_catalog_offset_routes_to_correct_layer2_file():
    """Cat A: G8 catalog code offset (#1669). Catalog G8-L04 must serve
    `好心沒好報的玻璃娃娃` (Layer-2 G8-L5.yml), NOT `植物肉` (G8-L4.yml)."""
    lesson = get_lesson_by_code("G8-L04")
    assert lesson is not None, "G8-L04 must exist in catalogue"
    assert "玻璃娃娃" in lesson["title"], (
        f"G8-L04 should serve 玻璃娃娃 story, got title={lesson['title']!r}"
    )
    assert lesson.get("step_sequence"), "G8-L04 must have step_sequence"
    assert len(lesson["step_sequence"]) == 12


def test_g8_sub_letter_routes_to_separate_layer2_files():
    """Cat B: G8 a/b sub-letter (#1669). G8-L03a and G8-L03b are SEPARATE
    stories that map to their own Layer-2 files (NOT sharing one file as
    the legacy _AB_SECONDARY_MAP design assumed)."""
    l3a = get_lesson_by_code("G8-L03a")
    l3b = get_lesson_by_code("G8-L03b")
    assert l3a is not None
    assert l3b is not None
    assert l3a["title"] != l3b["title"], (
        f"G8-L03a and G8-L03b must be different stories. "
        f"a={l3a['title']!r}, b={l3b['title']!r}"
    )
    assert "集中營" in l3a["title"], f"G8-L03a should be 集中營, got {l3a['title']!r}"
    assert "植物肉" in l3b["title"], f"G8-L03b should be 植物肉, got {l3b['title']!r}"
    assert l3a.get("step_sequence")
    assert l3b.get("step_sequence")


def test_g8_all_catalog_entries_resolve_correctly():
    """All 19 G8 catalog entries resolve to their semantically-correct stories."""
    expected = {
        "G8-L01": "致台東",
        "G8-L02": "爸爸的恩人們",
        "G8-L03a": "集中營",
        "G8-L03b": "植物肉",
        "G8-L04": "玻璃娃娃",
        "G8-L05": "戲院",
        "G8-L06a": "甜蜜",
        "G8-L06b": "隱形的征服者",
        "G8-L07": "黑猩猩",
        "G8-L08": "按讚",
        "G8-L09a": "虎襲",
        "G8-L09b": "語言的足跡",
        "G8-L10": "構樹",
        "G8-L11": "蝴蝶蘭",
        "G8-L12a": "球場",
        "G8-L12b": "阿嬤",
        "G8-L13": "告別",
        "G8-L14": "石虎",
        "G8-L15": "核能",
    }
    for code, fragment in expected.items():
        lesson = get_lesson_by_code(code)
        assert lesson is not None, f"{code} not found"
        assert fragment in lesson["title"], (
            f"{code} expected title containing {fragment!r}, got {lesson['title']!r}"
        )


def test_g7_l31_uses_catalog_title_not_parsed_title():
    """G7-L31 (旅人鴿, 第二篇 of G7-L23 docx) must use catalog title
    `最後一隻旅人鴿`, not the shared parsed file's title (`第一篇 雨林`)."""
    lesson = get_lesson_by_code("G7-L31")
    assert lesson is not None, "G7-L31 not found"
    assert "旅人鴿" in lesson["title"], (
        f"G7-L31 should be 旅人鴿, got {lesson['title']!r}"
    )
    assert lesson.get("step_sequence"), "G7-L31 must have step_sequence"


def test_slug_grade_code_supports_ab_suffix():
    r"""normalize_story_slug must accept G\d+-L\d+[ab]? grade_codes (#1669)."""
    from app.services.lesson_loader import get_lesson_by_code as _get

    for code in ["G8-L03a", "G8-L03b", "G8-L06a", "G8-L12b"]:
        lesson = _get(code)
        assert lesson is not None, f"{code} not found via get_lesson_by_code"
        result = normalize_story_slug(code)
        assert result == str(lesson["id"]), (
            f"normalize_story_slug({code!r}) = {result!r}, "
            f"expected {str(lesson['id'])!r}"
        )


def test_g8_layer2_files_have_step_sequence():
    """All Layer-2 G8 files written in #1669 must have step_sequence."""
    import yaml
    from pathlib import Path

    parsed_dir = Path(__file__).parent.parent / "data" / "lessons" / "_parsed_2026-05-01"
    g8_files = sorted(parsed_dir.glob("G8-L*.yml"))
    assert len(g8_files) >= 18, f"Expected ≥18 G8 Layer-2 files, found {len(g8_files)}"
    for yml in g8_files:
        with open(yml) as f:
            data = yaml.safe_load(f)
        step_seq = data.get("step_sequence")
        assert step_seq, f"{yml.name} missing step_sequence"
        assert step_seq[0] == "intro", f"{yml.name} step_sequence[0] must be intro, got {step_seq[0]!r}"
        assert step_seq[-1] == "report", f"{yml.name} step_sequence[-1] must be report, got {step_seq[-1]!r}"
        # Disabled steps must not appear
        disabled = {"listening", "vocab", "sentence-practice", "dictation"}
        assert not (set(step_seq) & disabled), (
            f"{yml.name} contains disabled steps: {set(step_seq) & disabled}"
        )


def test_g4_l20_22_multi_text_step_sequence():
    """G4-L20/21/22 multi-text shared yml has step_sequence (#1669)."""
    lesson = get_lesson_by_code("G4-L20")
    assert lesson is not None
    step_seq = lesson.get("step_sequence")
    assert step_seq, "G4-L20 must have step_sequence"
    assert "intro" == step_seq[0]
    assert "report" == step_seq[-1]


def test_g9_l15_l17_multi_text_step_sequence():
    """G9 multi-text shared yml has step_sequence (#1669)."""
    for code in ["G9-L15", "G9-L17"]:
        lesson = get_lesson_by_code(code)
        assert lesson is not None, f"{code} not found"
        step_seq = lesson.get("step_sequence")
        assert step_seq, f"{code} must have step_sequence"
        assert step_seq[0] == "intro"
        assert step_seq[-1] == "report"


def test_multi_text_secondary_slots_resolve_to_primary(monkeypatch=None):
    """G4-L21/L22, G5-L25, G9-L16/L18/L19 must resolve via the primary slot
    (#1669). Previously they cascaded into the _PUBLISHER_RE fallback and
    matched Layer-1 lesson_number=21/22/25/etc — unrelated stories."""
    secondary_to_primary = {
        "G4-L21": "G4-L20",
        "G4-L22": "G4-L20",
        "G5-L25": "G5-L24",
        "G9-L16": "G9-L15",
        "G9-L18": "G9-L17",
        "G9-L19": "G9-L17",
    }
    for sec, prim in secondary_to_primary.items():
        sec_lesson = get_lesson_by_code(sec)
        prim_lesson = get_lesson_by_code(prim)
        assert sec_lesson is not None, f"{sec} secondary slot should resolve"
        assert prim_lesson is not None, f"{prim} primary slot should exist"
        assert sec_lesson["id"] == prim_lesson["id"], (
            f"{sec} should share id with primary {prim}, "
            f"got sec.id={sec_lesson['id']} vs prim.id={prim_lesson['id']}"
        )
        assert sec_lesson.get("step_sequence"), (
            f"{sec} must have step_sequence (inherited from primary)"
        )


def test_g4_l21_normalize_slug_no_collision_with_layer1():
    """normalize_story_slug('G4-L21') must NOT match Layer-1 #21 via
    _PUBLISHER_RE fallback (#1669, same class as #1654)."""
    result = normalize_story_slug("G4-L21")
    # G4-L21 resolves to G4-L20's primary (multi-text), lesson_id should
    # be Layer-2 (>= 1000), NOT Layer-1 #21
    assert result != "21", (
        f"G4-L21 must not collide with Layer-1 #21 (森林大軍的守護者). "
        f"Got: {result!r}"
    )
