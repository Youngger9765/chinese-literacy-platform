"""
Characterization tests for learning_sessions.py split (Issue #1955).

TDD-first: these tests must pass on the original monolith AND on the refactored
split modules.  They are route-level black-box tests verifying:

1. bootstrap  — POST /learning/sessions create (get-or-create, slug validation)
2. progress   — PATCH /learning/sessions/{id}  (field update, CharacterError persistence)
3. status     — GET  /learning/sessions/{id}/status  (resume gate)
4. complete   — PATCH status=completed auto-sets completed_at

Same URL paths, same response shapes — nothing behavioural changes.

Run with:
    cd backend
    python -m pytest tests/test_characterization_learning_sessions_1955.py -v
"""

import sys
import os
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from _route_walk import method_paths  # noqa: E402

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.text import Text
from app.models.user import Role

# ---------------------------------------------------------------------------
# Extra patch: conftest._patch_pg_server_defaults only handles text() objects,
# not plain-string server_defaults like "'[]'::jsonb".  Patch those here so
# that SQLite can INSERT into learning_sessions.full_reading_attempts et al.
#
# Strategy:
#   - Remove the PostgreSQL-specific ::jsonb cast from server_default.
#   - Replace it with an equivalent SQLite-compatible default ("[]" or "{}").
#   - This keeps the column NOT-NULL constraint satisfied in SQLite.
# ---------------------------------------------------------------------------
from sqlalchemy.sql.schema import DefaultClause

_PLAIN_DEFAULTS = {
    "'[]'::jsonb": "[]",
    "'{}'::jsonb": "{}",
}


def _patch_plain_string_pg_server_defaults():
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            sd = column.server_default
            if sd is None:
                continue
            arg = getattr(sd, "arg", None)
            if arg is None:
                continue
            if isinstance(arg, str) and "::" in arg:
                replacement = _PLAIN_DEFAULTS.get(arg)
                if replacement is not None:
                    column.server_default = DefaultClause(replacement)
                else:
                    column.server_default = None


_patch_plain_string_pg_server_defaults()

# ---------------------------------------------------------------------------
# SQLite in-memory DB wiring (same pattern as test_organizations_split_1890.py)
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _fk_pragma(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "parent", "display_name": "Parent", "scope_level": "school"},
]

VALID_LESSON_NUM = 3  # Use 3 to avoid collisions with other test files
VALID_SLUG = str(VALID_LESSON_NUM)


def _seed_roles(session):
    for r in ROLES:
        session.add(Role(**r))
    session.commit()


def _seed_text(session):
    text = Text(
        title="Characterization Lesson 1955",
        paragraphs=["Test paragraph for 1955."],
        char_count=22,
        grade=5,
        grade_code="G5-1",
        genre="記敘文",
        text_type="單",
        category="Fable",
        lesson_number=VALID_LESSON_NUM,
    )
    session.add(text)
    session.commit()


def _override_get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    _seed_roles(db)
    _seed_text(db)
    db.close()
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _register_and_login(client, suffix=None) -> dict:
    """Register + verify + login; return {token, email}."""
    from app.routes.auth import rate_limiter
    rate_limiter.reset()
    unique = suffix or uuid.uuid4().hex[:8]
    email = f"char1955_{unique}@example.com"
    password = "demo1234"  # 常見 placeholder，在掃描器的 banlist 上（自創的假密碼反而會被抓）
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": f"User {unique}",
    })
    assert resp.status_code == 201, resp.text
    token = resp.json().get("verification_token")
    if token:
        client.get(f"/api/auth/verify-email?token={token}")
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200, login.text
    return {"token": login.json()["access_token"], "email": email}


def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ===========================================================================
# 1. Bootstrap — POST /api/learning/sessions
# ===========================================================================

