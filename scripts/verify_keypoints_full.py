#!/usr/bin/env python3
"""Full keypoints verification — all DOCX lessons, YAML sync, loader, staging API.

Usage:
    python3 scripts/verify_keypoints_full.py
    python3 scripts/verify_keypoints_full.py --staging-url https://... --token TOKEN
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

DEFAULT_SCHEMA_DIR = ROOT / "private/curriculum-source/_online-schema"
DEFAULT_STAGING = "https://lingoleap-backend-staging-958347263320.asia-east1.run.app"
REPORT_PATH = DEFAULT_SCHEMA_DIR / "full_verify_report.json"


def load_mod(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def http_json(url: str, *, token: str | None = None, method: str = "GET", body: dict | None = None) -> dict:
    data = None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())


def login_staging(base: str) -> str:
    result = http_json(
        f"{base}/api/auth/login",
        method="POST",
        body={"email": "student@test.com", "password": "student1234"},
    )
    return result["access_token"]


def table_fingerprint(table: list) -> str:
    return json.dumps(table, ensure_ascii=False, sort_keys=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--schema-dir", default=str(DEFAULT_SCHEMA_DIR))
    parser.add_argument("--staging-url", default=DEFAULT_STAGING)
    parser.add_argument("--token", help="Bearer token (default: login student@test.com)")
    parser.add_argument("--report", default=str(REPORT_PATH))
    args = parser.parse_args()

    schema_dir = Path(args.schema_dir)
    batch = load_mod("batch", ROOT / "scripts/batch_all_lessons.py")
    eval_mod = load_mod("eval", ROOT / "scripts/eval_lesson_schema.py")
    sync_mod = load_mod("sync", ROOT / "scripts/keypoints_table_sync.py")
    bls = eval_mod.load_bls()

    from app.routes.stories import _format_yaml_structure_table
    from app.services.lesson_code_normalization import normalize_manifest_code
    from app.services.lesson_loader import get_all_lessons

    grade_paths = sync_mod.build_grade_code_paths()
    lessons_docx = batch.discover_lessons()

    docx_results: list[dict] = []
    sync_mismatch: list[dict] = []
    layout_fail: list[dict] = []
    no_keypoints: list[str] = []

    for lesson_id, docx_path in lessons_docx:
        kp = eval_mod.eval_keypoints(lesson_id, docx_path, schema_dir, bls)
        entry = {
            "lesson_id": lesson_id,
            "docx": str(docx_path.name),
            "keypoints": kp,
        }

        if not kp.get("available"):
            no_keypoints.append(lesson_id)
            docx_results.append(entry)
            continue

        kp_path = schema_dir / f"{lesson_id}.keypoints.yml"
        if kp_path.exists():
            with open(kp_path, encoding="utf-8") as f:
                kp_schema = yaml.safe_load(f)
            expected_table = sync_mod.keypoints_to_table(kp_schema)
            targets = grade_paths.get(normalize_manifest_code(lesson_id), [])
            on_disk = None
            for path in targets:
                with open(path, encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                on_disk = data.get("story_structure_table")
                if on_disk is not None:
                    break
            if on_disk is None:
                sync_mismatch.append({"lesson_id": lesson_id, "reason": "no yaml table"})
            elif table_fingerprint(expected_table) != table_fingerprint(on_disk):
                sync_mismatch.append({"lesson_id": lesson_id, "reason": "table mismatch"})

            if on_disk:
                formatted = _format_yaml_structure_table(on_disk)
                layout_ok = formatted.get("layout") == "worksheet_table" or bool(formatted.get("rows"))
                if not layout_ok:
                    layout_fail.append({"lesson_id": lesson_id, "reason": "bad layout"})
                entry["layout"] = formatted.get("layout")
                entry["worksheet_rows"] = len(formatted.get("worksheet_rows") or [])
                entry["rows"] = len(formatted.get("rows") or [])

        docx_results.append(entry)

    # All loader lessons — local structure format
    loader_results: list[dict] = []
    loader_fail: list[dict] = []
    lessons_by_id = {l["id"]: l for l in get_all_lessons()}
    lessons_by_code = {normalize_manifest_code(l.get("grade_code") or ""): l for l in get_all_lessons() if l.get("grade_code")}

    for lesson in get_all_lessons():
        lid = lesson["id"]
        code = lesson.get("grade_code") or lesson.get("lesson_code") or ""
        table = lesson.get("story_structure_table")
        ai_rows = lesson.get("story_structure_rows")
        item = {
            "id": lid,
            "grade_code": code,
            "title": lesson.get("title", "")[:40],
            "has_table": bool(table),
            "has_ai_rows": bool(ai_rows),
        }
        if table:
            fmt = _format_yaml_structure_table(table)
            item["layout"] = fmt.get("layout")
            item["worksheet_rows"] = len(fmt.get("worksheet_rows") or [])
            if not fmt.get("layout") and not fmt.get("rows"):
                loader_fail.append({"id": lid, "grade_code": code, "reason": "empty structure"})
        elif ai_rows:
            loader_fail.append({"id": lid, "grade_code": code, "reason": "ai_rows only, no docx table"})
        loader_results.append(item)

    # Staging API — all stories
    token = args.token or login_staging(args.staging_url)
    stories: list[dict] = []
    page = 1
    while True:
        data = http_json(
            f"{args.staging_url}/api/stories?page={page}&page_size=300",
            token=token,
        )
        stories.extend(data["stories"])
        if len(stories) >= data["total"]:
            break
        page += 1

    staging_results: list[dict] = []
    staging_fail: list[dict] = []
    staging_skip: list[dict] = []

    for s in stories:
        sid = s["id"]
        code = s.get("grade_code") or ""
        try:
            struct = http_json(f"{args.staging_url}/api/stories/{sid}/structure", token=token)
        except urllib.error.HTTPError as e:
            staging_fail.append({"id": sid, "grade_code": code, "reason": f"HTTP {e.code}"})
            continue

        layout = struct.get("layout")
        ws_rows = len(struct.get("worksheet_rows") or [])
        rows = len(struct.get("rows") or [])
        local = lessons_by_id.get(sid)
        item = {
            "id": sid,
            "grade_code": code,
            "title": s.get("title", "")[:40],
            "layout": layout,
            "worksheet_rows": ws_rows,
            "rows": rows,
        }
        if not layout and rows == 0:
            staging_fail.append({"id": sid, "grade_code": code, "reason": "empty structure"})
        elif local and local.get("story_structure_table"):
            local_fmt = _format_yaml_structure_table(local["story_structure_table"])
            local_ws = len(local_fmt.get("worksheet_rows") or [])
            if layout != local_fmt.get("layout"):
                staging_fail.append({"id": sid, "grade_code": code, "reason": f"layout {layout} != {local_fmt.get('layout')}"})
            elif ws_rows != local_ws and local_ws > 0:
                staging_fail.append({"id": sid, "grade_code": code, "reason": f"worksheet_rows {ws_rows} != {local_ws}"})
        elif local and not local.get("story_structure_table"):
            staging_skip.append({"id": sid, "grade_code": code, "reason": "no local table"})
        staging_results.append(item)

    kp_eligible = [r for r in docx_results if r["keypoints"].get("available")]
    kp_pass = [r for r in kp_eligible if r["keypoints"].get("pass")]
    kp_layout_only_fail = [
        r for r in kp_eligible
        if not r["keypoints"].get("pass")
        and r["keypoints"].get("row_recall", 0) >= 0.95
        and r["keypoints"].get("blank_recall", 0) >= 0.95
        and r["keypoints"].get("nesting_preserved")
    ]

    report = {
        "docx": {
            "total": len(docx_results),
            "keypoints_eligible": len(kp_eligible),
            "keypoints_pass": len(kp_pass),
            "keypoints_na": len(no_keypoints),
            "sync_mismatch": sync_mismatch,
            "layout_fail": layout_fail,
            "label_only_fail": [r["lesson_id"] for r in kp_layout_only_fail],
            "hard_fail": [
                r["lesson_id"] for r in kp_eligible
                if not r["keypoints"].get("pass") and r["lesson_id"] not in {x["lesson_id"] for x in kp_layout_only_fail}
            ],
        },
        "loader": {
            "total": len(loader_results),
            "with_table": sum(1 for r in loader_results if r["has_table"]),
            "ai_rows_only": sum(1 for r in loader_results if r["has_ai_rows"] and not r["has_table"]),
            "fail": loader_fail,
        },
        "staging": {
            "total_stories": len(staging_results),
            "fail": staging_fail,
            "skip_no_local_table": staging_skip,
        },
        "per_lesson_docx": docx_results,
        "per_story_staging": staging_results,
    }

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print("=" * 72)
    print("FULL KEYPOINTS VERIFICATION")
    print("=" * 72)
    print(f"DOCX lessons:        {report['docx']['total']}")
    print(f"  keypoints pass:    {report['docx']['keypoints_pass']}/{report['docx']['keypoints_eligible']}")
    print(f"  N/A (no table):    {report['docx']['keypoints_na']}")
    print(f"  sync mismatch:     {len(sync_mismatch)}")
    print(f"  layout fail:       {len(layout_fail)}")
    print(f"  label-only fail:   {report['docx']['label_only_fail']}")
    print(f"  hard fail:         {report['docx']['hard_fail']}")
    print(f"Loader lessons:      {report['loader']['total']} (table={report['loader']['with_table']}, fail={len(loader_fail)})")
    print(f"Staging stories:     {report['staging']['total_stories']} (fail={len(staging_fail)}, skip={len(staging_skip)})")
    print(f"Report: {report_path}")

    failed = (
        sync_mismatch or layout_fail or report["docx"]["hard_fail"]
        or loader_fail or staging_fail
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
