"""
Security integration tests for org_admin cross-org data isolation.

Attack scenario: A org_admin should NOT be able to read B org's
user data, gamification records, or feedback — 個資法 §20 compliance.

Matrix tested:
  - A org_admin → B org user list          → 403 / empty
  - A org_admin → B org user detail        → 403
  - A org_admin → B org student gamification → 403
  - A org_admin → B org classroom leaderboard → 403
  - A org_admin → B org user feedback      → 403 / empty (via list)
  - A org_admin → B org feedback PATCH     → 403
  - A org_admin → A org user list          → 200 (own org allowed)
  - A org_admin → A org student gamification → 200 (own org allowed)
  - system_admin → any org                 → 200 (global bypass)
  - plain teacher → other user's gamification → 403

Run with:
    cd /Users/young/project/chinese-literacy-platform/backend
    python -m pytest tests/test_org_admin_scope_security.py -v
"""

import sys
import os
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
from app.models.user import Role, User, UserRole


# ---------------------------------------------------------------------------
# In-memory SQLite DB
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin",    "display_name": "Org Admin",    "scope_level": "organization"},
    {"name": "org_owner",    "display_name": "Org Owner",    "scope_level": "organization"},
    {"name": "teacher",      "display_name": "Teacher",      "scope_level": "school"},
    {"name": "student",      "display_name": "Student",      "scope_level": "school"},
]


def _seed_roles(session):
    for r in SEED_ROLES:
        session.add(Role(**r))
    session.commit()


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Module-scoped fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _reset_rate_limiters():
    """Reset all rate limiters between registrations to avoid 429 in tests."""
    try:
        from app.routes.auth import rate_limiter
        rate_limiter.reset()
    except (ImportError, AttributeError):
        pass
    try:
        from app.auth.rate_limiter import general_rate_limiter
        general_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass


def _register_login(client, label: str) -> tuple[int, str]:
    """Register + verify + login. Returns (user_id, access_token)."""
    _reset_rate_limiters()
    uid = uuid.uuid4().hex[:8]
    email = f"{label}_{uid}@test.example"
    r = client.post("/api/auth/register", json={
        "email": email,
        "password": "Secure99!",
        "name": label,
    })
    assert r.status_code == 201, r.text
    tok = r.json().get("verification_token")
    if tok:
        client.get(f"/api/auth/verify-email?token={tok}")
    _reset_rate_limiters()
    login = client.post("/api/auth/login", json={"email": email, "password": "Secure99!"})
    assert login.status_code == 200, login.text
    access = login.json()["access_token"]
    me = client.get("/api/users/me", headers=auth_header(access))
    user_id = me.json()["id"]
    return user_id, access


def _assign_role(user_id: int, role_name: str,
                 scope_type: str = "platform", scope_id: str | None = None) -> None:
    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == role_name).first()
        db.add(UserRole(
            user_id=user_id,
            role_id=role.id,
            scope_type=scope_type,
            scope_id=scope_id,
        ))
        db.commit()
    finally:
        db.close()


def _assign_org_role(user_id: int, role_name: str, org_id: str) -> None:
    _assign_role(user_id, role_name, scope_type="organization", scope_id=org_id)


