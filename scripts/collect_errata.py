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


# 抽取者記在 `*_note` 欄位、但沒列成 errata 的落差。命名有幾種寫法，
# 用後綴比對而不是列舉 —— 列舉一定會漏掉下一個 worker 發明的名字。
# 只收「抽取者標記為落差」的註記，判準有二：
#   ① 欄位名以 `_mismatch_note` 結尾（明確在講「這裡對不上」）
#   ② 內容含 🔴（worker 自己標的嚴重度）
#
# ⚠️ 不要用寬鬆的後綴比對。第一版收所有 `*_note`，結果 58 筆裡混進教材自己印的
#    解析（`teacher_note`）與指示語（`benchmark_note`／`column_note`）——
#    真正需要編輯判斷的三五筆被淹掉。
#    **報告的價值在少而準**：這張表是拿去問人「這個要怎麼處理」的，
#    每多一筆不需要決定的東西，就多一分被整張忽略的機率。
MISMATCH_SUFFIX = "_mismatch_note"
SEVERITY_MARK = "🔴"


def collect_notes() -> list[dict]:
    out = []
    extracted = Path(__file__).resolve().parent.parent / "backend/data/lessons/_extracted"
    for f in sorted(extracted.glob("*.yml")):
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        meta = doc.get("meta") or {}
        slot = meta.get("catalog_slot", "")

        def walk(n):
            if isinstance(n, dict):
                for k, v in n.items():
                    if not isinstance(v, str) or len(v) < 12:
                        walk(v)
                        continue
                    is_mismatch = isinstance(k, str) and k.endswith(MISMATCH_SUFFIX)
                    if is_mismatch or SEVERITY_MARK in v:
                        out.append({"lesson_uid": f.stem, "catalog_slot": slot,
                                    "field": k, "text": v})
                    walk(v)
            elif isinstance(n, list):
                for v in n:
                    walk(v)

        walk(doc)
    return out


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

        # 第二區：抽取者看到、但**刻意沒有列成勘誤**的落差。
        #
        # 為什麼要分開列：這些不是錯字，是**編輯決定**——命題引文跟課文對不上、
        # 總表與學習單的語詞整組互換、同一句在兩處寫法不同。改它們等於改題目或
        # 改教材設計，抽取者不該替編輯做這個決定，但把它藏在 YAML 註解裡等於沒說。
        #
        # 混進第一區才是真正的錯：勘誤表是拿去請人修的，裡面每一筆都該是
        # 「照著改就對了」。需要判斷的東西放進去，會讓整張表變得不能直接執行。
        notes = collect_notes()
        if notes:
            lines += [
                "",
                "## 觀察到但未列為勘誤（需編輯判斷）",
                "",
                f"共 **{len(notes)}** 筆。這些不是錯字，是需要有人決定的落差 ——",
                "改動它們等於改題目或改教材設計，抽取時一律照原樣保留。",
                "",
                "| 課 | 課號 | 欄位 | 內容 |",
                "|---|---|---|---|",
            ]
            for n in notes:
                cell = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
                lines.append(
                    f"| {n['lesson_uid']} | {n['catalog_slot']} | {n['field']} | {cell(n['text'])[:260]} |"
                )

        text = "\n".join(lines) + "\n"

    if a.out:
        a.out.write_text(text, encoding="utf-8")
        print(f"寫入 {a.out}（{len(rows)} 筆）")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
