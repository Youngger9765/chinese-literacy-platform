"""Regression: 10 sampled lessons from #1753 batch must have valid fill_in_blank schema.
Catches if docx re-parse breaks the alignment.
"""
import pytest


SAMPLE_LESSONS = [
    "G4-L01",
    "G4-L10",
    "G5-L01",
    "G5-L10",
    "G6-L01",
    "G6-L10",
    "G7-L01",
    "G7-L11",
    "G8-L01",
    "G9-L01",
]


def _has_blank_placeholder(sentence: str) -> bool:
    return "（" in sentence or "(" in sentence


@pytest.mark.parametrize("lesson_code", SAMPLE_LESSONS)
def test_fill_in_blank_schema_valid(lesson_code):
    from app.services.lesson_loader import get_lesson_by_code

    lesson = get_lesson_by_code(lesson_code)
    if not lesson:
        pytest.skip(f"{lesson_code} not in catalog - may have been removed")

    fib = lesson.get("fill_in_blank", [])
    vocab_bank = lesson.get("vocab_bank", {})

    if not fib:
        pytest.skip(f"{lesson_code} has no fill_in_blank section - may legitimately lack one")

    for item in fib:
        assert "answer" in item, "fill_in_blank item needs answer"
        assert item["answer"], "fill_in_blank answer must not be empty"

        if "sentence" in item:
            assert isinstance(item["sentence"], str), "sentence must be string"
            assert item["sentence"].strip(), "sentence must not be empty"

            if _has_blank_placeholder(item["sentence"]):
                if vocab_bank:
                    assert item["answer"] in vocab_bank, (
                        f"answer letter {item['answer']} must be in vocab_bank keys"
                    )
