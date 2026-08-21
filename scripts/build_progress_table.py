#!/usr/bin/env python3
"""從實際檔案生成抽取進度表

為什麼要有這支
--------------
2026-08-17：PROGRESS.md 有 6 列寫 PASS，但其中 4 課的檔案不存在 —— 那批因為型別
發明過多被丟棄，表卻沒跟著退回去。手維護的表會記住「我做過」，不會記住「後來被丟了」。

所以表一律重生成，來源是 `_extracted/*.yml` 這個唯一落點；逐字門狀態現跑現寫。
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
SOT = REPO / "private/curriculum-source/_SOT"
OUT = REPO / "docs/evidence/2026-08-17-multimodal-extraction/PROGRESS.md"

HEADER = """# 多模態抽取進度

> **這張表是生成的**：`python3 scripts/build_progress_table.py`。
> 不要手改 —— 手維護的表會記得「我做過」，不會記得「後來被丟了」
> （2026-08-17 有 4 課因型別發明被丟棄，表卻還寫著 PASS）。

## 現況

| | |
|---|---|
| 已抽取並過逐字門 | {done} |
| 目標 | 175 |
| 進度門 | 二修翻新已完成（175/175 走 v3），該門已於 #2843 淘汰 |

## 已完成

逐字門 PASS = 該課每個字串都在原稿裡找得到。「勘誤」= 教材本身印錯、已記進 `errata.yml`。

| uid | 課號 | 分類 | 課名 | 頁 | 逐字門 | 勘誤 | 模組數 |
|---|---|---|---|---:|---|---:|---:|
"""


def drive_path(uid: str) -> str:
    for v in ("v3", "v2"):
        p = REPO / f"backend/data/lessons/{uid}/{v}/lesson.yml"
        if p.exists():
            d = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
            dp = (d.get("source") or {}).get("drive_path")
            if dp:
                return dp
    return ""


def main() -> int:
    rows = []
    for p in sorted((REPO / "backend/data/lessons/_extracted").glob("*.yml")):
        uid = p.stem
        doc = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        meta = doc.get("meta") or {}
        dp = drive_path(uid)

        verdict = "—"
        if dp and (SOT / dp).exists():
            r = subprocess.run(
                [sys.executable, str(REPO / "scripts/verbatim_gate.py"),
                 "--yaml", str(p), "--docx", str(SOT / dp)],
                capture_output=True, text=True,
            )
            verdict = "PASS" if "VERBATIM_GATE=PASS" in r.stdout else "**FAIL**"
        elif dp:
            verdict = "無原稿"

        mods = len(list((REPO / f"backend/data/lessons/{uid}/v3").glob("*.yml")))
        rows.append({
            "uid": uid,
            "code": meta.get("catalog_slot") or "—",
            "cat": (dp.split("/")[0] if "/" in dp else "—"),
            "title": meta.get("title") or "—",
            "pages": meta.get("pdf_pages") or "—",
            "gate": verdict,
            "errata": len(doc.get("source_errata") or []),
            "mods": mods,
        })

    body = "".join(
        f"| {r['uid']} | {r['code']} | {r['cat']} | {r['title']} | {r['pages']} | "
        f"{r['gate']} | {r['errata']} | {r['mods']} |\n"
        for r in rows
    )
    done = sum(1 for r in rows if r["gate"] == "PASS")
    OUT.write_text(HEADER.format(done=f"{done} / {len(rows)} 份抽取結果") + body, encoding="utf-8")
    print(f"{OUT.relative_to(REPO)}: {len(rows)} 列，逐字門 PASS {done}")
    return 0 if done == len(rows) else 1


if __name__ == "__main__":
    sys.exit(main())
