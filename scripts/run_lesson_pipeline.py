#!/usr/bin/env python3
"""
run_lesson_pipeline.py — issue #2212
One-shot orchestrator: assess → build → eval → qa-gate → registry.

Thin glue layer — reuses build_lesson_schema / eval_lesson_schema /
build_lesson_registry logic via import. No logic is duplicated.

Usage:
    # Single lesson
    python3 scripts/run_lesson_pipeline.py G6-L22 <path/to/G6-L22.docx>

    # All lessons (auto-discovers DOCX files, same as batch_all_lessons)
    python3 scripts/run_lesson_pipeline.py --all

    # Options
    python3 scripts/run_lesson_pipeline.py --all --output-dir DIR --log-file FILE
    python3 scripts/run_lesson_pipeline.py --all --dry-run    # discover only

Per-lesson pipeline stages
    1. Assess   — detect strategy family from filename (router)
    2. Build    — produce <id>.spotlight.yml + <id>.keypoints.yml + assets
    3. Eval     — compute SP / KP metrics (row_recall, blank_recall, ...)
    4. QA gate  — quantitative pass/fail + print human-review checklist (no auto-semantic-pass)
    5. Registry — write docs/lesson-schema-registry.yaml

Exit codes:
    0 — all lessons pass QA gate (or --all with 0 qa failures)
    1 — one or more lessons fail QA gate
"""

import sys
import json
import time
import traceback
import argparse
import importlib.util
from pathlib import Path

# ── Defaults ─────────────────────────────────────────────────────────────────

REPO_ROOT    = Path(__file__).parent.parent
SCHEMA_DIR   = REPO_ROOT / "private/curriculum-source/_online-schema"
LOG_FILE     = SCHEMA_DIR / "batch_run_log.json"
REGISTRY_OUT = REPO_ROOT / "docs/lesson-schema-registry.yaml"

# ── Module loaders ────────────────────────────────────────────────────────────

def _load_module(name: str, relpath: str):
    """Load a sibling script as a module without duplicating its logic."""
    path = Path(__file__).parent / relpath
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _get_bls():
    return _load_module("bls", "build_lesson_schema.py")


def _get_ev():
    return _load_module("ev", "eval_lesson_schema.py")


def _get_reg():
    return _load_module("reg", "build_lesson_registry.py")


def _get_bat():
    return _load_module("bat", "batch_all_lessons.py")


# ── Stage implementations ─────────────────────────────────────────────────────

def stage_assess(lesson_id: str, docx_path: Path, bls) -> dict:
    """Stage 1: Detect strategy family from filename (router)."""
    sname, stype = bls.detect_strategy_from_filename(str(docx_path))
    return {
        "strategy_type": stype,
        "strategy_name": sname,
        "family_unknown": stype == "unknown",
    }


def stage_build(lesson_id: str, docx_path: Path, schema_dir: Path, bls) -> dict:
    """Stage 2: Build spotlight.yml + keypoints.yml + assets."""
    start = time.time()
    try:
        kp_schema, sp_schema, assets = bls.process_lesson(
            lesson_id, str(docx_path), str(schema_dir)
        )
        elapsed = round(time.time() - start, 2)
        sp_inner = sp_schema.get("spotlight", {}) if sp_schema else {}
        kp_inner = kp_schema.get("keypoints", {}) if kp_schema else {}
        return {
            "ok": True,
            "strategy_type": sp_inner.get("strategy_type", "unknown"),
            "family": sp_inner.get("family", "unknown"),
            "kp_rows": len(kp_inner.get("rows", [])) if kp_inner else 0,
            "sp_blocks": len(sp_inner.get("blocks", [])) if sp_inner else 0,
            "null_answers": sp_inner.get("_null_answers", []),
            "asset_count": len(assets) if assets else 0,
            "duration_s": elapsed,
            "error": None,
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "traceback": traceback.format_exc(),
            "duration_s": round(time.time() - start, 2),
        }


