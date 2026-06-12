#!/usr/bin/env python3
"""
build_lesson_registry.py — issue #2212 / #2214 / #2146
Generate docs/lesson-schema-registry.yaml from batch_run_log.json + eval results.

The registry is the single source of truth for:
  - Which lessons have been processed
  - spotlight / keypoints pass status and scores
  - Known gaps

Usage:
    python3 scripts/build_lesson_registry.py
    python3 scripts/build_lesson_registry.py --log-file <path/to/batch_run_log.json>
    python3 scripts/build_lesson_registry.py --schema-dir <dir> --eval  # re-run eval too
    python3 scripts/build_lesson_registry.py --summary                   # print summary only

Output: docs/lesson-schema-registry.yaml (committed, no private data)
The batch log and schema YAMLs stay in private/ (gitignored).
"""

import sys
import json
import argparse
import importlib.util
from pathlib import Path

import yaml

# ── Defaults ────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).parent.parent
LOG_FILE = REPO_ROOT / "private/curriculum-source/_online-schema/batch_run_log.json"
SCHEMA_DIR = REPO_ROOT / "private/curriculum-source/_online-schema"
REGISTRY_OUT = REPO_ROOT / "docs/lesson-schema-registry.yaml"

# Known-gap lessons: strategy detection impossible from filename alone (no brackets)
KNOWN_GAPS = {"G4-L1", "G9-L10"}

# Production parsed YAML directory (for YAML fallback — B-bucket recovery #2214)
PARSED_YAML_DIR = REPO_ROOT / "backend/data/lessons/_parsed_2026-05-01"

# Multi-lesson YAML key remapping (same as lesson_code_normalization.py)
# The keys below are structural compound IDs, not lesson-specific overfit patterns.
# Each entry maps a primary curriculum slot to its compound YAML filename.
_MULTI_LESSON_PRIMARY = {
    "G9-L15": "G9-L15-16",   # noqa: overfit-lint-ok — compound YAML key, not hardcode
    "G9-L17": "G9-L17-19",   # noqa: overfit-lint-ok — compound YAML key, not hardcode
}

# Strategy type → family mapping (source: docs/issue-2205-eval-standard.md §5)
# Note: trait_match is a sub-case of trait_inference detected by table structure.
# For registry purposes we map all trait_inference to guided_steps (conservative).
_STRATEGY_TO_FAMILY = {
    # guided_steps catch-all
    "summary_pse": "guided_steps",
    "summary_structure": "guided_steps",
    "summary_keysentence": "guided_steps",
    "summary": "guided_steps",
    "trait_inference": "guided_steps",
    "emotion_inference": "guided_steps",
    "motivation_inference": "guided_steps",
    "main_idea_inference": "guided_steps",
    "causal_inference": "guided_steps",
    "evidence_finding": "guided_steps",
    "scientific_inquiry": "guided_steps",
    "problem_solving": "guided_steps",
    "express_opinion": "guided_steps",
    "self_questioning": "guided_steps",
    "writing_technique": "guided_steps",
    "classical_grammar": "guided_steps",
    "perspective_taking": "guided_steps",
    "sel_character": "guided_steps",
    "emotion_management": "guided_steps",
    "inference": "guided_steps",
    # image / table integration
    "image_text": "image_table",
    "table_text": "image_table",
    # comparison / info-organization
    "comparison": "comparison_table",
    "info_organization": "comparison_table",
    "multiple_perspectives": "comparison_table",
    # ordering
    "ordering": "ordering",
    # comparison / contrast (production YAML uses compare_contrast)
    "compare_contrast": "comparison_table",
    # classical Chinese (no spotlight by design)
    "classical_grammar": "guided_steps",
    "classical": "classical",
}


def _strategy_to_family(strategy_type: str) -> str:
    """Map a strategy_type string to the 6-family taxonomy."""
    return _STRATEGY_TO_FAMILY.get(strategy_type, "unknown")


