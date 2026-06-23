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
                "label": "挫折事件",
                "sub_rows": [
                    {
                        "sub_label": "雅加達亞運",
                        # Template contains checkbox markers □ and inline option list
                        # blanks=[] → checkbox-only cell, SHOULD be skipped
                        "template": "（單選）\n□驕傲地奪得銀牌     \n不甘心以微小的差距奪得銀牌",
                        "blanks": [],
                    },
                    {
                        "sub_label": "拿坡里世大運",
                        # Also checkbox-only (blanks=[])
                        "template": "比賽時受傷了，他選擇（單選）\n積極的面對與復健   □放棄跑步、不願治療",
                        "blanks": [],
                    },
                ],
            }
        ],
    }
}

# The DOCX for this structure has cells that interleave checkbox options.
# Since all schema cells are checkbox-only (blanks=[]), the whole lesson
# should be classified structure_unsupported=True.
DOCX_ROWS_CHECKBOX = [
    {"cells": [
        {"text": "挫折事件", "dup": False},
        {"text": "雅加達亞運", "dup": False},
        {"text": "（單選）\n□驕傲地奪得銀牌\n不甘心以微小的差距奪得銀牌", "dup": False},
    ]},
    {"cells": [
        {"text": "挫折事件", "dup": True},
        {"text": "拿坡里世大運", "dup": False},
        {"text": "比賽時受傷了，他選擇（單選）\n積極的面對與復健   □放棄跑步、不願治療", "dup": False},
    ]},
]


class TestCheckboxStructureNotFailed:
    """
    Regression lock: all-checkbox table structures must NOT be reported as FAIL.
    They should be classified as structure_unsupported and skipped (NA).

    Cell-level rule: a cell is checkbox-only if template/value has checkbox markers
    (□/勾選/單選/複選) AND blanks=[]. Only cells with no real fill-in blanks are skipped.

    When ALL paired cells are checkbox-only → structure_unsupported=True for the lesson.

    Root cause of false-positive: G5-L20-style tables produce checkbox-only cells that
    cannot be aligned positionally. They should not count as FAIL.
    """

    def test_checkbox_template_not_reported_as_fail(self):
        """
        A schema whose ALL templates contain □/勾選/單選 with blanks=[] must
        not produce FAIL. Expected: structure_unsupported=True, pass=True, mismatches=[].
        """
        result = eval_keypoints_text_fidelity(
            lesson_id="TEST-CHECKBOX",
            docx_path=None,
            schema_dir=None,
            bls=None,
            _schema_override=SCHEMA_CHECKBOX,
            _docx_rows_override=DOCX_ROWS_CHECKBOX,
        )
        # Must NOT be a hard FAIL — all cells are checkbox-only (no real fill-ins)
        assert result["pass"] is True, (
            f"All-checkbox structure should not be hard FAIL, got mismatches: {result.get('mismatches')}"
        )
        # Must signal that this structure was skipped
        assert result.get("structure_unsupported") is True, (
            "All-checkbox structure must be flagged as structure_unsupported"
        )
        # No mismatches reported for an unsupported structure
        assert result["mismatches"] == [], (
            f"No mismatches expected for unsupported structure, got: {result['mismatches']}"
        )


# ─── Mixed course fixture (from real G4-L2 pattern) ──────────────────────────
#
# G4-L2 has BOTH:
#   - rows with real fill-in blanks:  主角=楊俊瀚, 他學到了什麼?=擁抱恐懼/對話
#   - rows with ONLY checkbox options (no blanks):
#       挫折事件.雅加達亞運: "（單選）\n□驕傲地奪得銀牌..." blanks=[]
#
# The old lesson-level guard skipped the ENTIRE lesson → 3 real fill-ins unverified.
# The new cell-level guard must:
#   - SKIP the checkbox-only cells (no blanks, template has □ or 勾選/單選)
#   - VERIFY the real fill-in cells (those with actual blanks[].answer)
#   - Report at least the real fill-in cells in total_cells_checked

SCHEMA_MIXED_CHECKBOX = {
    "keypoints": {
        "lesson": "TEST-MIXED",
        "structure": "nested",
        "columns": ["label", "value"],
        "rows": [
            {
                # Real fill-in: answer = 楊俊瀚
                "label": "主角",
                "value": "__",
                "blanks": [{"answer": "楊俊瀚", "hint": ""}],
            },
            {
                "label": "挫折事件",
                "sub_rows": [
                    {
                        # Checkbox-only cell — no blanks, template has □
                        "sub_label": "雅加達亞運",
                        "template": "（單選）\n□驕傲地奪得銀牌\n不甘心以微小的差距奪得銀牌",
                        "blanks": [],
                    },
                    {
                        # Checkbox-only cell — no blanks, template has □
                        "sub_label": "拿坡里世大運",
                        "template": "比賽時受傷了，他選擇（單選）\n積極的面對與復健   □放棄跑步、不願治療",
                        "blanks": [],
                    },
                ],
            },
            {
                # Real fill-in: 2 answers = 擁抱恐懼, 對話
                "label": "他學到了什麼?",
                "value": "他學會了先了解害怕的事物，__，再戰勝它。\n2.學習和自己__，找尋答案。",
                "blanks": [
                    {"answer": "擁抱恐懼", "hint": ""},
                    {"answer": "對話", "hint": ""},
                ],
            },
        ],
    }
}

