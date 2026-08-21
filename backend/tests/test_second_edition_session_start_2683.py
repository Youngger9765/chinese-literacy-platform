"""A student cannot start a lesson — every second-edition story is rejected (#2683).

Found by walking the eleven steps on the preview deployment. Each step rendered, so
every presence check passed; underneath, the app's own POST was coming back

    422  {"detail": "unknown story_slug: '20001'"}

The session gate (#1135) validates the slug against the `texts` table, and that table
holds FIRST-EDITION lesson numbers. The re-ink renumbered every lesson, so no
second-edition id is in it — which means no session is created, and nothing a student
does is recorded, for all 175 lessons.

The rest of the route already anticipates a lesson with no DB row: `text_id` is
nullable, and the list endpoint falls back to `get_lesson_by_id` to title a session
whose `text` is None. Only the gate insists on the table.
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


@pytest.fixture(scope="module")
def token(client):
    email, password = "s2683@example.com", "SecurePass123!"
    reg = client.post("/api/auth/register",
                      json={"email": email, "password": password, "name": "Student 2683"})
    assert reg.status_code == 201, reg.text
    vt = reg.json().get("verification_token")
    if vt:
        client.get(f"/api/auth/verify-email?token={vt}")
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def test_a_student_can_start_a_session_on_a_second_edition_lesson(client, token):
    """The `texts` table is EMPTY here, exactly as it is for every second-edition
    lesson in the deployed database. The story is real — the loader serves it — and
    that has to be enough to record what the student does."""
    lesson = get_all_lessons()[0]
    r = client.post("/api/learning/sessions",
                    json={"story_slug": str(lesson["id"])},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code in (200, 201), (
        f"{r.status_code} {r.text} — the student cannot begin 《{lesson['title']}》"
    )
    assert r.json()["story_slug"] == str(lesson["id"])


def test_a_story_that_does_not_exist_is_still_rejected(client, token):
    """The gate's purpose survives: an unknown slug must not open a session. Without
    this, 'accept anything' would pass the test above."""
    r = client.post("/api/learning/sessions",
                    json={"story_slug": "99999999"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 422, f"an unknown story was accepted: {r.status_code} {r.text}"


def test_listing_sessions_filtered_by_that_story_does_not_explode(client, token):
    """The same walk got a 500 from this call. A student's own progress lookup
    failing is invisible until the page silently has no history."""
    lesson = get_all_lessons()[0]
    r = client.get(f"/api/learning/sessions?story_slug={lesson['id']}&status=in_progress&limit=1",
                   headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"{r.status_code} {r.text}"


def test_listing_after_progress_is_saved_does_not_explode(client, token):
    """The preview kept 500ing on this exact call AFTER a session existed with saved
    progress — the state my first version of this test never reached, because it
    listed sessions that had never been touched."""
    lesson = get_all_lessons()[0]
    h = {"Authorization": f"Bearer {token}"}
    sid = client.post("/api/learning/sessions",
                      json={"story_slug": str(lesson["id"])}, headers=h).json()["id"]
    client.put(f"/api/learning/sessions/{sid}/progress",
               json={"current_step": "comprehension",
                     "steps_completed": ["intro", "live_tutor"], "step_data": {}},
               headers=h)
    r = client.get(
        f"/api/learning/sessions?story_slug={lesson['id']}&status=in_progress&limit=1",
        headers=h)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    assert r.json()["items"][0]["current_step"] == 3
