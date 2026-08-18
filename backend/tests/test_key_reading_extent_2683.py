"""重點朗讀只取老師標的那一段，不做長度推論 (#2683).

REPORTED by 靖杭 on staging: 「大部分課程的朗讀範圍都比教授畫的範圍多出不少」.

REPRODUCED against the first edition's table, which was extracted from the printed
worksheets the professor marked:

    教授畫的      中位 153 字
    現在產出的    中位 370 字
    67 課可比對，其中 60 課超過教授範圍的 1.5 倍
    最糟 L0110：教授 22 字 → 429 字

ROOT CAUSE, and it is mine. The extractor took ONE paragraph from the anchor, which is
what the first edition did — its file header says so outright: 「新規則：只取 ☞ 那一段」.
I replaced that with an accumulation to ≥300 characters, reasoning that a single
paragraph runs 145 characters at the median and a student reading aloud for the timed
minute would run out of text.

That reasoning was about the TIMER. The passage is what the professor MARKED. Those are
different things, and I overrode a marking with an inference — the inference even looked
well-founded, because I measured the median before deciding.

The instruction 「從指定段落（四）開始朗讀，計時 1 分鐘讀的字數」 says where to START,
and how long the student reads is the student's business, not the extractor's.
"""

import os
import statistics
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _with_key_reading():
    from app.services.lesson_loader import get_all_lessons

    return [l for l in get_all_lessons() if l.get("key_reading")]


#: How many stored paragraphs one PRINTED paragraph may span (#2720).
#:
#: This assertion used to require exactly one. That was right when the passage was an
#: index into `body.yml`, and wrong once the anchor started reading the worksheet's own
#: 段號欄: Word splits a paragraph at a manual line break in a handful of lessons, so
#: the paragraph the professor numbered is two stored ones. 《感情小日記1》 is 176 + 24
#: characters, and requiring a single paragraph served the 176 — cutting off at
#: 「只要一想到可能會跟他」, mid-sentence.
#:
#: Still bounded, because the property this test exists to protect is unchanged: a
#: passage must not be a span ASSEMBLED to reach a length, which is what #2712 was. An
#: unbounded run would permit exactly that. Three is above every observed split (all are
#: two) and far below any length-driven assembly.
MAX_BODY_SPAN = 3


def test_the_passage_is_one_paragraph_of_the_lesson():
    """Not a span assembled to hit a length. Every passage must be one of the lesson's
    own paragraphs, or a short run of consecutive ones that Word had split."""
    assembled = []
    for l in _with_key_reading():
        passage = "".join(l["key_reading"]["passage"].split())
        paras = ["".join(p.split()) for p in (l.get("paragraphs") or [])]
        ok = False
        for i in range(len(paras)):
            acc = ""
            for j in range(i, min(i + MAX_BODY_SPAN, len(paras))):
                acc += paras[j]
                if acc == passage:
                    ok = True
                    break
                if len(acc) > len(passage):
                    break
            if ok:
                break
        if not ok:
            assembled.append((l["lesson_uid"], len(passage)))
    assert assembled == [], (
        f"{len(assembled)} passages are neither a paragraph nor a run of "
        f"{MAX_BODY_SPAN}: {assembled[:4]}"
    )


def test_the_passages_are_the_length_the_professor_marked():
    """The distribution, not one lesson. 靖杭 reported the ranges were 「多出不少」, and
    the median is the shape of that complaint: 370 against the professor's 153."""
    lengths = [len(l["key_reading"]["passage"]) for l in _with_key_reading()]
    assert lengths, "no lesson carries a key reading passage"
    median = statistics.median(lengths)
    assert median <= 220, (
        f"median passage is {median:.0f} characters; the professor's marked ranges run "
        "153 at the median, so anything approaching 300+ is an inferred extent rather "
        "than a marked one"
    )
