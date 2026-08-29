#!/usr/bin/env python3
"""量 overview scan 的重跑一致率（#2865）。

## 為什麼要有這支

抽取流程有兩半：

    學習單 →〔① overview：判有哪幾個大題〕→ 派工單 →〔② N 架飛機：抽內容〕→ N 份 yml
              ↑ LLM                                    ↑ LLM

決定性的那半（頁碼定位、派工單、對帳、schema、各種門）有 14 支腳本守著。
**LLM 的那半在此之前沒有任何東西在量。** repo 裡四支叫 `eval_*` 的腳本，
三支是純結構檢查，只有一支真的碰 LLM —— 也就是說「AI 判得穩不穩」從來沒有數字。

2026-08-22 第一次量（L0072 × 3 次，手動跑三個 agent 再手工比對）：

    大題數            9 / 9 / 9
    序號 + 名稱 + 順序  3/3 完全相同
    頁碼              8/9 相同（「一 讀全文-做記號」一次說 [1]，兩次說 [1,2]）

⇒ **要派哪幾架飛機是穩的；每架讀哪幾頁不穩。**
而頁碼錯了不會有症狀 —— 少讀一頁的飛機照樣抽得出東西、照樣過門、照樣回報成功。

那次量測沒有留下任何可以再跑一次的東西。這支就是把它固化：
下次改了 prompt、換了 model、或想知道別的課型穩不穩，跑這支就有數字。

## 這支不呼叫 LLM

它**只做比對**。跑 scan 的是 agent（要 LLM），這支吃它們的輸出。
分開的理由：比對邏輯必須是決定性的，否則「一致率」這個數字本身就不可信。

## 用法

    # 每個 run 一個 JSON 檔，內容是 [{"no","name","pages"}, ...]
    python3 scripts/eval_overview_repeatability.py --uid L0072 run-a.json run-b.json run-c.json

    # 跟決定性定位器對帳（判斷「多數決」是不是真的對）
    python3 scripts/eval_overview_repeatability.py --uid L0072 run-*.json --against-locator

exit 0 = 大題集合完全一致（頁碼不一致只警告，因為頁碼本來就該交給定位器）
exit 1 = 大題集合有分歧 —— 分派層不可信，⛔ 不要把 overview 接進自動流程
exit 2 = 材料不齊（檔讀不到、格式不對）
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
PAGES_FILE = REPO / "specs" / "modules" / "section-pages.yml"


def load_run(path: pathlib.Path) -> list[dict] | None:
    """讀一個 run。回 None 代表讀不到 —— 跟「讀到空的」是兩件事。"""
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return None
    # agent 可能在 JSON 前後多講話，抓第一個 [ 到最後一個 ]
    lo, hi = raw.find("["), raw.rfind("]")
    if lo < 0 or hi < lo:
        return None
    try:
        data = json.loads(raw[lo : hi + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, list) else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="+", type=pathlib.Path)
    ap.add_argument("--uid", required=True)
    ap.add_argument("--against-locator", action="store_true",
                    help="拿決定性定位器當第四票，判斷多數決是不是真的對")
    args = ap.parse_args()

    if len(args.runs) < 2:
        print("⛔ 至少要兩個 run 才量得出一致率")
        return 2

    runs: dict[str, list[dict]] = {}
    for p in args.runs:
        data = load_run(p)
        if data is None:
            print(f"⛔ 讀不到或格式不對：{p}")
            return 2
        runs[p.name] = data

    print(f"── {args.uid} overview 重跑一致率（{len(runs)} 次）──")

    # ① 大題集合：這一層決定「派幾架飛機」，不一致就沒得談
    keys = {n: [(s.get("no"), s.get("name")) for s in r] for n, r in runs.items()}
    counts = sorted({len(r) for r in runs.values()})
    unanimous = len({tuple(v) for v in keys.values()}) == 1
    print(f"  大題數        : {[len(r) for r in runs.values()]}")
    print(f"  序號+名稱+順序 : {'✅ 全部相同' if unanimous else '🔴 有分歧'}")
    if not unanimous:
        seen = collections.Counter(tuple(v) for v in keys.values())
        for variant, n in seen.most_common():
            print(f"    {n} 票: {[f'{a}{b}' for a, b in variant]}")

    # ② 頁碼：這一層本來就該交給定位器，不一致只是佐證那個判斷
    n_sections = counts[0]
    disagree = []
    for i in range(n_sections):
        pages = {n: tuple(r[i].get("pages") or []) for n, r in runs.items()}
        if len(set(pages.values())) > 1:
            disagree.append((runs[args.runs[0].name][i], pages))
    print(f"  頁碼          : {n_sections - len(disagree)}/{n_sections} 全部相同")
    for sec, pages in disagree:
        detail = "  ".join(f"{n}={list(p)}" for n, p in pages.items())
        print(f"    🟡 {sec.get('no')} {sec.get('name')}: {detail}")

    if disagree:
        print("  ⇒ 頁碼本來就不該問 LLM。決定性來源：scripts/build_section_pages.py")

    if args.against_locator and disagree:
        try:
            import yaml
            db = yaml.safe_load(PAGES_FILE.read_text(encoding="utf-8")) or {}
            # 課在 `lessons` 底下，不在頂層（頂層是 generated_by / note / lessons）。
            # ⚠️ 第一版讀成 db[uid] → 每一課都回「（無）」，看起來像「定位器沒有這課」
            # 而不是「我讀錯層」—— 所以下面找不到課要明講找不到，不可以印成空的。
            lessons = db.get("lessons") or {}
            entry = (lessons.get(args.uid) or {}).get("sections") or []
            if not entry:
                raise KeyError(f"{args.uid} 不在 {PAGES_FILE.name} 的 lessons 底下")
            by_name = {s.get("name"): tuple(s.get("pages") or []) for s in entry}
            print("  ── 跟決定性定位器對帳 ──")
            for sec, pages in disagree:
                truth = by_name.get(sec.get("name"))
                agree = [n for n, p in pages.items() if p == truth]
                print(f"    {sec.get('name')}: 定位器={list(truth) if truth else '（無）'}"
                      f"  與它一致的 run: {agree or '一個都沒有'}")
        except Exception as exc:  # noqa: BLE001
            # 對帳失敗要說出來，不要靜默跳過 —— 那會看起來像「對帳過了」
            print(f"    ⚠️ 對帳讀不到 {PAGES_FILE.name}：{exc}")

    if not unanimous:
        print("\n🔴 大題集合不一致 ⇒ 分派層不可信。")
        print("   ⛔ 在這個數字變成 100% 之前，不要把 overview 接進任何自動流程。")
        return 1

    print("\n✅ 大題集合完全一致 —— 「要派哪幾架飛機」這一層可信")
    if disagree:
        print("   （頁碼的分歧不影響這個結論，因為頁碼由定位器出）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