# DOCX rows matching the real fill-in cells correctly
# (checkbox cells are present in DOCX but won't be compared since they're skipped)
DOCX_ROWS_MIXED_CORRECT = [
    # Row 0: 主角 — real fill-in, DOCX has 【楊俊瀚】
    {"cells": [{"text": "主角", "dup": False}, {"text": "【楊俊瀚】", "dup": False}]},
    # Row 1_0: 雅加達亞運 — checkbox only, DOCX value is the checkbox text
    {"cells": [{"text": "挫折事件", "dup": False}, {"text": "（單選）\n□驕傲地奪得銀牌\n不甘心以微小的差距奪得銀牌", "dup": False}]},
    # Row 1_1: 拿坡里世大運 — checkbox only
    {"cells": [{"text": "挫折事件", "dup": True}, {"text": "比賽時受傷了，他選擇（單選）\n積極的面對與復健   □放棄跑步、不願治療", "dup": False}]},
    # Row 2: 他學到了什麼? — real fill-in, DOCX has 【擁抱恐懼】 and 【對話】
    {"cells": [{"text": "他學到了什麼?", "dup": False}, {"text": "他學會了先了解害怕的事物，【擁抱恐懼】，再戰勝它。\n2.學習和自己【對話】，找尋答案。", "dup": False}]},
]


class TestMixedCheckboxCellLevel:
    """
    Regression lock: mixed courses (checkbox cells + real fill-in cells) must:
    - SKIP checkbox-only cells (no blanks + template has □/單選/複選)
    - VERIFY real fill-in cells (have blanks[].answer)
    - total_cells_checked > 0
    - NOT return structure_unsupported=True for the whole lesson

    Root cause: old lesson-level guard skipped all of G4-L2 → 3 real fill-ins unverified.
    """

    def test_mixed_lesson_verifies_real_fillin_cells(self):
        """Real fill-in cells (with blanks) must be checked even in checkbox-mixed lessons."""
        result = eval_keypoints_text_fidelity(
            lesson_id="TEST-MIXED",
            docx_path=None,
            schema_dir=None,
            bls=None,
            _schema_override=SCHEMA_MIXED_CHECKBOX,
            _docx_rows_override=DOCX_ROWS_MIXED_CORRECT,
        )
        assert result["available"] is True
        # Must NOT skip the whole lesson
        assert result.get("structure_unsupported") is not True, (
            "Mixed lesson should not be entirely structure_unsupported"
        )
        # Must have checked at least the real fill-in cells
        assert result["total_cells_checked"] > 0, (
            "Mixed lesson must verify real fill-in cells, not skip everything"
        )
        # Correct fill-in text → must pass
        assert result["pass"] is True, (
            f"Mixed lesson with correct fill-ins should pass. mismatches={result.get('mismatches')}"
        )
        assert result["mismatches"] == []

    def test_mixed_lesson_still_catches_fillin_mismatch(self):
        """If a real fill-in cell is wrong, it must still be caught."""
        # Same schema but DOCX has wrong answer for 主角
        docx_wrong = [
            {"cells": [{"text": "主角", "dup": False}, {"text": "【錯誤答案】", "dup": False}]},
            {"cells": [{"text": "挫折事件", "dup": False}, {"text": "（單選）\n□驕傲地奪得銀牌\n不甘心", "dup": False}]},
            {"cells": [{"text": "挫折事件", "dup": True}, {"text": "比賽時受傷了，積極的面對與復健   □放棄", "dup": False}]},
            {"cells": [{"text": "他學到了什麼?", "dup": False}, {"text": "他學會了先了解害怕的事物，【擁抱恐懼】，再戰勝它。\n2.學習和自己【對話】，找尋答案。", "dup": False}]},
        ]
        result = eval_keypoints_text_fidelity(
            lesson_id="TEST-MIXED",
            docx_path=None,
            schema_dir=None,
            bls=None,
            _schema_override=SCHEMA_MIXED_CHECKBOX,
            _docx_rows_override=docx_wrong,
        )
        assert result["available"] is True
        assert result["pass"] is False, "Wrong fill-in answer must be caught"
        fields = [m.get("field", "") for m in result["mismatches"]]
        assert any("answer" in f for f in fields), f"Expected answer mismatch, got: {fields}"


