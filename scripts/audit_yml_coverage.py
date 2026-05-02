#!/usr/bin/env python3
"""
Audit yml content coverage vs raw docx — find missing/漏抓 content.

Three layers:
1. Raw XML count vs yml count (fill_in_blank, MCQ, vocab_bank, vocab_def, videos)
2. Cross-lesson outlier detection (lessons obviously below same-strategy median)
3. Schema validation (required sections per strategy type)

Output: backend/data/lessons/_AUDIT_REPORT.md with red flags + outliers.

Usage:
    python3 scripts/audit_yml_coverage.py [--yml-dir DIR]
"""
from __future__ import annotations
import argparse
import re
import statistics
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Optional

import yaml

REPO = Path("/Users/young/project/chinese-literacy-platform")

SOURCE_DIRS = [
    REPO / "private/curriculum-source/2026-05-01/1.L1-158新版完成學習單1150415/1-1教師版(L1~122)",
    REPO / "private/curriculum-source/2026-05-01/1.L1-158新版完成學習單1150415/第三階段(L123開始~L157)差學生版",
]


def find_docx(code: str) -> Optional[Path]:
    for base in SOURCE_DIRS:
        if not base.exists():
            continue
        for p in base.rglob(f"{code}*.docx"):
            return p
    return None


def get_raw_text(docx: Path) -> str:
    with zipfile.ZipFile(docx) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    text = re.sub(r"<w:p[ >][^>]*?>", "\n", re.sub(r"<w:tab/>", "\t", re.sub(r"<w:br/>", "\n", xml)))
    text = re.sub(r"<[^>]+>", "", text)
    return text


def count_raw(text: str) -> dict:
    """Count actual content markers in raw docx text."""
    return {
        "fill_in_blank": len(re.findall(r"【[^】]+】", text)),
        "mcq_question_markers": len(re.findall(r"[（(]\s*[A-DＡＢＣＤ]\s*[）)]\s*\d+", text)),
        "vocab_bank_lines": len(set(
            m.group(1) for m in re.finditer(r"(?:^|\n)([A-J])[.．][一-鿿]{2,8}", text)
        )),
        "vocab_def_lines": len(re.findall(r"\(\d+\)\s*[一-鿿]{2,8}\s*[:：][^\n]+", text)),
        "videos_片長": len(re.findall(r"片長", text)),
        "spotlight_present": int(bool(re.search(r"閱讀聚光燈|文言聚光燈", text))),
        "structure_table_present": int("文章重點表" in text),
        "self_check_present": int(bool(re.search(r"自我檢核", text))),
    }


def count_yml(d: dict) -> dict:
    """Count content fields in re-parsed yml."""
    return {
        "fill_in_blank": d.get("fill_in_blank_count", 0),
        "mcq_question_markers": d.get("閱讀理解選擇題_count", 0),
        "vocab_bank_lines": len(d.get("vocab_bank") or {}),
        "vocab_def_lines": len(d.get("vocab_definitions") or []),
        "videos_片長": len(d.get("videos") or []),
        "spotlight_present": int(len(d.get("spotlight_raw_text", "") or "") > 100),
        "structure_table_present": int(
            bool((d.get("section_content") or {}).get("文章重點表"))
        ),
        "self_check_present": int(d.get("self_check_count", 0) > 0),
    }