def stage_eval(lesson_id: str, docx_path: Path, schema_dir: Path, ev, bls) -> dict:
    """Stage 3: Compute eval metrics."""
    try:
        result = ev.eval_lesson(lesson_id, docx_path, schema_dir, bls)
        return {"ok": True, "result": result, "error": None}
    except Exception as exc:
        return {"ok": False, "result": None, "error": str(exc)}


def stage_qa_gate(lesson_id: str, assess: dict, build: dict, ev_result) -> dict:
    """
    Stage 4: Quantitative QA gate + human-review checklist.

    Pass criteria (ALL must hold):
      - Build succeeded
      - SP available -> SP pass (answer_recall >= 0.99, guide_retained, mcq_leakage == 0)
      - KP available -> KP pass (row_recall >= 0.95, blank_recall >= 0.95, nesting_preserved)
      - strategy_type != 'unknown'

    Semantic quality cannot be auto-verified — printed as human-review checklist only.
    This function NEVER auto-passes semantic content.
    """
    flags = []        # quantitative failures
    review_items = [] # human-review items (always printed)

    if not build["ok"]:
        flags.append(f"BUILD_FAILED: {build.get('error', 'unknown')}")
        return {
            "pass": False,
            "flags": flags,
            "review_items": review_items,
            "sp_pass": None,
            "kp_pass": None,
        }

    strategy_type = build.get("strategy_type", "unknown")
    family = build.get("family", "unknown")
    null_answers = build.get("null_answers", [])

    # Fail-closed: if eval crashed, mark as failed rather than silently passing
    eval_error = build.get("eval_error")
    if eval_error:
        flags.append(f"EVAL_ERROR: {str(eval_error)[:80]}")

    if strategy_type == "unknown":
        flags.append("STRATEGY_UNKNOWN: filename may lack strategy bracket or be unrecognized")

    sp_pass = None
    kp_pass = None

    if ev_result:
        sp = ev_result.get("spotlight", {})
        kp = ev_result.get("keypoints", {})

        if sp.get("available"):
            sp_pass = sp.get("pass", False)
            if not sp_pass:
                ar = sp.get("answer_recall", 0.0)
                mcq = sp.get("mcq_leakage", 0)
                guide = sp.get("guide_retained", True)
                if ar < 0.99:
                    flags.append(f"SP_LOW_ANSWER_RECALL: {ar:.3f} < 0.99")
                if mcq > 0:
                    flags.append(f"SP_MCQ_LEAKAGE: {mcq} blocks have MCQ-style prompt")
                if not guide:
                    flags.append("SP_GUIDE_MISSING: no guide block in spotlight")

        if kp.get("available"):
            kp_pass = kp.get("pass", False)
            if not kp_pass:
                rr = kp.get("row_recall", 0.0)
                br = kp.get("blank_recall", 0.0)
                np_ = kp.get("nesting_preserved", True)
                if rr < 0.95:
                    flags.append(f"KP_LOW_ROW_RECALL: {rr:.3f} < 0.95")
                if br < 0.95:
                    flags.append(f"KP_LOW_BLANK_RECALL: {br:.3f} < 0.95")
                if not np_:
                    flags.append("KP_NESTING_LOST: 3-col DOCX table not encoded as nested/hint_value")

    # Null answers always warrant human review
    if null_answers:
        review_items.append(
            f"[null answers] {len(null_answers)} spotlight Q(s) have null answer -- "
            f"verify expected or extraction gap: {null_answers[:5]}"
        )

    # Human-review checklist (semantic, always print)
    review_items += [
        "[semantic] Verify spotlight guide text matches original worksheet description sections",
        "[semantic] Verify keypoints blank answers match worksheet fill-in content",
        f"[family]   Confirm family={family!r} matches actual strategy pedagogy",
        "[assets]   Check extracted image assets render correctly (if figure_count > 0)",
    ]

    passed = (
        build["ok"]
        and not flags
        # strategy_type != 'unknown' is already enforced via STRATEGY_UNKNOWN flag above
    )

    return {
        "pass": passed,
        "flags": flags,
        "review_items": review_items,
        "sp_pass": sp_pass,
        "kp_pass": kp_pass,
    }


# ── Per-lesson orchestrator ───────────────────────────────────────────────────

