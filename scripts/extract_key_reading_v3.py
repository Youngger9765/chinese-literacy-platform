#!/usr/bin/env python3
"""念順順 = 學習單指定的那一段，抽自 v3 自己的模組（#2720 的規則移植到 v3）.

WHY THIS REPLACES THE RANGE RULE
--------------------------------
`scripts/key_reading_xml_rule.py` computes a RANGE: ☞ 起點段 → 右緣累計字數欄末筆落在
的那一段. Run over all 175 worksheets it yields 132 passages, of which only 3 are a
single paragraph, median 393 characters.

⚠️ 383 vs 393 是兩個不同的母體，不要互相引用：383 是**出貨資料**改前的中位
（v3 樹 147 篇有 passage 的課），393 是**那支腳本自己跑出來**的 132 篇的中位。
本檔其他地方講「改前服務的長度」時一律用 383。

靖杭 checked the worksheets against that output on 2026-08-24 and rejected it:

> 從教授指定的段落，v3 會直接提取到結束，並沒有提取出該段落，而是將該段落以下的
> 內容全部提取了 … 我要你將 v2 的提取重點段落的邏輯移植到 v3

So the rule here is the one the 2026-07-20 expert review set and
`backend/data/key_reading_passages.yml` records — **只取指定的那一段** — and the right
edge of the worksheet is not part of it.

MEASUREMENT — judge set and method, so the numbers can be re-derived
    Take the first edition's hand-scanned passages; keep the ones whose text appears
    verbatim as a paragraph of exactly ONE second-edition lesson (38 of them). That
    lesson/paragraph pair is then an answer no extractor produced. Compare on `_norm`
    equality — full string, not containment:

        這一支（只取那一段）        36 / 38
        改前的 v3（範圍規則）        2 / 38

    ⚠️ An earlier note in this file said 9/38 for the range rule. That came from a
    containment comparison (the marked paragraph is INSIDE a 390-character span, so a
    range answer "contains" the right one while still being wrong). 2/38 is the
    equality number and the one that matches what the rule claims to produce.
    The v2-tree extractor's 31/38 is no longer re-measurable here — v2 was removed in
    this same change — so it is recorded as history, not as a live figure.

The two that remain wrong (L0072, L0110) are anchor-level: the first edition names a
different paragraph of the same lesson and its text is still present verbatim, so either
the second edition re-marked or both extractions misread. They ship the second edition's
answer and carry `needs_human_review` + a reason; they are flagged, not guessed.

WHY THIS NEEDS NO DOCX
----------------------
The v2 line had to read the 段號欄 out of `word/document.xml` because `body.yml` was a
derived list whose indices did not match the printed numbering. v3 already did that work:

  · `full_text_annotate.paragraphs[].idx` IS the printed number (skill §⑥.55), and the
    unnumbered 引言 is kept apart in `preface` rather than folded into paragraph 1
  · `key_reading.instruction` is the 念順順 sentence verbatim, so the anchor is parsed
    from data already in the repo

Measured over the 175-lesson tree: 157 have a `key_reading.yml`; 147 of those yield an
instruction, an anchor and a paragraph at that index. The other 10 are withheld and say
why — 6 文言文 whose instruction is 「請用計時器，朗讀原文」 (no 指定段落 to find), and 4
with a 念順順 section whose paragraph number will not parse. No DOCX, no PDF, no
LibreOffice.

⚠️ That makes this file depend on v3's `idx` being the printed number. If a future
extraction renumbers or merges paragraphs, this silently follows it — which is why the
golden-set comparison below is part of the output rather than a separate audit.
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import sys
import unicodedata
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
LESSONS = ROOT / "backend" / "data" / "lessons"
LEGACY = ROOT / "backend" / "data" / "key_reading_passages.yml"

#: 「ㄧ」 U+3127 is BOPOMOFO LETTER I, not the CJK 一 — it is what a large share of
#: worksheets print for the first paragraph, and a CJK-only class misses it.
_CN = {c: i for i, c in enumerate("一二三四五六七八九十", start=1)}
_CN["ㄧ"] = 1
_ANCHOR = re.compile(r"從指定段落\s*[（(]?\s*([一二三四五六七八九十ㄧ]+|\d+)")
_ANCHOR_LOOSE = re.compile(r"指定段落[^0-9一二三四五六七八九十ㄧ]{0,6}([一二三四五六七八九十ㄧ]+|\d+)")

#: 「……」 ends a paragraph. Leaving it out merged two genuinely separate paragraphs of
#: 《感情小日記2》 in the v2 line — the misfire #2726 warned this signal has.
#:
#: 「：」 is here for the same reason, found by
#: `test_lesson_uid_loader.py::test_key_reading_is_the_marked_paragraph_not_an_inferred_span`:
#: a paragraph may legitimately END on a colon that introduces a list which is itself
#: separate numbered paragraphs —「這裡的推理三要素是：」(L0094)、「然後，這首歌出現了：」
#: (L0007)、「例如：」(L0138). Without it all three absorbed the paragraph after them and
#: stopped being one paragraph, which is the whole rule.
_SENTENCE_END = "。！？」』…⋯：:"
#: How many following paragraphs may be absorbed to finish a sentence. v3's paragraphs
#: come from a multimodal read rather than Word's `<w:p>` boundaries, so none of the 147
#: currently needs it — it is a net for the day a paragraph does arrive split.
MAX_ABSORBED_TAIL = 2
#: The first edition's 134 marked passages run 19–409 characters (median 148), so neither
#: of these is a "typical length" gate — a length floor is the exact shape of check that
#: caused #2712, and the professor's own markings would fail one.
#:   MAX_CHARS  withholds: >900 means the anchor or the absorb went wrong, not a long
#:              paragraph. Nothing in the tree currently trips it.
#:   MIN_CHARS  does NOT withhold: it only routes to `short_marked_paragraph`, which
#:              ships the passage and flags it (L0140 第十三段 = 11 chars, genuinely).
MIN_CHARS, MAX_CHARS = 12, 900


def _norm(s: str) -> str:
    """Fold width, drop whitespace, combining marks and variation selectors.

    Word stores variation selectors inside words (`清一󠇡色`), so two strings that read
    identically compare unequal without this.
    """
    s = unicodedata.normalize("NFKC", s or "")
    return "".join(
        c for c in s
        if not c.isspace()
        and unicodedata.category(c) not in ("Cf", "Mn")
        and not (0xE0100 <= ord(c) <= 0xE01EF)
    )


def cn_to_int(s: str) -> int | None:
    s = unicodedata.normalize("NFKC", (s or "").strip()).replace("ㄧ", "一")
    if s.isdigit():
        return int(s)
    if s in _CN:
        return _CN[s]
    if len(s) == 2 and s[0] == "十" and s[1] in _CN:
        return 10 + _CN[s[1]]
    if len(s) == 2 and s[1] == "十" and s[0] in _CN:
        return _CN[s[0]] * 10
    if len(s) == 3 and s[1] == "十" and s[0] in _CN and s[2] in _CN:
        return _CN[s[0]] * 10 + _CN[s[2]]
    return None


def find_anchor(instruction: str) -> int | None:
    m = _ANCHOR.search(instruction or "") or _ANCHOR_LOOSE.search(instruction or "")
    return cn_to_int(m.group(1)) if m else None


def _version_dir(uid_dir: Path) -> Path | None:
    vs = sorted((c for c in uid_dir.iterdir() if c.is_dir() and c.name.startswith("v")),
                key=lambda c: c.name) if uid_dir.is_dir() else []
    return vs[-1] if vs else None


def read_lesson(uid: str) -> dict:
    """The three things this needs, all from the uid tree."""
    vdir = _version_dir(LESSONS / uid)
    out: dict = {"uid": uid, "vdir": vdir}
    if vdir is None:
        return out
    kf, ff, lf = vdir / "key_reading.yml", vdir / "full_text_annotate.yml", vdir / "lesson.yml"
    if kf.exists():
        doc = yaml.safe_load(kf.read_text(encoding="utf-8")) or {}
        out["kr_file"] = doc
        out["kr"] = doc.get("key_reading") or {}
    if ff.exists():
        d = yaml.safe_load(ff.read_text(encoding="utf-8")) or {}
        ft = d.get("full_text_annotate") or d
        paras = [p for p in (ft.get("paragraphs") or []) if isinstance(p, dict)]
        # Ordered, because absorbing a tail walks the printed sequence, and `idx` is not
        # guaranteed to be 1..n contiguous.
        out["order"] = [p.get("idx") for p in paras]
        out["by_idx"] = {p.get("idx"): (p.get("text") or "") for p in paras}
        out["preface"] = ft.get("preface")
    if lf.exists():
        l = yaml.safe_load(lf.read_text(encoding="utf-8")) or {}
        l = l.get("lesson", l)
        out["title"] = l.get("title") or uid
        out["slot"] = l.get("catalog_slot") or ""
    return out


def absorb_split_tail(by_idx: dict, order: list, idx) -> tuple[str, int]:
    """`by_idx[idx]`, plus following paragraphs needed to finish its sentence.

    A passage that stops mid-sentence is wrong on its face, which makes this a local
    rule rather than a guess about paragraph structure. Bounded: a run where nothing ends
    a sentence is a parsing failure, not a passage.
    """
    passage = by_idx[idx]
    pos = order.index(idx)
    n = 0
    while (n < MAX_ABSORBED_TAIL
           and pos + 1 + n < len(order)
           and not passage.rstrip().endswith(tuple(_SENTENCE_END))):
        passage += by_idx[order[pos + 1 + n]]
        n += 1
    return passage, n


_LEGACY_CACHE: list[str] | None = None


def legacy_passages() -> list[str]:
    """First-edition passages, TEXT only — the paragraph numbers are deliberately
    discarded (comparing a number from one edition's printing against an index into
    another's is what made the old corroboration report `confirmed` on wrong data)."""
    global _LEGACY_CACHE
    if _LEGACY_CACHE is None:
        doc = yaml.safe_load(LEGACY.read_text(encoding="utf-8")) if LEGACY.exists() else {}
        _LEGACY_CACHE = [e["passage"].strip()
                         for e in ((doc or {}).get("passages") or {}).values()
                         if e and e.get("passage")]
    return _LEGACY_CACHE


def corroborate(passage: str, by_idx: dict) -> bool | None:
    """Does the first edition name this same paragraph of this same lesson?

    True / False / None(= this lesson has no first-edition counterpart). Attribution is
    by CONTENT — a first-edition passage that is verbatim one of this lesson's paragraphs
    belongs to this lesson, whatever code either edition filed it under.
    """
    mine = _norm(passage)
    paras = {_norm(t) for t in by_idx.values()}
    hits = [g for g in legacy_passages() if _norm(g) in paras]
    if not hits:
        return None
    if len({_norm(g) for g in hits}) > 1:
        return None
    return _norm(hits[0]) == mine


def extract(uid: str) -> dict:
    l = read_lesson(uid)
    out: dict = {"uid": uid, "title": l.get("title", uid), "slot": l.get("slot", ""),
                 "verdict": "empty", "passage": None, "anchor": None,
                 "corroborated_by_first_edition": None}
    if l.get("vdir") is None:
        out["verdict"] = "no_version_dir"
        return out
    if "kr" not in l:
        out["verdict"] = "no_key_reading"
        return out
    instruction = l["kr"].get("instruction") or ""
    anchor = find_anchor(instruction)
    out["anchor"] = anchor

    if anchor is None:
        # 文言文 asks for the WHOLE 原文 — 「請用計時器，朗讀原文」 — and times in
        # seconds, so there is no marked paragraph to find. Ten lessons are in this mode
        # (their body lives in `classical_text.yml`, not `full_text_annotate.yml`).
        # Reporting it as a failure would invite someone to "fix" it by inventing a
        # paragraph the worksheet never marked.
        out["verdict"] = ("whole_text_reading" if "朗讀原文" in instruction
                          else "no_anchor")
        return out

    if not l.get("by_idx"):
        out["verdict"] = "no_body"
        return out
    if anchor not in l["by_idx"]:
        # The instruction names a paragraph the body does not have. Withheld rather than
        # clamped: clamping produces a plausible passage nobody marked.
        out["verdict"] = "anchor_out_of_range"
        out["body_paragraphs"] = len(l["by_idx"])
        return out

    passage, absorbed = absorb_split_tail(l["by_idx"], l["order"], anchor)
    passage = passage.strip()
    out.update(passage=passage, absorbed_tail=absorbed,
               start_text=passage[:24], chars=len(_norm(passage)))

    if len(_norm(passage)) > MAX_CHARS:
        # Longer than any passage the professor ever marked ⇒ the anchor or the absorb
        # went wrong. Withheld: a wrong long passage is exactly #2712.
        out["verdict"] = "implausible_length"
        return out

    agreed = corroborate(passage, l["by_idx"])
    out["corroborated_by_first_edition"] = agreed
    if len(_norm(passage)) < MIN_CHARS:
        # L0140 第十三段 is 「這個故事有三個大轉折。」— 11 characters, its own printed
        # number, its own line. The rule says that one paragraph, so that one paragraph
        # is what gets written; short ≠ wrong. But 11 characters is not a minute of
        # reading either, so it is FLAGGED for a human rather than passed off as clean.
        # Withholding instead would leave the old range-rule value sitting in the file,
        # which is how one dataset ends up obeying two contradictory rules.
        out["verdict"] = "short_marked_paragraph"
        return out

    out["corroborated_by_first_edition"] = agreed
    # 二修教材為主 (靖杭 2026-08-18): a disagreement is written and FLAGGED, not withheld
    # — the second edition's own instruction about its own worksheet outranks a passage
    # read off the first edition's printing.
    out["verdict"] = {True: "confirmed", False: "disagrees_with_first_edition",
                      None: "ok"}[agreed]
    return out


def apply(uid: str, r: dict) -> None:
    """Write passage + start/end into v3, keeping every other field #2736 extracted.

    `end_paragraph == start_paragraph` is the whole point: the range fields stay in the
    schema (the frontend and the timing table read them) but they now describe one
    paragraph. `approx_chars_from_start` is removed — it is the 累計字數欄 max, which is
    「一分鐘能讀到哪」 and not a passage length; leaving it beside a one-paragraph
    passage invites the next person to reconstruct the range rule from it.

    `extraction_check` / `needs_human_review` / `review_reason` go at the DOCUMENT top
    level, beside the `key_reading:` block rather than inside it — that is where
    `build_lesson_body.py`, `build_key_reading.py` and
    `test_lesson_uid_loader.py::test_key_reading_disagreements_are_flagged_not_silently_preferred`
    all already look. A check that describes the extraction is not a field of the passage.
    """
    vdir = _version_dir(LESSONS / uid)
    f = vdir / "key_reading.yml"
    doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    kr = doc.get("key_reading")
    if kr is None:
        kr = doc.setdefault("key_reading", {})
    kr["passage"] = r["passage"]
    kr["start_text"] = r["start_text"]
    kr["extent_chars"] = r["chars"]
    kr["start_paragraph"] = r["anchor"]
    kr["end_paragraph"] = r["anchor"]
    kr.pop("spans_paragraphs", None)
    kr.pop("approx_chars_from_start", None)
    kr.pop("extraction_check", None)  # earlier runs of this script nested it here
    kr["source"] = "extract_key_reading_v3"
    doc["extraction_check"] = {
        "verdict": r["verdict"],
        "corroborated_by_first_edition": r["corroborated_by_first_edition"],
        "absorbed_tail": r.get("absorbed_tail") or 0,
    }
    reason = REVIEW_REASONS.get(r["verdict"])
    if reason:
        # 誠實標，不是造假成 pass：出貨了，但檔案自己說要人看，並說為什麼。
        doc["needs_human_review"] = True
        doc["review_reason"] = reason.format(chars=r["chars"], anchor=r["anchor"])
    else:
        doc.pop("needs_human_review", None)
        doc.pop("review_reason", None)
    f.write_text(yaml.dump(doc, allow_unicode=True, sort_keys=False, width=10**6),
                 encoding="utf-8")


WRITEABLE = {"ok", "confirmed", "disagrees_with_first_edition", "short_marked_paragraph"}

#: Verdicts that ship a passage but ask for eyes. Keyed rather than boolean so the file
#: records WHY — 「flagged with no reason」 is the failure mode #2725 named.
REVIEW_REASONS = {
    "disagrees_with_first_edition":
        "二修學習單指定第{anchor}段，一版人工掃描標的是同一課的另一段，且那段文字在"
        "本課仍逐字存在。二修為主所以照寫，但兩版之一標錯了，要人看紙本確認。",
    "short_marked_paragraph":
        "學習單指定的那一段只有 {chars} 字（第{anchor}段）。規則是只取指定的那一段，"
        "所以照寫；但這長度不像一分鐘的朗讀量，要人看紙本確認段號沒讀錯。",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("uids", nargs="*", help="留空＝全庫")
    ap.add_argument("--apply", action="store_true", help="寫回 key_reading.yml")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    uids = a.uids or sorted(os.path.basename(d) for d in glob.glob(str(LESSONS / "L*")))
    counts: dict[str, int] = {}
    written = 0
    for uid in uids:
        r = extract(uid)
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
        if r["verdict"] in WRITEABLE:
            if a.apply:
                apply(uid, r)
            written += 1
            if not a.quiet:
                print(f"✅ {uid} 第{r['anchor']}段 {r['chars']}字 [{r['verdict']}] {r['title']}")
        elif not a.quiet and r["verdict"] != "no_anchor":
            print(f"—  {uid} {r['verdict']} {r['title']}")

    print(f"\n可寫入 {written} 課" + ("（已寫入）" if a.apply else "（未寫入，加 --apply）"))
    for v, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"    {v:32s} {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
