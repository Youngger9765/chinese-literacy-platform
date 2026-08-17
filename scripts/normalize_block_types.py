#!/usr/bin/env python3
"""把發明出來的 block type 併回封閉清單

為什麼需要這支
--------------
`blocks[].type` 是**封閉詞彙**：每個 type 都要有一個 React 元件才畫得出來。
發明一個新名字＝製造一個畫不出來的 block，而且**它不會報錯**，只是在畫面上消失。

2026-08-17 第一次平行抽取沒有把詞彙寫死，四個 worker 各自命名，一批 6 課就長出
11 個一次性型別（`thought_emotion_table`、`inference_table`、`multi_select`…）。
放著不管，175 課會長出上百個，每個都要一個元件。

現在 skill 裡有封閉清單了；這支負責把已經產出的併回去，並在之後當 lint 用。

用法：
    python3 scripts/normalize_block_types.py --check      # 只報告，不改（CI 用）
    python3 scripts/normalize_block_types.py --write      # 實際併

退出碼：0 = 全部都是合法型別；1 = 還有清單外的型別
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent

KNOWN = {
    "concept_box", "guide", "passage", "single", "multi", "free_text",
    "fill_table", "table", "figure", "self_check", "ordering",
    "sub_block", "exercise", "matching", "unknown",
}

# 發明的名字 → 併到哪。依「這個 block 實際帶什麼欄位」決定，不是照名字猜：
#   帶 options + multi=true      → multi
#   帶 columns/rows + 有填空      → fill_table
#   只有 text                    → guide
#   帶 left/right                → matching
#   帶 items 且是巢狀            → sub_block
ALIASES = {
    "multi_select": "multi",
    "multi_choice": "multi",
    "choice_group": "sub_block",           # 帶 items[]，每個 item 自己有選項
    "definition_list": "table",
    "example_chain": "sub_block",
    "inference_table": "fill_table",       # 帶 columns/rows + word_bank_line
    "thought_emotion_table": "fill_table",
    "conclusion": "guide",
    "closing_box": "guide",
    "matching_with_inference": "matching",
    "challenge": "sub_block",
}


def walk_files():
    for p in sorted((REPO / "qa/content-evidence").glob("*/new.yml")):
        yield p
    for p in sorted((REPO / "qa/content-evidence").glob("*/truth.yml")):
        yield p


def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true")
    g.add_argument("--write", action="store_true")
    a = ap.parse_args()

    unknown: dict[str, list[str]] = {}
    changed = 0

    for p in walk_files():
        raw = p.read_text(encoding="utf-8")
        doc = yaml.safe_load(raw)
        blocks = ((doc or {}).get("spotlight") or {}).get("blocks") or []
        hits = []
        for b in blocks:
            if not isinstance(b, dict):
                continue
            t = b.get("type")
            if t in KNOWN:
                continue
            if t in ALIASES:
                hits.append((t, ALIASES[t]))
            else:
                unknown.setdefault(str(t), []).append(p.parent.name)

        if hits and a.write:
            # 逐行改 `type: <old>`，保留其餘排版與註解 —— 整份 yaml.dump 會把
            # 抽取者寫的說明註解全部沖掉。
            out = []
            for line in raw.split("\n"):
                s = line.strip()
                for old, new in ALIASES.items():
                    if s in (f"- type: {old}", f"type: {old}"):
                        line = line.replace(f"type: {old}", f"type: {new}")
                        changed += 1
                        break
                out.append(line)
            p.write_text("\n".join(out), encoding="utf-8")

        if hits:
            print(f"{p.parent.name}: " + ", ".join(f"{o}→{n}" for o, n in hits))

    if a.write:
        print(f"\n共改 {changed} 個 block")

    if unknown:
        print("\n⛔ 清單外、且沒有對應規則的型別（要先決定併到哪，不可自動猜）：")
        for t, where in unknown.items():
            print(f"  {t}  出現在 {sorted(set(where))}")
        print("BLOCK_TYPE_LINT=FAIL")
        return 1

    print("\nBLOCK_TYPE_LINT=PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
