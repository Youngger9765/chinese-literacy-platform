"""External review #3 — the membership-gated rate-limit exemption.

Two things, both through the REAL ASGI middleware stack (not a unit test of
the helper function in isolation):

1. An authenticated member (host or joined player) polling /state is
   EXEMPT from the per-IP limit — a classroom's shared NAT must not trip it.
2. A non-member (authenticated, but not part of THIS game) hitting the same
   path stays under the normal per-IP limit, same as any other endpoint —
   proving the exemption is not a blanket "this whole path never counts"
   bypass.

Uses a deliberately tiny READ_LIMIT (monkeypatched) so the test doesn't need
hundreds of real requests to prove the limiter is actually active.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app, GlobalRateLimitMiddleware
from app.auth.rate_limiter import general_rate_limiter
from app.database import get_db
from app.models import Base
from app.models.user import Role, UserRole

LESSON_A = "L0125"

engine_db = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine_db, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_db)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine_db)
    session = TestingSessionLocal()
    session.add(Role(name="teacher", display_name="Teacher", scope_level="school"))
    session.add(Role(name="student", display_name="Student", scope_level="school"))
    session.commit()
    session.close()

    from app.routes.auth import rate_limiter
    rate_limiter.reset()

    app.dependency_overrides[get_db] = _override_get_db

    import app.database as app_database
    original_session_local = app_database.SessionLocal
    app_database.SessionLocal = TestingSessionLocal

    yield

    app_database.SessionLocal = original_session_local
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine_db)


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_user(client, suffix: str) -> dict:
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


@pytest.fixture(autouse=True)
def _tiny_read_limit(monkeypatch):
    """Low enough that a handful of requests proves the limiter is live,
    without needing hundreds of real HTTP round-trips per test."""
    monkeypatch.setattr(GlobalRateLimitMiddleware, "READ_LIMIT", 5)
    general_rate_limiter.reset()
    yield
    general_rate_limiter.reset()


def test_joined_member_state_polling_is_exempt_from_per_ip_limit(client):
    teacher = _register_user(client, "rl_teacher")
    student = _register_user(client, "rl_student")

    game = client.post(
        "/api/live-quiz/games",
        json={
            "lesson_uids": [LESSON_A],
            "source_modules": ["comprehension"],
            "seconds": 30,
            "reading_seconds": 0,
        },
        headers=auth_header(teacher["token"]),
    ).json()
    client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student["token"]))

    # 3x the tiny limit — would 429 immediately if this traffic were being
    # counted against the per-IP bucket at all.
    statuses = [
        client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student["token"])
        ).status_code
        for _ in range(15)
    ]
    assert all(s == 200 for s in statuses), statuses


def test_non_member_state_polling_still_counts_against_per_ip_limit(client):
    """Proves #1 above is a real membership check, not a blanket path
    exemption: an authenticated user who is neither host nor a joined
    player of THIS game gets 403s from the route — but BEFORE that, their
    traffic is still metered like any other /api/* call, so once the tiny
    per-IP budget is burned they start seeing 429s instead of 403s."""
    teacher = _register_user(client, "rl_teacher2")
    outsider = _register_user(client, "rl_outsider")

    game = client.post(
        "/api/live-quiz/games",
        json={
            "lesson_uids": [LESSON_A],
            "source_modules": ["comprehension"],
            "seconds": 30,
            "reading_seconds": 0,
        },
        headers=auth_header(teacher["token"]),
    ).json()

    statuses = [
        client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(outsider["token"])
        ).status_code
        for _ in range(15)
    ]
    assert 403 in statuses, "sanity: route-level membership check should still fire at least once"
    assert 429 in statuses, (
        f"non-member traffic should eventually hit the per-IP limit, got {statuses}"
    )


def test_other_endpoints_unaffected_by_the_live_quiz_exemption(client):
    """The exemption regex is scoped to /api/live-quiz/*/state and /answer
    only — an ordinary authenticated GET elsewhere still gets limited."""
    user = _register_user(client, "rl_other_endpoint")
    statuses = [
        client.get("/api/users/me", headers=auth_header(user["token"])).status_code for _ in range(15)
    ]
    assert 429 in statuses, statuses


def _make_game_with_player(client, prefix):
    teacher = _register_user(client, f"{prefix}_t")
    student = _register_user(client, f"{prefix}_s")
    game = client.post(
        "/api/live-quiz/games",
        json={"lesson_uids": [LESSON_A], "source_modules": ["comprehension"], "seconds": 30, "reading_seconds": 0},
        headers=auth_header(teacher["token"]),
    ).json()
    client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student["token"]))
    return game, student


def test_membership_check_is_cached_not_run_on_every_poll(client, monkeypatch):
    """2026-10-15 staging load test: 30 students polling /state 1/s made the
    middleware run 2 DB queries per poll; on the small staging DB requests
    queued up to 150 s and, once the pool ran dry, the check threw and members
    fell back to per-IP limiting (69 x 429 for joined players). A joined
    player's membership must be looked up once, not on every poll."""
    import app.main as main_mod

    game, student = _make_game_with_player(client, "rl_cache")
    calls = []
    real = main_mod.is_authenticated_member_by_code

    def spy(db, code, user_id):
        calls.append(1)
        return real(db, code, user_id)

    monkeypatch.setattr(main_mod, "is_authenticated_member_by_code", spy)
    statuses = [
        client.get(f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student["token"])).status_code
        for _ in range(15)
    ]
    assert all(s == 200 for s in statuses), statuses
    assert len(calls) <= 1, f"membership DB lookup ran {len(calls)} times for 15 polls"


def test_membership_check_does_not_run_on_the_event_loop(client, monkeypatch):
    """The lookup is a blocking DB call; inside async middleware it must run in
    a worker thread, or every in-flight request on the instance stalls behind it."""
    import asyncio
    import app.main as main_mod

    game, student = _make_game_with_player(client, "rl_thread")
    on_loop = []
    real = main_mod.is_authenticated_member_by_code

    def spy(db, code, user_id):
        try:
            asyncio.get_running_loop()
            on_loop.append(True)
        except RuntimeError:
            on_loop.append(False)
        return real(db, code, user_id)

    monkeypatch.setattr(main_mod, "is_authenticated_member_by_code", spy)
    main_mod._live_quiz_member_cache.clear()
    r = client.get(f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student["token"]))
    assert r.status_code == 200
    assert on_loop == [False], f"membership check ran on the event loop: {on_loop}"
