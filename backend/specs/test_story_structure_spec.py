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
from story_structure_qa_lib import (
    LessonTier,
    classify_lesson,
    verify_interaction_profile_contract,
)


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


class TestClassifyLessonTier:
    """L1 重點表 gate only runs for DOCX_KEYPOINTS lessons. Multi-text lessons
    (one DOCX → many slots, compound YAML) must still be classified
    DOCX_KEYPOINTS when their keypoints schema was extracted, otherwise the
    gate is silently skipped and the content evidence gate reads it as a fail
    (#2397 — the 4 L1_KEYPOINTS_FAIL cells: G4-L20 / G5-L24 / G9-L15 / G9-L17).
    """

    def test_keypoints_available_without_structure_table_is_docx_keypoints(self):
        # Multi-text compound lesson: single-slot parsed YAML lookup misses,
        # so has_structure_table is False, but the keypoints schema exists.
        tier = classify_lesson(
            grade_code="G4-L20",
            has_keypoints_yml=True,
            has_structure_table=False,
            has_ai_rows=False,
            docx_keypoints_available=True,
        )
        assert tier == LessonTier.DOCX_KEYPOINTS

    def test_keypoints_unavailable_is_not_docx_keypoints(self):
        # No extractable 重點表 → must NOT be promoted to DOCX_KEYPOINTS.
        assert (
            classify_lesson(
                grade_code="X-L1",
                has_keypoints_yml=False,
                has_structure_table=False,
                has_ai_rows=False,
                docx_keypoints_available=False,
            )
            == LessonTier.NO_KEYPOINTS_DOCX
        )

    def test_keypoints_availability_none_stays_no_structure(self):
        # None (key absent in eval) must not satisfy the `is True` promotion.
        assert (
            classify_lesson(
                grade_code="X-L2",
                has_keypoints_yml=False,
                has_structure_table=False,
                has_ai_rows=False,
                docx_keypoints_available=None,
            )
            == LessonTier.NO_STRUCTURE
        )

    def test_ai_rows_still_ai_fallback_when_no_keypoints(self):
        # AI fallback path is unaffected by the new keypoints branch.
        assert (
            classify_lesson(
                grade_code="X-L3",
                has_keypoints_yml=False,
                has_structure_table=False,
                has_ai_rows=True,
                docx_keypoints_available=None,
            )
            == LessonTier.AI_FALLBACK
        )

    def test_structure_table_path_unchanged(self):
        # Normal single-slot lesson with on-disk structure table.
        assert (
            classify_lesson(
                grade_code="X-L4",
                has_keypoints_yml=True,
                has_structure_table=True,
                has_ai_rows=False,
                docx_keypoints_available=True,
            )
            == LessonTier.DOCX_KEYPOINTS
        )
