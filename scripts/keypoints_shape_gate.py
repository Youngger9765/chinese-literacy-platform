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

⚠️ 這句話要照字面算，不可以拿形狀去猜（2026-08-18 訂正）
------------------------------------------------------
第一版的第 2 項寫成「row 的 key 必須對得上 `columns`」，然後對 L0002 / L0004
印「**整張表會是空的**」。那句話是錯的：

  * L0002 的 row 是 `label`/`value`，`columns` 只是印在表頭的欄名 —— 橋是照
    「有沒有 label」分流的，columns 從頭到尾不參與取值。
  * L0004 的欄名確實對不上，但**同一個 commit（32fce2b4）**已經在
    `keypoints_to_structure._columns_to_structure_table` 加了退路：對不上就改用
    row 自己的 key 照原序取值。門把那個退路存在之前的症狀寫進了判準。

兩課實際跑橋都畫得出內容。判準錯的門比沒有門更糟 —— 它會把好課判死，
然後有人真的去改資料。

所以第 2 項改成直接問橋：把這課餵進 `keypoints_to_structure_table`，
看它吐不吐得出有內容的列。這條不會跟橋漂移，因為它**就是**橋。

檢查項（照 skill §⑥.55b）：
  1. `layout` 要有，且只能是 list / matrix
  2. 餵進橋之後畫不出任何一列內容 —— 這才是「整張表會是空的」
  3. list：row 要有 `label`
  4. 每一列至少要能產出一個非空的儲存格（欄名對不上時改看 row 自己的 key）
  5. 有 `options` 就要有 `answer`／`answers`（沒答案的選擇題等於沒抽到答案）

⚠️ 預設放行「訂規格之前的寫法」，但不放行「表是空的」（2026-08-18）
--------------------------------------------------------------
原本預設會把 LEGACY 那 19 課的「缺 layout」也算成紅的，要另外帶 `--legacy-ok`
才會降成警告。結果是**這支門預設恆紅** —— 而恆紅的門會被訓練成無視：那 19 條
被當成「待解的內容缺陷」掛了一整天，真正的原因只是叫的時候漏了那個 flag。

所以預設改成放行，`--strict` 留給想看全部欠帳的人。但放寬只到「慣例」為止：

    缺 layout（訂規格之前的寫法）        → LEGACY 課預設只警告
    表真的畫不出東西（行為）            → **任何課都擋，包含 LEGACY**

不然那份名單會變成 19 課的永久免死金牌 —— 舊課哪天真的空掉也沒人知道。
`--legacy-ok` 保留為 no-op，因為 SOP 與既有文件還在用它叫。

用法：
    python3 scripts/keypoints_shape_gate.py --all              # 預設：舊課的慣例問題只警告
    python3 scripts/keypoints_shape_gate.py --uid L0004
    python3 scripts/keypoints_shape_gate.py --all --strict     # 連舊課欠的 layout 一起擋
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import NamedTuple

import yaml

REPO = Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend/data/lessons"

# 第 2 項直接問橋，不自己重寫一份判準 —— 重寫就會漂移，而漂移正是這支要修的病。
# 這個模組只用 stdlib（re / typing），系統 python3 也匯得進來。
sys.path.insert(0, str(REPO / "backend"))
from app.services.keypoints_to_structure import (  # noqa: E402
    keypoints_to_structure_table,
)

class Finding(NamedTuple):
    """一條檢查結果。

    `blocking=False` 只給「訂規格之前的寫法」這種慣例問題 —— 它描述的是這課沒跟上
    後來訂的規格，不是這課現在壞了。行為問題一律 blocking，LEGACY 也不例外。
    """

    text: str
    blocking: bool = True


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
    """這一列實際畫得出來的儲存格內容。空的代表這一列會是空白列。

    ⚠️ `columns` 只在真的對得上 row 的 key 時才拿來查值。對不上的時候橋是改用
    row 自己的 key（見模組 docstring 的訂正），照欄名查會全部落空 —— 那會讓好課
    每一列都被判成「空白列」。
    """
    out = []
    if columns and any(c in row for c in columns):
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


