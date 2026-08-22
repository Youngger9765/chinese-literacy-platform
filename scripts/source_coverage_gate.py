#!/usr/bin/env python3
"""原稿有多少內容沒被任何 yml 收走（#2877）。

## 這道門補的洞

十道門裡有九道問「**抽出來的東西對不對**」，第九道問「**大題有沒有著落**」。
中間還有一層沒人問：**一個大題有著落了，但它裡面的東西抽全了嗎？**

    一節 8 題只抽了 6 題        見證對帳抓得到 —— 但它只覆蓋 6 種題號型模組
    課文少抄一段 / 少一列       **1354 / 1844 份模組實例沒有任何門在問**

這道門從原稿那頭數：把 DOCX 的每一段拿去 yml 裡找，找不到的字累計起來。

## 🔴 量法踩過的兩個坑（都會讓數字錯得很誇張）

**① 整段比對 → 涵蓋率假低到 49%。** 原稿一行是
`(10)鷹眼：在網球、羽球等球類運動中…`，而 yml 拆成 `word` + `definition`
兩欄 —— 整段當然找不到。改成**貪婪吃片段**（能找到的 ≥6 字片段就算涵蓋）
之後是 85%。⚠️ 49% 很接近一半，當時第一反應是「XML 把內容重複兩次」，
查過才知道重複只佔 12–14%，真正的原因是欄位拆分。

**② 不去重 → 重複的段落算兩次。** 文字方塊的內容在 `<w:t>` 流裡會出現兩次。

## 剩下的 15% 是什麼

抽樣看過，兩類混在一起：

    真的沒抽到   老師的題目解析（「第4題解析：…」）、聚光燈的引導語、
                 朗讀的說明（「◎我的表現：請確認讀完全文的時間…」）
    量法雜訊     語詞框存成 list，而原稿那行是頓號串起來的一整串

⛔ 所以**不能拿一個絕對門檻當判準** —— 訂 90% 會對一半的課誤報。
改用**棘輪**：現況存成基準，只准往下。它擋的是「某個改動讓抽取收得更少」，
不是「現在夠不夠好」。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import subprocess
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend" / "data" / "lessons"
BASELINE = REPO / "specs" / "modules" / "source-coverage-baseline.json"
MIN_RUN = 6          # 片段至少這麼長才算「找到了」
MIN_PARA = 8         # 太短的段落不計（頁碼、單字標記）


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, REPO / "scripts" / f"{name}.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _sot() -> pathlib.Path:
    common = subprocess.run(["git", "rev-parse", "--git-common-dir"],
                            capture_output=True, text=True, cwd=REPO).stdout.strip()
    base = pathlib.Path(common).resolve().parent if common else REPO
    return base / "private" / "curriculum-source" / "_SOT"


def _blob(uid: str, vg) -> str:
    out = []
    for f in sorted((LESSONS / uid / "v3").glob("*.yml")):
        if f.stem.startswith("_") or f.stem == "lesson":
            continue
        d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        unver: list = []
        for _, v in vg.walk(d, unverifiable=unver):
            out.append(vg.norm(v))
        for _, v in unver:                    # 畫在圖上的也算收走了
            out.append(vg.norm(v))
    return "\n".join(out)


def _uncovered(p: str, blob: str) -> int:
    """貪婪吃掉能在 blob 找到的片段，回傳吃不掉的字數。"""
    rest, un = p, 0
    while rest:
        lo, hi, best = MIN_RUN, len(rest), 0
        while lo <= hi:
            mid = (lo + hi) // 2
            if rest[:mid] in blob:
                best, lo = mid, mid + 1
            else:
                hi = mid - 1
        if best >= MIN_RUN:
            rest = rest[best:]
        else:
            un += 1
            rest = rest[1:]
    return un


def measure(uid: str, vg, dw, sot: pathlib.Path) -> dict | None:
    ly = LESSONS / uid / "v3" / "lesson.yml"
    if not ly.is_file():
        return None
    rel = (yaml.safe_load(ly.read_text(encoding="utf-8")).get("source") or {}).get("drive_path")
    docx = sot / rel if rel else None
    if not docx or not docx.is_file():
        return None
    blob = _blob(uid, vg)
    seen: set[str] = set()
    total = un = 0
    for raw in dw.docx_paragraphs(docx):
        p = vg.norm(raw)
        if len(p) < MIN_PARA or p in seen:
            continue
        seen.add(p)
        total += len(p)
        un += _uncovered(p, blob)
    if total == 0:
        return None
    return {"total": total, "uncovered": un}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid")
    ap.add_argument("--set-baseline", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()

    sot = _sot()
    if not sot.is_dir():
        print("⚠️ 讀不到原稿（CI 沒有 private/）—— 這道門只能在本機跑")
        print("   ⛔ 這不是通過，是沒驗到。")
        return 0

    vg, dw = _load("verbatim_gate"), _load("docx_witnesses")
    uids = sorted(p.parent.parent.name for p in LESSONS.glob("L*/v3/lesson.yml"))
    if a.uid:
        uids = [u for u in uids if u == a.uid]
    if a.limit:
        uids = uids[: a.limit]

    now: dict[str, int] = {}
    measured = 0
    for u in uids:
        r = measure(u, vg, dw, sot)
        if r:
            now[u] = r["uncovered"]
            measured += 1

    if measured == 0:
        print("⛔ 一課都沒量到 —— 那是沒驗到，不是通過", file=sys.stderr)
        return 2

    if a.set_baseline:
        BASELINE.write_text(json.dumps(now, indent=2, sort_keys=True) + "\n",
                            encoding="utf-8")
        print(f"  基準已寫入 {measured} 課 → {BASELINE.relative_to(REPO)}")
        return 0

    if not BASELINE.is_file():
        print("⛔ 沒有基準檔 —— 先跑 --set-baseline", file=sys.stderr)
        return 2
    base = json.loads(BASELINE.read_text(encoding="utf-8"))

    worse = [(u, base[u], now[u]) for u in now if u in base and now[u] > base[u]]
    better = [(u, base[u], now[u]) for u in now if u in base and now[u] < base[u]]
    new = [u for u in now if u not in base]

    print(f"  量了 {measured} 課 · 未涵蓋字數合計 {sum(now.values())}"
          f"（基準 {sum(base.get(u, 0) for u in now)}）")
    if worse:
        print(f"  🔴 {len(worse)} 課的未涵蓋字數變多了 —— 有東西不再被收進 yml：")
        for u, b, n in sorted(worse, key=lambda x: x[2] - x[1], reverse=True)[:10]:
            print(f"      {u}  {b} → {n}  (+{n - b})")
        return 1
    if new:
        print(f"  ⛔ {len(new)} 課不在基準裡：{new[:6]} —— 跑 --set-baseline 收編")
        return 1
    if better:
        print(f"  ✅ {len(better)} 課變好了 —— 記得跑 --set-baseline 收緊棘輪")
    print("  SOURCE_COVERAGE=PASS  （沒有任何一課收得比基準少）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
