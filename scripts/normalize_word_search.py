#!/usr/bin/env python3
"""把 word_search 的答案路徑收斂成單一形狀，並用格子本身驗證它

為什麼需要這支
--------------
找字遊戲的答案是**畫在紙上的圈**，文字層沒有，所以只能靠多模態轉錄。但轉錄成什麼
形狀，抽取者各寫各的：L0003 寫 `answer_paths[].cells`（座標對），L0007 寫
`circled_answers[].起點: 第1列第3欄`（中文散文）。同一件事兩種形狀，消費端要寫兩套；
而散文那種還會被逐字門判 FAIL —— 因為「第1列第3欄」本來就不是原稿上的字。

固定形狀（其餘一律轉成這個）：

    answer_paths:
      - word: 小心翼翼
        cells: [[1, 3], [1, 4], [1, 5], [1, 6]]   # 1-based [列, 欄]
        direction: horizontal

`direction` 只有下面這幾個值。用英文不是偏好問題：中文的「橫／直／斜（左下）」括號
與全形字有多種寫法，而它們長得夠像，看不出差異卻對不起來。

驗證方式才是重點：**把 cells 套回 grid，取出來的字必須拼回 word**。
轉錄錯一個座標就會拼不出來 —— 這是這支腳本存在的真正理由，不是為了統一排版。

用法：
    python3 scripts/normalize_word_search.py --check
    python3 scripts/normalize_word_search.py --write
"""
from __future__ import annotations

import argparse
import re
import sys
import zipfile
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
EXTRACTED = REPO / "backend/data/lessons/_extracted"

# (列差, 欄差)
DIRECTIONS = {
    "horizontal":          (0, 1),
    "vertical":            (1, 0),
    "diagonal_down_right": (1, 1),
    "diagonal_down_left":  (1, -1),
    "diagonal_up_right":   (-1, 1),
    "diagonal_up_left":    (-1, -1),
}

# 抽取者寫過的中文寫法 → 固定值。括號全形半形都收。
ZH_DIRECTION = {
    "橫": "horizontal", "橫向": "horizontal", "水平": "horizontal",
    "直": "vertical", "直向": "vertical", "垂直": "vertical",
    "斜(右下)": "diagonal_down_right", "斜（右下）": "diagonal_down_right",
    "斜(左下)": "diagonal_down_left", "斜（左下）": "diagonal_down_left",
    "斜(右上)": "diagonal_up_right", "斜（右上）": "diagonal_up_right",
    "斜(左上)": "diagonal_up_left", "斜（左上）": "diagonal_up_left",
}

CELL_RE = re.compile(r"第\s*(\d+)\s*列\s*第\s*(\d+)\s*欄")


def _dir(v: str) -> str | None:
    v = (v or "").strip().replace("（", "(").replace("）", ")")
    if v in DIRECTIONS:
        return v
    return ZH_DIRECTION.get(v) or ZH_DIRECTION.get(v.replace("(", "（").replace(")", "）"))


def _cells_from_start(row: int, col: int, direction: str, length: int):
    dr, dc = DIRECTIONS[direction]
    return [[row + dr * i, col + dc * i] for i in range(length)]


def _grid(raw) -> list[str]:
    """格子有兩種寫法，都要收。

    L0007 寫「每列一個字串」，L0003 寫「每列一個字元 list」。第三種寫法出現時
    也從這裡加 —— 重點是**消費端只看得到一種**。
    """
    out: list[str] = []
    for row in raw or []:
        out.append("".join(str(c) for c in row) if isinstance(row, (list, tuple)) else str(row))
    return out


def _direction_from_cells(cells: list) -> str | None:
    """有座標時，方向用算的不用讀的。

    標籤「斜」不說是哪一斜、「斜（左下）」括號有全形半形 —— 而座標沒有這些歧義。
    順帶當一致性檢查：步長不一致代表這條路徑不是直線，那本身就是轉錄錯誤。
    """
    if len(cells) < 2:
        return None
    steps = {(int(b[0]) - int(a[0]), int(b[1]) - int(a[1])) for a, b in zip(cells, cells[1:])}
    if len(steps) != 1:
        return None
    step = steps.pop()
    for name, delta in DIRECTIONS.items():
        if delta == step:
            return name
    return None


