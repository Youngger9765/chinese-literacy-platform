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

#: 範圍規則時代留下的欄位：它們**宣稱 passage 到哪裡結束、跨幾段**。單段 passage 旁邊
#: 放著這些，檔案就自相矛盾 —— L0050 的 `span_evidence_note` 講第 4、5 段的長度，
#: 而它的 passage 是第 3 段；L0084 的 `passage_note` 寫「兩段合計 304 字」，
#: 而它的 passage 是 179 字。
#:
#: 🔴 這比 review 指出的 L0084 一課大得多：`span_confidence` 37 課、
#: `char_marks_cover_paragraphs` 30 課、`end` 10 課。三審的 reviewer 自己就說
#: 「我上一輪是被 passage_note 引導做出『被截斷』的判斷」—— 矛盾的敘述會讓下一個
#: 讀資料的人得到錯的結論，所以清掉，不是留著當歷史。
#:
#: ⚠️ 只清「宣稱範圍」的。**忠實轉錄紙上內容的一律保留**
#: （`printed_char_marks` / `printed_cumulative_chars` / `printed_char_count` 是字數欄
#: 印出來的數字本身，`instruction_note` / `start_marker_note` /
#: `start_paragraph_conflict_note` 講的是錨點與指示句）—— 那些是原稿的事實，
#: 與 passage 取到哪裡無關，刪掉是湮滅證據而不是消除矛盾。
#: 從 ☞ 往後最多累加幾段。學習單標的範圍實測最長 8 段；
#: 給到 12 是為了不誤擋，超過就是累計欄或段界讀錯了，不是真的要唸 12 段。
MAX_SPAN_PARAGRAPHS = 12
#: 累加結果與累計欄末筆差多少還算對得上。實測差值多為個位數（標點/空白算法差異），
#: L0001 差 5、L0132 差 2。超過就標記讓人看，⛔ 不要自動吸收。
SPAN_TOLERANCE = 20

RANGE_ERA_FIELDS = (
    "spans_paragraphs",            # 「跨哪幾段」
    "approx_chars_from_start",     # ＝字數欄 max
    "end",                         # 「課文結束」
    "passage_note",                # L0084：「兩段合計 304 字」
    "char_marks_cover_note",
    "char_marks_cover_paragraphs",
    "span_confidence",
    "span_confidence_note",
    "span_evidence_note",
    "span_note",
    "parts",                       # L0029：內含 spans_seq [7,8,9]
)


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


def parts(uid: str) -> list[dict]:
    """這一課的每一「篇」：(念順順檔, 它對應的課文檔)。

    🔴 #2916 之後檔名是 `{模組}.{slug}.yml`，而且**一課可能有好幾篇**
    （一份學習單裝兩三篇課文，L0029 兩篇、L0063 三篇）。配對靠 `_manifest.yml`
    的 `text_ref` —— 念順順那一節記著它練的是哪一份課文的 slug。

    ⚠️ 不要用「檔名排序後一一對應」代替 text_ref：slug 是亂數，排序後的順序
    與版面順序無關，兩篇課的念順順會配到對方的課文上。

    manifest 讀不到時退回 glob（單篇課才安全，多篇課會回報並跳過）。
    """
    vdir = _version_dir(LESSONS / uid)
    if vdir is None:
        return []
    man = vdir / "_manifest.yml"
    out = []
    if man.is_file():
        m = yaml.safe_load(man.read_text(encoding="utf-8")) or {}
        by_slug = {s.get("slug"): s for s in (m.get("sections") or [])
                   if s.get("module") == "full_text_annotate"}
        for sec in (m.get("sections") or []):
            if sec.get("module") != "key_reading":
                continue
            ft = by_slug.get(sec.get("text_ref"))
            out.append({
                "uid": uid, "vdir": vdir, "slug": sec.get("slug"),
                "kr_path": vdir / sec["file"],
                "ft_path": (vdir / ft["file"]) if ft else None,
            })
        if out:
            return out
    krs = sorted(vdir.glob("key_reading.*.yml")) or (
        [vdir / "key_reading.yml"] if (vdir / "key_reading.yml").is_file() else [])
    fts = sorted(vdir.glob("full_text_annotate.*.yml")) or (
        [vdir / "full_text_annotate.yml"]
        if (vdir / "full_text_annotate.yml").is_file() else [])
    if len(krs) > 1 or len(fts) > 1:
        # 多篇課沒有 manifest 就配不出來 —— 不猜。
        return [{"uid": uid, "vdir": vdir, "slug": None,
                 "kr_path": k, "ft_path": None} for k in krs]
    return [{"uid": uid, "vdir": vdir, "slug": None,
             "kr_path": krs[0] if krs else None,
             "ft_path": fts[0] if fts else None}] if krs else []


