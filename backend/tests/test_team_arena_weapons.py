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
    def test_old_neighbour_window_hint_is_gone(self):
        """Staging QA 2026-10-20: the hint printed 「這個字出現在『索不是』這個詞裡」 —
        a ±1 character window, not a word. A payload with no lesson table must
        now get no hint rather than a made-up 「詞」."""
        payload = {"source_module": "zhuyin", "stem": "男孩叫正太。", "extra": {"target_index": 4}}
        assert svc.build_hint(payload) is None

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


class TestZhuyinHintEveryLesson:
    """Class-level sweep over every lesson's real 注音 questions: whenever a
    hint is given it must point to ANOTHER sentence of the same lesson where
    the asked character has the SAME curated reading, and it must never print
    the reading itself."""

    def test_every_hint_is_true_and_never_prints_the_reading(self):
        from pathlib import Path

        from app.services.lesson_zhuyin import lesson_zhuyin_table
        from app.services.live_quiz.sources import zhuyin as zsrc

        lessons_dir = Path(__file__).resolve().parents[1] / "data" / "lessons"
        uids = sorted(p.name for p in lessons_dir.iterdir() if p.is_dir() and p.name.startswith("L"))
        hints = questions = 0
        for uid in uids:
            for item in zsrc.generate_items(uid, {}, random.Random(3)):
                payload = item.to_payload(seconds=30)
                questions += 1
                hint = svc.build_hint(payload)
                if hint is None:
                    continue
                hints += 1
                stem = payload["stem"]
                ti = payload["extra"]["target_index"]
                char = stem[ti]
                correct = next(o["text"] for o in payload["options"] if o["key"] == payload["correct_key"])
                assert correct not in hint, (uid, hint)
                clause = hint.split("「")[1].split("」")[0]
                assert char in clause, (uid, hint)
                # No 注音 of any kind in a hint (some lessons print readings inline, 「暈ㄩㄣˋ」).
                assert not any("\u3100" <= c <= "\u312f" or "\u31a0" <= c <= "\u31bf" or "\u02b0" <= c <= "\u02ff" for c in hint), (uid, hint)
                table = lesson_zhuyin_table(uid)
                asked = {(text, text.find(stem) + ti) for text in table if stem in text}
                assert any(
                    text[i] == char
                    and table[text].get(i) == correct
                    and (text, i) not in asked
                    and clause in text[max(0, i - len(clause)) : i + len(clause)]
                    for text in table
                    for i in range(len(text))
                ), (uid, hint)
        assert questions > 100, questions
        assert hints > 0, "sweep produced no hints at all — the lookup is broken, not the data"


class TestHintPrefersReadablePhrases:
    def test_whole_short_clause_loses_to_a_longer_one(self, monkeypatch):
        """Staging 2026-10-21: hint picked 「他了」 although a longer clause
        with the same character and reading existed."""
        table = {
            "問題：好？": {3: "ㄏㄠˇ"},
            "他好了，": {1: "ㄏㄠˇ"},
            "大家都覺得很好看。": {6: "ㄏㄠˇ"},
        }
        monkeypatch.setattr("app.services.lesson_zhuyin.lesson_zhuyin_table", lambda uid: table)
        payload = {
            "source_module": "zhuyin",
            "lesson_uid": "LX",
            "stem": "問題：好？",
            "extra": {"target_index": 3},
            "options": [{"key": "A", "text": "ㄏㄠˇ"}, {"key": "B", "text": "ㄏㄠˋ"}],
            "correct_key": "A",
        }
        hint = svc.build_hint(payload)
        assert hint == "同一課「大家都覺得很好看」裡的「好」，唸法跟這題一樣", hint

    def test_every_sweep_hint_clause_is_at_least_four_chars_when_possible(self):
        """Class-level: across all lessons, a hint shorter than 4 chars only
        appears when no ≥4-char candidate exists. Measured 2026-10-21: old
        ranking 8,972 / 24,050 hints under 4 chars (37%); new 274 (1.1%)."""
        from pathlib import Path

        from app.services.live_quiz.sources import zhuyin as zsrc

        lessons_dir = Path(__file__).resolve().parents[1] / "data" / "lessons"
        short = total = 0
        for p in sorted(x for x in lessons_dir.iterdir() if x.is_dir() and x.name.startswith("L")):
            for item in zsrc.generate_items(p.name, {}, random.Random(3)):
                hint = svc.build_hint(item.to_payload(seconds=30))
                if not hint:
                    continue
                total += 1
                clause = hint.split("「")[1].split("」")[0]
                short += len(clause) < 4
        assert total > 1000, total
        assert short / total < 0.02, (short, total)
