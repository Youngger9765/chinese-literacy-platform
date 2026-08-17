#!/usr/bin/env python3
"""彙整全庫的原稿勘誤 —— 回答「我們查出教材哪裡有錯」

抽取時發現的教材錯誤記在各課 YAML 的 `source_errata:` 區塊。
這支把它們收成一張表（Markdown / JSON / CSV），可以直接交給教材編輯。

用法：
    python3 scripts/collect_errata.py                      # 掃預設兩處，印 Markdown
    python3 scripts/collect_errata.py --root qa/content-evidence --format json
    python3 scripts/collect_errata.py --kind 錯字          # 只看某一類
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import yaml

DEFAULT_ROOTS = ["qa/content-evidence", "backend/data/lessons"]
FIELDS = ["lesson_uid", "catalog_slot", "title", "id", "section",
          "locator", "kind", "source", "corrected", "why", "confidence", "evidence"]


def collect(roots: list[Path]) -> list[dict]:
    rows = []
    for root in roots:
        if not root.exists():
            continue
        for p in sorted(root.rglob("*.yml")):
            try:
                data = yaml.safe_load(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            errata = data.get("source_errata")
            if not errata:
                continue
            meta = data.get("meta") or {}
            for e in errata:
                if not isinstance(e, dict):
                    continue
                rows.append({
                    "lesson_uid": meta.get("lesson_uid") or data.get("lesson_uid") or "?",
                    "catalog_slot": meta.get("catalog_slot") or "?",
                    "title": meta.get("title") or "?",
                    "file": str(p),
                    **{k: e.get(k, "") for k in FIELDS[3:]},
                })
    rows.sort(key=lambda r: (r["lesson_uid"], str(r["id"])))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", action="append", default=None,
                    help=f"掃描根目錄，可重複；預設 {DEFAULT_ROOTS}")
    ap.add_argument("--format", choices=["md", "json", "csv"], default="md")
    ap.add_argument("--kind", help="只列某一類（贅字／漏字／錯字／重複標點…）")
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()

    roots = [Path(r) for r in (a.root or DEFAULT_ROOTS)]
    rows = collect(roots)
    if a.kind:
        rows = [r for r in rows if a.kind in str(r.get("kind", ""))]

    if a.format == "json":
        text = json.dumps(rows, ensure_ascii=False, indent=1)
    elif a.format == "csv":
        import io
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
        text = buf.getvalue()
    else:
        lines = [
            "# 教材原稿勘誤表",
            "",
            f"共 **{len(rows)}** 筆，涵蓋 **{len({r['lesson_uid'] for r in rows})}** 課。",
            "由 `extract-lesson-multimodal` 抽取時記錄，每筆都對照過 PDF 版面與 DOCX 文字流。",
            "",
            "| 課 | 課號 | 位置 | 類型 | 原稿 | 建議修正 | 說明 |",
            "|---|---|---|---|---|---|---|",
        ]
        for r in rows:
            loc = f"{r['section']}／{r['locator']}".strip("／")
            cell = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
            lines.append(
                f"| {r['lesson_uid']} | {r['catalog_slot']} | {cell(loc)} | {r['kind']} "
                f"| {cell(r['source'])} | {cell(r['corrected'])} | {cell(r['why'])} |"
            )
        if not rows:
            lines.append("| （尚無紀錄） | | | | | | |")
        text = "\n".join(lines) + "\n"

    if a.out:
        a.out.write_text(text, encoding="utf-8")
        print(f"寫入 {a.out}（{len(rows)} 筆）")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
