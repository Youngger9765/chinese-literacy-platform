#!/usr/bin/env python3
"""Tag over-40-char sentences with review_note.

Rule from v2 spec: ideal 15-35 chars, hard max 40. Sentences over 40 chars
are allowed when semantically indivisible (dialogue/quotes), but must carry
a review_note so downstream reviewers can spot-check.

This script scans both opus.v2.json and validated.json files, tags any
sentence > 40 non-punct chars with review_note if missing, and leaves
existing review_notes untouched.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OPUS_DIR = ROOT / "backend" / "data" / "segmentation-v2"
VAL_DIR = ROOT / "backend" / "data" / "segmentation-v2-fixed"

PUNCT = set("，。！？；：、「」『』（）【】《》〈〉—…·~—─")


def count_np(text: str) -> int:
    return sum(1 for c in text if c not in PUNCT)


def can_split_at_comma(text: str) -> int | None:
    """Return position of best comma split, or None if no safe split.

    Safe = both halves ≥10 non-punct chars AND balanced brackets.
    """
    positions = []
    depth = 0
    for i, c in enumerate(text):
        if c in "「『（【《〈":
            depth += 1
        elif c in "」』）】》〉":
            depth -= 1
        elif c == "，" and depth == 0:
            positions.append(i)
    if not positions:
        return None
    # pick the position closest to the middle that yields both halves ≥ 10
    mid = len(text) // 2
    positions.sort(key=lambda p: abs(p - mid))
    for p in positions:
        left = text[:p]
        right = text[p + 1 :]
        if count_np(left) >= 10 and count_np(right) >= 10:
            return p
    return None


def tag_sentences(sents: list, fmt: str) -> int:
    """Tag over-40 sentences with review_note. Returns count added."""
    added = 0
    for s in sents:
        t = s["text"]
        n = count_np(t)
        if n <= 40:
            continue
        if "review_note" in s:
            continue
        # Try to find a comma split point
        split_pos = can_split_at_comma(t)
        if split_pos is not None:
            note = f"over-40 ({n}字), splittable at pos {split_pos} if desired"
        else:
            note = f"over-40 ({n}字), no safe split (brackets/short-halves)"
        s["review_note"] = note
        added += 1
    return added


def process_opus(path: Path) -> int:
    obj = json.loads(path.read_text())
    total = 0
    for p in obj["paragraphs"]:
        total += tag_sentences(p["sentences"], "opus")
    if total:
        path.write_text(json.dumps(obj, ensure_ascii=False, indent=2))
    return total


def process_val(path: Path) -> int:
    obj = json.loads(path.read_text())
    total = 0
    for p in obj["paragraphs"]:
        sents = p.get("sentences_after") or p.get("sentences", [])
        total += tag_sentences(sents, "val")
    if total:
        path.write_text(json.dumps(obj, ensure_ascii=False, indent=2))
    return total


def main():
    opus_total = 0
    for f in sorted(OPUS_DIR.glob("L*.opus.v2.json")):
        n = process_opus(f)
        if n:
            opus_total += n
            print(f"{f.name}: tagged {n}")

    val_total = 0
    for f in sorted(VAL_DIR.glob("L*.validated.json")):
        if "opus.validated" in f.name:
            continue
        n = process_val(f)
        if n:
            val_total += n
            print(f"{f.name}: tagged {n}")

    print(f"\nTotal tagged: opus={opus_total}, val={val_total}")


if __name__ == "__main__":
    main()
