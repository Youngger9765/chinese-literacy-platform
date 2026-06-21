#!/usr/bin/env python3
"""
Upload spotlight worksheet figure assets to GCS lessons-images bucket.

Local: private/curriculum-source/_online-schema/assets/<lesson_id>/fig*.png
GCS:    gs://lingoleap-assets/lessons-images/<lesson_id>/<filename>

Usage:
    python3 scripts/upload_spotlight_figure_assets.py --dry-run
    python3 scripts/upload_spotlight_figure_assets.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS_ROOT = ROOT / "private/curriculum-source/_online-schema/assets"
MANIFEST = ROOT / "backend/data/lessons/spotlight/catalog/manifest.json"
GCS_BUCKET = "gs://lingoleap-assets/lessons-images"
GCP_PROJECT = "lingoleap-dev"


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    lessons = json.loads(MANIFEST.read_text(encoding="utf-8")).get("lessons") or []
    uploaded = 0
    errors = 0

    for lesson_id in lessons:
        asset_dir = ASSETS_ROOT / lesson_id
        if not asset_dir.exists():
            continue
        has_fig = any(asset_dir.glob("fig*"))
        if not has_fig:
            continue
        dest = f"{GCS_BUCKET}/{lesson_id}/"
        if dry_run:
            n = len(list(asset_dir.glob("fig*")))
            print(f"dry-run rsync {asset_dir} -> {dest} ({n} fig files)")
            uploaded += n
            continue
        cmd = [
            "gcloud", "storage", "rsync", "-r", str(asset_dir), dest,
            "--project", GCP_PROJECT,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"FAIL {lesson_id}: {result.stderr.strip()[:160]}", file=sys.stderr)
            errors += 1
        else:
            uploaded += len(list(asset_dir.glob("fig*")))

    print(f"\n{'would upload' if dry_run else 'uploaded'} {uploaded} files; errors={errors}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
