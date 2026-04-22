#!/usr/bin/env python3
"""Full inspection of a single lesson's v2+validated output.

Prints a concise audit report:
- Per-paragraph sentence list with length
- Hard rule violation count (must be 0)
- Length anomalies (< 10 or > 50 chars — flag for human review)
- Reasoning quality check (reasoning says "合併" but sentence is standalone = flag)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VALIDATED_DIR = ROOT / "backend" / "data" / "segmentation-v2-fixed"
V2_DIR = ROOT / "backend" / "data" / "segmentation-v2"


def inspect(lesson_id: int) -> dict:
    stem = f"L{lesson_id:02d}"
    validated = VALIDATED_DIR / f"{stem}.validated.json"
    v2 = V2_DIR / f"{stem}.v2.json"

    if not validated.exists():
        print(f"❌ Missing: {validated}", file=sys.stderr)
        return {"status": "missing"}

    d = json.loads(validated.read_text(encoding="utf-8"))
    v2_raw = json.loads(v2.read_text(encoding="utf-8")) if v2.exists() else None

    print(f"\n{'='*60}")
    print(f"L{lesson_id:02d} — {d.get('title', '?')}")
    print(f"{'='*60}")

    summary = d["summary"]
    print(f"Sentences: {summary['total_sentences_before']} → {summary['total_sentences_after']}")
    print(f"Violations: {summary['violations_before']} → {summary['violations_after']}")
    print(f"Auto-fixes: {summary['auto_fixes_applied']}")
    print()

    anomalies: list[str] = []
    reasoning_flags: list[str] = []
    length_dist: list[int] = []

    for p in d["paragraphs"]:
        pidx = p["paragraph_idx"]
        plen = p["paragraph_length"]
        sents = p["sentences_after"]
        print(f"p{pidx} ({plen}字) → {len(sents)}句:")
        for s in sents:
            ln = s["length"]
            length_dist.append(ln)
            marker = "  "
            if ln < 10:
                marker = "⚠ "
                anomalies.append(f"p{pidx}s{s['idx']}: {ln}字 太短")
            elif ln > 50:
                marker = "⚠ "
                anomalies.append(f"p{pidx}s{s['idx']}: {ln}字 太長")
            fix_note = f" [auto-fixed]" if s.get("fixes") else ""
            print(f"  {marker}[{ln:2d}] {s['text']}{fix_note}")
        print()

    if v2_raw:
        for p in v2_raw["paragraphs"]:
            for s in p.get("sentences", []):
                reason = s.get("reasoning", "")
                if "合併" in reason or "應該合" in reason or "merge" in reason.lower():
                    if s["text"] and s["text"] in [ss["text"] for pp in d["paragraphs"] for ss in pp["sentences_after"]]:
                        pass
                    else:
                        reasoning_flags.append(f"L{lesson_id:02d} p{p['paragraph_idx']} s{s['idx']}: reasoning提合併 → {reason[:40]}")

    print("-" * 60)
    print("CHECK RESULTS:")
    hard_pass = summary["violations_after"] == 0
    print(f"  Hard rules (硬規則): {'✓ PASS' if hard_pass else '✗ FAIL'}")
    print(f"  Length anomalies: {len(anomalies)}")
    if anomalies:
        for a in anomalies[:5]:
            print(f"    • {a}")
        if len(anomalies) > 5:
            print(f"    ... (+{len(anomalies)-5} more)")
    if length_dist:
        print(f"  Length stats: min={min(length_dist)} max={max(length_dist)} avg={sum(length_dist)//len(length_dist)}")

    overall_pass = hard_pass and len(anomalies) == 0
    print(f"\n  OVERALL: {'✓ CLEAN — next lesson OK' if overall_pass else '⚠ REVIEW NEEDED'}")

    return {
        "status": "pass" if overall_pass else "review",
        "lesson_id": lesson_id,
        "title": d.get("title", ""),
        "total_sentences": summary["total_sentences_after"],
        "violations_after": summary["violations_after"],
        "anomalies": anomalies,
        "length_dist": {
            "min": min(length_dist) if length_dist else 0,
            "max": max(length_dist) if length_dist else 0,
            "avg": sum(length_dist) // len(length_dist) if length_dist else 0,
        },
    }


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: inspect_lesson.py <lesson_id>", file=sys.stderr)
        sys.exit(1)
    inspect(int(sys.argv[1]))


if __name__ == "__main__":
    main()
