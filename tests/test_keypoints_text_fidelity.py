"""
tests/test_keypoints_text_fidelity.py

TDD tests for Slice ②: keypoints text fidelity check.

These tests run BEFORE implementation (RED phase).
The fidelity function is designed to accept _docx_rows_override to avoid
real DOCX loading in unit tests.
"""

import sys
import os
import pytest
from pathlib import Path

# Add scripts to path
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from eval_keypoints_text_fidelity import eval_keypoints_text_fidelity


# ─── Fixtures ────────────────────────────────────────────────────────────────

# A minimal schema that mirrors the G6-L22 PSE structure (nested, 3-col)
SCHEMA_NESTED_CORRECT = {
    "keypoints": {
        "lesson": "TEST-FIDELITY",
        "structure": "nested",
        "columns": ["label", "sub_label", "value"],
        "rows": [
            {
                "label": "問題",
                "value": "秦昭王軟禁了孟嘗君而且想殺掉他，孟嘗君想要逃離秦國。",
                "blanks": [],
            },
            {
                "label": "解決",
                "sub_rows": [
                    {
                        "sub_label": "問題1",
                        "template": "孟嘗君求幸姬幫忙，幸姬要求孟嘗君給她白狐裘，但大衣已經送給秦昭王，不給，自己就__，孟嘗君去哪裡再找一件皮大衣呢?",
                        "blanks": [{"answer": "凶多吉少", "hint": ""}],
                    },
                    {
                        "sub_label": "解決1",
                        "template": "食客中有一位會模仿__的樣子和動作潛入家戶偷東西，他可以潛入寶庫中偷出白狐裘。",
                        "blanks": [{"answer": "狗", "hint": ""}],
                    },
                ],
            },
            {
                "label": "結果",
                "value": "孟嘗君在食客們的幫助下成功逃離秦國。",
                "blanks": [],
            },
        ],
    }
}

# DOCX rows matching the schema exactly
DOCX_ROWS_CORRECT = [
    # problem row (no blanks, direct value)
    {"cells": [{"text": "問題", "dup": False}, {"text": "無", "dup": False}, {"text": "秦昭王軟禁了孟嘗君而且想殺掉他，孟嘗君想要逃離秦國。", "dup": False}]},
    # 解決 sub_row 1: 問題1
    {"cells": [{"text": "解決", "dup": False}, {"text": "問題1", "dup": False}, {"text": "孟嘗君求幸姬幫忙，幸姬要求孟嘗君給她白狐裘，但大衣已經送給秦昭王，不給，自己就【凶多吉少】，孟嘗君去哪裡再找一件皮大衣呢?", "dup": False}]},
    # 解決 sub_row 2: 解決1
    {"cells": [{"text": "解決", "dup": True}, {"text": "解決1", "dup": False}, {"text": "食客中有一位會模仿【狗】的樣子和動作潛入家戶偷東西，他可以潛入寶庫中偷出白狐裘。", "dup": False}]},
    # 結果 row
    {"cells": [{"text": "結果", "dup": False}, {"text": "無", "dup": False}, {"text": "孟嘗君在食客們的幫助下成功逃離秦國。", "dup": False}]},
]

# DOCX rows where one VALUE cell is garbled (counts still match → false-pass without fidelity)
DOCX_ROWS_GARBLED_VALUE = [
    # problem row — value is GARBLED (different text)
    {"cells": [{"text": "問題", "dup": False}, {"text": "無", "dup": False}, {"text": "孟嘗君想要逃走，秦昭王不讓。", "dup": False}]},  # garbled
    # 解決 sub_row 1 — correct
    {"cells": [{"text": "解決", "dup": False}, {"text": "問題1", "dup": False}, {"text": "孟嘗君求幸姬幫忙，幸姬要求孟嘗君給她白狐裘，但大衣已經送給秦昭王，不給，自己就【凶多吉少】，孟嘗君去哪裡再找一件皮大衣呢?", "dup": False}]},
    # 解決 sub_row 2 — correct
    {"cells": [{"text": "解決", "dup": True}, {"text": "解決1", "dup": False}, {"text": "食客中有一位會模仿【狗】的樣子和動作潛入家戶偷東西，他可以潛入寶庫中偷出白狐裘。", "dup": False}]},
    # 結果 row — correct
    {"cells": [{"text": "結果", "dup": False}, {"text": "無", "dup": False}, {"text": "孟嘗君在食客們的幫助下成功逃離秦國。", "dup": False}]},
]

