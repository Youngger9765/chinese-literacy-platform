"""#2889 — reopening a lesson you have already finished must not hand you a blank page.

Reported after opening 第一課 on staging as the demo student: every one of the ten
step pills was grey, the stepper said 「下一步：讀全文-做記號」, and nothing suggested the
lesson had ever been touched. It had been finished 73 times.

The records were never lost. Each completed session still answers
`GET /learning/sessions/{id}/progress` with its five completed steps. But
`POST /learning/sessions` only reuses a session whose status is `in_progress`
(#984 dedup), so a student returning to a lesson they finished gets a brand-new row
with `step_progress = NULL` — and the page renders exactly what it is given.

Owner's call, asked explicitly: carry the progress forward (A), rather than start
clean and merely show a history link (B).

The four negative cases below are the point of the file. "Carries something forward"
is easy to satisfy by carrying the wrong thing forward, and progress belonging to
another student — or another lesson — leaking into your page is a worse bug than the
blank page it replaces.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.main import app
from app.models import Base
from app.models.user import Role
from app.services.lesson_loader import get_all_lessons

_engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                        poolclass=StaticPool)
_Session = sessionmaker(bind=_engine, autocommit=False, autoflush=False)


@pytest.fixture(scope="module", autouse=True)
def _db():
    Base.metadata.create_all(bind=_engine)
    s = _Session()
    for name, label, scope in (("student", "Student", "school"),
                               ("teacher", "Teacher", "school"),
                               ("system_admin", "System Admin", "platform")):
        if not s.query(Role).filter_by(name=name).first():
            s.add(Role(name=name, display_name=label, scope_level=scope, description=name))
    s.commit()
    s.close()

    def _override():
        db = _Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=_engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _student(client, tag: str) -> str:
    email, password = f"carry_{tag}@example.com", "SecurePass123!"
    reg = client.post("/api/auth/register",
                      json={"email": email, "password": password, "name": f"Carry {tag}"})
    assert reg.status_code == 201, reg.text
    vt = reg.json().get("verification_token")
    if vt:
        client.get(f"/api/auth/verify-email?token={vt}")
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def alice(client):
    return _student(client, "alice")


@pytest.fixture(scope="module")
def bob(client):
    return _student(client, "bob")


@pytest.fixture(scope="module")
def lessons():
    ls = get_all_lessons()
    assert len(ls) >= 2, "need two real lessons to test cross-lesson isolation"
    return str(ls[0]["id"]), str(ls[1]["id"])


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


DONE_STEPS = ["lesson-intro", "full-text-annotate", "key-passage-reading"]
STEP_DATA = {"key-passage-reading": {"cpm": 118, "attempts": 2}}


def _open(client, token, slug) -> int:
    r = client.post("/api/learning/sessions", json={"story_slug": slug}, headers=_h(token))
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _finish(client, token, sid, steps=None, data=None):
    """Do some steps, then mark the session completed — what a student actually does."""
    put = client.put(
        f"/api/learning/sessions/{sid}/progress",
        json={"current_step": "vocab-definition",
              "steps_completed": DONE_STEPS if steps is None else steps,
              "step_data": STEP_DATA if data is None else data},
        headers=_h(token),
    )
    assert put.status_code == 200, put.text
    pat = client.patch(f"/api/learning/sessions/{sid}",
                       json={"status": "completed"}, headers=_h(token))
    assert pat.status_code == 200, pat.text


def _progress(client, token, sid) -> dict:
    r = client.get(f"/api/learning/sessions/{sid}/progress", headers=_h(token))
    assert r.status_code == 200, r.text
    return r.json().get("step_progress") or {}


# ---------------------------------------------------------------------------


def test_reopening_a_finished_lesson_keeps_the_steps_you_already_did(client, alice, lessons):
    slug, _ = lessons
    first = _open(client, alice, slug)
    _finish(client, alice, first)

    second = _open(client, alice, slug)
    assert second != first, "a completed session must not be reused as-is"

    sp = _progress(client, alice, second)
    assert sorted(sp.get("steps_completed", [])) == sorted(DONE_STEPS), (
        f"the new session came back blank: {sp!r} — this is the reported bug"
    )
    # The work itself, not just the tick marks: a green pill with no data behind it
    # is the same blank page wearing a costume.
    assert sp.get("step_data", {}).get("key-passage-reading") == STEP_DATA["key-passage-reading"]


def test_a_lesson_never_touched_still_starts_empty(client, alice, lessons):
    """Positive control for the negative case. Without it, 'always seed something'
    would pass the test above."""
    _, other = lessons
    sid = _open(client, alice, other)
    sp = _progress(client, alice, sid)
    assert sp.get("steps_completed", []) == [], f"invented progress from nowhere: {sp!r}"


def test_finishing_one_lesson_does_not_seed_a_different_one(client, alice, lessons):
    slug, other = lessons
    done = _open(client, alice, slug)
    _finish(client, alice, done)

    fresh = _open(client, alice, other)
    sp = _progress(client, alice, fresh)
    assert sp.get("steps_completed", []) == [], (
        f"lesson {slug}'s progress leaked into lesson {other}: {sp!r}"
    )


def test_another_students_progress_never_leaks_in(client, alice, bob, lessons):
    """The nastiest way this fix can go wrong: seeding from 'the latest completed
    session for this story' without scoping to the student."""
    slug, _ = lessons
    mine = _open(client, alice, slug)
    _finish(client, alice, mine)

    theirs = _open(client, bob, slug)
    sp = _progress(client, bob, theirs)
    assert sp.get("steps_completed", []) == [], (
        f"another student's progress was carried into this one: {sp!r}"
    )


def test_an_unfinished_session_is_still_reused_not_duplicated(client, alice, lessons):
    """#984 dedup must survive. Carrying forward is for the completed case only."""
    _, other = lessons
    a = _open(client, alice, other)
    b = _open(client, alice, other)
    assert a == b, "an in_progress session must be reused, not duplicated"
