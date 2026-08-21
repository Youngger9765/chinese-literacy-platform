#!/usr/bin/env python3
"""對帳門：學習單宣告的大題 ⟷ 實際產出的模組檔（#2843）。

## 這道門回答的是「出錯時該找誰的麻煩」

現在抽取出問題時沒人知道該找誰，因為沒有任何東西把「學習單有哪幾個大題」
跟「產出了哪些模組檔」對起來。這道門就是那個對照。

三種紅法，各自指名責任方：

| 情況 | 判定 | 該找誰 |
|---|---|---|
| 宣告有、檔案沒有 | 那個模組沒抽出來 | 該模組的抽取 |
| 檔案有、宣告沒有 | 總覽漏看了一個大題 | `sections_present` 的產生端 |
| 大題名對不到任何模組 | 對照表缺一條 | `specs/modules/section-to-module.yml` |

## 已知缺口不算紅

`content_known_gaps.yaml` 的 `modules_absent_from_source` 登錄了 46 課 / 167 個
缺口 —— 那些是學習單本身沒印那一節，逐課開原稿確認過的。把它們算成紅會讓門恆紅，
**紅久了就沒人看**，真的有新缺口冒出來也不會有人發現。

用法：
    python3 scripts/module_reconcile_gate.py            # 全部
    python3 scripts/module_reconcile_gate.py --uid L0153
    python3 scripts/module_reconcile_gate.py --strict   # unresolved 也算紅
"""
from __future__ import annotations

import argparse
import collections
import pathlib
import sys

import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
LESSONS = REPO_ROOT / "backend" / "data" / "lessons"
MAP_FILE = REPO_ROOT / "specs" / "modules" / "section-to-module.yml"
GAPS_FILE = REPO_ROOT / "backend" / "data" / "curriculum_qa" / "content_known_gaps.yaml"


def load_map() -> dict:
    return yaml.safe_load(MAP_FILE.read_text(encoding="utf-8")) or {}


def load_known_gaps() -> dict[str, set[str]]:
    data = yaml.safe_load(GAPS_FILE.read_text(encoding="utf-8")) or {}
    block = data.get("modules_absent_from_source") or {}
    return {
        e["lesson_uid"]: set(e["absent_modules"])
        for e in block.get("lessons", [])
    }


def section_to_module(name: str, table: dict) -> tuple[str | None, bool]:
    """回傳 (模組名, 是否為已知的 unresolved)。"""
    for row in table.get("matches", []):
        if row["needle"] in name:
            return row["module"], False
    for row in table.get("unresolved", []):
        if row["needle"] in name:
            return None, True
    return None, False


def reconcile(uid_filter: str | None = None) -> dict:
    table = load_map()
    not_sections = set(table.get("not_sections", []))
    known_gaps = load_known_gaps()

    missing_file = collections.defaultdict(list)   # 宣告有、檔案沒有
    unannounced = collections.defaultdict(list)    # 檔案有、宣告沒有
    unresolved = collections.Counter()             # 大題名對不到模組（已知）
    unknown_section = collections.Counter()        # 大題名對不到模組（未知，這是紅的）
    scanned = 0

    for version_dir in sorted(LESSONS.glob("L*/v3")):
        uid = version_dir.parent.name
        if uid_filter and uid != uid_filter:
            continue
        lesson_file = version_dir / "lesson.yml"
        if not lesson_file.is_file():
            continue
        lesson = yaml.safe_load(lesson_file.read_text(encoding="utf-8")) or {}
        rows = lesson.get("sections_present") or []
        if not rows:
            continue
        scanned += 1

        declared: set[str] = set()
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "")
            if not name:
                continue
            module, is_known_unresolved = section_to_module(name, table)
            if module:
                declared.add(module)
            elif is_known_unresolved:
                unresolved[name] += 1
            else:
                unknown_section[name] += 1

        produced = {p.stem for p in version_dir.glob("*.yml")} - not_sections
        gaps = known_gaps.get(uid, set())

        for module in sorted(declared - produced - gaps):
            missing_file[module].append(uid)
        for module in sorted(produced - declared):
            unannounced[module].append(uid)

    return {
        "scanned": scanned,
        "missing_file": dict(missing_file),
        "unannounced": dict(unannounced),
        "unresolved": dict(unresolved),
        "unknown_section": dict(unknown_section),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid")
    ap.add_argument("--strict", action="store_true", help="已知的 unresolved 也算紅")
    args = ap.parse_args()

    r = reconcile(args.uid)
    if r["scanned"] == 0:
        # 掃不到課要當錯誤，不要印一張空表看起來像全對
        print("🔴 沒有掃到任何帶 sections_present 的課", file=sys.stderr)
        return 2

    print(f"對帳 {r['scanned']} 課")
    failed = False

    if r["missing_file"]:
        failed = True
        n = sum(len(v) for v in r["missing_file"].values())
        print(f"\n🔴 宣告有、檔案沒有（{n} 筆）—— 該模組沒抽出來，且不在已知缺口裡：")
        for m, uids in sorted(r["missing_file"].items()):
            print(f"    {m}: {', '.join(uids[:8])}" + (f" …共 {len(uids)}" if len(uids) > 8 else ""))

    if r["unannounced"]:
        failed = True
        n = sum(len(v) for v in r["unannounced"].values())
        print(f"\n🔴 檔案有、宣告沒有（{n} 筆）—— 總覽漏看了一個大題：")
        for m, uids in sorted(r["unannounced"].items()):
            print(f"    {m}: {', '.join(uids[:8])}" + (f" …共 {len(uids)}" if len(uids) > 8 else ""))

    if r["unknown_section"]:
        failed = True
        print("\n🔴 大題名對不到任何模組，也不在 unresolved 名單裡：")
        for name, c in sorted(r["unknown_section"].items(), key=lambda kv: -kv[1]):
            print(f"    {c:>3} 課  {name}")
        print(f"\n    → 開該課的原稿與 yml 對一次，然後加進 {MAP_FILE.name} 的 matches 或 unresolved")

    if r["unresolved"]:
        n = sum(r["unresolved"].values())
        mark = "🔴" if args.strict else "⚠️ "
        print(f"\n{mark} 已知未解的大題名（{n} 筆）—— 看得見的欠債，不是靜默漏洞：")
        for name, c in sorted(r["unresolved"].items(), key=lambda kv: -kv[1]):
            print(f"    {c:>3} 課  {name}")
        if args.strict:
            failed = True

    if not failed:
        print("\n✅ 宣告的模組集合 == 產出的模組檔集合")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