def read_lesson(uid: str, part: dict | None = None) -> dict:
    """一篇的三樣東西。`part` 省略時取第一篇（單篇課的情境）。"""
    vdir = _version_dir(LESSONS / uid)
    out: dict = {"uid": uid, "vdir": vdir}
    if vdir is None:
        return out
    if part is None:
        ps = parts(uid)
        if not ps:
            return out
        part = ps[0]
    out["slug"] = part.get("slug")
    kf = part.get("kr_path")
    ff = part.get("ft_path")
    lf = vdir / "lesson.yml"
    if kf and kf.exists():
        doc = yaml.safe_load(kf.read_text(encoding="utf-8")) or {}
        out["kr_file"] = doc
        out["kr"] = doc.get("key_reading") or {}
    if ff and ff.exists():
        d = yaml.safe_load(ff.read_text(encoding="utf-8")) or {}
        ft = d.get("full_text_annotate") or d
        paras = [p for p in (ft.get("paragraphs") or []) if isinstance(p, dict)]
        # Ordered, because absorbing a tail walks the printed sequence, and `idx` is not
        # guaranteed to be 1..n contiguous.
        out["order"] = [p.get("idx") for p in paras]
        out["texts"] = [(p.get("text") or "") for p in paras]
        # 🔴 段號會重編：一份學習單裝兩篇（書信體、兩則短文）時，段號從頭再數一次。
        # 全庫 4 課如此 —— L0010 [1-4,1-8]、L0012 [1-3,1-7]、L0016 [1,2,3,4,4,5,6]、
        # L0029 [1-9,1-10]。其中 L0010（錨點二）與 L0029（錨點七）真的有兩個候選。
        #
        # **取最後一次出現的那一個**：兩課都因此逐字命中教授的一版人工掃描
        # （verdict=confirmed，2/2）。前面的編號段是引文／範例，念順順練的是正文。
        #
        # ⚠️ 這件事以前是靠 dict 後蓋前**隱性**成立的，而 `order.index(idx)` 取的卻是
        # **第一次**出現的位置 —— 兩者對不起來。今天沒爆是因為全庫 absorbed_tail 都是 0；
        # 一旦某課的指定段斷在句中，就會接上第一份文本的下一段。改成顯式的位置。
        out["pos_of"] = {}
        for i, p in enumerate(paras):
            out["pos_of"][p.get("idx")] = i          # 後蓋前 ＝ 取最後一次出現
        out["by_idx"] = {idx: out["texts"][i] for idx, i in out["pos_of"].items()}
        out["preface"] = ft.get("preface")
        # 課文欄可能比段號欄多出一兩段 —— 作者沒編號的收尾段。它們**不是**編號段落的
        # 一部分（L0084 原稿：段號欄 6 個號、課文欄 7 個 `w:p`），所以不進 `by_idx`：
        # 進去會多一個沒人指得到的「段」，還會被 `order` 當成下一段吸收。
        # 但要讀進來，因為指定段若斷在句中、而下一段正好沒編號，不看它就會截斷。
        out["unnumbered_after"] = {}
        out["unnumbered_notes"] = {}
        for b in ft.get("unnumbered_blocks") or []:
            if isinstance(b, dict) and b.get("after_paragraph") is not None:
                out["unnumbered_after"].setdefault(b["after_paragraph"], []).append(
                    b.get("text") or "")
                out["unnumbered_notes"].setdefault(b["after_paragraph"], []).append(
                    b.get("role_note") or "")
    if lf.exists():
        l = yaml.safe_load(lf.read_text(encoding="utf-8")) or {}
        l = l.get("lesson", l)
        out["title"] = l.get("title") or uid
        out["slot"] = l.get("catalog_slot") or ""
    return out


