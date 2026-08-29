#!/usr/bin/env python3
"""念順順 QA：拿學習單自己印的兩個標記，對帳抽出來的段落。

    python3 scripts/key_reading_qa.py              # 全庫
    python3 scripts/key_reading_qa.py --uid L0011  # 單課
    python3 scripts/key_reading_qa.py --json       # 機器讀

## 兩個標記，各管一頭

    ☞（或指令裡的「從指定段落（三）開始朗讀」）  → 起點
    課文右緣印的累計字數，最後一個              → 終點

owner 2026-08-24：「☞ 是 start，最後的數字是 end」。

以前只有起點有依據，終點是抽取器自己決定的（`end: 課文結束`），於是一路讀到文章結尾。
第一課就是這樣：學習單的累計字數印到 **376** 就停，存起來的 passage 是 **487** 字。
存檔裡還寫著 `approx_chars_note: 數字欄印完了，不是課文到此為止` —— 那是推論。

## 為什麼「印完了」講不通

第一課的累計數列是

    25 55 85 114 133 161 191 221 250 280 309 339 369 376
                                                     ^^^ +7

每一步都是 ~30（一行），**只有最後一步是 +7**。欄位印完會停在某個 ~30 的邊界；
停在 +7 代表最後一行本來就短 —— 課文到這裡結束。全庫 101/147 課的最後一步明顯較短，
同一個形狀。

## 這支不改任何東西

它只讀原稿與 yml，印出對帳結果。修不修、怎麼修，是內容規格那邊的決定。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import re
import statistics
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
SOT = REPO / "private" / "curriculum-source" / "_SOT"
LESSONS = REPO / "backend" / "data" / "lessons"

_spec = importlib.util.spec_from_file_location("dw", REPO / "scripts" / "docx_witnesses.py")
dw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dw)

# ✅ 判準已確認（2026-08-29）
#
# Owner 2026-08-24：「☞ 是 start，最後的數字是 end」。
# 一度以為對不上（157 課裡 145 課判「抽太少」），但那是**資料錯，不是判準錯** ——
# 我當時拿「存的」去比「整篇總字數」，少扣了 ☞ 之前的部分。
#
# 扣掉之後兩個獨立的尺互相印證：
#
#   【☞→文末】  中位數 303   落在 300–400 的 67/147   250–450 的 108/147
#   【現在存的】中位數 148   落在 300–400 的  4/147   250–450 的  16/147
#
# 303 正好落在 2026-07-20 專家審查定的 300–400 中間。所以 target =
# 「累計字數欄最後一個數字」減掉「☞ 之前那幾段的字數」。
#
# 真正的 bug 在抽取端：`end_paragraph == start_paragraph` 有 150/160 ——
# 只抽了 ☞ 那一段就停，而學習單寫的是「從指定段落（四☞）**開始**朗讀」。
# 修抽取是 #2712（intern-first），不在這支腳本的範圍。
#
# 差多少才算沒貼合。一行約 30 字，抓半行。
TOLERANCE = 15
# 少於這麼多個數字就不像累計字數欄，寧可回「無法判斷」也不要硬算。
MIN_RUN = 4
# 2026-07-20 專家審查：念順順只練老師指定的重點段，約 300–400 字。
SPEC_MIN, SPEC_MAX = 300, 400


_CN_DIGITS = "一二三四五六七八九十"


def _ordinal_to_int(s):
    """「四」「十二」「3」→ int。認不出來回 None（寧可回「無法判斷」也不要硬猜）。"""
    s = (s or "").strip()
    if not s:
        return None
    if s.isdigit():
        return int(s)
    if s == "十":
        return 10
    if len(s) == 1:
        return _CN_DIGITS.index(s) + 1 if s in _CN_DIGITS else None
    if s.startswith("十"):
        return 10 + (_CN_DIGITS.index(s[1]) + 1 if len(s) > 1 and s[1] in _CN_DIGITS else 0)
    if "十" in s:
        a, b = s.split("十", 1)
        if a in _CN_DIGITS and (not b or b in _CN_DIGITS):
            return (_CN_DIGITS.index(a) + 1) * 10 + ((_CN_DIGITS.index(b) + 1) if b else 0)
    return None


def _key_reading_file(vdir):
    """那一課的 key_reading yml —— 無 slug 的舊檔名優先，其次帶 slug 的第一份。"""
    cand = vdir / "key_reading.yml"
    if cand.is_file():
        return cand
    rest = sorted(vdir.glob("key_reading.*.yml"))
    return rest[0] if rest else cand


def _key_reading_files(lessons_root):
    """全語料的 key_reading yml（兩種檔名都算）。"""
    return sorted(lessons_root.glob("L*/v3/key_reading.yml")) + \
           sorted(lessons_root.glob("L*/v3/key_reading.*.yml"))


def cumulative_counter(paragraphs: list[str]) -> list[int]:
    """課文右緣印的累計字數：獨立成段的純數字，取單調遞增那一串。

    只認獨立成段的數字。內文裡的數字（年份、比分）不會自己成一段。
    一遇到不遞增就停 —— 後面那些是別的東西（表格、題號）。
    """
    seq: list[int] = []
    for t in paragraphs:
        t = t.strip()
        if not re.fullmatch(r"\d{2,4}", t):
            continue
        n = int(t)
        if not seq or n > seq[-1]:
            seq.append(n)
        else:
            break
    return seq


def start_ordinal(instruction: str) -> str | None:
    """指令裡的起點序數：「從指定段落（三☞）開始朗讀」→「三」。"""
    m = re.search(r"從指定段落[（(]\s*([一二三四五六七八九十\d]+)", instruction or "")
    return m.group(1) if m else None


def audit(uid: str) -> dict:
    out: dict = {"uid": uid, "verdict": "無法判斷", "why": ""}
    # ⚠️ #2916 之後檔名是 `key_reading.{slug}.yml`（一課多篇會有好幾份）。
    #    寫死無 slug 的名字 = 一課都掃不到，而且不會有錯誤 —— 只會回「沒有資料」。
    kp = _key_reading_file(LESSONS / uid / "v3")
    lp = LESSONS / uid / "v3" / "lesson.yml"
    if not kp.is_file():
        out["why"] = "沒有 key_reading yml"
        return out
    kr = yaml.safe_load(kp.read_text(encoding="utf-8")) or {}
    kr = kr.get("key_reading", kr) or {}
    out["stored"] = len(kr.get("passage") or "")
    out["start_paragraph"] = kr.get("start_paragraph")
    out["end_field"] = kr.get("end")
    out["start_ordinal_printed"] = start_ordinal(kr.get("instruction") or "")

    lesson = yaml.safe_load(lp.read_text(encoding="utf-8")) or {}
    lesson = lesson.get("lesson", lesson)
    rel = (lesson.get("source") or {}).get("drive_path")
    docx = SOT / rel if rel else None
    if not (docx and docx.is_file()):
        out["why"] = "原稿不在（private/，CI 跑不到 —— 那是刻意的）"
        return out

    seq = cumulative_counter(dw.docx_paragraphs(str(docx)))
    if len(seq) < MIN_RUN:
        out["why"] = f"讀不到累計字數欄（只有 {len(seq)} 個數字）"
        return out

    steps = [b - a for a, b in zip(seq, seq[1:])]
    # target = ☞ 那一段到文末的字數 = 總字數 - ☞ 之前那幾段
    start_no = _ordinal_to_int(out.get("start_ordinal_printed"))
    before = 0
    if start_no and 2 <= start_no <= len(seq):
        before = seq[start_no - 2]
    out["start_no"] = start_no
    out["chars_before_start"] = before
    out["target"] = seq[-1] - before
    out["article_total"] = seq[-1]
    out["counter_len"] = len(seq)
    out["last_step"] = steps[-1]
    out["typical_step"] = int(statistics.median(steps[:-1])) if len(steps) > 1 else 0
    # 最後一步明顯較短 = 課文到此結束；否則有可能真的是欄位印完了
    out["ends_naturally"] = out["last_step"] < out["typical_step"] * 0.8 if out["typical_step"] else None

    if not out["stored"]:
        out["verdict"] = "空"
        out["why"] = "passage 是空的"
        return out
    # 不需要任何判斷的一個量：2026-07-20 專家審查定的規格是 300–400 字。
    # 下面那個「對帳」要先假設『最後的數字』是什麼意思，這個不用。
    out["in_spec"] = SPEC_MIN <= out["stored"] <= SPEC_MAX

    delta = out["stored"] - out["target"]
    out["delta"] = delta
    if abs(delta) <= TOLERANCE:
        out["verdict"] = "貼合"
    elif delta > 0:
        out["verdict"] = "抽太多"
        out["why"] = f"學習單印到 {out['target']} 字，存了 {out['stored']} 字（多 {delta}）"
    else:
        out["verdict"] = "抽太少"
        out["why"] = f"學習單印到 {out['target']} 字，只存了 {out['stored']} 字（少 {-delta}）"
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid", action="append")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    uids = a.uid or sorted({p.parts[-3] for p in _key_reading_files(LESSONS)})
    rows = [audit(u) for u in uids]

    if a.json:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
        return 0

    tally: dict[str, int] = {}
    for r in rows:
        tally[r["verdict"]] = tally.get(r["verdict"], 0) + 1
    print(f"  念順順對帳 —— {len(rows)} 課")
    for k in ("貼合", "抽太多", "抽太少", "空", "無法判斷"):
        if tally.get(k):
            print(f"    {k:<6} {tally[k]:>4}")
    judged = sum(tally.get(k, 0) for k in ("貼合", "抽太多", "抽太少"))
    if judged:
        print(f"    貼合率 {tally.get('貼合', 0) * 100 // judged}%（判得動的 {judged} 課裡）")

    worst = sorted((r for r in rows if r["verdict"] == "抽太多"), key=lambda r: -r["delta"])[:8]
    if worst:
        print("  抽太多最嚴重：")
        for r in worst:
            print(f"     {r['uid']}  學習單 {r['target']} → 存 {r['stored']}（多 {r['delta']}）")
    in_spec = [r for r in rows if r.get("in_spec")]
    print(f"    落在 300–400 字規格的：{len(in_spec)}/{len(rows)}")

    # 「無法判斷」要看得見，不可以被當成通過
    unknown = [r for r in rows if r["verdict"] == "無法判斷"]
    if unknown:
        print(f"  ⚠️ 判不動 {len(unknown)} 課（不是通過）：{', '.join(r['uid'] for r in unknown[:8])}"
              + (" …" if len(unknown) > 8 else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