def renders_nothing(doc: dict) -> bool:
    """把整份 keypoints 餵進 runtime 真的走的那條橋，看它吐不吐得出內容。

    只有標題那一列（單元素）不算內容 —— 學生看到的還是一張空表格。
    """
    table = keypoints_to_structure_table(doc)
    return not any(
        len(r) > 1 and any(str(c).strip() for c in r)
        for r in (table or [])
    )


def check(uid: str, lessons_root: Path | None = None) -> list[Finding]:
    p = (lessons_root or LESSONS) / uid / "v3/keypoints.yml"
    if not p.exists():
        return []          # 沒有重點表是合法的（有些課真的沒有這一大題）
    doc = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    kp = doc.get("keypoints") or {}
    rows = kp.get("rows")
    if not isinstance(rows, list) or not rows:
        return [Finding(f"{uid}: keypoints 有檔案卻沒有 rows —— 那會是一張空表")]

    problems: list[Finding] = []
    layout = kp.get("layout")
    columns = kp.get("columns")

    if layout not in ("list", "matrix"):
        guess = "matrix" if columns else "list"
        # 慣例問題：LEGACY 那批是訂規格之前抽的，橋接得動，只是沒跟上後來的寫法。
        problems.append(Finding(
            f"{uid}: 缺 layout（依內容看應該是 {guess}），見 skill §⑥.55b", blocking=False))

    if layout == "matrix" and not columns:
        problems.append(Finding(f"{uid}: matrix 佈局卻沒有 columns"))

    # 第 2 項：不猜形狀，直接跑橋。畫不出任何一列內容才是「整張表會是空的」。
    if renders_nothing(doc):
        sample = next((r for r in rows if isinstance(r, dict)), {})
        problems.append(Finding(
            f"{uid}: 🔴 橋接不回來 —— **整張表會是空的**（學生看到空表格且不能作答）。"
            f"columns={(columns or [])[:3]} 但 row 的 key={list(sample)[:3]}"))

    for i, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            problems.append(Finding(f"{uid}: 第 {i} 列不是 mapping"))
            continue
        if layout == "list" and not row.get("label") and not row.get("items"):
            problems.append(Finding(f"{uid}: 第 {i} 列（list 佈局）缺 label"))

        nested = row.get("items") or row.get("sub_rows") or []
        if not cell_texts(row, columns if layout == "matrix" else None) and not nested:
            problems.append(Finding(f"{uid}: 第 {i} 列畫不出任何內容 —— 會是一列空白"))

        for node in [row, *(n for n in nested if isinstance(n, dict))]:
            if node.get("options") and node.get("answer") is None and not node.get("answers"):
                label = node.get("label") or node.get("sub_label") or f"第 {i} 列"
                problems.append(Finding(f"{uid}: 「{label}」有 options 卻沒有 answer/answers"))

    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--strict", action="store_true",
                    help="連 LEGACY 那批訂規格之前的寫法（缺 layout）一起擋")
    ap.add_argument("--legacy-ok", action="store_true",
                    help="已是預設，保留只為了讓既有文件／SOP 的叫法不會壞掉（no-op）")
    ap.add_argument("--lessons-root", type=Path, default=None,
                    help="改看別的課樹（測試用；預設 backend/data/lessons）")
    a = ap.parse_args()

    root = a.lessons_root or LESSONS
    uids = [a.uid] if a.uid else sorted(
        p.name for p in root.iterdir() if p.is_dir() and (p / "v3").is_dir())
    if not uids:
        print("⛔ 沒有任何 v3 課可檢查 —— 視為失敗，別讓空跑看起來像成功")
        return 1

    bad = 0
    for uid in uids:
        findings = check(uid, root)
        # 特赦只赦免「訂規格之前的寫法」，而且只赦免名單上那批。
        # 行為問題（表是空的）任何課都擋 —— 否則這份名單會變成永久免死金牌。
        excused = [f for f in findings
                   if not a.strict and not f.blocking and uid in LEGACY]
        for f in findings:
            print(f"  {'⚠️ (舊課)' if f in excused else '🔴'} {f.text}")
        if len(findings) > len(excused):
            bad += 1

    print(f"\nKEYPOINTS_SHAPE_GATE={'PASS' if not bad else 'FAIL'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