def _unfinished(passage: str) -> bool:
    return not passage.rstrip().endswith(tuple(_SENTENCE_END))


def absorb_split_tail(texts: list, order: list, idx, pos_of: dict,
                      unnumbered_after: dict | None = None) -> tuple[str, int]:
    """指定段的文字，加上「把句子講完」所需的後續文字。

    A passage that stops mid-sentence is wrong on its face, which makes this a local
    rule rather than a guess about paragraph structure. Bounded: a run where nothing ends
    a sentence is a parsing failure, not a passage.

    ⛔ 判準只有一個：**句子有沒有結束**。不是「字數欄數到哪」——
    在教授親手標了段落的 38 課上實測，字數欄的 max **38/38 全部大於**教授標的長度
    （中位 +264，沒有一課落在 ±5 內），所以它界定不了朗讀範圍。用它收尾就是把
    #2712 換個地方再做一次。

    沒編號的收尾段（`unnumbered_blocks`）走同一條判準：指定段自己把句子講完了就不吃，
    斷在句中才吃。L0084 是這條規則的實例 —— 第六段以「。」收尾，後面那 125 字的
    阿德勒結語是**另一個沒編號的段落**，所以不屬於第六段（原稿：段號欄 6 個號、
    課文欄 7 個 `w:p`；repo 對這個現象的既有結論也是「作者沒編號的收尾句」）。
    """
    pos = pos_of[idx]
    passage = texts[pos]
    n = 0
    # 走**位置**，不走段號 —— 段號會重複，位置不會。
    while (n < MAX_ABSORBED_TAIL
           and pos + 1 + n < len(texts)
           and _unfinished(passage)):
        passage += texts[pos + 1 + n]
        n += 1
    # 編號段走完句子還沒結束時，才看掛在這幾段後面、沒編號的區塊。
    for tail in order[pos: pos + 1 + n]:
        for block in (unnumbered_after or {}).get(tail, []):
            if n < MAX_ABSORBED_TAIL and _unfinished(passage):
                passage += block
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


