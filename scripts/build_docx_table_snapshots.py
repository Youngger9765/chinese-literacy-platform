#!/usr/bin/env python3
"""Export keypoints.yml rows to committed DOCX table snapshots for Lab panel A."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from keypoints_table_sync import keypoints_to_table  # noqa: E402

DEFAULT_SCHEMA_DIR = ROOT / "private/curriculum-source/_online-schema"
OUT_DIR = ROOT / "backend/data/qa/docx_table_snapshots"


def export_lesson(lesson_id: str, schema_dir: Path, out_dir: Path) -> bool:
    kp_path = schema_dir / f"{lesson_id}.keypoints.yml"
    if not kp_path.exists():
        return False
    with open(kp_path, encoding="utf-8") as f:
        kp_schema = yaml.safe_load(f)
    payload = {
        "lesson_id": lesson_id,
        "keypoints": kp_schema.get("keypoints", kp_schema),
        "expected_table": keypoints_to_table(kp_schema),
    }
    dest = out_dir / f"{lesson_id}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--schema-dir", default=str(DEFAULT_SCHEMA_DIR))
    parser.add_argument("--out-dir", default=str(OUT_DIR))
    parser.add_argument("--lesson", action="append", help="e.g. G6-L22 (default: representative set)")
    args = parser.parse_args()

    schema_dir = Path(args.schema_dir)
    out_dir = Path(args.out_dir)
    from story_structure_qa_lib import REPRESENTATIVE_LESSONS  # noqa: E402

    lesson_ids = args.lesson or [item["parsed_code"] for item in REPRESENTATIVE_LESSONS]
    written = 0
    for lesson_id in lesson_ids:
        if export_lesson(lesson_id, schema_dir, out_dir):
            written += 1
            print(f"OK  {lesson_id}")
    print(f"exported {written}/{len(lesson_ids)} snapshots → {out_dir}")


if __name__ == "__main__":
    main()
