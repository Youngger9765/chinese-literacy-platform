#!/usr/bin/env python3
"""
Filter template/decoration images out of yml `images` lists.

The docx parser extracted ALL embedded media — including generic
decoration icons (open book, pencil, star, etc.) that appear in 100+ lessons.
Frontend image gallery shows these alongside real lesson diagrams.

Heuristic: any image hash appearing in ≥5 lessons is a template/decoration.
Keep only unique-per-lesson images (real lesson diagrams).

Usage:
    python3 scripts/filter_template_images.py [--dry-run] [--threshold N]
"""
from __future__ import annotations
import argparse
from collections import defaultdict
from pathlib import Path

import yaml

REPO = Path("/Users/young/project/chinese-literacy-platform")
PROD_DIR = REPO / "backend/data/lessons/_parsed_2026-05-01"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--threshold", type=int, default=5,
                    help="Hashes appearing in ≥N lessons are filtered (default: 5)")
    args = ap.parse_args()

    # Pass 1: collect hash → lesson count
    hash_count: dict[str, int] = defaultdict(int)
    for f in PROD_DIR.glob("*.yml"):
        if f.name.startswith("_"):
            continue
        d = yaml.safe_load(f.read_text(encoding="utf-8"))
        for img in d.get("images", []) or []:
            hash_count[img["image_hash"]] += 1

    template_hashes = {h for h, n in hash_count.items() if n >= args.threshold}
    print(f"Template hashes (≥{args.threshold} lessons): {len(template_hashes)}")
    print()

    # Pass 2: filter each lesson
    total_filtered = 0
    lessons_changed = 0
    for f in sorted(PROD_DIR.glob("*.yml")):
        if f.name.startswith("_"):
            continue
        d = yaml.safe_load(f.read_text(encoding="utf-8"))
        before = d.get("images") or []
        if not before:
            continue
        after = [img for img in before if img["image_hash"] not in template_hashes]
        if len(after) == len(before):
            continue
        removed = len(before) - len(after)
        total_filtered += removed
        lessons_changed += 1

        d["images"] = after
        d["image_count"] = len(after)

        if args.dry_run:
            print(f"  {f.stem}: {len(before)} → {len(after)} (-{removed})")
        else:
            with f.open("w", encoding="utf-8") as out:
                yaml.dump(d, out, allow_unicode=True, sort_keys=False, width=10**9)
            print(f"  ✓ {f.stem}: {len(before)} → {len(after)}")

    print()
    print(f"{'[DRY RUN] ' if args.dry_run else ''}{lessons_changed} lessons changed, "
          f"{total_filtered} template image entries removed")


if __name__ == "__main__":
    main()
