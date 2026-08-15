"""Corpus-driven grading regression — OMO 語詞應用 (issue 2028).

spec_id: omo.grader.letter_mapping (corpus layer)
human_spec: specs/modules/omo-assessment/INTENT.md
corpus:     specs/modules/omo-assessment/fixtures/grading-corpus.yaml
related_issues: [2015, 2028]

Drives the REAL deterministic grading pipeline (no LLM, no grader edits):
    _build_question_schema(lesson)
      -> _validate_student_answer(raw, q)   # anti-fabrication coercion
      -> _score_answer(student, correct, qtype)

Each corpus case asserts (teacher-key lesson + simulated student fill) -> score.
xfail cases document the issue-2015 letter-mapping drift; they flip to XPASS
when the grader fix lands — that is the signal to make them hard expectations.

Run: cd backend && python -m pytest specs/test_omo_grading_corpus.py -v
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

_REPO_ROOT = Path(__file__).resolve().parents[2]
CORPUS = _REPO_ROOT / "specs" / "modules" / "omo-assessment" / "fixtures" / "grading-corpus.yaml"
LESSON_DIR = _REPO_ROOT / "backend" / "data" / "lessons" / "_parsed_2026-05-01"


def _grade(lesson: dict, student: dict) -> dict:
    """Run one lesson + student answers through the deterministic pipeline."""
    from app.services.omo_question_schema import _build_question_schema
    from app.services.omo_scoring import _score_answer, _validate_student_answer

    out = {}
    for q in _build_question_schema(lesson):
        qid = q["id"]
        validated, _ok = _validate_student_answer(student.get(qid, ""), q)
        out[qid] = _score_answer(validated, q["correct_answer"], q["type"])
    return out


def _load_cases() -> list[dict]:
    return (yaml.safe_load(CORPUS.read_text()) or {}).get("cases", [])


def _corpus_params():
    params = []
    for case in _load_cases():
        # strict=True: when the grader bug (2015) is fixed, the case XPASSes and
        # CI goes red — forcing whoever fixed it to delete the xfail and make it
        # a hard expectation. A silent strict=False would let the drift marker rot.
        marks = [pytest.mark.xfail(reason=case["xfail"], strict=True)] if case.get("xfail") else []
        params.append(pytest.param(case, id=case["id"], marks=marks))
    return params


def test_corpus_file_exists():
    assert CORPUS.is_file(), f"corpus missing: {CORPUS}"
    assert _load_cases(), "corpus has no cases"


@pytest.mark.parametrize("case", _corpus_params())
def test_grading_corpus_case(case):
    scores = _grade(case["lesson"], case["student"])
    for qid, expected in case["expect"].items():
        assert scores.get(qid) == expected, (
            f"[{case['id']}] {case.get('desc', '')}: "
            f"{qid} expected {expected}, got {scores.get(qid)}"
        )


def _vocab_bank_lessons() -> list[Path]:
    out = []
    for f in sorted(LESSON_DIR.glob("G[67]-L*.yml")):
        try:
            d = yaml.safe_load(f.read_text())
        except Exception:
            continue
        if isinstance(d, dict) and isinstance(d.get("vocab_bank"), dict) and d.get("fill_in_blank"):
            out.append(f)
    return out


def _perfect_student(lesson: dict) -> dict:
    """The student who circles exactly the answer key for every blank."""
    fb = lesson.get("fill_in_blank") or []
    pairs = fb.items() if isinstance(fb, dict) else enumerate(fb)
    student = {}
    for key, item in pairs:
        qid = str(key) if isinstance(fb, dict) else f"fb_{key + 1}"
        ans = item.get("answer") if isinstance(item, dict) else str(item)
        student[qid] = str(ans)
    return student


def _answers_reference_unknown_letters(lesson: dict) -> bool:
    """True if any single-letter fill_in_blank answer is NOT a key in vocab_bank.

    This is a LESSON-DATA inconsistency (the answer key cites a letter the
    worksheet legend never defines, e.g. G6-L25 answers J/K but vocab_bank only
    runs A-I), distinct from the grader-code bug fixed in #2015. The grader is
    correct; the data needs fixing. Tracked as xfail(strict) so a data fix
    XPASSes and forces this marker's removal.
    """
    vb = lesson.get("vocab_bank")
    if not isinstance(vb, dict):
        return False
    keys = {str(k).strip().upper() for k in vb.keys()
            if len(str(k).strip()) == 1 and str(k).strip().isalpha()}
    if not keys:
        return False
    fb = lesson.get("fill_in_blank") or []
    pairs = fb.items() if isinstance(fb, dict) else enumerate(fb)
    for _, item in pairs:
        ans = item.get("answer") if isinstance(item, dict) else str(item)
        if isinstance(ans, str) and len(ans.strip()) == 1 and ans.strip().isalpha():
            if ans.strip().upper() not in keys:
                return True
    return False


def _lesson_sweep_params():
    """One param per vocab_bank lesson. EVERY well-formed lesson must hard-pass:
    a perfect student (circles exactly the answer key) scores 100%. Includes
    lessons whose worksheet uses letters past G (H, I, J, K …) — fixed in #2015
    by deriving the legal letter set from vocab_bank keys instead of hardcoding
    A-G, so an 8+-choice worksheet no longer degrades to free_form.

    Lessons whose answer key cites letters absent from their own vocab_bank are
    a separate LESSON-DATA bug (not a grader bug) and are xfail(strict) until the
    data is corrected."""
    params = []
    for f in _vocab_bank_lessons():
        try:
            d = yaml.safe_load(f.read_text())
        except Exception:
            continue
        marks = []
        if _answers_reference_unknown_letters(d):
            marks.append(pytest.mark.xfail(
                reason="lesson-data: answer key cites a letter absent from this "
                "lesson's vocab_bank legend (data fix, not grader — #2015 follow-up)",
                strict=True,
            ))
        params.append(pytest.param(f, id=f.stem, marks=marks))
    return params


@pytest.mark.skip(


    reason="corpus 來源 backend/data/lessons/_parsed_2026-05-01/ 的 vocab_bank 欄位隨一修刪除（#2683）；二修抽取器尚未產出 vocab_bank（見 content_known_gaps.yaml#fields_not_extracted）"


)


def test_perfect_student_sweep_has_lessons():
    assert _vocab_bank_lessons(), "expected vocab_bank lessons in corpus dir"


@pytest.mark.parametrize("lesson_file", _lesson_sweep_params())
def test_perfect_student_scores_full(lesson_file):
    """A student who circles exactly the answer key must score 100% on this lesson.

    A-G-only lessons hard-pass (so a future regression there fails loudly);
    H-K lessons are xfail until the grader fix (issue 2015) lands.
    """
    d = yaml.safe_load(lesson_file.read_text())
    bad = [(qid, sc) for qid, sc in _grade(d, _perfect_student(d)).items()
           if qid.startswith("fb_") and sc != 1.0]
    assert not bad, f"{lesson_file.stem}: perfect-student answers scored <1.0: {bad}"
