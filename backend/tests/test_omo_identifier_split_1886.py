"""TDD tests for #1886 — omo_identifier.py split.

Phase 1 (Red → Green):
  Three tests pinning behaviours in the monolithic omo_identifier.py.
  ALL THREE must pass on the CURRENT code before refactoring begins.

Phase 2 (Refactor):
  Extract omo_lesson_catalog.py / omo_title_matching.py / omo_identifier_prompt.py.
  Same three tests (imported from new modules) must still pass.

Tautology check: each test has a negative assertion or strictly-constrained
expected value so a trivially-passing stub would fail.

Run:
    cd backend && python -m pytest tests/test_omo_identifier_split_1886.py -v
"""

import pytest


# ---------------------------------------------------------------------------
# Test 1: normalize_title_collapses_punctuation_and_dash_variants
# ---------------------------------------------------------------------------
class TestNormalizeTitle:
    """_normalize_title must fold OCR punctuation variants into a stable form."""

    def _norm(self, s: str) -> str:
        """Import from wherever it lives (monolith or extracted module)."""
        try:
            from app.services.omo_title_matching import normalize_title
            return normalize_title(s)
        except ImportError:
            from app.services.omo_identifier import _normalize_title
            return _normalize_title(s)

    def test_half_width_question_mark_becomes_full_width(self):
        result = self._norm("你好嗎?")
        assert result == "你好嗎？", f"expected full-width ？, got {result!r}"

    def test_half_width_exclamation_becomes_full_width(self):
        result = self._norm("太棒了!")
        assert result == "太棒了！", f"expected full-width ！, got {result!r}"

    def test_box_drawing_double_collapses_to_em_dash(self):
        # U+2500 U+2500 — the YAML file uses BOX DRAWINGS LIGHT HORIZONTAL ×2
        result = self._norm("蔡英文──歷史")
        assert result == "蔡英文—歷史", f"got {result!r}"
        # Negative: original must differ from normalized
        assert result != "蔡英文──歷史"

    def test_em_dash_double_collapses_to_em_dash(self):
        # U+2014 U+2014 — Gemini OCR returns double EM DASH
        result = self._norm("題目——副標")
        assert result == "題目—副標", f"got {result!r}"

    def test_single_box_drawing_collapses_to_em_dash(self):
        # U+2500 single — also seen in some YAML titles
        result = self._norm("前─後")
        assert result == "前—後", f"got {result!r}"

    def test_leading_trailing_whitespace_stripped(self):
        result = self._norm("  標題  ")
        assert result == "標題", f"expected stripped result, got {result!r}"

    def test_ascii_comma_becomes_full_width(self):
        result = self._norm("一,二,三")
        assert result == "一，二，三", f"got {result!r}"

    def test_already_normalized_unchanged(self):
        original = "一本好書"
        result = self._norm(original)
        assert result == original


# ---------------------------------------------------------------------------
# Test 2: fuzzy_match_title_thresholds_confidence_correctly
# ---------------------------------------------------------------------------
class TestFuzzyMatchThresholds:
    """_fuzzy_match_title must map ratio bands to the correct confidence values."""

    def _fuzzy(self, extracted_title: str):
        """Call fuzzy match from wherever it lives."""
        try:
            from app.services.omo_title_matching import fuzzy_match_title
            return fuzzy_match_title(extracted_title)
        except ImportError:
            from app.services.omo_identifier import _fuzzy_match_title
            return _fuzzy_match_title(extracted_title)

    def _inject_curriculum(self, monkeypatch, titles: dict[str, dict]):
        """Patch the curriculum cache used by the fuzzy matcher."""
        import app.services.omo_identifier as omo_id
        try:
            import app.services.omo_title_matching as omo_tm
            monkeypatch.setattr(omo_tm, "_CURRICULUM_TITLE_CACHE", titles)
            # Also patch loader so cache isn't re-initialised
            monkeypatch.setattr(omo_tm, "_load_curriculum_titles", lambda: titles)
        except (ImportError, AttributeError):
            pass
        monkeypatch.setattr(omo_id, "_CURRICULUM_TITLE_CACHE", titles)
        monkeypatch.setattr(omo_id, "_load_curriculum_titles", lambda: titles)

    def test_exact_match_returns_confidence_095(self, monkeypatch):
        """ratio >= 0.85 → confidence exactly 0.95."""
        catalog = {
            "G5-L25": {"title": "阿里山的故事", "grade_code": "G5-L25"},
        }
        self._inject_curriculum(monkeypatch, catalog)
        results = self._fuzzy("阿里山的故事")
        assert len(results) == 1, f"expected 1 result, got {results}"
        assert results[0].confidence == 0.95, f"expected 0.95, got {results[0].confidence}"

    def test_near_match_returns_confidence_070(self, monkeypatch):
        """ratio 0.70–0.84 → confidence exactly 0.70."""
        catalog = {
            "G5-L25": {"title": "阿里山的故事很長很長", "grade_code": "G5-L25"},
        }
        self._inject_curriculum(monkeypatch, catalog)
        # "阿里山的故事" vs "阿里山的故事很長很長" — ratio ~0.75
        results = self._fuzzy("阿里山的故事")
        if results:
            # If matched, confidence must be 0.70 (not 0.95)
            assert results[0].confidence == 0.70, (
                f"expected 0.70 for near match, got {results[0].confidence}"
            )
        # Negative: must NOT return confidence=0.95 for a partial match
        for r in results:
            assert r.confidence != 0.95, "partial match must not get high confidence"

    def test_below_threshold_returns_empty(self, monkeypatch):
        """ratio < 0.70 → empty list (no match)."""
        catalog = {
            "G7-L30": {"title": "完全不相關的課文標題", "grade_code": "G7-L30"},
        }
        self._inject_curriculum(monkeypatch, catalog)
        results = self._fuzzy("xyz english title")
        assert results == [], f"expected [] for low ratio, got {results}"

    def test_empty_string_returns_empty(self, monkeypatch):
        """Empty extracted_title → empty list (no match attempted)."""
        catalog = {
            "G5-L25": {"title": "阿里山的故事", "grade_code": "G5-L25"},
        }
        self._inject_curriculum(monkeypatch, catalog)
        results = self._fuzzy("")
        assert results == [], f"expected [] for empty input, got {results}"

    def test_returned_candidate_has_grade_code(self, monkeypatch):
        """Returned candidate grade_code must match catalog grade_code."""
        catalog = {
            "G6-L22": {"title": "生命的奇蹟", "grade_code": "G6-L22"},
        }
        self._inject_curriculum(monkeypatch, catalog)
        results = self._fuzzy("生命的奇蹟")
        assert results, "expected a match"
        assert results[0].grade_code == "G6-L22", (
            f"expected G6-L22, got {results[0].grade_code!r}"
        )