def verify(grid: list[str], word: str, cells: list) -> str | None:
    """把座標套回格子，拼不回 word 就回錯誤訊息。"""
    got = []
    for cell in cells:
        try:
            r, c = int(cell[0]), int(cell[1])
        except (TypeError, ValueError, IndexError):
            return f"座標格式怪異：{cell!r}"
        if not (1 <= r <= len(grid)):
            return f"列號 {r} 超出格子（共 {len(grid)} 列）"
        row = grid[r - 1]
        if not (1 <= c <= len(row)):
            return f"第 {r} 列只有 {len(row)} 欄，取不到第 {c} 欄"
        got.append(row[c - 1])
    spelled = "".join(got)
    if spelled != word:
        return f"座標拼出「{spelled}」，但標的語詞是「{word}」"
    return None


def normalize(doc: dict) -> tuple[list[dict], list[str]]:
    """回 (固定形狀的 answer_paths, 問題清單)。沒有 word_search 就回 ([], [])。"""
    vr = doc.get("vocab_review") or {}
    if vr.get("type") != "word_search":
        return [], []

    grid = _grid(vr.get("grid"))
    problems: list[str] = []
    out: list[dict] = []

    raw = vr.get("answer_paths") or vr.get("circled_answers") or []
    for item in raw:
        if not isinstance(item, dict):
            problems.append(f"答案項不是 mapping：{item!r}")
            continue
        word = item.get("word") or item.get("語詞")
        if not word:
            problems.append(f"答案項沒有 word：{item!r}")
            continue

        cells = item.get("cells")
        # 有座標 → 方向用算的（標籤有歧義，座標沒有）；沒座標 → 只好讀標籤來推座標
        direction = _direction_from_cells(cells) if cells else None
        if not direction:
            direction = _dir(item.get("direction") or item.get("方向") or "")
        if not direction:
            label = item.get("direction") or item.get("方向")
            problems.append(
                f"「{word}」的方向讀不出來（標籤 {label!r}），"
                f"{'座標也不成直線' if cells else '而且沒有座標可以算'}"
            )
            continue

        if not cells:
            start = item.get("start") or item.get("起點")
            m = CELL_RE.search(str(start or ""))
            if not m:
                problems.append(f"「{word}」既沒有 cells 也讀不出起點：{start!r}")
                continue
            cells = _cells_from_start(int(m.group(1)), int(m.group(2)), direction, len(word))

        cells = [[int(c[0]), int(c[1])] for c in cells]
        if grid:
            # 沒有 grid 就沒得驗 —— 那是另一種缺口，記下來但不擋（有些課只轉錄到答案）
            err = verify(grid, word, cells)
            if err:
                problems.append(f"「{word}」{err}")
        out.append({"word": word, "cells": cells, "direction": direction})

    if raw and not grid:
        problems.append("有答案路徑但沒有 grid —— 無法驗證座標對不對")
    return out, problems


def rewrite_paths(raw: str, paths: list[dict]) -> str:
    """只換掉答案路徑那一段，其餘一個字都不動。

    ⚠️ 不可以用 `yaml.dump(整份)` 回寫。2026-08-17 我這樣做了一次，L0003 與 L0007 的
    大題分隔註解（`# ── 八 詞語複習 ──`）**全部消失**，而所有閘門照樣綠 ——
    註解不在任何一道檢查的視野裡，所以這種破壞不會有人告訴你。
    `normalize_block_types.py` 早就寫了同一條警告，我沒讀就又踩一次。
    """
    lines = raw.split("\n")
    out: list[str] = []
    i = 0
    replaced = False
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not replaced and stripped in ("circled_answers:", "answer_paths:"):
            indent = line[: len(line) - len(line.lstrip())]
            out.append(f"{indent}answer_paths:")
            for pth in paths:
                cells = ", ".join(f"[{r}, {c}]" for r, c in pth["cells"])
                out.append(f"{indent}  - word: {pth['word']}")
                out.append(f"{indent}    cells: [{cells}]")
                out.append(f"{indent}    direction: {pth['direction']}")
            # 吃掉原本那一段（更深縮排的行）
            i += 1
            start = i
            while i < len(lines):
                nxt = lines[i]
                if nxt.strip() and not nxt.startswith(indent + " "):
                    break
                i += 1
            # ⚠️ 吐回尾端的空行。空行沒有縮排，所以上面那個迴圈會把「這一段跟下一個
            #    大題之間的分隔空行」一起吃掉 —— 段落黏在一起，而所有閘門仍然是綠的。
            while i > start and not lines[i - 1].strip():
                i -= 1
            replaced = True
            continue
        out.append(line)
        i += 1
    if not replaced:
        raise SystemExit("⛔ 找不到答案路徑那一段 —— 停下來，不要盲寫")
    return "\n".join(out)


