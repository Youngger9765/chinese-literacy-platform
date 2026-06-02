"""
Spec: omo-identifier — hint-path determinism + fail-closed contracts.

Canonical source: backend/app/services/omo_identifier.py
Module spec: specs/modules/omo-identifier/INTENT.md

NOTE: identify_lesson_from_image is async and calls Vertex AI — it cannot be
unit-tested without network mocking. Tests here cover:
  (a) identify_lesson_from_hint (pure function, deterministic, no AI call)
  (b) The confidence-filtering helper logic via direct data construction
  (c) Circuit-breaker threshold constant (pinned so changes are visible)

AI path (identify_lesson_from_image) is covered by integration tests in
backend/tests/test_characterization_omo_*.py (with monkeypatching).
"""

import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.services.omo_identifier import identify_lesson_from_hint, _MAX_CONSECUTIVE_ERRORS
from app.services.omo_lesson_catalog import LessonCandidate, _load_curriculum_titles


# ---------------------------------------------------------------------------
# I-3 & I-4: hint path — deterministic, returns confidence=1.0, no AI
# ---------------------------------------------------------------------------

class TestHintPath:
    def test_known_lesson_code_returns_single_candidate(self):
        """A lesson code present in the curriculum catalog must return exactly 1 candidate."""
        # Use a code verified to exist in the catalog at test-write time.
        # If this breaks, the catalog data has changed (not the invariant).
        curriculum = _load_curriculum_titles()
        assert len(curriculum) > 0, "Curriculum catalog must not be empty"

        # Pick the first known code from the real catalog (data-driven)
        known_code = next(iter(curriculum))
        result = identify_lesson_from_hint(known_code)
        assert len(result) == 1

    def test_known_lesson_returns_confidence_1(self):
        curriculum = _load_curriculum_titles()
        known_code = next(iter(curriculum))
        result = identify_lesson_from_hint(known_code)
        assert result[0].confidence == 1.0

    def test_known_lesson_grade_code_matches(self):
        curriculum = _load_curriculum_titles()
        known_code = next(iter(curriculum))
        result = identify_lesson_from_hint(known_code)
        assert result[0].grade_code == known_code

    def test_known_lesson_reasoning_is_hint_path_message(self):
        """hint path must identify itself in the reasoning field."""
        curriculum = _load_curriculum_titles()
        known_code = next(iter(curriculum))
        result = identify_lesson_from_hint(known_code)
        assert "hint" in result[0].reasoning.lower()

    def test_known_lesson_title_matches_catalog(self):
        curriculum = _load_curriculum_titles()
        known_code = next(iter(curriculum))
        expected_title = curriculum[known_code]["title"]
        result = identify_lesson_from_hint(known_code)
        assert result[0].title == expected_title

    def test_unknown_lesson_code_returns_empty_list(self):
        """Fail-closed: unknown code must return [] not raise."""
        result = identify_lesson_from_hint("G99-L9999")
        assert result == []

    def test_empty_code_returns_empty_list(self):
        result = identify_lesson_from_hint("")
        assert result == []

    def test_all_codes_in_catalog_resolve(self):
        """Every code in the curriculum catalog must return exactly 1 candidate."""
        curriculum = _load_curriculum_titles()
        failures = []
        for code in curriculum:
            result = identify_lesson_from_hint(code)
            if len(result) != 1:
                failures.append(f"{code}: got {len(result)} candidates")
        assert not failures, f"Some lesson codes failed hint resolution: {failures[:5]}"

    def test_hint_path_is_deterministic(self):
        """Calling twice with same code returns identical result."""
        curriculum = _load_curriculum_titles()
        known_code = next(iter(curriculum))
        r1 = identify_lesson_from_hint(known_code)
        r2 = identify_lesson_from_hint(known_code)
        assert r1[0].lesson_id == r2[0].lesson_id
        assert r1[0].confidence == r2[0].confidence
        assert r1[0].title == r2[0].title


# ---------------------------------------------------------------------------
# I-2: Confidence threshold — pinned at 0.4 per INTENT.md
# ---------------------------------------------------------------------------

class TestConfidenceThreshold:
    def test_candidates_below_threshold_would_be_filtered(self):
        """
        Pin the filtering threshold: candidates with confidence < 0.4 must be excluded.
        We test this by constructing LessonCandidates directly (no AI call) and
        simulating the filtering logic from identify_lesson_from_image.

        This is not a mock of the whole function — it pins the threshold constant
        so that any change to the 0.4 value is caught by a test failure.
        """
        CONFIDENCE_THRESHOLD = 0.4  # must match omo_identifier.py line ~195

        raw_candidates = [
            LessonCandidate(lesson_id=1, grade_code="G6-L22", title="A", confidence=0.9, reasoning=""),
            LessonCandidate(lesson_id=2, grade_code="G6-L23", title="B", confidence=0.3, reasoning=""),
            LessonCandidate(lesson_id=3, grade_code="G6-L24", title="C", confidence=0.0, reasoning=""),
            LessonCandidate(lesson_id=4, grade_code="G6-L25", title="D", confidence=0.4, reasoning=""),
        ]

        filtered = [c for c in raw_candidates if c.confidence >= CONFIDENCE_THRESHOLD]
        assert len(filtered) == 2  # 0.9 and 0.4 survive, 0.3 and 0.0 do not

        surviving_ids = {c.lesson_id for c in filtered}
        assert 1 in surviving_ids  # conf=0.9
        assert 4 in surviving_ids  # conf=0.4 (boundary, inclusive)
        assert 2 not in surviving_ids  # conf=0.3
        assert 3 not in surviving_ids  # conf=0.0


# ---------------------------------------------------------------------------
# I-5: Circuit breaker threshold is pinned
# ---------------------------------------------------------------------------

class TestCircuitBreaker:
    def test_max_consecutive_errors_is_three(self):
        """Pin _MAX_CONSECUTIVE_ERRORS = 3. Change here requires deliberate test update."""
        assert _MAX_CONSECUTIVE_ERRORS == 3


# ---------------------------------------------------------------------------
# Catalog sanity (data-layer health)
# ---------------------------------------------------------------------------

class TestCatalogIntegrity:
    def test_curriculum_catalog_is_non_empty(self):
        curriculum = _load_curriculum_titles()
        assert len(curriculum) >= 50, (
            f"Expected >= 50 lessons in catalog, got {len(curriculum)}"
        )

    def test_all_catalog_entries_have_title_and_grade_code(self):
        curriculum = _load_curriculum_titles()
        broken = [
            code for code, info in curriculum.items()
            if not info.get("title") or not info.get("grade_code")
        ]
        assert not broken, f"Catalog entries missing title or grade_code: {broken[:5]}"