def lesson_strategy_group(d: dict) -> str:
    """Group lessons by reading strategy type for outlier detection."""
    return d.get("reading_strategy_type") or "general"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--yml-dir", default=str(REPO / "backend/data/lessons/_reparsed_2026-05-02"))
    args = ap.parse_args()

    yml_dir = Path(args.yml_dir)
    yml_files = sorted(f for f in yml_dir.glob("*.yml") if not f.name.startswith("_"))

    # Layer 1: raw vs yml diff
    layer1_flags: list[dict] = []
    # Layer 2: collect counts grouped by strategy for outlier detection
    by_strategy: dict[str, list[dict]] = defaultdict(list)
    # Layer 3: schema check
    layer3_flags: list[dict] = []

    print(f"Auditing {len(yml_files)} lessons against raw docx...")
    print()

    all_records: list[dict] = []

    for f in yml_files:
        code = f.stem
        d = yaml.safe_load(f.read_text(encoding="utf-8"))
        docx = find_docx(code)

        if not docx:
            layer1_flags.append({
                "code": code, "type": "no_docx_source",
                "msg": "yml exists but no docx found",
            })
            continue

        raw = get_raw_text(docx)
        rc = count_raw(raw)
        yc = count_yml(d)

        # Layer 1 — raw vs yml
        for field in ["fill_in_blank", "mcq_question_markers", "vocab_bank_lines",
                      "vocab_def_lines", "videos_片長"]:
            raw_n, yml_n = rc[field], yc[field]
            if raw_n > 0 and yml_n < raw_n * 0.6:  # <60% of raw = red flag
                layer1_flags.append({
                    "code": code, "type": "undercount", "field": field,
                    "raw": raw_n, "yml": yml_n,
                    "ratio": round(yml_n / raw_n, 2) if raw_n else 0,
                })
        for field in ["spotlight_present", "structure_table_present", "self_check_present"]:
            if rc[field] == 1 and yc[field] == 0:
                layer1_flags.append({
                    "code": code, "type": "missing_section", "field": field,
                    "raw": "yes", "yml": "no",
                })

        # Layer 3 — schema check
        strategy = lesson_strategy_group(d)
        REQUIRED = {
            "summary_psr": ["spotlight", "structure_table"],
            "graphic_text_integration": ["spotlight"],
            "general": ["spotlight"],
        }
        required = REQUIRED.get(strategy, [])
        worksheet_types = {s.get("type") for s in d.get("worksheet_section_order", [])}
        for req in required:
            if req not in worksheet_types and yc.get(f"{req}_present", 0) == 0:
                layer3_flags.append({
                    "code": code, "strategy": strategy,
                    "missing_required": req,
                })

        # Layer 2 — collect for outlier
        by_strategy[strategy].append({
            "code": code,
            "spotlight_chars": len(d.get("spotlight_raw_text", "") or ""),
            "fill_in_blank": yc["fill_in_blank"],
            "mcq": yc["mcq_question_markers"],
            "vocab_bank": yc["vocab_bank_lines"],
            "vocab_def": yc["vocab_def_lines"],
        })

        all_records.append({"code": code, "strategy": strategy, "raw": rc, "yml": yc})

    # Layer 2: outlier detection — flag lessons <40% of strategy median
    layer2_flags: list[dict] = []
    for strategy, group in by_strategy.items():
        if len(group) < 5:
            continue
        for field in ["spotlight_chars", "fill_in_blank", "mcq", "vocab_bank", "vocab_def"]:
            values = [g[field] for g in group]
            median = statistics.median(values)
            if median == 0:
                continue
            for g in group:
                if g[field] < median * 0.4 and g[field] < median - 3:
                    layer2_flags.append({
                        "code": g["code"], "strategy": strategy, "field": field,
                        "value": g[field], "strategy_median": median,
                    })

    # Build report
    out_path = yml_dir / "_AUDIT_REPORT.md"
    lines = [
        "# YML 內容覆蓋率稽核報告",
        "",
        f"- 資料夾: `{yml_dir.relative_to(REPO)}`",
        f"- 課數: {len(all_records)}",
        f"- Layer 1 紅旗（原文有但 yml 漏抓 / 漏抓 ≥40%）: **{len(layer1_flags)}**",
        f"- Layer 2 outlier（同策略同類偏離 >60% median）: **{len(layer2_flags)}**",
        f"- Layer 3 schema 缺件: **{len(layer3_flags)}**",
        "",
    ]

    # Layer 1 detail
    lines.append("## Layer 1 — 原文 vs yml 差距（紅旗）")
    lines.append("")
    if not layer1_flags:
        lines.append("(無紅旗)")
    else:
        # Group by code
        by_code: dict[str, list] = defaultdict(list)
        for fl in layer1_flags:
            by_code[fl["code"]].append(fl)
        # Sort by severity (count of issues per lesson)
        for code in sorted(by_code.keys(), key=lambda c: -len(by_code[c])):
            issues = by_code[code]
            lines.append(f"### {code} ({len(issues)} 紅旗)")
            for i in issues:
                if i["type"] == "undercount":
                    lines.append(f"- **{i['field']}**: 原文 {i['raw']} 個 → yml {i['yml']} 個 ({int(i['ratio']*100)}%)")
                elif i["type"] == "missing_section":
                    lines.append(f"- **{i['field']}**: 原文有，yml 完全沒抓")
                elif i["type"] == "no_docx_source":
                    lines.append(f"- ⚠️ {i['msg']}")
            lines.append("")

    # Layer 2 detail
    lines.append("## Layer 2 — 同策略 outlier（內容明顯比同類少）")
    lines.append("")
    if not layer2_flags:
        lines.append("(無 outlier)")
    else:
        lines.append("| 課 | 策略 | 欄位 | 此課 | 同類中位數 |")
        lines.append("|---|---|---|---:|---:|")
        for fl in sorted(layer2_flags, key=lambda x: x["code"]):
            lines.append(f"| {fl['code']} | {fl['strategy']} | {fl['field']} | {fl['value']} | {fl['strategy_median']} |")
    lines.append("")

    # Layer 3 detail
    lines.append("## Layer 3 — 必要 section 缺件")
    lines.append("")
    if not layer3_flags:
        lines.append("(全部 section 齊備)")
    else:
        for fl in layer3_flags:
            lines.append(f"- **{fl['code']}** ({fl['strategy']}): missing `{fl['missing_required']}`")
    lines.append("")

    # Per-strategy summary stats
    lines.append("## 分策略統計（中位數）")
    lines.append("")
    lines.append("| 策略 | 課數 | spotlight字數 | 填空 | MCQ | vocab_bank | vocab_def |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|")
    for strategy, group in sorted(by_strategy.items()):
        if len(group) < 1:
            continue
        med = lambda f: int(statistics.median([g[f] for g in group]))
        lines.append(
            f"| {strategy} | {len(group)} | {med('spotlight_chars')} | "
            f"{med('fill_in_blank')} | {med('mcq')} | {med('vocab_bank')} | {med('vocab_def')} |"
        )

    out_path.write_text("\n".join(lines), encoding="utf-8")

    print(f"Layer 1 紅旗: {len(layer1_flags)}")
    print(f"Layer 2 outliers: {len(layer2_flags)}")
    print(f"Layer 3 schema 缺件: {len(layer3_flags)}")
    print()
    print(f"Report: {out_path}")


if __name__ == "__main__":
    main()
