"""Contract tests for story_structure_qa_lib (L3 interaction_profile gates)."""

import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent / "scripts"))

import yaml
import pytest

from app.routes.stories import _format_yaml_structure_table, _sanitize_structure_for_client
from story_structure_qa_lib import (
    LessonTier,
    classify_lesson,
    count_checkbox_cells_in_table,
    gate_l1_pass,
    gate_l3_mode_expectation,
    verify_interaction_profile_contract,
)


def test_profile_contract_mixed():
    structure = {
        "layout": "cards",
        "rows": [
            {"label": "主題", "value": "x", "interactive_type": "fill_blank"},
            {"label": "事實", "value": "y", "interactive_type": "checkbox", "options": ["a"]},
        ],
    }
    client = _sanitize_structure_for_client(structure)
    assert verify_interaction_profile_contract(client) == []
    assert client["interaction_profile"]["mode"] == "mixed"


def test_profile_contract_g6_l22_yaml():
    yml = pathlib.Path(__file__).parent.parent / "data/lessons/_parsed_2026-05-01/G6-L22.yml"
    if not yml.exists():
        pytest.skip("G6-L22.yml missing")
    data = yaml.safe_load(yml.read_text(encoding="utf-8"))
    client = _sanitize_structure_for_client(_format_yaml_structure_table(data["story_structure_table"]))
    assert verify_interaction_profile_contract(client) == []
    assert client["interaction_profile"]["mode"] == "fill_blank"
    assert client["interaction_profile"]["template_kind"] == "psr"


def test_profile_contract_g7_l6_label_blanks():
    yml = pathlib.Path(__file__).parent.parent / "data/lessons/L31.yml"
    if not yml.exists():
        pytest.skip("L31.yml missing")
    data = yaml.safe_load(yml.read_text(encoding="utf-8"))
    client = _sanitize_structure_for_client(_format_yaml_structure_table(data["story_structure_table"]))
    assert verify_interaction_profile_contract(client) == []
    profile = client["interaction_profile"]
    assert profile["mode"] == "fill_blank"
    assert profile["fill_blank_count"] >= 1
    assert any(r.get("blank_in_label") for r in client["rows"])


def test_profile_contract_g8_l13_checkbox():
    yml = pathlib.Path(__file__).parent.parent / "data/lessons/_parsed_2026-05-01/G8-L13.yml"
    if not yml.exists():
        pytest.skip("G8-L13.yml missing")
    data = yaml.safe_load(yml.read_text(encoding="utf-8"))
    table = data["story_structure_table"]
    client = _sanitize_structure_for_client(_format_yaml_structure_table(table))
    assert verify_interaction_profile_contract(client) == []
    assert client["interaction_profile"]["checkbox_count"] >= 1
    assert count_checkbox_cells_in_table(table) >= 1


def test_gate_l1_label_family_warn_only():
    ok, issues = gate_l1_pass({
        "available": True,
        "row_recall": 1.0,
        "blank_recall": 1.0,
        "nesting_preserved": True,
        "label_family_correct": False,
    })
    assert ok is True
    assert any("WARN" in i for i in issues)


def test_g7_l6_classified_docx_keypoints():
    tier = classify_lesson(
        grade_code="G7-L6",
        has_keypoints_yml=True,
        has_structure_table=True,
        has_ai_rows=False,
    )
    assert tier == LessonTier.DOCX_KEYPOINTS


def test_g7_l6_yaml_fill_blank_mode():
    yml = pathlib.Path(__file__).parent.parent / "data/lessons/_parsed_2026-05-01/G7-L6.yml"
    if not yml.exists():
        pytest.skip("G7-L6.yml missing")
    data = yaml.safe_load(yml.read_text(encoding="utf-8"))
    client = _sanitize_structure_for_client(_format_yaml_structure_table(data["story_structure_table"]))
    assert client["interaction_profile"]["mode"] == "fill_blank"
    issues = gate_l3_mode_expectation(
        LessonTier.DOCX_KEYPOINTS,
        "G7-L6",
        client["interaction_profile"],
        docx_blanks=5,
    )
    assert issues == []


def test_gate_l3_checkbox_markers_fail_when_profile_missing():
    table = [["步驟", "提示", "①正確 □②干擾"]]
    issues = gate_l3_mode_expectation(
        LessonTier.DOCX_KEYPOINTS,
        "G8-L13",
        {"mode": "display_only", "checkbox_count": 0},
        yaml_checkbox_cells=count_checkbox_cells_in_table(table),
    )
    assert "docx has checkbox markers but checkbox_count is 0" in issues


def test_gate_l3_checkbox_markers_pass_when_profile_matches():
    table = [["步驟", "提示", "①正確 □②干擾"]]
    issues = gate_l3_mode_expectation(
        LessonTier.DOCX_KEYPOINTS,
        "G8-L13",
        {"mode": "checkbox", "checkbox_count": 1},
        yaml_checkbox_cells=count_checkbox_cells_in_table(table),
    )
    assert issues == []


def test_l5_issues_retriable_session_flake():
    from story_structure_qa_lib import l5_issues_retriable

    assert l5_issues_retriable(["missing data-story-structure-table", "worksheet_table but zero tr"])
    assert l5_issues_retriable(["redirected to login"])
    assert not l5_issues_retriable(["missing data-comprehension-lesson-text"])
    assert not l5_issues_retriable([])
