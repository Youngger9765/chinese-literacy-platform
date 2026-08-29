"""Executable spec — step-sequence registry and YAML cross-validation contracts.

spec_id: step.sequence.registry
canonical_source: frontend/src/config/stepConfig.ts
owns_code: frontend/src/config/stepConfig.ts
owns_data: backend/data/lessons/_parsed_2026-05-01/**/*.yml
related_issues: [1374]
human_spec: specs/modules/step-sequence/INTENT.md

This file is the MACHINE side of the step-sequence spec.

Contracts:
  1. VALID_STEP_IDS constant matches the set in test_content_schema_spec.py
     (both must be updated together when STEP_REGISTRY changes).
  2. ACTIVE_STEPS (enabled=true subset) has exactly 11 members with the
     currently-known composition.
  3. Every step_sequence value in every lesson YAML is a valid step id.
     (Duplicates the content-schema Contract 3 by design — two modules own this
     guarantee from different angles; the intent note explains the trade-off.)
  4. DEFAULT_STEP_SEQUENCE contains all 16 known step IDs exactly once.
  5. Disabled steps are not present in the active (enabled) list.

Run:  cd backend && python -m pytest specs/test_step_sequence_spec.py -v
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

_REPO_ROOT = Path(__file__).resolve().parents[2]
LESSON_DIR = _REPO_ROOT / "backend" / "data" / "lessons" / "_parsed_2026-05-01"


# ---------------------------------------------------------------------------
# Canonical step IDs — source of truth is stepConfig.ts STEP_REGISTRY.
# Keep in sync with test_content_schema_spec.py::VALID_STEP_IDS.
# ---------------------------------------------------------------------------

VALID_STEP_IDS: frozenset[str] = frozenset({
    "intro",
    "reading-annotation",
    "tutor",
    "full-reading",    # 2026-07-20 教授審查：label 改造成「重點朗讀」（保留 id，只練指定段落）
    "listening",
    "vocab",
    "vocab-definition",
    "vocab-application",
    "story-structure",
    "reading-strategy",
    "sentence-practice",
    "comprehension",
    "vocab-word-search",
    "dictation",
    "knowledge-station",
    "report",
})

# Steps known to be disabled (enabled: false) per stepConfig.ts.
# Update when product decisions change the disabled set.
DISABLED_STEP_IDS: frozenset[str] = frozenset({
    "listening",       # 2026-05-01 expert review → ToolPicker
    "vocab",           # 2026-05-01 expert review → ToolPicker
    "sentence-practice",  # 2026-05-01 optional post-7/1
    "dictation",       # 2026-03-27 product decision
    "tutor",           # 2026-07-20 教授審查：朗讀簡化 → 逐段從 nav 隱藏（ToolPicker 仍可進）
})

ENABLED_STEP_IDS: frozenset[str] = VALID_STEP_IDS - DISABLED_STEP_IDS

# Canonical 16-step DEFAULT_STEP_SEQUENCE order (from stepConfig.ts).
DEFAULT_STEP_SEQUENCE: list[str] = [
    "intro",
    "reading-annotation",
    "tutor",
    "full-reading",
    "listening",
    "vocab",
    "vocab-definition",
    "vocab-application",
    "reading-strategy",
    "story-structure",
    "sentence-practice",
    "comprehension",
    "vocab-word-search",
    "dictation",
    "knowledge-station",
    "report",
]


# ---------------------------------------------------------------------------
# Infrastructure
# ---------------------------------------------------------------------------

@pytest.mark.skip(

    reason="來源 backend/data/lessons/_parsed_2026-05-01/ 隨一修刪除（#2683）；此契約待二修抽取器補上對應欄位後，改對 uid tree 重建 —— 登記在 data/curriculum_qa/content_known_gaps.yaml#locks_removed_with_the_first_edition"

)

def test_lesson_dir_exists():
    assert LESSON_DIR.is_dir(), f"lesson dir missing: {LESSON_DIR}"


# ---------------------------------------------------------------------------
# Contract 1: VALID_STEP_IDS has exactly 16 members (matches STEP_REGISTRY size)
# ---------------------------------------------------------------------------

def test_valid_step_ids_count():
    """STEP_REGISTRY defines exactly 16 step IDs.

    2026-07-20: full-reading repurposed to 重點朗讀 (no new id added).
    Fails if someone adds/removes a step without updating this spec.
    """
    assert len(VALID_STEP_IDS) == 16, (
        f"Expected 16 valid step IDs, got {len(VALID_STEP_IDS)}. "
        "Update VALID_STEP_IDS and specs/modules/step-sequence/INTENT.md."
    )


# ---------------------------------------------------------------------------
# Contract 2: enabled step count = 12 (total 16 minus 4 disabled)
# ---------------------------------------------------------------------------

def test_enabled_step_count_is_eleven():
    """11 of the 16 steps are enabled; 5 are disabled per product decisions.

    Disabled: listening, vocab, sentence-practice, dictation, tutor.
    (2026-07-20: tutor hidden; full-reading kept enabled but repurposed to 重點朗讀 → 12-1 = 11.)
    If a step is re-enabled or a new step is added, update DISABLED_STEP_IDS.
    """
    assert len(ENABLED_STEP_IDS) == 11, (
        f"Expected 11 enabled steps, got {len(ENABLED_STEP_IDS)}. "
        "Update DISABLED_STEP_IDS in this spec to match stepConfig.ts."
    )


def test_disabled_steps_not_in_enabled_set():
    """Disabled steps must not appear in the enabled set."""
    overlap = DISABLED_STEP_IDS & ENABLED_STEP_IDS
    assert not overlap, f"Steps appear in both disabled and enabled sets: {overlap}"


# ---------------------------------------------------------------------------
# Contract 3: DEFAULT_STEP_SEQUENCE length and uniqueness
# ---------------------------------------------------------------------------

def test_default_sequence_has_sixteen_entries():
    """DEFAULT_STEP_SEQUENCE has exactly 16 entries (all step IDs, including disabled)."""
    assert len(DEFAULT_STEP_SEQUENCE) == 16


def test_default_sequence_has_no_duplicates():
    """Each step ID appears exactly once in DEFAULT_STEP_SEQUENCE."""
    seen: dict[str, int] = {}
    for step in DEFAULT_STEP_SEQUENCE:
        seen[step] = seen.get(step, 0) + 1
    duplicates = {k: v for k, v in seen.items() if v > 1}
    assert not duplicates, f"Duplicate step IDs in DEFAULT_STEP_SEQUENCE: {duplicates}"


def test_default_sequence_contains_all_valid_ids():
    """Every valid step ID appears in DEFAULT_STEP_SEQUENCE."""
    missing = VALID_STEP_IDS - set(DEFAULT_STEP_SEQUENCE)
    assert not missing, f"Steps missing from DEFAULT_STEP_SEQUENCE: {missing}"


def test_default_sequence_has_no_unknown_ids():
    """DEFAULT_STEP_SEQUENCE contains no IDs outside VALID_STEP_IDS."""
    unknown = set(DEFAULT_STEP_SEQUENCE) - VALID_STEP_IDS
    assert not unknown, f"Unknown IDs in DEFAULT_STEP_SEQUENCE: {unknown}"


# ---------------------------------------------------------------------------
# Contract 4: all lesson YAML step_sequence values are valid step IDs
# ---------------------------------------------------------------------------

def _lessons_with_step_sequence() -> list[tuple[Path, list]]:
    out = []
    for f in sorted(LESSON_DIR.glob("G[4-9]-L*.yml")):
        try:
            data = yaml.safe_load(f.read_text()) or {}
        except Exception:
            continue
        ss = data.get("step_sequence")
        if ss is not None:
            out.append((f, ss))
    return out


def test_step_sequence_values_reference_valid_ids():
    """Every step ID in every lesson YAML step_sequence must exist in VALID_STEP_IDS.

    resolveActiveSteps() silently drops unknown IDs — a YAML typo causes a step
    to silently vanish from the StepperNav. This contract catches typos early.

    Note: this duplicates test_content_schema_spec.py::test_step_sequence_values_are_valid_step_ids
    intentionally (see INTENT.md §6).
    """
    failures = []
    for path, ss in _lessons_with_step_sequence():
        if not isinstance(ss, list):
            failures.append(f"{path.stem}: step_sequence is not a list ({type(ss).__name__})")
            continue
        invalid = [s for s in ss if s not in VALID_STEP_IDS]
        if invalid:
            failures.append(f"{path.stem}: unknown step ID(s): {invalid}")
    assert not failures, "\n".join(failures)


@pytest.mark.skip(


    reason="來源 backend/data/lessons/_parsed_2026-05-01/ 隨一修刪除（#2683）；此契約待二修抽取器補上對應欄位後，改對 uid tree 重建 —— 登記在 data/curriculum_qa/content_known_gaps.yaml#locks_removed_with_the_first_edition"


)


def test_some_lessons_have_step_sequence():
    """Sanity: at least one lesson must declare a step_sequence."""
    lessons = _lessons_with_step_sequence()
    assert lessons, "No lesson YAML files declare step_sequence — check LESSON_DIR path"
