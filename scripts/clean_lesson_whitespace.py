#!/usr/bin/env python3
"""Strip stray whitespace from paragraph content in lesson YAML files.

Targets (issue #1095):
  - ASCII space or U+3000 between two adjacent CJK characters
  - Trailing ASCII/U+3000 whitespace on paragraph content lines

Only touches lines that are clearly paragraph body:
  - `paragraphs:` list items (`- [CJK]...`)
  - `story_text:` single-quoted multi-line continuation (`  [CJK]...`)

Skips `vocabulary`, `story_structure`, `vocab_bank` and other structured fields
where spacing may be intentional (e.g. `- word: 孤 寂` labels, OCR-spaced
story_structure values, checkbox layouts).

Run from repo root:
    python3 scripts/clean_lesson_whitespace.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

LESSON_DIR = Path(__file__).resolve().parent.parent / "backend" / "data" / "lessons"

CJK = r"[\u3400-\u9fff\uf900-\ufaff]"
INTER_CJK_SPACE = re.compile(rf"({CJK})[ \u3000]+({CJK})")
TRAILING_WS = re.compile(r"[ \u3000]+$")


def clean_line(line: str) -> str:
    prev = None
    cur = line
    while prev != cur:
        prev = cur
        cur = INTER_CJK_SPACE.sub(r"\1\2", cur)
    cur = TRAILING_WS.sub("", cur)
    return cur


def process_file(path: Path) -> int:
    original = path.read_text(encoding="utf-8")
    lines = original.split("\n")

    in_story_text = False
    in_quoted_list_item = False
    changed = 0
    out = []

    for raw in lines:
        clean_this = False

        if raw.startswith("story_text:"):
            in_story_text = True
            in_quoted_list_item = False
            out.append(raw)
            continue

        if in_story_text:
            stripped = raw.strip()
            if stripped.endswith("'") and not stripped.endswith("''"):
                clean_this = True
                in_story_text = False
            elif raw.startswith("  ") or raw == "":
                clean_this = True
            else:
                in_story_text = False

        elif in_quoted_list_item:
            stripped = raw.strip()
            if stripped.endswith("'") and not stripped.endswith("''"):
                clean_this = True
                in_quoted_list_item = False
            elif raw.startswith("  ") or raw == "":
                clean_this = True
            else:
                in_quoted_list_item = False

        elif raw.startswith("- '") and len(raw) >= 4 and re.match(CJK, raw[3]):
            # Multi-line single-quoted paragraph list item
            in_quoted_list_item = True
            clean_this = True

        elif raw.startswith("- ") and len(raw) >= 3 and re.match(CJK, raw[2]):
            clean_this = True

        if clean_this:
            new = clean_line(raw)
            if new != raw:
                changed += 1
            out.append(new)
        else:
            out.append(raw)

    new_text = "\n".join(out)
    if new_text != original:
        path.write_text(new_text, encoding="utf-8")
    return changed


def main() -> int:
    total_changed = 0
    touched_files = 0
    for yml in sorted(LESSON_DIR.glob("L*.yml")):
        n = process_file(yml)
        if n:
            touched_files += 1
            total_changed += n
            print(f"  {yml.name}: {n} line(s) cleaned")
    print(f"\nDone. {total_changed} line(s) across {touched_files} file(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