# ── Load eval module ─────────────────────────────────────────────────────────

def load_eval():
    """Dynamically load eval_lesson_schema so we don't duplicate logic."""
    ev_path = Path(__file__).parent / "eval_lesson_schema.py"
    spec = importlib.util.spec_from_file_location("ev", ev_path)
    ev = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ev)
    return ev


def load_bls():
    bls_path = Path(__file__).parent / "build_lesson_schema.py"
    spec = importlib.util.spec_from_file_location("bls", bls_path)
    bls = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bls)
    return bls


# ── Family resolution ────────────────────────────────────────────────────────

def _resolve_family(lesson_id: str, log_entry: dict, schema_dir: Path) -> str:
    """
    Derive family from the generated spotlight.yml strategy_type field.
    The batch_run_log 'family' key is always 'unknown' (never populated by the
    pipeline). The spotlight.yml carries the correct strategy_type from the P1
    router expansion.

    Priority (#2214 / #2146 extended):
      0. Classical Chinese lessons (grade == '文') → 'classical' (no spotlight by design)
      1. spotlight.yml strategy_type (P1 router result)
      2. keypoints.yml strategy_type (if spotlight missing)
      3. batch_run_log strategy_type (fallback — same router, but older run)
      4. Production YAML fallback via reading_strategy_type / reading_strategy name
         (B-bucket recovery: only when production YAML has a usable strategy source)
      5. keypoints.yml row-label structure inference (#2146)
         (D-bucket: no spotlight section at all; infer from table shape, not lesson id)
      6. 'unknown'
    """
    # 0. Classical Chinese: grade prefix '文' → always 'classical', no spotlight expected
    if lesson_id.startswith("文-"):
        return "classical"

    # 1. Try spotlight.yml
    sp_path = schema_dir / f"{lesson_id}.spotlight.yml"
    if sp_path.exists():
        data = _load_yaml_safe(sp_path)
        if data:
            st = data.get("spotlight", {}).get("strategy_type", "")
            if st and st != "unknown":
                return _strategy_to_family(st)

    # 2. Try keypoints.yml
    kp_path = schema_dir / f"{lesson_id}.keypoints.yml"
    if kp_path.exists():
        data = _load_yaml_safe(kp_path)
        if data:
            st = data.get("keypoints", {}).get("strategy_type", "")
            if st and st != "unknown":
                return _strategy_to_family(st)

    # 3. Fallback to log strategy_type (same router, possibly older)
    st = log_entry.get("strategy_type", "") or ""
    if st and st != "unknown":
        return _strategy_to_family(st)

    # 4. Production YAML fallback (B-bucket recovery — #2214)
    #    Use production reading_strategy_type or run strategy_name through the
    #    DOCX taxonomy router. Only applied when a clear, non-'general' signal exists.
    family = _resolve_family_from_production_yaml(lesson_id)
    if family != "unknown":
        return family

    # 5. Keypoints row-label structure inference (D-bucket — #2146)
    #    Applied only when spotlight.yml confirms "spotlight range not found" — i.e.
    #    this lesson has NO spotlight section in the source document (not a pipeline
    #    failure, but a structural absence). Returns 'keypoints_only' when a
    #    keypoints table exists; 'unknown' otherwise. No lesson ids are hardcoded.
    sp_data = _load_yaml_safe(sp_path) if sp_path.exists() else None
    sp_error = ((sp_data.get("spotlight") if sp_data else None) or {}).get("error", "")
    if "spotlight range not found" in sp_error:
        kp_path = schema_dir / f"{lesson_id}.keypoints.yml"
        if kp_path.exists():
            inferred = _infer_family_from_keypoints_labels(kp_path)
            if inferred != "unknown":
                return inferred

    return "unknown"


