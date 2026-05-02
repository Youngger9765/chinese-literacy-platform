#!/usr/bin/env python3
"""
audit_polyphonic.py — Phase 1 audit: polyphonic character occurrences in lesson YAMLs.

AUDIT ONLY — read-only, no lesson files modified, no external API calls.

Usage:
    python3 backend/scripts/audit_polyphonic.py

Outputs:
    backend/data/audit/polyphonic-audit.json   — summary + needs-review list
    (all_occurrences omitted to keep file size small; re-run with --full for raw dump)

Issue: #1353 — 破音字 AI 標注校正 audit + 校正 pipeline
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
LESSONS_DIR = REPO_ROOT / "backend" / "data" / "lessons"
POYIN_DB_PATH = REPO_ROOT / "frontend" / "public" / "data" / "poyin_db.json"
OUTPUT_DIR = REPO_ROOT / "backend" / "data" / "audit"
OUTPUT_PATH = OUTPUT_DIR / "polyphonic-audit.json"

# High-priority chars: common in elementary texts AND known to have pronunciation errors
HIGH_PRIORITY: set[str] = {
    "喝", "行", "重", "著", "得", "地", "的", "長", "大", "說",
    "數", "中", "好", "看", "分", "樂", "還", "調", "傳", "空",
    "假", "難", "當", "應", "降", "興", "便", "轉", "種", "盛", "覺",
}


def load_poyin_db() -> dict[str, dict]:
    if not POYIN_DB_PATH.exists():
        sys.exit(f"ERROR: poyin_db.json not found at {POYIN_DB_PATH}")
    with POYIN_DB_PATH.open(encoding="utf-8") as f:
        return json.load(f).get("data", {})


def load_lessons() -> list[dict]:
    lessons = []
    for path in sorted(LESSONS_DIR.glob("*.yml")):
        with path.open(encoding="utf-8") as f:
            data = yaml.safe_load(f)
        data["_file"] = path.name
        lessons.append(data)
    return lessons


def is_chinese(c: str) -> bool:
    return bool(c) and "一" <= c <= "龥"


def pattern_match(char: str, idx: int, chars: list[str], patterns: list[str]) -> tuple[int, bool]:
    """
    Simplified context-based pattern match. Returns (matched_variant_idx, is_ambiguous).
    Replicates core logic of polyphonicProcessor.ts match().
    Returns (-1, True) when no explicit pattern matches and char has >1 pronunciation.
    """
    if len(patterns) <= 1:
        return 0, False

    prev = chars[idx - 1] if idx > 0 else ""
    nxt = chars[idx + 1] if idx + 1 < len(chars) else ""
    is_first = not prev or not is_chinese(prev)
    is_last = not nxt or not is_chinese(nxt)

    if is_first and is_last:
        return 0, False  # standalone — unambiguous default

    # Special: 地/喝 context is well-known but hard to fully replicate offline
    if char in ("地", "喝"):
        ctx2 = char + nxt
        if ctx2 in ("喝采", "喝彩"):
            return 1, False  # confirmed hè
        return -1, True  # needs review

    for j, combined in enumerate(patterns):
        for pat in combined.split("/"):
            if not pat or "*" not in pat:
                continue
            wpos = pat.index("*")
            filled = pat.replace("*", char)
            start = idx - wpos
            end = start + len(pat)
            if start < 0 or end > len(chars):
                continue
            if "".join(chars[start:end]) == filled:
                return j, False  # explicit match

    return -1, True  # no match — ambiguous


def audit_lesson(lesson: dict, db: dict[str, dict]) -> list[dict]:
    num = lesson.get("lesson_number", lesson["_file"])
    lid = f"L{num:02d}" if isinstance(num, int) else str(num)
    title = lesson.get("title", "")
    text = lesson.get("story_text", "")
    if not text:
        return []

    chars = list(text)
    results = []
    for i, c in enumerate(chars):
        if c not in HIGH_PRIORITY or c not in db:
            continue
        entry = db[c]
        patterns = [str(p) for p in entry.get("v", [])]
        if len(patterns) <= 1 and entry.get("s", 1) <= 1:
            continue

        matched_idx, is_ambiguous = pattern_match(c, i, chars, patterns)

        start = max(0, i - 5)
        end = min(len(chars), i + 6)
        ctx = "".join(chars[start:end])
        rel = i - start
        ctx_marked = ctx[:rel] + f"[{c}]" + ctx[rel + 1:]

        results.append({
            "lesson_id": lid,
            "lesson_title": title,
            "char": c,
            "context": ctx_marked,
            "variant_count": len(patterns) or entry.get("s", 1),
            "matched_variant_index": matched_idx,
            "needs_human_review": is_ambiguous,
            "priority": "high" if c in {"喝", "行", "重", "著", "得", "長", "說"} else "normal",
            "tts_corrected": c == "喝",
        })
    return results


def run() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    db = load_poyin_db()
    target = {c for c in HIGH_PRIORITY if c in db and ("v" in db[c] or db[c].get("s", 1) > 1)}
    lessons = load_lessons()

    all_occs: list[dict] = []
    for lesson in lessons:
        all_occs.extend(audit_lesson(lesson, db))

    by_char: dict[str, int] = {}
    by_lesson: dict[str, int] = {}
    needs_review: list[dict] = []

    for o in all_occs:
        by_char[o["char"]] = by_char.get(o["char"], 0) + 1
        by_lesson[o["lesson_id"]] = by_lesson.get(o["lesson_id"], 0) + 1
        if o["needs_human_review"]:
            needs_review.append(o)

    by_char = dict(sorted(by_char.items(), key=lambda x: -x[1]))
    by_lesson = dict(sorted(by_lesson.items(), key=lambda x: -x[1]))

    # Deduplicate needs_review: keep first occurrence per (lesson, char, context) for brevity
    seen: set[tuple] = set()
    deduped_review: list[dict] = []
    for o in needs_review:
        key = (o["lesson_id"], o["char"], o["context"])
        if key not in seen:
            seen.add(key)
            deduped_review.append(o)

    output = {
        "audited_at": str(date.today()),
        "total_lessons": len(lessons),
        "target_chars_audited": sorted(target),
        "total_occurrences": len(all_occs),
        "needs_human_review_count": len(needs_review),
        "tts_already_corrected_count": sum(1 for o in all_occs if o["tts_corrected"]),
        "summary": {
            "by_char": by_char,
            "by_lesson": by_lesson,
            "top10_chars": list(by_char)[:10],
            "top10_lessons": list(by_lesson)[:10],
        },
        "needs_human_review_sample": deduped_review[:200],  # first 200 unique for review
    }

    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Audited {len(lessons)} lessons | {len(all_occs)} occurrences | {len(needs_review)} need review")
    print(f"Top chars: {list(by_char)[:10]}")
    print(f"Written to {OUTPUT_PATH}")


if __name__ == "__main__":
    run()
