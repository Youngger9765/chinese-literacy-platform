"""
Tests for _normalize_fill_in_blank_item() in lesson_loader.py

Issue #1559: New-format (5/1 batch) fill_in_blank items have context_before/context_after
  and freetext answers — they lack a `sentence` field, crashing FillInBlankExercise.
Issue #1563: FillInBlankExercise expects `sentence` field; new-format items cause TypeError.

Fix: lesson_loader._normalize_fill_in_blank_item() tags every item with _schema:
  "legacy"       — has sentence, answer is a vocab_bank letter code ("A".."J")
  "context_fill" — new-format: answer is freetext strategy cloze; synthesize sentence

Frontend api.ts drops context_fill items so VocabApplication shows NoDataFallback
(graceful) instead of a broken exercise.
"""
import sys
import os

# Allow importing from backend/app without a full installed package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.services.lesson_loader import _normalize_fill_in_blank_item


class TestNormalizeFillInBlankItem:
    """Unit tests for _normalize_fill_in_blank_item()."""

    # ── Legacy schema (old-format) ──────────────────────────────────────────

    def test_legacy_passthrough_sentence_preserved(self):
        """Legacy items keep their sentence unchanged."""
        item = {"sentence": "春天來了，萬物（　　）。", "answer": "A"}
        result = _normalize_fill_in_blank_item(item)
        assert result["sentence"] == "春天來了，萬物（　　）。"

    def test_legacy_answer_preserved(self):
        """Legacy items keep their letter-code answer."""
        item = {"sentence": "他（　　）向前奔跑。", "answer": "B"}
        result = _normalize_fill_in_blank_item(item)
        assert result["answer"] == "B"

    def test_legacy_tagged_as_legacy(self):
        """Legacy items get _schema = 'legacy'."""
        item = {"sentence": "她（　　）地笑著。", "answer": "C"}
        result = _normalize_fill_in_blank_item(item)
        assert result["_schema"] == "legacy"

    def test_legacy_extra_fields_preserved(self):
        """Extra fields on legacy items are preserved."""
        item = {"sentence": "水從山上（　　）而下。", "answer": "D", "hint": "動詞"}
        result = _normalize_fill_in_blank_item(item)
        assert result["hint"] == "動詞"
        assert result["_schema"] == "legacy"

    # ── New-format schema (context_fill) ────────────────────────────────────

    def test_new_format_tagged_as_context_fill(self):
        """New-format items (with context_before) get _schema = 'context_fill'."""
        item = {
            "id": 1,
            "context_before": "牠看著月亮，",
            "context_after": "，彷彿在思念什麼。",
            "answer": "模仿雞叫",
            "context_paragraph_idx": 2,
        }
        result = _normalize_fill_in_blank_item(item)
        assert result["_schema"] == "context_fill"

    def test_new_format_sentence_synthesized(self):
        """New-format items get a synthesized sentence for legacy compatibility."""
        item = {
            "id": 1,
            "context_before": "牠看著月亮，",
            "context_after": "，彷彿在思念什麼。",
            "answer": "模仿雞叫",
        }
        result = _normalize_fill_in_blank_item(item)
        assert result["sentence"] == "牠看著月亮，（　　），彷彿在思念什麼。"

    def test_new_format_freetext_answer_preserved(self):
        """Freetext answers on new-format items are NOT changed by normalizer."""
        item = {
            "id": 2,
            "context_before": "他昂首挺胸，",
            "context_after": "走進教室。",
            "answer": "充滿自信地",
        }
        result = _normalize_fill_in_blank_item(item)
        assert result["answer"] == "充滿自信地"

    def test_new_format_all_fields_preserved(self):
        """All original fields on new-format items are preserved."""
        item = {
            "id": 3,
            "context_before": "春天，",
            "context_after": "，草地上滿是花朵。",
            "answer": "萬物復甦",
            "context_paragraph_idx": 0,
        }
        result = _normalize_fill_in_blank_item(item)
        assert result["id"] == 3
        assert result["context_before"] == "春天，"
        assert result["context_after"] == "，草地上滿是花朵。"
        assert result["context_paragraph_idx"] == 0

    # ── Edge cases ───────────────────────────────────────────────────────────

    def test_empty_context_before(self):
        """context_before can be empty string."""
        item = {
            "id": 4,
            "context_before": "",
            "context_after": "，讓人感到溫暖。",
            "answer": "陽光照耀",
        }
        result = _normalize_fill_in_blank_item(item)
        assert result["sentence"] == "（　　），讓人感到溫暖。"
        assert result["_schema"] == "context_fill"

    def test_empty_context_after(self):
        """context_after can be empty string."""
        item = {
            "id": 5,
            "context_before": "他大聲地說：",
            "context_after": "",
            "answer": "我會努力的",
        }
        result = _normalize_fill_in_blank_item(item)
        assert result["sentence"] == "他大聲地說：（　　）"
        assert result["_schema"] == "context_fill"

    def test_none_context_before_treated_as_empty(self):
        """None context_before is treated as empty string."""
        item = {
            "id": 6,
            "context_before": None,
            "context_after": "是學習的關鍵。",
            "answer": "專注",
        }
        result = _normalize_fill_in_blank_item(item)
        assert result["sentence"] == "（　　）是學習的關鍵。"
        assert result["_schema"] == "context_fill"

    def test_item_with_both_sentence_and_context_before_treated_as_legacy(self):
        """If item has BOTH sentence AND context_before, legacy wins (sentence present).
        The normalizer condition is: context_before in item AND sentence NOT in item.
        When sentence IS present, condition is False → falls through to legacy path.
        """
        item = {
            "sentence": "某某（　　）某某。",
            "context_before": "前文",
            "context_after": "後文",
            "answer": "A",
        }
        result = _normalize_fill_in_blank_item(item)
        # "sentence" IS in item → "sentence" not in item is False → legacy path
        assert result["_schema"] == "legacy"

    def test_schema_key_does_not_overwrite_existing(self):
        """If item already has _schema (e.g. from a previous normalization), it gets replaced."""
        item = {"sentence": "某（　　）某。", "answer": "A", "_schema": "some_old_value"}
        result = _normalize_fill_in_blank_item(item)
        # Normalizer always sets _schema based on structure, not previous value
        assert result["_schema"] == "legacy"


