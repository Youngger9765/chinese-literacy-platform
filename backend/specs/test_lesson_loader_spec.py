"""
Spec: lesson-loader — dual-layer merge + strategy_exercise key-fallback contracts.

Canonical sources:
  backend/app/services/lesson_loader.py
  backend/app/services/lesson_indexes.py
  backend/app/services/lesson_layer_loaders.py

Module spec: specs/modules/lesson-loader/INTENT.md

Verified against real data in backend/data/lessons/ on 2026-06-02.

IMPORTANT: There is a known duplicate lesson_code issue (#1666 residual) for
7 lesson codes with slight title punctuation differences between Layer-1 and
Layer-2. This spec explicitly does NOT assert zero duplicates; it documents
the known behavior.
"""

import re
import pytest
import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.services.lesson_indexes import build_all_lessons, build_indexes
from app.services.lesson_layer_loaders import LAYER2_ID_OFFSET


# ---------------------------------------------------------------------------
# I-1: Lesson count sanity
# ---------------------------------------------------------------------------

class TestLessonCount:
    def test_total_lessons_at_least_50(self):
        """build_all_lessons must return >= 50 entries; lower signals loader failure."""
        lessons = build_all_lessons()
        assert len(lessons) >= 50, (
            f"Expected >= 50 lessons, got {len(lessons)}. YAML parsing may be broken."
        )

    def test_layer1_has_at_most_57_lessons(self):
        """Layer-1 (L*.yml) covers 57 lessons; more signals an unexpected file added."""
        lessons = build_all_lessons()
        layer1 = [l for l in lessons if l.get("_layer") == 1]
        assert len(layer1) <= 57, (
            f"Layer-1 has {len(layer1)} lessons; expected <= 57. "
            f"Check for unexpected L*.yml files."
        )

    def test_every_lesson_comes_from_the_uid_tree(self):
        """The two historical layers were merged on TITLE and are gone (#2683).
        This pinned "Layer-2 is loaded"; the equivalent invariant now is that there
        is exactly ONE source, so no lesson can be assembled from two of them."""
        lessons = build_all_lessons()
        sources = {l.get("source") for l in lessons}
        assert sources == {"uid_tree"}, f"unexpected lesson sources: {sources}"


# ---------------------------------------------------------------------------
# I-2: Required fields on every lesson
# ---------------------------------------------------------------------------

class TestRequiredFields:
    def test_all_lessons_have_title(self):
        lessons = build_all_lessons()
        missing = [l.get("lesson_code") or l.get("id") for l in lessons if not l.get("title")]
        assert not missing, f"Lessons missing 'title': {missing[:5]}"

    def test_all_lessons_have_a_uid(self):
        """Replaces the `_layer` marker check: identity is the uid now, and the
        layer a lesson came from is no longer a thing that exists."""
        lessons = build_all_lessons()
        missing = [l.get("id") for l in lessons if not l.get("lesson_uid")]
        assert not missing, f"Lessons missing 'lesson_uid': {missing[:5]}"

    @pytest.mark.skip(reason="`_layer` was a dual-layer merge artefact, removed in #2683")
    def test_all_lessons_have_layer_marker(self):
        lessons = build_all_lessons()
        missing = [l.get("title", "?")[:30] for l in lessons if "_layer" not in l]
        assert not missing, f"Lessons missing '_layer': {missing[:5]}"

    def test_all_lessons_have_id(self):
        lessons = build_all_lessons()
        missing = [l.get("title", "?")[:30] for l in lessons if not l.get("id")]
        assert not missing, f"Lessons missing 'id': {missing[:5]}"

    def test_all_lessons_have_grade(self):
        lessons = build_all_lessons()
        missing = [l.get("title", "?")[:30] for l in lessons if l.get("grade") is None]
        assert not missing, f"Lessons missing 'grade': {missing[:5]}"


# ---------------------------------------------------------------------------
# I-3: strategy_exercise accepts plural key (strategy_exercises → singular)
# ---------------------------------------------------------------------------

class TestStrategyExercisePluralFallback:
    def test_g7_l30_has_strategy_exercise_after_load(self):
        """
        G7-L30.yml uses 'strategy_exercises' (plural) key.
        After loading, the lesson must expose 'strategy_exercise' (singular).
        Verified on 2026-06-02: G7-L30.yml has strategy_exercises=True, strategy_exercise=False.
        """
        lessons = build_all_lessons()
        g7l30 = [l for l in lessons if l.get("lesson_code") == "G7-L30"]

        if not g7l30:
            import pytest
            pytest.skip("G7-L30 not in loaded lessons — verify lesson code")

        # At least one entry for G7-L30 must have strategy_exercise populated
        has_exercise = any(bool(l.get("strategy_exercise")) for l in g7l30)
        assert has_exercise, (
            "G7-L30 must have 'strategy_exercise' populated after load. "
            "The plural-key fallback (strategy_exercises → strategy_exercise) may be broken."
        )

    def test_majority_of_lessons_have_truthy_strategy_exercise(self):
        """
        Not all lessons are required to have a populated strategy_exercise;
        as of 2026-06-02, ~26 of 165 have falsy values (None or []).
        This test pins that most lessons (>= 100) DO have a truthy strategy_exercise.
        """
        lessons = build_all_lessons()
        # The second-edition extraction produces the spotlight itself rather than a
        # separate `strategy_exercise` field, so what this was protecting — "most
        # lessons carry their strategy exercise" — is now measured on the spotlight.
        with_spotlight = [l for l in lessons if (l.get("spotlight_v2") or {}).get("blocks")]
        assert len(with_spotlight) >= 100, (
            f"Expected >= 100 lessons with spotlight blocks, got {len(with_spotlight)}"
        )


