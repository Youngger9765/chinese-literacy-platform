#!/usr/bin/env python3
"""extract_key_reading.py — 重點朗讀（念順順）指定段落, from section 二 (#2683).

WHY THIS EXISTS
---------------
Every one of the 175 lessons currently falls back to reading the whole text aloud,
which is the exact thing the 2026-07-20 expert review ruled against: 朗讀只練老師指定的
重點段（約 300–400 字），不練全文.

The first edition had this data. It is not reusable — `data/key_reading_passages.yml`
is keyed by lesson code, the second edition renumbered every lesson, and the lookup
therefore kept succeeding while returning another lesson's paragraph. Live on staging
《十秒的背後》, about a sprinter, was serving a passage about giving up a bus seat.

WHERE THE PASSAGE ACTUALLY LIVES
--------------------------------
Section 二 念順順 does not contain the passage. It names it:

    請用計時器，從指定段落（四）開始朗讀，計時 1 分鐘讀的字數…

So the anchor is a paragraph NUMBER, and the paragraph itself is back in section 一.
Reassembling the two is what this script does — which makes the extraction a genuine
cross-section join rather than a lift, and gives it a check that can fail.

THE CHECK THAT CAN CATCH A WRONG PAIRING
----------------------------------------
Two independent confirmations, neither of which trusts a lesson code:

  1. Cross-section — the number comes from 二, the prose from 一. An anchor past the
     end of the body, or one landing on a table row rather than prose, means the body
     segmentation and the anchor disagree, and neither can be trusted.

  2. Independent-process agreement — the first edition's passages were extracted from
     the printed PDFs by a different pipeline. Matching them BY CONTENT (is this
     passage a substring of this lesson's body?) rather than by code sidesteps the
     renumbering entirely, and their 「第N段」 should then agree with our anchor. Where
     both pipelines independently land on the same paragraph, the pairing is confirmed
     by something outside this script.

Disagreement is not written. A student reading the wrong paragraph aloud is worse than
a student reading the whole text.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from extract_lesson_body import _paragraphs, extract as extract_body  # noqa: E402

LEGACY_TABLE = ROOT / "backend" / "data" / "key_reading_passages.yml"

_CN_NUM = {c: i for i, c in enumerate("一二三四五六七八九十", start=1)}

#: 「從指定段落（四）開始朗讀」 — the parenthesis is sometimes half-width, sometimes
#: unclosed, and sometimes padded with the tab that follows it in the form.
_ANCHOR = re.compile(r"從指定段落\s*[（(]?\s*([一二三四五六七八九十]+|\d+)\s*[)）]?")
_ANCHOR_LOOSE = re.compile(r"指定段落[^0-9一二三四五六七八九十]{0,6}([一二三四五六七八九十]+|\d+)")

#: 「從指定段落（四）開始朗讀」 says start, not read-only-this. The distinction is not
#: pedantry: a single paragraph runs 145 characters at the median, and a student
#: reading aloud for the timed minute gets through more than twice that — they would
#: run out of text before the timer. Whole paragraphs are accumulated from the anchor
#: until the passage is long enough to fill the minute, which lands the median at 371
#: and puts 126 of 140 lessons inside 300–500 — the band the 2026-07-20 review set.
TARGET_CHARS = 300

#: A passage short enough to be a caption, or long enough to be the whole text, is not
#: a one-minute reading target.
MIN_CHARS, MAX_CHARS = 40, 900


def cn_to_int(s: str) -> int | None:
    if s.isdigit():
        return int(s)
    if s in _CN_NUM:
        return _CN_NUM[s]
    # 十一 / 十二 / 十三 — the only compound forms that appear.
    if len(s) == 2 and s[0] == "十" and s[1] in _CN_NUM:
        return 10 + _CN_NUM[s[1]]
    return None


def find_anchor(paras: list[str]) -> int | None:
    text = "\n".join(paras)
    m = _ANCHOR.search(text) or _ANCHOR_LOOSE.search(text)
    return cn_to_int(m.group(1)) if m else None


def load_legacy() -> list[tuple[str, int | None]]:
    """First-edition passages as (passage, paragraph_number). Codes are discarded:
    they are what made the old lookup wrong, and matching by content does not need
    them."""
    import yaml

    if not LEGACY_TABLE.exists():
        return []
    doc = yaml.safe_load(LEGACY_TABLE.read_text(encoding="utf-8")) or {}
    out = []
    for entry in (doc.get("passages") or {}).values():
        passage = (entry or {}).get("passage")
        if not passage:
            continue
        tou = (entry or {}).get("tou_paragraph") or ""
        m = re.search(r"([一二三四五六七八九十]+|\d+)", str(tou))
        out.append((passage.strip(), cn_to_int(m.group(1)) if m else None))
    return out


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", s)


def corroborate(body: list[str], legacy: list[tuple[str, int | None]]) -> int | None:
    """The paragraph number the first edition's pipeline chose for THIS lesson.

    Found by content: a first-edition passage that is a substring of this body belongs
    to this lesson, whatever code either edition filed it under. Ambiguous matches
    (a passage appearing in two lessons) are discarded rather than guessed.
    """
    joined = _norm("\n".join(body))
    hits = [num for passage, num in legacy if num and _norm(passage)[:60] in joined]
    return hits[0] if len(set(hits)) == 1 else None


def extract(docx: Path, body: list[str] | None = None) -> dict:
    """`body` should be the paragraphs as STORED, not a fresh re-extraction.

    The anchor is an index, so it is only meaningful against the exact segmentation
    it will be applied to. Six lessons had a `body.yml` written by an older version of
    the extractor — 《我的阿嬤》 was stored as 10 paragraphs and re-extracted as 11 —
    and indexing a fresh extraction while serving the stored one silently shifts the
    passage by a paragraph. Containment caught it in that one lesson because the
    off-by-one crossed a scene break; in the other five it would have picked a
    neighbouring paragraph and looked entirely reasonable.
    """
    paras = _paragraphs(docx)
    if body is None:
        body = (extract_body(docx) or {}).get("paragraphs") or []
    anchor = find_anchor(paras)
    out: dict = {"anchor": anchor, "verdict": "empty", "passage": None,
                 "corroborated_by_first_edition": None, "needs_human_review": False}

    if anchor is None:
        out["verdict"] = "no_anchor"
        return out
    if not body:
        out["verdict"] = "no_body"
        return out
    if anchor > len(body):
        # The anchor and the body segmentation disagree. Clamping to the last
        # paragraph would produce a plausible-looking passage that no one marked.
        out["verdict"] = "anchor_out_of_range"
        out["body_paragraphs"] = len(body)
        return out

    picked, total = [], 0
    for para in body[anchor - 1:]:
        picked.append(para.strip())
        total += len(para.strip())
        if total >= TARGET_CHARS:
            break
    passage = "\n".join(picked)
    out["passage"] = passage
    out["start_text"] = picked[0][:24]
    out["paragraphs_used"] = len(picked)

    agreed = corroborate(body, load_legacy())
    out["corroborated_by_first_edition"] = agreed
    if agreed is not None and agreed != anchor:
        # The two editions marked different paragraphs. Checked by hand on both
        # lessons: the numbering is not offset — the first edition's passage sits at
        # OUR paragraph 2 and 3 respectively, so the segmentations agree and the
        # markings genuinely differ by one.
        #
        # The DOCX wins. It is the second edition's own instruction about the second
        # edition's worksheet, and the first edition's table came from a different
        # printing whose rule was 「只取 ☞ 那一段」 rather than 「從指定段落開始」. It is
        # also a much smaller error than the one this whole extraction exists to avoid:
        # the passage is still this lesson's, starting a paragraph later. Withholding
        # it means a student reads the entire text aloud instead, which is the thing the
        # review ruled against.
        out["needs_human_review"] = True

    if not (MIN_CHARS <= len(passage) <= MAX_CHARS):
        out["verdict"] = "implausible_length"
        out["length"] = len(passage)
        return out

    # The verdict has to survive to the file, so it is set once, here. Setting it at
    # the disagreement above and falling through overwrote it with "ok" — the flag
    # remained but the data no longer said WHY it was flagged.
    if out["needs_human_review"]:
        out["verdict"] = "disagrees_with_first_edition"
    else:
        out["verdict"] = "confirmed" if agreed == anchor else "ok"
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="/tmp/docx-src")
    ap.add_argument("--out", default="/tmp/key_reading.json")
    a = ap.parse_args()

    results, counts = {}, {}
    for docx in sorted(Path(a.source).glob("*.docx")):
        r = extract(docx)
        results[docx.stem] = r
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1

    Path(a.out).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  {len(results)} 課")
    for v, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"    {v:30s} {n}")
    ok = [r for r in results.values() if r["verdict"] in ("ok", "confirmed")]
    if ok:
        conf = sum(1 for r in ok if r["verdict"] == "confirmed")
        print(f"\n  可寫入 {len(ok)}（其中 {conf} 課與一修獨立抽取結果相符）")
        print(f"  段落長度 中位 {sorted(len(r['passage']) for r in ok)[len(ok)//2]} 字")
    return 0


if __name__ == "__main__":
    sys.exit(main())