def _resolve_family_from_production_yaml(lesson_id: str) -> str:
    """
    Fallback: resolve family by reading production YAML reading_strategy_type /
    reading_strategy fields via normalize_manifest_code key mapping.

    Returns 'unknown' when:
    - File not found
    - reading_strategy_type is 'general' or empty AND reading_strategy is empty
    - Resolved family is still 'unknown' after taxonomy lookup

    Does NOT accept 'general' as a valid rst — 'general' means the production
    YAML author could not determine a specific strategy type either.
    Classical lessons are already handled upstream (priority 0).
    """
    if not PARSED_YAML_DIR.exists():
        return "unknown"

    # Handle multi-lesson YAML keys (e.g. G9-L15 → G9-L15-16)
    yaml_key = _MULTI_LESSON_PRIMARY.get(lesson_id, lesson_id)
    path = PARSED_YAML_DIR / f"{yaml_key}.yml"
    if not path.exists():
        return "unknown"

    data = _load_yaml_safe(path)
    if not data:
        return "unknown"

    # Try explicit reading_strategy_type first (non-general only)
    rst = (data.get("reading_strategy_type") or "").strip()
    if rst and rst not in ("general", ""):
        family = _strategy_to_family(rst)
        if family != "unknown":
            return family

    # Fallback: run reading_strategy name through DOCX filename taxonomy router
    # This recovers lessons where rst='general' but reading_strategy has a specific name
    rs_name = (data.get("reading_strategy") or "").strip()
    if not rs_name:
        return "unknown"

    # Lazy-load build_lesson_schema to avoid circular import at module level
    try:
        import importlib.util as _ilu
        _bls_path = Path(__file__).parent / "build_lesson_schema.py"
        _spec = _ilu.spec_from_file_location("_bls_fallback", _bls_path)
        _bls = _ilu.module_from_spec(_spec)
        _spec.loader.exec_module(_bls)
        # detect_strategy_from_filename reads bracket from filename, but we can
        # pass a synthetic path: "dummy({rs_name}).docx"
        _, st_code = _bls.detect_strategy_from_filename(f"dummy({rs_name}).docx")
        if st_code and st_code != "unknown":
            family = _strategy_to_family(st_code)
            if family != "unknown":
                return family
    except Exception:
        pass

    return "unknown"



def _infer_family_from_keypoints_labels(kp_path: Path) -> str:
    """
    D-bucket inference (#2146): when a lesson has NO spotlight section at all
    (spotlight.yml contains 'spotlight range not found'), confirm that a
    keypoints table is present and return 'keypoints_only'.

    This function does NOT return 'guided_steps' — lessons without a spotlight
    section do not belong to the guided_steps family even if their keypoints
    table resembles a narrative or scientific-inquiry structure.  The caller
    (_resolve_family priority-5) uses 'keypoints_only' to signal:
      "this lesson has assessable keypoints but no spotlight; classify honestly."

    Returns 'keypoints_only' when a non-empty keypoints table is found.
    Returns 'unknown' when the file is missing, empty, or has no rows.
    """
    data = _load_yaml_safe(kp_path)
    if not data:
        return "unknown"

    kp_inner = data.get("keypoints", {})
    rows = kp_inner.get("rows", [])
    if not rows:
        return "unknown"

    # keypoints table present → honest label: has keypoints, no spotlight
    return "keypoints_only"


# ── Per-lesson entry builder ─────────────────────────────────────────────────

