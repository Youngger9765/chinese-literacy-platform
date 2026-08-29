"""排序題的句子必須跟著題目一起被抽出來 (#2683).

Young opened 《十秒的背後》 閱讀聚光燈 and saw

    3.〈𪹚龍慶元宵〉　彭仁星

standing alone, and asked what it was. It is the third practice item: a different short
article the student orders by time, using the same 順敘 strategy the lesson teaches. The
DOCX has it as an answer slot and a sentence, alternating:

    3.〈𪹚龍慶元宵〉　彭仁星
    （ 4 ）   元宵節過後，「化龍返天」是活動的尾聲…
    （ 1 ）   今年元宵節前，我回到苗栗的阿公家…
    （ 3 ）   元宵夜，我們到公園參加「𪹚龍之夜」…
    （ 2 ）   元宵節前一天，街上家家戶戶歡喜的「迎龍」…

The extractor keeps the prompt and drops all four sentences, so the student is shown a
title with nothing under it. The same happens to item 1, whose four sentences are the
lesson's own events.

Written before the fix, as the definition of correct: an ordering prompt that arrives
with no items is not a usable exercise, whatever else the block looks like.
"""

import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

#: 「…依先後順序在（ ）中填入1~4」 and friends — a prompt that asks the student to number
#: things must be followed by the things.
_ORDERING_PROMPT = re.compile(r"先後順序|順序.*填入|填入\s*1\s*[~～-]\s*\d")


def _spotlight_lessons():
    from app.services.lesson_loader import get_all_lessons

    return [l for l in get_all_lessons() if l.get("spotlight_v2")]


def _blocks(lesson):
    return (lesson.get("spotlight_v2") or {}).get("blocks") or []


def test_the_lesson_young_asked_about_shows_its_ordering_items():
    lesson = next((l for l in _spotlight_lessons() if l["id"] == 20001), None)
    assert lesson, "20001 《十秒的背後》 has no spotlight"

    # ⚠️ 原本只讀頂層 block 的 prompt/text/paragraphs。二修之後 `ordering` block
    #    把項目放在巢狀結構裡（`items` 之類），於是這條報「item 3's title is gone」
    #    ——而字串一直都在 spotlight_v2 裡，只是換了位置。
    #    這條要問的是「內容有沒有送到學生面前」，不是「放在哪個欄位」，
    #    所以改成遞迴收所有字串，不綁形狀。
    def _all_text(o) -> str:
        if isinstance(o, str):
            return o
        if isinstance(o, dict):
            return " ".join(_all_text(v) for v in o.values())
        if isinstance(o, list):
            return " ".join(_all_text(v) for v in o)
        return ""

    joined = _all_text(_blocks(lesson))
    assert len(joined) > 100, f"攤平後只有 {len(joined)} 字 —— 攤平器壞了，不是內容不見"
    assert "𪹚龍慶元宵" in joined, "item 3's title is gone"
    for sentence in ("化龍返天", "回到苗栗的阿公家", "𪹚龍之夜", "家家戶戶歡喜的「迎龍」"):
        assert sentence in joined, (
            f"item 3 is a title with nothing under it — 「{sentence}」 was dropped"
        )


def test_an_ordering_prompt_never_arrives_without_its_items():
    """The general form. A prompt telling the student to number events, followed by
    nothing to number, is not an exercise — it is what Young saw."""
    bare = []
    for lesson in _spotlight_lessons():
        blocks = _blocks(lesson)
        for i, b in enumerate(blocks):
            text = str(b.get("prompt") or b.get("text") or "")
            if not _ORDERING_PROMPT.search(text):
                continue
            # Whatever carries the items may follow as its own block(s); require SOME
            # orderable content before the next prompt-like block.
            found = False
            for nxt in blocks[i + 1:]:
                if nxt.get("type") in ("free_text", "single", "multi") and \
                        str(nxt.get("prompt") or "").strip():
                    break
                if nxt.get("items") or nxt.get("paragraphs") or nxt.get("options"):
                    found = True
                    break
            if not found:
                bare.append((lesson["lesson_uid"], text[:34]))
    assert bare == [], f"ordering prompts with nothing to order: {bare[:5]}"
