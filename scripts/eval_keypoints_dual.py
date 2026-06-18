#!/usr/bin/env python3
"""Dual-source eval: keypoints.yml expected table vs on-disk lesson YAML."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from keypoints_table_sync import build_grade_code_paths, keypoints_to_table  # noqa: E402
from story_structure_qa import table_fingerprint  # noqa: E402


def load_mod(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def eval_dual(lesson_id: str, schema_dir: Path) -> dict:
    kp_path = schema_dir / f"{lesson_id}.keypoints.yml"
    if not kp_path.exists():
        return {"lesson_id": lesson_id, "available": False}

    with open(kp_path, encoding="utf-8") as f:
        kp_schema = yaml.safe_load(f)
    expected = keypoints_to_table(kp_schema)

    sync_mod = load_mod("sync", ROOT / "scripts/keypoints_table_sync.py")
    grade_paths = sync_mod.build_grade_code_paths()
    targets = grade_paths.get(lesson_id, [])
    on_disk = None
    yaml_path = None
    for path in targets:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        if data.get("story_structure_table") is not None:
            on_disk = data["story_structure_table"]
            yaml_path = str(path)
            break

    match = on_disk is not None and table_fingerprint(expected) == table_fingerprint(on_disk)
    return {
        "lesson_id": lesson_id,
        "available": True,
        "yaml_match": match,
        "yaml_path": yaml_path,
        "expected_rows": len(expected),
        "on_disk_rows": len(on_disk or []),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--schema-dir", default=str(ROOT / "private/curriculum-source/_online-schema"))
    parser.add_argument("--lesson", action="append")
    args = parser.parse_args()

    from story_structure_qa_lib import REPRESENTATIVE_LESSONS  # noqa: E402

    lesson_ids = args.lesson or [item["parsed_code"] for item in REPRESENTATIVE_LESSONS]
    results = [eval_dual(lid, Path(args.schema_dir)) for lid in lesson_ids]
    print(json.dumps(results, ensure_ascii=False, indent=2))
    failed = [r for r in results if r.get("available") and not r.get("yaml_match")]
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
