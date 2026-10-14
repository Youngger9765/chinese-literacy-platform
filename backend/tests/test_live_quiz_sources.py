"""Unit tests for the question-source adapters (comprehension /
vocab_definitions / vocab_application). TDD: written before any adapter
existed; lesson fixtures are small inline dicts, not real yml files, so
these stay fast and independent of curriculum content changes.
"""
import random

from app.services.live_quiz.sources import comprehension, vocab_application, vocab_definitions
from app.services.live_quiz.sources.base import QuizItem, QuizOption


def _lesson(**extra):
    base = {"title": "測試課文", "version_id": "v3"}
    base.update(extra)
    return base


class TestComprehensionAdapter:
    def test_generates_one_item_per_valid_question(self):
        lesson = _lesson(comprehension={
            "questions": [
                {"index": 1, "stem": "第一題？", "answer": "B",
                 "options": {"A": "甲", "B": "乙", "C": "丙", "D": "丁"}},
                {"index": 2, "stem": "第二題？", "answer": "A",
                 "options": {"A": "甲", "B": "乙"}},
            ]
        })
        items = comprehension.generate_items("L0001", lesson)
        assert len(items) == 2
        assert items[0].correct_key == "B"
        assert items[0].source_module == "comprehension"
        assert items[0].lesson_uid == "L0001"
        assert items[0].version_id == "v3"
        assert items[0].source_index == "1"

    def test_rejects_multi_answer_handwritten_correction(self):
        """CTO review #5: "轉接層只收「正解是單一 A–D」的題目"."""
        lesson = _lesson(comprehension={"questions": [
            {"index": 1, "stem": "有爭議的題？", "answer": "A/C",
             "options": {"A": "甲", "B": "乙", "C": "丙", "D": "丁"}},
        ]})
        assert comprehension.generate_items("L0001", lesson) == []

    def test_rejects_answer_not_in_options(self):
        lesson = _lesson(comprehension={"questions": [
            {"index": 1, "stem": "題幹", "answer": "D", "options": {"A": "甲", "B": "乙"}},
        ]})
        assert comprehension.generate_items("L0001", lesson) == []

    def test_no_comprehension_module_returns_empty(self):
        assert comprehension.generate_items("L0001", _lesson()) == []


class TestVocabDefinitionsAdapter:
    def test_distractors_come_from_same_lesson_bank_only(self):
        lesson = _lesson(vocab_definitions={
            "vocabulary_bank": ["自告奮勇", "事在人為", "不堪設想", "情有可原"],
            "items": [
                {"index": 1, "word": "自告奮勇", "definition": "自己主動要求承擔任務。"},
            ],
        })
        rng = random.Random(42)
        items = vocab_definitions.generate_items("L0001", lesson, rng)
        assert len(items) == 1
        item = items[0]
        assert item.stem == "自己主動要求承擔任務。"
        option_texts = {o.text for o in item.options}
        assert option_texts <= {"自告奮勇", "事在人為", "不堪設想", "情有可原"}
        assert "自告奮勇" in option_texts
        correct = next(o for o in item.options if o.key == item.correct_key)
        assert correct.text == "自告奮勇"

    def test_too_few_bank_words_skips_lesson(self):
        lesson = _lesson(vocab_definitions={
            "vocabulary_bank": ["孤單"],
            "items": [{"index": 1, "word": "孤單", "definition": "單獨一人。"}],
        })
        assert vocab_definitions.generate_items("L0001", lesson, random.Random(1)) == []

    def test_deterministic_given_same_seed(self):
        lesson = _lesson(vocab_definitions={
            "vocabulary_bank": ["甲詞", "乙詞", "丙詞", "丁詞", "戊詞"],
            "items": [{"index": 1, "word": "甲詞", "definition": "定義甲。"}],
        })
        items_a = vocab_definitions.generate_items("L0001", lesson, random.Random(7))
        items_b = vocab_definitions.generate_items("L0001", lesson, random.Random(7))
        assert [o.text for o in items_a[0].options] == [o.text for o in items_b[0].options]


class TestVocabApplicationAdapter:
    def test_builds_item_from_option_bank(self):
        lesson = _lesson(vocab_application={
            "option_bank": {"A": "自告奮勇", "B": "事在人為", "C": "不堪設想", "D": "情有可原", "E": "苛責"},
            "items": [{"index": 1, "stem": "他(　)擔任組長。", "answer": "A"}],
        })
        rng = random.Random(3)
        items = vocab_application.generate_items("L0001", lesson, rng)
        assert len(items) == 1
        item = items[0]
        correct = next(o for o in item.options if o.key == item.correct_key)
        assert correct.text == "自告奮勇"

    def test_unknown_answer_code_skipped(self):
        lesson = _lesson(vocab_application={
            "option_bank": {"A": "甲", "B": "乙"},
            "items": [{"index": 1, "stem": "題幹", "answer": "Z"}],
        })
        assert vocab_application.generate_items("L0001", lesson, random.Random(1)) == []


class TestQuizItemInvariants:
    def test_rejects_fewer_than_two_options(self):
        try:
            QuizItem(
                source_module="x", lesson_uid="L1", lesson_title="t", stem="s",
                options=[QuizOption(key="A", text="only one")], correct_key="A",
            )
            assert False, "should have raised"
        except ValueError:
            pass

    def test_rejects_correct_key_not_among_options(self):
        try:
            QuizItem(
                source_module="x", lesson_uid="L1", lesson_title="t", stem="s",
                options=[QuizOption(key="A", text="a"), QuizOption(key="B", text="b")],
                correct_key="Z",
            )
            assert False, "should have raised"
        except ValueError:
            pass

    def test_item_id_is_stable_composite(self):
        item = QuizItem(
            source_module="comprehension", lesson_uid="L0001", lesson_title="t",
            version_id="v3", source_index="2", stem="s",
            options=[QuizOption(key="A", text="a"), QuizOption(key="B", text="b")],
            correct_key="A",
        )
        assert item.item_id == "comprehension:L0001:v3:2"
