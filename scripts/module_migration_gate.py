#!/usr/bin/env python3
"""模組化翻新進度門 —— 還有幾課停在 v2

為什麼要有這道門
----------------
v3 把「一個大題一個模組」做對了，同時把 v2 的 `sections` / `body` 相容入口拿掉。
拿掉是刻意的：#2683 刪兩個歷史 layer 時就寫過，留一條相容路徑會把問題原封不動
保存下來。代價是還沒重抽的課會少掉那幾個大題。

那個代價必須是**看得見、數得出來**的，否則一棵翻新到一半的樹會看起來很健康。
這道門就是那個數字。它現在**應該是紅的** —— 紅到 0 為止。

用法：
    python3 scripts/module_migration_gate.py
    python3 scripts/module_migration_gate.py --json out.json
    python3 scripts/module_migration_gate.py --expect-remaining 167   # 進度不倒退

退出碼：0 = 全部翻新完；1 = 還有課停在舊版本
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend/data/lessons"
TARGET = "v3"

# v3 起不再產出的檔名。留在磁碟上不會壞事，但它們代表那一版還沒翻新。
LEGACY_FILES = ("sections.yml", "body.yml")


def scan() -> dict:
    migrated, legacy, empty = [], [], []
    if not LESSONS.is_dir():
        raise SystemExit(f"⛔ 找不到 {LESSONS}")

    for uid_dir in sorted(LESSONS.iterdir()):
        if not uid_dir.is_dir() or not uid_dir.name.startswith("L"):
            continue
        versions = sorted(c.name for c in uid_dir.iterdir() if c.is_dir() and c.name.startswith("v"))
        if not versions:
            empty.append(uid_dir.name)
            continue
        latest = versions[-1]
        vdir = uid_dir / latest
        has_legacy = any((vdir / f).exists() for f in LEGACY_FILES)
        (migrated if latest >= TARGET and not has_legacy else legacy).append(
            {"uid": uid_dir.name, "latest": latest,
             "legacy_files": [f for f in LEGACY_FILES if (vdir / f).exists()]}
        )
    return {"migrated": migrated, "legacy": legacy, "no_version": empty}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", type=Path)
    ap.add_argument("--expect-remaining", type=int,
                    help="斷言剩餘課數不超過此值 —— 用來擋住進度倒退")
    a = ap.parse_args()

    r = scan()
    done, todo = len(r["migrated"]), len(r["legacy"])
    total = done + todo

    if total == 0:
        print("⛔ 一課都沒掃到 —— 視為 FAIL（空跑不算成功）")
        print("MODULE_MIGRATION_GATE=FAIL")
        return 1

    print(f"已翻新 {TARGET}+ : {done} / {total}")
    print(f"仍停舊版本      : {todo}")
    if r["no_version"]:
        print(f"⚠️ 沒有任何版本目錄: {len(r['no_version'])} 課 {r['no_version'][:5]}")

    if todo:
        print("\n這些課還讀不到「讀全文-做記號／語詞我最棒／閱讀理解／知識補給站」：")
        for e in r["legacy"][:15]:
            print(f"  {e['uid']}  latest={e['latest']}  {' '.join(e['legacy_files'])}")
        if todo > 15:
            print(f"  …另外 {todo - 15} 課")

    if a.json:
        a.json.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")

    if a.expect_remaining is not None and todo > a.expect_remaining:
        print(f"\n⛔ 剩餘 {todo} 課 > 允許的 {a.expect_remaining} —— 進度倒退了")
        print("MODULE_MIGRATION_GATE=FAIL")
        return 1

    print()
    print("MODULE_MIGRATION_GATE=" + ("PASS" if todo == 0 else "FAIL"))
    return 0 if todo == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
