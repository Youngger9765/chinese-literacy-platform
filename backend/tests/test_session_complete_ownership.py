"""POST /gamification/session-complete must only settle a session for its own child.

Settlement is idempotent per session_id. Before this, the route only checked that the
caller could *view* `student_id` — not that `session_id` belonged to that student. So
a child could post a classmate's session id under their own student_id: they got the
XP, and when the classmate really finished, the settlement was "already done" and
they got nothing (no XP, no streak).
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime, timezone
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.session import LearningSession
from app.models.user import User

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine, "connect")
def _fk(dbapi_connection, _):
    dbapi_connection.execute("PRAGMA foreign_keys=ON")


Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def w():
    Base.metadata.create_all(bind=engine)
    db = Session()
    a = User(email="a@example.com", name="a", password_hash="x", is_active=True)
    b = User(email="b@example.com", name="b", password_hash="x", is_active=True)
    db.add_all([a, b])
    db.flush()
    sa = LearningSession(student_id=a.id, story_slug="20011", status="completed", started_at=datetime.now(timezone.utc))
    sb = LearningSession(student_id=b.id, story_slug="20011", status="completed", started_at=datetime.now(timezone.utc))
    db.add_all([sa, sb])
    db.commit()

    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db
    client = TestClient(app, raise_server_exceptions=False)

    def post(as_user, student_id, session_id):
        uid = as_user.id
        app.dependency_overrides[get_current_user] = lambda db=Depends(get_db): db.get(User, uid)
        return client.post("/api/gamification/session-complete",
                           json={"student_id": student_id, "session_id": session_id, "reading_accuracy": 90})

    yield {"post": post, "a": a, "b": b, "sa": sa.id, "sb": sb.id}
    app.dependency_overrides.clear()
    db.close()
    Base.metadata.drop_all(bind=engine)


def test_owner_settles_own_session(w):
    r = w["post"](w["a"], w["a"].id, w["sa"])
    assert r.status_code == 200 and r.json()["xp_earned"] > 0


def test_cannot_settle_a_classmates_session_and_classmate_still_gets_xp(w):
    r = w["post"](w["a"], w["a"].id, w["sb"])  # a's own student_id, b's session
    assert r.status_code in (403, 404), r.status_code
    later = w["post"](w["b"], w["b"].id, w["sb"])
    assert later.status_code == 200 and later.json()["xp_earned"] > 0


def test_unknown_session_is_404_not_500(w):
    assert w["post"](w["a"], w["a"].id, 999999).status_code == 404
