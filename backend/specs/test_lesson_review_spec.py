"""Executable spec — 學習批閱 (lesson review) pure rules.

spec_id: teacher.lesson_review
canonical_source: backend/app/services/lesson_review_service.py
related_issues: [4104]
human_spec: specs/modules/lesson-review/INTENT.md

Machine-verifiable contracts (INTENT §2):

  A. "started" needs real step work; a bootstrap-only session is not started (#4).
  B. "redone" = server-stamped activity on that step after returned_at (#5).
  C. Only a sent review is visible; a returned step that was redone is no
     longer "returned" (#3, #5).
  D. Scores clamp to 0–100; comments are trimmed and capped at 500 (#9).

Endpoint behaviour (auth, draft vs send, re-send keeps a waiting return's time)
lives in backend/tests/test_lesson_review_4104.py.

Run: cd backend && python -m pytest specs/test_lesson_review_spec.py -v
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services import lesson_review_service as svc

T0 = datetime(2026, 11, 18, 2, 0, tzinfo=timezone.utc)


def _session(sp):
    return SimpleNamespace(step_progress=sp, started_at=T0, completed_at=None)


def _step(key, returned=True, at=T0, comment=None, score=None):
    return SimpleNamespace(step_key=key, returned=returned, returned_at=at if returned else None,
                           comment=comment, score=score)


# A
def test_bootstrap_only_session_is_not_started():
    assert not svc.session_started(_session({"current_step": None, "steps_completed": [], "step_data": {}}))
    assert not svc.session_started(_session(None))


def test_any_step_work_counts_as_started():
    assert svc.session_started(_session({"steps_completed": ["vocab#a"], "step_data": {}}))
    assert svc.session_started(_session({"steps_completed": [], "step_data": {"x": {"a": 1}}}))
    assert svc.session_started(_session({"__meta": {"step_activity": {"x": T0.isoformat()}}}))


# B
def test_redone_needs_activity_on_that_step_after_the_return():
    s = _step("comprehension#a")
    assert not svc.is_redone(s, {})
    assert not svc.is_redone(s, {"comprehension#a": T0 - timedelta(minutes=1)})
    assert not svc.is_redone(s, {"spotlight#b": T0 + timedelta(minutes=1)})
    assert svc.is_redone(s, {"comprehension#a": T0 + timedelta(seconds=1)})
    assert not svc.is_redone(_step("x", returned=False), {"x": T0 + timedelta(days=1)})


def test_activity_takes_the_latest_stamp_across_sessions():
    old = _session({"__meta": {"step_activity": {"a": (T0 + timedelta(hours=1)).isoformat()}}})
    new = _session({"__meta": {"step_activity": {"a": T0.isoformat(), "b": "not-a-date"}}})
    acts = svc.step_activity([new, old])
    assert acts == {"a": T0 + timedelta(hours=1)}


# C
def test_unsent_review_shows_nothing():
    review = SimpleNamespace(sent_at=None, steps=[_step("a")])
    assert svc.sent_steps_view(review, {}) == {}
    assert svc.sent_steps_view(None, {}) == {}


def test_redone_return_is_no_longer_returned():
    review = SimpleNamespace(sent_at=T0, steps=[_step("a", comment="c", score=70), _step("b")])
    view = svc.sent_steps_view(review, {"a": T0 + timedelta(minutes=5)})
    assert view["a"]["returned"] is False and view["a"]["redone"] is True
    assert view["a"]["comment"] == "c" and view["a"]["score"] == 70
    assert view["b"]["returned"] is True and view["b"]["redone"] is False
    assert svc.returned_count(view) == 1 and svc.redone_count(view) == 1


# D
def test_score_and_comment_cleaning():
    assert svc.clean_score(None) is None
    assert svc.clean_score(150) == 100
    assert svc.clean_score(-3) == 0
    assert svc.clean_comment("   ") is None
    assert svc.clean_comment("  好  ") == "好"
    assert len(svc.clean_comment("字" * 900)) == svc.COMMENT_MAX