def run_one(lesson_id: str, docx_path: Path, schema_dir: Path,
            bls, ev, verbose: bool = True) -> dict:
    """
    Run all 4 stages for a single lesson. Catches exceptions so one crash
    does not abort a batch run.

    Returns result dict with keys:
        lesson_id, family, build_ok, sp_pass, kp_pass, sp_ar, kp_rr,
        qa_pass, flags, review_items, null_answers, error
    """
    docx_path = Path(docx_path)
    if not docx_path.exists():
        _missing_build = {"ok": False, "kp_rows": None, "sp_blocks": None,
                          "null_answers": [], "asset_count": 0,
                          "family": "unknown", "strategy_type": "unknown",
                          "error": f"DOCX not found: {docx_path}", "duration_s": None}
        return {
            "lesson_id": lesson_id,
            "family": "unknown",
            "build_ok": False,
            "sp_pass": None,
            "kp_pass": None,
            "sp_ar": None,
            "kp_rr": None,
            "qa_pass": False,
            "flags": [f"DOCX_NOT_FOUND: {docx_path}"],
            "review_items": [],
            "null_answers": [],
            "error": f"DOCX not found: {docx_path}",
            "_build": _missing_build,
        }

    if verbose:
        print(f"\n[pipeline] {lesson_id}  {docx_path.name[:60]}")

    # Stage 1 — assess
    assess = stage_assess(lesson_id, docx_path, bls)
    if verbose:
        print(f"  1 assess  -- strategy_type={assess['strategy_type']}")

    # Stage 2 — build
    build = stage_build(lesson_id, docx_path, schema_dir, bls)
    if verbose:
        if build["ok"]:
            print(
                f"  2 build   -- family={build['family']} "
                f"sp_blocks={build['sp_blocks']} kp_rows={build['kp_rows']} "
                f"assets={build['asset_count']} null={len(build['null_answers'])} "
                f"({build['duration_s']}s)"
            )
        else:
            print(f"  2 build   -- FAILED: {build['error']}")

    # Stage 3 — eval
    ev_result = None
    sp_ar = None
    kp_rr = None
    if build["ok"]:
        ev_stage = stage_eval(lesson_id, docx_path, schema_dir, ev, bls)
        if ev_stage["ok"]:
            ev_result = ev_stage["result"]
            sp = ev_result.get("spotlight", {})
            kp = ev_result.get("keypoints", {})
            sp_ar = sp.get("answer_recall") if sp.get("available") else None
            kp_rr = kp.get("row_recall") if kp.get("available") else None
            if verbose:
                sp_str = (
                    f"PASS(ar={sp_ar:.3f})" if sp.get("pass") else
                    (f"FAIL(ar={sp_ar:.3f})" if sp.get("available") else "N/A")
                )
                kp_str = (
                    f"PASS(rr={kp_rr:.3f})" if kp.get("pass") else
                    (f"FAIL(rr={kp_rr:.3f})" if kp.get("available") else "N/A")
                )
                print(f"  3 eval    -- SP:{sp_str}  KP:{kp_str}")
        else:
            if verbose:
                print(f"  3 eval    -- ERROR: {ev_stage['error']}")
            # Fail-closed: eval crash → pass eval_error flag to qa_gate
            build["eval_error"] = ev_stage["error"]

    # Stage 4 — QA gate
    qa = stage_qa_gate(lesson_id, assess, build, ev_result)
    if verbose:
        gate_str = "PASS" if qa["pass"] else "FAIL"
        print(f"  4 qa gate -- {gate_str}")
        if qa["flags"]:
            for flag in qa["flags"]:
                print(f"              FLAG: {flag}")
        print(f"  -- Human review checklist --")
        for item in qa["review_items"]:
            print(f"     * {item}")

    return {
        "lesson_id": lesson_id,
        "family": build.get("family", assess.get("strategy_type", "unknown")),
        "build_ok": build["ok"],
        "sp_pass": qa["sp_pass"],
        "kp_pass": qa["kp_pass"],
        "sp_ar": sp_ar,
        "kp_rr": kp_rr,
        "qa_pass": qa["pass"],
        "flags": qa["flags"],
        "review_items": qa["review_items"],
        "null_answers": build.get("null_answers", []) if build["ok"] else [],
        "error": build.get("error") if not build["ok"] else None,
        # _build carries the full stage_build result for _update_log (avoids stub bug)
        "_build": build,
    }


