#!/usr/bin/env python3
"""Rebuild spotlight YAML for specific lessons after parser fixes."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from batch_all_lessons import discover_lessons  # noqa: E402
from build_lesson_schema import process_lesson  # noqa: E402

BATCH2_LESSONS = (
    "G4-L4",
    "G4-L24",
    "G4-L27",
    "G5-L3",
    "G5-L22",
    "G6-L18",
    "G7-L10",
    "G7-L11",
    "G7-L23",
    "G7-L24",
    "G7-L25",
    "G8-L3",
    "G8-L19",
    "G9-L8",
    "G9-L11",
    "G9-L12",
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        default=str(ROOT / "private/curriculum-source/_online-schema"),
    )
    parser.add_argument("lesson_ids", nargs="*", help="Defaults to batch2 16 lessons")
    args = parser.parse_args()

    docx_map = dict(discover_lessons())
    targets = args.lesson_ids or list(BATCH2_LESSONS)
    ok = 0
    for lid in targets:
        docx = docx_map.get(lid)
        if not docx:
            print(f"SKIP {lid}: no docx")
            continue
        process_lesson(lid, str(docx), args.output_dir)
        ok += 1
        print(f"OK {lid}")
    print(f"\nrebuilt {ok}/{len(targets)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
