"""
tests/test_lesson_intent.py

TDD tests for Slice ③: lesson intent draft + drift-lock.

These tests run BEFORE implementation (RED phase).
The intent functions are designed to work on pre-loaded dicts for testability.
"""

import sys
import json
import hashlib
import pytest
from pathlib import Path

# Add scripts to path
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from gen_lesson_intent import (
    gen_lesson_intent_for_schema,
    check_intent_stale_from_dicts,
)


# ─── Fixtures ────────────────────────────────────────────────────────────────

# G6-L22 style schema (nested PSE, 7 blanks total)
KP_SCHEMA_G6_L22_STYLE = {
    "keypoints": {
        "lesson": "TEST-INTENT-L1",
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
                    {
                        "sub_label": "結果1",
                        "template": "幸姬得到了白狐裘，替孟嘗君求情，秦昭王解除了對孟嘗君的__。",
                        "blanks": [{"answer": "軟禁", "hint": ""}],
                    },
                    {
                        "sub_label": "問題2",
                        "template": "一行人想趕快逃離秦國，他們到了函谷關，但是規定__時，士兵才能把城門打開，現在他們__。",
                        "blanks": [
                            {"answer": "天亮", "hint": ""},
                            {"answer": "出不了關", "hint": ""},
                        ],
                    },
                    {
                        "sub_label": "解決2",
                        "template": "食客中有一位會模仿__的人，他唯妙唯肖的叫聲，讓公雞們以為天亮了，也都跟著鳴叫，騙過守門人。",
                        "blanks": [{"answer": "公雞叫", "hint": ""}],
                    },
                    {
                        "sub_label": "結果3",
                        "template": "城門__，孟嘗君也順利出關。",
                        "blanks": [{"answer": "終於打開／提前開啟", "hint": ""}],
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

# A slightly modified version (one field changed — simulates schema evolution)
import copy

KP_SCHEMA_V2 = copy.deepcopy(KP_SCHEMA_G6_L22_STYLE)
# Change one answer to simulate schema drift
KP_SCHEMA_V2["keypoints"]["rows"][1]["sub_rows"][0]["blanks"][0]["answer"] = "大難臨頭"


# ─── Tests ───────────────────────────────────────────────────────────────────

class TestGenIntentOutputStructure:
    """Test 1: gen_lesson_intent_for_schema output has required keys and valid values."""

    def test_output_has_required_keys(self):
        intent = gen_lesson_intent_for_schema(
            KP_SCHEMA_G6_L22_STYLE,
            lesson_id="TEST-INTENT-L1",
        )
        assert "lesson" in intent, "intent must have 'lesson'"
        assert "schema_fingerprint" in intent, "intent must have 'schema_fingerprint'"
        assert "generated_at" in intent, "intent must have 'generated_at'"
        assert "intent_rows" in intent, "intent must have 'intent_rows'"

    def test_intent_rows_is_nonempty_list(self):
        intent = gen_lesson_intent_for_schema(
            KP_SCHEMA_G6_L22_STYLE,
            lesson_id="TEST-INTENT-L1",
        )
        rows = intent["intent_rows"]
        assert isinstance(rows, list), "intent_rows must be a list"
        assert len(rows) > 0, "intent_rows must not be empty"

    def test_cognitive_skill_valid_enum(self):
        intent = gen_lesson_intent_for_schema(
            KP_SCHEMA_G6_L22_STYLE,
            lesson_id="TEST-INTENT-L1",
        )
        valid_skills = {"recall", "inference", "synthesis", "evaluation"}
        for row in intent["intent_rows"]:
            cs = row.get("cognitive_skill")
            assert cs in valid_skills, (
                f"cognitive_skill '{cs}' not in valid set {valid_skills}"
            )

    def test_each_row_has_label(self):
        intent = gen_lesson_intent_for_schema(
            KP_SCHEMA_G6_L22_STYLE,
            lesson_id="TEST-INTENT-L1",
        )
        for row in intent["intent_rows"]:
            assert "label" in row, f"Row missing 'label': {row}"

    def test_schema_fingerprint_is_sha256_hex(self):
        intent = gen_lesson_intent_for_schema(
            KP_SCHEMA_G6_L22_STYLE,
            lesson_id="TEST-INTENT-L1",
        )
        fp = intent["schema_fingerprint"]
        assert isinstance(fp, str), "fingerprint must be a string"
        assert len(fp) == 64, f"Expected SHA-256 hex (64 chars), got: {len(fp)}"

    def test_generated_at_is_iso8601(self):
        import datetime
        intent = gen_lesson_intent_for_schema(
            KP_SCHEMA_G6_L22_STYLE,
            lesson_id="TEST-INTENT-L1",
        )
        generated_at = intent["generated_at"]
        # Should parse as ISO datetime
        try:
            datetime.datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
        except ValueError:
            pytest.fail(f"generated_at '{generated_at}' is not valid ISO 8601")


class TestDriftDetectionMismatch:
    """Test 2: fingerprint from v1 schema checked against v2 schema → stale=True."""

    def test_drift_detected_on_schema_change(self):
        # Generate intent from v1
        intent_v1 = gen_lesson_intent_for_schema(
            KP_SCHEMA_G6_L22_STYLE,
            lesson_id="TEST-DRIFT",
        )
        # Check stale using v2 (changed schema)
        result = check_intent_stale_from_dicts(
            current_kp_schema=KP_SCHEMA_V2,
            stored_intent=intent_v1,
        )
        assert result["stale"] is True, (
            "Schema changed → should detect as stale"
        )
        assert "reason" in result, "stale result must include 'reason'"


class TestDriftDetectionNoChange:
    """Test 3: same schema used for both gen and check → stale=False."""

    def test_no_drift_when_schema_unchanged(self):
        intent = gen_lesson_intent_for_schema(
            KP_SCHEMA_G6_L22_STYLE,
            lesson_id="TEST-DRIFT",
        )
        result = check_intent_stale_from_dicts(
            current_kp_schema=KP_SCHEMA_G6_L22_STYLE,
            stored_intent=intent,
        )
        assert result["stale"] is False, (
            f"Same schema → should not be stale. Got: {result}"
        )


class TestIntentRowsCoverage:
    """Test 4: G6-L22 style schema (7 blanks) → exactly 7 blank_idx entries (one per blank)."""

    def test_blank_coverage_at_least_7(self):
        """
        For schema with exactly 7 blanks, intent_rows must have exactly 7 entries
        with blank_idx (one entry per blank, no duplicates, no omissions).

        KP_SCHEMA_G6_L22_STYLE blanks: 解決.問題1(1) + 解決1(1) + 結果1(1) + 問題2(2) +
        解決2(1) + 結果3(1) = 7 total.

        Uniqueness check: each (row_idx, blank_idx) pair must appear exactly once.
        """
        intent = gen_lesson_intent_for_schema(
            KP_SCHEMA_G6_L22_STYLE,
            lesson_id="TEST-INTENT-L1",
        )
        blank_rows = [r for r in intent["intent_rows"] if "blank_idx" in r]
        assert len(blank_rows) == 7, (
            f"Expected exactly 7 blank_idx entries for 7-blank schema, got {len(blank_rows)}: "
            f"{[(r.get('row_idx'), r.get('blank_idx')) for r in blank_rows]}"
        )
        # Uniqueness: no (row_idx, blank_idx) pair should appear more than once
        pairs = [(r["row_idx"], r["blank_idx"]) for r in blank_rows]
        unique_pairs = set(pairs)
        assert len(pairs) == len(unique_pairs), (
            f"Duplicate (row_idx, blank_idx) pairs found: "
            f"{[p for p in pairs if pairs.count(p) > 1]}"
        )

    def test_answer_criterion_present(self):
        """Each row with blank_idx should have answer_criterion."""
        intent = gen_lesson_intent_for_schema(
            KP_SCHEMA_G6_L22_STYLE,
            lesson_id="TEST-INTENT-L1",
        )
        for row in intent["intent_rows"]:
            if "blank_idx" in row:
                assert "answer_criterion" in row, (
                    f"Row with blank_idx missing answer_criterion: {row}"
                )
                valid_criteria = {"verbatim_recall", "paraphrase_ok", "open_ended"}
                assert row["answer_criterion"] in valid_criteria, (
                    f"Invalid answer_criterion '{row['answer_criterion']}'"
                )