# ── Log helpers ───────────────────────────────────────────────────────────────

def _update_log(lesson_id: str, docx_path: Path, build: dict, log_file: Path):
    """Append / update one lesson entry in batch_run_log.json."""
    log = {}
    if log_file.exists():
        with open(log_file, encoding="utf-8") as f:
            log = json.load(f)

    status = "success" if build["ok"] else "crash"
    log[lesson_id] = {
        "lesson_id": lesson_id,
        "docx_path": str(docx_path),
        "docx_filename": docx_path.name,
        "status": status,
        "kp_path": str(log_file.parent / f"{lesson_id}.keypoints.yml") if build["ok"] else None,
        "sp_path": str(log_file.parent / f"{lesson_id}.spotlight.yml") if build["ok"] else None,
        "kp_rows":  build.get("kp_rows")  if build["ok"] else None,
        "sp_blocks": build.get("sp_blocks") if build["ok"] else None,
        "null_answers": build.get("null_answers", []) if build["ok"] else [],
        "asset_count": build.get("asset_count", 0) if build["ok"] else 0,
        "family": build.get("family", "unknown"),
        "strategy_type": build.get("strategy_type", "unknown"),
        "error": build.get("error") if not build["ok"] else None,
        "duration_s": build.get("duration_s"),
    }

    log_file.parent.mkdir(parents=True, exist_ok=True)
    with open(log_file, "w", encoding="utf-8") as f:
        json.dump(log, f, ensure_ascii=False, indent=2)


# ── Registry rebuild ──────────────────────────────────────────────────────────

def rebuild_registry(log_file: Path, schema_dir: Path, registry_out: Path):
    """Rebuild docs/lesson-schema-registry.yaml from current log + schema files."""
    reg = _get_reg()
    entries = reg.build_registry(log_file=log_file, schema_dir=schema_dir, run_eval=False)
    reg.print_summary(entries)
    reg.write_registry(entries, registry_out)


# ── Summary printer ───────────────────────────────────────────────────────────