def extract(uid: str, part: dict | None = None) -> dict:
    """一「篇」的抽取。多篇課（L0029 兩篇、L0063 三篇）要逐篇跑，見 `parts()`。"""
    l = read_lesson(uid, part)
    out: dict = {"uid": uid, "title": l.get("title", uid), "slot": l.get("slot", ""),
                 "slug": l.get("slug"), "part": part,
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

    passage, absorbed = absorb_split_tail(l["texts"], l["order"], anchor, l["pos_of"],
                                          l.get("unnumbered_after"))
    passage = passage.strip()

    # ── 範圍：☞ 那一段 → 累計字數欄末筆落在的那一段 ────────────────────────
    #
    # ⚠️ 2026-08-30 加。在此之前 `end_paragraph` 寫死等於 `start_paragraph`，
    #    於是全庫 passage 中位數只有 144 字、只有 4/160 達 300 字 ——
    #    明珠老師 2026-08-29 回報「測流暢度需要至少 300 字」，測不了。
    #
    # 依據（三個互相獨立的來源）：
    #   ① 現場：學習單上「☞ 是開始，學生要讀的是右方有標字數的**全部段落**」
    #   ② 實體學習單照片（L0003）：☞ 在第七段，而第七段**第一行**的數字就是 28
    #      → 累計欄**從 ☞ 開始算**，末筆直接就是該唸的字數
    #   ③ 2026-07-20 專家審查定的是「約 300–400 字」（docs/PRD.md:1602）
    #
    # ⚠️ 這**不是**「一路抽到文末」（那個 2026-08-24 被否決，理由成立）——
    #    累計欄常常提早停（實測 115/138 課），停在哪就到哪。
    #
    # 末筆從 yml 的 `printed_counter_last` 讀（#2912 已轉錄 150 課），
    # 所以這支仍然**不需要 DOCX**。讀不到就退回單段並標記，⛔ 不猜。
    end = anchor
    counter_last = (l.get("kr") or {}).get("printed_counter_last")
    span_note = None
    if isinstance(counter_last, int) and counter_last > 0:
        # ⛔ 不是「累加到 >= max 才停」——那會多吃一段（實測 32 課差在這裡）。
        #    取**離 max 最近**的那個停點：一路累加，記下每一步的差距，挑最小的。
        acc, idx, hops = 0, anchor, 0
        best = (abs(0 - counter_last), anchor, 0)      # (差距, 停在哪一段, 到那裡的字數)
        while idx in l["by_idx"] and hops < MAX_SPAN_PARAGRAPHS:
            acc += len(_norm(l["by_idx"][idx]))
            cand = (abs(acc - counter_last), idx, acc)
            if cand[0] < best[0]:
                best = cand
            if acc >= counter_last:
                break
            idx += 1
            hops += 1
        gap, end, acc = best
        if gap > SPAN_TOLERANCE:
            # 對不上就不要假裝算對了 —— 出貨但標記，讓它被看見。
            span_note = (f"從第 {anchor} 段累加到第 {end} 段共 {acc} 字，"
                         f"但學習單累計欄末筆是 {counter_last}（差 {gap}）")
        if end > anchor:
            passage = "".join(l["by_idx"][i] for i in range(anchor, end + 1)).strip()
        # 沒編號的收尾區塊不在 `by_idx` 裡，上面的迴圈拿不到它。
        # L0084 就是這樣：counter_last=304，第 6 段只有 179，差的 125 字是那段
        # 沒有段號的結語（它自己的 passage_note 寫著「合計 304 字，與字數欄末筆吻合」）。
        # ⛔「沒有段號」是排版，不是「不用唸」—— 差距還大就把它接上，接完更接近才收。
        if gap > SPAN_TOLERANCE:
            for tail in (l.get("unnumbered_after") or {}).get(end, []):
                cand = (passage + tail).strip()
                if abs(len(_norm(cand)) - counter_last) < gap:
                    passage = cand
                    gap = abs(len(_norm(cand)) - counter_last)
                    span_note = None if gap <= SPAN_TOLERANCE else span_note
    else:
        span_note = "沒有 printed_counter_last，退回單段（不猜範圍）"

    #: 累計欄有沒有把這一課的範圍講清楚（沒講清楚才需要人裁決）
    gap_unresolved = span_note is not None

    out.update(passage=passage, absorbed_tail=absorbed, end_anchor=end,
               counter_last=counter_last, span_note=span_note,
               start_text=passage[:24], chars=len(_norm(passage)))

    if len(_norm(passage)) > MAX_CHARS:
        # Longer than any passage the professor ever marked ⇒ the anchor or the absorb
        # went wrong. Withheld: a wrong long passage is exactly #2712.
        out["verdict"] = "implausible_length"
        return out

    agreed = corroborate(passage, l["by_idx"])
    out["corroborated_by_first_edition"] = agreed
    # 抽這一課全文時，讀圖的人對「那個沒段號的收尾段算不算在朗讀範圍內」留了判斷。
    # 我們的句尾規則說不算（指定段自己把句子講完了）。兩個訊號相反、又沒有教授的
    # 掃描可以仲裁時，**照規則出貨並標記**，不是默默選一個。
    # 讀圖的人對「那個沒段號的收尾段算不算在朗讀範圍內」留了相反的判斷。
    # ⚠️ 2026-08-30：**累計字數欄可以仲裁這件事**。L0084 的 counter_last=304，
    #    而「第 6 段 ＋ 結語」正好 304 字（第 6 段自己只有 179）——
    #    紙上印的數字說了算，不需要再標成爭議。
    #    只有在累計欄也對不上時才標記交給人。
    if (not out.get("absorbed_tail")
            and gap_unresolved
            and any("朗讀範圍" in (n or "")
                    for n in (l.get("unnumbered_notes") or {}).get(anchor, []))):
        out["verdict"] = "unnumbered_tail_disputed"
        return out
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
    f = (r.get("part") or {}).get("kr_path")
    if f is None:                       # 單篇課、又沒帶 part 進來時的退路
        ps = parts(uid)
        f = ps[0]["kr_path"] if ps else None
    if f is None or not f.is_file():
        raise FileNotFoundError(f"{uid}: 找不到要寫回的 key_reading 檔")
    doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    kr = doc.get("key_reading")
    if kr is None:
        kr = doc.setdefault("key_reading", {})
    kr["passage"] = r["passage"]
    kr["start_text"] = r["start_text"]
    kr["extent_chars"] = r["chars"]
    kr["start_paragraph"] = r["anchor"]
    kr["end_paragraph"] = r.get("end_anchor") or r["anchor"]
    if r.get("counter_last") is not None:
        kr["printed_counter_last"] = r["counter_last"]
    for stale in RANGE_ERA_FIELDS:   # ⚠️ 不要叫 f —— 外面的 f 是要寫回的 Path
        kr.pop(stale, None)
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


WRITEABLE = {"ok", "confirmed", "disagrees_with_first_edition", "short_marked_paragraph",
             "unnumbered_tail_disputed"}

#: Verdicts that ship a passage but ask for eyes. Keyed rather than boolean so the file
#: records WHY — 「flagged with no reason」 is the failure mode #2725 named.
REVIEW_REASONS = {
    "disagrees_with_first_edition":
        "二修學習單指定第{anchor}段，一版人工掃描標的是同一課的另一段，且那段文字在"
        "本課仍逐字存在。二修為主所以照寫，但兩版之一標錯了，要人看紙本確認。",
    "unnumbered_tail_disputed":
        "第{anchor}段後面有一段沒有段號的收尾文字。本檔採句尾判準：第{anchor}段自己以"
        "句末標點結束，所以那段是另一段、不在 passage 內（{chars} 字）。但 "
        "`full_text_annotate.yml` 的 role_note 說它「在朗讀範圍內」—— 兩個訊號相反，"
        "且本課不在一版人工掃描可裁判的 38 課內，沒有第三方可仲裁。要人看紙本。",
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
    seen_parts = 0
    for uid in uids:
        ps = parts(uid)
        if not ps:
            counts["no_key_reading"] = counts.get("no_key_reading", 0) + 1
            continue
        for part in ps:
            seen_parts += 1
            r = extract(uid, part)
            counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
            tag = uid if len(ps) == 1 else f"{uid}#{part.get('slug')}"
            if r["verdict"] in WRITEABLE:
                if a.apply:
                    apply(uid, r)
                written += 1
                if not a.quiet:
                    print(f"✅ {tag} 第{r['anchor']}段 {r['chars']}字 "
                          f"[{r['verdict']}] {r['title']}")
            elif not a.quiet and r["verdict"] != "no_anchor":
                print(f"—  {tag} {r['verdict']} {r['title']}")

    print(f"\n可寫入 {written} 篇 / 共 {seen_parts} 篇"
          + ("（已寫入）" if a.apply else "（未寫入，加 --apply）"))
    for v, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"    {v:32s} {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
