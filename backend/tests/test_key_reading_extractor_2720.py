"""抽取器的邏輯本身，不經過資料 (#2720).

WHY THIS FILE EXISTS — the gap the CI wiring did not close
----------------------------------------------------------
`test_key_reading_numbering_2720.py` asserts that the SHIPPED `key_reading.yml` files
name the paragraph the professor marked. That is the right assertion about the data, and
it is now in CI. But it says nothing about the code:

  · change `scripts/extract_key_reading.py` and do NOT re-run `build_key_reading.py`,
    and the data test still passes — it is validating yesterday's output
  · change it and DO re-run, and the data test covers it, but only for whatever the 175
    worksheets happen to exercise

So a `scripts/**` trigger on a data-only test is theatre of a subtler kind: the job runs,
and it cannot fail for the reason the trigger exists. Pointed out in review 2026-08-20.

This file closes that by calling the functions directly. Every case below is a rule the
extractor got wrong at some point in #2720, written as the input that broke it.

WHY THESE ARE PURE-FUNCTION TESTS AND NOT FIXTURES
--------------------------------------------------
No DOCX, no `backend/data`, no `/tmp/docx-src`. The second-edition worksheets are not in
the repo and cannot be in CI (#2803), and a test that self-skips without them is the
thing this file is reacting to. The counting and numeral rules do not need a worksheet to
be wrong — they need a list and a number.

`extract_key_reading.py` imports `python-docx` lazily, inside `read_numbered_body()`, so
this file imports cleanly without it. That matters: `python-docx` is a build-time
dependency and is deliberately absent from `backend/requirements.txt` — adding it there to
make a test importable would ship a DOCX parser in the serving image.
"""

import os
import sys

import pytest

# `scripts/` is not a package (no `__init__.py`), so it goes on the path directly.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))

from extract_key_reading import (  # noqa: E402
    MAX_UNNUMBERED_TAIL,
    _is_body_span,
    _is_heading,
    absorb_split_tail,
    align_to_numbering,
    cn_to_int,
    find_anchor,
)


# --------------------------------------------------------------------------- numerals

@pytest.mark.parametrize("text,expected", [
    ("一", 1), ("三", 3), ("十", 10),
    ("十一", 11), ("十九", 19),
    ("二十", 20), ("三十", 30),                  # returned None before #2720
    ("二十一", 21), ("三十五", 35),
    ("4", 4), ("１２", 12),                       # full-width, NFKC-folded
])
def test_cn_to_int_reads_the_forms_the_worksheets_print(text, expected):
    assert cn_to_int(text) == expected


def test_cn_to_int_reads_the_bopomofo_one():
    """「ㄧ」 is U+3127 BOPOMOFO LETTER I, not 「一」 U+4E00.

    It is what a large share of worksheets actually print for the first paragraph. A
    CJK-only numeral class made those lessons look unnumbered, so the whole lesson fell
    back to reading the entire text.
    """
    assert cn_to_int("ㄧ") == 1
    assert cn_to_int("一") == 1


@pytest.mark.parametrize("text", ["", "  ", "甲", "壹", "一二三"])
def test_cn_to_int_refuses_what_it_cannot_read(text):
    """None, not a guess. A wrong anchor is served silently; a missing one falls back."""
    assert cn_to_int(text) is None


# --------------------------------------------------------------------------- anchor

def test_find_anchor_reads_the_timer_instruction():
    assert find_anchor(["請用計時器，從指定段落（三）開始朗讀，計時1分鐘讀的字數。"]) == 3


@pytest.mark.parametrize("line", [
    "請用計時器，從指定段落(三)開始朗讀",          # half-width parens
    "請用計時器，從指定段落（三    )開始朗讀",      # unclosed / tab-padded, seen in real files
    "請用計時器，從指定段落 三 開始朗讀",           # no parens at all
])
def test_find_anchor_survives_the_punctuation_the_form_actually_uses(line):
    assert find_anchor([line]) == 3


