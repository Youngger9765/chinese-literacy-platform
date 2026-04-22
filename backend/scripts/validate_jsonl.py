#!/usr/bin/env python3
"""Validate backend/data/sentences.jsonl for correctness.

Checks:
- JSON parseable per line
- Required fields present
- Length field matches non-punct char count
- No empty text
- Rule A: bracket pairs balanced within each sentence
- Rule D: sentence ends with proper terminator (。！？」』）…)
- Coverage: lessons present, sentence counts per lesson
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[2]
JSONL = ROOT / "backend" / "data" / "sentences.jsonl"

PUNCT = set("，。！？；：、「」『』（）【】《》〈〉—…·~—─")  # canonical set (matches flatten_to_jsonl.py)
OPEN_BRACKETS = {"「": "」", "『": "』", "（": "）", "【": "】", "《": "》", "〈": "〉"}
CLOSE_BRACKETS = set(OPEN_BRACKETS.values())
TERMINATORS = set("。！？…")  # Rule D expected endings (with tolerance for closing brackets after)


def count_non_punct(text: str) -> int:
    return sum(1 for c in text if c not in PUNCT)


def check_brackets(text: str) -> str | None:
    stack = []
    for c in text:
        if c in OPEN_BRACKETS:
            stack.append(OPEN_BRACKETS[c])
        elif c in CLOSE_BRACKETS:
            if not stack or stack[-1] != c:
                return f"bracket mismatch near {c!r}"
            stack.pop()
    if stack:
        return f"unclosed bracket(s): {stack}"
    return None


def check_terminator(text: str) -> str | None:
    if not text:
        return "empty"
    # Strip trailing closing brackets, then check last char is a terminator
    stripped = text.rstrip("」』）】》〉")
    if not stripped:
        return "all closing brackets"
    last = stripped[-1]
    if last not in TERMINATORS and last != "—":
        return f"bad terminator {last!r}"
    return None


def main():
    errors: list[tuple[int, str, str]] = []
    per_lesson = defaultdict(int)
    per_source = defaultdict(int)
    length_mismatches = 0
    over_40 = []

    with JSONL.open() as f:
        for lineno, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as e:
                errors.append((lineno, "parse", str(e)))
                continue

            # Required fields
            for k in ("lesson_id", "paragraph_idx", "sentence_idx", "text", "length", "segmenter_source"):
                if k not in rec:
                    errors.append((lineno, "missing-field", k))

            text = rec.get("text", "")
            if not text:
                errors.append((lineno, "empty-text", ""))
                continue

            # Length check
            actual = count_non_punct(text)
            claimed = rec.get("length", -1)
            if actual != claimed:
                length_mismatches += 1
                if length_mismatches <= 10:
                    errors.append((lineno, "length-mismatch", f"L{rec['lesson_id']} claimed={claimed} actual={actual} text={text[:30]}"))

            # Rule A: brackets
            br_err = check_brackets(text)
            if br_err:
                errors.append((lineno, "rule-A", f"L{rec['lesson_id']} {br_err}: {text}"))

            # Rule D: terminator
            term_err = check_terminator(text)
            if term_err:
                errors.append((lineno, "rule-D", f"L{rec['lesson_id']} {term_err}: {text}"))

            # Over hard-max 40 — must carry review_note per v2 spec
            if actual > 40:
                over_40.append((lineno, rec["lesson_id"], actual, text[:40]))
                if "review_note" not in rec:
                    errors.append((lineno, "missing-review-note", f"L{rec['lesson_id']} {actual}字 over-40 without review_note: {text[:40]}"))

            per_lesson[rec["lesson_id"]] += 1
            per_source[rec.get("segmenter_source", "?")] += 1

    print(f"Total sentences: {sum(per_lesson.values())}")
    print(f"Lessons present: {sorted(per_lesson.keys())}")
    print(f"By source: {dict(per_source)}")
    print(f"Length mismatches: {length_mismatches}")
    print(f"Sentences > 40 chars: {len(over_40)}")

    # Missing lessons (L57 does not exist in source curriculum — true gap)
    expected = set(range(1, 58)) - {57}
    missing = expected - set(per_lesson.keys())
    if missing:
        print(f"MISSING lessons: {sorted(missing)}")

    if errors:
        print(f"\n--- {len(errors)} issue(s) (first 30) ---")
        for lineno, kind, msg in errors[:30]:
            print(f"  line {lineno} [{kind}] {msg}")
    else:
        print("\nNo structural errors.")

    if over_40:
        print(f"\n--- Over 40-char sentences (first 10) ---")
        for lineno, lid, n, preview in over_40[:10]:
            print(f"  line {lineno} L{lid} {n}字: {preview}")


if __name__ == "__main__":
    main()
