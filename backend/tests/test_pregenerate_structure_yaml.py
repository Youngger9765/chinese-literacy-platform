"""
Tests for pregenerate_structure_yaml.py logic.

Tests cover:
1. needs_generation() — skip logic for existing data
2. get_story_text() — text extraction from various lesson formats
3. write_yaml_safely() — idempotent writes, correct fields
4. source flag written correctly
5. Route: story_structure_rows takes priority over story_structure_table
6. Route: story_structure_rows returned directly without conversion
"""

import pathlib
import sys
import tempfile

import pytest
import yaml

# Allow importing from scripts/
BACKEND_DIR = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from scripts.pregenerate_structure_yaml import (
    SOURCE_TAG,
    get_story_text,
    needs_generation,
    write_yaml_safely,
)


# ---------------------------------------------------------------------------
# needs_generation()
# ---------------------------------------------------------------------------

class TestNeedsGeneration:
    def test_no_data_fields(self):
        """Lesson with no structure fields should need generation."""
        data = {"title": "Test Lesson", "story_text": "Some text"}
        assert needs_generation(data) is True

    def test_has_story_structure_table(self):
        """Lesson with docx-parsed table → skip."""
        data = {
            "title": "Test",
            "story_structure_table": [["label", "value"]],
        }
        assert needs_generation(data) is False

    def test_has_story_structure_rows(self):
        """Lesson with AI-generated rows → skip (unless --force)."""
        data = {
            "title": "Test",
            "story_structure_rows": [{"label": "主題", "value": "test", "interactive_type": "fill_blank"}],
        }
        assert needs_generation(data) is False

    def test_empty_story_structure_table_none(self):
        """None value for table → needs generation."""
        data = {"title": "Test", "story_structure_table": None}
        assert needs_generation(data) is True

    def test_empty_list_story_structure_table(self):
        """Empty list is falsy → treated as missing → needs generation."""
        data = {"title": "Test", "story_structure_table": []}
        # bool([]) == False → treated as no real data → needs generation
        assert needs_generation(data) is True


class TestNeedsGenerationEdgeCases:
    def test_empty_list_is_falsy_returns_true(self):
        """Empty list means no real data → should generate."""
        data = {"title": "Test", "story_structure_table": []}
        # bool([]) = False → treated as missing → needs_generation = True
        assert needs_generation(data) is True

    def test_empty_rows_is_falsy_returns_true(self):
        data = {"title": "Test", "story_structure_rows": []}
        assert needs_generation(data) is True


# ---------------------------------------------------------------------------
# get_story_text()
# ---------------------------------------------------------------------------

class TestGetStoryText:
    def test_story_text_field(self):
        data = {"story_text": "Hello world"}
        assert get_story_text(data) == "Hello world"

    def test_full_text_field(self):
        data = {"full_text": "Full text content"}
        assert get_story_text(data) == "Full text content"

    def test_paragraphs_joined(self):
        data = {"paragraphs": ["Para 1", "Para 2", "Para 3"]}
        assert get_story_text(data) == "Para 1\nPara 2\nPara 3"

    def test_empty_data(self):
        data = {}
        assert get_story_text(data) == ""

    def test_story_text_takes_priority_over_paragraphs(self):
        data = {"story_text": "Story", "paragraphs": ["P1", "P2"]}
        assert get_story_text(data) == "Story"


# ---------------------------------------------------------------------------
# write_yaml_safely() — idempotency and correctness
# ---------------------------------------------------------------------------

