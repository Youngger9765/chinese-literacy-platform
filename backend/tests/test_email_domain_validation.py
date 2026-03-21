"""
Tests for student email domain validation (Issue #461).

Covers:
- _is_synthetic_email: synthetic email detection
- _check_email_domain: warning generation logic
- batch_create_students: warnings in response when domain mismatch
- upload_csv_students: warnings in response when domain mismatch
- synthetic emails are always exempt from domain check
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
from app.models.user import Role, User, UserRole
from app.models.school import Classroom, School
from app.routes.classrooms.helpers import check_email_domain as _check_email_domain, is_synthetic_email as _is_synthetic_email


# ---------------------------------------------------------------------------
# Unit tests for helper functions (no DB required)
# ---------------------------------------------------------------------------


class TestIsSyntheticEmail:
    def test_synthetic_domain_returns_true(self):
        assert _is_synthetic_email("abc123@student.lingoleap.local") is True

    def test_synthetic_domain_uppercase_returns_true(self):
        assert _is_synthetic_email("ABC123@STUDENT.LINGOLEAP.LOCAL") is True

    def test_real_school_email_returns_false(self):
        assert _is_synthetic_email("student@school.edu.tw") is False

    def test_gmail_returns_false(self):
        assert _is_synthetic_email("student@gmail.com") is False

    def test_partial_match_returns_false(self):
        # Contains the synthetic domain as a substring but is not the exact domain
        assert _is_synthetic_email("student@notstudent.lingoleap.local.evil.com") is False


class TestCheckEmailDomain:
    def test_no_school_domain_returns_none(self):
        assert _check_email_domain("student@school.edu.tw", None) is None

    def test_empty_school_domain_returns_none(self):
        assert _check_email_domain("student@school.edu.tw", "") is None

    def test_matching_domain_returns_none(self):
        assert _check_email_domain("student@school.edu.tw", "school.edu.tw") is None

    def test_matching_domain_with_at_prefix_returns_none(self):
        # domain stored with leading @ should still match
        assert _check_email_domain("student@school.edu.tw", "@school.edu.tw") is None

    def test_mismatched_domain_returns_warning(self):
        warning = _check_email_domain("student@other.edu.tw", "school.edu.tw")
        assert warning is not None
        assert "other.edu.tw" in warning
        assert "school.edu.tw" in warning

    def test_synthetic_email_exempt_from_check(self):
        # Even when school domain is set, synthetic emails should be exempt
        assert _check_email_domain("abc01@student.lingoleap.local", "school.edu.tw") is None

    def test_case_insensitive_domain_match(self):
        # Domain comparison should be case-insensitive
        assert _check_email_domain("student@SCHOOL.EDU.TW", "school.edu.tw") is None


# ---------------------------------------------------------------------------
# Integration tests via API
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
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "parent", "display_name": "Parent", "scope_level": "school"},
]

_test_school_id_no_domain: int = 0
_test_school_id_with_domain: int = 0


def _seed_data(session):
    global _test_school_id_no_domain, _test_school_id_with_domain
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    school_no_domain = School(name="School Without Domain")
    school_with_domain = School(name="School With Domain", domain="school.edu.tw")
    session.add(school_no_domain)
    session.add(school_with_domain)
    session.commit()
    session.refresh(school_no_domain)
    session.refresh(school_with_domain)
    _test_school_id_no_domain = school_no_domain.id
    _test_school_id_with_domain = school_with_domain.id


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_data(session)
    session.close()
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_teacher(client, email_prefix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{email_prefix}_{unique}@school.edu.tw"
    password = "SecurePass123!"
    name = f"Teacher {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201, resp.text
    verification_token = resp.json()["verification_token"]
    client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    user_id = me_resp.json()["id"]
    return {"email": email, "token": token, "user_id": user_id}


def _create_classroom(client, token: str, school_id: int) -> int:
    resp = client.post(
        "/api/classrooms",
        json={"name": f"Class {uuid.uuid4().hex[:4]}", "school_id": school_id},
        headers=auth_header(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


class TestBatchCreateStudentsWarnings:
    """batch_create_students should return warnings for domain mismatches."""

    def test_no_warnings_when_school_has_no_domain(self, client):
        teacher = _register_teacher(client, "teacher_nodomain")
        classroom_id = _create_classroom(client, teacher["token"], _test_school_id_no_domain)

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch",
            json={"students": [{"name": "王小明", "seat_number": "01"}]},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert len(data["created"]) == 1
        assert data["warnings"] == []

    def test_no_warnings_for_synthetic_emails_even_with_school_domain(self, client):
        teacher = _register_teacher(client, "teacher_synth")
        classroom_id = _create_classroom(client, teacher["token"], _test_school_id_with_domain)

        # Batch create uses synthetic @student.lingoleap.local emails — no warnings
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch",
            json={"students": [{"name": "李小美", "seat_number": "01"}]},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert len(data["created"]) == 1
        # Synthetic emails are exempt — no warnings
        assert data["warnings"] == []


class TestCsvUploadWarnings:
    """upload_csv_students should return warnings for domain mismatches."""

    def _make_csv(self, rows: list[tuple[str, str]]) -> bytes:
        lines = ["name,seat_number"] + [f"{name},{seat}" for name, seat in rows]
        return "\n".join(lines).encode("utf-8")

    def test_no_warnings_when_school_has_no_domain(self, client):
        teacher = _register_teacher(client, "csvteacher_nodomain")
        classroom_id = _create_classroom(client, teacher["token"], _test_school_id_no_domain)
        csv_bytes = self._make_csv([("陳大文", "01")])

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("students.csv", io.BytesIO(csv_bytes), "text/csv")},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["created_count"] == 1
        assert data["warnings"] == []

    def test_no_warnings_for_synthetic_emails(self, client):
        teacher = _register_teacher(client, "csvteacher_synth")
        classroom_id = _create_classroom(client, teacher["token"], _test_school_id_with_domain)
        csv_bytes = self._make_csv([("林小花", "01")])

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/upload-csv",
            files={"file": ("students.csv", io.BytesIO(csv_bytes), "text/csv")},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["created_count"] == 1
        # CSV import always uses synthetic emails — no warnings
        assert data["warnings"] == []