def test_find_anchor_returns_none_when_the_worksheet_sets_no_start():
    """28 lessons have no 念順順 at all. That is not a failure — it is a lesson with no
    key reading, and it must not be turned into one."""
    assert find_anchor(["讀全文-做記號", "※ 如果你有做到下列事項，請在□內打勾。"]) is None


# --------------------------------------------------------------------------- headings

def test_a_short_unpunctuated_line_is_a_heading():
    """說明文 prints 「無形的殺手」 above a run of paragraphs and does not number it."""
    assert _is_heading("無形的殺手")
    assert _is_heading("人工噴農藥")


def test_a_sentence_is_not_a_heading_however_short():
    assert not _is_heading("我到底是怎麼了？")
    assert not _is_heading("他決定開始種樹。")


def test_a_line_ending_in_an_ellipsis_is_not_a_heading():
    """「……」 ends a paragraph.

    Leaving it out of the sentence-end set merged 《感情小日記2》's 22-character opening
    line into the next paragraph, hit the author's paragraph count by luck, and produced
    the wrong passage — on the very lesson this mechanism was worked out on.
    """
    assert not _is_heading("最近心情起起伏伏，變得好不習慣，好不像我……")


# ------------------------------------------------------------------- align_to_numbering

def test_counts_within_the_tail_bound_are_left_alone():
    """One or two unnumbered closing lines sit AFTER every anchor, so indexing lands.
    Transforming here would solve a problem that is not present — and the first version
    of this function did exactly that, and broke 《感情小日記2》."""
    marks = ["一", "二", "三"]
    paras = ["第一段。", "第二段。", "第三段。", "沒有編號的收尾句。"]
    assert align_to_numbering(marks, paras) == paras
    assert len(paras) - len(marks) <= MAX_UNNUMBERED_TAIL


def test_sub_headings_are_dropped_to_reach_the_authors_count():
    marks = ["一", "二"]
    paras = ["人工噴農藥", "噴灑農藥就可殺死秋行軍蟲，然而要有效防治，必須重複噴藥。",
             "寄生蜂片", "昆蟲學家發現，一種寄生蜂是秋行軍蟲的天敵。", "寄生蜂扭蛋"]
    assert align_to_numbering(marks, paras) == [
        "噴灑農藥就可殺死秋行軍蟲，然而要有效防治，必須重複噴藥。",
        "昆蟲學家發現，一種寄生蜂是秋行軍蟲的天敵。",
    ]


def test_alignment_does_not_merge_within_the_tail_bound():
    """Counting-wise this is correct: 3 paragraphs against 2 marks is within the bound,
    so the list passes through. Finishing a split sentence is a different job — see
    `absorb_split_tail` below, which is where that shipped broken."""
    marks = ["一", "二"]
    paras = ["第一段结束了。", "回家路上，只要一想到可能會跟他",
             "有多一些互動，我就會覺得這一天好像變得特別一點。"]
    assert align_to_numbering(marks, paras) == paras


def test_two_real_paragraphs_are_not_merged_just_because_it_reaches_the_count():
    """The count is necessary, not sufficient.

    Merging here would hit len(marks) == 2 and be wrong: 「……」 ends the first paragraph,
    so the two are separate. This is the exact failure that shipped for one revision.
    """
    marks = ["一", "二"]
    paras = ["最近心情起起伏伏，變得好不習慣，好不像我……",
             "上課時，我明明想專心聽老師講解，但眼神總是不自覺飄向前排。",
             "然而最近我更發現他和其他同學聊天聊得很開心。"]
    aligned = align_to_numbering(marks, paras)
    # 3 paras vs 2 marks is within the tail bound, so it must pass through untouched
    # rather than be merged down to 2.
    assert aligned == paras


