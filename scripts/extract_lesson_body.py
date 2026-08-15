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
_TEXT = re.compile(r"<w:t[^>]*>(.*?)</w:t>", re.S)

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


def _is_chrome(t: str) -> bool:
    return (
        not t
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
    body, seen = [], set()
    for t in paras[:end]:
        if len(t) < _MIN_BODY or _is_chrome(t):
            continue
        if any(m in t for m in _EXERCISE_MARKS):
            continue
        key = normalise(t)
        if key in seen:          # Word duplicates runs when a table repeats a header
            continue
        seen.add(key)
        body.append(_unescape(t))
    return body or None


def extract_vocabulary(paras: list[str]) -> list[str]:
    """The 本課語詞 list. Take the LAST occurrence: the instructions above it quote
    the phrase 「從本課語詞框中找語詞」, and matching the first one captures those
    instructions instead of the words."""
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
    return [w.strip() for w in re.split(r"[、，,。\s]+", "".join(buf)) if len(w.strip()) >= 2]


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
    vocab = extract_vocabulary(paras)
    result = check(body, vocab)
    return {
        "ok": True,
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
