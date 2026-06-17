#!/usr/bin/env python3
"""
diagnose_unknown_family.py — issue #2214
Diagnose remaining family=unknown lessons after registry rebuild.

For each unknown lesson:
  - Look up production YAML (via normalize_manifest_code)
  - Report: reading_strategy_type / reading_strategy / has_strategy_exercise
  - Assign B-bucket (recoverable) vs C-bucket (stays unknown)
  - Output: console table + docs/unknown-family-c-bucket.tsv (for manual annotation)

Usage:
    python3 scripts/diagnose_unknown_family.py
    python3 scripts/diagnose_unknown_family.py --registry docs/lesson-schema-registry.yaml
"""

import sys
import yaml
import importlib.util
import argparse
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
PARSED_YAML_DIR = REPO_ROOT / "backend/data/lessons/_parsed_2026-05-01"
REGISTRY_PATH = REPO_ROOT / "docs/lesson-schema-registry.yaml"
TSV_OUT = REPO_ROOT / "docs/unknown-family-c-bucket.tsv"

# Multi-lesson YAML key remapping
MULTI_MAP = {
    "G9-L15": "G9-L15-16",
    "G9-L17": "G9-L17-19",
}


def load_registry(path: Path) -> list:
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data.get("lessons", [])


def load_bls():
    bls_path = Path(__file__).parent / "build_lesson_schema.py"
    spec = importlib.util.spec_from_file_location("bls", bls_path)
    bls = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bls)
    return bls


def get_production_yaml_info(lesson_id: str) -> dict:
    if not PARSED_YAML_DIR.exists():
        return {"found": False}
    key = MULTI_MAP.get(lesson_id, lesson_id)
    path = PARSED_YAML_DIR / f"{key}.yml"
    if not path.exists():
        return {"found": False, "yaml_key": key}
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return {
        "found": True,
        "yaml_key": key,
        "reading_strategy": (data.get("reading_strategy") or "").strip(),
        "reading_strategy_type": (data.get("reading_strategy_type") or "").strip(),
        "has_strategy_exercise": data.get("strategy_exercise") is not None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--registry", default=str(REGISTRY_PATH))
    args = parser.parse_args()

    registry = load_registry(Path(args.registry))
    bls = load_bls()

    # Strategy type → family (from build_lesson_registry.py)
    from scripts.build_lesson_registry import _strategy_to_family

    unknown_lessons = [e for e in registry if e.get("family") == "unknown"]
    print(f"Found {len(unknown_lessons)} family=unknown lessons in registry.\n")

    B_bucket = []
    C_bucket = []

    header = f"{'lesson_id':12s} | {'grade':5s} | {'rst':25s} | {'rs_name':40s} | {'has_se':6s} | {'taxonomy_st':25s} | BUCKET"
    print(header)
    print("-" * len(header))

    for entry in unknown_lessons:
        lid = entry["lesson_id"]
        grade = entry.get("grade", "?")
        info = get_production_yaml_info(lid)

        if not info.get("found"):
            bucket = "C"
            rst = "NOT_FOUND"
            rs = ""
            has_se = False
            taxonomy_st = ""
        else:
            rst = info["reading_strategy_type"]
            rs = info["reading_strategy"]
            has_se = info["has_strategy_exercise"]

            # Try taxonomy router on reading_strategy name
            taxonomy_st = ""
            if rs:
                _, st_code = bls.detect_strategy_from_filename(f"dummy({rs}).docx")
                if st_code and st_code != "unknown":
                    taxonomy_st = st_code

            # Bucket decision: B if we can get a non-unknown family
            resolved = _strategy_to_family(taxonomy_st) if taxonomy_st else "unknown"
            if rst and rst not in ("general", "") and _strategy_to_family(rst) != "unknown":
                resolved = _strategy_to_family(rst)

            if resolved != "unknown":
                bucket = "B"
                B_bucket.append({
                    "lesson_id": lid,
                    "strategy_type": taxonomy_st or rst,
                    "family": resolved,
                    "reading_strategy": rs,
                })
            else:
                bucket = "C"
                C_bucket.append({
                    "lesson_id": lid,
                    "grade": grade,
                    "title": entry.get("title", ""),
                    "reading_strategy": rs,
                    "reading_strategy_type": rst,
                    "has_se": has_se,
                    "note": "strategy_source_both_empty" if not rs else "rst=general_no_usable_type",
                })

        print(f"{lid:12s} | {grade:5s} | {rst:25s} | {rs[:40]:40s} | {str(has_se):6s} | {taxonomy_st:25s} | {bucket}")

    print(f"\n{'='*60}")
    print(f"B-bucket (recoverable):  {len(B_bucket)} lessons")
    for b in B_bucket:
        print(f"  {b['lesson_id']:12s} → {b['strategy_type']:25s} → {b['family']}")

    print(f"\nC-bucket (stays unknown): {len(C_bucket)} lessons")
    for c in C_bucket:
        print(f"  {c['lesson_id']:12s} — {c['note']}")

    # Write C-bucket TSV for manual annotation
    if C_bucket:
        TSV_OUT.parent.mkdir(parents=True, exist_ok=True)
        with open(TSV_OUT, "w", encoding="utf-8") as f:
            f.write("lesson_id\tgrade\ttitle\treading_strategy\treading_strategy_type\thas_strategy_exercise\tnote\tmanual_family\tmanual_strategy_type\n")
            for c in C_bucket:
                f.write(
                    f"{c['lesson_id']}\t{c['grade']}\t{c['title']}\t"
                    f"{c['reading_strategy']}\t{c['reading_strategy_type']}\t"
                    f"{c['has_se']}\t{c['note']}\t\t\n"
                )
        print(f"\nC-bucket TSV written to: {TSV_OUT}")
        print("Fill in 'manual_family' and 'manual_strategy_type' columns for human annotation.")

    print(f"\nSummary: {len(unknown_lessons)} unknown → {len(C_bucket)} remaining (C-bucket)")
    print("Re-run build_lesson_registry.py to regenerate registry with B-bucket recovered.")


if __name__ == "__main__":
    main()
