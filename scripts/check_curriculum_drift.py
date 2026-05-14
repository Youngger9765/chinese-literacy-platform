#!/usr/bin/env python3
"""
Curriculum drift detector — verify backend/data/ matches 教授 source.

Workflow:
  1. Read backend/data/curriculum/INGESTION_MANIFEST.yml → active_version + source_dir
  2. Re-run scripts/ingest_curriculum.py to /tmp/curriculum-regenerated/
  3. Diff /tmp/curriculum-regenerated/ vs backend/data/ (parser-managed fields only)
  4. Exit 0 if no drift, exit 1 if drift found (prints report)

Used by:
  - pre-commit hook (block commit if drift)
  - .github/workflows/curriculum-drift-check.yml (weekly cron)
  - manual: python scripts/check_curriculum_drift.py

Owner: Young / LingoLeap | Issue: #1624
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    sys.stderr.write("ERROR: pyyaml required\n")
    sys.exit(2)


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BACKEND_DATA = REPO_ROOT / "backend" / "data"
DEFAULT_MANIFEST = DEFAULT_BACKEND_DATA / "curriculum" / "INGESTION_MANIFEST.yml"
LEGACY_MANIFEST_NAME = "manifest.yml"  # do not confuse with INGESTION_MANIFEST.yml; legacy is consumed by lesson_loader.py
DEFAULT_PARSER = REPO_ROOT / "scripts" / "ingest_curriculum.py"


def load_yaml(path: Path) -> Any:
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def filter_managed_fields(data: dict, fields: list[str]) -> dict:
    """Return subset of data keyed by `fields` (parser-managed only)."""
    if data is None:
        return {}
    return {k: data.get(k) for k in fields if k in data}


def diff_lesson(generated: dict, existing: dict, managed_fields: list[str]) -> list[str]:
    """Compare parser-managed fields. Returns list of human-readable diff lines."""
    diffs: list[str] = []
    g = filter_managed_fields(generated, managed_fields)
    e = filter_managed_fields(existing, managed_fields)
    for k in managed_fields:
        gv = g.get(k)
        ev = e.get(k)
        if gv != ev:
            gv_repr = str(gv)[:80]
            ev_repr = str(ev)[:80]
            diffs.append(f"    {k}: generated={gv_repr!r} != existing={ev_repr!r}")
    return diffs


def main() -> int:
    ap = argparse.ArgumentParser(description="Check curriculum drift")
    ap.add_argument("--backend-data", type=Path, default=DEFAULT_BACKEND_DATA,
                    help="Path to backend/data/ (default: repo/backend/data)")
    ap.add_argument("--manifest", type=Path, default=None,
                    help="Path to INGESTION_MANIFEST.yml (default: <backend-data>/curriculum/INGESTION_MANIFEST.yml)")
    ap.add_argument("--parser", type=Path, default=DEFAULT_PARSER,
                    help="Path to ingest_curriculum.py")
    ap.add_argument("--source", type=Path, default=None,
                    help="Override source dir (default: read from MANIFEST.source_dir)")
    ap.add_argument("--keep-regen", action="store_true",
                    help="Keep regenerated dir for inspection")
    ap.add_argument("--max-show", type=int, default=20,
                    help="Max number of drifted lessons to display in detail")
    args = ap.parse_args()

    backend_data: Path = args.backend_data.resolve()
    manifest_path: Path = (args.manifest or backend_data / "curriculum" / "INGESTION_MANIFEST.yml").resolve()

    if not manifest_path.exists():
        sys.stderr.write(f"ERROR: MANIFEST not found: {manifest_path}\n")
        sys.stderr.write("Hint: run scripts/ingest_curriculum.py --write first.\n")
        return 2

    manifest = load_yaml(manifest_path)
    if not manifest:
        sys.stderr.write(f"ERROR: failed to load MANIFEST: {manifest_path}\n")
        return 2

    source_dir = args.source or Path(manifest.get("source_dir", ""))
    if not source_dir.is_absolute():
        source_dir = REPO_ROOT / source_dir
    if not source_dir.exists():
        sys.stderr.write(f"ERROR: source dir not found: {source_dir}\n")
        sys.stderr.write(f"  (from MANIFEST.source_dir or --source)\n")
        return 2

    catalog_fields = manifest.get("parser_managed_catalog_fields", [])
    content_fields = manifest.get("parser_managed_content_fields", [])
    if not catalog_fields or not content_fields:
        sys.stderr.write("ERROR: MANIFEST missing parser_managed_*_fields\n")
        return 2

    print(f"[drift] MANIFEST: {manifest_path}")
    print(f"[drift] active_version: {manifest.get('active_version')}")
    print(f"[drift] source: {source_dir}")

    # Step 1: regenerate to tmp
    regen_dir = Path(tempfile.mkdtemp(prefix="curriculum-regen-"))
    print(f"[drift] regenerating to: {regen_dir}")
    try:
        result = subprocess.run(
            [
                sys.executable,
                str(args.parser),
                "--source", str(source_dir),
                "--target", str(regen_dir),
                "--write",
                "--version", manifest.get("active_version", "unknown"),
            ],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode != 0:
            sys.stderr.write(f"ERROR: parser failed:\n{result.stderr}\n")
            return 2
        print(f"[drift] parser output: {result.stdout.splitlines()[-2] if result.stdout else 'n/a'}")
    except subprocess.TimeoutExpired:
        sys.stderr.write("ERROR: parser timeout\n")
        return 2

    # Step 2: diff
    drift_count = 0
    missing_in_existing = 0
    missing_in_regen = 0
    all_drift_details: list[str] = []

    # Catalog yml diff
    regen_catalog_dir = regen_dir / "curriculum" / "lessons"
    existing_catalog_dir = backend_data / "curriculum" / "lessons"

    for regen_file in sorted(regen_catalog_dir.glob("*.yml")):
        existing_file = existing_catalog_dir / regen_file.name
        if not existing_file.exists():
            missing_in_existing += 1
            all_drift_details.append(f"  [missing in existing] catalog: {regen_file.name}")
            drift_count += 1
            continue
        regen_data = load_yaml(regen_file)
        existing_data = load_yaml(existing_file)
        diffs = diff_lesson(regen_data, existing_data, catalog_fields)
        if diffs:
            drift_count += 1
            all_drift_details.append(f"  [catalog drift] {regen_file.name}:")
            all_drift_details.extend(diffs)

    # Files in existing but not regenerated
    for existing_file in sorted(existing_catalog_dir.glob("*.yml")):
        regen_file = regen_catalog_dir / existing_file.name
        if not regen_file.exists():
            missing_in_regen += 1
            all_drift_details.append(f"  [missing in regen] catalog: {existing_file.name}")

    # Content yml diff (parser-managed fields only — story_text/paragraphs etc.)
    regen_content_dir = regen_dir / "lessons"
    existing_content_dir = backend_data / "lessons"

    for regen_file in sorted(regen_content_dir.glob("*.yml")):
        existing_file = existing_content_dir / regen_file.name
        if not existing_file.exists():
            all_drift_details.append(f"  [missing in existing] content: {regen_file.name}")
            drift_count += 1
            continue
        regen_data = load_yaml(regen_file)
        existing_data = load_yaml(existing_file)
        diffs = diff_lesson(regen_data, existing_data, content_fields)
        if diffs:
            drift_count += 1
            all_drift_details.append(f"  [content drift] {regen_file.name}:")
            all_drift_details.extend(diffs)

    # Print summary
    print(f"\n[drift] === REPORT ===")
    print(f"[drift] drifted lessons: {drift_count}")
    print(f"[drift] missing in existing (regen has, existing doesn't): {missing_in_existing}")
    print(f"[drift] missing in regen (existing has, regen doesn't): {missing_in_regen}")

    if all_drift_details:
        print(f"\n[drift] details (showing up to {args.max_show * 2} lines):")
        for line in all_drift_details[: args.max_show * 2]:
            print(line)
        if len(all_drift_details) > args.max_show * 2:
            print(f"  ... and {len(all_drift_details) - args.max_show * 2} more lines")

    # Cleanup
    if not args.keep_regen:
        shutil.rmtree(regen_dir, ignore_errors=True)
    else:
        print(f"\n[drift] kept regen dir: {regen_dir}")

    if drift_count > 0 or missing_in_regen > 0:
        print(f"\n[drift] FAIL: drift detected")
        return 1
    else:
        print(f"\n[drift] PASS: no drift")
        return 0


if __name__ == "__main__":
    sys.exit(main())
