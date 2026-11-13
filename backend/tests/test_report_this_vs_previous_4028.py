"""#4028 — the report must be able to tell "done this time" from "done last time".

#2889 carries the previous session's step_progress into a new session when a
student reopens a lesson they already finished, steps_completed included. The
report page (#3399) ticks a card for every id in steps_completed, so the moment a
student reopened a finished lesson every card was green — on staging a 25-second
session showed sixteen completed steps.

The fix keeps steps_completed cumulative (stepper pills and assignment readiness
rely on it) and adds two things:

- ``__meta.carried_from``: which ticks were inherited, and from which session
- ``session_steps_completed``: what was completed in THIS session only

These tests pin both, plus the ways it could go wrong: losing the list to a racing
empty save, claiming a step "done now" the session doesn't have, an older client
that doesn't send the field wiping it, and assignment metadata leaking from the
previous session into a self-practice one.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.main import app
from app.models import Base
from app.models.session import LearningSession
from app.models.user import Role
from app.services.lesson_loader import get_all_lessons
from app.services.omo_session_sync import build_step_progress_update

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
    email, password = f"r4028_{tag}@example.com", "SecurePass123!"
    reg = client.post("/api/auth/register",
                      json={"email": email, "password": password, "name": f"R {tag}"})
    assert reg.status_code == 201, reg.text
    vt = reg.json().get("verification_token")
    if vt:
        client.get(f"/api/auth/verify-email?token={vt}")
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def lessons():
    ls = get_all_lessons()
    assert len(ls) >= 6
    return [str(x["id"]) for x in ls[:6]]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _open(client, token, slug) -> int:
    r = client.post("/api/learning/sessions", json={"story_slug": slug}, headers=_h(token))
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _put(client, token, sid, **body):
    body.setdefault("current_step", "vocab-definition")
    body.setdefault("steps_completed", [])
    body.setdefault("step_data", {})
    r = client.put(f"/api/learning/sessions/{sid}/progress", json=body, headers=_h(token))
    assert r.status_code == 200, r.text
    return r.json()["step_progress"]


def _complete(client, token, sid):
    r = client.patch(f"/api/learning/sessions/{sid}",
                     json={"status": "completed"}, headers=_h(token))
    assert r.status_code == 200, r.text


def _progress(client, token, sid) -> dict:
    r = client.get(f"/api/learning/sessions/{sid}/progress", headers=_h(token))
    assert r.status_code == 200, r.text
    return r.json().get("step_progress") or {}


DONE = ["full-text-annotate", "key-passage-reading", "vocab-definition"]


# ── carry-forward records where the ticks came from ──────────────────────────


def test_reopened_lesson_says_which_ticks_were_inherited(client, lessons):
    tok = _student(client, "inherit")
    first = _open(client, tok, lessons[0])
    _put(client, tok, first, steps_completed=DONE, session_steps_completed=DONE)
    _complete(client, tok, first)

    second = _open(client, tok, lessons[0])
    sp = _progress(client, tok, second)

    # #2889 behaviour is unchanged: the pills still come back.
    assert sorted(sp["steps_completed"]) == sorted(DONE)
    carried = sp["__meta"]["carried_from"]
    assert carried["session_id"] == first
    assert sorted(carried["steps_completed"]) == sorted(DONE)
    assert carried["at"], "the report shows this date; it must not be empty"
    # …but nothing has been done in this session yet. This is the reported bug.
    assert sp["session_steps_completed"] == []


def test_a_fresh_lesson_has_no_carried_from(client, lessons):
    """Positive control: a lesson never opened has nothing inherited."""
    tok = _student(client, "fresh")
    sid = _open(client, tok, lessons[1])
    sp = _progress(client, tok, sid)
    assert "carried_from" not in (sp.get("__meta") or {})


def test_assignment_meta_does_not_leak_into_self_practice(client, lessons):
    """The previous session was an assignment session; the new one is self-practice.
    Copying __meta wholesale made the new session look like an assignment."""
    tok = _student(client, "leak")
    first = _open(client, tok, lessons[2])
    _put(client, tok, first, steps_completed=DONE)
    db = _Session()
    row = db.get(LearningSession, first)
    row.step_progress = {**row.step_progress,
                         "__meta": {"source": "assignment", "assignment_id": 999}}
    flag_modified(row, "step_progress")
    db.commit()
    db.close()
    _complete(client, tok, first)

    second = _open(client, tok, lessons[2])
    meta = _progress(client, tok, second)["__meta"]
    assert "source" not in meta and "assignment_id" not in meta, meta
    assert meta["carried_from"]["session_id"] == first


# ── PUT keeps session_steps_completed honest ─────────────────────────────────


def test_completing_a_step_now_is_recorded_as_this_session(client, lessons):
    tok = _student(client, "redo")
    first = _open(client, tok, lessons[3])
    _put(client, tok, first, steps_completed=DONE, session_steps_completed=DONE)
    _complete(client, tok, first)
    second = _open(client, tok, lessons[3])

    # Redo one inherited step and do one new one.
    sp = _put(client, tok, second,
              steps_completed=DONE + ["comprehension"],
              session_steps_completed=["vocab-definition", "comprehension"])
    assert sp["session_steps_completed"] == ["vocab-definition", "comprehension"]
    assert sp["__meta"]["carried_from"]["session_id"] == first, "a PUT must keep __meta"


def test_an_empty_racing_save_does_not_wipe_it(client, lessons):
    """Same race #3682 guards steps_completed against."""
    tok = _student(client, "race")
    sid = _open(client, tok, lessons[4])
    _put(client, tok, sid, steps_completed=["spotlight"], session_steps_completed=["spotlight"])
    sp = _put(client, tok, sid, steps_completed=[], session_steps_completed=[])
    assert sp["session_steps_completed"] == ["spotlight"]


