#!/usr/bin/env python3
"""extract_lesson_body.py — pull the 課文 body out of a 學習單 DOCX (#2683).

WHY THIS EXISTS
---------------
The second-edition pipeline emits the worksheet's spotlight and keypoints tables but
not the lesson text itself. `build_lesson_schema.py` never had to: it read paragraphs
back out of `lesson_loader`, which was fed by the first edition's `_parsed_2026-05-01`
layer. That layer is gone, so the circle is broken and all 175 lessons serve zero
paragraphs — which silently removes the source for 朗讀, 閱讀理解, 生字 and 造句, and
leaves 「參考課文」 blank beside the keypoints table.

The text is in the DOCX. Section 一「讀全文-做記號」holds the body and section 二
(「念順順」/「重點朗讀」) closes it.

HOW CORRECTNESS IS CHECKED — and two checks that did NOT work
--------------------------------------------------------------
An extractor with no way to notice it has drifted is a guess, and a wrong body is
worse than none: it would put worksheet questions in front of a student as the text
to read. Two candidate checks were tried and rejected on measurement:

  · the DOCX numbers its own body paragraphs (一 二 三 …). Not 1:1 — some lessons open
    with an unnumbered lead line, some merge two numbered paragraphs into one block.
    Disagreed on 14 of 96 correct extractions.

  · the 念順順 section prints cumulative character counts for the reading timer, and
    names the paragraph the timer starts from. That looked like an exact figure for a
    known sub-range. It is not: matched on 3 of 69, because the counts cover the
    printed excerpt rather than the paragraph range.

What does work is the vocabulary list. Section 三 「語詞我最棒」 names the lesson's
words, authored separately from the body, and those words appear IN the body. If the
boundary is wrong — if the worksheet were captured instead of the text — the words are
not there. Measured across 175 lessons: 63 lessons match ≥80% of their vocabulary,
20 match 50–80%, and 2 fall below (both hand-checked: the body is correct, those two
worksheets simply share little vocabulary with their text).

Comparison needs Unicode normalisation. The DOCX carries variation selectors inside
words (`融為一︀體`), so a literal `in` test reports a miss on a word that is
plainly present — that alone accounted for a third of the early failures.
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
import zipfile
from pathlib import Path
from typing import Optional

_PARA = re.compile(r"<w:p[ >].*?</w:p>", re.S)
# `(.*?)` was `.*?` with DOTALL, which happily crossed nested tags: when a <w:p>
# contains formatting elements between its runs, the lazy match still reached the
# next </w:t> and swallowed the intervening markup as if it were text. The paragraph
# then began with "<w:tab …" and was discarded by the markup guard below — taking the
# real sentence with it. Four of five comprehension questions per lesson vanished
# this way, and it read as "this worksheet only has one question".
_TEXT = re.compile(r"<w:t[^>]*>([^<]*)</w:t>")

# The heading that closes the body. Most worksheets use section 2 (念順順 /
# 重點朗讀), but 文言文 and several 品格教育 lessons follow a different layout with no
# reading-fluency section — there the body is closed by whichever analysis section
# comes next. Matching only the first form left 28 lessons with no boundary at all.
# Tried IN ORDER, first match wins. 文言文 and some 品格教育 lessons use a layout
# with no reading-fluency section, so their body is closed by whichever analysis
# section comes first instead.
#
# Order matters and cost three lessons to learn: adding 閱讀聚光燈 / 文章重點表 as
# equal alternatives made them win in standard worksheets where they appear BEFORE
# 念順順 in document order, truncating bodies that were previously correct. They are
# a separate, later-tried tier for exactly that reason.
_BODY_END_TIERS = (
    ("念順順", "重點朗讀"),                                    # standard worksheet
    ("文白句子比對", "文白詞語比對", "文言文聚光燈", "文言聚光燈"),   # 文言文
    ("故事賞析", "自我挑戰"),                                  # 品格教育
    ("閱讀聚光燈", "文章重點表"),                               # last resort
    ("閱讀理解",),                                             # 7 lessons have only this
)

# A few worksheets close the body with a numbered sub-heading of their own instead of
# a named section — 「一、特殊標點──分號」. Two lessons (G5-L5, G6-L3) print their
# 閱讀聚光燈 heading in the MASTHEAD, above the body, so no named section follows the
# text at all and they would otherwise be dropped despite having 24 body paragraphs.
# The last resort, tried only when no named section follows the body. Two forms
# appear: a numbered sub-heading (「一、特殊標點──分號」) and a ◎-marked one
# (「◎策略說明：」). Both start the exercise material in worksheets whose 閱讀聚光燈
# heading sits in the masthead above the text, leaving nothing named after it.
_FALLBACK_HEADING = re.compile(r"^([一二三四五六七八九十]、|◎)")
# Later section headings, used to bound the vocabulary list.
_SECTIONS = re.compile(
    r"^(語詞我最棒|語詞應用|文章重點表|閱讀聚光燈|閱讀理解|詞語複習|知識補給站)$"
)
_CJK_INDEX = re.compile(r"^[一二三四五六七八九十]$")

# Body paragraphs run from ~46 characters up. Worksheet chrome in the same range —
# the 做記號 checklist, the level line, the byline — is excluded by prefix instead,
# because a threshold high enough to clear it also eats short body paragraphs.
_MIN_BODY = 46
#: The floor for a short paragraph recovered next to a long one. Below this sit the
#: numbering marks (「一」「二」) and table cells, not sentences.
_MIN_SHORT_BODY = 12
#: How far acceptance propagates along a run of short paragraphs. A story's closing
#: lines run two or three short; a scaffolding block runs much longer, so this is what
#: separates them.
_SHORT_RUN_LIMIT = 3
_CHROME_PREFIX = ("※", "□", "☐", "◎", "Level ", "字數", "課文", "學習單", "說明：", "提醒：")
_CHROME_CONTAINS = ("讀全文", "讀課文", "做記號")
# Instruction paragraphs from the NEXT section that sit above its heading in document
# order, so the boundary alone does not exclude them. They read as body text by every
# structural measure — long, prose, in range — and were landing as the last paragraph
# of the lesson: a student would have been asked to read 「請用計時器，從指定段落⋯」
# aloud as if it were the story.
_INSTRUCTION_MARKERS = (
    "請用計時器", "計時1分鐘", "計時3次", "我的表現",
    "請在空格內填入", "請根據文章內容", "請圈出", "找一找：",
    # Strategy scaffolding. In a few worksheets the 閱讀聚光燈 teaching block sits
    # ABOVE its own heading, so it falls inside the body span and only the length
    # filter kept it out — which stopped mattering once short paragraphs were
    # recovered. These are the phrases that scaffolding uses and narrative does not.
    "閱讀文章後", "完成表格", "我們練習", "步驟幫自己", "回看標題", "回看前面",
)

# Structural marks that only ever appear in exercises: an option box, a single/multi
# choice tag, a fill-in bracket. Narrative prose does not contain them. They are
# checked per-paragraph rather than as a boundary because in three lessons the
# exercise material is interleaved with the text rather than following it, so no
# boundary excludes them.
#
# Deliberately NOT included: 下列, 何者, 答案. Those read as exercise language but
# occur in ordinary lesson text — screening on them flagged 24 lessons, 21 of which
# were clean.
_EXERCISE_MARKS = ("（單選）", "(單選)", "（複選）", "(複選)",
                   "□①", "□②", "□③", "□④", "【　", "【  ")
_LESSON_HEADER = re.compile(r"^第\s*[0-9０-９一二三四五六七八九十百]+\s*課")


def _paragraphs(docx: Path) -> list[str]:
    with zipfile.ZipFile(docx) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    out = []
    for p in _PARA.findall(xml):
        t = "".join(_TEXT.findall(p)).strip()
        # A <w:p> with no <w:t> children leaks its own attributes through the join.
        out.append("" if t.startswith("<w:") else t)
    return out


def _unescape(s: str) -> str:
    return (s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
             .replace("&apos;", "'").replace("&amp;", "&"))


def normalise(s: str) -> str:
    """Fold width, drop combining marks and variation selectors, drop whitespace.

    Word stores variation selectors inside words (U+E0100–U+E01EF), so two strings
    that read identically compare unequal without this.
    """
    s = unicodedata.normalize("NFKC", s)
    return "".join(
        c for c in s
        if not c.isspace()
        and unicodedata.category(c) not in ("Cf", "Mn")
        and not (0xE0100 <= ord(c) <= 0xE01EF)
    )


def _looks_like_prose(t: str) -> bool:
    """Reject runs with no sentence structure.

    One worksheet's body picked up a 71-character run of the digit 5 — table filler
    or a layout artefact, not text. It passed every length and prefix check, and a
    secret scanner then flagged it as a credential. Real lesson text is mostly CJK.
    """
    cjk = sum(1 for c in t if "\u4e00" <= c <= "\u9fff")
    return cjk >= len(t) * 0.3


def _is_chrome(t: str) -> bool:
    return (
        not _looks_like_prose(t)
        or not t
        or any(t.startswith(p) for p in _CHROME_PREFIX)
        or any(c in t for c in _CHROME_CONTAINS)
        or any(m in t for m in _INSTRUCTION_MARKERS)
        or bool(_LESSON_HEADER.match(t))
    )


def extract_body(paras: list[str]) -> Optional[list[str]]:
    # A boundary is only a boundary if there is body text before it. 文言文
    # worksheets print their strategy heading (文言聚光燈：固定句式) in the masthead,
    # at paragraph 3 — matching that as the end yielded a zero-length body and the
    # lesson was reported as having no boundary at all rather than as truncated.
    def _first_body_index() -> Optional[int]:
        for i, t in enumerate(paras):
            if len(t) >= _MIN_BODY and not _is_chrome(t):
                return i
        return None

    first = _first_body_index()
    if first is None:
        return None

    # The EARLIEST heading after the body wins, regardless of which tier it came
    # from. Tiers only decide which markers are recognised, never which one closes
    # the text — taking the first tier to match anywhere meant 閱讀聚光燈 at
    # paragraph 465 beat 閱讀理解 at 348, and L0144 swallowed 117 paragraphs of
    # exercises into its body (its 29th "paragraph" was a multiple-choice question).
    candidates = [
        i for i, t in enumerate(paras)
        if i > first and t and any(m in t for tier in _BODY_END_TIERS for m in tier)
    ]
    end = min(candidates) if candidates else None
    if end is None:
        end = next(
            (i for i, t in enumerate(paras) if i > first and _FALLBACK_HEADING.match(t)),
            None,
        )
    if end is None:
        return None
    # Short paragraphs are real text and were being dropped wholesale. 《獵人與白牙》
    # ended on 「白牙已經奄奄一息…然後，永遠閉上了牠的眼睛。」— 36 characters, under
    # the 46 floor, so the story was served without its ending. 111 lessons were losing
    # paragraphs this way, 672 in all, and nothing reported it: the body was present and
    # plausible, just incomplete.
    #
    # The floor cannot simply be lowered. In a few worksheets the 閱讀聚光燈 teaching
    # block sits above its own heading and so falls inside the body span; the length
    # filter was the only thing excluding it, and dropping to 12 pulled 56 lines of
    # 「②這段和前面內容有什麼關係？」 into three lessons' text.
    #
    # So a short paragraph is recovered only when it sits directly beside a full-length
    # body paragraph. Narrative runs long-then-short; scaffolding comes in runs of short
    # lines with no long neighbour. That keeps 264 of the 672 and caps any single lesson
    # at 10 — and 《獵人與白牙》 gets its last line back.
    span = paras[first:end]
    keep = [bool(t) and not _is_chrome(t) and not any(m in t for m in _EXERCISE_MARKS)
            for t in span]
    is_long = [keep[i] and len(t) >= _MIN_BODY for i, t in enumerate(span)]
    filled = [i for i, t in enumerate(span) if t]
    order = {v: k for k, v in enumerate(filled)}

    # Acceptance propagates along a run of short paragraphs, because a story can end on
    # two short lines in a row: 《獵人與白牙》 closes with the hunter's cry and then the
    # dog's last tail-wag, and testing only against FULL-length neighbours recovered the
    # first and left the second out — the worksheet then quotes 「白牙已經奄奄一息…」 as
    # 第十三段 and the passage is not in the text the student read. Capped, so a single
    # body paragraph cannot drag a whole block of scaffolding in behind it.
    anchored = list(is_long)
    for _ in range(_SHORT_RUN_LIMIT):
        for j, i in enumerate(filled):
            if anchored[i] or not keep[i] or len(span[i]) < _MIN_SHORT_BODY:
                continue
            near = ([filled[j - 1]] if j > 0 else []) + \
                   ([filled[j + 1]] if j + 1 < len(filled) else [])
            if any(anchored[n] for n in near):
                anchored[i] = True

    body, seen = [], set()
    for i, t in enumerate(span):
        if not keep[i] or len(t) < _MIN_SHORT_BODY:
            continue
        if len(t) < _MIN_BODY and not anchored[i]:
            continue
        key = normalise(t)
        if key in seen:          # Word duplicates runs when a table repeats a header
            continue
        seen.add(key)
        body.append(_unescape(t))
    return body or None


def _unglue(words: list[str], body: list[str]) -> list[str]:
    """Split vocabulary tokens that lost the 、 between them.

    The list is typeset to fit a box, so it wraps mid-list and sometimes drops the
    separator outright: 「亂竄、動向、揮之不去 / 起伏、深淵、煙消雲散偵測」 yields
    揮之不去起伏 and 煙消雲散偵測. Both then fail the containment check, and the whole
    section is withheld as a mismatch — a source typo read as a content gap.

    The body is the authority. A real vocabulary word appears in the lesson text, so a
    token that does not is a candidate for splitting, and a split is accepted only when
    BOTH halves appear. Where more than one split point satisfies that, the token is
    left alone rather than guessed at.
    """
    text = normalise("".join(body))
    out: list[str] = []
    for w in words:
        if len(w) < 4 or normalise(w) in text:
            out.append(w)
            continue
        splits = [(w[:i], w[i:]) for i in range(2, len(w) - 1)
                  if normalise(w[:i]) in text and normalise(w[i:]) in text]
        out.extend(splits[0] if len(splits) == 1 else [w])
    return out


#: 「Level 4・記敘文」 — the worksheet's own masthead line, carrying the grade band and
#: the genre. Authored WITH the lesson, unlike the planning spreadsheet, so it is both
#: the better source for genre and an independent field to check the title join
#: against: 130 of 146 agree, and the 16 that differ are editorial calls on the same
#: lesson (a letter-writing lesson as 說明文 or 應用文), not different lessons.
_LEVEL = re.compile(r"^Level\s*(\d+)\s*[・·．.]\s*(.+)$")


def extract_level(paras: list[str]) -> dict | None:
    for t in paras:
        m = _LEVEL.match(t)
        if m:
            genre = m.group(2).strip()
            # 「應用文(讀書報告)」 — the parenthetical names the sub-form.
            base = re.sub(r"[（(].*", "", genre).strip()
            return {"level": int(m.group(1)), "genre": base or genre, "genre_detail": genre}
    return None


def extract_vocabulary(paras: list[str], body: list[str] | None = None) -> list[str]:
    """The 本課語詞 list. Take the LAST occurrence: the instructions above it quote
    the phrase 「從本課語詞框中找語詞」, and matching the first one captures those
    instructions instead of the words.

    Pass `body` to repair tokens the typesetting glued together — without it the list
    is returned as the document spells it, glue and all.
    """
    idx = [i for i, t in enumerate(paras) if t.startswith("本課語詞")]
    if not idx:
        return []
    i = idx[-1]
    buf = [paras[i].split("：", 1)[-1]]
    for t in paras[i + 1:]:
        if _SECTIONS.match(t) or _CJK_INDEX.match(t):
            break
        if t:
            buf.append(t)
        if buf and "。" in buf[-1]:
            break
    # Joined on 、, not "": the list wraps mid-item, and concatenating the lines welds
    # the last word of one to the first word of the next.
    words = [w.strip() for w in re.split(r"[、，,。\s]+", "、".join(buf)) if len(w.strip()) >= 2]
    return _unglue(words, body) if body else words


def check(body: list[str], vocab: list[str]) -> dict:
    """Vocabulary containment — the cross-check described in the module docstring."""
    if not vocab:
        return {"ratio": None, "hit": 0, "of": 0, "verdict": "no_vocab"}
    text = normalise("".join(body))
    hit = sum(1 for w in vocab if normalise(w) in text)
    ratio = hit / len(vocab)
    verdict = "ok" if ratio >= 0.8 else "weak" if ratio >= 0.5 else "suspect"
    return {"ratio": round(ratio, 2), "hit": hit, "of": len(vocab), "verdict": verdict}


def extract(docx: Path) -> dict:
    paras = _paragraphs(docx)
    body = extract_body(paras)
    if not body:
        return {"ok": False, "reason": "找不到課文邊界（第二節標題）", "paragraphs": []}
    vocab = extract_vocabulary(paras, body)
    result = check(body, vocab)
    return {
        "ok": True,
        # The masthead's own grade/genre. Preferred over the planning spreadsheet's
        # 文體 column, which disagrees on 16 lessons — every one of them an editorial
        # call rather than a different lesson.
        "level": extract_level(paras),
        "paragraphs": body,
        "char_count": sum(len(normalise(p)) for p in body),
        "vocabulary": vocab,
        "check": result,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("docx", nargs="+")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    tally = {"ok": 0, "weak": 0, "suspect": 0, "no_vocab": 0, "fail": 0}
    for f in a.docx:
        r = extract(Path(f))
        name = Path(f).stem
        if not r["ok"]:
            tally["fail"] += 1
            print(f"  ❌ {name}  {r['reason']}")
            continue
        c = r["check"]
        tally[c["verdict"]] += 1
        if not a.quiet or c["verdict"] == "suspect":
            mark = {"ok": "✅", "weak": "🟡", "suspect": "⚠️", "no_vocab": "－"}[c["verdict"]]
            print(f"  {mark} {name}  {len(r['paragraphs']):2d} 段 {r['char_count']:4d} 字"
                  f"  語詞 {c['hit']}/{c['of']}")
    print(f"\n  ok={tally['ok']} weak={tally['weak']} suspect={tally['suspect']} "
          f"no_vocab={tally['no_vocab']} fail={tally['fail']} / {len(a.docx)}")
    return 0 if tally["fail"] == 0 and tally["suspect"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
