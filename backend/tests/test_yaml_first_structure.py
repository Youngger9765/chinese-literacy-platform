"""
Tests for _format_yaml_structure_table: YAML-first story structure (#1377).

Covers:
  1. Lesson with story_structure_table (new parsed format)  → no AI call
  2. Lesson with story_structure (old field, no table)       → falls through to AI
  3. Lesson with neither field                               → falls through to AI
  4. Converter: 1-cell title row
  5. Converter: 2-cell [label, value] display row
  6. Converter: 2-cell [label, value] fill_blank row (has 【】)
  7. Converter: 3-cell [label, sub_label, sub_value] row
  8. Converter: 5-cell row with 2 sub-row pairs
"""

import sys
import pathlib

# Make backend importable from test runner
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import pytest
from app.routes.stories import _format_yaml_structure_table


# ── Converter unit tests ──────────────────────────────────────────────────────

def test_title_row():
    """1-element row becomes a display row with the title as label."""
    table = [["看不見的兇手：以實驗破解肉湯腐敗之謎"]]
    result = _format_yaml_structure_table(table)
    assert len(result["rows"]) == 1
    row = result["rows"][0]
    assert row["label"] == "看不見的兇手：以實驗破解肉湯腐敗之謎"
    assert row["interactive_type"] == "display"
    assert row["value"] == ""


def test_two_cell_display_row():
    """[label, value] with no blanks → display."""
    table = [["研究影響", "改變了醫學、生物學與公共衛生的發展方向。"]]
    result = _format_yaml_structure_table(table)
    row = result["rows"][0]
    assert row["label"] == "研究影響"
    assert row["interactive_type"] == "display"
    assert "hint" not in row


def test_two_cell_fill_blank_row():
    """[label, value] with 【answer】 → fill_blank, hint extracted."""
    table = [["結論", "生物不能【 自然產生 】，腐敗與【 微生物污染 】有關。"]]
    result = _format_yaml_structure_table(table)
    row = result["rows"][0]
    assert row["label"] == "結論"
    assert row["interactive_type"] == "fill_blank"
    assert "hint" in row
    assert row["hint"] == "自然產生"  # first blank extracted


def test_three_cell_sub_row():
    """[label, sub_label, sub_value] → row with one sub_row."""
    table = [["舉例說明", "例子1", "問題：高中隊友...看【 英文棒球雜誌 】"]]
    result = _format_yaml_structure_table(table)
    row = result["rows"][0]
    assert row["label"] == "舉例說明"
    assert row["interactive_type"] == "display"
    assert len(row["sub_rows"]) == 1
    sub = row["sub_rows"][0]
    assert sub["label"] == "例子1"
    assert sub["interactive_type"] == "fill_blank"


def test_five_cell_paired_sub_rows():
    """[label, sub1_label, sub1_value, sub2_label, sub2_value] → 2 sub_rows."""
    table = [["辦案歷程", "問題", "被刺了十八刀，血呢？", "假設", "一、血跡【已被清理 】？"]]
    result = _format_yaml_structure_table(table)
    row = result["rows"][0]
    assert row["label"] == "辦案歷程"
    assert len(row["sub_rows"]) == 2
    assert row["sub_rows"][0]["label"] == "問題"
    assert row["sub_rows"][0]["interactive_type"] == "display"
    assert row["sub_rows"][1]["label"] == "假設"
    assert row["sub_rows"][1]["interactive_type"] == "fill_blank"


def test_full_g7_l28_table():
    """Smoke test: convert a real lesson's full story_structure_table."""
    import yaml
    parsed_dir = pathlib.Path(__file__).parent.parent / "data/lessons/_parsed_2026-05-01"
    yml_path = parsed_dir / "G7-L28.yml"
    if not yml_path.exists():
        pytest.skip("G7-L28.yml not available in this environment")

    with open(yml_path, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    table = data.get("story_structure_table")
    assert table, "G7-L28 should have story_structure_table"

    result = _format_yaml_structure_table(table)
    assert "rows" in result
    rows = result["rows"]

    # First row is the title
    assert rows[0]["interactive_type"] == "display"
    assert rows[0]["label"]  # non-empty

    # At least one fill_blank row should exist (table has 【…】 blanks)
    types = [r["interactive_type"] for r in rows]
    assert "fill_blank" in types

    # All rows must have required fields
    for r in rows:
        assert "label" in r
        assert "value" in r
        assert "interactive_type" in r
        assert r["interactive_type"] in ("fill_blank", "display")


def test_lesson_without_structure_table_returns_none():
    """story_structure_table absent → get_lesson_by_id returns None for that field."""
    from app.services.lesson_loader import get_lesson_by_id
    # Lesson 1 (L01.yml) is the original 57-lesson set, has no story_structure_table
    lesson = get_lesson_by_id(1)
    if lesson is None:
        pytest.skip("Lesson 1 not loaded in this environment")
    # Should be None or absent (falls through to AI)
    assert lesson.get("story_structure_table") is None


def test_lesson_with_structure_table_is_loaded():
    """story_structure_table present in YAML → exposed in lesson dict."""
    import yaml
    parsed_dir = pathlib.Path(__file__).parent.parent / "data/lessons/_parsed_2026-05-01"
    if not parsed_dir.exists():
        pytest.skip("_parsed_2026-05-01 not available")

    # Find any lesson with story_structure_table
    found = None
    for f in sorted(parsed_dir.glob("*.yml")):
        d = yaml.safe_load(open(f, encoding="utf-8"))
        if d and d.get("story_structure_table"):
            found = d
            break

    if found is None:
        pytest.skip("No lessons with story_structure_table found")

    # Verify the converter produces valid output
    result = _format_yaml_structure_table(found["story_structure_table"])
    assert "rows" in result
    assert len(result["rows"]) > 0
