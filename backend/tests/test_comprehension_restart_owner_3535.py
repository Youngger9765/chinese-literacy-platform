"""#3535 — '重新開始' may only clear the caller's own comprehension dialogue.

`POST /comprehension/restart` deletes every DialogueTurn of `db_session_id` and wipes
its dialogue_state. It never checked whose session that was, so any student could
walk the sequential ids and erase everyone's dialogue (which teachers also review).
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime, timezone
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.dependencies import get_current_user
from app.auth.rate_limiter import ai_limit_10_per_min
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.session import DialogueTurn, LearningSession
from app.models.user import User

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def w():
    Base.metadata.create_all(bind=engine)
    db = Session()
    a = User(email="a@example.com", name="a", password_hash="x", is_active=True)
    b = User(email="b@example.com", name="b", password_hash="x", is_active=True)
    db.add_all([a, b])
    db.flush()
    sa = LearningSession(student_id=a.id, story_slug="20011", status="in_progress",
                         started_at=datetime.now(timezone.utc), dialogue_state={"q": 2})
    db.add(sa)
    db.flush()
    for i in range(3):
        db.add(DialogueTurn(socratic_session_id="s-a", learning_session_id=sa.id, turn_order=i, role="ai", text=f"t{i}"))
    db.commit()

    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[ai_limit_10_per_min] = lambda: None
    client = TestClient(app)

    def restart(as_user, db_session_id):
        uid = as_user.id
        app.dependency_overrides[get_current_user] = lambda db=Depends(get_db): db.get(User, uid)
        return client.post("/api/comprehension/restart", json={"session_id": "s-x", "db_session_id": db_session_id})

    def turns():
        s = Session()
        try:
            return s.query(DialogueTurn).filter_by(learning_session_id=sa.id).count()
        finally:
            s.close()

    yield {"restart": restart, "turns": turns, "a": a, "b": b, "sa": sa.id}
    app.dependency_overrides.clear()
    db.close()
    Base.metadata.drop_all(bind=engine)


def test_another_student_cannot_clear_my_dialogue(w):
    r = w["restart"](w["b"], w["sa"])
    assert r.status_code in (403, 404), r.status_code
    assert w["turns"]() == 3


def test_owner_can_restart(w):
    assert w["restart"](w["a"], w["sa"]).status_code == 204
    assert w["turns"]() == 0


def test_restart_without_db_session_still_works(w):
    r = w["restart"](w["b"], None)
    assert r.status_code == 204
    assert w["turns"]() == 3
