#!/usr/bin/env python3
"""Build keypoints QA manifest + per-lesson previews for the curriculum QA dashboard.

Usage:
  python scripts/build_keypoints_qa_manifest.py --smoke
  python scripts/build_keypoints_qa_manifest.py --all

Output:
  backend/data/curriculum_qa/keypoints_manifest.json
  backend/data/curriculum_qa/previews/{lesson_id}/original.html
  backend/data/curriculum_qa/snapshots/{lesson_id}/structure.json
  backend/data/curriculum_qa/snapshots/{lesson_id}/keypoints.json
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from app.services.keypoints_preview import render_keypoints_html  # noqa: E402
from app.services.lesson_code_normalization import normalize_manifest_code  # noqa: E402
from story_structure_qa import run_qa  # noqa: E402
from story_structure_qa_lib import PARSER_GAP_LESSONS, SMOKE_LESSONS  # noqa: E402

DEFAULT_SCHEMA_DIR = ROOT / "private/curriculum-source/_online-schema"
OUT_DIR = ROOT / "backend/data/curriculum_qa"
GATES = {"L1", "L2", "L3"}


def _overall_pass(gates: dict) -> bool:
    for g in gates.values():
        if not g.get("pass"):
            return False
    return bool(gates)


def _gate_status(gates: dict) -> str:
    if not gates:
        return "skip"
    return "pass" if _overall_pass(gates) else "fail"


def build_manifest(*, smoke_only: bool, schema_dir: Path) -> dict:
    qa = run_qa(
        gates=GATES,
        schema_dir=schema_dir,
        staging_be="",
        staging_fe="",
        token=None,
        smoke_only=smoke_only,
        run_ui=False,
    )

    from app.routes.stories import _format_yaml_structure_table, _sanitize_structure_for_client
    from app.services.lesson_loader import get_all_lessons
    from story_structure_qa import build_structure_from_lesson, loader_for_parsed_lesson

    lessons_by_code: dict[str, dict] = {}
    for lesson in get_all_lessons():
        code = normalize_manifest_code(lesson.get("grade_code") or lesson.get("lesson_code") or "")
        if code:
            lessons_by_code[code] = lesson

    previews_dir = OUT_DIR / "previews"
    snapshots_dir = OUT_DIR / "snapshots"
    previews_dir.mkdir(parents=True, exist_ok=True)
    snapshots_dir.mkdir(parents=True, exist_ok=True)

    lessons_out: list[dict] = []
    pass_count = 0

    for rec in qa.get("per_lesson_docx") or []:
        lesson_id = rec.get("lesson_id") or ""
        if not lesson_id:
            continue

        loader, _catalog = loader_for_parsed_lesson(lesson_id, lessons_by_code)
        gates = rec.get("gates") or {}
        overall = _overall_pass(gates) if gates else False
        if overall:
            pass_count += 1

        kp_path = schema_dir / f"{lesson_id}.keypoints.yml"
        kp_data = None
        if kp_path.exists():
            with open(kp_path, encoding="utf-8") as f:
                kp_data = yaml.safe_load(f)

        lesson_preview = previews_dir / lesson_id
        lesson_preview.mkdir(parents=True, exist_ok=True)
        lesson_snap = snapshots_dir / lesson_id
        lesson_snap.mkdir(parents=True, exist_ok=True)

        has_original = False
        if kp_data:
            html_doc = render_keypoints_html(kp_data)
            (lesson_preview / "original.html").write_text(html_doc, encoding="utf-8")
            (lesson_snap / "keypoints.json").write_text(
                json.dumps(kp_data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            has_original = True

        structure = None
        if loader:
            structure = build_structure_from_lesson(
                loader, _format_yaml_structure_table, _sanitize_structure_for_client
            )
        if structure:
            (lesson_snap / "structure.json").write_text(
                json.dumps(structure, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

        profile = rec.get("profile") or (structure or {}).get("interaction_profile") or {}

        tier = rec.get("tier")
        known_gap = lesson_id in PARSER_GAP_LESSONS or tier == "parser_gap"
        lessons_out.append({
            "lesson_id": lesson_id,
            "title": (loader or {}).get("title") or lesson_id,
            "story_id": rec.get("story_id") or (loader or {}).get("id"),
            "tier": tier,
            "known_data_gap": known_gap,
            "overall_pass": overall,
            "overall_status": _gate_status(gates),
            "gates": gates,
            "layout": {
                "mode": profile.get("mode"),
                "layout": profile.get("layout") or (structure or {}).get("layout"),
                "fill_blank_count": profile.get("fill_blank_count"),
                "checkbox_count": profile.get("checkbox_count"),
                "row_count": len((structure or {}).get("rows") or []),
            },
            "artifacts": {
                "has_keypoints_yml": kp_path.exists(),
                "has_original_preview": has_original,
                "has_structure_snapshot": structure is not None,
            },
            "yaml_path": rec.get("yaml_path"),
        })

    lessons_out.sort(key=lambda x: x["lesson_id"])

    known_gap_count = sum(1 for l in lessons_out if l.get("known_data_gap"))
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "smoke_only": smoke_only,
        "gates_included": sorted(GATES),
        "summary": {
            "total": len(lessons_out),
            "pass": pass_count,
            "fail": len(lessons_out) - pass_count,
            "known_gap_count": known_gap_count,
            "failure_count": qa.get("summary", {}).get("failure_count", 0),
        },
        "lessons": lessons_out,
        "raw_failures": qa.get("failures") or [],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build keypoints QA manifest")
    parser.add_argument("--smoke", action="store_true", help=f"Smoke only: {SMOKE_LESSONS}")
    parser.add_argument("--all", action="store_true", help="All DOCX lessons in batch")
    parser.add_argument("--schema-dir", default=str(DEFAULT_SCHEMA_DIR))
    args = parser.parse_args()

    if not args.smoke and not args.all:
        args.smoke = True

    schema_dir = Path(args.schema_dir)
    if not schema_dir.exists():
        print(f"ERROR: schema dir not found: {schema_dir}", file=sys.stderr)
        return 1

    manifest = build_manifest(smoke_only=not args.all, schema_dir=schema_dir)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "keypoints_manifest.json"
    out_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    s = manifest["summary"]
    print(f"Wrote {out_path}")
    print(f"  lessons={s['total']} pass={s['pass']} fail={s['fail']}")
    return 0 if s["fail"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
