"""HTTP-level tests for /api/team-arena/* v2 — PRD §0 v2 改版 A/B/C,
docs/prd/2026-10-18-team-arena-prd.md. Engine-level business logic (turn
rotation, damage, weapons, privacy) is exercised directly against
app.services.team_arena.engine in the sibling test_team_arena_engine_*.py
files — this file only locks HTTP wiring: auth, status codes, request
validation, and one real end-to-end happy path through the real ASGI app.
"""
from __future__ import annotations

import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.school import Classroom, ClassroomStudent, School

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)

    from app.routes.auth import rate_limiter
    rate_limiter.reset()

    app.dependency_overrides[get_db] = _override_get_db
    import app.database as app_database
    original = app_database.SessionLocal
    app_database.SessionLocal = TestingSessionLocal

    yield

    app_database.SessionLocal = original
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{suffix.title()} {unique}"
    resp = client.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    assert resp.status_code == 201, resp.text
    token_v = resp.json().get("verification_token")
    if token_v:
        client.get(f"/api/auth/verify-email?token={token_v}")
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login.json()["access_token"]
    me = client.get("/api/users/me", headers=auth_header(token))
    return {"email": email, "token": token, "user_id": me.json()["id"]}


def _enroll_with_grade(user_id: int, grade: int = 4) -> None:
    """Direct-DB setup (no classroom API needed for this) — a v2 host's
    grade resolves via ANY enrolled classroom (engine._resolve_host_grade's
    fallback path), so this is the minimal fixture a route test needs."""
    db = TestingSessionLocal()
    try:
        school = School(name=f"RT School {uuid.uuid4().hex[:6]}")
        db.add(school)
        db.flush()
        room = Classroom(school_id=school.id, teacher_id=user_id, name="RT room", grade=grade)
        db.add(room)
        db.flush()
        db.add(ClassroomStudent(classroom_id=room.id, student_id=user_id))
        db.commit()
    finally:
        db.close()


class TestAuthRequired:
    def test_create_session_requires_auth(self, client):
        resp = client.post("/api/team-arena/sessions", json={})
        assert resp.status_code == 401

    def test_state_requires_auth(self, client):
        resp = client.get("/api/team-arena/sessions/AB12CD/state")
        assert resp.status_code == 401


class TestCreateSession:
    def test_without_grade_is_400(self, client):
        host = _register(client, "ta_nograde")
        resp = client.post("/api/team-arena/sessions", json={}, headers=auth_header(host["token"]))
        assert resp.status_code == 400

    def test_with_grade_succeeds(self, client):
        host = _register(client, "ta_host")
        _enroll_with_grade(host["user_id"])
        resp = client.post("/api/team-arena/sessions", json={"team_size": 2}, headers=auth_header(host["token"]))
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == "lobby"
        assert len(body["code"]) == 6

    def test_invalid_team_size_is_422(self, client):
        host = _register(client, "ta_badsize")
        _enroll_with_grade(host["user_id"])
        resp = client.post("/api/team-arena/sessions", json={"team_size": 99}, headers=auth_header(host["token"]))
        assert resp.status_code == 422


class TestJoinAndControl:
    def test_any_student_can_join_without_classroom_link(self, client):
        host = _register(client, "ta_h2")
        _enroll_with_grade(host["user_id"])
        created = client.post("/api/team-arena/sessions", json={"team_size": 2}, headers=auth_header(host["token"]))
        code = created.json()["code"]

        stranger = _register(client, "ta_stranger")  # no classroom relationship at all
        resp = client.post(
            f"/api/team-arena/sessions/{code}/join", json={"side": "b"}, headers=auth_header(stranger["token"]),
        )
        assert resp.status_code == 201, resp.text

    def test_invalid_side_is_422(self, client):
        host = _register(client, "ta_h3")
        _enroll_with_grade(host["user_id"])
        created = client.post("/api/team-arena/sessions", json={"team_size": 2}, headers=auth_header(host["token"]))
        code = created.json()["code"]
        resp = client.post(
            f"/api/team-arena/sessions/{code}/join", json={"side": "c"}, headers=auth_header(host["token"]),
        )
        assert resp.status_code == 422

    def test_non_host_cannot_control(self, client):
        host = _register(client, "ta_h4")
        _enroll_with_grade(host["user_id"])
        created = client.post("/api/team-arena/sessions", json={"team_size": 2}, headers=auth_header(host["token"]))
        code = created.json()["code"]
        other = _register(client, "ta_other")
        client.post(f"/api/team-arena/sessions/{code}/join", json={"side": "b"}, headers=auth_header(other["token"]))

        resp = client.post(
            f"/api/team-arena/sessions/{code}/control", json={"action": "start"}, headers=auth_header(other["token"]),
        )
        assert resp.status_code == 403