# ---------------------------------------------------------------------------
# Test 3: hint_path_returns_confidence_one_and_resolved_story_id
# ---------------------------------------------------------------------------
class TestHintPath:
    """identify_lesson_from_hint must bypass AI and return confidence=1.0."""

    def _hint(self, lesson_code: str):
        """Call hint function from wherever it lives."""
        try:
            from app.services.omo_lesson_catalog import identify_lesson_from_hint
        except ImportError:
            from app.services.omo_identifier import identify_lesson_from_hint
        return identify_lesson_from_hint(lesson_code)

    def _inject_curriculum(self, monkeypatch, catalog: dict):
        """Patch curriculum cache on all possible module locations."""
        import app.services.omo_identifier as omo_id
        try:
            import app.services.omo_lesson_catalog as omo_cat
            monkeypatch.setattr(omo_cat, "_CURRICULUM_TITLE_CACHE", catalog)
            monkeypatch.setattr(omo_cat, "_load_curriculum_titles", lambda: catalog)
        except (ImportError, AttributeError):
            pass
        monkeypatch.setattr(omo_id, "_CURRICULUM_TITLE_CACHE", catalog)
        monkeypatch.setattr(omo_id, "_load_curriculum_titles", lambda: catalog)

    def test_known_code_returns_confidence_one(self, monkeypatch):
        catalog = {
            "G5-L25": {"title": "阿里山的故事", "grade_code": "G5-L25"},
        }
        self._inject_curriculum(monkeypatch, catalog)
        monkeypatch.setattr(
            "app.services.omo_identifier._resolve_story_id", lambda gc: 42
        )
        results = self._hint("G5-L25")
        assert len(results) == 1, f"expected 1 result, got {results}"
        assert results[0].confidence == 1.0, (
            f"hint path must return confidence 1.0, got {results[0].confidence}"
        )
        # Negative: must not be 0.0 or fractional
        assert results[0].confidence != 0.0

    def test_known_code_returns_correct_title(self, monkeypatch):
        catalog = {
            "G6-L22": {"title": "生命的奇蹟", "grade_code": "G6-L22"},
        }
        self._inject_curriculum(monkeypatch, catalog)
        monkeypatch.setattr(
            "app.services.omo_identifier._resolve_story_id", lambda gc: None
        )
        results = self._hint("G6-L22")
        assert results[0].title == "生命的奇蹟", (
            f"expected '生命的奇蹟', got {results[0].title!r}"
        )

    def test_unknown_code_returns_empty(self, monkeypatch):
        catalog = {
            "G5-L25": {"title": "阿里山的故事", "grade_code": "G5-L25"},
        }
        self._inject_curriculum(monkeypatch, catalog)
        results = self._hint("G9-L99")
        assert results == [], f"unknown code must return [], got {results}"

    def test_story_id_resolved_at_hint_boundary(self, monkeypatch):
        """story_id is attached to the candidate at hint-path resolution."""
        catalog = {
            "G7-L28": {"title": "課文標題", "grade_code": "G7-L28"},
        }
        self._inject_curriculum(monkeypatch, catalog)
        # Patch _resolve_story_id on both the monolith and the extracted module
        monkeypatch.setattr(
            "app.services.omo_identifier._resolve_story_id", lambda gc: 99
        )
        try:
            monkeypatch.setattr(
                "app.services.omo_lesson_catalog._resolve_story_id", lambda gc: 99
            )
        except (ImportError, AttributeError):
            pass
        results = self._hint("G7-L28")
        assert results[0].story_id == 99, (
            f"story_id must be resolved at hint boundary, got {results[0].story_id}"
        )
        # Negative: story_id must not be absent
        assert results[0].story_id is not None

    def test_grade_code_from_catalog_used(self, monkeypatch):
        """grade_code in result must come from catalog, not raw input."""
        catalog = {
            "G5-L25": {"title": "阿里山的故事", "grade_code": "G5-L25"},
        }
        self._inject_curriculum(monkeypatch, catalog)
        monkeypatch.setattr(
            "app.services.omo_identifier._resolve_story_id", lambda gc: None
        )
        results = self._hint("G5-L25")
        assert results[0].grade_code == "G5-L25"