def build_entry(lesson_id: str, log_entry: dict, ev, bls, schema_dir: Path,
                run_eval: bool) -> dict:
    """Build one registry row from batch log + optional live eval."""
    status = log_entry.get("status", "unknown")
    docx_path = log_entry.get("docx_path")

    # Figures / tables detected during pipeline run
    n_figures = log_entry.get("asset_count") or 0

    # Null answers from batch run
    null_answers = log_entry.get("null_answers") or []

    # Family: derive from spotlight.yml strategy_type (fix #2212 / #2214)
    family = _resolve_family(lesson_id, log_entry, schema_dir)

    # Known gap
    known_gaps = []
    if family == "classical":
        known_gaps.append("classical_no_spotlight_by_design")
    elif family == "keypoints_only":
        # D-bucket (#2146): lesson has a keypoints table but NO spotlight section in the
        # source document. Honest label: classified by table presence, not strategy type.
        known_gaps.append("no_spotlight_section")
    elif family == "unknown":
        # C-bucket: both DOCX pipeline and production YAML could not determine strategy
        known_gaps.append("strategy_source_both_empty")

    if status != "success":
        return {
            "lesson_id": lesson_id,
            "grade": _grade(lesson_id),
            "title": _title_from_log(log_entry),
            "family": family,
            "spotlight_status": "error",
            "spotlight_score": None,
            "keypoints_status": "error",
            "keypoints_blank_recall": None,
            "n_figures": n_figures,
            "n_tables": None,
            "known_gaps": known_gaps + [f"pipeline_error: {log_entry.get('error', '')[:80]}"],
        }

    # Classical lessons have no spotlight by design — force status to 'none'
    if family == "classical":
        return {
            "lesson_id": lesson_id,
            "grade": _grade(lesson_id),
            "title": _title_from_log(log_entry),
            "family": "classical",
            "spotlight_status": "none",
            "spotlight_score": None,
            "keypoints_status": "none",
            "keypoints_blank_recall": None,
            "n_figures": n_figures,
            "n_tables": 0,
            "known_gaps": known_gaps,
        }

    # Eval from log (fast path) or live re-eval
    sp_pass = None
    sp_score = None
    kp_pass = None
    kp_blank_recall = None

    if run_eval and docx_path and Path(docx_path).exists():
        try:
            ev_result = ev.eval_lesson(lesson_id, Path(docx_path), schema_dir, bls)
            sp = ev_result.get("spotlight", {})
            kp = ev_result.get("keypoints", {})

            if sp.get("available"):
                sp_pass = sp.get("pass", False)
                sp_score = round(sp.get("answer_recall", 0.0), 3)
            else:
                sp_pass = None  # no spotlight section in this lesson

            if kp.get("available"):
                kp_pass = kp.get("pass", False)
                kp_blank_recall = round(kp.get("blank_recall", 0.0), 3)
            else:
                kp_pass = None  # no keypoints table in this lesson
        except Exception as exc:
            known_gaps.append(f"eval_error: {str(exc)[:60]}")
    else:
        # Infer pass from batch log metadata (no DOCX access or eval not requested)
        sp_blocks = log_entry.get("sp_blocks") or 0
        kp_rows = log_entry.get("kp_rows") or 0
        null_count = len(null_answers)

        sp_schema_path = schema_dir / f"{lesson_id}.spotlight.yml"
        kp_schema_path = schema_dir / f"{lesson_id}.keypoints.yml"

        if sp_schema_path.exists():
            sp_data = _load_yaml_safe(sp_schema_path)
            sp_inner = sp_data.get("spotlight", {}) if sp_data else {}
            if "error" in sp_inner or not sp_inner:
                sp_pass = None
            else:
                # Approximate: if null_answers == 0 and no error, likely pass
                # Real pass requires eval; mark as "approx"
                sp_pass = (null_count == 0) and (sp_blocks > 0)
                sp_score = None  # not computed without eval
        else:
            sp_pass = None

        if kp_schema_path.exists():
            kp_data = _load_yaml_safe(kp_schema_path)
            kp_inner = kp_data.get("keypoints", {}) if kp_data else {}
            if "error" in kp_inner or not kp_inner:
                kp_pass = None
            else:
                kp_pass = kp_rows > 0  # approximate
                kp_blank_recall = None
        else:
            kp_pass = None

    # Format status strings
    def fmt_status(passed, score_label, score_val):
        if passed is None:
            return "none"
        label = "pass" if passed else "fail"
        if score_val is not None:
            return f"{label} ({score_label}={score_val})"
        return label

    sp_status = fmt_status(sp_pass, "answer_recall", sp_score)
    kp_status = fmt_status(kp_pass, "blank_recall", kp_blank_recall)

    # n_tables: count fill_table blocks in spotlight (reuse sp_data from fast path if available)
    sp_schema_path = schema_dir / f"{lesson_id}.spotlight.yml"
    n_tables = 0
    if sp_schema_path.exists():
        sp_data = _load_yaml_safe(sp_schema_path)
        if sp_data:
            blocks = sp_data.get("spotlight", {}).get("blocks", [])
            n_tables = sum(1 for b in blocks if b.get("type") == "fill_table")

    return {
        "lesson_id": lesson_id,
        "grade": _grade(lesson_id),
        "title": _title_from_log(log_entry),
        "family": family,
        "spotlight_status": sp_status,
        "spotlight_score": sp_score,
        "keypoints_status": kp_status,
        "keypoints_blank_recall": kp_blank_recall,
        "n_figures": n_figures,
        "n_tables": n_tables,
        "known_gaps": known_gaps,
    }


