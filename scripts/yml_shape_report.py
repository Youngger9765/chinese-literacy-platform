#!/usr/bin/env python3
"""每個模組的 yml 形狀量測器（#2843）。

回答一個問題：**同一個模組的 175 課，長得像不像？**

分兩層量，因為兩層的答案差很多：
  top-level  —— 幾乎每個模組都只有 1 種形狀（lesson_uid / version_id / section_no / payload）
  內層 payload —— 變異都在這裡

PR #2844 的 PRD 寫「597 種 key-shape」，讀起來像抽取器整個失控。那是把兩層混在一起
又把註解欄位算進去的結果。這支就是拿來把話講清楚的。

用法：
    python3 scripts/yml_shape_report.py                    # 人看的表
    python3 scripts/yml_shape_report.py --json             # 機器讀的
    python3 scripts/yml_shape_report.py --compare A B      # 比兩份 json
    python3 scripts/yml_shape_report.py --module key_reading   # 只看一個
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import re
import sys

import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
LESSONS = REPO_ROOT / "backend" / "data" / "lessons"

#: 每份模組 yml 都有的表頭，不算進 payload
HEADER_KEYS = {"lesson_uid", "version_id", "section_no"}

#: 註解型欄位的樣態。保守：寧可漏收，不可誤收 —— 誤收會把真資料搬走。
#: `_scope` / `_圈選note` 這種底線開頭的也算，它們是抽取當下的旁註。
NOTEISH = re.compile(r"(note|說明|備註)$|^_|_ref$|errata|carrier|scope", re.IGNORECASE)

#: 核心 / 邊緣的門檻。核心 = 幾乎每課都有；邊緣 = 幾乎沒課有。
CORE_RATIO = 0.9
RARE_RATIO = 0.1


def payload_of(data: dict, stem: str):
    """取出模組的內容本體。

    大多數檔是 `{lesson_uid, version_id, section_no, <stem>: {...}}`，
    但不是全部 —— 有些直接把欄位攤在 top-level。兩種都要處理，
    否則會把「攤平的那種」誤判成沒有 payload 而整批漏算。
    """
    for candidate in (stem, stem.rstrip("s"), stem + "s"):
        value = data.get(candidate)
        if isinstance(value, dict):
            return value
        if isinstance(value, list) and value and isinstance(value[0], dict):
            return value[0]

    rest = {k: v for k, v in data.items() if k not in HEADER_KEYS}
    if len(rest) == 1:
        only = next(iter(rest.values()))
        if isinstance(only, dict):
            return only
        if isinstance(only, list) and only and isinstance(only[0], dict):
            return only[0]
    return rest


def collect(module: str | None = None) -> dict:
    per_module: dict[str, list[frozenset]] = collections.defaultdict(list)
    top_level: dict[str, list[frozenset]] = collections.defaultdict(list)
    unreadable: list[str] = []

    for version_dir in sorted(LESSONS.glob("L*/v3")):
        for path in sorted(version_dir.glob("*.yml")):
            # 重複大題的檔名是 `{module}.{slug}.yml`（#2916）——收斂回模組名，
            # 否則每個 slug 都變成一個「只有 1 種形狀」的假模組，形狀棘輪形同虛設
            stem = path.stem.partition(".")[0]
            if module and stem != module:
                continue
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            except Exception:
                unreadable.append(str(path.relative_to(REPO_ROOT)))
                continue
            if not isinstance(data, dict):
                continue
            top_level[stem].append(frozenset(data.keys()))
            body = payload_of(data, stem)
            if isinstance(body, dict):
                per_module[stem].append(frozenset(body.keys()))

    report = {}
    for stem, shapes in per_module.items():
        n = len(shapes)
        counts = collections.Counter(k for shape in shapes for k in shape)
        core = sorted(k for k, c in counts.items() if c >= CORE_RATIO * n)
        rare = sorted(k for k, c in counts.items() if c < RARE_RATIO * n)
        mid = sorted(k for k, c in counts.items() if RARE_RATIO * n <= c < CORE_RATIO * n)
        report[stem] = {
            "lessons": n,
            "inner_shapes": len(set(shapes)),
            "top_level_shapes": len(set(top_level[stem])),
            "core": core,
            "mid": mid,
            "rare": rare,
            "rare_noteish": sorted(k for k in rare if NOTEISH.search(str(k))),
        }
    return {"modules": report, "unreadable": unreadable}


def print_table(report: dict) -> None:
    mods = report["modules"]
    print(f"{'模組':<28}{'課數':>5}{'內層形狀':>9}{'top':>5}{'核心':>5}{'邊緣':>5}{'其中註解型':>11}")
    print("-" * 72)
    for stem, r in sorted(mods.items(), key=lambda kv: -kv[1]["lessons"]):
        print(
            f"{stem:<28}{r['lessons']:>5}{r['inner_shapes']:>9}{r['top_level_shapes']:>5}"
            f"{len(r['core']):>5}{len(r['rare']):>5}{len(r['rare_noteish']):>11}"
        )
    total_rare = sum(len(r["rare"]) for r in mods.values())
    total_note = sum(len(r["rare_noteish"]) for r in mods.values())
    print("-" * 72)
    pct = (100 * total_note / total_rare) if total_rare else 0
    print(f"合計邊緣欄位 {total_rare}，其中註解型 {total_note}（{pct:.0f}%）")
    if report["unreadable"]:
        # 讀不到的檔要講出來 —— 靜默跳過會讓「形狀數」看起來比實際好
        print(f"\n⚠️ {len(report['unreadable'])} 份讀不到，未計入：")
        for p in report["unreadable"][:5]:
            print(f"   {p}")


def compare(before_path: str, after_path: str) -> int:
    before = json.loads(pathlib.Path(before_path).read_text())["modules"]
    after = json.loads(pathlib.Path(after_path).read_text())["modules"]
    print(f"{'模組':<28}{'形狀 before':>12}{'after':>8}{'變化':>8}")
    print("-" * 60)
    worse = []
    for stem in sorted(set(before) | set(after)):
        b = before.get(stem, {}).get("inner_shapes", 0)
        a = after.get(stem, {}).get("inner_shapes", 0)
        mark = "" if a <= b else "  🔴 變差"
        if a > b:
            worse.append(stem)
        print(f"{stem:<28}{b:>12}{a:>8}{a - b:>+8}{mark}")
    if worse:
        print(f"\n🔴 {len(worse)} 個模組形狀數變多了：{', '.join(worse)}")
        return 1
    print("\n✅ 沒有任何模組變差")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="輸出 JSON")
    ap.add_argument("--module", help="只看某一個模組")
    ap.add_argument("--compare", nargs=2, metavar=("BEFORE", "AFTER"))
    args = ap.parse_args()

    if args.compare:
        return compare(*args.compare)

    report = collect(args.module)
    if not report["modules"]:
        # 掃不到東西要當錯誤，不要印一張空表看起來像「都很乾淨」
        print(f"🔴 在 {LESSONS} 底下找不到任何模組 yml", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print_table(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
