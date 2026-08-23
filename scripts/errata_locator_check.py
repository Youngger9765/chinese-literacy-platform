#!/usr/bin/env python3
"""用**位置**驗那些太短的勘誤（#2882）。

## 為什麼需要

逐字忠實度門靠「片段長度 ≥ 4 且含中文」比對，所以原文只有一個字的勘誤
（「五」印成「六」、找字格子某一格印錯）它碰不到 —— 25 筆記成 🟡「驗不到」。

⛔ 「驗不到」是誠實的狀態，但**不是必然的** —— 那些勘誤都帶著 `locator`
（「找字格子第 8 列第 5 欄」「段號欄第 1 個號碼」），
用位置去查就精確驗得到，不需要片段比對。

## 三類驗得到的

    找字格子單格   對 vocab_review.grid[列-1][欄-1]
    段號欄的號碼   對原稿的段號序列（注音「ㄧ」U+3127 混進漢字「一」是高頻病）
    大題序號       對 lesson.yml 的 sections_present

## ⛔ 剩下的仍然驗不到，不要硬湊

    corrected 是 None 的（那不是勘誤，是「這裡有東西但我判不出」）
    EMF 字型 fallback 造成的字形（原文不在文字層）
    text_carrier: image 的
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend" / "data" / "lessons"

GRID = re.compile(r"找字格子\s*第?\s*(\d+)\s*列\s*第?\s*(\d+)\s*欄")
PARA_NO = re.compile(r"段號欄第\s*([一二三四五六七八九十\d]+)\s*個號碼")


def _errata(uid: str) -> list[dict]:
    f = LESSONS / uid / "v3" / "errata.yml"
    if not f.is_file():
        return []
    d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    return ((d.get("notes") or {}).get("errata")) or []


def _grid(uid: str) -> list[str] | None:
    f = LESSONS / uid / "v3" / "vocab_review.yml"
    if not f.is_file():
        return None
    b = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("vocab_review") or {}
    g = b.get("grid")
    return g if isinstance(g, list) else None


def _source_paras(uid: str) -> list[str] | None:
    """原稿的段落（文件順序）。讀不到就回 None —— ⛔ 不要當成驗過了。"""
    import importlib.util
    import subprocess
    spec = importlib.util.spec_from_file_location(
        "dw", REPO / "scripts" / "docx_witnesses.py")
    dw = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dw)
    ly = LESSONS / uid / "v3" / "lesson.yml"
    if not ly.is_file():
        return None
    rel = (yaml.safe_load(ly.read_text(encoding="utf-8")).get("source") or {}).get("drive_path")
    common = subprocess.run(["git", "rev-parse", "--git-common-dir"],
                            capture_output=True, text=True, cwd=REPO).stdout.strip()
    base = pathlib.Path(common).resolve().parent if common else REPO
    docx = base / "private" / "curriculum-source" / "_SOT" / rel if rel else None
    if not docx or not docx.is_file():
        return None
    return dw.docx_paragraphs(docx)


def check_one(uid: str, e: dict) -> tuple[str, str]:
    """回 (verdict, 說明)。verdict ∈ pass / fail / unverifiable"""
    loc = str(e.get("locator") or "")
    src = e.get("source")

    if not isinstance(src, str) or not src.strip():
        return "unverifiable", "source 不是字串"
    if e.get("text_carrier") == "image":
        return "unverifiable", "原文畫在圖上"
    if e.get("corrected") is None:
        return "unverifiable", "corrected 是 None —— 那不是勘誤，是判不出"

    m = GRID.search(loc)
    if m:
        g = _grid(uid)
        if not g:
            return "unverifiable", "這課沒有找字格子"
        r, c = int(m.group(1)) - 1, int(m.group(2)) - 1
        if not (0 <= r < len(g) and 0 <= c < len(g[r])):
            return "unverifiable", f"座標 ({r+1},{c+1}) 超出格子範圍"
        got = g[r][c]
        if got == src:
            return "pass", f"格子({r+1},{c+1}) = {got!r}"
        # ⚠️ 格子可能已經被修過了 —— 那不是勘誤錯，是勘誤已被採用
        if got == e.get("corrected"):
            return "pass", f"格子已採用勘誤：{got!r}（原印 {src!r}）"
        return "fail", f"格子({r+1},{c+1}) 是 {got!r}，勘誤說是 {src!r}"

    if PARA_NO.search(loc) or "段號" in loc:
        paras = _source_paras(uid)
        if paras is None:
            return "unverifiable", "讀不到原稿"
        if src in paras:
            return "pass", f"原稿段落序列裡有獨立的 {src!r}"
        return "fail", f"原稿段落序列裡沒有獨立的 {src!r}"

    if "序號" in loc:
        paras = _source_paras(uid)
        if paras is None:
            return "unverifiable", "讀不到原稿"
        if src in paras:
            return "pass", f"原稿有獨立的序號 {src!r}"
        return "fail", f"原稿沒有獨立的序號 {src!r}"

    return "unverifiable", f"這種 locator 還沒有驗法：{loc[:30]!r}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    uids = ([a.uid] if a.uid
            else sorted(p.parent.parent.name for p in LESSONS.glob("L*/v3/errata.yml")))
    tally = {"pass": 0, "fail": 0, "unverifiable": 0}
    rows = []
    for uid in uids:
        for e in _errata(uid):
            v, why = check_one(uid, e)
            tally[v] += 1
            if v != "pass":
                rows.append((uid, e.get("id"), v, why))

    if a.json:
        print(json.dumps({"tally": tally, "rows": rows}, ensure_ascii=False, indent=2))
        return 1 if tally["fail"] else 0

    total = sum(tally.values())
    if total == 0:
        print("⛔ 一條勘誤都沒檢查到 —— 那是沒驗到，不是通過", file=sys.stderr)
        return 2
    print(f"  {len(uids)} 課 · 勘誤 {total} 條 · "
          f"✅ 位置驗過 {tally['pass']} · 🔴 對不上 {tally['fail']} · "
          f"🟡 仍驗不到 {tally['unverifiable']}")
    for uid, eid, v, why in rows:
        if v == "fail":
            print(f"    🔴 {uid} {eid}: {why}")
    for uid, eid, v, why in rows[:8]:
        if v == "unverifiable":
            print(f"    🟡 {uid} {eid}: {why}")
    return 1 if tally["fail"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
