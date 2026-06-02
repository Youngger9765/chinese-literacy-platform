"""Executable spec — exit_ticket_service _from_lesson_yaml + calculate_score.

spec_id: exit.ticket.schema_and_scoring
canonical_source: backend/app/services/exit_ticket_service.py
owns_code: backend/app/services/exit_ticket_service.py
related_issues: [463, 1369, 1402]
human_spec: specs/modules/exit-ticket/INTENT.md

Machine-verifiable contracts — all pure Python, no DB, no AI:

  A. _from_lesson_yaml — YAML MCQ → exit-ticket schema transformation
  B. calculate_score — answer grading arithmetic

AI-path contracts (generate_exit_ticket_questions with Gemini) are NOT tested
here — they require live Gemini SDK.  Those are marked 待查 in INTENT.md.

Run: cd backend && python -m pytest specs/test_exit_ticket_spec.py -v
"""
from __future__ import annotations

from app.services.exit_ticket_service import (
    _from_lesson_yaml,
    calculate_score,
    PASSING_SCORE,
)


# ---------------------------------------------------------------------------
# A. _from_lesson_yaml — YAML → exit-ticket transformation
# ---------------------------------------------------------------------------

_GOOD_MCQ = {
    "multiple_choice": [
        {
            "question": "這篇文章的主旨是什麼？",
            "options": ["選項甲", "選項乙", "選項丙", "選項丁"],
            "answer": "B",
        },
        {
            "question": "作者最想表達什麼？",
            "options": ["一", "二", "三", "四"],
            "answer": "A",
        },
    ]
}


def test_from_lesson_yaml_returns_list_of_dicts():
    """_from_lesson_yaml must return a list of dicts from valid MCQ YAML."""
    result = _from_lesson_yaml(_GOOD_MCQ)
    assert isinstance(result, list)
    assert len(result) == 2
    assert all(isinstance(q, dict) for q in result)


def test_from_lesson_yaml_required_keys():
    """Each question dict must have the 5 required exit-ticket keys."""
    result = _from_lesson_yaml(_GOOD_MCQ)
    required = {"id", "question", "options", "correct_index", "explanation"}
    for q in result:
        assert required == set(q.keys()), f"missing keys in {q}"


def test_from_lesson_yaml_id_is_1_based():
    """id field starts at 1, not 0."""
    result = _from_lesson_yaml(_GOOD_MCQ)
    assert result[0]["id"] == 1
    assert result[1]["id"] == 2


def test_from_lesson_yaml_answer_a_maps_to_index_0():
    """Answer 'A' → correct_index 0."""
    data = {"multiple_choice": [
        {"question": "q", "options": ["a", "b", "c", "d"], "answer": "A"}
    ]}
    result = _from_lesson_yaml(data)
    assert result[0]["correct_index"] == 0


def test_from_lesson_yaml_answer_b_maps_to_index_1():
    """Answer 'B' → correct_index 1."""
    data = {"multiple_choice": [
        {"question": "q", "options": ["a", "b", "c", "d"], "answer": "B"}
    ]}
    result = _from_lesson_yaml(data)
    assert result[0]["correct_index"] == 1


def test_from_lesson_yaml_answer_d_maps_to_index_3():
    """Answer 'D' → correct_index 3."""
    data = {"multiple_choice": [
        {"question": "q", "options": ["a", "b", "c", "d"], "answer": "D"}
    ]}
    result = _from_lesson_yaml(data)
    assert result[0]["correct_index"] == 3


def test_from_lesson_yaml_correct_index_clamped_to_3():
    """correct_index is clamped to [0, 3] — answers beyond D are clipped to D."""
    # An alphabetic char beyond D: ord('E')-ord('A') = 4, clamped to 3
    data = {"multiple_choice": [
        {"question": "q", "options": ["a", "b", "c", "d"], "answer": "E"}
    ]}
    result = _from_lesson_yaml(data)
    assert result[0]["correct_index"] == 3


def test_from_lesson_yaml_options_exactly_4():
    """Each produced question must have exactly 4 options (first 4 taken)."""
    result = _from_lesson_yaml(_GOOD_MCQ)
    for q in result:
        assert len(q["options"]) == 4


def test_from_lesson_yaml_drops_question_with_fewer_than_4_options():
    """Questions with fewer than 4 options are silently dropped."""
    data = {"multiple_choice": [
        {"question": "short", "options": ["a", "b", "c"], "answer": "A"},   # < 4 → drop
        {"question": "ok", "options": ["a", "b", "c", "d"], "answer": "B"}, # OK
    ]}
    result = _from_lesson_yaml(data)
    assert len(result) == 1
    assert result[0]["question"] == "ok"


def test_from_lesson_yaml_explanation_is_always_empty_string():
    """explanation field is always '' at YAML-source stage (no AI explanation)."""
    result = _from_lesson_yaml(_GOOD_MCQ)
    for q in result:
        assert q["explanation"] == ""


def test_from_lesson_yaml_no_multiple_choice_key():
    """lesson_data with no 'multiple_choice' key returns empty list."""
    result = _from_lesson_yaml({"title": "課文", "content": []})
    assert result == []


