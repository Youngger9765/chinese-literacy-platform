"""Executable spec — OMO assessment letter-mapping contract.

spec_id: omo.grader.letter_mapping
canonical_source: vocab_bank
owns_code: backend/app/services/omo_question_schema.py
owns_data: backend/data/lessons/_parsed_2026-05-01/**/*.yml
related_issues: [2015, 2027, 2028]
human_spec: specs/modules/omo-assessment/INTENT.md

This file is the MACHINE side of the OMO letter-mapping spec. The HUMAN side
(rationale, pedagogy, allowed/forbidden changes) lives in INTENT.md above.

Drift model: a failing contract here means code or data drifted away from the
documented intent. Contracts that encode *intended-but-not-yet-true* behaviour
are marked xfail with the tracking issue, so CI stays green while still
documenting the gap. When the underlying fix lands, the xfail turns into XPASS
— that is the signal to flip the marker to a hard assertion.

Run:  cd backend && python -m pytest specs/ -v
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

# Repo-root-relative so the path holds regardless of pytest cwd.
_REPO_ROOT = Path(__file__).resolve().parents[2]
LESSON_DIR = _REPO_ROOT / "backend" / "data" / "lessons" / "_parsed_2026-05-01"


def _lessons_with_vocab_bank() -> list[Path]:
    """G6/G7 lessons that declare a vocab_bank (the lettered-answer variant)."""
    out = []
    for f in sorted(LESSON_DIR.glob("G[67]-L*.yml")):
        try:
            data = yaml.safe_load(f.read_text())
        except Exception:
            continue
        if isinstance(data, dict) and isinstance(data.get("vocab_bank"), dict):
            out.append(f)
    return out


def _load(path: Path) -> dict:
    return yaml.safe_load(path.read_text())


def test_lesson_dir_exists():
    """Guardrail: the spec is anchored to a real data directory."""
    assert LESSON_DIR.is_dir(), f"lesson dir missing: {LESSON_DIR}"


def test_some_lessons_declare_vocab_bank():
    """Sanity: the lettered-answer variant actually exists in the corpus."""
    lessons = _lessons_with_vocab_bank()
    assert lessons, "expected at least one G6/G7 lesson with a vocab_bank"


# === CONTRACT 1 (holds today) ===
# vocab_bank, when present, is the worksheet-canonical letter -> word dict.
def test_vocab_bank_is_letter_to_word_dict():
    bad = []
    for f in _lessons_with_vocab_bank():
        vb = _load(f)["vocab_bank"]
        for key, word in vb.items():
            if not (isinstance(key, str) and len(key) == 1 and key.isalpha()):
                bad.append((f.name, "bad_key", key))
            if not (isinstance(word, str) and word.strip()):
                bad.append((f.name, "bad_word", key))
    assert not bad, f"vocab_bank must be single-letter -> non-empty word: {bad[:10]}"


# === CONTRACT 2 (intended invariant, currently DRIFTED → #2015) ===
# Every fill_in_blank answer letter must be a key in that lesson's vocab_bank.
# Fails today because some answers (e.g. G6-L25 'K') fall outside vocab_bank.
@pytest.mark.xfail(
    reason="#2015: fb answer letters drift outside vocab_bank; data not yet corrected",
    strict=False,
)
def test_every_fb_answer_letter_exists_in_vocab_bank():
    failures = []
    for f in _lessons_with_vocab_bank():
        d = _load(f)
        vb = d["vocab_bank"]
        for fb in d.get("fill_in_blank", []) or []:
            ans = fb.get("answer") if isinstance(fb, dict) else None
            if isinstance(ans, str) and len(ans) == 1 and ans.isalpha() and ans not in vb:
                failures.append((f.name, ans, sorted(vb.keys())))
    assert not failures, (
        f"{len(failures)} fb answers reference a letter not in vocab_bank: {failures[:10]}"
    )


# === CONTRACT 3 (intended invariant, currently DRIFTED → #2015) ===
# The grader must resolve a letter via vocab_bank when present, never via the
# alphabetical index of the `vocabulary` list. Fails today because
# _resolve_letter_answer() indexes into `vocabulary` and ignores vocab_bank.
@pytest.mark.xfail(
    reason="#2015: _resolve_letter_answer uses vocabulary[index], ignores vocab_bank",
    strict=False,
)
def test_grader_resolves_letter_via_vocab_bank_not_vocabulary_index():
    try:
        from app.services.omo_question_schema import _resolve_letter_answer
    except Exception as exc:  # pragma: no cover - import wiring guard
        pytest.skip(f"cannot import grader (run from backend/): {exc}")

    mismatches = []
    for f in _lessons_with_vocab_bank():
        d = _load(f)
        vb = d["vocab_bank"]
        vocabulary = d.get("vocabulary") or []
        for letter, expected_word in vb.items():
            resolved = _resolve_letter_answer(letter, vocabulary)
            if resolved != expected_word:
                mismatches.append((f.name, letter, expected_word, resolved))
    assert not mismatches, (
        f"{len(mismatches)} letters resolve to wrong word "
        f"(grader must use vocab_bank): {mismatches[:10]}"
    )