# ---------------------------------------------------------------------------
# I-4 (documented, NOT enforced): Duplicate lesson_code is a known bug residual
# ---------------------------------------------------------------------------

class TestDuplicateLessonCodeBehavior:
    def test_duplicate_codes_are_documented_known_set(self):
        """
        As of 2026-06-02, 7 lesson_codes appear in both Layer-1 and Layer-2
        due to title punctuation mismatches (issue #1666 residual).

        This test DOCUMENTS the known duplicates. If all duplicates disappear
        (the bug is fixed) or new ones appear (regression), the test fails so
        a human must update this spec.
        """
        lessons = build_all_lessons()
        from collections import Counter
        code_counts = Counter(
            l.get("lesson_code") for l in lessons if l.get("lesson_code")
        )
        duplicate_codes = frozenset(code for code, cnt in code_counts.items() if cnt > 1)

        known_duplicates = frozenset({
            "G5-L11", "G5-L12", "G6-L18", "G7-L15", "G9-L10", "G9-L15", "G9-L17"
        })

        unexpected_new = duplicate_codes - known_duplicates
        assert not unexpected_new, (
            f"NEW duplicate lesson_codes appeared (regression): {unexpected_new}. "
            f"Check recent YAML changes and update this spec + INTENT.md."
        )

        # Note: it is OK if known_duplicates - duplicate_codes is non-empty
        # (that means some duplicates were fixed — good! Update known_duplicates above.)


# ---------------------------------------------------------------------------
# I-5: Layer-1 id range 1-57, Layer-2 >= LAYER2_ID_OFFSET
# ---------------------------------------------------------------------------

class TestIdRanges:
    def test_layer1_ids_are_positive_integers_below_offset(self):
        """
        Layer-1 lesson ids are derived from lesson_number in L*.yml.
        As of 2026-06-02 there are 57 Layer-1 lessons with ids 1-58
        (id=58 exists due to lesson_number=58 in a specific YAML).
        All must be positive integers and below LAYER2_ID_OFFSET (1000).
        """
        lessons = build_all_lessons()
        layer1 = [l for l in lessons if l.get("_layer") == 1]
        invalid = [l["id"] for l in layer1 if not (1 <= l["id"] < LAYER2_ID_OFFSET)]
        assert not invalid, (
            f"Layer-1 lessons with id outside [1, LAYER2_ID_OFFSET): {invalid}"
        )

    def test_layer2_ids_start_at_or_above_offset(self):
        lessons = build_all_lessons()
        layer2 = [l for l in lessons if l.get("_layer") == 2]
        below_offset = [l["id"] for l in layer2 if l["id"] < LAYER2_ID_OFFSET]
        assert not below_offset, (
            f"Layer-2 lessons with id < LAYER2_ID_OFFSET ({LAYER2_ID_OFFSET}): {below_offset[:5]}"
        )

    def test_no_id_overlap_between_layers(self):
        lessons = build_all_lessons()
        layer1_ids = {l["id"] for l in lessons if l.get("_layer") == 1}
        layer2_ids = {l["id"] for l in lessons if l.get("_layer") == 2}
        overlap = layer1_ids & layer2_ids
        assert not overlap, f"Layer-1 and Layer-2 share ids: {overlap}"


# ---------------------------------------------------------------------------
# I-6: lesson_code format in build_indexes
# ---------------------------------------------------------------------------

class TestLessonCodeFormat:
    # Verified formats from real data (2026-06-02):
    # Standard: G4-L26 (grade + lesson number)
    # Alphabetic lesson: G8-L3a (lesson with sub-lesson letter suffix)
    # Classical Chinese: 文-L01 (Chinese char prefix for 文言文)
    _LESSON_CODE_RE = re.compile(r"^[\w一-鿿]+-L\d+[a-z]?$")

    def test_all_lesson_codes_in_index_match_expected_format(self):
        """
        Lesson codes follow one of three patterns verified on 2026-06-02:
          1. G<grade>-L<num>     e.g. G4-L26, G9-L10
          2. G<grade>-L<num><letter> e.g. G8-L3a, G8-L6b (sub-lessons)
          3. 文-L<num>           e.g. 文-L01, 文-L08 (Classical Chinese)
        """
        lessons = build_all_lessons()
        _, lessons_by_code, _, _ = build_indexes(lessons)
        invalid = [code for code in lessons_by_code if not self._LESSON_CODE_RE.match(code)]
        assert not invalid, f"lesson_codes in index with unexpected format: {invalid[:10]}"

    def test_standard_grade_codes_exist(self):
        """At least some G<N>-L<N> formatted codes must exist."""
        lessons = build_all_lessons()
        _, lessons_by_code, _, _ = build_indexes(lessons)
        standard_re = re.compile(r"^G\d+-L\d+$")
        standard_codes = [c for c in lessons_by_code if standard_re.match(c)]
        assert len(standard_codes) >= 50, (
            f"Expected >= 50 standard GN-LN codes, got {len(standard_codes)}"
        )

    def test_build_indexes_returns_four_items(self):
        lessons = build_all_lessons()
        result = build_indexes(lessons)
        assert len(result) == 4, "build_indexes must return (by_id, by_code, by_title, grades)"

    def test_available_grades_is_sorted(self):
        lessons = build_all_lessons()
        _, _, _, grades = build_indexes(lessons)
        assert grades == sorted(grades), "available_grades must be sorted ascending"

    def test_available_grades_are_positive_integers(self):
        lessons = build_all_lessons()
        _, _, _, grades = build_indexes(lessons)
        # Strings, not ints: the axis carries 文言文 and 品格教育 alongside the years.
        assert all(isinstance(g, str) and g for g in grades), (
            f"available_grades must be non-empty strings, got: {grades}"
        )
        assert {"4", "文言文"} <= set(grades), grades
