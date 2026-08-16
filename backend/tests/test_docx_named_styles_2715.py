"""抽取器必須讀 DOCX 的具名樣式與符號 (#2715).

The worksheets declare their teaching semantics. They are not implicit in the layout and
they do not need to be guessed at:

    教材：教師解答          169 / 175 lessons   the marker's answers
    教材：表格文字          148
    教材：課文內文           60                 the lesson body
    教材：(1)＿：填空題目     58                 fill-in-blank questions
    教材：教師解答文字框       5
    教材：練習題目（文字）      4

    Wingdings F0FE (☑)   1806 occurrences      every ticked answer

`_paragraphs()` takes the text of every `<w:t>` and throws away the run that wraps it,
so none of this reaches the extractor. Four heuristics were written this week to strip
teacher annotations by shape — paragraph-citation pattern, parenthetical-is-a-vocabulary-
word, length threshold, every-option-is-marked — each measured, each guarded against
false positives, each mutation-tested. They were guessing at something the file states.

Written before the fix. The reader must return, for each paragraph, the text AND which
runs carry which named style.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))

import pytest

SRC = Path("/tmp/docx-src")
pytestmark = pytest.mark.skipif(not SRC.is_dir(), reason="worksheet sources not present")


def test_the_reader_exposes_named_styles():
    from extract_lesson_body import read_runs

    runs = read_runs(SRC / "L0001.docx")
    assert runs, "no runs returned"
    named = {r["style_name"] for para in runs for r in para if r.get("style_name")}
    assert "教材：教師解答" in named, (
        f"the teacher-answer style is not exposed; got {sorted(named)[:8]}"
    )


def test_the_teacher_answer_in_the_ordering_table_is_identified():
    """「（ 4 ）」 is three runs: the parentheses plain, the digit carrying
    教材：教師解答. That digit is the answer and must be identifiable as one."""
    from extract_lesson_body import read_runs

    for para in read_runs(SRC / "L0001.docx"):
        text = "".join(r["text"] for r in para)
        if text.strip() != "（ 4 ）":
            continue
        answers = [r["text"] for r in para if r.get("style_name") == "教材：教師解答"]
        assert answers == ["4"], f"expected the digit to be marked, got {answers}"
        return
    pytest.fail("the ordering answer cell was not found at all")


def test_ticked_checkboxes_are_visible_to_the_reader():
    """Wingdings F0FE is ☑. It appears 1806 times across the corpus and marks the
    chosen option of every multiple-choice question; the text-only reader sees none."""
    from extract_lesson_body import read_runs

    ticked = 0
    for para in read_runs(SRC / "L0002.docx"):
        ticked += sum(1 for r in para if r.get("sym") == ("Wingdings", "F0FE"))
    assert ticked > 0, "no ticked checkbox found — symbols are still being discarded"


def test_the_plain_text_reader_still_works_unchanged():
    """`_paragraphs()` is used by every other extractor. Adding a richer reader beside
    it must not change what it returns."""
    from extract_lesson_body import _paragraphs, read_runs

    plain = _paragraphs(SRC / "L0001.docx")
    # `_paragraphs` strips; the rich reader keeps the runs as they are, so compare
    # stripped. The leading spaces are the worksheet's own indentation.
    rich = ["".join(r["text"] for r in para).strip()
            for para in read_runs(SRC / "L0001.docx")]
    assert len(plain) == len(rich), f"{len(plain)} paragraphs vs {len(rich)}"
    mismatched = [(i, a, b) for i, (a, b) in enumerate(zip(plain, rich)) if a and a != b]
    assert mismatched[:3] == [], f"the two readers disagree: {mismatched[:3]}"


def test_no_body_paragraph_carries_a_teacher_answer():
    """A cheap boundary check that only the named styles make possible.

    A paragraph of the lesson text does not contain the marker's answers. Where one
    does, the paragraph is not body — it is exercise material that got past the section
    boundary. Found this way:

        L0137  (6)眾說紛紜:各式各樣的說法…        a vocabulary definition row
        L0144  (A)3.本文第6至8段寫到…             a comprehension question with its answer

    Both are boundary failures the existing length-and-prefix rules did not catch, and
    neither is visible without reading the run styles.
    """
    import sys as _s
    from pathlib import Path as _P

    from app.services.lesson_loader import get_all_lessons
    from extract_lesson_body import normalise, read_runs

    src = _P("/tmp/docx-src")
    by_uid = {l["lesson_uid"]: l for l in get_all_lessons()}
    leaked = []
    for docx in sorted(src.glob("*.docx")):
        lesson = by_uid.get(docx.stem)
        if not lesson or not lesson.get("paragraphs"):
            continue
        body = {normalise(p) for p in lesson["paragraphs"]}
        for para in read_runs(docx):
            joined = normalise("".join(r["text"] for r in para))
            if joined not in body:
                continue
            if any((r.get("style_name") or "").startswith("教材：教師解答")
                   and r["text"].strip() for r in para):
                leaked.append((docx.stem, joined[:32]))
    assert leaked == [], (
        f"{len(leaked)} body paragraphs contain the marker's answers — they are exercise "
        f"lines that crossed the section boundary: {leaked[:4]}"
    )