def test_withholds_when_no_transformation_reaches_the_count():
    """Every lesson measured in this state produced the wrong paragraph, so None."""
    marks = ["一", "二"]
    paras = ["第一段有內容而且很長，長到不會被當成標題處理。",
             "第二段也一樣長，一樣不是標題，一樣以句號結束。",
             "第三段同理，長度足夠且結尾完整。",
             "第四段也是，這樣就湊不回兩段了。",
             "第五段再補一段，確定湊不回去。"]
    assert align_to_numbering(marks, paras) is None


def test_withholds_when_the_cell_has_fewer_paragraphs_than_marks():
    """The cell lost a numbered paragraph — indexing cannot be trusted either way."""
    assert align_to_numbering(["一", "二", "三"], ["只有一段。"]) is None


# --------------------------------------------------------------- absorb_split_tail

def test_a_passage_that_ends_mid_sentence_absorbs_its_tail():
    """《感情小日記1》 shipped 176 characters ending 「只要一想到可能會跟他」 and dropped
    the 24-character tail. 《黃絲帶》 stopped at 「然後，這首歌出現了：」 and dropped the
    song. Both were WRITTEN, not withheld."""
    paras = ["第一段。", "回家路上，只要一想到可能會跟他",
             "有多一些互動，我就會覺得這一天好像變得特別一點。", "下一段。"]
    assert absorb_split_tail(paras, 1) == (
        "回家路上，只要一想到可能會跟他有多一些互動，我就會覺得這一天好像變得特別一點。")


def test_a_passage_that_already_ends_a_sentence_absorbs_nothing():
    paras = ["第一段。", "這一段自己就講完了。", "下一段不該被吃掉。"]
    assert absorb_split_tail(paras, 1) == "這一段自己就講完了。"


@pytest.mark.parametrize("ending", ["。", "！", "？", "」", "』", "…", "⋯"])
def test_every_sentence_ending_stops_absorption(ending):
    """「……」 counts. Leaving it out is what merged two real paragraphs of 《感情小日記2》."""
    paras = [f"這一段以{ending}結束" + ending, "下一段不該被吃掉。"]
    assert absorb_split_tail(paras, 0) == f"這一段以{ending}結束" + ending


def test_absorption_is_bounded():
    """An unbounded walk would swallow the rest of the lesson when no paragraph in the
    cell ends a sentence — which is a parsing failure, not a passage."""
    paras = ["沒有結尾一", "沒有結尾二", "沒有結尾三", "沒有結尾四", "沒有結尾五"]
    absorbed = absorb_split_tail(paras, 0)
    assert absorbed == "沒有結尾一沒有結尾二沒有結尾三"


def test_absorption_stops_at_the_end_of_the_cell():
    assert absorb_split_tail(["最後一段沒有句號"], 0) == "最後一段沒有句號"


# ------------------------------------------------------------------------ body span

def test_a_single_stored_paragraph_is_a_span():
    body = ["第一段。", "第二段。"]
    assert _is_body_span("第二段。", body)


def test_a_run_of_consecutive_stored_paragraphs_is_a_span():
    """One printed paragraph can be two stored ones (Word split it). Serving only the
    first cuts the passage off mid-sentence."""
    body = ["開頭。", "前半句沒有講完", "後半句補上了。"]
    assert _is_body_span("前半句沒有講完後半句補上了。", body)


def test_text_that_is_not_in_the_body_is_not_a_span():
    """#1208 / #2698 recurrence: 《十秒的背後》 once served a passage about a bus seat."""
    assert not _is_body_span("這段文字不在這一課裡。", ["第一段。", "第二段。"])


def test_a_non_consecutive_combination_is_not_a_span():
    """Skipping a paragraph and gluing the neighbours is how a passage gets assembled to
    hit a length (#2712), so it must not read as one paragraph."""
    body = ["甲甲甲甲。", "乙乙乙乙。", "丙丙丙丙。"]
    assert not _is_body_span("甲甲甲甲。丙丙丙丙。", body)
