"""Per-student isolation tests for the practice toolbox (Issue #3346, batch 8).

Covers backend/app/routes/learning/toolbox.py:

    POST /api/toolbox/{tool}/sessions
    GET  /api/toolbox/{tool}/sessions
    GET  /api/toolbox/sessions/all

The module docstring promises "rows are always scoped to current_user.id".
Before this file there was no test of that promise for any of the 10 tool
tables, so dropping a `student_id == current_user.id` filter would expose every
student's practice results to every other student.

Least-privilege discipline (rules/testing-strategy.md): both callers are plain
students. Each isolation check is paired with the same student seeing *their
own* row, so an empty list cannot pass as "isolated".

Run with:
    cd backend
    python -m pytest tests/test_toolbox_isolation_3346.py -v
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.password import hash_password
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.user import User
from app.routes.learning.toolbox import TOOL_MODEL_MAP

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

PASSWORD = "Password1!"
TOOLS = list(TOOL_MODEL_MAP)
ALICE_SCORE = 11.0
BOB_SCORE = 99.0

U: dict[str, int] = {}


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    for key in ("alice", "bob", "carol"):
        user = User(
            email=f"tbx3346_{key}@example.com",
            username=f"tbx3346_{key}",
            password_hash=hash_password(PASSWORD),
            name=key,
            is_active=True,
            email_verified=True,
        )
        db.add(user)
        db.flush()
        U[key] = user.id
    db.commit()
    db.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


_TOKENS: dict[str, dict] = {}


def _auth(client, key: str) -> dict:
    if key not in _TOKENS:
        resp = client.post(
            "/api/auth/login",
            json={"email": f"tbx3346_{key}@example.com", "password": PASSWORD},
        )
        assert resp.status_code == 200, resp.text
        _TOKENS[key] = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    return _TOKENS[key]


@pytest.fixture(scope="module")
def seeded(client):
    """alice and bob each record one session in every tool, via the API."""
    for tool in TOOLS:
        for key, score in (("alice", ALICE_SCORE), ("bob", BOB_SCORE)):
            r = client.post(
                f"/api/toolbox/{tool}/sessions",
                headers=_auth(client, key),
                json={"score": score, "result": {"who": key}, "duration_ms": 1000},
            )
            assert r.status_code == 200, (tool, key, r.text)
    return True


class TestPerToolIsolation:
    @pytest.mark.parametrize("tool", TOOLS)
    def test_student_sees_only_own_rows(self, client, seeded, tool):
        r = client.get(f"/api/toolbox/{tool}/sessions", headers=_auth(client, "alice"))
        assert r.status_code == 200, r.text
        rows = r.json()
        assert [(row["student_id"], row["score"], row["tool_id"]) for row in rows] == [
            (U["alice"], ALICE_SCORE, tool)
        ]

    def test_other_student_sees_their_own(self, client, seeded):
        # positive control from the other side
        rows = client.get(f"/api/toolbox/{TOOLS[0]}/sessions", headers=_auth(client, "bob")).json()
        assert [(row["student_id"], row["result"]) for row in rows] == [(U["bob"], {"who": "bob"})]

    def test_student_with_no_practice_sees_empty(self, client, seeded):
        for tool in TOOLS:
            rows = client.get(f"/api/toolbox/{tool}/sessions", headers=_auth(client, "carol")).json()
            assert rows == [], tool


class TestAllSessionsIsolation:
    def test_aggregate_contains_only_own_rows_from_every_tool(self, client, seeded):
        r = client.get("/api/toolbox/sessions/all", headers=_auth(client, "alice"))
        assert r.status_code == 200, r.text
        rows = r.json()
        assert {row["student_id"] for row in rows} == {U["alice"]}
        assert sorted(row["tool_id"] for row in rows) == sorted(TOOLS)
        assert BOB_SCORE not in {row["score"] for row in rows}

    def test_aggregate_for_student_with_no_practice_is_empty(self, client, seeded):
        assert client.get("/api/toolbox/sessions/all", headers=_auth(client, "carol")).json() == []

    def test_aggregate_limit_is_clamped_to_at_least_one(self, client, seeded):
        rows = client.get("/api/toolbox/sessions/all?limit=0", headers=_auth(client, "alice")).json()
        assert len(rows) == 1


class TestCreateWritesAsCaller:
    def test_body_student_id_is_ignored(self, client):
        r = client.post(
            f"/api/toolbox/{TOOLS[0]}/sessions",
            headers=_auth(client, "carol"),
            json={"student_id": U["alice"], "score": 5.0},
        )
        assert r.status_code == 200, r.text
        assert r.json()["student_id"] == U["carol"]
        assert r.json()["completed_at"] is not None
        db = TestingSessionLocal()
        try:
            model = TOOL_MODEL_MAP[TOOLS[0]]
            rows = db.query(model).filter(model.score == 5.0).all()
            assert [row.student_id for row in rows] == [U["carol"]]
        finally:
            db.close()


class TestContract:
    def test_unknown_tool_is_404(self, client):
        h = _auth(client, "alice")
        assert client.get("/api/toolbox/not-a-tool/sessions", headers=h).status_code == 404
        assert client.post("/api/toolbox/not-a-tool/sessions", headers=h, json={}).status_code == 404

    def test_unauthenticated_is_401(self, client):
        assert client.get(f"/api/toolbox/{TOOLS[0]}/sessions").status_code == 401
        assert client.get("/api/toolbox/sessions/all").status_code == 401
        assert client.post(f"/api/toolbox/{TOOLS[0]}/sessions", json={}).status_code == 401

    def test_registry_has_the_ten_tools(self):
        assert len(TOOLS) == 10