def test_an_older_client_that_omits_the_field_leaves_it_alone(client, lessons):
    tok = _student(client, "old")
    sid = _open(client, tok, lessons[4])
    _put(client, tok, sid, steps_completed=["spotlight"], session_steps_completed=["spotlight"])
    sp = _put(client, tok, sid, steps_completed=["spotlight", "comprehension"])
    assert sp["session_steps_completed"] == ["spotlight"]


def test_an_older_client_on_an_untracked_session_does_not_invent_it(client, lessons):
    """Sessions that never had the field keep not having it; the report falls back."""
    tok = _student(client, "legacy")
    sid = _open(client, tok, lessons[5])
    sp = _put(client, tok, sid, steps_completed=["spotlight"])
    assert "session_steps_completed" not in sp


def test_cannot_claim_a_step_the_session_does_not_have(client, lessons):
    tok = _student(client, "claim")
    sid = _open(client, tok, lessons[5])
    sp = _put(client, tok, sid, steps_completed=["spotlight"],
              session_steps_completed=["spotlight", "comprehension"])
    assert sp["session_steps_completed"] == ["spotlight"]


def test_reset_steps_also_un_completes_it_for_this_session(client, lessons):
    """「再讀一次」 drops a step on purpose (#2533); it must drop here too."""
    tok = _student(client, "reset")
    sid = _open(client, tok, lessons[5])
    _put(client, tok, sid, steps_completed=["paragraph-reading"],
         session_steps_completed=["paragraph-reading"])
    sp = _put(client, tok, sid, steps_completed=[], session_steps_completed=[],
              reset_steps=["paragraph-reading"])
    assert sp["session_steps_completed"] == []
    assert "paragraph-reading" not in sp["steps_completed"]


# ── OMO paper grading keeps the list ─────────────────────────────────────────


class _G:
    def __init__(self, step):
        self.question_id, self.student_answer, self.correct_answer = "q1", "a", "a"
        self.score, self.ai_confidence, self.context = 1, 0.9, {}
        self._step = step


def test_omo_sync_keeps_session_list_and_counts_the_worksheet(monkeypatch):
    import app.services.omo_session_sync as m
    monkeypatch.setattr(m, "_step_for", lambda g: g._step)
    existing = {"steps_completed": ["spotlight"], "step_data": {},
                "session_steps_completed": ["spotlight"],
                "__meta": {"carried_from": {"session_id": 1, "at": "x", "steps_completed": []}}}
    out = build_step_progress_update(existing, [_G("comprehension")])
    assert out["session_steps_completed"] == ["spotlight", "comprehension"]
    assert out["__meta"]["carried_from"]["session_id"] == 1


def test_omo_sync_does_not_invent_the_list(monkeypatch):
    import app.services.omo_session_sync as m
    monkeypatch.setattr(m, "_step_for", lambda g: g._step)
    out = build_step_progress_update({"steps_completed": []}, [_G("comprehension")])
    assert "session_steps_completed" not in out
