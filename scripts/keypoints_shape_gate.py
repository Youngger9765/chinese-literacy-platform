#!/usr/bin/env python3
"""文章重點表的形狀門

為什麼需要這支
--------------
聚光燈的 `blocks[].type` 是封閉清單，重點表卻一直沒有規定 —— 於是前 19 課寫出
**9 種不同結構**。每多一種，`keypoints_to_structure.py` 就要多接一層；接不到的
那一種**不會報錯**，只是整張表變成空的：畫面上一個空表格，學生不能作答。

最毒的一種是 L0004：`columns` 寫中文（段落／事件／感受），row 的 key 寫英文
（paragraph／event／feeling）。照欄名查一個都查不到，整張表空掉，
逐字門 PASS、覆蓋門 PASS、拆模組成功、前端也不 crash。沒有任何一道檢查在看這件事。

所以這支問的是別人都不問的問題：**這張表真的畫得出東西嗎**。

檢查項（照 skill §⑥.55b）：
  1. `layout` 要有，且只能是 list / matrix
  2. matrix：row 的 key 必須對得上 `columns`
  3. list：row 要有 `label`
  4. 每一列至少要能產出一個非空的儲存格 —— 這條才是真的擋空表格
  5. 有 `options` 就要有 `answer`／`answers`（沒答案的選擇題等於沒抽到答案）

用法：
    python3 scripts/keypoints_shape_gate.py --all
    python3 scripts/keypoints_shape_gate.py --uid L0004
    python3 scripts/keypoints_shape_gate.py --all --legacy-ok   # 舊 19 課只警告
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend/data/lessons"

SIDECAR_SUFFIXES = ("_blanks", "_blank", "_options", "_answer", "_answers",
                    "_choices", "_multi_answer")

# 訂規格（skill §⑥.55b）之前抽的課。它們的形狀由橋接器容忍，不倒退去改 ——
# 但**新抽的課不得再用**，所以這份清單是封閉的，只會變短不會變長。
LEGACY = {
    "L0001", "L0002", "L0003", "L0004", "L0005", "L0006", "L0007", "L0008",
    "L0009", "L0010", "L0011", "L0012", "L0034", "L0072", "L0105", "L0124",
    "L0140", "L0161", "L0174",
}


def cell_texts(row: dict, columns: list[str] | None) -> list[str]:
    """這一列實際畫得出來的儲存格內容。空的代表這一列會是空白列。"""
    out = []
    if columns:
        for c in columns:
            v = row.get(c)
            if v not in (None, "", []):
                out.append(str(v))
    else:
        for k, v in row.items():
            if isinstance(k, str) and any(k.endswith(s) for s in SIDECAR_SUFFIXES):
                continue
            if k in ("label", "items", "sub_rows", "blanks"):
                continue
            if v not in (None, "", []):
                out.append(str(v))
    return out


def check(uid: str) -> list[str]:
    p = LESSONS / uid / "v3/keypoints.yml"
    if not p.exists():
        return []          # 沒有重點表是合法的（有些課真的沒有這一大題）
    kp = (yaml.safe_load(p.read_text(encoding="utf-8")) or {}).get("keypoints") or {}
    rows = kp.get("rows")
    if not isinstance(rows, list) or not rows:
        return [f"{uid}: keypoints 有檔案卻沒有 rows —— 那會是一張空表"]

    problems: list[str] = []
    layout = kp.get("layout")
    columns = kp.get("columns")

    if layout not in ("list", "matrix"):
        guess = "matrix" if columns else "list"
        problems.append(f"{uid}: 缺 layout（依內容看應該是 {guess}），見 skill §⑥.55b")

    if layout == "matrix" or (layout is None and columns):
        if not columns:
            problems.append(f"{uid}: matrix 佈局卻沒有 columns")
        else:
            sample = next((r for r in rows if isinstance(r, dict)), {})
            hit = [c for c in columns if c in sample]
            if not hit:
                problems.append(
                    f"{uid}: 🔴 row 的 key 對不上 columns —— **整張表會是空的**。"
                    f"columns={columns[:3]} 但 row 的 key={list(sample)[:3]}")

    for i, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            problems.append(f"{uid}: 第 {i} 列不是 mapping")
            continue
        if layout == "list" and not row.get("label") and not row.get("items"):
            problems.append(f"{uid}: 第 {i} 列（list 佈局）缺 label")

        nested = row.get("items") or row.get("sub_rows") or []
        if not cell_texts(row, columns if layout == "matrix" else None) and not nested:
            problems.append(f"{uid}: 第 {i} 列畫不出任何內容 —— 會是一列空白")

        for node in [row, *(n for n in nested if isinstance(n, dict))]:
            if node.get("options") and node.get("answer") is None and not node.get("answers"):
                label = node.get("label") or node.get("sub_label") or f"第 {i} 列"
                problems.append(f"{uid}: 「{label}」有 options 卻沒有 answer/answers")

    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--legacy-ok", action="store_true",
                    help="訂規格之前抽的課只警告不擋（清單見 LEGACY）")
    a = ap.parse_args()

    uids = [a.uid] if a.uid else sorted(
        p.name for p in LESSONS.iterdir() if p.is_dir() and (p / "v3").is_dir())
    if not uids:
        print("⛔ 沒有任何 v3 課可檢查 —— 視為失敗，別讓空跑看起來像成功")
        return 1

    bad = 0
    for uid in uids:
        msgs = check(uid)
        legacy = a.legacy_ok and uid in LEGACY
        for m in msgs:
            print(f"  {'⚠️ (舊課)' if legacy else '🔴'} {m}")
        if msgs and not legacy:
            bad += 1

    print(f"\nKEYPOINTS_SHAPE_GATE={'PASS' if not bad else 'FAIL'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