class TestWriteYamlSafely:
    def test_writes_new_fields(self, tmp_path):
        """Should add story_structure_rows and source tag to existing YAML."""
        lesson_file = tmp_path / "test_lesson.yml"
        original = {
            "title": "測試課文",
            "genre": "記敘文",
            "story_text": "從前有個人。",
        }
        with open(lesson_file, "w") as f:
            yaml.dump(original, f, allow_unicode=True)

        rows = [
            {"label": "主題", "value": "友情", "interactive_type": "fill_blank", "hint": "核心是什麼？"},
            {"label": "結論", "value": "要珍惜朋友", "interactive_type": "fill_blank"},
        ]
        write_yaml_safely(lesson_file, {"story_structure_rows": rows, "story_structure_table_source": SOURCE_TAG})

        with open(lesson_file) as f:
            result = yaml.safe_load(f)

        assert result["story_structure_rows"] == rows
        assert "ai-generated-" in result["story_structure_table_source"]
        assert result["title"] == "測試課文"  # original field preserved

    def test_does_not_overwrite_story_structure_table(self, tmp_path):
        """Existing story_structure_table must not be touched."""
        lesson_file = tmp_path / "test_lesson.yml"
        original = {
            "title": "Protected Lesson",
            "story_structure_table": [["label", "ground truth value"]],
            "story_text": "Content here.",
        }
        with open(lesson_file, "w") as f:
            yaml.dump(original, f, allow_unicode=True)

        new_rows = [{"label": "主題", "value": "AI generated", "interactive_type": "fill_blank"}]
        write_yaml_safely(lesson_file, {"story_structure_rows": new_rows, "story_structure_table_source": SOURCE_TAG})

        with open(lesson_file) as f:
            result = yaml.safe_load(f)

        # Original table must be unchanged
        assert result["story_structure_table"] == [["label", "ground truth value"]]
        # New rows added
        assert result["story_structure_rows"] == new_rows

    def test_idempotent_second_write(self, tmp_path):
        """Writing twice with same data produces same result."""
        lesson_file = tmp_path / "lesson.yml"
        original = {"title": "Test", "story_text": "Content"}
        with open(lesson_file, "w") as f:
            yaml.dump(original, f, allow_unicode=True)

        rows = [{"label": "主題", "value": "勇敢", "interactive_type": "fill_blank"}]
        payload = {"story_structure_rows": rows, "story_structure_table_source": SOURCE_TAG}

        write_yaml_safely(lesson_file, payload)
        write_yaml_safely(lesson_file, payload)  # second write

        with open(lesson_file) as f:
            result = yaml.safe_load(f)

        assert result["story_structure_rows"] == rows

    def test_source_tag_format(self, tmp_path):
        """Source tag should contain 'ai-generated-' prefix."""
        lesson_file = tmp_path / "lesson.yml"
        with open(lesson_file, "w") as f:
            yaml.dump({"title": "Test", "story_text": "x"}, f)

        rows = [{"label": "l", "value": "v", "interactive_type": "display"}]
        write_yaml_safely(lesson_file, {"story_structure_rows": rows, "story_structure_table_source": SOURCE_TAG})

        with open(lesson_file) as f:
            result = yaml.safe_load(f)

        assert result["story_structure_table_source"].startswith("ai-generated-")


# ---------------------------------------------------------------------------
# Route priority: story_structure_rows > story_structure_table
# (Unit tests for the route logic without FastAPI test client)
# ---------------------------------------------------------------------------

class TestRoutePriorityLogic:
    """Test the priority logic that the route implements."""

    def _simulate_route_priority(self, story: dict) -> dict | None:
        """Simulate what the route does for YAML-first selection."""
        yaml_rows = story.get("story_structure_rows")
        if yaml_rows and isinstance(yaml_rows, list):
            return {"rows": yaml_rows, "source": "rows"}

        yaml_table = story.get("story_structure_table")
        if yaml_table:
            return {"rows": [], "source": "table"}  # simplified

        return None

    def test_rows_takes_priority_over_table(self):
        story = {
            "story_structure_rows": [{"label": "A", "value": "B", "interactive_type": "fill_blank"}],
            "story_structure_table": [["label", "value"]],
        }
        result = self._simulate_route_priority(story)
        assert result is not None
        assert result["source"] == "rows"

    def test_table_used_when_no_rows(self):
        story = {
            "story_structure_table": [["label", "value"]],
        }
        result = self._simulate_route_priority(story)
        assert result is not None
        assert result["source"] == "table"

    def test_none_returned_when_neither(self):
        story = {"title": "No structure"}
        result = self._simulate_route_priority(story)
        assert result is None

    def test_empty_rows_list_falls_through_to_table(self):
        story = {
            "story_structure_rows": [],  # empty = falsy
            "story_structure_table": [["label", "value"]],
        }
        result = self._simulate_route_priority(story)
        assert result is not None
        assert result["source"] == "table"

    def test_rows_returned_directly_without_conversion(self):
        """story_structure_rows should be returned as-is (no list-of-lists conversion)."""
        expected_rows = [
            {
                "label": "主題",
                "value": "勇氣",
                "interactive_type": "fill_blank",
                "hint": "課文核心",
            },
            {
                "label": "重點",
                "value": "",
                "interactive_type": "checkbox",
                "options": ["A", "B", "C"],
                "correct_options": [0],
            },
        ]
        story = {"story_structure_rows": expected_rows}
        result = self._simulate_route_priority(story)
        assert result["rows"] == expected_rows
