#!/usr/bin/env python3
"""
build_lesson_registry.py — issue #2212
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
    router expansion (46→2 unknown), so we read it from there.

    Priority:
      1. spotlight.yml strategy_type (P1 router result)
      2. keypoints.yml strategy_type (if spotlight missing)
      3. batch_run_log strategy_type (fallback — same router, but older run)
      4. 'unknown'
    """
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

    return "unknown"


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

    # Family: derive from spotlight.yml strategy_type (fix #2212)
    family = _resolve_family(lesson_id, log_entry, schema_dir)

    # Known gap
    known_gaps = []
    if lesson_id in KNOWN_GAPS:
        known_gaps.append("strategy_unknown_no_bracket_filename")

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
