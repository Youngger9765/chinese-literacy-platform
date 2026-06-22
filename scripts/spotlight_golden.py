#!/usr/bin/env python3
"""
spotlight_golden.py

Build canonical two-layer golden snapshots from faithfulness checker output.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


DEFAULT_REPORT = Path(".qa-screenshots/spotlight-sweep/faithfulness-report.json")
DEFAULT_OUT_DIR = Path(".qa-screenshots/spotlight-sweep/golden")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build spotlight golden snapshots")
    parser.add_argument("--report", default=str(DEFAULT_REPORT))
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    args = parser.parse_args()

    report_path = Path(args.report)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    report = json.loads(report_path.read_text(encoding="utf-8"))
    expected_red = set(report.get("expected_red_ids", []))

    stories: list[dict[str, Any]] = report.get("stories", [])
    frozen = 0
    skipped_expected_red = 0
    skipped_runtime_fail = 0
    index_rows: list[dict[str, Any]] = []

    for row in stories:
        sid = int(row["story_id"])
        lesson_code = str(row.get("lesson_code") or f"story-{sid}")
        status = row.get("status")

        if sid in expected_red:
            skipped_expected_red += 1
            continue
        if status != "PASS":
            skipped_runtime_fail += 1
            continue

        canonical = row.get("canonical", {})
        payload = {
            "key": canonical.get("key") or f"{lesson_code}+{sid}",
            "story_id": sid,
            "lesson_code": lesson_code,
            "title": row.get("title"),
            "structure_layer": canonical.get("structure", {}),
            "semantic_layer": {
                "hash": canonical.get("semantic_hash"),
            },
        }
        filename = f"{lesson_code}__{sid}.json".replace("/", "_")
        (out_dir / filename).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        index_rows.append(
            {
                "key": payload["key"],
                "story_id": sid,
                "lesson_code": lesson_code,
                "file": filename,
                "semantic_hash": payload["semantic_layer"]["hash"],
                "question_count": payload["structure_layer"].get("question_count"),
            }
        )
        frozen += 1

    manifest = {
        "meta": {
            "report_path": str(report_path),
            "total_stories": len(stories),
            "frozen_count": frozen,
            "skipped_expected_red": skipped_expected_red,
            "skipped_runtime_fail": skipped_runtime_fail,
        },
        "items": sorted(index_rows, key=lambda x: (x["lesson_code"], x["story_id"])),
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"[info] golden dir: {out_dir}")
    print(f"[info] frozen_count={frozen}")
    print(f"[info] skipped_expected_red={skipped_expected_red}")
    print(f"[info] skipped_runtime_fail={skipped_runtime_fail}")
    print(f"[info] manifest={out_dir / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
