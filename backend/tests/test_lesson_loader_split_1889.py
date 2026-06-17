"""TDD tests for lesson_loader split into focused modules (Issue #1889).

Three tests pinned to specific behaviors that must survive the refactor:

1. catalog_to_parsed_overrides_resolve_g8_offset_and_ab_slots
   Verifies _CATALOG_TO_PARSED_OVERRIDE map correctness — G8 offset corrections
   and a/b slot separate-file routing are all present.

2. layer2_enrichment_merges_truthy_fields_into_layer1_by_title
   Verifies the Layer-1 enrichment step: when a Layer-1 lesson shares a title
   with a Layer-2 parsed file, truthy Layer-2 fields propagate onto the Layer-1
   lesson dict while Layer-1 id/lesson_number/title are preserved.

3. get_lesson_by_code_falls_back_multi_text_secondary_to_primary
   Verifies that G4-L21 / G4-L22 (secondary multi-text slots) fall back to
   the G4-L20 primary slot instead of returning None.

These tests pass on the CURRENT lesson_loader.py and MUST continue passing
after the split into lesson_code_normalization / lesson_layer_loaders /
lesson_indexes sub-modules.

Run:
    cd backend && python -m pytest tests/test_lesson_loader_split_1889.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


# ---------------------------------------------------------------------------
# Test 1 — catalog_to_parsed_overrides_resolve_g8_offset_and_ab_slots
# ---------------------------------------------------------------------------

class TestCatalogToParsedOverridesG8:
    """_CATALOG_TO_PARSED_OVERRIDE contains the expected G8 mappings.

    Imports the map from wherever it lives after the refactor:
    - lesson_loader (original)
    - lesson_code_normalization (post-refactor dedicated module)
    Both paths must work (backward-compat re-export from lesson_loader).
    """

    def _get_override_map(self) -> dict:
        """Import override map — try new module first, fall back to lesson_loader."""
        try:
            from app.services.lesson_code_normalization import CATALOG_TO_PARSED_OVERRIDE
            return CATALOG_TO_PARSED_OVERRIDE
        except ImportError:
            from app.services.lesson_loader import _CATALOG_TO_PARSED_OVERRIDE
            return _CATALOG_TO_PARSED_OVERRIDE

    def test_g8_offset_corrections_present(self):
        """G8 catalog↔Layer-2 offset corrections map catalog codes to correct parsed codes."""
        override = self._get_override_map()
        # Category A: G8 offset (5 entries)
        expected = {
            "G8-L4": "G8-L5",
            "G8-L5": "G8-L6",
            "G8-L7": "G8-L9",
            "G8-L8": "G8-L10",
            "G8-L10": "G8-L13",
        }
        for catalog_code, expected_parsed in expected.items():
            actual = override.get(catalog_code)
            assert actual == expected_parsed, (
                f"_CATALOG_TO_PARSED_OVERRIDE[{catalog_code!r}] = {actual!r}, "
                f"expected {expected_parsed!r}. G8 offset correction is missing/wrong."
            )

    def test_g8_ab_slots_each_have_own_parsed_file(self):
        """G8 a/b curriculum slots route to distinct parsed file codes (not shared)."""
        override = self._get_override_map()
        # Category B: G8 a/b (8 entries — a and b are SEPARATE stories)
        expected = {
            "G8-L3a": "G8-L3",
            "G8-L3b": "G8-L4",
            "G8-L6a": "G8-L7",
            "G8-L6b": "G8-L8",
            "G8-L9a": "G8-L11",
            "G8-L9b": "G8-L12",
            "G8-L12a": "G8-L15",
            "G8-L12b": "G8-L16",
        }
        for catalog_code, expected_parsed in expected.items():
            actual = override.get(catalog_code)
            assert actual == expected_parsed, (
                f"_CATALOG_TO_PARSED_OVERRIDE[{catalog_code!r}] = {actual!r}, "
                f"expected {expected_parsed!r}. G8 a/b slot routing is missing/wrong."
            )

    def test_g7_l31_multi_text_override_present(self):
        """G7-L31 maps to G7-L23 (旅人鴿 = 第二篇 of G7-L23 multi-text)."""
        override = self._get_override_map()
        assert override.get("G7-L31") == "G7-L23", (
            f"_CATALOG_TO_PARSED_OVERRIDE['G7-L31'] = {override.get('G7-L31')!r}, "
            f"expected 'G7-L23'. G7-L31 multi-text override missing."
        )

    def test_all_ab_pairs_route_to_different_parsed_codes(self):
        """Each a/b pair in Category B routes to distinct (non-identical) parsed codes."""
        override = self._get_override_map()
        ab_pairs = [
            ("G8-L3a", "G8-L3b"),
            ("G8-L6a", "G8-L6b"),
            ("G8-L9a", "G8-L9b"),
            ("G8-L12a", "G8-L12b"),
        ]
        for a_code, b_code in ab_pairs:
            parsed_a = override.get(a_code)
            parsed_b = override.get(b_code)
            assert parsed_a is not None, f"Missing override for {a_code!r}"
            assert parsed_b is not None, f"Missing override for {b_code!r}"
            assert parsed_a != parsed_b, (
                f"G8 a/b pair {a_code!r}/{b_code!r} route to same parsed code {parsed_a!r}. "
                f"They should map to distinct files (a and b are separate stories)."
            )


class TestCatalogParsedResolveHelpers:
    """Public helpers for QA / tooling — mirror load_layer2_lessons resolution."""

    def test_catalog_to_parsed_code_g8_offset(self):
        from app.services.lesson_code_normalization import catalog_to_parsed_code

        assert catalog_to_parsed_code("G8-L08") == "G8-L10"
        assert catalog_to_parsed_code("G8-L10") == "G8-L13"

    def test_parsed_to_catalog_codes_reverse_lookup(self):
        from app.services.lesson_code_normalization import parsed_to_catalog_codes

        assert "G8-L8" in parsed_to_catalog_codes("G8-L10")
        assert "G8-L10" in parsed_to_catalog_codes("G8-L13")


# ---------------------------------------------------------------------------
# Test 2 — layer2_enrichment_merges_truthy_fields_into_layer1_by_title
# ---------------------------------------------------------------------------

class TestLayer2EnrichmentMergesIntoLayer1:
    """Layer-1 lessons get enrichment fields from matching Layer-2 parsed data.

    Uses the live loaded data to verify the enrichment actually applied:
    a Layer-1 lesson that has a matching parsed file should have non-None
    enrichment fields (step_sequence / layout_mode / reading_strategy_type).
    """

    def test_layer1_lesson_with_l2_match_gets_enriched_fields(self):
        """A Layer-1 lesson whose title matches a parsed YAML inherits Layer-2 fields.

        G6-L10 (末日種子庫) is a Layer-1 L*.yml that has a corresponding
        _parsed_2026-05-01 YAML. After enrichment, it should have step_sequence.
        """
        from app.services.lesson_loader import get_lesson_by_code
        lesson = get_lesson_by_code("G6-L10")
        if lesson is None:
            pytest.skip("G6-L10 not found in lesson data")
        assert lesson.get("_layer") == 1, (
            f"G6-L10 should be Layer-1, got _layer={lesson.get('_layer')}"
        )
        # Enrichment: step_sequence must be present (from Layer-2 YAML via enrichment)
        seq = lesson.get("step_sequence")
        assert seq is not None, (
            "G6-L10 (Layer-1) should have step_sequence enriched from Layer-2 YAML. "
            "Enrichment merge in _load_lessons() may be broken."
        )
        assert isinstance(seq, list) and len(seq) > 0, (
            f"step_sequence should be a non-empty list, got {seq!r}"
        )

    def test_enrichment_preserves_layer1_id_and_lesson_number(self):
        """Enrichment must NOT overwrite Layer-1 id / lesson_number / title."""
        from app.services.lesson_loader import get_lesson_by_code, get_all_lessons
        # Pick any Layer-1 lesson
        all_lessons = get_all_lessons()
        layer1_lessons = [l for l in all_lessons if l.get("_layer") == 1]
        assert len(layer1_lessons) >= 50, "Expected at least 50 Layer-1 lessons"

        for lesson in layer1_lessons[:5]:  # spot-check first 5
            lesson_num = lesson.get("lesson_number")
            lesson_id = lesson.get("id")
            assert isinstance(lesson_num, int) and 1 <= lesson_num <= 100, (
                f"Layer-1 lesson {lesson.get('lesson_code')!r} has "
                f"lesson_number={lesson_num!r}, expected 1-100 integer. "
                "Enrichment may have overwritten lesson_number with Layer-2 value."
            )
            assert lesson_id == lesson_num, (
                f"Layer-1 lesson id={lesson_id} should equal lesson_number={lesson_num}. "
                "Enrichment corrupted the id field."
            )

    def test_enrichment_only_copies_truthy_values(self):
        """Fields are only copied when Layer-2 has a truthy value (not None/empty)."""
        from app.services.lesson_loader import get_all_lessons
        all_lessons = get_all_lessons()
        layer1_lessons = [l for l in all_lessons if l.get("_layer") == 1]

        # None / empty string / empty list should NOT be enriched
        for lesson in layer1_lessons:
            # images defaults to [] in Layer-1 loader; if Layer-2 also has []
            # the enrichment must NOT copy that empty list (falsy → skip).
            # Verify images is either [] (original) or a non-empty list (enriched).
            images = lesson.get("images")
            assert images == [] or (isinstance(images, list) and len(images) > 0), (
                f"Lesson {lesson.get('lesson_code')!r} has unexpected images={images!r}. "
                "Should be [] (Layer-1 default) or non-empty list (enriched)."
            )


# ---------------------------------------------------------------------------
# Test 3 — get_lesson_by_code_falls_back_multi_text_secondary_to_primary
# ---------------------------------------------------------------------------

class TestGetLessonByCodeMultiTextFallback:
    """Secondary multi-text slots fall back to the primary slot's lesson dict."""

    def test_g4_l21_falls_back_to_g4_l20(self):
        """G4-L21 is a secondary slot (covered by G4-L20-22 YAML); must return G4-L20's lesson."""
        from app.services.lesson_loader import get_lesson_by_code
        lesson = get_lesson_by_code("G4-L21")
        assert lesson is not None, (
            "get_lesson_by_code('G4-L21') returned None. "
            "Expected fallback to G4-L20 (primary slot for G4-L20-22 multi-text YAML). "
            "Multi-text secondary fallback in get_lesson_by_code() may be broken."
        )
        # The returned lesson should be the primary (G4-L20)
        assert lesson.get("lesson_code") == "G4-L20", (
            f"G4-L21 fallback should return lesson_code='G4-L20', "
            f"got {lesson.get('lesson_code')!r}."
        )

    def test_g4_l22_falls_back_to_g4_l20(self):
        """G4-L22 is also secondary under G4-L20-22; must return G4-L20's lesson."""
        from app.services.lesson_loader import get_lesson_by_code
        lesson = get_lesson_by_code("G4-L22")
        assert lesson is not None, (
            "get_lesson_by_code('G4-L22') returned None. "
            "Expected fallback to G4-L20."
        )
        assert lesson.get("lesson_code") == "G4-L20", (
            f"G4-L22 fallback should return lesson_code='G4-L20', "
            f"got {lesson.get('lesson_code')!r}."
        )

    def test_g5_l25_falls_back_to_g5_l24(self):
        """G5-L25 secondary → G5-L24 primary (G5-L24-25 multi-text YAML)."""
        from app.services.lesson_loader import get_lesson_by_code
        lesson = get_lesson_by_code("G5-L25")
        assert lesson is not None, (
            "get_lesson_by_code('G5-L25') returned None. Expected fallback to G5-L24."
        )
        assert lesson.get("lesson_code") == "G5-L24", (
            f"G5-L25 fallback should return G5-L24, got {lesson.get('lesson_code')!r}."
        )

    def test_g9_secondary_slots_fall_back(self):
        """G9-L16 / G9-L18 / G9-L19 secondaries fall back to their primaries."""
        from app.services.lesson_loader import get_lesson_by_code
        cases = [
            ("G9-L16", "G9-L15"),
            ("G9-L18", "G9-L17"),
            ("G9-L19", "G9-L17"),
        ]
        for secondary, expected_primary in cases:
            lesson = get_lesson_by_code(secondary)
            assert lesson is not None, (
                f"get_lesson_by_code({secondary!r}) returned None. "
                f"Expected fallback to {expected_primary!r}."
            )
            assert lesson.get("lesson_code") == expected_primary, (
                f"{secondary} fallback should return {expected_primary!r}, "
                f"got {lesson.get('lesson_code')!r}."
            )

    def test_primary_slots_return_directly(self):
        """Primary multi-text slots (G4-L20, G5-L24, G9-L15, G9-L17) return their own lesson."""
        from app.services.lesson_loader import get_lesson_by_code
        primaries = ["G4-L20", "G5-L24", "G9-L15", "G9-L17"]
        for code in primaries:
            lesson = get_lesson_by_code(code)
            # They may be None if Layer-2 parsed file doesn't exist locally,
            # but if they exist, they should return the correct code.
            if lesson is not None:
                assert lesson.get("lesson_code") == code, (
                    f"{code} primary should return itself, "
                    f"got {lesson.get('lesson_code')!r}."
                )
