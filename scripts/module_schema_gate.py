#!/usr/bin/env python3
"""模組輸出契約門 —— 欄位名有沒有各自為政（#2843 階段 0）

為什麼需要這道門
----------------
`backend/data/lessons/*/v3/` 有 2019 個模組檔、24 種模組，**598 種不同的
top-level key 形狀**（2026-08-21 實測）。沒有 per-module 輸出契約，抽取時每一課
自己想一個欄位名，消費端 `.get("questions")` 回 `None` —— **不報錯、其他門全綠、
學生看不到**。

不是假設。閱讀理解有 27 課寫成 `items`，而 `lesson_indexes._mcq_from` 只讀
`questions`：那 27 課的 `multiple_choice` 長度是 0。正向對照：寫 `questions`
的課同一支函式回 5 題。畫面上那 27 課的閱讀理解就是空的。

判準
----
每個模組一份 `backend/data/schemas/modules/<module>.schema.yml`：

    required            消費端真的會讀的欄位。缺 = 那一節在畫面上是空的
    required_any_of     兩個來源擇一即可（知識補給站的 videos/items 就是這種）
    forbidden_aliases   同一件事的其他名字 → 正名。**從實測資料長出來，不是憑空設計**

⚠️ `required` 必須指得出 consumer
---------------------------------
每份 schema 都要列 `consumer:`，而回歸測試會斷言那個檔案真的存在、而且真的讀
那個欄位名。少了這條，schema 會變成「我發明的規格」，被它擋下來的課其實沒壞 ——
`keypoints_shape_gate` 的 docstring 記過那次教訓：**判準錯的門比沒有門更糟**，
它會把好課判死然後有人真的去改資料。

⚠️ 這是棘輪，不是 `== 0`
------------------------
598 種形狀擺在那裡，嚴格門一上線就是 175 課全紅，而恆紅的門會被訓練成無視
（同一個 docstring 記過：19 條被當成內容缺陷掛了一整天，真正原因只是漏帶 flag）。
所以判準是**每個模組每條規則的違規條數 <= 基準值**，只准降不准升。降了就跑
`--update-baseline` 把數字釘低。

用法：
    python3 scripts/module_schema_gate.py                 # 全庫，對基準值
    python3 scripts/module_schema_gate.py --list          # 印出每一條違規
    python3 scripts/module_schema_gate.py --module goal_box --list
    python3 scripts/module_schema_gate.py --update-baseline
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import NamedTuple

import yaml

REPO = Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend/data/lessons"
SCHEMA_DIR = REPO / "backend/data/schemas/modules"
BASELINE = SCHEMA_DIR / "_baseline.json"

# 掃不到這麼多檔就是 glob 壞了 —— 空跑不算成功。真實值 2019（2026-08-21）。
MIN_SCANNED = 2000


class Finding(NamedTuple):
    uid: str
    module: str
    rule: str          # missing_required / missing_required_any_of / forbidden_alias
    field: str
    message: str


def load_schemas() -> dict[str, dict]:
    out = {}
    for p in sorted(SCHEMA_DIR.glob("*.schema.yml")):
        s = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        mod = s.get("module") or p.name.split(".")[0]
        out[mod] = s
    if not out:
        raise SystemExit(f"⛔ {SCHEMA_DIR} 一份 schema 都沒有 —— 這道門瞎了")
    return out


def _inner(doc: dict, module: str) -> dict | None:
    """模組檔的外層是 `{lesson_uid, version_id, section_no, <module>: {...}}`。

    這裡跟 `lesson_uid_loader` 剝的是同一層 —— 剝法不一致的話，門看到的東西
    就不是消費端看到的東西，那個門講的話不算數。
    """
    inner = doc.get(module)
    return inner if isinstance(inner, dict) else None


def check_file(path: Path, module: str, schema: dict) -> list[Finding]:
    uid = path.parent.parent.name
    doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    inner = _inner(doc, module)
    if inner is None:
        return []      # list 形狀或空檔：不是這道門管的事（型別門另管）

    findings: list[Finding] = []
    aliases: dict[str, str] = schema.get("forbidden_aliases") or {}

    # 別名先判。同一個根因只算一次 —— `items` 既是別名、也讓 `questions` 缺席，
    # 兩條都報等於同一課被數兩次，基準值會虛胖、看報告的人以為有兩個問題。
    explained_by_alias: set[str] = set()
    for alias, canonical in aliases.items():
        if alias in inner and inner[alias] not in (None, "", [], {}):
            explained_by_alias.add(canonical)
            findings.append(Finding(
                uid, module, "forbidden_alias", alias,
                f"{uid}/{module}: 用了 `{alias}`，正名是 `{canonical}` —— "
                f"消費端只讀正名，這一節在畫面上會是空的"))

    for field in schema.get("required") or []:
        if field in explained_by_alias:
            continue
        if field not in inner or inner[field] in (None, "", [], {}):
            findings.append(Finding(
                uid, module, "missing_required", field,
                f"{uid}/{module}: 缺必填欄位 `{field}`"))

    for group in schema.get("required_any_of") or []:
        if not any(inner.get(f) not in (None, "", [], {}) for f in group):
            findings.append(Finding(
                uid, module, "missing_required_any_of", "|".join(group),
                f"{uid}/{module}: `{'` / `'.join(group)}` 一個都沒有"))

    return findings


def count_scanned(lessons_root: Path) -> int:
    """掃得到幾個模組檔（含沒有 schema 的）。檔案數下限用的。"""
    return len(list(lessons_root.glob("L*/v3/*.yml")))


def scan(lessons_root: Path, only_module: str | None = None) -> list[Finding]:
    schemas = load_schemas()
    findings: list[Finding] = []
    for module, schema in schemas.items():
        if only_module and module != only_module:
            continue
        for path in sorted(lessons_root.glob(f"L*/v3/{module}.yml")):
            findings.extend(check_file(path, module, schema))
    return findings


def tally(findings: list[Finding]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for f in findings:
        out.setdefault(f.module, {}).setdefault(f.rule, 0)
        out[f.module][f.rule] += 1
    return {m: dict(sorted(r.items())) for m, r in sorted(out.items())}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lessons-root", type=Path, default=LESSONS)
    ap.add_argument("--module")
    ap.add_argument("--list", action="store_true", help="印出每一條違規")
    ap.add_argument("--update-baseline", action="store_true",
                    help="把目前的違規數釘成新基準（只在數字**變小**時做）")
    a = ap.parse_args(argv)

    scanned = count_scanned(a.lessons_root)
    if scanned < (1 if a.lessons_root != LESSONS else MIN_SCANNED):
        print(f"⛔ 只掃到 {scanned} 個模組檔 —— 空跑不算成功")
        print("MODULE_SCHEMA_GATE=FAIL")
        return 1

    findings = scan(a.lessons_root, a.module)
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

    regressions: list[str] = []
    improvements: list[str] = []
    for module, rules in counts.items():
        for rule, n in rules.items():
            allowed = baseline.get(module, {}).get(rule, 0)
            if n > allowed:
                regressions.append(f"  🔴 {module}.{rule}: {n} > 基準 {allowed}")
    for module, rules in baseline.items():
        for rule, allowed in rules.items():
            n = counts.get(module, {}).get(rule, 0)
            if n < allowed:
                improvements.append(f"  ✅ {module}.{rule}: {n} < 基準 {allowed}")

    total = sum(sum(r.values()) for r in counts.values())
    print(f"掃描 {scanned} 個模組檔，{len(load_schemas())} 個模組有 schema，"
          f"違規 {total} 條")
    for module, rules in counts.items():
        print(f"  {module:<28}" + "  ".join(f"{k}={v}" for k, v in rules.items()))

    if improvements:
        print("\n基準值可以往下釘了（跑 --update-baseline）：")
        print("\n".join(improvements))

    if regressions:
        print("\n違規數比基準值高 —— 只准降不准升：")
        print("\n".join(regressions))
        print("\n  修法：把新造的欄位名改成 schema 宣告的正名（不是把 schema 放寬）")
        print("MODULE_SCHEMA_GATE=FAIL")
        return 1

    print("\nMODULE_SCHEMA_GATE=PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
