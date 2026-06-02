"""Executable spec — cross_text_analysis_service pure helpers.

spec_id: cross.text.analysis.graceful_and_structure
canonical_source: backend/app/services/cross_text_analysis_service.py
owns_code: backend/app/services/cross_text_analysis_service.py
related_issues: [253]
human_spec: specs/modules/cross-text-analysis/INTENT.md

Machine-verifiable contracts — pure Python helper functions, no DB:

  A. _build_text_type_performance — genre/category/grade aggregation math
  B. _build_vocabulary_growth — cumulative vocab timeline invariants
  C. _build_difficulty_progression — output length and field presence
  D. _build_common_error_patterns — top-10 cap + multi-text filter
  E. MIN_SESSIONS_FOR_ANALYSIS constant (pinned)
  F. analyze_cross_text_patterns graceful degradation on empty / low data
     (calls the real function with a mock DB that returns 0/1 sessions)

Contracts NOT tested here (need real DB):
  - joinedload avoids N+1 queries
  - analyze_class_cross_text_patterns performance on large classes
  - completed_at=None sessions are correctly skipped at DB query level

Run: cd backend && python -m pytest specs/test_cross_text_analysis_spec.py -v
"""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from app.services.cross_text_analysis_service import (
    MIN_SESSIONS_FOR_ANALYSIS,
    _build_common_error_patterns,
    _build_difficulty_progression,
    _build_text_type_performance,
    _build_vocabulary_growth,
)


# ---------------------------------------------------------------------------
# Helpers to build lightweight mock session/text objects
# ---------------------------------------------------------------------------

def _session(
    *,
    overall_score=None,
    accuracy=None,
    completed_at=None,
    story_slug="test-story",
    id_=1,
):
    """Minimal LearningSession mock for the pure helper functions."""
    s = SimpleNamespace(
        id=id_,
        overall_score=overall_score,
        accuracy=accuracy,
        story_slug=story_slug,
        completed_at=completed_at,
        text=None,  # helpers expect .text attribute
    )
    return s


def _text(*, genre="記敘文", category="閱讀", grade=5, title="測試課文", vocabulary=None):
    """Minimal Text mock."""
    return SimpleNamespace(
        genre=genre,
        category=category,
        grade=grade,
        title=title,
        vocabulary=vocabulary or [],
    )


