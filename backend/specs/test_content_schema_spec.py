"""Executable spec — content schema field contracts.

spec_id: content.schema.lesson_fields
canonical_source: docs/specs/content-schema-2026-05-09.md
owns_code: backend/app/schemas/story.py, frontend/src/config/stepConfig.ts
owns_data: backend/data/lessons/_parsed_2026-05-01/**/*.yml
related_issues: [1509]
human_spec: specs/modules/content-schema/INTENT.md

This file is the MACHINE side of the content-schema spec. The HUMAN side
(rationale, field design decisions, allowed/forbidden changes) lives in INTENT.md.

Contracts verified here:
  1. The 7 demo lessons all have lesson_intro (minimum data quality gate for 7/1 demo).
  2. learning_goal — when present — must be a string (not a dict/list).
     Currently absent from all lessons; test documents the expected nullable type.
  3. All step_sequence values in the corpus must be valid step IDs from STEP_REGISTRY.
     This catches any YAML typo that would silently break the StepperNav.
  4. lesson_intro.source — when present — must be a known source type.
  5. lesson_intro.text — when present — must not exceed 300 chars.

Drift model: a failing contract means data or code drifted from the spec.
Tests that document intended-but-not-yet-true behaviour are marked xfail.

Run:  cd backend && python -m pytest specs/test_content_schema_spec.py -v
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import pytest
import yaml

# ---------------------------------------------------------------------------
# Repo-relative paths
# ---------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parents[2]
LESSON_DIR = _REPO_ROOT / "backend" / "data" / "lessons" / "_parsed_2026-05-01"

# Valid step IDs as defined in frontend/src/config/stepConfig.ts STEP_REGISTRY.
# Update this set if STEP_REGISTRY gains new IDs.
VALID_STEP_IDS = frozenset({
    "intro",
    "reading-annotation",
    "tutor",
    "full-reading",
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

# Valid lesson_intro source types (per spec §3 Field B).
VALID_INTRO_SOURCES = frozenset({"docx_explanation", "docx_guide", "excel", "ai_generated"})

# The 7 demo lessons that must have lesson_intro for the 7/1 demo.
# See: content-schema-2026-05-09.md §Demo Lessons Status table.
DEMO_LESSONS = [
    "G6-L22", "G6-L23", "G6-L24", "G6-L25",
    "G7-L28", "G7-L29", "G7-L30",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load(path: Path) -> dict:
    """Load a YAML file; return {} on parse error (corrupt file is its own problem)."""
    try:
        return yaml.safe_load(path.read_text()) or {}
    except Exception:
        return {}


def _all_grade_lessons() -> list[Path]:
    """Return sorted list of G4-G9 lesson YAML files in the parsed corpus."""
    return sorted(LESSON_DIR.glob("G[4-9]-L*.yml"))


def _lessons_with_step_sequence() -> list[tuple[Path, list]]:
    """Return (path, step_sequence) for every lesson that declares step_sequence."""
    out = []
    for f in _all_grade_lessons():
        data = _load(f)
        ss = data.get("step_sequence")
        if ss is not None:
            out.append((f, ss))
    return out


def _lessons_with_lesson_intro() -> list[tuple[Path, dict]]:
    """Return (path, lesson_intro) for every lesson that declares lesson_intro."""
    out = []
    for f in _all_grade_lessons():
        data = _load(f)
        intro = data.get("lesson_intro")
        if intro is not None:
            out.append((f, intro))
    return out


# ---------------------------------------------------------------------------
# Infrastructure tests
# ---------------------------------------------------------------------------

def test_lesson_dir_exists() -> None:
    """The parsed YAML corpus directory must exist (gate for all downstream tests)."""
    assert LESSON_DIR.is_dir(), f"Lesson dir not found: {LESSON_DIR}"


def test_demo_lesson_files_exist() -> None:
    """Each of the 7 demo lessons must have a YAML file in the corpus."""
    missing = [code for code in DEMO_LESSONS if not (LESSON_DIR / f"{code}.yml").exists()]
    assert not missing, f"Demo lesson YAML files missing: {missing}"


# ---------------------------------------------------------------------------
# Contract: 7 demo lessons have lesson_intro
# ---------------------------------------------------------------------------

def test_demo_lessons_all_have_lesson_intro() -> None:
    """The 7 demo lessons (G6-L22~25, G7-L28~30) must each have lesson_intro.

    Spec rationale: These are the 7 courses shown at the 7/1 professor demo.
    lesson_intro feeds the '課文簡介' block on the Intro page.
    Missing lesson_intro → Intro page shows a placeholder — unacceptable for demo.
    """
    failures = []
    for code in DEMO_LESSONS:
        path = LESSON_DIR / f"{code}.yml"
        data = _load(path)
        intro = data.get("lesson_intro")
        if not intro:
            failures.append(code)
        elif not isinstance(intro, dict):
            failures.append(f"{code} (lesson_intro is not a dict: {type(intro).__name__})")
        elif not intro.get("text"):
            failures.append(f"{code} (lesson_intro.text is empty/missing)")
    assert not failures, f"Demo lessons missing usable lesson_intro: {failures}"


# ---------------------------------------------------------------------------
# Contract: learning_goal type safety
# ---------------------------------------------------------------------------

def test_learning_goal_is_null_or_string_when_present() -> None:
    """learning_goal — when the key exists — must be null or a plain string (≤ 100 chars).

    Spec rationale (content-schema §3 Field A): The field is teacher-filled.
    It currently does not exist in any YAML (all lessons return KEY_ABSENT via
    dict.get()). When it eventually is added, it must be a plain string,
    NOT a dict / list (the spec explicitly rejected the {strategy, target} format).

    This test will pass trivially until the field is populated. Its presence
    documents the contract so future engineers know what to validate.
    """
    failures = []
    for f in _all_grade_lessons():
        data = _load(f)
        if "learning_goal" not in data:
            continue  # field absent — allowed (teacher hasn't filled yet)
        value = data["learning_goal"]
        if value is None:
            continue  # explicit null — allowed
        if not isinstance(value, str):
            failures.append(f"{f.stem}: learning_goal is {type(value).__name__}, expected str")
        elif len(value) > 100:
            failures.append(
                f"{f.stem}: learning_goal too long ({len(value)} chars > 100)"
            )
    assert not failures, f"learning_goal type violations: {failures}"


# ---------------------------------------------------------------------------
# Contract: step_sequence values are all valid step IDs
# ---------------------------------------------------------------------------

def test_step_sequence_values_are_valid_step_ids() -> None:
    """Every step ID in every lesson's step_sequence must exist in STEP_REGISTRY.

    Spec rationale (content-schema §3 Field C): step_sequence controls which
    steps appear in the StepperNav. An unrecognised step ID is silently dropped
    by resolveActiveSteps() — the step vanishes without error, which is a
    hard-to-debug UX regression.

    This contract catches YAML typos (e.g. 'vocab_definition' instead of
    'vocab-definition') before they reach production.
    """
    failures = []
    for path, step_seq in _lessons_with_step_sequence():
        if not isinstance(step_seq, list):
            failures.append(f"{path.stem}: step_sequence is not a list ({type(step_seq).__name__})")
            continue
        invalid = [s for s in step_seq if s not in VALID_STEP_IDS]
        if invalid:
            failures.append(f"{path.stem}: unknown step ID(s): {invalid}")
    assert not failures, "\n".join(failures)


# ---------------------------------------------------------------------------
# Contract: lesson_intro structure
# ---------------------------------------------------------------------------

def test_lesson_intro_source_is_known_type() -> None:
    """Every lesson_intro.source must be a known source type.

    Spec rationale (content-schema §3 Field B): source must be one of
    docx_explanation, docx_guide, excel, ai_generated.
    Unknown source types indicate a parser or manual-edit error.
    """
    failures = []
    for path, intro in _lessons_with_lesson_intro():
        if not isinstance(intro, dict):
            continue  # caught by a different assertion
        src = intro.get("source")
        if src is None:
            failures.append(f"{path.stem}: lesson_intro missing 'source' field")
        elif src not in VALID_INTRO_SOURCES:
            failures.append(
                f"{path.stem}: lesson_intro.source '{src}' not in {sorted(VALID_INTRO_SOURCES)}"
            )
    assert not failures, "\n".join(failures)


def test_lesson_intro_text_within_length_limit() -> None:
    """lesson_intro.text must not exceed 300 characters.

    Spec rationale (content-schema §3 Field B subfield schema): text max 300 chars.
    The Intro page UI is designed for this length; longer text overflows the
    '課文簡介' block.
    """
    failures = []
    for path, intro in _lessons_with_lesson_intro():
        if not isinstance(intro, dict):
            continue
        text = intro.get("text", "")
        if isinstance(text, str) and len(text) > 300:
            failures.append(
                f"{path.stem}: lesson_intro.text is {len(text)} chars (max 300)"
            )
    assert not failures, "\n".join(failures)
