"""Regression tests for Layer-2 shadow merge in lesson_loader — Issue #1666.

Verifies that:
  1. get_lesson_by_code() returns Layer-2 lessons (not None)
  2. Layer-2 lessons have expected structure (id, title, paragraphs, grade_code)
  3. Layer-1 lessons still load correctly (Layer-2 doesn't shadow them)
  4. The lesson loader loads both layers simultaneously (total count is reasonable)
  5. Layer-2 lessons with step_sequence have the field set correctly

Background:
  Layer-1: backend/data/lessons/L*.yml (57 lessons, integer lesson_number)
  Layer-2: backend/data/lessons/_parsed_2026-05-01/*.yml (151 parsed lessons)
  Curriculum manifest: backend/data/curriculum/manifest.yml (158 entries)

  Layer-2 lessons get synthetic integer IDs: display_order + 1000.
  Layer-1 lessons take precedence when both cover the same curriculum slot.

  Issue #1666 was the initial shadow-fix that made Layer-2 lessons accessible
  via get_lesson_by_code() by building a code→lesson index.

Run:
    cd backend && python -m pytest tests/test_regression_layer2_shadow_merge_1666.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.services.lesson_loader import (
    get_all_lessons,
    get_lesson_by_code,
    get_lesson_by_id,
    get_lessons_by_grade,
)

_LAYER2_ID_OFFSET = 1000  # Layer-2 IDs = display_order + 1000


class TestLayer2LessonsLoadCorrectly:
    """Layer-2 lessons are accessible via get_lesson_by_code()."""

    def test_total_lesson_count_is_reasonable(self):
        """get_all_lessons() returns at least 57 (Layer-1) lessons.

        After Layer-2 integration, expect 100+ lessons total.
        If count drops below 57, the Layer-1 loader broke.
        If count drops below 100, Layer-2 loader broke.
        """
        lessons = get_all_lessons()
        assert len(lessons) >= 57, (
            f"get_all_lessons() returned {len(lessons)} lessons. "
            f"Expected at least 57 (Layer-1 minimum). Layer-1 loader may be broken."
        )
        assert len(lessons) >= 100, (
            f"get_all_lessons() returned {len(lessons)} lessons. "
            f"Expected at least 100 (Layer-1 + Layer-2). Layer-2 loader may be broken."
        )

    def test_layer1_and_layer2_both_present(self):
        """Both _layer=1 and _layer=2 lessons exist in the combined result."""
        lessons = get_all_lessons()
        layer1 = [l for l in lessons if l.get("_layer") == 1]
        layer2 = [l for l in lessons if l.get("_layer") == 2]
        assert len(layer1) >= 50, (
            f"Only {len(layer1)} Layer-1 lessons found. Expected ~57."
        )
        assert len(layer2) >= 50, (
            f"Only {len(layer2)} Layer-2 lessons found. Expected ~100+."
        )

    def test_layer2_lesson_accessible_by_code(self):
        """get_lesson_by_code() returns a Layer-2 lesson (G6-L11 is Layer-2 only)."""
        # G6-L11 exists only in Layer-2 (_parsed_2026-05-01/) — not in L*.yml
        lesson = get_lesson_by_code("G6-L11")
        assert lesson is not None, (
            "get_lesson_by_code('G6-L11') returned None. "
            "Expected a Layer-2 lesson. "
            "Was the Layer-2 loader broken or the shadow-fix reverted? (Issue #1666)"
        )
        assert lesson.get("_layer") == 2, (
            f"G6-L11 should be _layer=2, got {lesson.get('_layer')}."
        )

    def test_layer2_lesson_has_required_fields(self):
        """Layer-2 lessons have id, title, grade_code, paragraphs fields."""
        lesson = get_lesson_by_code("G6-L11")
        if lesson is None:
            pytest.skip("G6-L11 not available — skipping field check")

        assert "id" in lesson, "Layer-2 lesson missing 'id' field"
        assert isinstance(lesson["id"], int), f"id must be int, got {type(lesson['id'])}"
        assert lesson["id"] >= _LAYER2_ID_OFFSET, (
            f"Layer-2 lesson id={lesson['id']} should be >= {_LAYER2_ID_OFFSET}. "
            f"Synthetic ID formula: display_order + {_LAYER2_ID_OFFSET}."
        )

        assert "title" in lesson and lesson["title"], "Layer-2 lesson missing/empty 'title'"
        assert "grade_code" in lesson and lesson["grade_code"], "Layer-2 lesson missing 'grade_code'"
        assert "paragraphs" in lesson, "Layer-2 lesson missing 'paragraphs' field"

    def test_layer1_lesson_still_accessible_by_code(self):
        """Layer-1 lesson (G6-L10 has L*.yml) is still accessible after Layer-2 merge."""
        # G6-L10 (末日種子庫) exists in backend/data/lessons/ as a Layer-1 YAML.
        lesson = get_lesson_by_code("G6-L10")
        assert lesson is not None, (
            "get_lesson_by_code('G6-L10') returned None. "
            "Layer-1 lesson access broken — shadow-fix may have overwritten Layer-1 index."
        )
        assert lesson.get("_layer") == 1, (
            f"G6-L10 should be _layer=1 (takes precedence over Layer-2), "
            f"got {lesson.get('_layer')}."
        )

    def test_layer1_takes_precedence_over_layer2(self):
        """When both layers have the same curriculum slot, Layer-1 wins."""
        # G6-L10 appears in both Layer-1 (L*.yml) and potentially Layer-2 (_parsed/).
        # Layer-1 must win (dedup by title).
        lesson = get_lesson_by_code("G6-L10")
        if lesson is None:
            pytest.skip("G6-L10 not found — skipping precedence check")
        assert lesson.get("_layer") == 1, (
            f"G6-L10 returned _layer={lesson.get('_layer')}. "
            f"Layer-1 should always take precedence over Layer-2 for the same slot."
        )


class TestLayer2StepSequence:
    """Layer-2 lessons respect step_sequence from YAML if present."""

    def test_layer1_lesson_with_step_sequence_has_it(self):
        """G6-L10 has step_sequence in its Layer-1 YAML (added by #1374)."""
        lesson = get_lesson_by_code("G6-L10")
        if lesson is None:
            pytest.skip("G6-L10 not found")
        # G6-L10 has step_sequence set in its YAML
        seq = lesson.get("step_sequence")
        assert seq is not None, (
            "G6-L10 should have step_sequence from its Layer-1 YAML. "
            "Was the YAML modified?"
        )
        assert isinstance(seq, list), f"step_sequence must be a list, got {type(seq)}"
        assert len(seq) >= 5, (
            f"step_sequence has only {len(seq)} steps. Expected at least 5."
        )
        # Intro must be first
        assert seq[0] == "intro", f"step_sequence[0] should be 'intro', got {seq[0]!r}"

    def test_layer2_lesson_step_sequence_is_none_or_list(self):
        """Layer-2 lesson step_sequence is either None (default) or a valid list."""
        lesson = get_lesson_by_code("G6-L11")
        if lesson is None:
            pytest.skip("G6-L11 not found")
        seq = lesson.get("step_sequence")
        # step_sequence can be None (frontend uses DEFAULT_STEP_SEQUENCE) or a list
        assert seq is None or isinstance(seq, list), (
            f"G6-L11 step_sequence must be None or list, got {type(seq)}: {seq}"
        )


class TestLessonLoaderBoundaryConditions:
    """Edge cases in lesson loader that were fixed in Issue #1666."""

    def test_get_lesson_by_code_unknown_returns_none(self):
        """get_lesson_by_code() returns None for unknown codes."""
        result = get_lesson_by_code("G99-L99")
        assert result is None, (
            f"get_lesson_by_code('G99-L99') should return None, got {result}"
        )

    def test_get_lesson_by_code_empty_string_returns_none(self):
        """get_lesson_by_code('') returns None without crashing."""
        result = get_lesson_by_code("")
        assert result is None, (
            f"get_lesson_by_code('') should return None, got {result}"
        )

    def test_layer2_lessons_have_synthetic_integer_ids(self):
        """All Layer-2 lesson ids are integers >= 1001 (offset 1000 + display_order >= 1)."""
        lessons = get_all_lessons()
        layer2 = [l for l in lessons if l.get("_layer") == 2]
        assert len(layer2) > 0, "No Layer-2 lessons found"
        for lesson in layer2:
            lesson_id = lesson.get("id")
            assert isinstance(lesson_id, int), (
                f"Layer-2 lesson {lesson.get('lesson_code')!r} has non-int id: {lesson_id!r}"
            )
            assert lesson_id >= _LAYER2_ID_OFFSET + 1, (
                f"Layer-2 lesson {lesson.get('lesson_code')!r} has id={lesson_id}, "
                f"expected >= {_LAYER2_ID_OFFSET + 1} (offset + min display_order 1)."
            )

    def test_no_more_than_ten_duplicate_lesson_codes(self):
        """Duplicate lesson codes should be minimal (< 10).

        Some Layer-1 / Layer-2 overlaps have slightly different titles
        (e.g. punctuation differences: '拳力出擊' vs '「拳」力出擊')
        which bypass the title-dedup logic. These are known and tracked.

        This test guards against a mass regression (e.g. dedup logic broken
        across all lessons) while tolerating the known small set of overlaps.
        """
        lessons = get_all_lessons()
        codes = [l.get("lesson_code", "") for l in lessons if l.get("lesson_code")]
        from collections import Counter
        duplicates = [c for c, cnt in Counter(codes).items() if cnt > 1]
        assert len(duplicates) < 10, (
            f"Too many duplicate lesson codes ({len(duplicates)}): {duplicates}. "
            f"Expected < 10 known overlaps. "
            f"Layer-2 dedup-by-title logic may be broken."
        )

    def test_no_duplicate_lesson_ids(self):
        """All lesson ids are unique across both layers."""
        lessons = get_all_lessons()
        ids = [l.get("id") for l in lessons if l.get("id") is not None]
        duplicates = [i for i in set(ids) if ids.count(i) > 1]
        assert not duplicates, (
            f"Duplicate lesson id(s) found: {duplicates}. "
            f"Layer-2 synthetic ID formula or Layer-1 lesson_number collision."
        )
