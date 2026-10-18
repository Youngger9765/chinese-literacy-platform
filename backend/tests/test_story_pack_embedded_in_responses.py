"""Additive-only check (PRD §13.5): /api/league/seasons/{id}/board,
.../my-summary, and /api/league/my-history now each carry a `theme` field,
and nothing about the existing privacy contract or authz changed. Builds a
real invitational season through the real accept flow (same pattern as
test_league_routes.py) rather than constructing LeagueSeason rows by hand,
so this exercises the real route wiring end to end.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.organization import Organization
from app.models.school import Classroom, ClassroomStudent, ClassroomTeacher, School
from app.services.story_pack_defaults import MYTH_PACK_KEY, SONG_PACK_KEY
from app.services.story_pack_store import InMemoryStoryPackStore

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine, "connect")
def _fk(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="module", autouse=True)
def _setup_module():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def client():
    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture()
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def _isolated_theme_store(monkeypatch):
    fresh = InMemoryStoryPackStore()
    import app.routes.league as league_routes

    monkeypatch.setattr(league_routes, "get_story_pack_store", lambda *_args, **_kwargs: fresh)
    import app.routes.admin_story_packs as admin_routes

    monkeypatch.setattr(admin_routes, "get_story_pack_store", lambda *_args, **_kwargs: fresh)
    return fresh


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _register(client, *, name="User"):
    email = f"user{uuid.uuid4().hex[:12]}@test.com"
    password = "Password123!"
    r = client.post("/api/auth/register", json={"name": name, "email": email, "password": password})
    assert r.status_code in (200, 201), r.text
    verification_token = r.json().get("verification_token")
    if verification_token:
        v = client.get(f"/api/auth/verify-email?token={verification_token}")
        assert v.status_code == 200, v.text
    login_r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_r.status_code == 200, login_r.text
    token = login_r.json()["access_token"]
    me = client.get("/api/users/me", headers=_h(token))
    assert me.status_code == 200, me.text
    return token, me.json()["id"]


def _make_org(db):
    org = Organization(name=f"機構-{uuid.uuid4().hex[:6]}")
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def _make_school(db, org):
    school = School(name=f"學校-{uuid.uuid4().hex[:6]}", organization_id=org.id if org else None)
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


def _make_classroom(db, school, teacher_id, *, grade=5):
    # issue #3607: league is OFF by default per classroom — this file is
    # about story-pack/theme content embedded in league responses, not the
    # feature gate itself, so opt every classroom in (same pattern as
    # test_league_routes.py's _make_classroom).
    classroom = Classroom(
        school_id=school.id, teacher_id=teacher_id, name=f"班級-{uuid.uuid4().hex[:6]}", grade=grade,
        feature_settings={"league": True},
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)
    db.add(ClassroomTeacher(classroom_id=classroom.id, teacher_id=teacher_id, role="primary"))
    db.commit()
    return classroom


def _enroll(db, classroom, student_id):
    db.add(ClassroomStudent(classroom_id=classroom.id, student_id=student_id))
    db.commit()


NOW = datetime.now(timezone.utc)


def _build_accepted_season(client, db):
    org = _make_org(db)
    school = _make_school(db, org)
    inviter_token, inviter_id = _register(client, name="Inviter")
    invitee_token, invitee_id = _register(client, name="Invitee")
    inviter_classroom = _make_classroom(db, school, inviter_id)
    invitee_classroom = _make_classroom(db, school, invitee_id)
    student_token, student_id = _register(client, name="Student1")
    _enroll(db, inviter_classroom, student_id)

    inv = client.post(
        "/api/league/invitations",
        json={
            "inviter_classroom_id": inviter_classroom.id,
            "inviter_team_grade": 5,
            "game_start": (NOW + timedelta(days=1)).isoformat(),
            "game_end": (NOW + timedelta(days=2)).isoformat(),
        },
        headers=_h(inviter_token),
    )
    assert inv.status_code == 201, inv.text
    code = inv.json()["code"]

    accept = client.post(
        f"/api/league/invitations/{code}/accept",
        json={"invitee_classroom_id": invitee_classroom.id, "invitee_team_grade": 5},
        headers=_h(invitee_token),
    )
    assert accept.status_code == 200, accept.text

    seasons = client.get(
        f"/api/league/classrooms/{inviter_classroom.id}/seasons", headers=_h(inviter_token)
    ).json()
    season_id = seasons[0]["season_id"]
    return season_id, inviter_token, invitee_token, student_token


class TestThemeEmbeddedInBoardResponse:
    def test_board_response_includes_default_theme_when_unset(self, client, db):
        season_id, inviter_token, _, _student = _build_accepted_season(client, db)
        r = client.get(f"/api/league/seasons/{season_id}/board", headers=_h(inviter_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert "theme" in body
        assert body["theme"]["key"] == MYTH_PACK_KEY  # default pack is 上古神話 (Young 2026-10-16)
        # The existing contract (board rows) must be unchanged by this addition.
        assert "board" in body and len(body["board"]) == 2

    def test_board_response_reflects_season_theme_assignment(self, client, db):
        season_id, inviter_token, _, _student = _build_accepted_season(client, db)

        # Assign via the admin API would require system_admin; here we poke
        # the (test-isolated) store directly, same as the admin route would.
        from app.services.story_pack_store import get_story_pack_store

        # The autouse fixture monkeypatched routes.league/admin_story_packs'
        # get_story_pack_store — fetch the SAME instance those modules now return.
        import app.routes.league as league_routes

        store = league_routes.get_story_pack_store(db)
        store.set_season_story_pack_key(season_id, SONG_PACK_KEY)

        r = client.get(f"/api/league/seasons/{season_id}/board", headers=_h(inviter_token))
        assert r.status_code == 200
        assert r.json()["theme"]["key"] == SONG_PACK_KEY


class TestThemeEmbeddedInMySummaryAndHistory:
    def test_my_summary_includes_theme(self, client, db):
        season_id, _inviter, _invitee, student_token = _build_accepted_season(client, db)
        r = client.get(f"/api/league/seasons/{season_id}/my-summary", headers=_h(student_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["theme"]["key"] == MYTH_PACK_KEY  # default pack is 上古神話 (Young 2026-10-16)
        # Existing fields still present (no regression on the summary contract).
        assert "my_points" in body and "badge_threshold" in body

    def test_my_history_includes_theme_per_entry(self, client, db):
        season_id, _inviter, _invitee, student_token = _build_accepted_season(client, db)
        r = client.get("/api/league/my-history", headers=_h(student_token))
        assert r.status_code == 200, r.text
        history = r.json()
        assert len(history) >= 1
        assert all("theme" in entry for entry in history)


class TestSwapPacksKeepsMechanicsUnchanged:
    """Young's MVP acceptance bar (2026-10-16): 「確保幾組可以自由替換」— with
    all five builtin packs, switching a season's pack must immediately
    change all story text/art while leaving scores/chests/badges mechanics
    completely unchanged, and switching back must work too. This test
    cycles through all five builtin packs on the SAME season and the SAME
    board snapshot (no learning activity happens between switches, so any
    difference in the mechanics fields can only come from the pack swap
    itself, not from real score changes)."""

    ALL_PACK_KEYS = [
        "myth", "tang-dynasty", "song-dynasty", "wuxia", "detective",
    ]

    # Fields that must be byte-identical across every pack swap — these are
    # league_scoring.py's output, never touched by story_pack content.
    MECHANICS_FIELDS = [
        "team_id", "classroom_id", "classroom_name", "grade", "roster_size",
        "participant_count", "average_points", "team_badge_earned",
        "treasure_chest_eligible", "badge_threshold",
        "treasure_chest_participants_needed", "rank",
    ]

    def test_swap_all_five_packs_mechanics_unchanged_content_changes(self, client, db):
        from app.services.story_pack_store import get_story_pack_store
        import app.routes.league as league_routes

        season_id, inviter_token, _invitee, _student = _build_accepted_season(client, db)
        store = league_routes.get_story_pack_store(db)

        baseline_board = None
        seen_titles = set()

        for key in self.ALL_PACK_KEYS:
            store.set_season_story_pack_key(season_id, key)

            r = client.get(f"/api/league/seasons/{season_id}/board", headers=_h(inviter_token))
            assert r.status_code == 200, r.text
            body = r.json()

            # Content changed: this pack's own title is now embedded.
            assert body["theme"]["key"] == key
            seen_titles.add(body["theme"]["title"])

            board = body["board"]
            if baseline_board is None:
                baseline_board = board
                continue

            # Mechanics unchanged: every scoring field is byte-identical to
            # the very first pack's board, regardless of which pack is active.
            assert len(board) == len(baseline_board)
            for before_row, after_row in zip(baseline_board, board):
                for field in self.MECHANICS_FIELDS:
                    assert after_row[field] == before_row[field], (
                        f"pack swap to {key!r} changed mechanics field "
                        f"{field!r}: {before_row[field]!r} -> {after_row[field]!r}"
                    )

        # All five packs really did produce five distinct titles — proves
        # the swap actually changed content, not just a no-op loop.
        assert len(seen_titles) == len(self.ALL_PACK_KEYS)

    def test_switch_back_to_original_pack_restores_same_content(self, client, db):
        from app.services.story_pack_store import get_story_pack_store
        import app.routes.league as league_routes

        season_id, inviter_token, _invitee, _student = _build_accepted_season(client, db)
        store = league_routes.get_story_pack_store(db)

        store.set_season_story_pack_key(season_id, "tang-dynasty")
        r1 = client.get(f"/api/league/seasons/{season_id}/board", headers=_h(inviter_token))
        original_theme = r1.json()["theme"]

        store.set_season_story_pack_key(season_id, "wuxia")
        r2 = client.get(f"/api/league/seasons/{season_id}/board", headers=_h(inviter_token))
        assert r2.json()["theme"]["key"] == "wuxia"

        store.set_season_story_pack_key(season_id, "tang-dynasty")
        r3 = client.get(f"/api/league/seasons/{season_id}/board", headers=_h(inviter_token))
        assert r3.json()["theme"] == original_theme