class TestBootstrap:
    """Characterize the session-creation (bootstrap) behaviour."""

    def test_create_session_returns_201(self, client):
        u = _register_and_login(client, "bs_201")
        r = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth(u["token"]),
        )
        assert r.status_code == 201

    def test_create_session_returns_expected_fields(self, client):
        u = _register_and_login(client, "bs_fields")
        r = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth(u["token"]),
        )
        data = r.json()
        for field in ["id", "story_slug", "status", "started_at", "completed_at"]:
            assert field in data, f"Missing field: {field}"
        assert data["story_slug"] == VALID_SLUG
        assert data["status"] == "in_progress"

    def test_create_dedup_returns_same_session(self, client):
        """get-or-create: second POST for same user+slug returns existing session id."""
        u = _register_and_login(client, "bs_dedup")
        r1 = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth(u["token"]),
        )
        r2 = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth(u["token"]),
        )
        assert r1.status_code == 201
        assert r2.status_code == 201
        assert r1.json()["id"] == r2.json()["id"], "Dedup must return same session"

    def test_create_unknown_slug_returns_422(self, client):
        u = _register_and_login(client, "bs_bad")
        r = client.post(
            "/api/learning/sessions",
            json={"story_slug": "9999"},
            headers=auth(u["token"]),
        )
        assert r.status_code == 422
        assert "unknown story_slug" in r.json()["detail"]

    def test_create_l_prefix_slug_accepted(self, client):
        """L03 normalizes to '3' (VALID_LESSON_NUM) — must be accepted."""
        u = _register_and_login(client, "bs_lprefix")
        r = client.post(
            "/api/learning/sessions",
            json={"story_slug": f"L0{VALID_LESSON_NUM}"},
            headers=auth(u["token"]),
        )
        assert r.status_code == 201

    def test_create_requires_auth(self, client):
        r = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
        )
        assert r.status_code == 401

    def test_create_self_study_classroom_id_is_null(self, client):
        """Regression #1184 — self-study sessions must not be attributed to any classroom."""
        from app.models.session import LearningSession

        u = _register_and_login(client, "bs_1184")
        r = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth(u["token"]),
        )
        assert r.status_code == 201
        sid = r.json()["id"]

        db = SessionLocal()
        try:
            row = db.query(LearningSession).filter(LearningSession.id == sid).first()
            assert row is not None
            assert row.classroom_id is None
        finally:
            db.close()


# ===========================================================================
# 2. Progress — PATCH /api/learning/sessions/{id}
# ===========================================================================

class TestProgress:
    """Characterize the session-update (progress) behaviour."""

    def _create_session(self, client, token) -> int:
        r = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth(token),
        )
        assert r.status_code == 201
        return r.json()["id"]

    def test_patch_reading_result(self, client):
        u = _register_and_login(client, "prog_rd")
        sid = self._create_session(client, u["token"])
        payload = {"reading_result": {"wpm": 110, "accuracy": 88.0}}
        r = client.patch(f"/api/learning/sessions/{sid}", json=payload, headers=auth(u["token"]))
        assert r.status_code == 200
        assert r.json()["reading_result"] == payload["reading_result"]

    def test_patch_comprehension_result(self, client):
        u = _register_and_login(client, "prog_comp")
        sid = self._create_session(client, u["token"])
        payload = {"comprehension_result": {"score": 75, "total": 5}}
        r = client.patch(f"/api/learning/sessions/{sid}", json=payload, headers=auth(u["token"]))
        assert r.status_code == 200
        assert r.json()["comprehension_result"] == payload["comprehension_result"]

    def test_patch_auto_sets_completed_at(self, client):
        """When status=completed, completed_at must be auto-set (#1070)."""
        u = _register_and_login(client, "prog_complete")
        sid = self._create_session(client, u["token"])
        r = client.patch(
            f"/api/learning/sessions/{sid}",
            json={"status": "completed"},
            headers=auth(u["token"]),
        )
        assert r.status_code == 200
        assert r.json()["status"] == "completed"
        assert r.json()["completed_at"] is not None

    def test_patch_error_chars_persisted(self, client):
        """error_chars in reading_result must create CharacterError rows (#248)."""
        from app.models.session import CharacterError

        u = _register_and_login(client, "prog_err")
        sid = self._create_session(client, u["token"])
        r = client.patch(
            f"/api/learning/sessions/{sid}",
            json={"reading_result": {"error_chars": ["的", "了"]}},
            headers=auth(u["token"]),
        )
        assert r.status_code == 200

        db = SessionLocal()
        try:
            errors = db.query(CharacterError).filter(CharacterError.session_id == sid).all()
            chars = {e.character for e in errors}
            assert "的" in chars
            assert "了" in chars
        finally:
            db.close()

    def test_patch_requires_own_session(self, client):
        u1 = _register_and_login(client, "prog_own1")
        u2 = _register_and_login(client, "prog_own2")
        sid = self._create_session(client, u1["token"])
        r = client.patch(
            f"/api/learning/sessions/{sid}",
            json={"reading_result": {"wpm": 50}},
            headers=auth(u2["token"]),
        )
        assert r.status_code == 403

    def test_patch_requires_auth(self, client):
        r = client.patch("/api/learning/sessions/999", json={})
        assert r.status_code == 401

    def test_patch_not_found_returns_404(self, client):
        u = _register_and_login(client, "prog_404")
        r = client.patch(
            "/api/learning/sessions/9999999",
            json={"reading_result": {"wpm": 50}},
            headers=auth(u["token"]),
        )
        assert r.status_code == 404