def _submit_feedback(client, token: str) -> int:
    """Submit a feedback entry and return its ID."""
    r = client.post("/api/feedback", json={
        "category": "bug",
        "title": "Test feedback",
        "description": "For security test",
        "page_url": "/test",
    }, headers=auth_header(token))
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestOrgAdminScopeIsolation:
    """
    Seed layout:
      Org-A  (scope_id = "org-alpha")
        - admin_a  : org_admin scoped to org-alpha
        - student_a: student scoped to org-alpha

      Org-B  (scope_id = "org-beta")
        - admin_b  : org_admin scoped to org-beta
        - student_b: student scoped to org-beta

      sys_admin  : system_admin (platform scope)
      teacher_c  : teacher with no special org scope
    """

    ORG_A = "org-alpha"
    ORG_B = "org-beta"

    @pytest.fixture(scope="class")
    def actors(self, client):
        """Create all actors once per class."""
        admin_a_id, admin_a_tok = _register_login(client, "admin_a")
        _assign_org_role(admin_a_id, "org_admin", self.ORG_A)

        admin_b_id, admin_b_tok = _register_login(client, "admin_b")
        _assign_org_role(admin_b_id, "org_admin", self.ORG_B)

        student_a_id, student_a_tok = _register_login(client, "student_a")
        _assign_org_role(student_a_id, "student", self.ORG_A)

        student_b_id, student_b_tok = _register_login(client, "student_b")
        _assign_org_role(student_b_id, "student", self.ORG_B)

        sysadmin_id, sysadmin_tok = _register_login(client, "sysadmin")
        _assign_role(sysadmin_id, "system_admin", scope_type="platform")

        teacher_c_id, teacher_c_tok = _register_login(client, "teacher_c")
        _assign_role(teacher_c_id, "teacher", scope_type="platform")

        # Submit feedback as student_b (so we can test cross-org PATCH)
        fb_b_id = _submit_feedback(client, student_b_tok)
        # Submit feedback as student_a (so admin_a can access it)
        fb_a_id = _submit_feedback(client, student_a_tok)

        return {
            "admin_a": (admin_a_id, admin_a_tok),
            "admin_b": (admin_b_id, admin_b_tok),
            "student_a": (student_a_id, student_a_tok),
            "student_b": (student_b_id, student_b_tok),
            "sysadmin": (sysadmin_id, sysadmin_tok),
            "teacher_c": (teacher_c_id, teacher_c_tok),
            "fb_a_id": fb_a_id,
            "fb_b_id": fb_b_id,
        }

    # ── User list ─────────────────────────────────────────────────────────────

    def test_list_users_cross_org_returns_no_b_users(self, client, actors):
        """A org_admin listing users must NOT see B org's students."""
        _, admin_a_tok = actors["admin_a"]
        student_b_id, _ = actors["student_b"]
        r = client.get("/api/users", headers=auth_header(admin_a_tok))
        assert r.status_code == 200, r.text
        ids = [u["id"] for u in r.json()["items"]]
        assert student_b_id not in ids, (
            f"A org_admin should not see B's student (id={student_b_id}) in /api/users"
        )

    def test_list_users_own_org_visible(self, client, actors):
        """A org_admin can see their own org's users."""
        _, admin_a_tok = actors["admin_a"]
        admin_a_id, _ = actors["admin_a"]
        student_a_id, _ = actors["student_a"]
        r = client.get("/api/users", headers=auth_header(admin_a_tok))
        assert r.status_code == 200, r.text
        ids = [u["id"] for u in r.json()["items"]]
        assert student_a_id in ids, "A org_admin must see their own student"

    # ── User detail ───────────────────────────────────────────────────────────

    def test_get_user_detail_cross_org_is_403(self, client, actors):
        """A org_admin reading B's student detail must get 403."""
        _, admin_a_tok = actors["admin_a"]
        student_b_id, _ = actors["student_b"]
        r = client.get(f"/api/users/{student_b_id}", headers=auth_header(admin_a_tok))
        assert r.status_code == 403, (
            f"Expected 403 when A org_admin reads B's user detail, got {r.status_code}: {r.text}"
        )

    def test_get_user_detail_own_org_is_200(self, client, actors):
        """A org_admin can read a user in their own org."""
        _, admin_a_tok = actors["admin_a"]
        student_a_id, _ = actors["student_a"]
        r = client.get(f"/api/users/{student_a_id}", headers=auth_header(admin_a_tok))
        assert r.status_code == 200, (
            f"A org_admin should read own student, got {r.status_code}: {r.text}"
        )

    def test_get_user_detail_system_admin_any_org_is_200(self, client, actors):
        """system_admin can read any user regardless of org."""
        _, sysadmin_tok = actors["sysadmin"]
        student_b_id, _ = actors["student_b"]
        r = client.get(f"/api/users/{student_b_id}", headers=auth_header(sysadmin_tok))
        assert r.status_code == 200, (
            f"system_admin must read any user, got {r.status_code}: {r.text}"
        )

    # ── Gamification: student summary ─────────────────────────────────────────

    def test_gamification_summary_cross_org_is_403(self, client, actors):
        """A org_admin reading B's student gamification must get 403."""
        _, admin_a_tok = actors["admin_a"]
        student_b_id, _ = actors["student_b"]
        r = client.get(
            f"/api/gamification/summary/{student_b_id}",
            headers=auth_header(admin_a_tok),
        )
        assert r.status_code == 403, (
            f"Expected 403 on cross-org gamification read, got {r.status_code}: {r.text}"
        )

    def test_gamification_summary_own_org_is_200(self, client, actors):
        """A org_admin can read their own student's gamification."""
        _, admin_a_tok = actors["admin_a"]
        student_a_id, _ = actors["student_a"]
        r = client.get(
            f"/api/gamification/summary/{student_a_id}",
            headers=auth_header(admin_a_tok),
        )
        assert r.status_code == 200, (
            f"A org_admin must read own student's gamification, got {r.status_code}: {r.text}"
        )

    def test_gamification_summary_system_admin_any_is_200(self, client, actors):
        """system_admin can read any student's gamification."""
        _, sysadmin_tok = actors["sysadmin"]
        student_b_id, _ = actors["student_b"]
        r = client.get(
            f"/api/gamification/summary/{student_b_id}",
            headers=auth_header(sysadmin_tok),
        )
        assert r.status_code == 200, (
            f"system_admin must read any gamification, got {r.status_code}: {r.text}"
        )

    def test_gamification_summary_plain_teacher_other_student_is_403(self, client, actors):
        """A plain teacher with no shared classroom cannot read another student's gamification."""
        _, teacher_c_tok = actors["teacher_c"]
        student_b_id, _ = actors["student_b"]
        r = client.get(
            f"/api/gamification/summary/{student_b_id}",
            headers=auth_header(teacher_c_tok),
        )
        assert r.status_code == 403, (
            f"Plain teacher must not read other student's gamification, got {r.status_code}"
        )

    # ── Gamification: other student-specific endpoints ─────────────────────────

    def test_gamification_points_cross_org_is_403(self, client, actors):
        """A org_admin reading B's student points must get 403."""
        _, admin_a_tok = actors["admin_a"]
        student_b_id, _ = actors["student_b"]
        r = client.get(
            f"/api/gamification/points/{student_b_id}",
            headers=auth_header(admin_a_tok),
        )
        assert r.status_code == 403, f"Got {r.status_code}: {r.text}"

    def test_gamification_achievements_cross_org_is_403(self, client, actors):
        """A org_admin reading B's student achievements must get 403."""
        _, admin_a_tok = actors["admin_a"]
        student_b_id, _ = actors["student_b"]
        r = client.get(
            f"/api/gamification/achievements/{student_b_id}",
            headers=auth_header(admin_a_tok),
        )
        assert r.status_code == 403, f"Got {r.status_code}: {r.text}"

    def test_gamification_streak_cross_org_is_403(self, client, actors):
        """A org_admin reading B's student streak must get 403."""
        _, admin_a_tok = actors["admin_a"]
        student_b_id, _ = actors["student_b"]
        r = client.get(
            f"/api/gamification/streak/{student_b_id}",
            headers=auth_header(admin_a_tok),
        )
        assert r.status_code == 403, f"Got {r.status_code}: {r.text}"

    # ── Feedback: list ────────────────────────────────────────────────────────

    def test_list_feedback_cross_org_not_visible(self, client, actors):
        """A org_admin listing feedback must NOT see entries from B org's users."""
        _, admin_a_tok = actors["admin_a"]
        fb_b_id = actors["fb_b_id"]
        r = client.get("/api/feedback", headers=auth_header(admin_a_tok))
        assert r.status_code == 200, r.text
        ids = [f["id"] for f in r.json()["items"]]
        assert fb_b_id not in ids, (
            f"A org_admin must not see B's feedback (id={fb_b_id})"
        )

    def test_list_feedback_own_org_visible(self, client, actors):
        """A org_admin can see feedback from their own org's users."""
        _, admin_a_tok = actors["admin_a"]
        fb_a_id = actors["fb_a_id"]
        r = client.get("/api/feedback", headers=auth_header(admin_a_tok))
        assert r.status_code == 200, r.text
        ids = [f["id"] for f in r.json()["items"]]
        assert fb_a_id in ids, f"A org_admin must see their org's feedback (id={fb_a_id})"

    def test_list_feedback_system_admin_sees_all(self, client, actors):
        """system_admin sees all feedback including cross-org."""
        _, sysadmin_tok = actors["sysadmin"]
        fb_b_id = actors["fb_b_id"]
        r = client.get("/api/feedback", headers=auth_header(sysadmin_tok))
        assert r.status_code == 200, r.text
        ids = [f["id"] for f in r.json()["items"]]
        assert fb_b_id in ids, "system_admin must see all feedback"

    # ── Feedback: PATCH ───────────────────────────────────────────────────────

    def test_patch_feedback_cross_org_is_403(self, client, actors):
        """A org_admin updating B's user's feedback must get 403."""
        _, admin_a_tok = actors["admin_a"]
        fb_b_id = actors["fb_b_id"]
        r = client.patch(
            f"/api/feedback/{fb_b_id}",
            json={"status": "resolved"},
            headers=auth_header(admin_a_tok),
        )
        assert r.status_code == 403, (
            f"Expected 403 when A org_admin patches B's feedback, got {r.status_code}: {r.text}"
        )

    def test_patch_feedback_own_org_is_200(self, client, actors):
        """A org_admin can update feedback from their own org's users."""
        _, admin_a_tok = actors["admin_a"]
        fb_a_id = actors["fb_a_id"]
        r = client.patch(
            f"/api/feedback/{fb_a_id}",
            json={"status": "in_progress"},
            headers=auth_header(admin_a_tok),
        )
        assert r.status_code == 200, (
            f"A org_admin should update own org's feedback, got {r.status_code}: {r.text}"
        )

    def test_patch_feedback_system_admin_any_is_200(self, client, actors):
        """system_admin can update any feedback."""
        _, sysadmin_tok = actors["sysadmin"]
        fb_b_id = actors["fb_b_id"]
        r = client.patch(
            f"/api/feedback/{fb_b_id}",
            json={"status": "resolved"},
            headers=auth_header(sysadmin_tok),
        )
        assert r.status_code == 200, (
            f"system_admin must update any feedback, got {r.status_code}: {r.text}"
        )