# Schema and DOCX rows for blank-answer mismatch test
SCHEMA_BLANK_MISMATCH = {
    "keypoints": {
        "lesson": "TEST-BLANK-MISMATCH",
        "structure": "flat",
        "columns": ["label", "value"],
        "rows": [
            {
                "label": "特質",
                "value": "主角非常__和勇敢。",
                "blanks": [{"answer": "狗", "hint": ""}],  # schema says 狗
            }
        ],
    }
}

# DOCX has 猫 instead of 狗 inside the blank
DOCX_ROWS_BLANK_MISMATCH = [
    {"cells": [{"text": "特質", "dup": False}, {"text": "主角非常【猫】和勇敢。", "dup": False}]},
]

# Schema for full-width normalization test
SCHEMA_FULLWIDTH = {
    "keypoints": {
        "lesson": "TEST-FULLWIDTH",
        "structure": "flat",
        "columns": ["label", "value"],
        "rows": [
            {
                # value uses ASCII "A" (U+0041)
                "label": "測試",
                "value": "秦昭A王統治秦國。",
                "blanks": [],
            }
        ],
    }
}

# DOCX has full-width "Ａ" (U+FF21) — after NFKC normalization should match ASCII "A"
DOCX_ROWS_FULLWIDTH = [
    {"cells": [{"text": "測試", "dup": False}, {"text": "秦昭Ａ王統治秦國。", "dup": False}]},
]


# ─── Tests ───────────────────────────────────────────────────────────────────

class TestTextFidelityCounts:
    """
    Test 1: counts match but text garbled → must FAIL fidelity check.
    This is the core false-pass scenario that motivated this slice.
    """

    def test_garbled_value_fails_even_though_counts_match(self):
        """
        The false-pass scenario: row_recall=1.0, blank_recall=1.0,
        but one cell value is garbled. Fidelity must catch this.
        """
        result = eval_keypoints_text_fidelity(
            lesson_id="TEST-FIDELITY",
            docx_path=None,
            schema_dir=None,
            bls=None,
            _schema_override=SCHEMA_NESTED_CORRECT,
            _docx_rows_override=DOCX_ROWS_GARBLED_VALUE,
        )
        assert result["available"] is True
        assert result["pass"] is False, (
            "Garbled value text should fail fidelity check"
        )
        assert len(result["mismatches"]) >= 1, (
            f"Expected at least 1 mismatch, got: {result['mismatches']}"
        )


class TestTextFidelityMatch:
    """Test 2: text matches exactly → must PASS fidelity check."""

    def test_matching_text_passes(self):
        result = eval_keypoints_text_fidelity(
            lesson_id="TEST-FIDELITY",
            docx_path=None,
            schema_dir=None,
            bls=None,
            _schema_override=SCHEMA_NESTED_CORRECT,
            _docx_rows_override=DOCX_ROWS_CORRECT,
        )
        assert result["available"] is True
        assert result["pass"] is True, (
            f"Matching text should pass. Mismatches: {result.get('mismatches')}"
        )
        assert result["mismatches"] == [], (
            f"Expected no mismatches, got: {result['mismatches']}"
        )


class TestBlankAnswerMismatch:
    """Test 3: blank answer in schema ≠ blank content in DOCX → mismatch detected."""

    def test_blank_answer_mismatch_detected(self):
        """Schema says answer='狗', DOCX has 【猫】 → should detect as mismatch."""
        result = eval_keypoints_text_fidelity(
            lesson_id="TEST-BLANK-MISMATCH",
            docx_path=None,
            schema_dir=None,
            bls=None,
            _schema_override=SCHEMA_BLANK_MISMATCH,
            _docx_rows_override=DOCX_ROWS_BLANK_MISMATCH,
        )
        assert result["available"] is True
        assert result["pass"] is False, (
            "Blank answer mismatch should fail fidelity"
        )
        mismatches = result["mismatches"]
        assert len(mismatches) >= 1
        # At least one mismatch should mention the answer field
        fields = [m.get("field", "") for m in mismatches]
        assert any("answer" in f or "blank" in f for f in fields), (
            f"Expected answer mismatch, got fields: {fields}"
        )


class TestFullWidthNormalization:
    """Test 4: full-width char in DOCX vs ASCII in schema — normalization makes them match."""

    def test_fullwidth_normalized_to_match(self):
        """
        Schema has ASCII "A", DOCX has full-width "Ａ" (U+FF21).
        After NFKC normalization they become identical → should PASS.
        """
        result = eval_keypoints_text_fidelity(
            lesson_id="TEST-FULLWIDTH",
            docx_path=None,
            schema_dir=None,
            bls=None,
            _schema_override=SCHEMA_FULLWIDTH,
            _docx_rows_override=DOCX_ROWS_FULLWIDTH,
        )
        assert result["available"] is True
        assert result["pass"] is True, (
            f"Full-width normalized text should pass. Mismatches: {result.get('mismatches')}"
        )
        assert result["mismatches"] == []


