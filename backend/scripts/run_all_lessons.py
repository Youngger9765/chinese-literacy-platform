#!/usr/bin/env python3
"""Batch: segment + validate + inspect all lessons.

For each lesson L01..L57:
1. Call Gemini segmentation (llm_segment_paragraph)
2. Run validator (deterministic auto-fix)
3. Inspect output + flag anomalies

Writes a summary table at the end. Does NOT re-run lessons that already have
a validated output unless --force is passed.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LESSONS_DIR = ROOT / "backend" / "data" / "lessons"
V2_DIR = ROOT / "backend" / "data" / "segmentation-v2"
VALIDATED_DIR = ROOT / "backend" / "data" / "segmentation-v2-fixed"
SEGMENT_SCRIPT = Path(__file__).parent / "llm_segment_paragraph.py"
VALIDATE_SCRIPT = Path(__file__).parent / "validate_segmentation.py"


def lesson_ids() -> list[int]:
    ids: list[int] = []
    for lp in sorted(LESSONS_DIR.glob("L*.yml")):
        stem = lp.stem
        if stem.startswith("L") and stem[1:].isdigit():
            ids.append(int(stem[1:]))
    return ids


def run_lesson(lid: int, force: bool) -> dict:
    stem = f"L{lid:02d}"
    v2_file = V2_DIR / f"{stem}.v2.json"
    validated_file = VALIDATED_DIR / f"{stem}.validated.json"

    if v2_file.exists() and validated_file.exists() and not force:
        print(f"[{stem}] cached, skipping segmentation", file=sys.stderr)
    else:
        print(f"[{stem}] segmenting...", file=sys.stderr)
        r = subprocess.run(
            [sys.executable, str(SEGMENT_SCRIPT), "--lesson", str(lid)],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            print(f"[{stem}] segment FAILED", file=sys.stderr)
            print(r.stderr, file=sys.stderr)
            return {"lesson_id": lid, "status": "segment_failed", "error": r.stderr[-500:]}

    print(f"[{stem}] validating...", file=sys.stderr)
    r = subprocess.run(
        [sys.executable, str(VALIDATE_SCRIPT), "--input", f"{stem}.v2.json"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        return {"lesson_id": lid, "status": "validate_failed", "error": r.stderr[-500:]}

    d = json.loads(validated_file.read_text(encoding="utf-8"))
    summary = d["summary"]

    anomalies: list[dict] = []
    length_dist: list[int] = []
    for p in d["paragraphs"]:
        for s in p["sentences_after"]:
            length_dist.append(s["length"])
            if s["length"] < 10:
                anomalies.append({"p": p["paragraph_idx"], "s": s["idx"], "issue": f"{s['length']}字太短", "text": s["text"]})
            elif s["length"] > 50:
                anomalies.append({"p": p["paragraph_idx"], "s": s["idx"], "issue": f"{s['length']}字太長", "text": s["text"]})

    hard_pass = summary["violations_after"] == 0
    overall_pass = hard_pass and len(anomalies) == 0

    return {
        "lesson_id": lid,
        "title": d.get("title", ""),
        "status": "pass" if overall_pass else ("hard_fail" if not hard_pass else "anomalies"),
        "sentences_before": summary["total_sentences_before"],
        "sentences_after": summary["total_sentences_after"],
        "violations_before": summary["violations_before"],
        "violations_after": summary["violations_after"],
        "auto_fixes": summary["auto_fixes_applied"],
        "anomalies": anomalies,
        "len_min": min(length_dist) if length_dist else 0,
        "len_max": max(length_dist) if length_dist else 0,
        "len_avg": sum(length_dist) // len(length_dist) if length_dist else 0,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="Re-run even if cached")
    ap.add_argument("--start", type=int, default=1)
    ap.add_argument("--end", type=int, default=None)
    args = ap.parse_args()

    V2_DIR.mkdir(parents=True, exist_ok=True)
    VALIDATED_DIR.mkdir(parents=True, exist_ok=True)

    ids = lesson_ids()
    if args.end:
        ids = [i for i in ids if args.start <= i <= args.end]
    else:
        ids = [i for i in ids if i >= args.start]

    results: list[dict] = []
    for lid in ids:
        res = run_lesson(lid, args.force)
        results.append(res)

    out = ROOT / "backend" / "data" / "segmentation-v2-report.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n" + "=" * 80)
    print(f"{'Lesson':<8} {'Status':<12} {'B→A':<10} {'Viol':<8} {'Fix':<5} {'Anom':<6} {'Len min-max-avg':<18} {'Title'}")
    print("-" * 80)
    pass_count = 0
    hard_fail_count = 0
    anom_count = 0
    for r in results:
        if r.get("status") == "pass":
            pass_count += 1
            icon = "✓"
        elif r.get("status") == "hard_fail":
            hard_fail_count += 1
            icon = "✗"
        else:
            anom_count += 1
            icon = "⚠"
        b_a = f"{r.get('sentences_before', '?')}→{r.get('sentences_after', '?')}"
        len_str = f"{r.get('len_min','?')}-{r.get('len_max','?')}-{r.get('len_avg','?')}"
        print(f"L{r['lesson_id']:02d}     {icon} {r.get('status','?'):<10} {b_a:<10} "
              f"{r.get('violations_after','?'):<8} {r.get('auto_fixes','?'):<5} "
              f"{len(r.get('anomalies', [])):<6} {len_str:<18} {r.get('title', '')}")

    print("=" * 80)
    print(f"PASS: {pass_count} | HARD_FAIL: {hard_fail_count} | ANOMALIES: {anom_count} | TOTAL: {len(results)}")
    print(f"Report: {out}")


if __name__ == "__main__":
    main()
