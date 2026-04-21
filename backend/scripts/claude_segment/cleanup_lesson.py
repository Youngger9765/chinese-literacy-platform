#!/usr/bin/env python3
"""Cleanup pass after audit.

1. For sentences not ending with terminator (。！？」』）】》): append 。
   Exception: 冒號 `：` stays (per Rule D). But bare character endings (e.g. "二、書名意義") get 。.
2. Strip review_note from sentences ≤ 40 non-punct chars (spurious).
3. Recount length fields.
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


def cleanup(lid: int) -> dict:
    stem = f"L{lid:02d}"
    f = V2_DIR / f"{stem}.opus.v2.json"
    d = json.loads(f.read_text(encoding="utf-8"))
    changes = {"terminator_added": 0, "review_note_stripped": 0, "length_recounted": 0}

    for p in d["paragraphs"]:
        for s in p["sentences"]:
            t = s["text"]
            if t and t[-1] == "：":
                # Sentence ends with 冒號 → list intro with items in subsequent sentences.
                # Replace ： → 。 (Rule D). If there were items in same sentence, ： wouldn't be last.
                s["text"] = t[:-1] + "。"
                changes["terminator_added"] += 1
            elif t and t[-1] not in TERMINATORS:
                # Bare ending (e.g. "二、書名意義") → append 。
                s["text"] = t + "。"
                changes["terminator_added"] += 1

            # Recount length
            new_len = nplen(s["text"])
            if s.get("length") != new_len:
                s["length"] = new_len
                changes["length_recounted"] += 1

            # Strip spurious review_note
            if s.get("review_note") and new_len <= 40:
                del s["review_note"]
                changes["review_note_stripped"] += 1

    f.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"lesson_id": lid, "changes": changes}


if __name__ == "__main__":
    lid = int(sys.argv[1])
    print(json.dumps(cleanup(lid), ensure_ascii=False, indent=2))
