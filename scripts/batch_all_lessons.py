#!/usr/bin/env python3
"""
batch_all_lessons.py — issue #2210
Batch-run build_lesson_schema.py for ALL 151 lessons.
Auto-discovers DOCX files, assigns lesson IDs, runs sequentially,
logs every result (success/fail/crash). No error swallowing.

Usage:
    python3 scripts/batch_all_lessons.py [--output-dir DIR] [--log-file FILE]
    python3 scripts/batch_all_lessons.py --dry-run          # just print discovered lessons
"""

import sys
import re
import os
import json
import time
import argparse
import traceback
from pathlib import Path

# ── DOCX discovery ──────────────────────────────────────────────────────────

CURRICULUM_ROOT = Path(
    "/Users/young/project/chinese-literacy-platform/"
    "private/curriculum-source/2026-05-01"
)

# Priority order: 1-1教師版 > 第三階段 > 自學教材兩個單元
# For duplicate IDs, prefer first match in priority order.
SEARCH_DIRS = [
    CURRICULUM_ROOT / "1.L1-158新版完成學習單1150415" / "1-1教師版(L1~122)",
    CURRICULUM_ROOT / "1.L1-158新版完成學習單1150415" / "第三階段(L123開始~L157)差學生版",
    CURRICULUM_ROOT / "自學教材兩個單元",
]


def normalize_fname(fname: str) -> str:
    """Normalize fullwidth characters in filename."""
    return (
        fname
        .replace("Ｇ", "G")
        .replace("．", ".")
        .replace("－", "-")
        .replace("～", "~")
    )


def extract_lesson_id(fname: str) -> str | None:
    """
    Extract canonical lesson ID from DOCX filename.
    e.g. 'G4-L20-22物以稀為貴.docx' → 'G4-L20'
         '文-L1假新聞.docx' → '文-L1'
         'Ｇ8-L11虎襲事件.docx' → 'G8-L11'
    For multi-lesson files (G4-L20-22), take the first lesson number as ID
    and record the range as a note.
    """
    fn = normalize_fname(fname)
    m = re.match(r"^(G\d+|文)-L(\d+(?:[~\-]\d+)?)", fn)
    if not m:
        return None
    grade = m.group(1)
    lesson_part = m.group(2)
    # Take first number in any range notation
    first_num = re.match(r"\d+", lesson_part).group()
    return f"{grade}-L{first_num}"


def discover_lessons() -> list[tuple[str, Path]]:
    """
    Discover all lessons in priority order.
    Returns list of (lesson_id, docx_path), deduped by lesson_id.
    """
    seen_ids: dict[str, Path] = {}
    ordered: list[tuple[str, Path]] = []

    for search_dir in SEARCH_DIRS:
        if not search_dir.exists():
            print(f"WARNING: search dir not found: {search_dir}", file=sys.stderr)
            continue
        # Walk recursively, sort for determinism
        for root, dirs, files in os.walk(search_dir):
            dirs.sort()
            for fname in sorted(files):
                if not fname.endswith(".docx"):
                    continue
                if "學生版" in fname:
                    continue
                lid = extract_lesson_id(fname)
                if lid is None:
                    print(
                        f"WARNING: could not extract lesson ID from: {fname}",
                        file=sys.stderr,
                    )
                    continue
                fpath = Path(root) / fname
                if lid not in seen_ids:
                    seen_ids[lid] = fpath
                    ordered.append((lid, fpath))
                # else: duplicate — keep first (higher-priority dir)

    return ordered


# ── Batch runner ─────────────────────────────────────────────────────────────

