"""Tests for story slug normalization (Issue #985)."""

import pytest
from unittest.mock import patch


class TestNormalizeStorySlug:
    """Test normalize_story_slug with various input formats."""

    def test_plain_number(self):
        from app.utils.slug import normalize_story_slug

        assert normalize_story_slug("6") == "6"
        assert normalize_story_slug("1") == "1"
        assert normalize_story_slug("42") == "42"

    def test_zero_padded_number(self):
        from app.utils.slug import normalize_story_slug

        assert normalize_story_slug("06") == "6"
        assert normalize_story_slug("01") == "1"

    def test_l_prefix_uppercase(self):
        from app.utils.slug import normalize_story_slug

        assert normalize_story_slug("L06") == "6"
        assert normalize_story_slug("L6") == "6"
        assert normalize_story_slug("L12") == "12"

    def test_l_prefix_lowercase(self):
        from app.utils.slug import normalize_story_slug

        assert normalize_story_slug("l06") == "6"
        assert normalize_story_slug("l6") == "6"

    def test_chinese_title_lookup(self):
        from app.utils.slug import normalize_story_slug

        mock_lessons = [
            {"title": "第一百碗麵", "lesson_number": 6, "id": 6},
            {"title": "贏得喝采的輸家", "lesson_number": 10, "id": 10},
        ]
        # Reset cached title map
        import app.utils.slug as slug_mod
        slug_mod._title_map = None

        with patch("app.utils.slug._get_title_map", return_value={
            "第一百碗麵": 6,
            "贏得喝采的輸家": 10,
        }):
            assert normalize_story_slug("第一百碗麵") == "6"
            assert normalize_story_slug("贏得喝采的輸家") == "10"

    def test_unknown_slug_passthrough(self):
        from app.utils.slug import normalize_story_slug

        # Unknown non-numeric slugs pass through unchanged
        assert normalize_story_slug("unknown-slug") == "unknown-slug"

    def test_empty_string(self):
        from app.utils.slug import normalize_story_slug

        assert normalize_story_slug("") == ""

    def test_idempotent(self):
        """Normalizing an already-normalized slug returns the same value."""
        from app.utils.slug import normalize_story_slug

        assert normalize_story_slug("6") == "6"
        assert normalize_story_slug(normalize_story_slug("L06")) == "6"
