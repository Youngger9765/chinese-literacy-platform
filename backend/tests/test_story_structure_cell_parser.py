"""Unit tests for story_structure_cell_parser."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.story_structure_cell_parser import (
    cell_to_structure_fields,
    fill_blanks_in_text,
    parse_checkbox_options,
)


def test_parse_checkbox_g8_style():
    raw = "□①南島語族可能最早是從菲律賓出發的 ②南島語族可能最早是從臺灣出發的 □③南島語族可能最早是從印尼出發的"
    parsed = parse_checkbox_options(raw)
    assert parsed is not None
    assert parsed["correct_options"] == [1]


def test_cell_label_blank():
    row = cell_to_structure_fields("設置【 哺乳室 】", "目的說明")
    assert row["interactive_type"] == "fill_blank"
    assert row.get("blank_in_label") is True


def test_fill_blanks_template():
    out = fill_blanks_in_text("朝著__邁進", [{"answer": "平等"}])
    assert "【 平等 】" in out
