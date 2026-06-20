#!/usr/bin/env python3
"""
promote_spotlight_catalog.py — copy eval-pass spotlight YAML into backend catalog.

Source: private/curriculum-source/_online-schema/*.spotlight.yml
Target: backend/data/lessons/spotlight/catalog/<lesson_id>.spotlight.yml

Skips dev7 + test15 curated fixtures (loader priority keeps those dirs).

Usage:
    python3 scripts/promote_spotlight_catalog.py [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.services.spotlight_contract import (  # noqa: E402
    DEV7_LESSONS,
    TEST15_FIXTURE_TO_CATALOG,
    eval_spotlight_v2,
    load_spotlight_yaml,
)
from app.services.lesson_code_normalization import normalize_manifest_code  # noqa: E402

SCHEMA_DIR = ROOT / "private/curriculum-source/_online-schema"
CATALOG_DIR = ROOT / "backend/data/lessons/spotlight/catalog"
MANIFEST_PATH = CATALOG_DIR / "manifest.json"

CURATED_CATALOG = frozenset(
    normalize_manifest_code(c) for c in TEST15_FIXTURE_TO_CATALOG.values()
) | frozenset(normalize_manifest_code(x) for x in DEV7_LESSONS)


def should_promote(lesson_id: str, spotlight: dict) -> tuple[bool, str]:
    norm = normalize_manifest_code(lesson_id)
    if norm in CURATED_CATALOG:
        return False, "curated_in_dev7_or_test15"
    blocks = spotlight.get("blocks") or []
    if not blocks:
        return False, "empty_blocks"
    if spotlight.get("error"):
        return False, f"schema_error:{spotlight.get('error')}"
    ev = eval_spotlight_v2(spotlight, lesson_id)
    if not ev["pass"]:
        return False, f"eval_fail:{ev.get('struct_errors') or ev.get('semantic')}"
    return True, "ok"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    promoted: list[str] = []
    skipped: dict[str, list[str]] = {}

    for src in sorted(SCHEMA_DIR.glob("*.spotlight.yml")):
        lesson_id = src.stem.replace(".spotlight", "")
        try:
            sp = load_spotlight_yaml(src)
        except Exception as exc:
            skipped.setdefault("load_error", []).append(f"{lesson_id}:{exc}")
            continue

        ok, reason = should_promote(lesson_id, sp)
        if not ok:
            skipped.setdefault(reason.split(":")[0], []).append(lesson_id)
            continue

        dst = CATALOG_DIR / src.name
        if args.dry_run:
            promoted.append(lesson_id)
            continue

        CATALOG_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        promoted.append(lesson_id)

    manifest = {
        "description": "Auto-promoted from private/_online-schema (eval pass, excl dev7/test15)",
        "count": len(promoted),
        "lessons": sorted(promoted),
    }

    if not args.dry_run:
        CATALOG_DIR.mkdir(parents=True, exist_ok=True)
        MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"promoted: {len(promoted)}")
    print(f"skipped buckets: { {k: len(v) for k, v in skipped.items()} }")
    if args.dry_run:
        print("(dry-run — no files written)")
    else:
        print(f"manifest: {MANIFEST_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