# ── Helpers ──────────────────────────────────────────────────────────────────

def _grade(lesson_id: str) -> str:
    import re
    m = re.match(r"^(G\d+|文)", lesson_id)
    return m.group(1) if m else "?"


def _title_from_log(log_entry: dict) -> str:
    fname = log_entry.get("docx_filename", "")
    if not fname:
        return ""
    import re
    name = fname.replace(".docx", "")
    name = re.sub(r"^(G\d+|文)-L\d+[\-~]?\d*", "", name).strip()
    # Strip trailing strategy hint in （）
    name = re.sub(r"（[^）]{0,50}）$", "", name).strip()
    return name[:60]


def _load_yaml_safe(path: Path):
    try:
        with open(path, encoding="utf-8") as f:
            return yaml.safe_load(f)
    except Exception:
        return None


def _sort_key(entry: dict) -> tuple:
    lid = entry["lesson_id"]
    import re
    if lid.startswith("文"):
        grade_num = 100
        m = re.match(r"文-L(\d+)", lid)
    else:
        m_g = re.match(r"G(\d+)-L(\d+)", lid)
        if m_g:
            grade_num = int(m_g.group(1))
            lesson_num = int(m_g.group(2))
            return (grade_num, lesson_num)
        grade_num = 99
        m = None
    lesson_num = int(m.group(1)) if m else 0
    return (grade_num, lesson_num)


# ── Main ─────────────────────────────────────────────────────────────────────

def build_registry(log_file: Path, schema_dir: Path, run_eval: bool) -> list:
    if not log_file.exists():
        print(f"ERROR: batch_run_log not found at {log_file}", file=sys.stderr)
        print("Run: python3 scripts/batch_all_lessons.py --log-file <path>", file=sys.stderr)
        sys.exit(1)

    with open(log_file, encoding="utf-8") as f:
        log = json.load(f)

    print(f"Loaded {len(log)} lessons from {log_file}")

    if run_eval:
        ev = load_eval()
        bls = load_bls()
        print("Running live eval (requires DOCX files + schema files)...")
    else:
        ev = None
        bls = None
        print("Building from log + schema files (fast path, no live eval)...")

    entries = []
    for lesson_id, log_entry in log.items():
        entry = build_entry(lesson_id, log_entry, ev, bls, schema_dir, run_eval)
        entries.append(entry)

    # Sort by grade then lesson number
    entries.sort(key=_sort_key)
    return entries


