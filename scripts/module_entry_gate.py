#!/usr/bin/env python3
"""抽出來的模組，學生有沒有路走到它。

為什麼需要這道門
----------------
既有的 `render_coverage_gate` 問的是「**聚光燈裡的每個 block type** 有沒有對應
元件」—— 那比「模組」低一層。模組整個沒有入口的時候，它什麼都看不到。

2026-08-18 在 staging 實測發現：L0155（文言文）**11/11 步驟都載得起來、0 console
error、空狀態訊息也都誠實**，但這課有 **7 個模組、2704 個漢字**在畫面上一步都到
不了 —— 原文、白話翻譯、語詞連連看、句子配對、自我挑戰。抽出來了、拆進 v3 了、
API 也送得出來，學生看不到。

全庫 24 種模組裡有 10 種是這個狀態，其中文言文那 6 種涵蓋 10 課 ——
**一整個課型只上了一半，而表面上看起來是完整的**。

判準：宣告，不是猜
------------------
這道門**不去推論**某個模組畫得出來沒有（推論會錯，而且會愈推愈寬鬆）。
它要求每一種出現在資料裡的模組，都在下面的表上有一個**明確的答案**：

    STEP        → 學生走得到，對應哪一個 step id
    FOLDED      → 沒有自己的 step，但併在別的 step 裡顯示（要寫在哪一個裡）
    NO_ENTRY    → 目前沒有入口（要寫追蹤 issue）
    NOT_SHOWN   → 刻意不給學生看（要寫為什麼）

新模組**預設不在表上 ⇒ 紅**。那一刻寫表的人必須回答「學生怎麼走到它」，
而不是等三個月後有人在 staging 點一點才發現。

⚠️ `NO_ENTRY` 是**有上限的**：現在幾課就是幾課，多一課就紅。
   那份名單不是免死金牌，是還沒還的債。

用法：
    python3 scripts/module_entry_gate.py           # 掃全庫
    python3 scripts/module_entry_gate.py --list    # 只列出目前的對應表
"""
from __future__ import annotations

import argparse
import collections
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend/data/lessons"
STEP_CONFIG = REPO / "frontend/src/config/stepConfig.ts"

STEP, FOLDED, NO_ENTRY, NOT_SHOWN = "STEP", "FOLDED", "NO_ENTRY", "NOT_SHOWN"

# 模組 → 學生怎麼走到它。**每一種都要有答案，沒有答案就是紅的。**
ENTRY: dict[str, tuple[str, str]] = {
    # ── 有自己的 step ──────────────────────────────────────────
    "comprehension":        (STEP, "comprehension"),
    "spotlight":            (STEP, "spotlight"),
    "keypoints":            (STEP, "keypoints-table"),
    "key_reading":          (STEP, "key-passage-reading"),
    "full_text_annotate":   (STEP, "full-text-annotate"),
    "vocab_definitions":    (STEP, "vocab-definition"),
    "vocab_application":    (STEP, "vocab-application"),
    "vocab_review":         (STEP, "vocab-review"),
    "resources":            (STEP, "knowledge-station"),

    # ── 沒有自己的 step，併在別處 ────────────────────────────────
    "lesson":               (FOLDED, "課文本體，每個 step 都在用"),
    "metadata":             (FOLDED, "課名／年級／策略，顯示在課頭與圖書館卡片"),

    # ── 刻意不給學生看 ──────────────────────────────────────────
    "errata":               (NOT_SHOWN, "教材本身的印錯紀錄，是給我方校對用的，不是課程內容"),

    # ── 文言文專屬：一個新 step，或跟同一個 step 一起顯示 (#2752 Phase 1) ──────
    # 原文＋白話對照放同一頁（annotate 互動不合這裡的形狀 — 注釋已印好，不是學
    # 生自己選字），文白句子比對／文白詞語比對／自我挑戰各自是獨立的互動形狀。
    "classical_text":       (STEP, "classical-text"),
    "modern_translation":   (FOLDED, "跟 classical_text 同一頁：原文/白話對照"),
    "word_matching":        (STEP, "classical-word-matching"),
    "sentence_matching":    (STEP, "classical-sentence-matching"),
    "self_challenge":       (STEP, "classical-self-challenge"),
    "intro_guide":          (FOLDED, "課程簡介頁（lesson-intro）多印一段導讀文字"),

    # ── 目前沒有入口（債，追蹤中）────────────────────────────────
    # ⚠️ 這些不是「不用做」，是「還沒做」。見 issue #2752。
    "goal_box":             (NO_ENTRY, "#2752 學習目標框"),
    "self_check_before_reading": (NO_ENTRY, "#2752 讀前自我檢核"),
    "writing_practice":     (NO_ENTRY, "#2752 寫作練習"),
    "multi_text_parts":     (NO_ENTRY, "#2752 多文本各篇"),
    "cross_text_banner":    (NO_ENTRY, "#2752 跨課文橫幅"),
    "keypoints_followup_questions": (NO_ENTRY, "#2752 重點表追問"),
}

