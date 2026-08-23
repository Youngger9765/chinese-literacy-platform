#!/usr/bin/env python3
"""⑥a 的重跑一致率，樣本 N=175 而不是 3（#2883）。

## 為什麼不是「同一課跑三次」

那才是教科書做法，但**我不能自己做那個測量** —— 我看過自己第一次的輸出，
第二、三次就不是獨立的。假裝跑三次然後報一個「3/3 相同」是在騙人。

現有語料庫是同一個抽取器跑過 **175 次**的產物。量它的**形狀變異**，
就是在量同一件事，而且樣本大得多、也沒有汙染。

## 讀法：形狀種類多 ≠ 模型在飄

實測 `full_text_annotate` 164 課出現 **87 種**不同的欄位集合，
乍看很糟。但拆開來看：

```
幾乎都有(≥95%)   3 種欄位   paragraphs / paragraph_count / char_count
中間(20~95%)     6 種
只出現在個位數    66 種   ← 87 種形狀幾乎全部來自這裡
```

那 66 種是「某一課的版面真的長那樣」（`_header_box`、`作者欄原樣`…），
不是模型每次亂長不同欄位。⛔ 拿 9% 當「不穩」是誤讀。

## 這支報什麼

    core_stability   核心欄位（≥95% 課都有）的一致率 —— 這個要高
    tail_fields      只出現在 <20% 課的欄位數 —— 這個高不是壞事，但要知道
    shape_variants   欄位集合的種類數 —— 只當參考，⛔ 不要拿它當判準
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend" / "data" / "lessons"


def measure(mod: str) -> dict | None:
    files = sorted(LESSONS.glob(f"L*/v3/{mod}.yml"))
    freq: collections.Counter = collections.Counter()
    shapes: collections.Counter = collections.Counter()
    n = 0
    for f in files:
        b = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get(mod)
        if not isinstance(b, dict):
            continue
        n += 1
        keys = [k for k in b if k != "notes"]
        shapes[frozenset(keys)] += 1
        for k in keys:
            freq[k] += 1
    if n == 0:
        return None
    core = [k for k, v in freq.items() if v >= n * 0.95]
    tail = [k for k, v in freq.items() if v < n * 0.2]
    # 核心欄位一致率：每一課都有全部核心欄位嗎
    full = sum(1 for shape, c in shapes.items()
               if all(k in shape for k in core) for _ in range(c))
    return {
        "module": mod, "n": n,
        "core_fields": sorted(core),
        "core_stability": round(100 * full / n),
        "tail_fields": len(tail),
        "shape_variants": len(shapes),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-n", type=int, default=10)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    mods = sorted({p.stem for p in LESSONS.glob("L*/v3/*.yml")
                   if p.stem != "lesson" and not p.stem.startswith("_")})
    rows = [r for r in (measure(m) for m in mods) if r and r["n"] >= a.min_n]
    if not rows:
        print("⛔ 一個模組都沒量到 —— 那是沒驗到，不是通過", file=sys.stderr)
        return 2

    if a.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0

    print(f"  {'模組':24}{'N':>4}  核心欄位一致率  尾巴欄位  形狀種類")
    for r in sorted(rows, key=lambda x: x["core_stability"]):
        flag = "" if r["core_stability"] == 100 else "  ← 核心欄位有課沒有"
        print(f"  {r['module']:24}{r['n']:4}      {r['core_stability']:3}%"
              f"        {r['tail_fields']:3}      {r['shape_variants']:3}{flag}")
    worst = min(r["core_stability"] for r in rows)
    print(f"\n  核心欄位一致率最低 {worst}%")
    print("  ⚠️ 形狀種類多不代表模型在飄 —— 多數來自「某一課版面真的長那樣」"
          "的尾巴欄位。⛔ 不要拿它當判準。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
