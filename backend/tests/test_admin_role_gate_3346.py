"""system_admin role gate on admin debug/seed routes (Issue #3346, batch 9).

Covers:
    GET  /api/admin/sessions             (backend/app/routes/admin_sessions.py)
    POST /api/admin/seed/demo-students   (backend/app/routes/admin_seed.py)

Both rely solely on `dependencies=[require_role("system_admin")]`. GET
/admin/sessions returns every student's sessions platform-wide; the seed route
creates user accounts. Before this file neither had a test, so removing the
dependency (or widening the role list) would not turn anything red.

Least-privilege discipline (rules/testing-strategy.md): rejections use real,
authenticated users that are *almost* admins — a teacher, an org_admin, a
system_admin whose role row is deactivated — plus a plain student. The positive
control is an active system_admin getting 200 with real data; the seed denial
also re-reads the DB to prove nothing was created.

Run with:
    cd backend
    python -m pytest tests/test_admin_role_gate_3346.py -v
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
from app.config import settings
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.school import Classroom, School
from app.models.session import LearningSession
from app.models.user import Role, User, UserRole

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

PASSWORD = "Password1!"
SEED_PREFIX = "adm3346"

U: dict[str, int] = {}
C: dict[str, int] = {}

DENIED = ["student", "teacher", "org_admin", "revoked_sysadmin"]


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _user(db, key: str) -> User:
    user = User(
        email=f"adm3346_{key}@example.com",
        username=f"adm3346_{key}",
        password_hash=hash_password(PASSWORD),
        name=key,
        is_active=True,
        email_verified=True,
    )
    db.add(user)
    db.flush()
    U[key] = user.id
    return user


def _role(db, name: str, scope_level: str) -> Role:
    role = Role(name=name, display_name=name, scope_level=scope_level)
    db.add(role)
    db.flush()
    return role


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    sysadmin = _user(db, "sysadmin")
    revoked = _user(db, "revoked_sysadmin")
    teacher = _user(db, "teacher")
    org_admin = _user(db, "org_admin")
    student = _user(db, "student")

    r_sys = _role(db, "system_admin", "platform")
    r_teacher = _role(db, "teacher", "school")
    r_org = _role(db, "org_admin", "organization")
    db.add_all([
        UserRole(user_id=sysadmin.id, role_id=r_sys.id, scope_type="platform"),
        UserRole(user_id=revoked.id, role_id=r_sys.id, scope_type="platform", is_active=False),
        UserRole(user_id=teacher.id, role_id=r_teacher.id, scope_type="school", scope_id="1"),
        UserRole(user_id=org_admin.id, role_id=r_org.id, scope_type="organization", scope_id="org-x"),
    ])

    school = School(name="ADM 3346 School")
    db.add(school)
    db.flush()
    classroom = Classroom(name="ADM", school_id=school.id, teacher_id=teacher.id, join_code="ADM3346A")
    db.add(classroom)
    db.flush()
    C["a"] = classroom.id

    db.add(LearningSession(student_id=student.id, story_slug="adm-slug", status="completed"))
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
            json={"email": f"adm3346_{key}@example.com", "password": PASSWORD},
        )
        assert resp.status_code == 200, resp.text
        _TOKENS[key] = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    return _TOKENS[key]


def _seeded_user_count() -> int:
    db = TestingSessionLocal()
    try:
        return db.query(User).filter(User.email.like(f"{SEED_PREFIX}%@%")).filter(
            ~User.email.like("adm3346\\_%@example.com", escape="\\")
        ).count()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# GET /api/admin/sessions
# ---------------------------------------------------------------------------


class TestAdminSessions:
    def test_system_admin_gets_platform_wide_sessions(self, client):
        r = client.get("/api/admin/sessions", headers=_auth(client, "sysadmin"))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 1
        assert body["sessions"][0]["student_id"] == U["student"]
        assert body["by_slug"] == {"adm-slug": 1}

    @pytest.mark.parametrize("as_key", DENIED)
    def test_non_system_admin_is_403(self, client, as_key):
        r = client.get("/api/admin/sessions", headers=_auth(client, as_key))
        assert r.status_code == 403, r.text
        assert "sessions" not in r.json()

    def test_student_cannot_read_even_own_sessions_here(self, client):
        # filtering to yourself does not open the admin route
        r = client.get(f"/api/admin/sessions?student_id={U['student']}", headers=_auth(client, "student"))
        assert r.status_code == 403

    def test_unauthenticated_is_401(self, client):
        assert client.get("/api/admin/sessions").status_code == 401


# ---------------------------------------------------------------------------
# POST /api/admin/seed/demo-students
# ---------------------------------------------------------------------------


def _seed(client, as_key: str, count: int = 2, prefix: str = SEED_PREFIX):
    return client.post(
        "/api/admin/seed/demo-students",
        headers=_auth(client, as_key),
        json={"classroom_id": C["a"], "count": count, "prefix": prefix},
    )


class TestAdminSeed:
    @pytest.mark.parametrize("as_key", DENIED)
    def test_non_system_admin_is_403_and_creates_nothing(self, client, as_key, monkeypatch):
        monkeypatch.setattr(settings, "enable_test_seed", True)
        before = _seeded_user_count()
        r = _seed(client, as_key)
        assert r.status_code == 403, r.text
        assert _seeded_user_count() == before == 0

    def test_unauthenticated_is_401(self, client, monkeypatch):
        monkeypatch.setattr(settings, "enable_test_seed", True)
        r = client.post("/api/admin/seed/demo-students", json={"classroom_id": C["a"]})
        assert r.status_code == 401
        assert _seeded_user_count() == 0

    def test_system_admin_is_refused_when_flag_off(self, client, monkeypatch):
        monkeypatch.setattr(settings, "enable_test_seed", False)
        r = _seed(client, "sysadmin")
        assert r.status_code == 403, r.text
        assert "ENABLE_TEST_SEED" in r.json()["detail"]
        assert _seeded_user_count() == 0

    def test_system_admin_unknown_classroom_is_404(self, client, monkeypatch):
        monkeypatch.setattr(settings, "enable_test_seed", True)
        r = client.post(
            "/api/admin/seed/demo-students",
            headers=_auth(client, "sysadmin"),
            json={"classroom_id": 999999, "count": 1, "prefix": SEED_PREFIX},
        )
        assert r.status_code == 404
        assert _seeded_user_count() == 0

    def test_system_admin_can_seed(self, client, monkeypatch):
        # positive control — runs last in this class (file order)
        monkeypatch.setattr(settings, "enable_test_seed", True)
        r = _seed(client, "sysadmin", count=2)
        assert r.status_code == 200, r.text
        assert r.json()["students_created"] == 2
        assert _seeded_user_count() == 2
