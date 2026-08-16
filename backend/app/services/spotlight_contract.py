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

from app.services.lesson_code_normalization import normalize_manifest_code
from app.services.spotlight_block_model import eval_g6_l22_acceptance

_DATA_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "lessons"
DEV7_DIR = _DATA_ROOT / "spotlight" / "dev7"
TEST15_DIR = _DATA_ROOT / "spotlight" / "test15"
CATALOG_DIR = _DATA_ROOT / "spotlight" / "catalog"
CATALOG_MANIFEST = CATALOG_DIR / "manifest.json"
GOLD_MANIFEST = DEV7_DIR / "gold_manifest.json"
TEST15_GOLD_MANIFEST = TEST15_DIR / "gold_manifest.json"

TEST15_LESSONS = (
    "G4-SL10",
    "G4-SL13",
    "G5-SL7",
    "G5-SL10",
    "G5-SL26",
    "G6-SL3",
    "G6-SL8",
    "G6-SL14",
    "G7-SL9",
    "G7-SL17",
    "G7-SL19",
    "G8-SL4",
    "G8-SL8",
    "G9-SL9",
)

# Eval fixture id (G*-SL*) → platform catalog lesson_code.
# G8 sub-letter slots differ from naive SL→L numbering (#2205).
TEST15_FIXTURE_TO_CATALOG: dict[str, str] = {
    "G4-SL10": "G4-L10",
    "G4-SL13": "G4-L13",
    "G5-SL7": "G5-L7",
    "G5-SL10": "G5-L10",
    "G5-SL26": "G5-L26",
    "G6-SL3": "G6-L3",
    "G6-SL8": "G6-L8",
    "G6-SL14": "G6-L14",
    "G7-SL9": "G7-L9",
    "G7-SL17": "G7-L17",
    "G7-SL19": "G7-L19",
    "G8-SL4": "G8-L3b",
    "G8-SL8": "G8-L6b",
    "G9-SL9": "G9-L9",
}

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
    # 排序題：（N）| 句子 的兩欄表格。原本落到「無圖 figure」而被 loader 丟棄，
    # 學生只看到題目提示、底下什麼都沒有（#2683）。
    "ordering",
    # 表格練習的內容本身。同上，172 個表格、88 課因為被歸成無圖 figure 而消失。
    "table",
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


def load_test15_gold_manifest() -> dict[str, Any]:
    return json.loads(TEST15_GOLD_MANIFEST.read_text(encoding="utf-8"))


_CATALOG_TO_TEST15_FIXTURE: dict[str, str] = {
    normalize_manifest_code(catalog): fixture
    for fixture, catalog in TEST15_FIXTURE_TO_CATALOG.items()
}

TEST15_CATALOG_CODES = frozenset(_CATALOG_TO_TEST15_FIXTURE.keys())


def test15_fixture_for_catalog(catalog_code: str) -> str | None:
    """Map platform lesson_code → test15 fixture id (G*-SL*), or None."""
    return _CATALOG_TO_TEST15_FIXTURE.get(normalize_manifest_code(catalog_code))


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
    acceptance_pass = True
    acceptance: dict[str, Any] = {}
    if lesson_id:
        semantic = semantic_eval_spotlight(lesson_id, spotlight)
        semantic_pass = semantic["semantic_pass"]
        if lesson_id == "G6-L22":
            acceptance = eval_g6_l22_acceptance(blocks)
            acceptance_pass = acceptance["pass"]

    passed = (
        guide_retained
        and fp["mcq_leakage"] == 0
        and answer_recall >= 0.99
        and len(struct_errors) == 0
        and semantic_pass
        and acceptance_pass
    )

    return {
        **fp,
        "struct_errors": struct_errors,
        "guide_retained": guide_retained,
        "answer_recall": round(answer_recall, 3),
        "semantic": semantic,
        "acceptance": acceptance,
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


def load_test15_spotlight(lesson_id: str) -> dict[str, Any] | None:
    path = TEST15_DIR / f"{lesson_id}.spotlight.yml"
    if not path.exists():
        return None
    return load_spotlight_yaml(path)


def _load_catalog_lesson_codes() -> frozenset[str]:
    if not CATALOG_MANIFEST.exists():
        return frozenset()
    data = json.loads(CATALOG_MANIFEST.read_text(encoding="utf-8"))
    codes = data.get("lessons") or []
    return frozenset(normalize_manifest_code(c) for c in codes)


CATALOG_LESSONS = _load_catalog_lesson_codes()


def load_catalog_spotlight(lesson_code: str) -> dict[str, Any] | None:
    norm = normalize_manifest_code(lesson_code)
    path = CATALOG_DIR / f"{norm}.spotlight.yml"
    if not path.exists():
        return None
    return load_spotlight_yaml(path)