def print_pipeline_summary(results: list, elapsed_total: float):
    from collections import Counter

    total    = len(results)
    crashes  = [r for r in results if not r["build_ok"]]
    qa_fail  = [r for r in results if r["build_ok"] and not r["qa_pass"]]
    qa_pass  = [r for r in results if r["qa_pass"]]
    need_rev = [r for r in results if r.get("null_answers")]

    sp_eligible = [r for r in results if r["sp_pass"] is not None]
    kp_eligible = [r for r in results if r["kp_pass"] is not None]
    sp_pass_n   = sum(1 for r in sp_eligible if r["sp_pass"])
    kp_pass_n   = sum(1 for r in kp_eligible if r["kp_pass"])
    sp_rate     = sp_pass_n / len(sp_eligible) * 100 if sp_eligible else 0.0
    kp_rate     = kp_pass_n / len(kp_eligible) * 100 if kp_eligible else 0.0

    families = Counter(r["family"] for r in results)

    print(f"\n{'='*70}")
    print(f"PIPELINE SUMMARY  ({total} lessons, {elapsed_total:.1f}s total)")
    print(f"{'='*70}")
    print(f"Build OK:        {total - len(crashes)}/{total}")
    print(f"QA gate PASS:    {len(qa_pass)}/{total}")
    print(f"Spotlight PASS:  {sp_pass_n}/{len(sp_eligible)} eligible ({sp_rate:.1f}%)")
    print(f"Keypoints PASS:  {kp_pass_n}/{len(kp_eligible)} eligible ({kp_rate:.1f}%)")

    if crashes:
        print(f"\nCrashed ({len(crashes)}):")
        for r in crashes:
            print(f"  {r['lesson_id']}: {str(r.get('error', ''))[:80]}")

    if qa_fail:
        print(f"\nQA gate FAIL ({len(qa_fail)}):")
        for r in qa_fail:
            print(f"  {r['lesson_id']}: {', '.join(r['flags'][:3])}")

    if need_rev:
        print(f"\nNeeds human review -- null answers ({len(need_rev)}):")
        for r in need_rev:
            print(f"  {r['lesson_id']}: {len(r['null_answers'])} null(s)")

    print(f"\nFamily distribution:")
    for fam, count in sorted(families.items(), key=lambda x: -x[1]):
        print(f"  {fam}: {count}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("lesson_id",  nargs="?",
                        help="Lesson ID for single-lesson mode (e.g. G6-L22)")
    parser.add_argument("docx_path",  nargs="?",
                        help="Path to DOCX file for single-lesson mode")
    parser.add_argument("--all", action="store_true",
                        help="Batch mode: discover and process all DOCX files")
    parser.add_argument("--output-dir",   default=str(SCHEMA_DIR),
                        help=f"Schema output directory (default: {SCHEMA_DIR})")
    parser.add_argument("--log-file",     default=str(LOG_FILE),
                        help=f"Batch run log JSON (default: {LOG_FILE})")
    parser.add_argument("--registry-out", default=str(REGISTRY_OUT),
                        help=f"Registry output YAML (default: {REGISTRY_OUT})")
    parser.add_argument("--dry-run", action="store_true",
                        help="Discover lessons and print list (--all only, no processing)")
    args = parser.parse_args()

    if not args.all and not (args.lesson_id and args.docx_path):
        parser.error("Provide lesson_id + docx_path for single-lesson mode, or use --all")

    schema_dir   = Path(args.output_dir)
    log_file     = Path(args.log_file)
    registry_out = Path(args.registry_out)

    bls = _get_bls()
    ev  = _get_ev()

    # Dry-run: discover only
    if args.dry_run:
        bat = _get_bat()
        lessons = bat.discover_lessons()
        print(f"Discovered {len(lessons)} lessons:")
        for lid, p in lessons:
            print(f"  {lid}  {p.name[:70]}")
        return

    t0 = time.time()

    if args.all:
        bat = _get_bat()
        lessons = bat.discover_lessons()
        print(f"\nDiscovered {len(lessons)} lessons")

        results = []
        for i, (lid, docx_path) in enumerate(lessons, 1):
            print(f"\n[{i:3d}/{len(lessons)}]", end="")
            r = run_one(lid, docx_path, schema_dir, bls, ev, verbose=True)
            results.append(r)

            # Update log incrementally with actual build result (crash recovery)
            _update_log(lid, docx_path, r["_build"], log_file)

        elapsed = time.time() - t0
        print_pipeline_summary(results, elapsed)

        print("\nRebuilding registry...")
        rebuild_registry(log_file, schema_dir, registry_out)

        qa_fails = [r for r in results if not r["qa_pass"]]
        if qa_fails:
            print(f"\n{len(qa_fails)} lesson(s) did not pass QA gate.")
            sys.exit(1)

    else:
        # Single lesson mode
        lesson_id = args.lesson_id
        docx_path = Path(args.docx_path)
        schema_dir.mkdir(parents=True, exist_ok=True)

        result = run_one(lesson_id, docx_path, schema_dir, bls, ev, verbose=True)
        elapsed = time.time() - t0

        print(
            f"\nResult: qa_pass={result['qa_pass']}  build_ok={result['build_ok']}  "
            f"family={result['family']}  sp_pass={result['sp_pass']}  "
            f"kp_pass={result['kp_pass']}  ({elapsed:.1f}s)"
        )

        if result["flags"]:
            print("Flags:")
            for f_ in result["flags"]:
                print(f"  {f_}")

        # Update log + registry with actual build result
        _update_log(lesson_id, docx_path, result["_build"], log_file)

        if log_file.exists():
            print("\nUpdating registry...")
            rebuild_registry(log_file, schema_dir, registry_out)

        sys.exit(0 if result["qa_pass"] else 1)


if __name__ == "__main__":
    main()
