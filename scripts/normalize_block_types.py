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
import re
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
    """抽取結果的唯一落點。實驗期的 `qa/content-evidence/*/new.yml` 已經收掉了。"""
    yield from sorted((REPO / "backend/data/lessons/_extracted").glob("*.yml"))


def check_yaml_traps(path: Path) -> list[str]:
    """抓 YAML 1.1 的裸 boolean key。

    `no:` / `yes:` / `on:` / `off:` / `y:` / `n:` 不加引號會被解析成 **boolean**，
    於是 `{no: 1}` 變成 `{False: 1}` —— 欄位名整個消失，而且不會報錯。
    2026-08-17 首次全庫檢查：8 課全中，共 77 處，全來自階梯圖與表格的 `no:` 序號欄。

    逐字門抓不到這種：它比對的是字串**值**，key 壞掉不在它的視野裡。
    """
    problems = []

    def scan(node, where=""):
        if isinstance(node, dict):
            for k, v in node.items():
                if isinstance(k, bool):
                    problems.append(f"{where} 有 boolean key `{k}` —— 原文多半是裸的 no:/yes:，要加引號")
                scan(v, f"{where}/{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                scan(v, f"{where}[{i}]")

    try:
        scan(yaml.safe_load(path.read_text(encoding="utf-8")))
    except Exception as exc:
        problems.append(f"YAML 解析失敗：{exc}")

    problems += check_hash_swallow(path)
    return problems


def check_hash_swallow(path: Path) -> list[str]:
    """抓「值以 `#` 開頭而沒加引號」—— 整個值被當註解吃掉，欄位變成 null。

    `text: #MeToo運動也在2018年傳到臺灣…` 解析出來是 `{"text": None}`。
    2026-08-18 在 L0121 吃掉**兩整段課文**，而**八道門沒有一道看得到**：
    逐字門 PASS（沒東西可比）、orphan PASS、型別門 PASS、找字 PASS ——
    只有 coverage_gate 抓得到，而它需要有 v2 可比，全新的課會一路綠燈。

    跟上面的裸 `no:` 是同一族：YAML 靜默改變語意，而不是報錯。

    ⚠️ 要跟**正當的行尾註解**分開：`sub_table:   # ⚠️ 巢狀表格…` 的值在後續縮排行裡，
    那是註解不是被吃掉的值。判準是「這一行之後有沒有更深的縮排」——沒有才是真的 null。
    """
    problems = []
    lines = path.read_text(encoding="utf-8").splitlines()
    for i, line in enumerate(lines):
        m = re.match(r"^(\s*)(?:- )?([^:#\n]+):\s+#", line)
        if not m:
            continue
        indent = len(m.group(1))
        # 往下找第一行有內容的，比這行更深 = 值在下面（正當註解）
        nested = False
        for nxt in lines[i + 1:]:
            if not nxt.strip():
                continue
            if len(nxt) - len(nxt.lstrip()) > indent:
                nested = True
            break
        if not nested:
            problems.append(
                f"第 {i + 1} 行 `{m.group(2).strip()}:` 的值以 # 開頭且沒加引號 —— "
                f"整個值會被當註解吃掉、欄位變 null。加引號：`{m.group(2).strip()}: \"#…\"`"
            )
    return problems


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

    trap_hits = 0
    for p in walk_files():
        for msg in check_yaml_traps(p):
            print(f"  🔴 {p.parent.name if p.parent.name != '_extracted' else p.stem}: {msg}")
            trap_hits += 1
    if trap_hits:
        print(f"\n⛔ {trap_hits} 個 YAML 陷阱")
        print("BLOCK_TYPE_LINT=FAIL")
        return 1

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
