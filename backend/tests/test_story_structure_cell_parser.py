"""Unit tests for story_structure_cell_parser."""

import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from app.services.story_structure_cell_parser import (
    cell_to_structure_fields,
    parse_checkbox_options,
)


def test_label_blanks_fill_blank():
    row = cell_to_structure_fields(
        "朝著【 性別平等 】的目標更邁進",
        "",
    )
    assert row["interactive_type"] == "fill_blank"
    assert row.get("blank_in_label") is True
    assert row.get("hint") == "性別平等"


def test_value_fill_blank():
    row = cell_to_structure_fields("標題", "答案在【 哺乳室 】")
    assert row["interactive_type"] == "fill_blank"
    assert row.get("hint") == "哺乳室"


def test_checkbox_circled_options():
    text = "□①錯誤選項 ②正確選項"
    parsed = parse_checkbox_options(text)
    assert parsed is not None
    assert len(parsed["options"]) == 2
    assert parsed["correct_options"] == [1]

    row = cell_to_structure_fields("問題", text)
    assert row["interactive_type"] == "checkbox"
    assert row["correct_options"] == [1]