# ===========================================================================
# 3. Status — GET /api/learning/sessions/{id}/status
# ===========================================================================

class TestSessionStatus:
    """Characterize the session-status (resume gate) behaviour."""

    def _create_session(self, client, token) -> int:
        r = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth(token),
        )
        assert r.status_code == 201
        return r.json()["id"]

    def test_status_in_progress_is_resumable(self, client):
        u = _register_and_login(client, "st_resume")
        sid = self._create_session(client, u["token"])
        r = client.get(f"/api/learning/sessions/{sid}/status", headers=auth(u["token"]))
        assert r.status_code == 200
        data = r.json()
        assert data["is_resumable"] is True
        assert data["is_completed"] is False
        assert data["status"] == "in_progress"

    def test_status_completed_is_not_resumable(self, client):
        u = _register_and_login(client, "st_done")
        sid = self._create_session(client, u["token"])
        client.patch(
            f"/api/learning/sessions/{sid}",
            json={"status": "completed"},
            headers=auth(u["token"]),
        )
        r = client.get(f"/api/learning/sessions/{sid}/status", headers=auth(u["token"]))
        assert r.status_code == 200
        data = r.json()
        assert data["is_completed"] is True
        assert data["is_resumable"] is False

    def test_status_returns_story_slug(self, client):
        u = _register_and_login(client, "st_slug")
        sid = self._create_session(client, u["token"])
        r = client.get(f"/api/learning/sessions/{sid}/status", headers=auth(u["token"]))
        assert r.status_code == 200
        assert r.json()["story_slug"] == VALID_SLUG

    def test_status_requires_own_session(self, client):
        u1 = _register_and_login(client, "st_own1")
        u2 = _register_and_login(client, "st_own2")
        sid = self._create_session(client, u1["token"])
        r = client.get(f"/api/learning/sessions/{sid}/status", headers=auth(u2["token"]))
        assert r.status_code == 403

    def test_status_not_found_returns_404(self, client):
        u = _register_and_login(client, "st_404")
        r = client.get("/api/learning/sessions/9999999/status", headers=auth(u["token"]))
        assert r.status_code == 404


# ===========================================================================
# 4. URL path registry — all routes must be reachable at same paths
# ===========================================================================

class TestRouteRegistry:
    """Verify that all expected URL paths are registered (refactor must not lose any)."""

    EXPECTED_ROUTES = [
        ("POST", "/api/learning/sessions"),
        ("GET", "/api/learning/sessions"),
        ("GET", "/api/learning/sessions/reading-history"),
        ("GET", "/api/learning/sessions/{session_id}"),
        ("GET", "/api/learning/sessions/{session_id}/report"),
        ("GET", "/api/learning/sessions/{session_id}/status"),
        ("PATCH", "/api/learning/sessions/{session_id}"),
    ]

    def test_all_expected_routes_registered(self, client):
        """Check that each expected route method+path exists in the FastAPI app routes."""
        # ⚠️ 原本的 `if hasattr(route, "path")` 是**靜默跳過** —— 新版 FastAPI 把
        #    include_router 的東西包成 `_IncludedRouter`（沒有 .path），於是裡面的
        #    路由整批消失，斷言會說「路由沒註冊」，看起來像重構把路由弄丟了。
        #    路由好好的，是走訪的方式看不到它。
        registered = method_paths(app)
        assert len(registered) >= 20, (
            f"只走到 {len(registered)} 條 method+path —— 走訪方式壞了，不是路由沒註冊")

        for method, path in self.EXPECTED_ROUTES:
            assert (method, path) in registered, (
                f"Route {method} {path} is NOT registered — refactor broke the path registry"
            )
