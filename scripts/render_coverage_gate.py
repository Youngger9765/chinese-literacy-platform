#!/usr/bin/env python3
"""渲染覆蓋門 —— 抽出來的東西，前端畫不畫得出來

逐字門管「抽對了沒」，這道門管「畫得出來沒」。兩者互補：
一個 block 可以逐字完全正確，卻因為前端沒有對應元件而在畫面上完全消失。
那種缺失沒有任何錯誤訊息，學生只是看不到題目。

實測（2026-08-17）：`multi`（複選題）68 個 block、橫跨 37 課，
後端契約 KNOWN_BLOCK_TYPES 允許，但 BlockSequenceRenderer 沒有對應 case。

用法：
    python3 scripts/render_coverage_gate.py                 # 掃全庫
    python3 scripts/render_coverage_gate.py --lessons-root qa/content-evidence
    python3 scripts/render_coverage_gate.py --json out.json

退出碼：0 = 每個出現過的 type 都畫得出來；1 = 有畫不出來的
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
RENDERER = REPO / "frontend/src/components/reading-spotlight/BlockSequenceRenderer.tsx"
CONTRACT = REPO / "backend/app/services/spotlight_contract.py"


def renderer_types() -> set[str]:
    """從前端 renderer 反推它實際處理哪些 type。

    ⚠️ 用 grep 反推有其極限：它只證明「原始碼提到這個字串」，不證明「真的畫出東西」。
    要更硬的證據得靠 render smoke test。這道門的定位是**便宜的早期警報**，不是完成證明。
    """
    if not RENDERER.exists():
        raise SystemExit(f"⛔ 找不到 renderer：{RENDERER}")
    src = RENDERER.read_text(encoding="utf-8")
    return set(re.findall(r"""["'`]([a-z_]+)["'`]\s*(?:===|:|=>)""", src)) | set(
        re.findall(r"""case\s+["']([a-z_]+)["']""", src)
    )


def contract_types() -> set[str]:
    if not CONTRACT.exists():
        return set()
    src = CONTRACT.read_text(encoding="utf-8")
    m = re.search(r"KNOWN_BLOCK_TYPES\s*=\s*frozenset\(\{(.*?)\}\)", src, re.S)
    return set(re.findall(r'"([a-z_]+)"', m.group(1))) if m else set()


def collect(root: Path) -> tuple[collections.Counter, dict[str, set[str]]]:
    cnt: collections.Counter = collections.Counter()
    where: dict[str, set[str]] = collections.defaultdict(set)
    for p in sorted(root.rglob("*.yml")):
        try:
            data = yaml.safe_load(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        sp = data.get("spotlight")
        if not isinstance(sp, dict):
            continue
        uid = (data.get("meta") or {}).get("lesson_uid") or p.parent.parent.name
        for b in sp.get("blocks") or []:
            if isinstance(b, dict):
                t = str(b.get("type", "?"))
                cnt[t] += 1
                where[t].add(uid)
    return cnt, where


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lessons-root", type=Path, default=REPO / "backend/data/lessons")
    ap.add_argument("--json", type=Path)
    a = ap.parse_args()

    render = renderer_types()
    contract = contract_types()
    cnt, where = collect(a.lessons_root)

    if not cnt:
        print(f"⛔ {a.lessons_root} 底下沒有找到任何 spotlight block —— 視為 FAIL")
        print("RENDER_COVERAGE_GATE=FAIL")
        return 1

    print(f"renderer 認得 : {len(render & (contract | set(cnt)))} 種")
    print(f"契約允許      : {len(contract)} 種")
    print(f"實際用到      : {len(cnt)} 種\n")

    gaps = []
    for t, c in cnt.most_common():
        drawable = t in render
        mark = "✅" if drawable else "🔴 畫不出來"
        print(f"  {t:14s} {c:5d} 個 / {len(where[t]):3d} 課   {mark}")
        if not drawable:
            gaps.append({"type": t, "blocks": c, "lessons": sorted(where[t])})

    # 契約允許但沒人用 = 死型別；不算缺口，但值得知道
    unused = sorted(contract - set(cnt) - {"unknown"})
    if unused:
        print(f"\n  （契約有、實際沒人用：{', '.join(unused)}）")

    if gaps:
        print("\n=== 缺口 ===")
        for g in gaps:
            print(f"  {g['type']}：{g['blocks']} 個 block，{len(g['lessons'])} 課")
            print(f"    {', '.join(g['lessons'][:12])}{' …' if len(g['lessons']) > 12 else ''}")

    if a.json:
        a.json.write_text(json.dumps({
            "renderer_types": sorted(render & (contract | set(cnt))),
            "used": dict(cnt),
            "gaps": gaps,
        }, ensure_ascii=False, indent=1), encoding="utf-8")

    print()
    print("RENDER_COVERAGE_GATE=" + ("PASS" if not gaps else "FAIL"))
    return 0 if not gaps else 1


if __name__ == "__main__":
    sys.exit(main())
