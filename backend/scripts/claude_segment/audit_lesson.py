#!/usr/bin/env python3
"""Audit one lesson's segmentation output.

Checks:
- All sentences have idx, text, length, reasoning
- length == non-punct char count (recomputes & fixes if drifted)
- Sentences > 40 non-punct: flag; if no review_note present, auto-attempt comma-split
- Rule D: no sentence ends with ，、；：
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
V2_DIR = ROOT / "backend" / "data" / "segmentation-v2"

PUNCT = set("，。！？；：、「」『』（）【】《》〈〉—…·\"'\u201c\u201d\u2018\u2019")
TERMINATORS = set("。！？」』）】》")


def nplen(s: str) -> int:
    return sum(1 for c in s if c not in PUNCT)


def try_split_at_comma(text: str) -> list[str] | None:
    """Try to split text at a comma, producing 2 parts each 10-40 non-punct chars.
    Uses last comma whose split yields first >= 15 non-punct."""
    candidates = []
    for i, c in enumerate(text):
        if c in "，；":
            left = text[:i] + "。"
            right = text[i + 1:]
            ll, rl = nplen(left), nplen(right)
            if 10 <= ll <= 40 and 10 <= rl <= 40 and right[-1] in TERMINATORS:
                candidates.append((i, ll, rl, left, right))
    if not candidates:
        return None
    # Prefer split closest to middle
    candidates.sort(key=lambda x: abs(x[1] - x[2]))
    _, _, _, left, right = candidates[0]
    return [left, right]


def audit(lid: int, autofix: bool = True) -> dict:
    stem = f"L{lid:02d}"
    f = V2_DIR / f"{stem}.opus.v2.json"
    if not f.exists():
        return {"lesson_id": lid, "status": "missing", "path": str(f)}

    d = json.loads(f.read_text(encoding="utf-8"))
    issues: list[dict] = []
    fixes = 0
    over40 = 0
    auto_splits = 0

    for p in d["paragraphs"]:
        pidx = p["paragraph_idx"]
        new_sents: list[dict] = []
        for s in p["sentences"]:
            text = s["text"]
            actual = nplen(text)
            # Fix length drift
            if s.get("length") != actual:
                s["length"] = actual
                fixes += 1

            # Rule D check
            if text and text[-1] not in TERMINATORS:
                issues.append({"p": pidx, "s": s["idx"], "issue": f"D: ends with '{text[-1]}'"})

            if actual > 40:
                over40 += 1
                if autofix:
                    parts = try_split_at_comma(text)
                    if parts:
                        auto_splits += 1
                        base_reason = s.get("reasoning", "")
                        for part in parts:
                            new_sents.append({
                                "idx": 0,
                                "text": part,
                                "length": nplen(part),
                                "reasoning": base_reason + " [auto-split at comma by audit]",
                            })
                        continue
                    else:
                        # Unsplittable → keep/add review_note
                        if not s.get("review_note"):
                            s["review_note"] = f"{actual}非標點字。原因：無法在逗號處拆分成兩段 10-40 字子句。"
                        issues.append({"p": pidx, "s": s["idx"], "issue": f"over40_unsplittable ({actual})"})
                elif not s.get("review_note"):
                    issues.append({"p": pidx, "s": s["idx"], "issue": f"over40 ({actual})"})
            new_sents.append(s)

        # Renumber
        for i, s in enumerate(new_sents):
            s["idx"] = i
        p["sentences"] = new_sents

    if fixes or auto_splits:
        f.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "lesson_id": lid,
        "title": d.get("title", ""),
        "total_sentences": sum(len(p["sentences"]) for p in d["paragraphs"]),
        "length_fixes": fixes,
        "over40_count": over40,
        "auto_splits": auto_splits,
        "issues": issues,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: audit_lesson.py <lesson_id> [--no-autofix]", file=sys.stderr)
        sys.exit(1)
    lid = int(sys.argv[1])
    autofix = "--no-autofix" not in sys.argv
    r = audit(lid, autofix=autofix)
    print(json.dumps(r, ensure_ascii=False, indent=2))
