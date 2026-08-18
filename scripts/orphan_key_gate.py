#!/usr/bin/env python3
"""抽出來的東西有沒有整節被靜默丟掉。

為什麼需要這道門
----------------
`split_lesson_modules.py` 只搬 `MODULES` 表認得的 top-level key。**不認得的 key
不會報錯、不會警告，就是消失** —— 產出少一個模組檔，其餘一切正常。

2026-08-18 實例：有 worker 把「九 知識補給站」寫成 `supplement`（表裡叫
`resources`），整節被丟掉。它自己在交件前發現的，而**七道門全部照樣綠**：

    逐字門      驗「寫下來的對嗎」        → 沒寫的看不到
    覆蓋率門    只比課文段落              → 課文以外的看不到
    型別門      驗 block 的 type          → 比 block 高一層的看不到
    重點表/找字 各只看自己那一節          → 落單的 key 不屬於任何一節
    渲染門      驗型別有沒有元件          → 資料沒進 v3 就不會被渲染

**壞掉的東西剛好在每道門的背面。** 掃全庫發現同一個 key 影響 6 課，不只它那一課。

判準
----
`_extracted/*.yml` 的每個 top-level key 必須落在兩個集合之一：

* `MODULES`（會被搬進 v3/<模組>.yml 的內容）
* `BOOKKEEPING`（刻意留在來源檔的記帳欄，本檔明列）

兩邊都不在 = 這一節寫進來了但沒有人搬它 → FAIL。

⚠️ 修法只有兩條，**不要為了讓門變綠而刪掉那個 key**（那是把靜默流失變成明著刪）：
  1. 它是內容 → 在 `MODULES` 加一個模組（或改用既有的同義 key）
  2. 它是記帳 → 加進 `BOOKKEEPING` 並寫清楚為什麼不必搬

用法：
    python3 scripts/orphan_key_gate.py            # 全庫
    python3 scripts/orphan_key_gate.py L0071      # 單課
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
EXTRACTED = REPO / "backend/data/lessons/_extracted"
SPLITTER = REPO / "scripts/split_lesson_modules.py"

# 刻意留在來源檔、不搬進 v3 的記帳欄。每一條都要說得出「為什麼不必搬」——
# 說不出來的就不是記帳，是內容。
BOOKKEEPING: dict[str, str] = {
    "meta": "課的身分與抽取來源；由 splitter 自己拆進 lesson.yml / metadata.yml",
    "sections_present": "這課實際印了哪幾個大題；splitter 用它推 section_no",
    "sections_absent": "原稿本來就沒有的大題（附理由），用來區分「沒有」與「漏抄」",
    "sections_absent_note": "同上，散文版",
    "sections_note": "大題編號的異常說明（重複號、跳號、順序與多數課相反）",
    "source_errata_note": "勘誤的散文補充；結構化的那份走 source_errata 模組",
    "schema_gap": "這課有東西裝不進現行 schema，明著記下來而不是丟掉",
    # 2026-08-18：`multi_text_parts` / `keypoints_followup_questions` 已改成真模組
    # （見 split_lesson_modules.py），不再需要暫列在這裡 —— 內容該進 v3，
    # 而不是靠白名單留在來源檔。
}


# 註記形狀的 key：**開頭 `_` 且結尾 note/notes**。兩個條件都要，故意訂得很窄 ——
# 這道門的價值在於逼人回答「這是內容還是記帳」，通配符會把那個問題消掉。
#
# 掃全庫時真的被丟掉的四個 key（supplement / writing_practice / goal_box /
# self_check_before_reading）沒有一個長這樣，而記帳用的（`_總表_對照note`、
# `_節次順序note`、`_siblings_note`）全都長這樣 —— 兩邊在形狀上是分得開的。
ANNOTATION_RE = re.compile(r"^_.*notes?$")


def module_keys() -> set[str]:
    """從 splitter 讀 MODULES，不要在這裡抄一份（抄的那份一定會漂）。"""
    src = SPLITTER.read_text(encoding="utf-8")
    m = re.search(r"MODULES:[^=]*=\s*\{(.*?)\n\}", src, re.S)
    if not m:
        raise SystemExit("⛔ 讀不到 split_lesson_modules.py 的 MODULES —— 它改結構了，這道門要跟著改")
    keys = set(re.findall(r'^\s*"([a-z_]+)"\s*:', m.group(1), re.M))
    if len(keys) < 10:
        raise SystemExit(f"⛔ 只解析到 {len(keys)} 個 module key，明顯太少，解析壞了")
    return keys


def main() -> int:
    only = sys.argv[1] if len(sys.argv) > 1 else None
    known = module_keys() | set(BOOKKEEPING)

    files = sorted(EXTRACTED.glob("*.yml"))
    if only:
        files = [f for f in files if f.stem == only]
        if not files:
            print(f"⛔ 找不到 {only}")
            return 1

    bad: dict[str, list[str]] = {}
    for f in files:
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        orphans = [k for k in doc if k not in known and not ANNOTATION_RE.match(k)]
        if orphans:
            bad[f.stem] = orphans
        else:
            print(f"  ✓ {f.stem}")

    for uid, orphans in bad.items():
        for k in orphans:
            print(f"  🔴 {uid}: top-level key `{k}` 沒有人搬 —— 整節會靜默消失")

    print()
    if bad:
        print("  修法二選一（不要刪掉那個 key）：")
        print("    1. 是內容 → 在 split_lesson_modules.py 的 MODULES 加模組，或改用既有同義 key")
        print("    2. 是記帳 → 加進 orphan_key_gate.py 的 BOOKKEEPING 並寫明為什麼不必搬")
        print()
        print(f"ORPHAN_KEY_GATE=FAIL  （{len(files) - len(bad)}/{len(files)}）")
        return 1

    print(f"ORPHAN_KEY_GATE=PASS  （{len(files)}/{len(files)}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
