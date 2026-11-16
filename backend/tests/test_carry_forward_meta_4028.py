"""#4028 — carried-forward progress must not carry the previous session's assignment identity.

#2889 copies the previous session's whole step_progress into a new session when a
student reopens a finished lesson. It copied ``__meta`` too, so if the previous
session was an assignment, the new self-practice session carried
``source: "assignment"`` / ``assignment_id`` and was treated as an assignment
session — after-class practice mixed into the teacher's assignment records.
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


# ---------------------------------------------------------------------------


def test_carried_progress_records_its_source_and_keeps_the_steps(client, lessons):
    tok = _student(client, "inherit")
    first = _open(client, tok, lessons[0])
    _put(client, tok, first, steps_completed=DONE)
    _complete(client, tok, first)

    second = _open(client, tok, lessons[0])
    sp = _progress(client, tok, second)
    assert sorted(sp["steps_completed"]) == sorted(DONE), "#2889 behaviour must not change"
    assert sp["__meta"]["carried_from"]["session_id"] == first
    assert sp["__meta"]["carried_from"]["at"]


def test_a_fresh_lesson_has_no_carried_from(client, lessons):
    """Positive control: a lesson never opened has nothing inherited."""
    tok = _student(client, "fresh")
    sid = _open(client, tok, lessons[1])
    sp = _progress(client, tok, sid)
    assert "carried_from" not in (sp.get("__meta") or {})


def test_assignment_meta_does_not_leak_into_self_practice(client, lessons):
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


def test_a_later_save_keeps_the_carry_record(client, lessons):
    tok = _student(client, "save")
    first = _open(client, tok, lessons[3])
    _put(client, tok, first, steps_completed=DONE)
    _complete(client, tok, first)
    second = _open(client, tok, lessons[3])
    sp = _put(client, tok, second, steps_completed=DONE + ["comprehension"])
    assert sp["__meta"]["carried_from"]["session_id"] == first
