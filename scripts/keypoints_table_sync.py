#!/usr/bin/env python3
"""
keypoints_table_sync.py — sync keypoints.yml → lesson YAML story_structure_table

Converts DOCX-extracted keypoints schema (issue #2205) into the list-of-lists
story_structure_table format consumed by /api/stories/{id}/structure.

Usage:
    python3 scripts/keypoints_table_sync.py --dry-run
    python3 scripts/keypoints_table_sync.py
    python3 scripts/keypoints_table_sync.py --lesson G6-L22
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date
from pathlib import Path

import yaml

# Reuse curriculum code normalization (G4-L01 → G4-L1)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.services.lesson_code_normalization import (
    MULTI_LESSON_PRIMARY,
    normalize_manifest_code,
)

SOURCE_TAG = f"docx-keypoints-{date.today().isoformat()}"
LESSONS_DIR = Path("backend/data/lessons")
PARSED_DIR = LESSONS_DIR / "_parsed_2026-05-01"
DEFAULT_SCHEMA_DIR = Path("private/curriculum-source/_online-schema")


def fill_template(template: str, blanks: list[dict]) -> str:
    """Restore 【 answer 】 placeholders from template + blanks list."""
    text = template or ""
    for blank in blanks:
        answer = str(blank.get("answer", "")).strip()
        if "__" in text:
            text = text.replace("__", f"【 {answer} 】", 1)
        elif answer:
            text = f"{text}【 {answer} 】"
    return text


def format_label(label: str, paragraph: str | None = None) -> str:
    if not paragraph:
        return label
    return f"{label}\n/（{paragraph}）"


def keypoints_to_table(kp_schema: dict) -> list[list[str]]:
    """Convert keypoints.yml content to story_structure_table rows."""
    data = kp_schema.get("keypoints", kp_schema)
    columns = data.get("columns") or ["label", "value"]
    rows_out: list[list[str]] = []

    title = data.get("title")
    if title:
        rows_out.append([title])

    for row in data.get("rows") or []:
        label = row.get("label", "")
        paragraph = row.get("paragraph")

        if row.get("sub_rows"):
            section = label
            for sub_row in row["sub_rows"]:
                sub_label = sub_row.get("sub_label", "")
                value = fill_template(
                    sub_row.get("template") or sub_row.get("value", ""),
                    sub_row.get("blanks") or [],
                )
                if "hint" in columns and "sub_label" not in columns:
                    hint = sub_row.get("hint", "")
                    rows_out.append([section, hint, value])
                else:
                    rows_out.append([section, sub_label, value])
            continue

        value = fill_template(
            row.get("template") or row.get("value", ""),
            row.get("blanks") or [],
        )

        if columns == ["label", "hint", "value"] or (
            "hint" in columns and "sub_label" not in columns
        ):
            hint = row.get("hint", "")
            rows_out.append([format_label(label, paragraph), hint, value])
        else:
            rows_out.append([format_label(label, paragraph), value])

    return rows_out


def build_grade_code_paths() -> dict[str, list[Path]]:
    """Map grade_code → YAML file(s) to update."""
    mapping: dict[str, list[Path]] = {}

    def add(code: str | None, path: Path) -> None:
        if not code:
            return
        norm = normalize_manifest_code(code)
        mapping.setdefault(norm, [])
        if path not in mapping[norm]:
            mapping[norm].append(path)

    if PARSED_DIR.exists():
        parsed_by_stem: dict[str, Path] = {}
        for path in sorted(PARSED_DIR.glob("*.yml")):
            parsed_by_stem[path.stem] = path
            with open(path, encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            add(data.get("grade_code") or data.get("lesson_code"), path)

        # Multi-lesson YAML files (G4-L20-22.yml serves G4-L20/L21/L22)
        for lesson_id, stem in MULTI_LESSON_PRIMARY.items():
            multi_path = parsed_by_stem.get(stem)
            if multi_path:
                add(lesson_id, multi_path)

    for path in sorted(LESSONS_DIR.glob("L*.yml")):
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        add(data.get("grade_code"), path)

    return mapping


def sync_lesson(
    lesson_id: str,
    schema_dir: Path,
    grade_paths: dict[str, list[Path]],
    *,
    dry_run: bool,
) -> dict:
    kp_path = schema_dir / f"{lesson_id}.keypoints.yml"
    if not kp_path.exists():
        return {"lesson_id": lesson_id, "status": "skip", "reason": "no keypoints.yml"}

    with open(kp_path, encoding="utf-8") as f:
        kp_schema = yaml.safe_load(f)

    table = keypoints_to_table(kp_schema)
    if not table:
        return {"lesson_id": lesson_id, "status": "skip", "reason": "empty table"}

    targets = grade_paths.get(normalize_manifest_code(lesson_id), [])
    if not targets:
        return {"lesson_id": lesson_id, "status": "skip", "reason": "no lesson yaml"}

    updated: list[str] = []
    for path in targets:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        data["story_structure_table"] = table
        data["story_structure_table_source"] = SOURCE_TAG
        if data.get("story_structure_rows"):
            del data["story_structure_rows"]
        if data.get("story_structure"):
            del data["story_structure"]

        if not dry_run:
            with open(path, "w", encoding="utf-8") as f:
                yaml.dump(
                    data,
                    f,
                    allow_unicode=True,
                    default_flow_style=False,
                    sort_keys=False,
                )
        updated.append(str(path))

    return {
        "lesson_id": lesson_id,
        "status": "updated" if updated else "skip",
        "rows": len(table),
        "files": updated,
    }


def discover_lesson_ids(schema_dir: Path) -> list[str]:
    return sorted(p.stem.replace(".keypoints", "") for p in schema_dir.glob("*.keypoints.yml"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync keypoints.yml into lesson YAML")
    parser.add_argument("--schema-dir", default=str(DEFAULT_SCHEMA_DIR))
    parser.add_argument("--lesson", help="Sync a single lesson id (e.g. G6-L22)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    schema_dir = Path(args.schema_dir)
    grade_paths = build_grade_code_paths()
    lesson_ids = [args.lesson] if args.lesson else discover_lesson_ids(schema_dir)

    updated = skipped = 0
    for lesson_id in lesson_ids:
        result = sync_lesson(
            lesson_id,
            schema_dir,
            grade_paths,
            dry_run=args.dry_run,
        )
        status = result["status"]
        if status == "updated":
            updated += 1
            print(f"OK  {lesson_id}: {result['rows']} rows → {len(result['files'])} file(s)")
        else:
            skipped += 1

    mode = "DRY RUN" if args.dry_run else "SYNC"
    print(f"\n{mode}: updated={updated}, skipped={skipped}, total={len(lesson_ids)}")


if __name__ == "__main__":
    main()
