#!/usr/bin/env python3
"""Flatten v2 segmentation → sentence-level JSONL for TTS pipeline.

Priority: .opus.v2.json (if exists) > .validated.json (gemini + auto-fix).
Output: backend/data/sentences.jsonl, one line per sentence.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OPUS_DIR = ROOT / "backend" / "data" / "segmentation-v2"
VAL_DIR = ROOT / "backend" / "data" / "segmentation-v2-fixed"
OUT = ROOT / "backend" / "data" / "sentences.jsonl"

PUNCT = set("，。！？；：、「」『』（）【】《》〈〉—…·~—─")
STAGE_DIRECTION = re.compile(r"^（[^（）]*）。?$")


def canonical_length(text: str) -> int:
    return sum(1 for c in text if c not in PUNCT)


def is_stage_direction(text: str) -> bool:
    """Pure parenthetical notes (author asides, e.g. 『（就是先生對太太的口吻）。』)
    aren't meant to be read aloud. TTS models refuse them anyway. Skip."""
    return bool(STAGE_DIRECTION.match(text.strip()))


def load_paragraphs(lid: int):
    opus_file = OPUS_DIR / f"L{lid:02d}.opus.v2.json"
    val_file = VAL_DIR / f"L{lid:02d}.validated.json"

    if opus_file.exists():
        obj = json.loads(opus_file.read_text())
        source = "opus"
        paras = [(p["paragraph_idx"], p["sentences"]) for p in obj["paragraphs"]]
    elif val_file.exists():
        obj = json.loads(val_file.read_text())
        source = "gemini+validated"
        paras = [(p["paragraph_idx"], p["sentences_after"]) for p in obj["paragraphs"]]
    else:
        return None, None, None

    return obj.get("title", ""), source, paras


def main():
    lines = []
    summary = []
    for lid in range(1, 59):
        if lid == 57:
            continue  # L57 does not exist in source curriculum
        title, source, paras = load_paragraphs(lid)
        if paras is None:
            summary.append((lid, "MISSING", 0))
            continue
        count = 0
        skipped = 0
        for pidx, sents in paras:
            for s in sents:
                if is_stage_direction(s["text"]):
                    skipped += 1
                    continue
                rec = {
                    "lesson_id": lid,
                    "paragraph_idx": pidx,
                    "sentence_idx": s["idx"],
                    "text": s["text"],
                    "length": canonical_length(s["text"]),
                    "reasoning": s.get("reasoning", ""),
                    "segmenter_source": source,
                }
                if s.get("review_note"):
                    rec["review_note"] = s["review_note"]
                lines.append(json.dumps(rec, ensure_ascii=False))
                count += 1
        summary.append((lid, source, count))

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"{'LID':>4} {'source':<20} {'sents':>6}")
    total = 0
    for lid, source, count in summary:
        print(f"{lid:>4} {source:<20} {count:>6}")
        total += count
    print(f"\n[done] {len(summary)} lessons, {total} sentences → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