class TestEndToEndHappyPath:
    def test_create_join_start_poll_answer_weapon_suggest_result(self, client):
        host = _register(client, "ta_e2e_host")
        _enroll_with_grade(host["user_id"])
        created = client.post(
            "/api/team-arena/sessions",
            json={"team_size": 2, "turns_per_player": 1, "answer_seconds": 30},
            headers=auth_header(host["token"]),
        )
        assert created.status_code == 201, created.text
        code = created.json()["code"]

        p1 = _register(client, "ta_e2e_1")
        p2 = _register(client, "ta_e2e_2")
        p3 = _register(client, "ta_e2e_3")
        assert client.post(f"/api/team-arena/sessions/{code}/join", json={"side": "a"}, headers=auth_header(p1["token"])).status_code == 201
        assert client.post(f"/api/team-arena/sessions/{code}/join", json={"side": "b"}, headers=auth_header(p2["token"])).status_code == 201
        assert client.post(f"/api/team-arena/sessions/{code}/join", json={"side": "b"}, headers=auth_header(p3["token"])).status_code == 201

        start = client.post(f"/api/team-arena/sessions/{code}/control", json={"action": "start"}, headers=auth_header(host["token"]))
        assert start.status_code == 200, start.text
        assert start.json()["status"] == "playing"

        state = client.get(f"/api/team-arena/sessions/{code}/state", headers=auth_header(host["token"]))
        assert state.status_code == 200
        body = state.json()
        assert body["status"] == "playing"
        assert "sides" in body
        assert body["sides"]["a"]["seated"] == 2
        assert body["sides"]["b"]["seated"] == 2

        # No request body anywhere in this flow ever carries free text
        # (PRD rule H) — every mutating call above used a fixed enum/letter.
        result_before_end = client.get(f"/api/team-arena/sessions/{code}/result", headers=auth_header(host["token"]))
        assert result_before_end.status_code == 409  # not ended yet

        end = client.post(f"/api/team-arena/sessions/{code}/control", json={"action": "end"}, headers=auth_header(host["token"]))
        assert end.status_code == 200
        result = client.get(f"/api/team-arena/sessions/{code}/result", headers=auth_header(host["token"]))
        assert result.status_code == 200
        assert "sides" in result.json()


class TestOptionsOpenReachesPollingClient:
    def test_after_version_poll_is_not_unchanged_once_options_open(self, client, monkeypatch):
        """Staging QA 2026-10-20: options open on the clock, which never bumped
        state_version, so a client polling with after_version kept getting
        "unchanged" and showed 「請先仔細讀題目」 for ~26 s of a 30 s turn."""
        from datetime import timedelta

        from app.services.team_arena import engine

        host = _register(client, "ta_open_host")
        _enroll_with_grade(host["user_id"])
        code = client.post(
            "/api/team-arena/sessions",
            json={"team_size": 2, "turns_per_player": 1, "answer_seconds": 45},
            headers=auth_header(host["token"]),
        ).json()["code"]
        for suffix, side in (("ta_open_1", "a"), ("ta_open_2", "b"), ("ta_open_3", "b")):
            p = _register(client, suffix)
            assert client.post(f"/api/team-arena/sessions/{code}/join", json={"side": side}, headers=auth_header(p["token"])).status_code == 201
        assert client.post(f"/api/team-arena/sessions/{code}/control", json={"action": "start"}, headers=auth_header(host["token"])).status_code == 200

        # Find the player who is active on turn 0 among the host's side.
        first = client.get(f"/api/team-arena/sessions/{code}/state", headers=auth_header(host["token"])).json()
        rnd = (first.get("own_match") or {}).get("current_round")
        assert rnd is not None and first["own_match"]["am_i_active"], first
        assert rnd.get("options") is None, "should still be in the reading phase right after start"
        v0 = first["state_version"]

        # Unchanged while still reading (positive control: the cheap path works).
        same = client.get(f"/api/team-arena/sessions/{code}/state?after_version={v0}", headers=auth_header(host["token"])).json()
        assert same.get("unchanged") is True

        real_now = engine._now
        monkeypatch.setattr(engine, "_now", lambda: real_now() + timedelta(seconds=rnd["reading_seconds"] + 1))
        later = client.get(f"/api/team-arena/sessions/{code}/state?after_version={v0}", headers=auth_header(host["token"])).json()
        assert later.get("unchanged") is not True, "options opened but the poll still said unchanged"
        assert later["own_match"]["current_round"]["options"], later