def run_batch(
    lessons: list[tuple[str, Path]],
    output_dir: Path,
    log_file: Path,
) -> dict:
    """
    Run build_lesson_schema.py for each lesson sequentially.
    Returns summary dict with per-lesson results.
    """
    # Import the build script as a module from the same repo
    script_dir = Path(__file__).parent
    sys.path.insert(0, str(script_dir))

    # Import process_lesson from build_lesson_schema
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "build_lesson_schema",
        script_dir / "build_lesson_schema.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    process_lesson = mod.process_lesson

    output_dir.mkdir(parents=True, exist_ok=True)
    results = {}  # lesson_id → result dict

    print(f"\n{'='*70}")
    print(f"BATCH RUN: {len(lessons)} lessons → {output_dir}")
    print(f"{'='*70}\n")

    for i, (lid, docx_path) in enumerate(lessons, 1):
        print(f"\n[{i:3d}/{len(lessons)}] {lid}  {docx_path.name[:60]}")
        start = time.time()
        result = {
            "lesson_id": lid,
            "docx_path": str(docx_path),
            "docx_filename": docx_path.name,
            "status": None,
            "kp_path": None,
            "sp_path": None,
            "kp_rows": None,
            "sp_blocks": None,
            "null_answers": None,
            "asset_count": None,
            "family": None,
            "strategy_type": None,
            "error": None,
            "traceback": None,
            "duration_s": None,
        }

        try:
            kp_schema, sp_schema, assets = process_lesson(
                lid, str(docx_path), str(output_dir)
            )
            elapsed = time.time() - start

            # Extract metadata from results
            sp_inner = sp_schema.get("spotlight", {})
            kp_inner = kp_schema.get("keypoints", {}) if kp_schema else {}

            result.update(
                {
                    "status": "success",
                    "kp_path": str(output_dir / f"{lid}.keypoints.yml"),
                    "sp_path": str(output_dir / f"{lid}.spotlight.yml"),
                    "kp_rows": len(kp_inner.get("rows", [])) if kp_inner else 0,
                    "sp_blocks": len(sp_inner.get("blocks", [])),
                    "null_answers": sp_inner.get("_null_answers", []),
                    "asset_count": len(assets) if assets else 0,
                    "family": sp_inner.get("family", "unknown"),
                    "strategy_type": sp_inner.get("strategy_type", "unknown"),
                    "duration_s": round(elapsed, 2),
                }
            )

            null_count = len(result["null_answers"])
            print(
                f"  OK — family={result['family']} "
                f"kp_rows={result['kp_rows']} "
                f"sp_blocks={result['sp_blocks']} "
                f"assets={result['asset_count']} "
                f"null={null_count} "
                f"({elapsed:.1f}s)"
            )

        except KeyboardInterrupt:
            print("\nInterrupted by user.")
            results[lid] = result
            _save_log(results, log_file)
            sys.exit(1)

        except Exception as e:
            elapsed = time.time() - start
            tb = traceback.format_exc()
            result.update(
                {
                    "status": "crash",
                    "error": str(e),
                    "traceback": tb,
                    "duration_s": round(elapsed, 2),
                }
            )
            print(f"  CRASH: {e}")
            print(f"  {tb.splitlines()[-1]}")

        results[lid] = result

        # Save log incrementally so we can inspect during run
        if i % 10 == 0 or i == len(lessons):
            _save_log(results, log_file)
            print(f"  [checkpoint saved → {log_file}]")

    _save_log(results, log_file)
    return results


def _save_log(results: dict, log_file: Path):
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with open(log_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)


def print_summary(results: dict):
    total = len(results)
    successes = [r for r in results.values() if r["status"] == "success"]
    crashes = [r for r in results.values() if r["status"] == "crash"]
    unknown_family = [
        r for r in successes if r.get("family") in ("unknown", None)
    ]
    total_null = sum(len(r.get("null_answers") or []) for r in successes)

    # Family distribution
    family_counts: dict[str, int] = {}
    for r in successes:
        fam = r.get("family") or "unknown"
        family_counts[fam] = family_counts.get(fam, 0) + 1

    print(f"\n{'='*70}")
    print("BATCH SUMMARY")
    print(f"{'='*70}")
    print(f"Total discovered   : {total}")
    print(f"Success            : {len(successes)}")
    print(f"Crash              : {len(crashes)}")
    print(f"Unknown family     : {len(unknown_family)}")
    print(f"Total null answers : {total_null}")
    print()
    print("Family distribution:")
    for fam, cnt in sorted(family_counts.items(), key=lambda x: -x[1]):
        print(f"  {fam:<25s}: {cnt}")

    if crashes:
        print(f"\nCRASHED LESSONS ({len(crashes)}):")
        for r in crashes:
            print(f"  {r['lesson_id']:15s}  {r['error'][:80]}")

    if unknown_family:
        print(f"\nUNKNOWN FAMILY ({len(unknown_family)}):")
        for r in unknown_family:
            print(f"  {r['lesson_id']:15s}  {r['strategy_type']}")

    print()
    print(f"Success rate: {len(successes)}/{total} = {len(successes)/total*100:.1f}%")


# ── CLI ──────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Batch build lesson schemas for all 151 lessons"
    )
    parser.add_argument(
        "--output-dir",
        default="private/curriculum-source/_online-schema",
        help="Output directory for YAML files",
    )
    parser.add_argument(
        "--log-file",
        default="private/curriculum-source/_online-schema/batch_run_log.json",
        help="JSON log file to record per-lesson results",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Just print discovered lessons, don't process",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip lessons already in log file (by status=success)",
    )
    args = parser.parse_args()

    # Discover all lessons
    lessons = discover_lessons()
    print(f"Discovered {len(lessons)} unique lessons.")

    if args.dry_run:
        for lid, fpath in lessons:
            rel = str(fpath).split("curriculum-source/")[1]
            print(f"  {lid:<15s}  {rel[:80]}")
        return

    # Resume: skip already-successful lessons
    if args.resume:
        log_path = Path(args.log_file)
        if log_path.exists():
            with open(log_path) as f:
                existing = json.load(f)
            done = {lid for lid, r in existing.items() if r.get("status") == "success"}
            lessons = [(lid, p) for lid, p in lessons if lid not in done]
            print(f"Resuming: {len(lessons)} lessons remaining (skipped {len(done)} already done).")

    output_dir = Path(args.output_dir)
    log_file = Path(args.log_file)

    results = run_batch(lessons, output_dir, log_file)
    print_summary(results)
    print(f"\nLog saved to: {log_file}")


if __name__ == "__main__":
    main()