# 目前沒有入口的模組涵蓋幾課。**只能減少，不能增加。**
# 增加代表又有內容被抽出來卻沒人接 —— 那正是這道門要擋的事。
#
# 2026-08-19 (#2752 Phase 1): 83 → 82。文言文六個目標模組全部有了答案，但這 10 課
# 裡有 9 課還背著範圍外的 `goal_box`（下一階段的債）—— 只有 L0161（沒有 goal_box）
# 真正整課清零。老實記這個數字，不要因為「修了 6 個模組」就假裝掉了 6 課。
NO_ENTRY_LESSON_CEILING = 82


def _enabled_step_ids() -> set[str]:
    """前端真的啟用的 step。disabled 的不算「學生走得到」。

    每個 step 的區塊掃到「下一個 `id:`」為止；**沒有下一個時**（也就是這是
    STEP_REGISTRY 裡最後一筆），舊版會掃到檔案結尾 —— 而結尾那段
    `DEFAULT_STEP_SEQUENCE` 的說明文字裡剛好寫著「set `enabled: false`」，
    於是最後一筆永遠被誤判成 disabled。#2752 踩到這個：新增第 4 個 step 讓
    `classical-self-challenge` 變成新的最後一筆，門就把它判成停用。
    修法：把搜尋範圍框在 STEP_REGISTRY 物件本身，不讓它溢到後面的說明文字。
    """
    src = STEP_CONFIG.read_text(encoding="utf-8")
    registry_start = src.find("export const STEP_REGISTRY")
    # The object literal's OWN closing `};` — not the next export. The JSDoc
    # comment between STEP_REGISTRY and DEFAULT_STEP_SEQUENCE itself contains
    # the literal phrase "enabled: false" (explaining what that flag does),
    # so bounding at "the next export" instead of "this object's own close"
    # let that comment poison the last entry's block all over again.
    registry_end = src.find("\n};", registry_start if registry_start != -1 else 0)
    if registry_end == -1:
        registry_end = len(src)
    ids: set[str] = set()
    for m in re.finditer(r"id:\s*'([a-z-]+)'", src):
        if m.start() > registry_end:
            continue
        # 這個 step 的區塊到下一個 `id:` 為止，但不超過 STEP_REGISTRY 的結尾
        nxt = src.find("id:", m.end())
        block_end = nxt if (nxt != -1 and nxt <= registry_end) else registry_end
        block = src[m.end():block_end]
        if "enabled: false" not in block:
            ids.add(m.group(1))
    return ids


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="只列出對應表")
    args = ap.parse_args()

    if args.list:
        for mod, (kind, why) in sorted(ENTRY.items()):
            print(f"  {mod:32s} {kind:10s} {why}")
        return 0

    steps = _enabled_step_ids()
    if len(steps) < 5:
        raise SystemExit(f"⛔ 只解析到 {len(steps)} 個啟用的 step，明顯太少 —— stepConfig 解析壞了")

    # 語料裡實際出現的模組
    present: collections.Counter[str] = collections.Counter()
    for d in sorted(LESSONS.iterdir()):
        v3 = d / "v3"
        if not (d.is_dir() and d.name.startswith("L") and v3.is_dir()):
            continue
        for f in v3.glob("*.yml"):
            present[f.stem] += 1
    if len(present) < 5:
        raise SystemExit(f"⛔ 只掃到 {len(present)} 種模組，明顯太少 —— 沒掃到語料")

    undeclared = sorted(m for m in present if m not in ENTRY)
    dangling = sorted(
        m for m, (k, tgt) in ENTRY.items()
        if k == STEP and tgt not in steps and m in present
    )
    # 受影響的**課**數，不是次數 —— 一課有 3 個沒入口的模組，那還是一課看不完整。
    no_entry_mods = {m for m in present if ENTRY.get(m, ("", ""))[0] == NO_ENTRY}
    no_entry_lessons = len({
        d.name for d in LESSONS.iterdir()
        if d.is_dir() and d.name.startswith("L") and (d / "v3").is_dir()
        and {f.stem for f in (d / "v3").glob("*.yml")} & no_entry_mods
    })

    print(f"  語料裡的模組：{len(present)} 種 / 前端啟用的 step：{len(steps)} 個")
    print()

    fail = False
    for m in undeclared:
        print(f"  🔴 `{m}`（{present[m]} 課）沒有宣告學生怎麼走到它")
        fail = True
    for m in dangling:
        print(f"  🔴 `{m}` 宣告對應 step `{ENTRY[m][1]}`，但那個 step 不存在或已停用")
        fail = True

    if no_entry_lessons > NO_ENTRY_LESSON_CEILING:
        print(f"  🔴 沒有入口的模組涵蓋 {no_entry_lessons} 課，超過上限 {NO_ENTRY_LESSON_CEILING}")
        print("     又有內容被抽出來卻沒人接。要嘛補入口，要嘛說明為什麼上限該調高。")
        fail = True
    else:
        print(f"  ⚠️ 沒有入口：{len(no_entry_mods)} 種模組、涵蓋 {no_entry_lessons} 課"
              f"（上限 {NO_ENTRY_LESSON_CEILING}）→ #2752")

    print()
    if fail:
        print("  修法：在 scripts/module_entry_gate.py 的 ENTRY 表補上這個模組的答案。")
        print("        STEP / FOLDED / NO_ENTRY / NOT_SHOWN 四選一，**都要寫理由**。")
        print("MODULE_ENTRY_GATE=FAIL")
        return 1

    print(f"MODULE_ENTRY_GATE=PASS  （{len(present)} 種模組全部有明確答案）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
