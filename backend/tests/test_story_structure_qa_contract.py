"""Contract tests for story_structure_qa_lib (L3 interaction_profile gates)."""

import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent / "scripts"))

import yaml
import pytest

from app.routes.stories import _format_yaml_structure_table, _sanitize_structure_for_client
from story_structure_qa_lib import (
    PARSER_GAP_LESSONS,
    LessonTier,
    classify_lesson,
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


def test_parser_gap_tier():
    tier = classify_lesson(
        grade_code="G7-L6",
        has_keypoints_yml=True,
        has_structure_table=True,
        has_ai_rows=False,
    )
    assert tier == LessonTier.PARSER_GAP


def test_gate_l3_parser_gap_display_only():
    issues = gate_l3_mode_expectation(
        LessonTier.PARSER_GAP,
        "G7-L6",
        {"mode": "display_only"},
    )
    assert issues == []


def test_known_parser_gap_set():
    assert "G7-L6" in PARSER_GAP_LESSONS
    assert "G8-L13" not in PARSER_GAP_LESSONS
