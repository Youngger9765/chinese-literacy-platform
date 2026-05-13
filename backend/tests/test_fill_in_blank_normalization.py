"""Tests for fill_in_blank schema normalization in lesson_loader.

Issue #1559: New YAML lessons (5/1 batch) use context_before/context_after
instead of a pre-composed `sentence` field.  FillInBlankExercise.tsx expects
`sentence`, so items missing it cause a runtime crash caught by StepErrorBoundary.

The fix is in lesson_loader._normalize_fill_in_blank_item which synthesizes
`sentence` from context_before + blank placeholder + context_after.
"""

import pytest
from app.services.lesson_loader import _normalize_fill_in_blank_item


class TestNormalizeFillInBlankItem:
    def test_old_schema_passthrough(self):
        """Items already having 'sentence' must be returned unchanged."""
        item = {"sentence": "孟嘗君（　　）逃離秦國。", "answer": "A"}
        result = _normalize_fill_in_blank_item(item)
        assert result["sentence"] == "孟嘗君（　　）逃離秦國。"
        assert result["answer"] == "A"

    def test_new_schema_synthesizes_sentence(self):
        """Items with context_before/context_after but no sentence get sentence synthesized."""
        item = {
            "id": 1,
            "answer": "模仿雞叫",
            "context_before": "孟嘗君的食客",
            "context_after": "，引來附近公雞也一起叫。",
            "context_paragraph_idx": 4,
        }
        result = _normalize_fill_in_blank_item(item)
        assert "sentence" in result
        assert result["sentence"] == "孟嘗君的食客（　　），引來附近公雞也一起叫。"

    def test_new_schema_preserves_all_original_fields(self):
        """Original fields (id, context_before, context_after, etc.) must be preserved."""
        item = {
            "id": 3,
            "answer": "狗",
            "context_before": "食客中有一位會模仿",
            "context_after": "的樣子和動作潛入家戶偷東西。",
            "context_paragraph_idx": 5,
        }
        result = _normalize_fill_in_blank_item(item)
        assert result["id"] == 3
        assert result["context_before"] == "食客中有一位會模仿"
        assert result["context_after"] == "的樣子和動作潛入家戶偷東西。"
        assert result["context_paragraph_idx"] == 5

    def test_empty_context_fields(self):
        """Handles empty context_before or context_after gracefully."""
        item = {"answer": "A", "context_before": "", "context_after": "後面的文字。"}
        result = _normalize_fill_in_blank_item(item)
        assert result["sentence"] == "（　　）後面的文字。"

    def test_both_empty_context(self):
        """Handles both context fields empty — produces a standalone blank."""
        item = {"answer": "A", "context_before": "", "context_after": ""}
        result = _normalize_fill_in_blank_item(item)
        assert result["sentence"] == "（　　）"

    def test_no_context_fields_no_sentence_unchanged(self):
        """Items with neither sentence nor context fields are returned unchanged (edge case)."""
        item = {"answer": "A"}
        result = _normalize_fill_in_blank_item(item)
        assert "sentence" not in result

    def test_sentence_wins_over_context(self):
        """If 'sentence' already exists, don't overwrite even if context fields also present."""
        item = {
            "sentence": "已有的句子（　　）不應被覆蓋。",
            "answer": "B",
            "context_before": "不應使用",
            "context_after": "這段文字",
        }
        result = _normalize_fill_in_blank_item(item)
        assert result["sentence"] == "已有的句子（　　）不應被覆蓋。"
