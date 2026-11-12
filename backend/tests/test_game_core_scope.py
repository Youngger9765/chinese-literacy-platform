"""Characterization tests for `app.services.game_core.scope` — the module
extracted verbatim from `services/pk/engine.py` and
`services/escape_room/engine.py` by issue #3663's architecture audit
(docs/architecture/game-modules.md). These assert the behavior those two
modes' own test suites were already relying on (test_pk_pool_robustness.py
N2, test_escape_room_engine.py), kept here directly against the shared
module so a future change to it is caught at the source, not only via
whichever mode's test happens to exercise the path.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services.game_core import scope


def test_resolve_pool_grade_returns_exact_match_when_available(monkeypatch):
    monkeypatch.setattr(scope, "get_available_grades", lambda: [4, 5, 6])
    assert scope.resolve_pool_grade("5") == "5"


def test_resolve_pool_grade_falls_back_to_nearest_grade(monkeypatch):
    # #3610: grade-3 classrooms exist but the library starts at 4.
    monkeypatch.setattr(scope, "get_available_grades", lambda: [4, 6])
    assert scope.resolve_pool_grade("3") == "4"


def test_resolve_pool_grade_prefers_higher_grade_on_tie(monkeypatch):
    monkeypatch.setattr(scope, "get_available_grades", lambda: [4, 6])
    assert scope.resolve_pool_grade("5") == "6"


def test_resolve_pool_grade_keeps_non_numeric_pool_as_itself(monkeypatch):
    monkeypatch.setattr(scope, "get_available_grades", lambda: ["品格教育"])
    assert scope.resolve_pool_grade("品格教育") == "品格教育"


def test_resolve_pool_grade_rejects_out_of_range_grade(monkeypatch):
    monkeypatch.setattr(scope, "get_available_grades", lambda: [4, 5, 6])
    with pytest.raises(HTTPException) as exc:
        scope.resolve_pool_grade("13")
    assert exc.value.status_code == 400
    assert exc.value.detail == scope.ERR_UNKNOWN_GRADE


def test_resolve_pool_grade_rejects_non_numeric_unknown_pool(monkeypatch):
    monkeypatch.setattr(scope, "get_available_grades", lambda: [4, 5, 6])
    with pytest.raises(HTTPException) as exc:
        scope.resolve_pool_grade("not-a-grade")
    assert exc.value.detail == scope.ERR_UNKNOWN_GRADE


def test_resolve_pool_grade_empty_pool_raises(monkeypatch):
    monkeypatch.setattr(scope, "get_available_grades", lambda: [])
    with pytest.raises(HTTPException) as exc:
        scope.resolve_pool_grade("5")
    assert exc.value.detail == scope.ERR_EMPTY_POOL


def test_validate_scope_accepts_a_classroom_grade_with_no_pool(monkeypatch):
    monkeypatch.setattr(scope, "get_available_grades", lambda: [4, 6])
    scope.validate_scope("grade_pool", "3")  # must not raise


def test_validate_scope_rejects_unknown_scope_type():
    with pytest.raises(HTTPException) as exc:
        scope.validate_scope("not-a-real-scope", "x")
    assert exc.value.detail == scope.ERR_UNKNOWN_SCOPE


def test_validate_scope_rejects_unknown_lesson(monkeypatch):
    monkeypatch.setattr(scope, "load_lesson", lambda _uid: None)
    with pytest.raises(HTTPException) as exc:
        scope.validate_scope("lesson", "no-such-lesson")
    assert exc.value.detail == scope.ERR_UNKNOWN_LESSON


def test_load_lessons_for_scope_lesson_returns_single_entry(monkeypatch):
    monkeypatch.setattr(scope, "load_lesson", lambda uid: {"title": uid} if uid == "L1" else None)
    lessons = scope.load_lessons_for_scope("lesson", "L1")
    assert lessons == [{"lesson_uid": "L1", "lesson": {"title": "L1"}}]


def test_load_lessons_for_scope_unknown_lesson_raises(monkeypatch):
    monkeypatch.setattr(scope, "load_lesson", lambda _uid: None)
    with pytest.raises(HTTPException) as exc:
        scope.load_lessons_for_scope("lesson", "no-such-lesson")
    assert exc.value.detail == scope.ERR_UNKNOWN_LESSON


def test_load_lessons_for_scope_grade_pool_filters_missing_lessons(monkeypatch):
    monkeypatch.setattr(scope, "get_available_grades", lambda: [4])
    monkeypatch.setattr(
        scope,
        "search_lessons",
        lambda grade: [{"lesson_uid": "L1"}, {"lesson_uid": "L2"}, {}],
    )
    monkeypatch.setattr(scope, "load_lesson", lambda uid: {"title": uid} if uid == "L1" else None)
    lessons = scope.load_lessons_for_scope("grade_pool", "4")
    assert lessons == [{"lesson_uid": "L1", "lesson": {"title": "L1"}}]


def test_load_lessons_for_scope_grade_pool_empty_raises(monkeypatch):
    monkeypatch.setattr(scope, "get_available_grades", lambda: [4])
    monkeypatch.setattr(scope, "search_lessons", lambda grade: [])
    with pytest.raises(HTTPException) as exc:
        scope.load_lessons_for_scope("grade_pool", "4")
    assert exc.value.detail == scope.ERR_EMPTY_POOL


def test_load_lessons_for_scope_rejects_unknown_scope_type():
    with pytest.raises(HTTPException) as exc:
        scope.load_lessons_for_scope("not-a-real-scope", "x")
    assert exc.value.detail == scope.ERR_UNKNOWN_SCOPE