def print_summary(entries: list):
    total = len(entries)
    sp_pass = sum(1 for e in entries if "pass" in e["spotlight_status"])
    sp_none = sum(1 for e in entries if e["spotlight_status"] == "none")
    sp_fail = sum(1 for e in entries if "fail" in e["spotlight_status"])
    sp_err  = sum(1 for e in entries if e["spotlight_status"] == "error")

    kp_pass = sum(1 for e in entries if "pass" in e["keypoints_status"])
    kp_none = sum(1 for e in entries if e["keypoints_status"] == "none")
    kp_fail = sum(1 for e in entries if "fail" in e["keypoints_status"])
    kp_err  = sum(1 for e in entries if e["keypoints_status"] == "error")

    sp_eligible = total - sp_none - sp_err
    kp_eligible = total - kp_none - kp_err

    # Fix: guard against division by zero (ZeroDivisionError when all are none/error)
    sp_pct = f"{sp_pass/sp_eligible*100:.1f}%" if sp_eligible > 0 else "N/A"
    kp_pct = f"{kp_pass/kp_eligible*100:.1f}%" if kp_eligible > 0 else "N/A"

    print(f"\n{'='*60}")
    print(f"Registry summary: {total} lessons")
    print(f"{'='*60}")
    print(f"Spotlight: {sp_pass}/{sp_eligible} eligible PASS "
          f"({sp_pct}) | none={sp_none} err={sp_err}")
    print(f"Keypoints: {kp_pass}/{kp_eligible} eligible PASS "
          f"({kp_pct}) | none={kp_none} err={kp_err}")

    # Family distribution
    from collections import Counter
    families = Counter(e["family"] for e in entries)
    print("\nFamily distribution:")
    for fam, count in sorted(families.items(), key=lambda x: -x[1]):
        print(f"  {fam}: {count}")

    known_gap_lessons = [e["lesson_id"] for e in entries if e["known_gaps"]]
    if known_gap_lessons:
        print(f"\nKnown gaps: {', '.join(known_gap_lessons[:10])}"
              + ("..." if len(known_gap_lessons) > 10 else ""))


def write_registry(entries: list, out_path: Path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    header = (
        "# lesson-schema-registry.yaml\n"
        "# Auto-generated by scripts/build_lesson_registry.py\n"
        "# DO NOT EDIT MANUALLY — re-run the script to update.\n"
        "#\n"
        "# Columns:\n"
        "#   lesson_id, grade, title, family\n"
        "#   spotlight_status: pass/fail/none/error + score\n"
        "#   keypoints_status: pass/fail/none/error + blank_recall\n"
        "#   n_figures: assets extracted, n_tables: fill_table blocks\n"
        "#   known_gaps: list of documented limitations\n"
        "#\n"
        f"# Source: private/curriculum-source/_online-schema/batch_run_log.json\n"
        f"# Coverage: {len(entries)} lessons\n"
        "#\n"
    )
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(header)
        yaml.dump(
            {"lessons": entries},
            f,
            allow_unicode=True,
            default_flow_style=False,
            sort_keys=False,
        )
    print(f"\nRegistry written to: {out_path}")
    print(f"  {len(entries)} entries")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--log-file", default=str(LOG_FILE),
                        help=f"Batch run log JSON (default: {LOG_FILE})")
    parser.add_argument("--schema-dir", default=str(SCHEMA_DIR),
                        help=f"Schema output dir (default: {SCHEMA_DIR})")
    parser.add_argument("--eval", action="store_true",
                        help="Re-run live eval per lesson (slow; needs DOCX + schema files)")
    parser.add_argument("--summary", action="store_true",
                        help="Print summary only, don't write registry file")
    parser.add_argument("--output", default=str(REGISTRY_OUT),
                        help=f"Output YAML path (default: {REGISTRY_OUT})")
    args = parser.parse_args()

    entries = build_registry(
        log_file=Path(args.log_file),
        schema_dir=Path(args.schema_dir),
        run_eval=args.eval,
    )

    print_summary(entries)

    if not args.summary:
        write_registry(entries, Path(args.output))


if __name__ == "__main__":
    main()