def test_from_lesson_yaml_empty_multiple_choice():
    """lesson_data with empty multiple_choice list returns empty list."""
    result = _from_lesson_yaml({"multiple_choice": []})
    assert result == []


def test_from_lesson_yaml_answer_lowercase_normalised():
    """Lowercase answer letters are normalised to uppercase before mapping."""
    data = {"multiple_choice": [
        {"question": "q", "options": ["a", "b", "c", "d"], "answer": "c"}
    ]}
    result = _from_lesson_yaml(data)
    assert result[0]["correct_index"] == 2  # 'C' → 2


# ---------------------------------------------------------------------------
# B. calculate_score — grading arithmetic
# ---------------------------------------------------------------------------

_QUESTIONS = [
    {"id": 1, "question": "q1", "options": ["a","b","c","d"], "correct_index": 0, "explanation": ""},
    {"id": 2, "question": "q2", "options": ["a","b","c","d"], "correct_index": 2, "explanation": ""},
    {"id": 3, "question": "q3", "options": ["a","b","c","d"], "correct_index": 1, "explanation": ""},
    {"id": 4, "question": "q4", "options": ["a","b","c","d"], "correct_index": 3, "explanation": ""},
]


def test_calculate_score_all_correct():
    """All correct answers → score=100, correct_count=4, total=4."""
    answers = [
        {"question_id": 1, "selected_index": 0},
        {"question_id": 2, "selected_index": 2},
        {"question_id": 3, "selected_index": 1},
        {"question_id": 4, "selected_index": 3},
    ]
    result = calculate_score(_QUESTIONS, answers)
    assert result["score"] == 100
    assert result["correct_count"] == 4
    assert result["total"] == 4


def test_calculate_score_all_wrong():
    """All wrong answers → score=0, correct_count=0."""
    answers = [
        {"question_id": 1, "selected_index": 1},
        {"question_id": 2, "selected_index": 0},
        {"question_id": 3, "selected_index": 3},
        {"question_id": 4, "selected_index": 2},
    ]
    result = calculate_score(_QUESTIONS, answers)
    assert result["score"] == 0
    assert result["correct_count"] == 0
    assert result["total"] == 4


def test_calculate_score_partial():
    """2/4 correct → score=50."""
    answers = [
        {"question_id": 1, "selected_index": 0},   # correct
        {"question_id": 2, "selected_index": 0},   # wrong
        {"question_id": 3, "selected_index": 1},   # correct
        {"question_id": 4, "selected_index": 0},   # wrong
    ]
    result = calculate_score(_QUESTIONS, answers)
    assert result["correct_count"] == 2
    assert result["total"] == 4
    assert result["score"] == 50


def test_calculate_score_empty_questions():
    """Empty questions list → score=0, never crashes."""
    result = calculate_score([], [{"question_id": 1, "selected_index": 0}])
    assert result["score"] == 0
    assert result["correct_count"] == 0
    assert result["total"] == 0


def test_calculate_score_empty_answers():
    """Empty answers → score=0, total=number of questions."""
    result = calculate_score(_QUESTIONS, [])
    assert result["score"] == 0
    assert result["correct_count"] == 0
    assert result["total"] == 4


def test_calculate_score_both_empty():
    """Both empty → score=0, never raises."""
    result = calculate_score([], [])
    assert result["score"] == 0


def test_calculate_score_unanswered_question_counts_wrong():
    """A question with no submitted answer is treated as wrong (not counted)."""
    # Only answer question 1; questions 2-4 are not submitted
    answers = [{"question_id": 1, "selected_index": 0}]  # correct
    result = calculate_score(_QUESTIONS, answers)
    assert result["correct_count"] == 1
    assert result["total"] == 4
    assert result["score"] == 25  # 1/4 * 100 = 25


def test_calculate_score_is_percentage_rounded():
    """Score is a rounded integer percentage (0-100)."""
    # 1 out of 3: 33.33... → rounds to 33
    qs = _QUESTIONS[:3]
    answers = [{"question_id": 1, "selected_index": 0}]  # 1 correct
    result = calculate_score(qs, answers)
    assert result["score"] == round(1 / 3 * 100)
    assert isinstance(result["score"], int)


def test_calculate_score_range_0_to_100():
    """Score is always within [0, 100]."""
    # All correct
    answers = [{"question_id": q["id"], "selected_index": q["correct_index"]} for q in _QUESTIONS]
    result = calculate_score(_QUESTIONS, answers)
    assert 0 <= result["score"] <= 100

    # All wrong
    answers_wrong = [{"question_id": q["id"], "selected_index": (q["correct_index"] + 1) % 4}
                     for q in _QUESTIONS]
    result_wrong = calculate_score(_QUESTIONS, answers_wrong)
    assert 0 <= result_wrong["score"] <= 100


def test_calculate_score_total_matches_question_count():
    """total in result always equals len(questions)."""
    answers = [{"question_id": 1, "selected_index": 0}]
    result = calculate_score(_QUESTIONS, answers)
    assert result["total"] == len(_QUESTIONS)


# ---------------------------------------------------------------------------
# C. PASSING_SCORE constant
# ---------------------------------------------------------------------------

def test_passing_score_is_60():
    """PASSING_SCORE module constant must be 60 (spec-pinned)."""
    assert PASSING_SCORE == 60
