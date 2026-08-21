#!/usr/bin/env python3
"""產出每課的 `_manifest.yml` —— 分派的實體契約（#2843）。

## 這份檔是要交給誰的

Young 2026-08-21 會議上的比喻：

> 「它本身可以是一個航空母艦，是一個抽取器。但它每次要出發，
>   就是小小一隻飛機飛出去去做轟炸機、去做偵察機。」

manifest 就是**派工單**：總覽看完整張學習單，寫下「這課有哪幾個大題、
各對到哪個模組」，然後模組 skill 各自照單去抽自己那一節。

沒有它的話，每個模組 skill 都得自己重讀一次整份 PDF 判斷「有沒有我這一節」——
那就是現在「一個 skill 打遍天下」的成本結構。

## 跟 `sections_present` 的關係

`sections_present` 是**學習單自己印的目錄**（174/175 課有），是原始事實。
manifest 是它**加上模組歸屬**之後的產物 —— 多了 `module` 欄位，
還有「這課缺哪些模組、為什麼」。

⚠️ manifest 是**衍生檔**，不是真相來源。改 `sections_present` 或
`section-to-module.yml` 之後要重產。`--check` 就是在擋這種漂移。

用法：
    python3 scripts/build_lesson_manifest.py           # 產出
    python3 scripts/build_lesson_manifest.py --check   # 只比對（CI 用）
"""
from __future__ import annotations

import argparse
import pathlib
import sys

import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
LESSONS = REPO_ROOT / "backend" / "data" / "lessons"
MAP_FILE = REPO_ROOT / "specs" / "modules" / "section-to-module.yml"
GAPS_FILE = REPO_ROOT / "backend" / "data" / "curriculum_qa" / "content_known_gaps.yaml"


def build_one(version_dir: pathlib.Path, table: dict, gaps: dict) -> dict | None:
    lesson_file = version_dir / "lesson.yml"
    if not lesson_file.is_file():
        return None
    lesson = yaml.safe_load(lesson_file.read_text(encoding="utf-8")) or {}
    rows = lesson.get("sections_present") or []
    if not rows:
        return None

    uid = version_dir.parent.name
    not_sections = set(table.get("not_sections", []))
    sections = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "")
        if not name:
            continue
        module = None
        unresolved = False
        for m in table.get("matches", []):
            if m["needle"] in name:
                module = m["module"]
                break
        else:
            for u in table.get("unresolved", []):
                if u["needle"] in name:
                    unresolved = True
                    break
        entry = {"no": row.get("no"), "name": name, "module": module}
        if row.get("subtitle"):
            entry["subtitle"] = row["subtitle"]
        if unresolved:
            # 明說「還沒歸因」而不是留 module: null 讓人以為是漏填
            entry["module_unresolved"] = True
        sections.append(entry)

    produced = sorted({p.stem for p in version_dir.glob("*.yml")} - not_sections - {"_manifest"})
    dispatched = sorted({s["module"] for s in sections if s["module"]})
    absent = sorted(gaps.get(uid, set()))

    return {
        "lesson_uid": uid,
        "generated_by": "scripts/build_lesson_manifest.py",
        "note": (
            "衍生檔，不是真相來源。sections 來自 lesson.yml 的 sections_present，"
            "module 歸屬來自 specs/modules/section-to-module.yml。改了那兩者要重產。"
        ),
        "sections": sections,
        # 派工單：這課要出動哪幾個模組 skill
        "dispatch": dispatched,
        # 實際產出的模組檔 —— 跟 dispatch 對不上就是對帳門要抓的
        "produced": produced,
        # 學習單本身就沒印的那幾節（已逐課開原稿確認，見 content_known_gaps.yaml）
        "absent_from_source": absent,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    table = yaml.safe_load(MAP_FILE.read_text(encoding="utf-8")) or {}
    gaps_data = yaml.safe_load(GAPS_FILE.read_text(encoding="utf-8")) or {}
    gaps = {
        e["lesson_uid"]: set(e["absent_modules"])
        for e in (gaps_data.get("modules_absent_from_source") or {}).get("lessons", [])
    }

    drifted, written = [], 0
    for version_dir in sorted(LESSONS.glob("L*/v3")):
        manifest = build_one(version_dir, table, gaps)
        if manifest is None:
            continue
        target = version_dir / "_manifest.yml"
        text = yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False, width=200)
        if args.check:
            if not target.is_file() or target.read_text(encoding="utf-8") != text:
                drifted.append(version_dir.parent.name)
        else:
            target.write_text(text, encoding="utf-8")
            written += 1

    if args.check:
        if drifted:
            print(f"🔴 {len(drifted)} 課的 _manifest.yml 跟來源對不上（來源改了但沒重產）：")
            print("    " + ", ".join(drifted[:12]) + (" …" if len(drifted) > 12 else ""))
            print("\n跑 `python3 scripts/build_lesson_manifest.py` 重產。")
            return 1
        print("✅ 所有 _manifest.yml 都跟來源一致")
        return 0

    if written == 0:
        # 產 0 份要當錯誤，不要印成功訊息
        print("🔴 沒有產出任何 manifest", file=sys.stderr)
        return 2
    print(f"✅ 產出 {written} 份 _manifest.yml")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
