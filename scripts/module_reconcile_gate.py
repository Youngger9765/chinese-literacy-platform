#!/usr/bin/env python3
"""分派對帳門 —— 學習單印的大題目錄 vs 實際產出的模組檔（#2843 階段 0）

為什麼需要這道門
----------------
「這課有哪些模組」目前沒有任何一個地方在**分派**，只有三個地方在**事後**處理：
skill 裡給人讀的散文、`split_lesson_modules.MODULES`（不在表上的 key 不報錯、
直接消失）、以及 `orphan_key_gate`（2026-08-18 才有，在那之前 15 課整節被靜默丟掉）。

但**總覽的產物早就有了**：`lesson.yml` 的 `sections_present` —— 學習單自己印出來
的大題目錄，174/175 課有。它現在只被用來推 `section_no` 與 `step_sequence`，
**沒有任何東西拿它跟「實際產出了哪些模組檔」對帳**。

這道門就是那個對帳。三種紅法，各自指名責任方：

    宣告有、檔案沒有    declared_not_produced    該模組的抽取沒跑成功／BLOCKED
    檔案有、宣告沒有    produced_not_declared    總覽漏看了一個大題
    認不得的大題名      unmapped_section_name    登記表沒有這個名字 → 有人要回答它是誰

⚠️ 認不得的名字要**明著報**，不能靜靜跳過
------------------------------------------
靜靜跳過正是 `MODULES` 表漏一個 key 那次的形狀：不報錯、不警告，就是消失。
所以登記表裡有一份 `unmapped_section_names_pending_review`，寫著哪幾個名字
**故意沒填答案**（只有 1 課、從名字看不出是哪個模組）。順手補一個合理的答案
就是把猜測洗成契約。

⚠️ 這是棘輪
-----------
同 `module_schema_gate` 與 `module_entry_gate.NO_ENTRY_LESSON_CEILING`：
每一類的違規條數 <= 基準值，只准降不准升。
（數的是「條」不是「課」—— 一課可能同時踩兩條，那樣算兩條，比較嚴。）

用法：
    python3 scripts/module_reconcile_gate.py
    python3 scripts/module_reconcile_gate.py --list
    python3 scripts/module_reconcile_gate.py --uid L0153
    python3 scripts/module_reconcile_gate.py --update-baseline
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import NamedTuple

import yaml

REPO = Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend/data/lessons"
REGISTRY = REPO / "backend/data/schemas/modules/registry.yml"
BASELINE = REPO / "backend/data/schemas/modules/_reconcile_baseline.json"
ENTRY_SRC = REPO / "scripts/module_entry_gate.py"

MIN_LESSONS = 175


class Finding(NamedTuple):
    uid: str
    module: str
    rule: str
    message: str


def served_modules() -> set[str]:
    """24 個服務中的模組。

    **從 `module_entry_gate.ENTRY` 讀，不在這裡抄一份** —— 抄的那份一定會漂。
    `orphan_key_gate` 對 `split_lesson_modules.MODULES` 用的是同一招。
    """
    src = ENTRY_SRC.read_text(encoding="utf-8")
    m = re.search(r"ENTRY:[^=]*=\s*\{(.*?)\n\}", src, re.S)
    if not m:
        raise SystemExit("⛔ 讀不到 module_entry_gate.py 的 ENTRY —— 它改結構了，這道門要跟著改")
    keys = set(re.findall(r'^\s*"([a-z_]+)"\s*:', m.group(1), re.M))
    if len(keys) < 20:
        raise SystemExit(f"⛔ 只解析到 {len(keys)} 個模組，明顯太少，解析壞了")
    return keys


def load_registry() -> dict:
    reg = yaml.safe_load(REGISTRY.read_text(encoding="utf-8")) or {}
    if not reg.get("modules"):
        raise SystemExit(f"⛔ {REGISTRY} 沒有 modules —— 這道門瞎了")
    return reg


def _declared(sections: list, aliases: dict[str, str]) -> tuple[set[str], list[str]]:
    """大題目錄 → (認得的模組, 認不得的名字)。

    比對用「包含」不是全等：抽取者照教材抄名字，而教材用字有好幾種寫法
    （「文章重點表」／「文章重點整理」）。長的 needle 先比，避免短的先命中。
    """
    ordered = sorted(aliases.items(), key=lambda kv: -len(kv[0]))
    declared: set[str] = set()
    unknown: list[str] = []
    for row in sections or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        hit = next((mod for needle, mod in ordered if needle in name), None)
        if hit:
            declared.add(hit)
        else:
            unknown.append(name)
    return declared, unknown


def count_scanned(lessons_root: Path) -> int:
    return len(list(lessons_root.glob("L*/v3/lesson.yml")))


def scan(lessons_root: Path, only_uid: str | None = None) -> list[Finding]:
    reg = load_registry()
    aliases = reg["section_name_aliases"]
    declarable = {m for m, v in reg["modules"].items() if v.get("declarable")}

    findings: list[Finding] = []
    for lesson_yml in sorted(lessons_root.glob("L*/v3/lesson.yml")):
        vdir = lesson_yml.parent
        uid = vdir.parent.name
        if only_uid and uid != only_uid:
            continue
        doc = yaml.safe_load(lesson_yml.read_text(encoding="utf-8")) or {}
        declared, unknown = _declared(doc.get("sections_present") or [], aliases)
        # 只跟「會印在大題目錄上」的模組對帳。metadata / errata / goal_box 這些
        # 從來不是大題，拿它們當漏宣告會製造 175 課的假紅。
        produced = {p.stem for p in vdir.glob("*.yml")} & declarable

        for mod in sorted(declared - produced):
            findings.append(Finding(uid, mod, "declared_not_produced",
                f"{uid}: 大題目錄宣告了 `{mod}`，但 v3 沒有 {mod}.yml —— "
                f"該模組的抽取沒跑成功，去找 extract-{mod} 的麻煩"))
        for mod in sorted(produced - declared):
            findings.append(Finding(uid, mod, "produced_not_declared",
                f"{uid}: 有 {mod}.yml，但大題目錄沒宣告 `{mod}` —— "
                f"總覽漏看了一個大題（或那一節的名字還沒進登記表）"))
        for name in unknown:
            findings.append(Finding(uid, "", "unmapped_section_name",
                f"{uid}: 大題名「{name}」不在登記表裡 —— "
                f"它是哪一個模組？填進 registry.yml 的 section_name_aliases"))
    return findings


def tally(findings: list[Finding]) -> dict[str, int]:
    out: dict[str, int] = {}
    for f in findings:
        out[f.rule] = out.get(f.rule, 0) + 1
    return dict(sorted(out.items()))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lessons-root", type=Path, default=LESSONS)
    ap.add_argument("--uid")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--update-baseline", action="store_true")
    a = ap.parse_args(argv)

    scanned = count_scanned(a.lessons_root)
    if scanned < (1 if a.lessons_root != LESSONS else MIN_LESSONS):
        print(f"⛔ 只掃到 {scanned} 課 —— 空跑不算成功")
        print("MODULE_RECONCILE_GATE=FAIL")
        return 1

    findings = scan(a.lessons_root, a.uid)
    counts = tally(findings)

    if a.list:
        for f in findings:
            print(f"  🔴 {f.message}")
        print()

    if a.update_baseline:
        BASELINE.write_text(json.dumps(counts, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")
        print(f"基準值已更新 → {BASELINE.relative_to(REPO)}")
        return 0

    baseline = json.loads(BASELINE.read_text(encoding="utf-8")) if BASELINE.exists() else {}

    print(f"對帳 {scanned} 課")
    for rule in sorted(set(counts) | set(baseline)):
        n, allowed = counts.get(rule, 0), baseline.get(rule, 0)
        mark = "🔴" if n > allowed else ("✅" if n < allowed else "  ")
        print(f"  {mark} {rule:<26}{n:>4}  (基準 {allowed})")

    regressions = [r for r in counts if counts[r] > baseline.get(r, 0)]
    if regressions:
        print(f"\n以下類別比基準值高 —— 只准降不准升: {', '.join(regressions)}")
        print("  用 --list 看每一條")
        print("MODULE_RECONCILE_GATE=FAIL")
        return 1

    if any(counts.get(r, 0) < baseline[r] for r in baseline):
        print("\n有類別降低了 —— 跑 --update-baseline 把數字釘低")

    print("\nMODULE_RECONCILE_GATE=PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