class TestNormalizeFillInBlankItemSchemaDetection:
    """Verify the _schema flag correctly separates the two schemas so
    api.ts filter logic `item['_schema'] === 'legacy'` works as expected."""

    def test_all_new_format_items_get_context_fill(self):
        """A batch of new-format items all get tagged context_fill."""
        new_format_items = [
            {"id": i, "context_before": f"前{i}", "context_after": f"後{i}", "answer": f"答案{i}"}
            for i in range(1, 6)
        ]
        results = [_normalize_fill_in_blank_item(item) for item in new_format_items]
        for r in results:
            assert r["_schema"] == "context_fill"

    def test_all_legacy_items_get_legacy(self):
        """A batch of legacy items all get tagged legacy."""
        legacy_items = [
            {"sentence": f"某某（　　）{i}。", "answer": chr(ord("A") + i)}
            for i in range(5)
        ]
        results = [_normalize_fill_in_blank_item(item) for item in legacy_items]
        for r in results:
            assert r["_schema"] == "legacy"

    def test_mixed_batch_separation(self):
        """Mixed batch: context_fill items separate cleanly from legacy items."""
        items = [
            {"sentence": "他（　　）前進。", "answer": "A"},  # legacy
            {"id": 1, "context_before": "牠", "context_after": "叫著。", "answer": "模仿"},  # new-format
            {"sentence": "水（　　）流下。", "answer": "B"},  # legacy
            {"id": 2, "context_before": "春天", "context_after": "到來。", "answer": "溫暖"},  # new-format
        ]
        results = [_normalize_fill_in_blank_item(item) for item in items]
        schemas = [r["_schema"] for r in results]
        assert schemas == ["legacy", "context_fill", "legacy", "context_fill"]
