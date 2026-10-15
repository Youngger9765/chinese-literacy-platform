"""External security review on the #3551 PR: the frontend-only client-side
validation (liveQuizApi.ts's assertGameCode) is not enough — a path param is
attacker-controlled input regardless of what any particular client sends, so
the server must reject a malformed `code` BEFORE any handler body runs any
DB lookup with it. These tests prove that at the real FastAPI routing layer
(TestClient over the real app, not a unit test of a regex in isolation).

Every `/api/live-quiz/games/{code}/...` route constrains `code` via
`GameCode = Annotated[str, Path(pattern=r"^\\d{6}$")]` (app/routes/live_quiz.py).
A malformed code must 422 at the routing layer — engine.get_game_by_code
(which does the actual DB query) must never execute for it. A well-formed
but non-existent code is the negative control proving the regex isn't
over-blocking: it must reach the handler and come back 404 (not 422).
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

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, UserRole

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
    return {"email": email, "token": token}


# One malformed shape per class of attack this guards against, EXCLUDING
# traversal segments containing an (encoded) slash — those are covered
# separately below because a literal `/` splits the URL into more path
# segments than the route template has, so the outcome is a router-level
# 404 ("no route matched") rather than a 422 from the Path() pattern. Both
# are "never reaches engine.get_game_by_code", just via different layers —
# see test_traversal_shaped_code_never_reaches_the_handler.
MALFORMED_CODES = [
    "abcdef",       # letters, not digits
    "12345",        # 5 digits — too short
    "1234567",      # 7 digits — too long
    "123 456",      # embedded space
    "123-456",      # punctuation
]


@pytest.mark.parametrize("bad_code", MALFORMED_CODES)
@pytest.mark.parametrize(
    "method,path_suffix",
    [
        ("post", "/join"),
        ("get", "/state"),
        ("post", "/answer"),
        ("post", "/start"),
        ("post", "/reveal"),
        ("post", "/next"),
        ("post", "/end"),
        ("get", "/results"),
    ],
)
def test_malformed_code_422s_before_any_handler_runs(client, bad_code, method, path_suffix):
    user = _register_user(client, "pathparam")
    call = getattr(client, method)
    resp = call(f"/api/live-quiz/games/{bad_code}{path_suffix}", headers=auth_header(user["token"]))
    assert resp.status_code == 422, (
        f"{method.upper()} .../{bad_code}{path_suffix} should 422 at the routing layer "
        f"(path-pattern validation), got {resp.status_code}: {resp.text}"
    )


def test_malformed_code_422s_on_remove_player_too(client):
    """The one route with a second path segment after `code` — same guard,
    separate assertion so a future refactor of that route can't silently
    drop the constraint without a parametrize case noticing."""
    user = _register_user(client, "pathparam_rm")
    resp = client.delete(
        f"/api/live-quiz/games/abcdef/players/1", headers=auth_header(user["token"])
    )
    assert resp.status_code == 422, resp.text


def test_traversal_shaped_code_never_reaches_the_handler(client):
    """A crafted deep-link with an embedded (encoded) slash — the literal
    attack shape named in the security review — must never reach
    engine.get_game_by_code. httpx/Starlette resolve the encoded slash
    into an actual extra path segment before routing, so this never even
    matches the single-segment `{code}` route template: it 404s as "no
    route", one layer earlier than the Path() pattern check. Either way
    the DB is never queried with this value; the only thing this test
    must rule out is a 200/403 that would mean it reached real business
    logic carrying the caller's bearer token to some other endpoint."""
    user = _register_user(client, "pathparam_traversal")
    resp = client.get("/api/live-quiz/games/..%2F..%2Fetc/results", headers=auth_header(user["token"]))
    assert resp.status_code in (404, 422), resp.text
    assert resp.json()["detail"] != "Game not found", (
        "if this is a 404, it must be the router's 'no route matched' 404, "
        "not engine.get_game_by_code's 404 — that would mean the traversal "
        "string reached the DB lookup"
    )


def test_well_formed_but_nonexistent_code_reaches_the_handler(client):
    """Negative control: the regex must not over-block. A well-formed code
    that doesn't correspond to any game should get PAST path validation and
    come back as engine.get_game_by_code's real 404 — not the routing
    layer's 422. This is what proves the fix targets shape, not any
    6-digit value."""
    user = _register_user(client, "pathparam_negctrl")
    resp = client.get("/api/live-quiz/games/999999/state", headers=auth_header(user["token"]))
    assert resp.status_code == 404, resp.text
    assert resp.json()["detail"] == "Game not found"
