"""
gen_lesson_intent.py — Slice ③: lesson intent draft + drift-lock.

Generates an intent annotation YAML per lesson, capturing:
  - cognitive_skill per blank/row (rule-based v1)
  - answer_criterion per blank
  - schema_fingerprint for drift detection

Usage:
    # Generate intent for G6-L22
    python3 scripts/gen_lesson_intent.py G6-L22 \\
        --schema-dir private/curriculum-source/_online-schema/ \\
        --docx "private/curriculum-source/2026-05-01/.../G6-L22....docx" \\
        --output private/curriculum-source/_online-schema/G6-L22.intent.yml

    # Check if intent is stale (schema changed since intent was generated)
    python3 scripts/gen_lesson_intent.py G6-L22 \\
        --schema-dir private/curriculum-source/_online-schema/ \\
        --check-drift

As a module:
    from gen_lesson_intent import gen_lesson_intent_for_schema, check_intent_stale_from_dicts
"""

import sys
import re
import hashlib
import json
import argparse
import datetime
from pathlib import Path
from typing import Optional

import yaml


# ─── Fingerprint ─────────────────────────────────────────────────────────────

def compute_schema_fingerprint(kp_schema: dict) -> str:
    """Compute SHA-256 hex digest of the schema dict (stable JSON serialization)."""
    canonical = json.dumps(kp_schema, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ─── Cognitive skill inference (rule-based v1) ───────────────────────────────

# Keywords that suggest inference-level thinking
INFERENCE_KEYWORDS = re.compile(r"推論|判斷|為什麼|原因|影響|如何|怎麼|分析|比較")

# Labels / sub_labels associated with synthesis (result/conclusion)
SYNTHESIS_LABELS = re.compile(r"^(結果|結論|總結|影響|體會|心得|作者反思)")

# Recall: short single-word answers are typically verbatim recall
VERBATIM_RECALL_THRESHOLD = 5  # chars — answers <= this are verbatim


def infer_cognitive_skill(
    label: str,
    sub_label: str,
    template: str,
    answer: str,
    structure: str,
    strategy_type: str = "",
) -> str:
    """
    Rule-based v1 cognitive skill assignment.

    Rules (in priority order):
    1. If template contains 推論/判斷/為什麼 keywords → inference
    2. If effective_label (sub_label or label) matches 結果/結論/總結 AND structure
       is nested → synthesis  (section-level labels signal higher-order synthesis)
    3. If answer is a short phrase (<= VERBATIM_RECALL_THRESHOLD chars) → recall
       (short, exact-wording answers are verbatim recall regardless of label)
    4. Default → recall

    Note: `strategy_type` is accepted but not used in v1. Reserved for future
    extensions (e.g., distinguish story-map vs. compare-contrast strategy types).
    """
    effective_label = sub_label or label

    # Rule 1: inference keywords in template
    if template and INFERENCE_KEYWORDS.search(template):
        return "inference"

    # Rule 2: synthesis label with structure context
    if SYNTHESIS_LABELS.match(effective_label) and structure == "nested":
        return "synthesis"

    # Rule 3: short answer = recall
    if answer and len(answer.strip()) <= VERBATIM_RECALL_THRESHOLD:
        return "recall"

    # Default
    return "recall"


def infer_answer_criterion(answer: str, cognitive_skill: str) -> str:
    """
    Infer answer_criterion from answer content and cognitive_skill.

    Rules:
    - If answer contains slash (multiple acceptable variants) → paraphrase_ok
    - If cognitive_skill is synthesis or evaluation → open_ended
    - Default → verbatim_recall
    """
    if "/" in answer or "／" in answer:
        return "paraphrase_ok"
    if cognitive_skill in ("synthesis", "evaluation"):
        return "open_ended"
    return "verbatim_recall"


# ─── Core generation function ─────────────────────────────────────────────────

def gen_lesson_intent_for_schema(
    kp_schema: dict,
    lesson_id: str,
    strategy_type: str = "",
) -> dict:
    """
    Generate an intent annotation dict from a pre-loaded keypoints schema dict.

    Args:
        kp_schema: Full keypoints schema dict (with "keypoints" key)
        lesson_id: e.g. "G6-L22"
        strategy_type: optional strategy type string from filename detection

    Returns intent dict with:
        lesson, schema_fingerprint, generated_at, intent_rows
    """
    fingerprint = compute_schema_fingerprint(kp_schema)
    generated_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    rows_out = kp_schema.get("keypoints", {}).get("rows", [])
    structure = kp_schema.get("keypoints", {}).get("structure", "flat")

    intent_rows = []

    for i, row in enumerate(rows_out):
        label = row.get("label", "")

        if row.get("sub_rows"):
            # Nested: iterate sub_rows
            for j, sr in enumerate(row["sub_rows"]):
                sub_label = sr.get("sub_label", "")
                template = sr.get("template", "")
                blanks = sr.get("blanks", [])

                # Row-level entry (no blank_idx) for the sub_row itself
                cognitive_skill_row = infer_cognitive_skill(
                    label=label,
                    sub_label=sub_label,
                    template=template,
                    answer="",
                    structure=structure,
                    strategy_type=strategy_type,
                )
                row_entry = {
                    "row_idx": f"{i}_{j}",
                    "label": label,
                    "sub_label": sub_label,
                    "cognitive_skill": cognitive_skill_row,
                    "rationale": _build_rationale(
                        label, sub_label, template, "", cognitive_skill_row
                    ),
                    "answer_criterion": infer_answer_criterion("", cognitive_skill_row),
                }
                intent_rows.append(row_entry)

                # Blank-level entries
                for b_idx, blank in enumerate(blanks):
                    answer = blank.get("answer") or ""
                    cs = infer_cognitive_skill(
                        label=label,
                        sub_label=sub_label,
                        template=template,
                        answer=answer,
                        structure=structure,
                        strategy_type=strategy_type,
                    )
                    criterion = infer_answer_criterion(answer, cs)
                    blank_entry = {
                        "row_idx": f"{i}_{j}",
                        "label": label,
                        "sub_label": sub_label,
                        "blank_idx": b_idx,
                        "answer": answer,
                        "cognitive_skill": cs,
                        "rationale": _build_rationale(
                            label, sub_label, template, answer, cs
                        ),
                        "answer_criterion": criterion,
                    }
                    intent_rows.append(blank_entry)
        else:
            # Flat row
            value = row.get("value", "")
            blanks = row.get("blanks", [])

            cs_row = infer_cognitive_skill(
                label=label,
                sub_label="",
                template=value,
                answer="",
                structure=structure,
                strategy_type=strategy_type,
            )
            row_entry = {
                "row_idx": str(i),
                "label": label,
                "cognitive_skill": cs_row,
                "rationale": _build_rationale(label, "", value, "", cs_row),
                "answer_criterion": infer_answer_criterion("", cs_row),
            }
            intent_rows.append(row_entry)

            for b_idx, blank in enumerate(blanks):
                answer = blank.get("answer") or ""
                cs = infer_cognitive_skill(
                    label=label,
                    sub_label="",
                    template=value,
                    answer=answer,
                    structure=structure,
                    strategy_type=strategy_type,
                )
                criterion = infer_answer_criterion(answer, cs)
                blank_entry = {
                    "row_idx": str(i),
                    "label": label,
                    "blank_idx": b_idx,
                    "answer": answer,
                    "cognitive_skill": cs,
                    "rationale": _build_rationale(label, "", value, answer, cs),
                    "answer_criterion": criterion,
                }
                intent_rows.append(blank_entry)

    return {
        "lesson": lesson_id,
        "schema_fingerprint": fingerprint,
        "generated_at": generated_at,
        "intent_rows": intent_rows,
    }


def _build_rationale(
    label: str,
    sub_label: str,
    template: str,
    answer: str,
    cognitive_skill: str,
) -> str:
    """Build a short human-readable rationale string for the intent entry."""
    effective_label = sub_label or label
    if cognitive_skill == "inference":
        return f"Template contains inference cues under {effective_label!r}"
    if cognitive_skill == "synthesis":
        return f"{effective_label!r} row in nested structure implies synthesis of multiple sub-items"
    if cognitive_skill == "evaluation":
        return f"{effective_label!r} requires evaluative judgment"
    # recall
    if answer and len(answer) <= VERBATIM_RECALL_THRESHOLD:
        return f"Short answer ({len(answer)} chars) — verbatim recall from text"
    return f"Direct fill-in from reading passage under {effective_label!r}"


# ─── Drift check ─────────────────────────────────────────────────────────────

def check_intent_stale_from_dicts(
    current_kp_schema: dict,
    stored_intent: dict,
) -> dict:
    """
    Check if a stored intent is stale (schema changed since intent was generated).

    Args:
        current_kp_schema: the current keypoints schema dict
        stored_intent: the previously generated intent dict (has schema_fingerprint)

    Returns:
        {"stale": bool, "reason": str, "stored_fingerprint": str, "current_fingerprint": str}
    """
    current_fp = compute_schema_fingerprint(current_kp_schema)
    stored_fp = stored_intent.get("schema_fingerprint", "")

    stale = current_fp != stored_fp
    reason = "schema changed since intent generated" if stale else "fingerprint matches"

    return {
        "stale": stale,
        "reason": reason,
        "stored_fingerprint": stored_fp,
        "current_fingerprint": current_fp,
    }


def check_intent_stale_from_files(
    lesson_id: str,
    schema_dir: Path,
) -> dict:
    """
    File-based version: load schema and intent from disk, then check stale.
    Returns {"stale": bool, "reason": str, ...} or {"error": str} if files missing.
    """
    kp_path = schema_dir / f"{lesson_id}.keypoints.yml"
    intent_path = schema_dir / f"{lesson_id}.intent.yml"

    if not kp_path.exists():
        return {"error": f"keypoints.yml not found: {kp_path}", "stale": True, "reason": "missing schema"}
    if not intent_path.exists():
        return {"error": f"intent.yml not found: {intent_path}", "stale": True, "reason": "intent not yet generated"}

    with open(kp_path, encoding="utf-8") as f:
        kp_schema = yaml.safe_load(f)
    with open(intent_path, encoding="utf-8") as f:
        stored_intent = yaml.safe_load(f)

    return check_intent_stale_from_dicts(kp_schema, stored_intent)


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Generate or check lesson intent annotations"
    )
    parser.add_argument("lesson_id", help="Lesson ID, e.g. G6-L22")
    parser.add_argument(
        "--schema-dir",
        default="private/curriculum-source/_online-schema/",
        help="Directory containing keypoints YAML files",
    )
    parser.add_argument(
        "--docx",
        help="Path to DOCX file (used to detect strategy_type)",
    )
    parser.add_argument(
        "--output",
        help="Output path for intent YAML (default: <schema-dir>/<lesson_id>.intent.yml)",
    )
    parser.add_argument(
        "--gen-intent",
        action="store_true",
        help="Generate intent YAML (default action if --check-drift not given)",
    )
    parser.add_argument(
        "--check-drift",
        action="store_true",
        help="Check if intent is stale (schema changed since generation)",
    )
    args = parser.parse_args()

    schema_dir = Path(args.schema_dir)

    if args.check_drift:
        result = check_intent_stale_from_files(args.lesson_id, schema_dir)
        if result.get("stale"):
            print(f"STALE: {result.get('reason')}")
            print(f"  stored fp:  {result.get('stored_fingerprint', 'N/A')}")
            print(f"  current fp: {result.get('current_fingerprint', 'N/A')}")
        else:
            print(f"FRESH: {result.get('reason')}")
            print(f"  fingerprint: {result.get('current_fingerprint', 'N/A')}")
        if result.get("error"):
            print(f"ERROR: {result['error']}")
            sys.exit(1)
        return

    # Generate intent
    kp_path = schema_dir / f"{args.lesson_id}.keypoints.yml"
    if not kp_path.exists():
        print(f"ERROR: keypoints.yml not found: {kp_path}", file=sys.stderr)
        sys.exit(1)

    with open(kp_path, encoding="utf-8") as f:
        kp_schema = yaml.safe_load(f)

    # Detect strategy_type from DOCX filename if provided
    strategy_type = ""
    if args.docx:
        import importlib.util
        bls_spec = importlib.util.spec_from_file_location(
            "bls", Path(__file__).parent / "build_lesson_schema.py"
        )
        bls = importlib.util.module_from_spec(bls_spec)
        bls_spec.loader.exec_module(bls)
        _, strategy_type = bls.detect_strategy_from_filename(args.docx)

    intent = gen_lesson_intent_for_schema(
        kp_schema,
        lesson_id=args.lesson_id,
        strategy_type=strategy_type,
    )

    # Determine output path
    if args.output:
        out_path = Path(args.output)
    else:
        out_path = schema_dir / f"{args.lesson_id}.intent.yml"

    out_path.parent.mkdir(parents=True, exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as f:
        yaml.dump(intent, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    print(f"Intent written to: {out_path}")
    print(f"  lesson: {intent['lesson']}")
    print(f"  fingerprint: {intent['schema_fingerprint']}")
    print(f"  intent_rows: {len(intent['intent_rows'])}")
    blank_rows = [r for r in intent["intent_rows"] if "blank_idx" in r]
    print(f"  blank entries: {len(blank_rows)}")


if __name__ == "__main__":
    main()
