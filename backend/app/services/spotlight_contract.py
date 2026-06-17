"""
spotlight_contract.py — shared validation for spotlight v2 block schemas.

Used by:
  - backend/specs/test_spotlight_v2_spec.py
  - scripts/spotlight_contract.py (thin re-export for CLI)
  - scripts/run_spotlight_dev_gate.sh

PASS gates (docs/issue-2205-eval-standard.md §2):
  - guide_retained, answer_recall, mcq_leakage == 0
  - block structure valid
  - gold fingerprint match (dev7 regression)
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

import yaml

_DATA_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "lessons"
DEV7_DIR = _DATA_ROOT / "spotlight" / "dev7"
GOLD_MANIFEST = DEV7_DIR / "gold_manifest.json"

DEV7_LESSONS = (
    "G6-L22",
    "G6-L23",
    "G6-L24",
    "G6-L25",
    "G7-L28",
    "G7-L29",
    "G7-L30",
)

KNOWN_BLOCK_TYPES = frozenset({
    "guide",
    "passage",
    "single",
    "multi",
    "free_text",
    "fill_table",
    "figure",
    "highlight",
    "self_check",
    "match",
    "unknown",
})

INTERACTIVE_BLOCK_TYPES = frozenset({
    "single",
    "multi",
    "free_text",
    "fill_table",
    "highlight",
    "self_check",
    "match",
})

MCQ_LEAK_RE = re.compile(r"^[（(]\s*[A-Za-z]\s*[）)]\s*\d+[\.\、]")

OPTION_LINE_IN_GUIDE_RE = re.compile(
    r"^[①②③④⑤]|^□\s*[①②③④⑤]|^□[⒈⒉⒊⒋⒌]"
)

# Per-lesson semantic regression bounds (dev7 only — deliberate baseline bumps)
SEMANTIC_EXPECTATIONS: dict[str, dict[str, int]] = {
    "G7-L29": {"min_singles": 15, "max_mcq_option_guides": 0},
    "G7-L30": {"min_singles": 15, "max_mcq_option_guides": 2},
    "G7-L28": {"min_singles": 4, "max_mcq_option_guides": 5},
    "G6-L22": {"min_singles": 4, "max_mcq_option_guides": 2},
}


def is_mcq_option_guide_text(text: str) -> bool:
    """True when a guide block text is a misclassified MCQ option line."""
    t = (text or "").strip()
    if not t or t.startswith("□句"):
        return False
    return bool(OPTION_LINE_IN_GUIDE_RE.match(t))


def count_mcq_option_guides(blocks: list[dict[str, Any]]) -> int:
    return sum(
        1
        for b in blocks
        if b.get("type") == "guide" and is_mcq_option_guide_text(b.get("text", ""))
    )


def semantic_eval_spotlight(
    lesson_id: str,
    spotlight: dict[str, Any],
) -> dict[str, Any]:
    blocks = spotlight.get("blocks") or []
    singles = sum(1 for b in blocks if b.get("type") == "single")
    mcq_option_guides = count_mcq_option_guides(blocks)
    expectations = SEMANTIC_EXPECTATIONS.get(lesson_id, {})
    min_singles = expectations.get("min_singles", 0)
    max_mcq_option_guides = expectations.get("max_mcq_option_guides", 5)
    errors: list[str] = []
    if singles < min_singles:
        errors.append(f"singles {singles} < min {min_singles}")
    if mcq_option_guides > max_mcq_option_guides:
        errors.append(
            f"mcq_option_guides {mcq_option_guides} > max {max_mcq_option_guides}"
        )
    return {
        "single_count": singles,
        "mcq_option_guides": mcq_option_guides,
        "semantic_pass": len(errors) == 0,
        "semantic_errors": errors,
    }


SEGMENT_START_RE = re.compile(
    r"練習[一二三四五六七八九十\d]|例[一二三四五六七八九十\d]|小試身手|步驟[❶①1-9]"
)


def load_spotlight_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or "spotlight" not in data:
        raise ValueError(f"invalid spotlight yaml: {path}")
    return data["spotlight"]


def load_gold_manifest() -> dict[str, Any]:
    return json.loads(GOLD_MANIFEST.read_text(encoding="utf-8"))


def fingerprint_spotlight(spotlight: dict[str, Any]) -> dict[str, Any]:
    blocks = spotlight.get("blocks") or []
    hist = dict(sorted(Counter(b.get("type", "?") for b in blocks).items()))
    qa = [b for b in blocks if b.get("type") in ("single", "multi")]
    guides = [b for b in blocks if b.get("type") == "guide"]
    passages = [b for b in blocks if b.get("type") == "passage"]
    nulls = sum(1 for b in qa if b.get("answer") is None)
    mcq_leakage = sum(
        1 for b in qa if MCQ_LEAK_RE.match(b.get("prompt", "") or "")
    )
    return {
        "strategy_type": spotlight.get("strategy_type"),
        "block_count": len(blocks),
        "type_histogram": hist,
        "type_sequence": [b.get("type") for b in blocks],
        "guide_count": len(guides),
        "passage_count": len(passages),
        "qa_total": len(qa),
        "null_answers": nulls,
        "first_guide_prefix": (guides[0].get("text", "")[:60] if guides else ""),
        "mcq_leakage": mcq_leakage,
    }


def validate_block_structure(blocks: list[dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    for i, block in enumerate(blocks):
        btype = block.get("type")
        if btype not in KNOWN_BLOCK_TYPES:
            errors.append(f"block[{i}]: unknown type {btype!r}")
            continue
        if btype == "guide" and not (block.get("text") or "").strip():
            errors.append(f"block[{i}]: guide missing text")
        if btype == "passage" and not block.get("paragraphs"):
            errors.append(f"block[{i}]: passage missing paragraphs")
        if btype == "single":
            if not (block.get("prompt") or "").strip():
                errors.append(f"block[{i}]: single missing prompt")
            opts = block.get("options") or []
            if len(opts) < 2:
                errors.append(f"block[{i}]: single needs >=2 options")
        if btype == "multi":
            if not (block.get("prompt") or "").strip():
                errors.append(f"block[{i}]: multi missing prompt")
        if btype == "free_text" and not (block.get("prompt") or "").strip():
            errors.append(f"block[{i}]: free_text missing prompt")
        if btype == "self_check" and not block.get("items"):
            errors.append(f"block[{i}]: self_check missing items")
        if btype == "figure" and not block.get("referent"):
            errors.append(f"block[{i}]: figure missing referent")
    return errors


def eval_spotlight_v2(
    spotlight: dict[str, Any],
    lesson_id: str | None = None,
) -> dict[str, Any]:
    blocks = spotlight.get("blocks") or []
    fp = fingerprint_spotlight(spotlight)
    struct_errors = validate_block_structure(blocks)

    guide_retained = fp["guide_count"] > 0
    answer_recall = (
        1.0
        if fp["qa_total"] == 0
        else (fp["qa_total"] - fp["null_answers"]) / fp["qa_total"]
    )

    semantic: dict[str, Any] = {}
    semantic_pass = True
    if lesson_id:
        semantic = semantic_eval_spotlight(lesson_id, spotlight)
        semantic_pass = semantic["semantic_pass"]

    passed = (
        guide_retained
        and fp["mcq_leakage"] == 0
        and answer_recall >= 0.99
        and len(struct_errors) == 0
        and semantic_pass
    )

    return {
        **fp,
        "struct_errors": struct_errors,
        "guide_retained": guide_retained,
        "answer_recall": round(answer_recall, 3),
        "semantic": semantic,
        "pass": passed,
    }


def compare_to_gold(
    lesson_id: str,
    spotlight: dict[str, Any],
    gold: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if gold is None:
        manifest = load_gold_manifest()
        gold = manifest["lessons"].get(lesson_id)
    if gold is None:
        return {"match": False, "error": f"no gold entry for {lesson_id}"}

    fp = fingerprint_spotlight(spotlight)
    keys = (
        "strategy_type",
        "block_count",
        "type_histogram",
        "type_sequence",
        "guide_count",
        "passage_count",
        "qa_total",
        "null_answers",
        "first_guide_prefix",
        "mcq_leakage",
    )
    diffs: dict[str, dict[str, Any]] = {}
    for key in keys:
        if fp.get(key) != gold.get(key):
            diffs[key] = {"actual": fp.get(key), "expected": gold.get(key)}

    return {
        "match": len(diffs) == 0,
        "diffs": diffs,
        "fingerprint": fp,
    }


def load_dev7_spotlight(lesson_id: str) -> dict[str, Any] | None:
    path = DEV7_DIR / f"{lesson_id}.spotlight.yml"
    if not path.exists():
        return None
    return load_spotlight_yaml(path)
