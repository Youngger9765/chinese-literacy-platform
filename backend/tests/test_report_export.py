"""
Tests for CSV report export endpoints.

Covers:
- GET /api/teacher/classrooms/{id}/export  (teacher CSV download)
- GET /api/admin/reports/export            (system-wide CSV export)

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-235/backend
    python -m pytest tests/test_report_export.py -v
"""

import sys
import os
import uuid
from datetime import datetime, timezone

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
from app.models.school import School
from app.models.session import LearningSession


# ---------------------------------------------------------------------------
# Test database setup
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
    {"name": "org_admin", "display_name": "Organization Admin", "scope_level": "organization"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "parent", "display_name": "Parent", "scope_level": "school"},
]


def _seed_roles(session):
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    session.commit()


def _seed_school(session) -> int:
    school = School(name="Export Test School")
    session.add(school)
    session.commit()
    session.refresh(school)
    return school.id


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


_test_school_id: int = 0


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _test_school_id
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    _test_school_id = _seed_school(session)
    session.close()

    from app.routes.auth import rate_limiter
    rate_limiter.reset()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def school_id():
    return _test_school_id


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{suffix.title()} {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    user_id = me_resp.json()["id"]

    _mk = TestingSessionLocal()
    try:
        _trole = _mk.query(Role).filter(Role.name == "teacher").first()
        if _trole and not _mk.query(UserRole).filter(
            UserRole.user_id == user_id, UserRole.role_id == _trole.id,
            UserRole.scope_type == "school", UserRole.scope_id == str(_test_school_id),
        ).first():
            _mk.add(UserRole(user_id=user_id, role_id=_trole.id,
                             scope_type="school", scope_id=str(_test_school_id)))
            _mk.commit()
    finally:
        _mk.close()

    return {
        "token": token,
        "user_id": user_id,
        "email": email,
        "name": name,
    }


def _make_admin(user_id: int):
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == "system_admin").first()
    user_role = UserRole(
        user_id=user_id,
        role_id=role.id,
        scope_type="platform",
        scope_id=None,
    )
    db.add(user_role)
    db.commit()
    db.close()


def _create_session(student_id: int, status: str = "completed", accuracy: float | None = 90.0):
    db = TestingSessionLocal()
    session = LearningSession(
        student_id=student_id,
        story_slug="1",
        status=status,
        accuracy=accuracy,
        started_at=datetime.now(timezone.utc),
    )
    db.add(session)
    db.commit()
    db.close()


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "exp_teacher")


@pytest.fixture(scope="module")
def other_teacher(client):
    return _register_user(client, "exp_other_tch")


@pytest.fixture(scope="module")
def student1(client):
    return _register_user(client, "exp_stu1")


@pytest.fixture(scope="module")
def student2(client):
    return _register_user(client, "exp_stu2")


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "exp_admin")
    _make_admin(user["user_id"])
    return user


# ===========================================================================
# GET /api/teacher/classrooms/{id}/export
# ===========================================================================


class TestExportClassroomReport:
    def test_teacher_exports_own_classroom(self, client, teacher, student1, school_id):
        """Teacher can export their own classroom with students and sessions."""
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Export Test Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        assert create_resp.status_code == 201
        classroom_id = create_resp.json()["id"]

        # Add student
        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student1["user_id"]},
            headers=auth_header(teacher["token"]),
        )

        # Create a session for the student
        _create_session(student1["user_id"])

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/export",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200

        # Decode response — strip BOM if present
        content = resp.content.decode("utf-8-sig")
        assert student1["name"] in content

    def test_csv_bom_header(self, client, teacher, school_id):
        """Response content must start with UTF-8 BOM bytes."""
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "BOM Test Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/export",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        # UTF-8 BOM is EF BB BF
        assert resp.content[:3] == b"\xef\xbb\xbf"

    def test_csv_content_type(self, client, teacher, school_id):
        """Response must have CSV content type and Content-Disposition attachment."""
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Headers Test Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/export",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")
        disposition = resp.headers.get("content-disposition", "")
        assert "attachment" in disposition
        assert ".csv" in disposition

    def test_non_owner_forbidden(self, client, teacher, other_teacher, school_id):
        """A different teacher cannot export a classroom they don't own."""
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Forbidden Export Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/export",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_system_admin_can_export(self, client, teacher, admin_user, school_id):
        """System admin can export any classroom."""
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Admin Export Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/export",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200

    def test_empty_classroom(self, client, teacher, student2, school_id):
        """A classroom with students but no sessions yields rows with empty values."""
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Empty Sessions Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student2["user_id"]},
            headers=auth_header(teacher["token"]),
        )

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/export",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        content = resp.content.decode("utf-8-sig")
        lines = content.strip().splitlines()
        # Header + 1 student row
        assert len(lines) == 2
        assert student2["name"] in lines[1]

    def test_csv_has_expected_columns(self, client, teacher, school_id):
        """CSV header must contain all required column names including new gamification fields."""
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Columns Check Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/export",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        content = resp.content.decode("utf-8-sig")
        header = content.splitlines()[0]
        # Core progress columns
        assert "學生姓名" in header
        assert "已完成課文數" in header
        assert "平均正確率" in header
        assert "總學習次數" in header
        assert "最近學習日期" in header
        # New gamification/performance columns (#235)
        assert "平均語速(CPM)" in header
        assert "已掌握生字" in header
        assert "連續學習天數" in header
        assert "累積XP" in header

    def test_requires_auth(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Auth Export Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(f"/api/teacher/classrooms/{classroom_id}/export")
        assert resp.status_code == 401


# ===========================================================================
# GET /api/admin/reports/export
# ===========================================================================


class TestAdminPlatformExport:
    def test_admin_platform_export(self, client, admin_user, teacher, student1, school_id):
        """Admin can export platform-wide data."""
        # Ensure some data exists
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Admin Export Platform Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student1["user_id"]},
            headers=auth_header(teacher["token"]),
        )

        resp = client.get(
            "/api/admin/reports/export",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        # UTF-8 BOM
        assert resp.content[:3] == b"\xef\xbb\xbf"
        content = resp.content.decode("utf-8-sig")
        header = content.splitlines()[0]
        assert "學校名稱" in header
        assert "班級名稱" in header
        assert "學生姓名" in header

    def test_admin_export_filter_by_school(self, client, admin_user, school_id):
        """Admin export can be filtered by school_id."""
        resp = client.get(
            f"/api/admin/reports/export?school_id={school_id}",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200

    def test_admin_export_filter_by_classroom(self, client, admin_user, teacher, school_id):
        """Admin export can be filtered by classroom_id."""
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Admin Filter Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/admin/reports/export?classroom_id={classroom_id}",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200

    def test_non_admin_forbidden(self, client, teacher):
        """Non-admin user cannot access platform export."""
        resp = client.get(
            "/api/admin/reports/export",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 403

    def test_requires_auth(self, client):
        resp = client.get("/api/admin/reports/export")
        assert resp.status_code == 401

    def test_csv_content_type_and_disposition(self, client, admin_user):
        """Admin export response has correct content type and attachment header."""
        resp = client.get(
            "/api/admin/reports/export",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")
        disposition = resp.headers.get("content-disposition", "")
        assert "attachment" in disposition
        assert ".csv" in disposition