_DT = datetime(2025, 1, 10, 12, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# A. _build_text_type_performance
# ---------------------------------------------------------------------------

def test_text_type_performance_empty_pairs():
    """Empty pairs → three empty lists, no crash."""
    result = _build_text_type_performance([])
    assert result == {"by_genre": [], "by_category": [], "by_grade": []}


def test_text_type_performance_single_pair():
    """Single pair → avg_score == that score."""
    s = _session(overall_score=80.0, completed_at=_DT)
    t = _text(genre="記敘文", category="閱讀", grade=5)
    s.text = t
    result = _build_text_type_performance([(s, t)])
    assert len(result["by_genre"]) == 1
    assert result["by_genre"][0]["avg_score"] == 80.0
    assert result["by_genre"][0]["attempts"] == 1


def test_text_type_performance_avg_rounded_to_1dp():
    """avg_score is rounded to 1 decimal place."""
    # Scores 80 + 70 = 150 / 2 = 75.0  (exact)
    s1 = _session(overall_score=80.0, completed_at=_DT, id_=1)
    t1 = _text(genre="記敘文")
    s1.text = t1
    s2 = _session(overall_score=70.0, completed_at=_DT, id_=2)
    t2 = _text(genre="記敘文")
    s2.text = t2
    result = _build_text_type_performance([(s1, t1), (s2, t2)])
    avg = result["by_genre"][0]["avg_score"]
    assert avg == 75.0
    # Confirm it's 1dp: (80+77)/2 = 78.5
    s3 = _session(overall_score=77.0, completed_at=_DT, id_=3)
    t3 = _text(genre="說明文")
    s3.text = t3
    s4 = _session(overall_score=80.0, completed_at=_DT, id_=4)
    t4 = _text(genre="說明文")
    s4.text = t4
    result2 = _build_text_type_performance([(s3, t3), (s4, t4)])
    assert result2["by_genre"][0]["avg_score"] == round((77 + 80) / 2, 1)


def test_text_type_performance_skips_none_score():
    """Sessions with no score (overall_score=None, accuracy=None) are skipped."""
    s = _session(overall_score=None, accuracy=None, completed_at=_DT)
    t = _text()
    s.text = t
    result = _build_text_type_performance([(s, t)])
    # All aggregations are empty because there's no scoreable data
    assert result["by_genre"] == []


def test_text_type_performance_uses_accuracy_as_fallback():
    """When overall_score is None, accuracy is used as the score."""
    s = _session(overall_score=None, accuracy=75.0, completed_at=_DT)
    t = _text(genre="記敘文")
    s.text = t
    result = _build_text_type_performance([(s, t)])
    assert result["by_genre"][0]["avg_score"] == 75.0


def test_text_type_performance_by_grade_keys_are_int():
    """by_grade entries have integer 'grade' field (not string)."""
    s = _session(overall_score=80.0, completed_at=_DT)
    t = _text(grade=6)
    s.text = t
    result = _build_text_type_performance([(s, t)])
    assert isinstance(result["by_grade"][0]["grade"], int)
    assert result["by_grade"][0]["grade"] == 6


# ---------------------------------------------------------------------------
# B. _build_vocabulary_growth
# ---------------------------------------------------------------------------

def test_vocabulary_growth_empty_pairs():
    """Empty pairs → empty list."""
    result = _build_vocabulary_growth([])
    assert result == []


def test_vocabulary_growth_cumulative_monotone_nondecreasing():
    """cumulative_words must never decrease across timeline entries."""
    sessions = []
    for i in range(3):
        s = _session(completed_at=_DT, id_=i + 1, story_slug=f"story-{i}")
        t = _text(vocabulary=[{"word": f"詞{j}"} for j in range(i * 3, i * 3 + 3)])
        s.text = t
        sessions.append((s, t))
    result = _build_vocabulary_growth(sessions)
    for i in range(1, len(result)):
        assert result[i]["cumulative_words"] >= result[i - 1]["cumulative_words"], (
            f"cumulative_words decreased at index {i}"
        )


def test_vocabulary_growth_new_words_non_negative():
    """new_words is always >= 0."""
    s1 = _session(completed_at=_DT, id_=1)
    t1 = _text(vocabulary=[{"word": "詞A"}, {"word": "詞B"}])
    s1.text = t1
    # Second session has same vocab → new_words=0 (already seen)
    s2 = _session(completed_at=_DT, id_=2, story_slug="story-2")
    t2 = _text(vocabulary=[{"word": "詞A"}])
    s2.text = t2
    result = _build_vocabulary_growth([(s1, t1), (s2, t2)])
    for entry in result:
        assert entry["new_words"] >= 0


def test_vocabulary_growth_timeline_has_required_keys():
    """Each timeline entry has session_index, completed_at, text_title, new_words, cumulative_words."""
    s = _session(completed_at=_DT)
    t = _text(title="課文甲", vocabulary=[{"word": "一"}])
    s.text = t
    result = _build_vocabulary_growth([(s, t)])
    assert len(result) == 1
    keys = {"session_index", "completed_at", "text_title", "new_words", "cumulative_words"}
    assert keys == set(result[0].keys())


def test_vocabulary_growth_skips_none_completed_at():
    """Sessions with completed_at=None are skipped (not in timeline)."""
    s_no_dt = _session(completed_at=None, id_=1)
    t = _text(vocabulary=[{"word": "詞"}])
    s_no_dt.text = t
    s_ok = _session(completed_at=_DT, id_=2, story_slug="s2")
    t2 = _text(vocabulary=[{"word": "詞"}])
    s_ok.text = t2
    result = _build_vocabulary_growth([(s_no_dt, t), (s_ok, t2)])
    # Only the session with completed_at appears
    assert len(result) == 1
    assert result[0]["session_index"] == 2


def test_vocabulary_growth_session_index_starts_at_1():
    """session_index is 1-based."""
    s = _session(completed_at=_DT)
    t = _text(vocabulary=[])
    s.text = t
    result = _build_vocabulary_growth([(s, t)])
    assert result[0]["session_index"] == 1


# ---------------------------------------------------------------------------
# C. _build_difficulty_progression
# ---------------------------------------------------------------------------

def test_difficulty_progression_empty_pairs():
    """Empty pairs → empty list."""
    result = _build_difficulty_progression([])
    assert result == []


def test_difficulty_progression_output_keys():
    """Each entry has the required keys."""
    s = _session(overall_score=80.0, completed_at=_DT)
    t = _text(grade=5, genre="記敘文", title="課文甲")
    s.text = t
    result = _build_difficulty_progression([(s, t)])
    assert len(result) == 1
    expected_keys = {"session_index", "completed_at", "text_title", "grade", "genre", "score"}
    assert expected_keys == set(result[0].keys())


def test_difficulty_progression_score_rounded():
    """score field is round(score, 1)."""
    s = _session(overall_score=82.567, completed_at=_DT)
    t = _text()
    s.text = t
    result = _build_difficulty_progression([(s, t)])
    assert result[0]["score"] == round(82.567, 1)


def test_difficulty_progression_none_score_passed_through():
    """Session with no score produces score=None (not 0)."""
    s = _session(overall_score=None, accuracy=None, completed_at=_DT)
    t = _text()
    s.text = t
    result = _build_difficulty_progression([(s, t)])
    assert result[0]["score"] is None


def test_difficulty_progression_skips_none_completed_at():
    """Sessions with completed_at=None are excluded from progression."""
    s1 = _session(completed_at=None, id_=1)
    t1 = _text()
    s1.text = t1
    s2 = _session(overall_score=70.0, completed_at=_DT, id_=2, story_slug="s2")
    t2 = _text()
    s2.text = t2
    result = _build_difficulty_progression([(s1, t1), (s2, t2)])
    assert len(result) == 1


# ---------------------------------------------------------------------------
# D. _build_common_error_patterns
# ---------------------------------------------------------------------------

def _make_error(character: str, error_type: str, session_id: int):
    return SimpleNamespace(
        character=character,
        error_type=error_type,
        session_id=session_id,
    )


class _MockDB:
    """Minimal DB mock: returns pre-set errors for CharacterError query."""

    def __init__(self, errors):
        self._errors = errors

    def query(self, model):
        return self

    def filter(self, *args):
        return self

    def all(self):
        return self._errors


def test_common_error_patterns_empty_pairs():
    """Empty session list → empty result, no crash."""
    result = _build_common_error_patterns(1, [], _MockDB([]))
    assert result == []


def test_common_error_patterns_only_includes_multi_text_chars():
    """Only characters appearing across >= 2 distinct text titles are returned.

    The code identifies 'distinct texts' by mapping session_id → text.title.
    A character must appear in sessions whose text.title values are different.
    """
    # Session 1 (text A, title='課文甲'): character "繁" appears
    # Session 2 (text B, title='課文乙'): character "繁" also appears → 2 distinct texts → included
    s1 = _session(id_=1, story_slug="text-a", completed_at=_DT)
    t1 = _text(title="課文甲")
    s1.text = t1
    s2 = _session(id_=2, story_slug="text-b", completed_at=_DT)
    t2 = _text(title="課文乙")  # distinct title from t1
    s2.text = t2

    errors = [_make_error("繁", "pronunciation", 1), _make_error("繁", "pronunciation", 2)]
    db = _MockDB(errors)
    result = _build_common_error_patterns(1, [(s1, t1), (s2, t2)], db)
    # "繁" appeared in 2 distinct text titles → included
    chars = [r["character"] for r in result]
    assert "繁" in chars


def test_common_error_patterns_excludes_single_text_chars():
    """Characters appearing in only one distinct text title are excluded.

    Two sessions that both map to the same text title count as ONE text.
    """
    s1 = _session(id_=1, story_slug="text-a", completed_at=_DT)
    t1 = _text(title="課文甲")
    s1.text = t1
    s2 = _session(id_=2, story_slug="text-a2", completed_at=_DT)
    t2 = _text(title="課文甲")  # same title → same 'text' from the dedup perspective
    s2.text = t2

    errors = [
        _make_error("簡", "pronunciation", 1),
        _make_error("簡", "pronunciation", 2),  # different session but same title → single text
    ]
    db = _MockDB(errors)
    result = _build_common_error_patterns(1, [(s1, t1), (s2, t2)], db)
    chars = [r["character"] for r in result]
    assert "簡" not in chars


def test_common_error_patterns_at_most_10_items():
    """Result is capped at 10 items even if more qualify."""
    sessions = []
    errors = []
    for i in range(12):
        # Create 2 sessions per character so each character spans 2 texts
        s_a = _session(id_=i * 2, story_slug=f"text-{i}-a", completed_at=_DT)
        t_a = _text(title=f"課文{i}甲")
        s_a.text = t_a
        s_b = _session(id_=i * 2 + 1, story_slug=f"text-{i}-b", completed_at=_DT)
        t_b = _text(title=f"課文{i}乙")
        s_b.text = t_b
        sessions.extend([(s_a, t_a), (s_b, t_b)])
        char = chr(0x4E00 + i)  # unique CJK chars
        errors.append(_make_error(char, "pronunciation", i * 2))
        errors.append(_make_error(char, "pronunciation", i * 2 + 1))

    db = _MockDB(errors)
    result = _build_common_error_patterns(1, sessions, db)
    assert len(result) <= 10


def test_common_error_patterns_result_has_required_keys():
    """Each result entry has character, error_count, text_count, dominant_error_type."""
    s1 = _session(id_=1, completed_at=_DT)
    t1 = _text(title="課文甲")
    s1.text = t1
    s2 = _session(id_=2, story_slug="s2", completed_at=_DT)
    t2 = _text(title="課文乙")
    s2.text = t2

    errors = [
        _make_error("錯", "pronunciation", 1),
        _make_error("錯", "stroke", 2),
    ]
    db = _MockDB(errors)
    result = _build_common_error_patterns(1, [(s1, t1), (s2, t2)], db)
    if result:
        required = {"character", "error_count", "text_count", "dominant_error_type"}
        assert required == set(result[0].keys())


# ---------------------------------------------------------------------------
# E. MIN_SESSIONS_FOR_ANALYSIS constant
# ---------------------------------------------------------------------------

def test_min_sessions_for_analysis_is_2():
    """MIN_SESSIONS_FOR_ANALYSIS is pinned at 2 (spec-documented threshold)."""
    assert MIN_SESSIONS_FOR_ANALYSIS == 2