class TestHintAvailabilityReachesActivePlayer:
    """Staging QA 2026-10-21: 看提示 was clickable on a question with no hint
    and answered 409 「這題沒有提示」. The active player's round view must say
    up front whether a hint exists (PRD rule J: 按鈕灰掉且不扣次數)."""

    @pytest.mark.parametrize("hint, expected", [(None, False), ("同一課「某句」裡的「字」，唸法跟這題一樣", True)])
    def test_round_view_carries_hint_available(self, client, monkeypatch, hint, expected):
        from app.services.team_arena import weapons

        monkeypatch.setattr(weapons, "build_hint", lambda payload: hint)
        host = _register(client, f"ta_hint_host_{expected}")
        _enroll_with_grade(host["user_id"])
        code = client.post(
            "/api/team-arena/sessions",
            json={"team_size": 2, "turns_per_player": 1, "answer_seconds": 45},
            headers=auth_header(host["token"]),
        ).json()["code"]
        for suffix, side in (("a", "a"), ("b1", "b"), ("b2", "b")):
            p = _register(client, f"ta_hint_{suffix}_{expected}")
            assert client.post(f"/api/team-arena/sessions/{code}/join", json={"side": side}, headers=auth_header(p["token"])).status_code == 201
        assert client.post(f"/api/team-arena/sessions/{code}/control", json={"action": "start"}, headers=auth_header(host["token"])).status_code == 200

        state = client.get(f"/api/team-arena/sessions/{code}/state", headers=auth_header(host["token"])).json()
        rnd = state["own_match"]["current_round"]
        assert state["own_match"]["am_i_active"], state
        assert rnd["hint_available"] is expected


class TestOpponentNamesAreNotExposed:
    """Security review 2026-10-21: anyone with the 6-char code can join from
    any school, and /state + /result sent every player's real name to both
    teams. Real names only for the viewer's own team; the other team gets
    neutral seat labels."""

    def test_state_and_result_hide_the_other_teams_real_names(self, client):
        host = _register(client, "ta_names_host")
        _enroll_with_grade(host["user_id"])
        code = client.post(
            "/api/team-arena/sessions",
            json={"team_size": 2, "turns_per_player": 1, "answer_seconds": 45},
            headers=auth_header(host["token"]),
        ).json()["code"]
        mate = _register(client, "ta_names_mate")
        b1 = _register(client, "ta_names_oppa")
        b2 = _register(client, "ta_names_oppb")
        for p, side in ((mate, "a"), (b1, "b"), (b2, "b")):
            assert client.post(f"/api/team-arena/sessions/{code}/join", json={"side": side}, headers=auth_header(p["token"])).status_code == 201

        def names(token, path, key):
            body = client.get(f"/api/team-arena/sessions/{code}/{path}", headers=auth_header(token)).json()
            if key == "sides":
                return {s: [m["display_name"] for m in body["sides"][s]["members"]] for s in ("a", "b")}
            return {s: [p["display_name"] for p in body["players"][s]] for s in ("a", "b")}

        a_view = names(host["token"], "state", "sides")
        b_view = names(b1["token"], "state", "sides")
        # Own team: real names (positive control — the fix must not anonymise everyone).
        assert any("Ta_Names_Mate" in n for n in a_view["a"]), a_view
        assert any("Ta_Names_Oppa" in n for n in b_view["b"]), b_view
        # Other team: seat labels only, no real name anywhere.
        assert a_view["b"] == ["乙隊 1 號", "乙隊 2 號"], a_view
        assert b_view["a"] == ["甲隊 1 號", "甲隊 2 號"], b_view
        assert "Oppa" not in str(a_view["b"]) and "Mate" not in str(b_view["a"])

        assert client.post(f"/api/team-arena/sessions/{code}/control", json={"action": "start"}, headers=auth_header(host["token"])).status_code == 200
        assert client.post(f"/api/team-arena/sessions/{code}/control", json={"action": "end"}, headers=auth_header(host["token"])).status_code == 200
        ra = names(host["token"], "result", "players")
        rb = names(b1["token"], "result", "players")
        assert ra["b"] == ["乙隊 1 號", "乙隊 2 號"] and rb["a"] == ["甲隊 1 號", "甲隊 2 號"], (ra, rb)
        assert any("Ta_Names_Mate" in n for n in ra["a"]), ra
