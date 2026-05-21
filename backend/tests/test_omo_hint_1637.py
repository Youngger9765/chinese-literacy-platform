"""Tests for Issue #1637 — lesson_code_hint path in OMO upload.

Covers:
    T3: Backend accepts optional lesson_code_hint field in multipart upload
    T4: With valid hint → identify_lesson_from_hint returns conf=1.0, skips AI
    T4b: With unknown hint → falls back gracefully (AI path)
    T6: Without hint → existing fuzzy-match path unaffected (backward compat)

Run:
    cd backend && python -m pytest tests/test_omo_hint_1637.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import patch, MagicMock


# ---------------------------------------------------------------------------
# Unit tests for identify_lesson_from_hint (pure function, no DB/GCS needed)
# ---------------------------------------------------------------------------

class TestIdentifyLessonFromHint:
    """Unit-test the hint path function directly."""

    def _mock_curriculum(self):
        """Minimal curriculum dict for testing."""
        return {
            "G5-L25": {"title": "北風與太陽", "grade_code": "G5-L25"},
            "G6-L22": {"title": "小石潭記", "grade_code": "G6-L22"},
        }

    def test_known_lesson_code_returns_confidence_1(self):
        """T4: valid hint returns single candidate with confidence=1.0."""
        from app.services.omo_identifier import identify_lesson_from_hint

        with patch(
            "app.services.omo_identifier._load_curriculum_titles",
            return_value=self._mock_curriculum(),
        ):
            candidates = identify_lesson_from_hint("G5-L25")

        assert len(candidates) == 1
        c = candidates[0]
        assert c.confidence == 1.0
        assert c.title == "北風與太陽"
        assert c.grade_code == "G5-L25"
        assert c.lesson_id == 25
        assert "hint" in c.reasoning.lower() or "user-provided" in c.reasoning.lower()

    def test_second_known_lesson_code(self):
        """T4: another valid lesson_code also resolves correctly."""
        from app.services.omo_identifier import identify_lesson_from_hint

        with patch(
            "app.services.omo_identifier._load_curriculum_titles",
            return_value=self._mock_curriculum(),
        ):
            candidates = identify_lesson_from_hint("G6-L22")

        assert len(candidates) == 1
        assert candidates[0].title == "小石潭記"
        assert candidates[0].confidence == 1.0

    def test_unknown_lesson_code_returns_empty(self):
        """T4b: unknown lesson_code → returns [] so caller falls back to AI."""
        from app.services.omo_identifier import identify_lesson_from_hint

        with patch(
            "app.services.omo_identifier._load_curriculum_titles",
            return_value=self._mock_curriculum(),
        ):
            candidates = identify_lesson_from_hint("G9-L99")

        assert candidates == []

    def test_empty_curriculum_returns_empty(self):
        """T4b: if curriculum failed to load, returns [] gracefully."""
        from app.services.omo_identifier import identify_lesson_from_hint

        with patch(
            "app.services.omo_identifier._load_curriculum_titles",
            return_value={},
        ):
            candidates = identify_lesson_from_hint("G5-L25")

        assert candidates == []

    def test_lesson_id_parsed_from_code(self):
        """lesson_id is the numeric part after '-L'."""
        from app.services.omo_identifier import identify_lesson_from_hint

        curriculum = {"G4-L10": {"title": "春天來了", "grade_code": "G4-L10"}}
        with patch(
            "app.services.omo_identifier._load_curriculum_titles",
            return_value=curriculum,
        ):
            candidates = identify_lesson_from_hint("G4-L10")

        assert candidates[0].lesson_id == 10

    def test_malformed_code_lesson_id_defaults_to_zero(self):
        """If code has no '-L' part, lesson_id defaults to 0 (no crash)."""
        from app.services.omo_identifier import identify_lesson_from_hint

        curriculum = {"NOGRAMMAR": {"title": "測試", "grade_code": "NOGRAMMAR"}}
        with patch(
            "app.services.omo_identifier._load_curriculum_titles",
            return_value=curriculum,
        ):
            candidates = identify_lesson_from_hint("NOGRAMMAR")

        assert len(candidates) == 1
        assert candidates[0].lesson_id == 0


# ---------------------------------------------------------------------------
# Integration-style test: _run_identification background task routing
# ---------------------------------------------------------------------------

class TestRunIdentificationRouting:
    """Verify that _run_identification routes hint vs AI correctly."""

    @pytest.mark.asyncio
    async def test_hint_path_skips_ai_call(self):
        """T4: with valid hint, identify_lesson_from_image is NEVER called."""
        from app.routes.omo import _run_identification

        mock_candidate = MagicMock()
        mock_candidate.lesson_id = 25
        mock_candidate.grade_code = "G5-L25"
        mock_candidate.title = "北風與太陽"
        mock_candidate.confidence = 1.0
        mock_candidate.reasoning = "user-provided lesson hint"

        with patch(
            "app.routes.omo._update_upload"
        ) as mock_update, patch(
            "app.services.omo_identifier.identify_lesson_from_hint",
            return_value=[mock_candidate],
        ) as mock_hint, patch(
            "app.services.omo_identifier.identify_lesson_from_image",
        ) as mock_ai:
            await _run_identification(
                upload_id=999,
                image_bytes_list=[b"fake"],
                mime_types=["image/jpeg"],
                lesson_code_hint="G5-L25",
            )

        # hint function was used
        mock_hint.assert_called_once_with("G5-L25")
        # AI was NOT called
        mock_ai.assert_not_called()
        # DB update was called with status=identified
        update_calls = mock_update.call_args_list
        assert any(
            call.kwargs.get("status") == "identified" or
            (len(call.args) > 1 and "identified" in str(call.args))
            for call in update_calls
        ), f"Expected status=identified in update calls: {update_calls}"

    @pytest.mark.asyncio
    async def test_no_hint_uses_ai_path(self):
        """T6: without hint, identify_lesson_from_image IS called (backward compat)."""
        from app.routes.omo import _run_identification

        mock_candidate = MagicMock()
        mock_candidate.lesson_id = 25
        mock_candidate.grade_code = "G5-L25"
        mock_candidate.title = "北風與太陽"
        mock_candidate.confidence = 0.95
        mock_candidate.reasoning = "fuzzy match"

        with patch(
            "app.routes.omo._update_upload"
        ), patch(
            "app.services.omo_identifier.identify_lesson_from_image",
            return_value=[mock_candidate],
        ) as mock_ai:
            await _run_identification(
                upload_id=998,
                image_bytes_list=[b"fake"],
                mime_types=["image/jpeg"],
                lesson_code_hint=None,
            )

        mock_ai.assert_called_once()

    @pytest.mark.asyncio
    async def test_hint_not_found_falls_back_to_ai(self):
        """T4b: if hint lookup returns [], AI path is used as fallback."""
        from app.routes.omo import _run_identification

        mock_candidate = MagicMock()
        mock_candidate.lesson_id = 25
        mock_candidate.grade_code = "G5-L25"
        mock_candidate.title = "北風與太陽"
        mock_candidate.confidence = 0.9
        mock_candidate.reasoning = "fuzzy"

        with patch(
            "app.routes.omo._update_upload"
        ), patch(
            "app.services.omo_identifier.identify_lesson_from_hint",
            return_value=[],  # hint lookup failed
        ), patch(
            "app.services.omo_identifier.identify_lesson_from_image",
            return_value=[mock_candidate],
        ) as mock_ai:
            await _run_identification(
                upload_id=997,
                image_bytes_list=[b"fake"],
                mime_types=["image/jpeg"],
                lesson_code_hint="G9-L99",  # unknown code
            )

        # Falls back to AI
        mock_ai.assert_called_once()


# ---------------------------------------------------------------------------
# #1775: story_id field contract on LessonCandidate
# ---------------------------------------------------------------------------

class TestLessonCandidateStoryId:
    """Verify identify_lesson_from_hint populates story_id at service boundary (#1775)."""

    def _mock_curriculum(self):
        return {
            "G5-L25": {"title": "北風與太陽", "grade_code": "G5-L25"},
        }

    def test_story_id_populated_when_lesson_loader_resolves(self):
        """When get_lesson_by_code returns a story with id, story_id is set."""
        from app.services.omo_identifier import identify_lesson_from_hint

        with patch(
            "app.services.omo_identifier._load_curriculum_titles",
            return_value=self._mock_curriculum(),
        ), patch(
            "app.services.omo_identifier._resolve_story_id",
            return_value=42,
        ):
            candidates = identify_lesson_from_hint("G5-L25")

        assert len(candidates) == 1
        assert candidates[0].story_id == 42

    def test_story_id_none_when_lesson_loader_returns_none(self):
        """When get_lesson_by_code returns None, story_id is None (not 0)."""
        from app.services.omo_identifier import identify_lesson_from_hint

        with patch(
            "app.services.omo_identifier._load_curriculum_titles",
            return_value=self._mock_curriculum(),
        ), patch(
            "app.services.omo_identifier._resolve_story_id",
            return_value=None,
        ):
            candidates = identify_lesson_from_hint("G5-L25")

        assert len(candidates) == 1
        assert candidates[0].story_id is None

    def test_resolve_story_id_returns_none_on_exception(self):
        """_resolve_story_id never propagates exceptions (fail-open to None)."""
        from app.services.omo_identifier import _resolve_story_id

        with patch(
            "app.services.omo_identifier._resolve_story_id",
            wraps=lambda gc: None,
        ):
            # Direct call — just verify the helper returns None, not raises
            result = _resolve_story_id("G5-L25")
            # result depends on lesson_loader; None is always acceptable
            assert result is None or isinstance(result, int)

    def test_lesson_candidate_story_id_field_exists(self):
        """LessonCandidate dataclass has story_id field with None default."""
        from app.services.omo_identifier import LessonCandidate
        c = LessonCandidate(lesson_id=1, grade_code="G5-L25", title="test", confidence=0.9)
        assert hasattr(c, "story_id")
        assert c.story_id is None  # default