class TestFidelityScorePresent:
    """Structural check: result always has text_fidelity float."""

    def test_score_in_result(self):
        result = eval_keypoints_text_fidelity(
            lesson_id="TEST-FIDELITY",
            docx_path=None,
            schema_dir=None,
            bls=None,
            _schema_override=SCHEMA_NESTED_CORRECT,
            _docx_rows_override=DOCX_ROWS_CORRECT,
        )
        assert "text_fidelity" in result
        assert isinstance(result["text_fidelity"], float)
        assert 0.0 <= result["text_fidelity"] <= 1.0


# ─── Checkbox/勾選 structure fixture (from real G5-L20 pattern) ───────────────
#
# G5-L20 has templates like:
#   "1.不知該__\n2.擔心相處會變得__ (勾選，可複選)\n驚訝 □驚喜 \n惱怒 煩躁"
#
# The DOCX for this kind of lesson has a table where the "value" column cell
# contains a mix of fill-in blanks AND checkbox option lists on separate lines.
# Positional alignment of schema rows → DOCX rows breaks here because the DOCX
# may group multiple checklist items under one physical row with a different
# cell layout than what the schema's flat/nested rows expect.
#
# The checker must NOT report FAIL for this structure. It should report
# structure_unsupported=True and skip (return pass=True, available=True,
# structure_unsupported=True, mismatches=[]).

SCHEMA_CHECKBOX = {
    "keypoints": {
        "lesson": "TEST-CHECKBOX",
        "structure": "nested",
        "columns": ["label", "value"],
        "rows": [
            {
                "label": "一、二",
                "sub_rows": [
                    {
                        "sub_label": "被傳訊息告白",
                        # Template contains checkbox markers □ and inline option list
                        "template": "1.不知該__\n2.擔心相處會變得__ (勾選，可複選)\n驚訝 □驚喜 \n惱怒 煩躁",
                        "blanks": [
                            {"answer": "如何回應", "hint": ""},
                            {"answer": "尷尬", "hint": ""},
                        ],
                    }
                ],
            }
        ],
    }
}

# The DOCX for this structure has a cell that interleaves option checkboxes with blanks
# in a way that doesn't align positionally with what schema rows expect.
# The cell layout comes from a physically different table structure.
DOCX_ROWS_CHECKBOX = [
    # The value column cell contains the full checkbox+fill-in text, which does NOT
    # map cleanly to what _flatten_schema_rows produces.
    {"cells": [
        {"text": "一、二", "dup": False},
        {"text": "(勾選,可複選) 驚訝 □驚喜 □惱怒 煩躁", "dup": False},  # ← different cell layout
    ]},
]


class TestCheckboxStructureNotFailed:
    """
    Regression lock: checkbox/勾選 table structures must NOT be reported as FAIL.
    They should be classified as structure_unsupported and skipped (NA).

    Root cause of false-positive: G5-L20 scored 1/15 (1 match out of 15 cells)
    because the checker paired schema rows against wrong DOCX cells — the template
    contains checkbox option text on extra lines that doesn't appear in the value
    column of the corresponding DOCX row.

    After the fix: checker detects checkbox inline structure → returns
    structure_unsupported=True, pass=True (NA skip), mismatches=[].
    """

    def test_checkbox_template_not_reported_as_fail(self):
        """
        A schema whose templates contain □ or '勾選' must not produce FAIL.
        Expected: structure_unsupported=True, pass=True (or available=False with note),
        mismatches=[].
        """
        result = eval_keypoints_text_fidelity(
            lesson_id="TEST-CHECKBOX",
            docx_path=None,
            schema_dir=None,
            bls=None,
            _schema_override=SCHEMA_CHECKBOX,
            _docx_rows_override=DOCX_ROWS_CHECKBOX,
        )
        # Must NOT be a hard FAIL — the checker doesn't know if it's a true mismatch
        # or just a structural alignment problem.
        assert result["pass"] is True, (
            f"Checkbox structure should not be hard FAIL, got mismatches: {result.get('mismatches')}"
        )
        # Must signal that this structure was skipped
        assert result.get("structure_unsupported") is True, (
            "Checkbox structure must be flagged as structure_unsupported"
        )
        # No mismatches reported for an unsupported structure
        assert result["mismatches"] == [], (
            f"No mismatches expected for unsupported structure, got: {result['mismatches']}"
        )
