"""
Characterization tests for organizations.py split (Issue #1890).

TDD-first: these tests must pass on the original monolith AND on the refactored
split modules — they are route-level black-box tests exercising the three key
behaviours called out in the issue:

1. list_organizations_scopes_non_system_admin_to_user_org_ids
   — non-system_admin only sees orgs they belong to

2. export_platform_report_limits_rows_and_prevents_csv_formula_injection
   — row cap raises 400; CSV formula injection is sanitised

3. dashboard_aggregates_school_teacher_student_session_counts
   — /dashboard returns correct totals (no N+1, no double-count)

Uses SQLite in-memory DB (same pattern as test_org_dashboard.py).

Run with:
    cd backend
    python -m pytest tests/test_organizations_split_1890.py -v
"""

import io
import sys
import os
import uuid
import csv as csv_mod

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
from app.models.organization import Organization
from app.models.school import School, Classroom, ClassroomStudent
from app.models.session import LearningSession

# ---------------------------------------------------------------------------
# DB wiring
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
    {"name": "org_owner", "display_name": "Org Owner", "scope_level": "organization"},
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "parent", "display_name": "Parent", "scope_level": "school"},
]


def _seed_roles(session):
    for r in ROLES:
        session.add(Role(**r))
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
    db.close()
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

def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _reset_rl():
    from app.routes.auth import rate_limiter
    rate_limiter.reset()


def _register(client, prefix):
    """Register + verify + login via API, return dict with token + user_id."""
    _reset_rl()
    uid = uuid.uuid4().hex[:8]
    email = f"{prefix}_{uid}@1890test.com"
    pw = "TestPass123!"
    resp = client.post("/api/auth/register", json={"email": email, "password": pw, "name": f"{prefix} {uid}"})
    assert resp.status_code == 201, resp.text
    vt = resp.json().get("verification_token")
    if vt:
        client.get(f"/api/auth/verify-email?token={vt}")
    login = client.post("/api/auth/login", json={"email": email, "password": pw})
    token = login.json()["access_token"]
    me = client.get("/api/users/me", headers=_auth(token))
    return {"token": token, "user_id": me.json()["id"]}