# ── 為什麼這裡**沒有**「圈數 vs 路徑數」的檢查 ──────────────────────
#
# 有 worker 建議加一條：`roundRect` 數 ≠ `answer_paths` 數就警告，
# 好讓「教材格子印錯字導致少列一條」自動浮出來（已出現 4 課：突發**其**想／
# 朝思**慕**想／愧**咎**／堅不可**催**）。動機是對的，但實作出來不成立。
#
# 實測 50 課：**14 課會噴警告，而且數字毫無意義**（26 vs 10、27 vs 14）——
# 因為 `roundRect` 在 DOCX 裡到處都是（圓角方框、標註框、裝飾），不只找字圈。
# 用橘色 E97132 過濾也救不了（橘色數 2/10/1/0 對路徑數 10/14/11/7，全不對），
# 顏色多半寫在 theme 參照或 style 裡而不是 shape 上。
#
# 另有 worker 早就拿四課回測過同一件事，四課只有一課數字相等。
#
# ⛔ 一個在 14/50 課上叫、而且叫得沒道理的警告，會被學會忽略 ——
#    然後真的有問題的那一次也一起被忽略。這比沒有檢查更糟。
#
# 要做對需要真正的幾何解算：解析每個 shape 的錨點座標與尺寸，換算回格子的
# 列欄範圍，只認落在格子矩形內的那些。那是一份獨立的工作，不是一行條件式。
# 在那之前，「圈有沒有全部列出來」靠 skill 的紀律（逐頁讀、不抽樣）。

def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true")
    g.add_argument("--write", action="store_true")
    a = ap.parse_args()

    files = sorted(EXTRACTED.glob("*.yml"))
    if not files:
        print("⛔ 沒有任何抽取結果 —— 視為失敗，別讓空跑看起來像成功")
        return 1

    bad = 0
    for p in files:
        doc = yaml.safe_load(p.read_text(encoding="utf-8"))
        paths, problems = normalize(doc or {})
        vr = (doc or {}).get("vocab_review") or {}
        if vr.get("type") != "word_search":
            continue

        for msg in problems:
            print(f"  🔴 {p.stem}: {msg}")
            bad += 1

        if not paths:
            # 沒轉錄到答案是真實缺口（不是錯誤）—— 教師版沒圈或沒讀到
            print(f"  · {p.stem}: word_search 無答案路徑（未轉錄）")
            continue


        current = vr.get("answer_paths")
        needs = current != paths or "circled_answers" in vr
        print(f"  {'△' if needs else '✓'} {p.stem}: {len(paths)} 條路徑"
              f"{'（要改寫）' if needs else '（已是固定形狀）'}")

        # --check 看到「形狀還沒收斂」必須紅。只印個 △ 就放行的話，下一個寫舊形狀的
        # 抽取者會一路綠燈過 CI —— 那條閘門就只是在描述現況，不是在擋。
        if needs and not a.write:
            bad += 1

        if a.write and needs and not problems:
            p.write_text(rewrite_paths(p.read_text(encoding="utf-8"), paths), encoding="utf-8")

    if bad:
        print(f"\n⛔ {bad} 個問題")
        print("WORD_SEARCH_SHAPE=FAIL")
        return 1
    print("\nWORD_SEARCH_SHAPE=PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
