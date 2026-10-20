"""TDD for team_arena.weapons v2 — PRD §0 v2 改版 F/G/H/I/J,
docs/prd/2026-10-18-team-arena-prd.md."""
from __future__ import annotations

import random

import pytest

from app.services.team_arena import weapons as svc


class TestCanEliminate:
    def test_two_options_cannot_be_eliminated(self):
        assert svc.can_eliminate([{"key": "A"}, {"key": "B"}]) is False

    def test_three_options_can_be_eliminated(self):
        assert svc.can_eliminate([{"key": "A"}, {"key": "B"}, {"key": "C"}]) is True

    def test_four_options_can_be_eliminated(self):
        assert svc.can_eliminate([{"key": k} for k in "ABCD"]) is True


class TestApplyEliminate:
    def test_keeps_correct_and_exactly_one_wrong(self):
        options = [{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}, {"key": "C", "text": "丙"}, {"key": "D", "text": "丁"}]
        result = svc.apply_eliminate(options, "B", random.Random(1))
        assert len(result) == 2
        keys = {o["key"] for o in result}
        assert "B" in keys
        assert keys != {"B"}  # the other kept option is some wrong one

    def test_deterministic_given_same_rng_seed(self):
        options = [{"key": "A"}, {"key": "B"}, {"key": "C"}, {"key": "D"}]
        a = svc.apply_eliminate(options, "A", random.Random(42))
        b = svc.apply_eliminate(options, "A", random.Random(42))
        assert a == b

    def test_original_option_dicts_are_not_mutated(self):
        options = [{"key": "A"}, {"key": "B"}, {"key": "C"}]
        snapshot = [dict(o) for o in options]
        svc.apply_eliminate(options, "A", random.Random(1))
        assert options == snapshot

    def test_raises_when_options_too_few(self):
        with pytest.raises(ValueError):
            svc.apply_eliminate([{"key": "A"}, {"key": "B"}], "A", random.Random(1))

    def test_keeps_original_key_letters_not_relettered(self):
        options = [{"key": "B", "text": "乙"}, {"key": "D", "text": "丁"}, {"key": "A", "text": "甲"}]
        result = svc.apply_eliminate(options, "A", random.Random(7))
        kept_keys = {o["key"] for o in result}
        assert "A" in kept_keys
        assert kept_keys.issubset({"A", "B", "D"})


class TestBuildHint:
    def test_zhuyin_hint_shows_surrounding_word(self):
        payload = {"source_module": "zhuyin", "stem": "男孩叫正太。", "extra": {"target_index": 4}}
        hint = svc.build_hint(payload)
        assert hint is not None
        assert "太" in hint
        # Must never leak the raw correct_key / reading answer itself.
        assert "correct_key" not in hint

    def test_zhuyin_without_target_index_has_no_hint(self):
        payload = {"source_module": "zhuyin", "stem": "男孩叫正太。", "extra": {}}
        assert svc.build_hint(payload) is None

    def test_zhuyin_out_of_range_target_index_has_no_hint(self):
        payload = {"source_module": "zhuyin", "stem": "太", "extra": {"target_index": 99}}
        assert svc.build_hint(payload) is None

    @pytest.mark.parametrize("module", ["vocab_definitions", "vocab_application", "comprehension"])
    def test_other_modules_have_no_hint_data_today(self, module):
        payload = {"source_module": module, "stem": "任何題幹"}
        assert svc.build_hint(payload) is None

    def test_hint_never_includes_the_answer_rationale_field(self):
        payload = {
            "source_module": "comprehension",
            "stem": "下列何者正確？",
            "explanation": "因為正解是 B，課文第二段有提到",
        }
        hint = svc.build_hint(payload)
        assert hint is None  # no hint data for comprehension today (documented)