def _db_user(prefix):
    """Create user directly in DB (no rate limit), returns user_id."""
    from app.auth.password import hash_password
    db = SessionLocal()
    uid = uuid.uuid4().hex[:8]
    u = User(
        email=f"{prefix}_{uid}@1890test.com",
        password_hash=hash_password("TestPass123!"),
        name=f"{prefix}_{uid}",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    user_id = u.id
    db.close()
    return user_id


def _assign_role(user_id, role_name, scope_type, scope_id=None):
    db = SessionLocal()
    role = db.query(Role).filter(Role.name == role_name).first()
    db.add(UserRole(user_id=user_id, role_id=role.id, scope_type=scope_type, scope_id=scope_id))
    db.commit()
    db.close()


def _create_org(name):
    db = SessionLocal()
    org = Organization(name=name, display_name=name)
    db.add(org)
    db.commit()
    db.refresh(org)
    org_id = org.id
    db.close()
    return org_id


def _create_school(org_id, name):
    db = SessionLocal()
    school = School(name=name, organization_id=org_id)
    db.add(school)
    db.commit()
    db.refresh(school)
    sid = school.id
    db.close()
    return sid


def _create_classroom(school_id, teacher_id, name="Cls"):
    db = SessionLocal()
    cls = Classroom(school_id=school_id, teacher_id=teacher_id, name=name)
    db.add(cls)
    db.commit()
    db.refresh(cls)
    cid = cls.id
    db.close()
    return cid


def _enroll(classroom_id, student_id):
    db = SessionLocal()
    db.add(ClassroomStudent(classroom_id=classroom_id, student_id=student_id))
    db.commit()
    db.close()


def _create_session(student_id, classroom_id, status="in_progress"):
    """Create a LearningSession directly in DB via raw SQL to avoid JSONB deserialization."""
    from sqlalchemy import text
    db = SessionLocal()
    result = db.execute(
        text(
            "INSERT INTO learning_sessions (student_id, classroom_id, status, current_step) "
            "VALUES (:student_id, :classroom_id, :status, 1)"
        ),
        {"student_id": student_id, "classroom_id": classroom_id, "status": status},
    )
    db.commit()
    session_id = result.lastrowid
    db.close()
    return session_id


# ---------------------------------------------------------------------------
# Test 1 — list_organizations scopes non-system_admin to their own org_ids
# ---------------------------------------------------------------------------


class TestListOrganizationsTenantScoping:
    """
    Non-system_admin users must only see organizations they belong to.
    System_admin sees everything.
    """

    def test_list_organizations_scopes_non_system_admin_to_user_org_ids(self, client):
        """An org_owner only sees their own org, not others."""
        org_a = _create_org("1890 Scope Org A")
        org_b = _create_org("1890 Scope Org B")

        owner_a = _register(client, "scope1890_owner_a")
        _assign_role(owner_a["user_id"], "org_owner", "organization", org_a)

        resp = client.get("/api/organizations", headers=_auth(owner_a["token"]))
        assert resp.status_code == 200
        ids = [o["id"] for o in resp.json()["items"]]
        assert org_a in ids, "owner_a should see their own org"
        assert org_b not in ids, "owner_a must NOT see org_b (tenant isolation)"

    def test_system_admin_sees_all_orgs(self, client):
        """system_admin must see every org."""
        org_c = _create_org("1890 Scope Org C")
        org_d = _create_org("1890 Scope Org D")

        sysadmin = _register(client, "scope1890_sysadmin")
        _assign_role(sysadmin["user_id"], "system_admin", "platform", None)

        resp = client.get("/api/organizations", headers=_auth(sysadmin["token"]))
        assert resp.status_code == 200
        ids = [o["id"] for o in resp.json()["items"]]
        assert org_c in ids
        assert org_d in ids

    def test_unauthenticated_list_returns_401(self, client):
        resp = client.get("/api/organizations")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Test 2 — export_platform_report row limit + CSV formula injection prevention
# ---------------------------------------------------------------------------


class TestExportPlatformReport:
    """
    GET /api/admin/reports/export — system_admin only.
    • Returns 400 when result set would exceed the row limit.
    • CSV cells starting with =, +, -, @ are prefixed with ' to neutralise
      spreadsheet formula injection.
    """

    def test_export_platform_report_limits_rows_and_prevents_csv_formula_injection(
        self, client
    ):
        """CSV exports successfully and dangerous cell values are prefixed."""
        sysadmin = _register(client, "exp1890_sysadmin")
        _assign_role(sysadmin["user_id"], "system_admin", "platform", None)

        # Create an org, school with injection-attempt name, student
        org_id = _create_org("1890 Export Test Org")
        school_id = _create_school(org_id, "=SUM(1+1) Injection School")
        teacher_id = _db_user("exp1890_teacher")
        _assign_role(teacher_id, "teacher", "school", str(school_id))
        classroom_id = _create_classroom(school_id, teacher_id, "+ClassInjection")
        student_id = _db_user("exp1890_student")
        _enroll(classroom_id, student_id)

        resp = client.get(
            f"/api/admin/reports/export?school_id={school_id}",
            headers=_auth(sysadmin["token"]),
        )
        assert resp.status_code == 200, resp.text
        assert "text/csv" in resp.headers.get("content-type", "")

        raw = resp.content.decode("utf-8-sig")
        reader = csv_mod.reader(io.StringIO(raw))
        rows = list(reader)
        assert len(rows) >= 2, "Expect header row + at least one data row"

        header = rows[0]
        assert "學校名稱" in header
        assert "學生姓名" in header

        # School name starts with '=' → must be sanitised (prefixed with ')
        data_rows = rows[1:]
        for row in data_rows:
            school_cell = row[0]
            class_cell = row[1]
            # No raw formula starters in school name cell
            assert not school_cell.startswith("="), (
                f"Formula injection not sanitised in school cell: {school_cell!r}"
            )
            if "SUM" in school_cell or "Injection" in school_cell:
                assert school_cell.startswith("'"), (
                    f"Expected injection prefix \"'\" on cell: {school_cell!r}"
                )
            # Class name starts with '+' → must be sanitised
            assert not class_cell.startswith("+"), (
                f"Formula injection not sanitised in class cell: {class_cell!r}"
            )

    def test_export_requires_system_admin(self, client):
        """Non-admin user must get 403."""
        user = _register(client, "exp1890_nonadmin")
        resp = client.get("/api/admin/reports/export", headers=_auth(user["token"]))
        assert resp.status_code == 403

    def test_export_unauthenticated_returns_401(self, client):
        resp = client.get("/api/admin/reports/export")
        assert resp.status_code == 401

    def test_export_row_limit_raises_400(self, client, monkeypatch):
        """Simulate exceeding row limit → expect HTTP 400."""
        # After the split, the limit lives in admin_report_export module.
        # We patch whichever module is the source of truth.
        import importlib
        try:
            mod = importlib.import_module("app.routes.admin_report_export")
        except ModuleNotFoundError:
            # Pre-split: limit is in organizations module
            import app.routes.organizations as mod  # type: ignore

        original = mod._ADMIN_EXPORT_ROW_LIMIT
        monkeypatch.setattr(mod, "_ADMIN_EXPORT_ROW_LIMIT", 0)

        sysadmin = _register(client, "exp1890_limit_sysadmin")
        _assign_role(sysadmin["user_id"], "system_admin", "platform", None)

        org_id = _create_org("1890 Limit Test Org")
        school_id = _create_school(org_id, "Limit School 1890")
        teacher_id = _db_user("limit1890_teacher")
        _assign_role(teacher_id, "teacher", "school", str(school_id))
        classroom_id = _create_classroom(school_id, teacher_id)
        student_id = _db_user("limit1890_student")
        _enroll(classroom_id, student_id)

        resp = client.get(
            f"/api/admin/reports/export?school_id={school_id}",
            headers=_auth(sysadmin["token"]),
        )
        assert resp.status_code == 400, (
            f"Expected 400 when row limit=0, got {resp.status_code}: {resp.text}"
        )


# ---------------------------------------------------------------------------
# Test 3 — dashboard_aggregates_school_teacher_student_session_counts
# ---------------------------------------------------------------------------


class TestDashboardAggregates:
    """
    GET /api/organizations/{org_id}/dashboard returns correct aggregate
    counts broken down per school.
    """

    def test_dashboard_aggregates_school_teacher_student_session_counts(self, client):
        """Two schools: verify per-school and totals are accurate."""
        sysadmin = _register(client, "agg1890_sysadmin")
        _assign_role(sysadmin["user_id"], "system_admin", "platform", None)

        org_id = _create_org("1890 Agg Test Org")

        # School 1: 2 teachers, 2 students, 3 sessions (1 completed)
        school1 = _create_school(org_id, "1890 Agg School 1")
        t1 = _db_user("agg1890_t1")
        t2 = _db_user("agg1890_t2")
        _assign_role(t1, "teacher", "school", str(school1))
        _assign_role(t2, "teacher", "school", str(school1))
        cls1 = _create_classroom(school1, t1, "Agg1890 Cls 1")
        s1 = _db_user("agg1890_s1")
        s2 = _db_user("agg1890_s2")
        _enroll(cls1, s1)
        _enroll(cls1, s2)
        _create_session(s1, cls1, "completed")
        _create_session(s2, cls1, "in_progress")
        _create_session(s1, cls1, "in_progress")

        # School 2: 1 teacher, 1 student, 1 session (completed)
        school2 = _create_school(org_id, "1890 Agg School 2")
        t3 = _db_user("agg1890_t3")
        _assign_role(t3, "teacher", "school", str(school2))
        cls2 = _create_classroom(school2, t3, "Agg1890 Cls 2")
        s3 = _db_user("agg1890_s3")
        _enroll(cls2, s3)
        _create_session(s3, cls2, "completed")

        resp = client.get(
            f"/api/organizations/{org_id}/dashboard",
            headers=_auth(sysadmin["token"]),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()

        assert data["total_schools"] == 2
        assert data["total_teachers"] == 3
        assert data["total_students"] == 3
        assert data["total_sessions"] == 4
        assert data["completed_sessions"] == 2

        stats = {s["school_name"]: s for s in data["school_stats"]}
        s1_stats = stats["1890 Agg School 1"]
        assert s1_stats["teacher_count"] == 2
        assert s1_stats["student_count"] == 2
        assert s1_stats["session_count"] == 3

        s2_stats = stats["1890 Agg School 2"]
        assert s2_stats["teacher_count"] == 1
        assert s2_stats["student_count"] == 1
        assert s2_stats["session_count"] == 1

    def test_dashboard_forbidden_for_plain_user(self, client):
        """Regular user not in org must get 403."""
        org_id = _create_org("1890 Agg Forbidden Org")
        user = _register(client, "agg1890_forbidden")
        resp = client.get(
            f"/api/organizations/{org_id}/dashboard",
            headers=_auth(user["token"]),
        )
        assert resp.status_code == 403

    def test_dashboard_empty_org_returns_zeros(self, client):
        """Org with no schools returns all-zero counts."""
        sysadmin = _register(client, "agg1890_empty_sysadmin")
        _assign_role(sysadmin["user_id"], "system_admin", "platform", None)

        org_id = _create_org("1890 Agg Empty Org")
        resp = client.get(
            f"/api/organizations/{org_id}/dashboard",
            headers=_auth(sysadmin["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_schools"] == 0
        assert data["total_teachers"] == 0
        assert data["total_students"] == 0
        assert data["total_sessions"] == 0
        assert data["completed_sessions"] == 0
