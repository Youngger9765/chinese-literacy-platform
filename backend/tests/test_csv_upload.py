"""
Tests for CSV student import API endpoints.

Covers:
- GET  /api/classrooms/csv-template           (download CSV template)
- POST /api/classrooms/{id}/students/upload-csv  (upload CSV to create students)

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd /path/to/chinese-literacy-platform-issue-83/backend
    python -m pytest tests/test_csv_upload.py -v
"""

import io
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
from app.models.user import Role, UserRole
from app.models.school import School


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
    school = School(name="CSV Test School")
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


# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

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
    return {"email": email, "name": name, "token": token, "user_id": user_id}


def _make_admin(user_data: dict) -> dict:
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == "system_admin").first()
    user_role = UserRole(
        user_id=user_data["user_id"],
        role_id=role.id,
        scope_type="platform",
        scope_id=None,
    )
    db.add(user_role)
    db.commit()
    db.close()
    return user_data


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def make_csv_bytes(content: str) -> bytes:
    """Helper to create CSV file bytes for upload."""
    return content.encode("utf-8")


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "csv_teacher")


@pytest.fixture(scope="module")
def other_teacher(client):
    return _register_user(client, "csv_other_teacher")


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "csv_admin")
    return _make_admin(user)


@pytest.fixture(scope="module")
def classroom(client, teacher, school_id):
    """Create a classroom for CSV upload tests."""
    resp = client.post(
        "/api/classrooms",
        json={"name": "CSV Upload Classroom", "school_id": school_id},
        headers=auth_header(teacher["token"]),
    )
    assert resp.status_code == 201
    return resp.json()


# ===========================================================================
# GET /api/classrooms/csv-template
# ===========================================================================


class TestCsvTemplateDownload:
    """Tests for the CSV template download endpoint."""

    def test_download_template_success(self, client, teacher):
        resp = client.get(
            "/api/classrooms/csv-template",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]
        assert "attachment" in resp.headers.get("content-disposition", "")

    def test_template_has_header_row(self, client, teacher):
        resp = client.get(
            "/api/classrooms/csv-template",
            headers=auth_header(teacher["token"]),
        )
        content = resp.content.decode("utf-8-sig")  # Handle BOM
        lines = [line for line in content.strip().split("\n") if line.strip()]
        assert len(lines) >= 1
        header = lines[0].lower()
        # Should contain name and seat_number columns
        assert "name" in header or "姓名" in header
        assert "seat" in header or "座號" in header

    def test_template_has_example_rows(self, client, teacher):
        resp = client.get(
            "/api/classrooms/csv-template",
            headers=auth_header(teacher["token"]),
        )
        content = resp.content.decode("utf-8-sig")
        lines = [line for line in content.strip().split("\n") if line.strip()]
        # Should have at least header + 1 example row
        assert len(lines) >= 2

    def test_template_requires_auth(self, client):
        resp = client.get("/api/classrooms/csv-template")
        assert resp.status_code == 401


# ===========================================================================
# POST /api/classrooms/{id}/students/upload-csv
# ===========================================================================