# ─── Blank marker normalization fixture (from real 文-L5 pattern) ─────────────
#
# 文-L5 schema row value = "內容摘要\n【 】處填入原文，找不到原文時，再用自己的話寫。"
# DOCX cell text       = "內容摘要\n__處填入原文，找不到原文時，再用自己的話寫。"
#
# The schema has an empty blank marker 【 】 (instruction) where DOCX has __.
# Both mean "a blank to fill in" — they are semantically equivalent.
# The checker should treat 【 】/【　】/【】 (empty-content blanks) as __ during comparison.
#
# BUT: if the schema has 【answer】 (non-empty content inside) and the DOCX has
# different text, that IS a real mismatch. This must not be swallowed.

SCHEMA_BLANK_MARKER = {
    "keypoints": {
        "lesson": "TEST-BLANK-MARKER",
        "structure": "flat",
        "columns": ["label", "value"],
        "rows": [
            {
                # Instruction row: schema has 【 】 (empty blank), DOCX has __
                # Both are blank markers → should PASS after normalization
                "label": "說明",
                "value": "內容摘要 【 】處填入原文，找不到原文時，再用自己的話寫。",
                "blanks": [],
            },
            {
                # Real fill-in row: schema answer = 荀巨伯, DOCX has 【荀巨伯】 → PASS
                "label": "起因",
                "value": "__去看望__，卻遇上胡兵。",
                "blanks": [
                    {"answer": "荀巨伯", "hint": ""},
                    {"answer": "友人", "hint": ""},
                ],
            },
        ],
    }
}

DOCX_ROWS_BLANK_MARKER_PASS = [
    # Instruction row: DOCX uses __ instead of 【 】
    {"cells": [{"text": "說明", "dup": False}, {"text": "內容摘要 __處填入原文，找不到原文時，再用自己的話寫。", "dup": False}]},
    # Real fill-in: correct answers
    {"cells": [{"text": "起因", "dup": False}, {"text": "【荀巨伯】去看望【友人】，卻遇上胡兵。", "dup": False}]},
]

# Anti-case: schema has 【非空答案】 but DOCX has 【不同答案】 → must be FAIL (not swallowed)
SCHEMA_NON_EMPTY_BLANK_REAL_ERROR = {
    "keypoints": {
        "lesson": "TEST-BLANK-MARKER-REAL-ERROR",
        "structure": "flat",
        "columns": ["label", "value"],
        "rows": [
            {
                # The value text itself doesn't have 【】, but blanks[0].answer = 正確答案
                # DOCX has 【錯誤答案】 → must detect as mismatch
                "label": "起因",
                "value": "__去看望朋友。",
                "blanks": [{"answer": "正確答案", "hint": ""}],
            },
        ],
    }
}
DOCX_ROWS_NON_EMPTY_BLANK_REAL_ERROR = [
    {"cells": [{"text": "起因", "dup": False}, {"text": "【錯誤答案】去看望朋友。", "dup": False}]},
]


class TestBlankMarkerNormalization:
    """
    Regression lock: 【 】 (empty blank marker in schema) ≡ __ (blank in DOCX).
    Root cause of 文-L5/6/7/10 false-positives: instruction rows with 【 】 were
    compared against DOCX __ and reported as mismatch.
    """

    def test_empty_blank_marker_normalized_to_match(self):
        """
        Schema value '【 】處填入原文' vs DOCX '__處填入原文' — semantically same.
        After normalization both become '__處填入原文' → PASS.
        """
        result = eval_keypoints_text_fidelity(
            lesson_id="TEST-BLANK-MARKER",
            docx_path=None,
            schema_dir=None,
            bls=None,
            _schema_override=SCHEMA_BLANK_MARKER,
            _docx_rows_override=DOCX_ROWS_BLANK_MARKER_PASS,
        )
        assert result["available"] is True
        assert result["pass"] is True, (
            f"【 】≡__ should pass. mismatches={result.get('mismatches')}"
        )
        assert result["mismatches"] == []

    def test_non_empty_blank_with_real_error_still_caught(self):
        """
        If schema blank answer = '正確答案' but DOCX has '【錯誤答案】' → real mismatch.
        Normalization must NOT swallow this.
        """
        result = eval_keypoints_text_fidelity(
            lesson_id="TEST-BLANK-MARKER-REAL-ERROR",
            docx_path=None,
            schema_dir=None,
            bls=None,
            _schema_override=SCHEMA_NON_EMPTY_BLANK_REAL_ERROR,
            _docx_rows_override=DOCX_ROWS_NON_EMPTY_BLANK_REAL_ERROR,
        )
        assert result["available"] is True
        assert result["pass"] is False, (
            "Real answer mismatch must not be swallowed by blank-marker normalization"
        )
        assert len(result["mismatches"]) >= 1
