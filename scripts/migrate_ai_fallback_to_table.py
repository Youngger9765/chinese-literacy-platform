#!/usr/bin/env python3
"""Migrate story_structure_rows (ai_fallback) → story_structure_table YAML-first.

For lessons with *.keypoints.yml, prefer keypoints_table_sync.py instead.
This script converts existing AI dict rows into list-of-lists table strings.

Usage:
    backend/.venv/bin/python scripts/migrate_ai_fallback_to_table.py --dry-run
    backend/.venv/bin/python scripts/migrate_ai_fallback_to_table.py --all
    backend/.venv/bin/python scripts/migrate_ai_fallback_to_table.py --lesson G4-L6
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from app.routes.stories import _format_yaml_structure_table, _sanitize_structure_for_client
from app.services.lesson_code_normalization import normalize_manifest_code
from app.services.story_structure_cell_parser import _BLANK_RE, _PAREN_BLANK_RE
from keypoints_table_sync import SOURCE_TAG, build_grade_code_paths

_CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩"
SOURCE_ROWS = f"ai-rows-migrated-{date.today().isoformat()}"


def _has_blank_markers(text: str) -> bool:
    return bool(_BLANK_RE.search(text) or _PAREN_BLANK_RE.search(text))


def format_checkbox_value(row: dict) -> str:
    options = row.get("options") or []
    correct = set(row.get("correct_options") or [])
    parts: list[str] = []
    for i, opt in enumerate(options):
        marker = _CIRCLED[i] if i < len(_CIRCLED) else f"{i + 1}."
        prefix = "□" if i not in correct else ""
        parts.append(f"{prefix}{marker}{opt}")
    return " ".join(parts)


def format_fill_blank_value(row: dict) -> str:
    value = str(row.get("value") or "")
    hint = str(row.get("hint") or "").strip()
    if _has_blank_markers(value):
        return value
    if hint and hint not in value:
        return f"{value} 【 {hint} 】"
    return value


def ai_rows_to_table(rows: list[dict]) -> list[list[str]]:
    table: list[list[str]] = []
    for row in rows:
        label = str(row.get("label") or "")
        itype = row.get("interactive_type") or "display"
        if itype == "checkbox":
            value = format_checkbox_value(row)
        elif itype == "fill_blank":
            value = format_fill_blank_value(row)
        else:
            value = str(row.get("value") or "")
        table.append([label, value])
    return table


def profile_from_rows(rows: list[dict]) -> dict:
    direct = _sanitize_structure_for_client({"rows": rows})
    return direct.get("interaction_profile") or {}


def profile_from_table(table: list[list[str]]) -> dict:
    formatted = _sanitize_structure_for_client(_format_yaml_structure_table(table))
    return formatted.get("interaction_profile") or {}


def migrate_file(path: Path, *, dry_run: bool) -> dict:
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    rows = data.get("story_structure_rows")
    if not rows or not isinstance(rows, list):
        return {"path": str(path), "status": "skip", "reason": "no story_structure_rows"}

    if data.get("story_structure_table"):
        return {"path": str(path), "status": "skip", "reason": "already has story_structure_table"}

    table = ai_rows_to_table(rows)
    if not table:
        return {"path": str(path), "status": "skip", "reason": "empty table"}

    before = profile_from_rows(rows)
    after = profile_from_table(table)

    result = {
        "path": str(path),
        "status": "dry-run" if dry_run else "updated",
        "code": data.get("grade_code") or data.get("lesson_code"),
        "rows_in": len(rows),
        "rows_out": len(table),
        "mode_before": before.get("mode"),
        "mode_after": after.get("mode"),
    }

    if not dry_run:
        data["story_structure_table"] = table
        data["story_structure_table_source"] = SOURCE_ROWS
        del data["story_structure_rows"]
        if data.get("story_structure"):
            del data["story_structure"]
        with open(path, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, sort_keys=False, width=120)

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate ai_fallback rows to story_structure_table")
    parser.add_argument("--all", action="store_true", help="All YAML files with story_structure_rows")
    parser.add_argument("--lesson", help="Catalog/parsed lesson code (e.g. G4-L6)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    grade_paths = build_grade_code_paths()
    targets: list[Path] = []

    if args.lesson:
        code = normalize_manifest_code(args.lesson)
        targets = grade_paths.get(code, [])
        if not targets:
            print(f"No YAML for {args.lesson}", file=sys.stderr)
            return 1
    elif args.all:
        seen: set[Path] = set()
        for paths in grade_paths.values():
            for p in paths:
                if p in seen:
                    continue
                seen.add(p)
                with open(p, encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                if data.get("story_structure_rows") and not data.get("story_structure_table"):
                    targets.append(p)
    else:
        parser.error("Provide --all or --lesson CODE")

    updated = 0
    skipped = 0
    for path in sorted(targets):
        res = migrate_file(path, dry_run=args.dry_run)
        detail = res.get("reason")
        if detail is None:
            detail = f"{res.get('mode_before')}→{res.get('mode_after')}"
        print(f"{res['status']:8} {path.name}: {detail}")
        if res["status"] in ("updated", "dry-run") and res.get("reason") is None:
            updated += 1
        else:
            skipped += 1

    print(f"\nDone: updated={updated} skipped={skipped} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
