"""
Spec: story-structure — YAML-first table + interaction_profile + cell parser.

Module spec: specs/modules/story-structure/INTENT.md
"""

import sys
from pathlib import Path

import yaml

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_SCRIPTS_DIR = _BACKEND_DIR.parent / "scripts"
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from app.routes.stories import _format_yaml_structure_table, _sanitize_structure_for_client
from app.services.story_structure_cell_parser import (
    cell_to_structure_fields,
    fill_blanks_in_text,
    parse_checkbox_options,
)
from story_structure_qa_lib import verify_interaction_profile_contract


class TestCellParser:
    def test_label_blanks_fill(self):
        text = fill_blanks_in_text("朝著__的目標", [{"answer": "性別平等"}])
        assert "【 性別平等 】" in text

    def test_checkbox_distractor_markers(self):
        raw = "□①錯誤選項 ②正確選項 □③另一錯誤"
        parsed = parse_checkbox_options(raw)
        assert parsed is not None
        assert len(parsed["options"]) == 3
        assert parsed["correct_options"] == [1]

    def test_blank_in_label_row(self):
        row = cell_to_structure_fields(
            "為哺乳期運動員設置【 哺乳室 】",
            "讓母親也可以是運動員",
        )
        assert row["interactive_type"] == "fill_blank"
        assert row.get("blank_in_label") is True


class TestRepresentativeLessons:
    def test_g7_l6_fill_blank_not_display_only(self):
        yml = _BACKEND_DIR / "data/lessons/_parsed_2026-05-01/G7-L6.yml"
        if not yml.exists():
            import pytest

            pytest.skip("G7-L6.yml missing")
        data = yaml.safe_load(yml.read_text(encoding="utf-8"))
        client = _sanitize_structure_for_client(
            _format_yaml_structure_table(data["story_structure_table"])
        )
        assert verify_interaction_profile_contract(client) == []
        assert client["interaction_profile"]["mode"] == "fill_blank"
        assert client["interaction_profile"]["fill_blank_count"] >= 4

    def test_g8_l13_checkbox_rows(self):
        yml = _BACKEND_DIR / "data/lessons/_parsed_2026-05-01/G8-L13.yml"
        if not yml.exists():
            import pytest

            pytest.skip("G8-L13.yml missing")
        data = yaml.safe_load(yml.read_text(encoding="utf-8"))
        client = _sanitize_structure_for_client(
            _format_yaml_structure_table(data["story_structure_table"])
        )
        assert client["interaction_profile"]["mode"] == "checkbox"
        assert client["interaction_profile"]["checkbox_count"] >= 3
