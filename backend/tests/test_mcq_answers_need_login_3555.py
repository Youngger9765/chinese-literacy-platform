"""#3555 — the public lesson API shipped every multiple-choice answer.

Staging 2026-10-15, no login: GET /api/stories/{id} returned `answer` for 871
MCQs in 176 of 179 lessons, plus 18 in one-lesson-many-articles rounds.
Anonymous callers now get no `answer` / `explanation`; a valid login still
does (the student renderers grade locally). Out of scope here and recorded on
the issue: a logged-in student can still read them; fill-in-blank answers.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.test_live_quiz_engine import auth_header, client, setup_db, student1  # noqa: F401

LESSONS = (20011, 20029)  # 20029: repeat_rounds carry MCQs with answers


def _mcqs(payload):
    out = list(payload.get("multiple_choice") or [])
    for r in (payload.get("repeat_rounds") or {}).values():
        if isinstance(r, dict):
            out += list(r.get("multiple_choice") or [])
    return out


def test_anonymous_detail_has_no_answer_key(client):
    for lid in LESSONS:
        r = client.get(f"/api/stories/{lid}")
        assert r.status_code == 200
        mcqs = _mcqs(r.json())
        assert mcqs, f"lesson {lid} should have MCQs"
        assert not [q for q in mcqs if "answer" in q or "explanation" in q], f"lesson {lid} leaks answers"
        assert all(q.get("question") and q.get("options") for q in mcqs), "questions themselves must survive"


def test_bad_token_is_treated_as_anonymous(client):
    r = client.get(f"/api/stories/{LESSONS[0]}", headers=auth_header("not-a-jwt"))
    assert r.status_code == 200
    assert not [q for q in _mcqs(r.json()) if "answer" in q]


def test_logged_in_student_still_gets_answers(client, student1):
    """Positive control: the renderers grade locally from these."""
    for lid in LESSONS:
        r = client.get(f"/api/stories/{lid}", headers=auth_header(student1["token"]))
        mcqs = _mcqs(r.json())
        assert mcqs and all(q.get("answer") for q in mcqs), f"lesson {lid} lost answers for a logged-in user"