class TestCsvUpload:
    """Tests for the CSV student upload endpoint."""

    def test_upload_valid_csv_without_header(self, client, teacher, classroom):
        classroom_id = classroom["id"]
        csv_content = "王小明,01\n李小華,02\n陳大文,03\n"
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("students.csv", make_csv_bytes(csv_content), "text/csv")},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["created_count"] >= 3
        assert data["skipped_count"] == 0
        assert len(data["errors"]) == 0

    def test_upload_valid_csv_with_header(self, client, teacher, school_id):
        # Create a fresh classroom for this test to avoid enrollment conflicts
        cr = client.post(
            "/api/classrooms",
            json={"name": "CSV Header Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = cr.json()["id"]

        csv_content = "name,seat_number\n林小美,01\n黃大偉,02\n"
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("students.csv", make_csv_bytes(csv_content), "text/csv")},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["created_count"] == 2
        assert data["skipped_count"] == 0

    def test_upload_returns_correct_structure(self, client, teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "CSV Structure Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = cr.json()["id"]

        csv_content = "測試學生,10\n"
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("students.csv", make_csv_bytes(csv_content), "text/csv")},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        # Must have all required fields
        assert "created_count" in data
        assert "skipped_count" in data
        assert "errors" in data
        assert "created" in data
        # Check created student info
        assert len(data["created"]) == 1
        student = data["created"][0]
        assert "name" in student
        assert "seat_number" in student
        assert "username" in student
        assert "password" in student
        assert "user_id" in student

    def test_upload_skips_duplicate_seat_numbers(self, client, teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "CSV Dupe Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = cr.json()["id"]

        # First upload
        csv1 = "初次學生,01\n"
        client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("s.csv", make_csv_bytes(csv1), "text/csv")},
            headers=auth_header(teacher["token"]),
        )

        # Second upload with same seat number
        csv2 = "重複學生,01\n"
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("s.csv", make_csv_bytes(csv2), "text/csv")},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["created_count"] == 0
        assert data["skipped_count"] == 1
        assert len(data["errors"]) == 1

    def test_upload_partial_success(self, client, teacher, school_id):
        """Valid rows succeed even when some rows fail."""
        cr = client.post(
            "/api/classrooms",
            json={"name": "CSV Partial Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = cr.json()["id"]

        # Upload: first student good, second has empty name
        csv_content = "有效學生,01\n,02\n另一有效,03\n"
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("s.csv", make_csv_bytes(csv_content), "text/csv")},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["created_count"] == 2
        assert data["skipped_count"] == 1
        assert len(data["errors"]) == 1

    def test_upload_requires_auth(self, client, classroom):
        classroom_id = classroom["id"]
        csv_content = "測試,01\n"
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("s.csv", make_csv_bytes(csv_content), "text/csv")},
        )
        assert resp.status_code == 401

    def test_upload_403_for_other_teacher(self, client, teacher, other_teacher, classroom):
        classroom_id = classroom["id"]
        csv_content = "測試,99\n"
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("s.csv", make_csv_bytes(csv_content), "text/csv")},
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_upload_404_nonexistent_classroom(self, client, teacher):
        csv_content = "測試,01\n"
        resp = client.post(
            "/api/classrooms/99999/students/upload-csv",
            files={"file": ("s.csv", make_csv_bytes(csv_content), "text/csv")},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404

    def test_upload_empty_file_returns_422(self, client, teacher, classroom):
        classroom_id = classroom["id"]
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("s.csv", b"", "text/csv")},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_upload_respects_100_student_limit(self, client, teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "CSV Limit Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = cr.json()["id"]

        # Generate 101 student rows
        rows = "\n".join(f"學生{i},{i:03d}" for i in range(1, 102))
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("s.csv", make_csv_bytes(rows), "text/csv")},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422
        assert "100" in resp.json()["detail"]

    def test_upload_admin_allowed(self, client, teacher, admin_user, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "CSV Admin Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = cr.json()["id"]

        csv_content = "管理員建立,01\n"
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("s.csv", make_csv_bytes(csv_content), "text/csv")},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 201
        assert resp.json()["created_count"] == 1

    def test_upload_csv_with_bom(self, client, teacher, school_id):
        """Excel-exported CSV files often have a UTF-8 BOM."""
        cr = client.post(
            "/api/classrooms",
            json={"name": "CSV BOM Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = cr.json()["id"]

        # Simulate Excel UTF-8 BOM CSV
        csv_content_with_bom = "\ufeffname,seat_number\n蔡小英,01\n"
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("s.csv", csv_content_with_bom.encode("utf-8-sig"), "text/csv")},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        assert resp.json()["created_count"] == 1

    def test_upload_strips_whitespace_from_fields(self, client, teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "CSV Whitespace Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = cr.json()["id"]

        csv_content = "  空格學生  ,  05  \n"
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("s.csv", make_csv_bytes(csv_content), "text/csv")},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["created_count"] == 1
        assert data["created"][0]["name"] == "空格學生"
        assert data["created"][0]["seat_number"] == "05"

    def test_upload_file_too_large_returns_413(self, client, teacher, classroom):
        """Files exceeding 1MB should be rejected."""
        classroom_id = classroom["id"]
        # Generate > 1MB of CSV content
        large_content = ("學生姓名很長的名字,001\n" * 60000).encode("utf-8")
        assert len(large_content) > 1_000_000

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("large.csv", large_content, "text/csv")},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 413

    def test_upload_wrong_column_count_rows_are_skipped(self, client, teacher, school_id):
        """Rows with wrong number of columns should be reported as errors."""
        cr = client.post(
            "/api/classrooms",
            json={"name": "CSV ColCount Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = cr.json()["id"]

        # Row 1: valid, Row 2: only 1 column, Row 3: valid
        csv_content = "正確學生,01\n只有一欄\n另一正確,03\n"
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("s.csv", make_csv_bytes(csv_content), "text/csv")},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["created_count"] == 2
        assert data["skipped_count"] == 1


# ===========================================================================
# Integration: Full CSV import flow
# ===========================================================================


class TestCsvFullFlow:
    def test_download_template_then_upload(self, client, teacher, school_id):
        """Verify that template format matches what upload endpoint accepts."""
        # 1. Download template
        template_resp = client.get(
            "/api/classrooms/csv-template",
            headers=auth_header(teacher["token"]),
        )
        assert template_resp.status_code == 200

        # 2. Create classroom
        cr = client.post(
            "/api/classrooms",
            json={"name": "CSV Full Flow", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = cr.json()["id"]

        # 3. Upload a valid CSV matching template format
        csv_content = "name,seat_number\n王大明,01\n李小美,02\n張三,03\n"
        upload_resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("students.csv", make_csv_bytes(csv_content), "text/csv")},
            headers=auth_header(teacher["token"]),
        )
        assert upload_resp.status_code == 201
        data = upload_resp.json()
        assert data["created_count"] == 3
        assert data["skipped_count"] == 0

        # 4. Verify students appear in classroom detail
        detail_resp = client.get(
            f"/api/classrooms/{classroom_id}",
            headers=auth_header(teacher["token"]),
        )
        assert detail_resp.json()["student_count"] == 3
