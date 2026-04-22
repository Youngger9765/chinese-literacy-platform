#!/usr/bin/env python3
"""Validator + auto-fixer for v2 segmentation output.

Runs deterministic rule checks on LLM-generated sentences:
- Rule A: bracket pairs must be within same sentence
- Rule D: every sentence must end with 。！？」』） — not ，、；：
- Rule E: sentences < 10 chars must merge if paragraph is ≥ 20 chars
- Orphan close bracket: sentence starting with 」』 must merge into previous

Auto-fix strategy (deterministic, no LLM retry needed):
1. If sentence ends with ，、；： → merge with next
2. If sentence has unbalanced 「 (open without close) → merge with next
3. If sentence starts with 」』）】 → merge into previous
4. If sentence < 10 chars and prev ends properly → merge into prev

Usage:
    python3 backend/scripts/validate_segmentation.py --input L01.v2.json
    python3 backend/scripts/validate_segmentation.py --all
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IN_DIR = ROOT / "backend" / "data" / "segmentation-v2"
OUT_DIR = ROOT / "backend" / "data" / "segmentation-v2-fixed"

OPENING = set("「『（【《〈")
CLOSING = set("」』）】》〉")
TERMINATORS = set("。！？…")  # U+2026 省略號 is a valid sentence terminator in Chinese writing
NON_TERMINAL = set("，、；：")
PUNCTUATION = OPENING | CLOSING | TERMINATORS | NON_TERMINAL | set("—…·\"'\u201c\u201d\u2018\u2019")
SHORT_THRESHOLD = 10
MIN_PARAGRAPH_FOR_SHORT_CHECK = 20


def char_count(text: str) -> int:
    """Count characters excluding punctuation (標點符號不算字)."""
    return sum(1 for c in text if c not in PUNCTUATION)


def bracket_balance(text: str) -> str:
    stack: list[str] = []
    for ch in text:
        if ch in OPENING:
            stack.append(ch)
        elif ch in CLOSING:
            if stack:
                stack.pop()
            else:
                return "orphan_closing"
    return "orphan_opening" if stack else "ok"


def check_sentence(text: str, para_len: int) -> list[str]:
    """Return list of rule violations for a single sentence."""
    violations: list[str] = []
    if not text:
        violations.append("empty")
        return violations

    last = text[-1]
    if last in NON_TERMINAL:
        violations.append(f"D:ends_with_{last}")
    elif last not in TERMINATORS and last not in CLOSING:
        violations.append(f"D:weird_end_{last}")

    bal = bracket_balance(text)
    if bal != "ok":
        violations.append(f"A:{bal}")

    if text[0] in CLOSING:
        violations.append(f"A:starts_with_{text[0]}")

    if len(text) < SHORT_THRESHOLD and para_len >= MIN_PARAGRAPH_FOR_SHORT_CHECK:
        violations.append(f"E:short_{len(text)}chars")

    return violations


def merge_sentences(sentences: list[dict]) -> tuple[list[dict], list[str]]:
    """Deterministic auto-fix pass. Returns (fixed_sentences, fix_log)."""
    log: list[str] = []
    result: list[dict] = []

    for s in sentences:
        s_copy = copy.deepcopy(s)
        s_copy.setdefault("fixes", [])
        result.append(s_copy)

    def sanitize(items: list[dict]) -> list[dict]:
        out: list[dict] = []
        for i, item in enumerate(items):
            item["idx"] = i
            item["length"] = char_count(item["text"])
            out.append(item)
        return out

    SAFETY_CAP = 20
    changed = True
    safety = 0
    while changed and safety < SAFETY_CAP:
        changed = False
        safety += 1

        for i, s in enumerate(result):
            if s["text"] and s["text"][0] in CLOSING and i > 0:
                log.append(f"merge-back: sentence {i} starts with {s['text'][0]}")
                result[i - 1]["text"] += s["text"]
                result[i - 1]["fixes"].append(f"absorbed_orphan_close_from_idx_{s['idx']}")
                result.pop(i)
                changed = True
                break

        if changed:
            result = sanitize(result)
            continue

        for i, s in enumerate(result):
            if not s["text"]:
                continue
            last = s["text"][-1]
            if last in NON_TERMINAL and i + 1 < len(result):
                log.append(f"merge-forward: sentence {i} ends with {last}")
                result[i]["text"] += result[i + 1]["text"]
                result[i]["fixes"].append(f"merged_next_idx_{result[i+1]['idx']}_rule_D")
                result.pop(i + 1)
                changed = True
                break

        if changed:
            result = sanitize(result)
            continue

        for i, s in enumerate(result):
            if bracket_balance(s["text"]) == "orphan_opening" and i + 1 < len(result):
                log.append(f"merge-forward: sentence {i} has unclosed 「")
                result[i]["text"] += result[i + 1]["text"]
                result[i]["fixes"].append(f"merged_next_idx_{result[i+1]['idx']}_rule_A")
                result.pop(i + 1)
                changed = True
                break

        if changed:
            result = sanitize(result)

    if changed and safety >= SAFETY_CAP:
        raise RuntimeError(
            f"validator did not converge on bracket/terminator pass after {SAFETY_CAP} iterations; "
            f"remaining sentences: {[s['text'] for s in result]}"
        )

    para_len = sum(len(s["text"]) for s in result)
    changed = True
    safety = 0
    while changed and safety < SAFETY_CAP:
        changed = False
        safety += 1
        for i, s in enumerate(result):
            if len(s["text"]) < SHORT_THRESHOLD and para_len >= MIN_PARAGRAPH_FOR_SHORT_CHECK:
                if i > 0:
                    log.append(f"merge-back-short: sentence {i} ({len(s['text'])}字) → prev")
                    result[i - 1]["text"] += s["text"]
                    result[i - 1]["fixes"].append(f"absorbed_short_idx_{s['idx']}_rule_E")
                    result.pop(i)
                elif i + 1 < len(result):
                    log.append(f"merge-forward-short: sentence {i} ({len(s['text'])}字) → next")
                    result[i]["text"] += result[i + 1]["text"]
                    result[i]["fixes"].append(f"merged_next_idx_{result[i+1]['idx']}_rule_E")
                    result.pop(i + 1)
                else:
                    break
                changed = True
                break

        if changed:
            result = sanitize(result)

    if changed and safety >= SAFETY_CAP:
        raise RuntimeError(
            f"validator did not converge on short-sentence pass after {SAFETY_CAP} iterations; "
            f"remaining sentences: {[s['text'] for s in result]}"
        )

    return result, log


def validate_lesson(lesson: dict) -> dict:
    """Run validator on each paragraph's sentences. Returns report with auto-fixed sentences."""
    report = {
        "lesson_id": lesson["lesson_id"],
        "title": lesson.get("title", ""),
        "paragraphs": [],
        "summary": {
            "total_sentences_before": 0,
            "total_sentences_after": 0,
            "violations_before": 0,
            "violations_after": 0,
            "auto_fixes_applied": 0,
        },
    }

    for p in lesson["paragraphs"]:
        para_len = p["paragraph_length"]
        before = p["sentences"]
        violations_before: list[dict] = []
        for s in before:
            v = check_sentence(s["text"], para_len)
            if v:
                violations_before.append({"idx": s["idx"], "text": s["text"], "violations": v})

        after, fix_log = merge_sentences(before)

        violations_after: list[dict] = []
        for s in after:
            v = check_sentence(s["text"], para_len)
            if v:
                violations_after.append({"idx": s["idx"], "text": s["text"], "violations": v})

        report["paragraphs"].append({
            "paragraph_idx": p["paragraph_idx"],
            "paragraph_text": p["paragraph_text"],
            "paragraph_length": para_len,
            "sentences_before": before,
            "sentences_after": after,
            "violations_before": violations_before,
            "violations_after": violations_after,
            "fix_log": fix_log,
        })

        report["summary"]["total_sentences_before"] += len(before)
        report["summary"]["total_sentences_after"] += len(after)
        report["summary"]["violations_before"] += len(violations_before)
        report["summary"]["violations_after"] += len(violations_after)
        report["summary"]["auto_fixes_applied"] += len(fix_log)

    return report


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", type=str, help="Single v2 json file (e.g. L01.v2.json)")
    ap.add_argument("--all", action="store_true", help="Process all segmentation-v2/*.v2.json")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.input:
        files = [IN_DIR / args.input]
    elif args.all:
        files = sorted(IN_DIR.glob("*.v2.json"))
    else:
        ap.error("Pass --input <file> or --all")

    for fp in files:
        if not fp.exists():
            print(f"Skip missing: {fp}", file=sys.stderr)
            continue
        lesson = json.loads(fp.read_text(encoding="utf-8"))
        report = validate_lesson(lesson)

        out = OUT_DIR / fp.name.replace(".v2.json", ".validated.json")
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

        s = report["summary"]
        print(f"{fp.name}: {s['total_sentences_before']}→{s['total_sentences_after']}句 | "
              f"違規 {s['violations_before']}→{s['violations_after']} | "
              f"auto-fix {s['auto_fixes_applied']}")


if __name__ == "__main__":
    main()
