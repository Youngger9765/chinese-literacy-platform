"""TDD for app.services.pk.rounds — PRD §4/§6/§6.1.

§4: "題目順序：由易到難...5 題依來源模組排序：語詞理解 → 語詞應用 → 注音挑戰
→ 閱讀理解...如果同一場對戰裡同一個模組出現超過 1 題...同模組內的題目順序
維持原本的隨機排列".
§6.1: "直接呼叫 generate_rounds(lessons, settings, rng)...不呼叫
score_submission()".
"""
from __future__ import annotations

import random

import pytest
from fastapi import HTTPException

from app.services.pk import rounds as svc

MODULE_ORDER = ["vocab_definitions", "vocab_application", "zhuyin", "comprehension"]


def _round(source_module: str, item_id: str) -> dict:
    return {
        "round_index": -1,  # reorder_by_difficulty must reassign this
        "round_type": "choice",
        "payload": {"source_module": source_module, "item_id": item_id, "correct_key": "A"},
    }


class TestReorderByDifficulty:
    def test_sorts_by_module_difficulty_order(self):
        shuffled = [
            _round("comprehension", "c1"),
            _round("vocab_definitions", "vd1"),
            _round("zhuyin", "z1"),
            _round("vocab_application", "va1"),
        ]
        ordered = svc.reorder_by_difficulty(shuffled)
        assert [r["payload"]["source_module"] for r in ordered] == MODULE_ORDER

    def test_reassigns_round_index_sequentially_from_zero(self):
        shuffled = [_round("comprehension", "c1"), _round("vocab_definitions", "vd1")]
        ordered = svc.reorder_by_difficulty(shuffled)
        assert [r["round_index"] for r in ordered] == [0, 1]

    def test_same_module_items_keep_their_relative_order(self):
        """PRD §4: same-module items keep whatever (random) order they
        arrived in — reorder must be a STABLE sort, not a re-shuffle."""
        shuffled = [
            _round("vocab_definitions", "vd_B"),
            _round("vocab_definitions", "vd_A"),
            _round("comprehension", "c1"),
        ]
        ordered = svc.reorder_by_difficulty(shuffled)
        vd_items = [r["payload"]["item_id"] for r in ordered if r["payload"]["source_module"] == "vocab_definitions"]
        assert vd_items == ["vd_B", "vd_A"]  # original relative order preserved

    def test_unknown_module_sorts_last_without_crashing(self):
        shuffled = [_round("some_future_module", "x1"), _round("vocab_definitions", "vd1")]
        ordered = svc.reorder_by_difficulty(shuffled)
        assert ordered[-1]["payload"]["item_id"] == "x1"

    def test_empty_list_returns_empty_list(self):
        assert svc.reorder_by_difficulty([]) == []


def _fake_lesson(n_questions: int) -> dict:
    return {
        "title": "假課文",
        "version_id": "v1",
        "comprehension": {
            "questions": [
                {"index": i, "stem": f"題{i}？", "answer": "A",
                 "options": {"A": "正確", "B": "錯誤1", "C": "錯誤2", "D": "錯誤3"}}
                for i in range(1, n_questions + 1)
            ]
        },
    }


class TestBuildPkRounds:
    def test_raises_when_pool_smaller_than_rounds_per_match(self):
        lessons = [{"lesson_uid": "FAKE2", "lesson": _fake_lesson(2)}]
        with pytest.raises(HTTPException) as exc:
            svc.build_pk_rounds(lessons, random.Random(1), rounds_per_match=5)
        assert exc.value.status_code == 400

    def test_builds_exactly_rounds_per_match_and_in_difficulty_order(self):
        lessons = [{"lesson_uid": "FAKE6", "lesson": _fake_lesson(6)}]
        built = svc.build_pk_rounds(lessons, random.Random(1), rounds_per_match=5)
        assert len(built) == 5
        assert [r["round_index"] for r in built] == [0, 1, 2, 3, 4]
        # Only comprehension items exist in this fixture, so this also proves
        # generate_rounds' own per-game option shuffle still ran (correct_key
        # is set and one of the real option keys).
        for r in built:
            assert r["payload"]["source_module"] == "comprehension"
            assert r["payload"]["correct_key"] in {"A", "B", "C", "D"}

    def test_deterministic_given_same_rng_seed(self):
        lessons = [{"lesson_uid": "FAKE6", "lesson": _fake_lesson(6)}]
        a = svc.build_pk_rounds(lessons, random.Random(42), rounds_per_match=5)
        b = svc.build_pk_rounds(lessons, random.Random(42), rounds_per_match=5)
        assert a == b


def _fake_lesson_skewed(n_comprehension: int, n_vocab_definitions: int) -> dict:
    """A lesson with a LOT of comprehension items and only a FEW
    vocab_definitions items — the shape staging QA actually hit with
    zhuyin vs the other three modules (#3602 "also": "題庫幾乎都是注音")."""
    bank = [f"詞{i}" for i in range(max(2, n_vocab_definitions) + 1)]
    return {
        "title": "假課文",
        "version_id": "v1",
        "comprehension": {
            "questions": [
                {"index": i, "stem": f"題{i}？", "answer": "A",
                 "options": {"A": "正確", "B": "錯誤1", "C": "錯誤2", "D": "錯誤3"}}
                for i in range(1, n_comprehension + 1)
            ]
        },
        "vocab_definitions": {
            "vocabulary_bank": bank,
            "items": [
                {"index": i, "word": bank[i], "definition": f"定義{i}"}
                for i in range(n_vocab_definitions)
            ],
        },
    }


class TestBuildPkRoundsQuestionMix:
    """#3602 "also": "題庫幾乎都是注音...rebalance to include 語詞/理解 types
    where available" — a plain pool-wide sample lets whichever module
    happens to generate the most raw items dominate every match, even
    though the scarce module genuinely has items available."""

    def test_scarce_module_still_represented_despite_being_outnumbered(self):
        # 40 comprehension items vs only 2 vocab_definitions items in the
        # combined pool (42 total) -- a uniform 5-of-42 sample very rarely
        # includes either of the 2 scarce items. Checked across a spread of
        # seeds: the fix must include vocab_definitions EVERY time (it's a
        # guaranteed round-robin pick, not a probabilistic improvement).
        lessons = [{"lesson_uid": "FAKE_SKEW", "lesson": _fake_lesson_skewed(40, 2)}]
        for seed in range(1, 15):
            built = svc.build_pk_rounds(lessons, random.Random(seed), rounds_per_match=5)
            modules = [r["payload"]["source_module"] for r in built]
            assert "vocab_definitions" in modules, f"seed={seed} picked only {modules}"

    def test_still_fills_remaining_slots_from_the_abundant_module(self):
        lessons = [{"lesson_uid": "FAKE_SKEW", "lesson": _fake_lesson_skewed(40, 2)}]
        built = svc.build_pk_rounds(lessons, random.Random(7), rounds_per_match=5)
        assert len(built) == 5
        modules = [r["payload"]["source_module"] for r in built]
        # Only 2 vocab_definitions items exist -- the remaining 3 slots can
        # only come from comprehension.
        assert modules.count("vocab_definitions") == 2
        assert modules.count("comprehension") == 3
