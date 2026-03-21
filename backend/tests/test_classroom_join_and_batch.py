"""
Tests for classroom join code, batch student creation, and student search APIs.

Covers:
- POST   /api/classrooms                              (join_code auto-generated)
- POST   /api/classrooms/{id}/regenerate-code          (regenerate join code)
- POST   /api/classrooms/join                          (join by code)
- POST   /api/classrooms/{id}/students/batch           (batch create students)
- POST   /api/classrooms/{id}/students/search          (search students)
- POST   /api/schools                                  (join_code auto-generated)
- POST   /api/schools/{id}/regenerate-code             (regenerate school join code)

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-223/backend
    python -m pytest tests/test_classroom_join_and_batch.py -v
"""

import sys
import os
import uuid
import re

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
    school = School(name="Test School")
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
    verification_token = resp.json()["verification_token"]
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


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "jb_teacher")


@pytest.fixture(scope="module")
def other_teacher(client):
    return _register_user(client, "jb_other_teacher")


@pytest.fixture(scope="module")
def student_user(client):
    return _register_user(client, "jb_student")


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "jb_admin")
    return _make_admin(user)


# ===========================================================================
# Task 1: Classroom Join Code
# ===========================================================================


class TestClassroomJoinCode:
    """Test that classrooms get join codes on creation."""

    def test_create_classroom_has_join_code(self, client, teacher, school_id):
        resp = client.post(
            "/api/classrooms",
            json={"name": "JoinCode Test 1", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "join_code" in data
        assert data["join_code"] is not None
        assert len(data["join_code"]) == 6
        # Should be uppercase alphanumeric
        assert re.match(r"^[A-Z0-9]{6}$", data["join_code"])

    def test_each_classroom_gets_unique_code(self, client, teacher, school_id):
        codes = set()
        for i in range(5):
            resp = client.post(
                "/api/classrooms",
                json={"name": f"Unique Code {i}", "school_id": school_id},
                headers=auth_header(teacher["token"]),
            )
            assert resp.status_code == 201
            codes.add(resp.json()["join_code"])
        assert len(codes) == 5  # All unique

    def test_join_code_in_detail_response(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Detail JoinCode", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]
        join_code = create_resp.json()["join_code"]

        detail_resp = client.get(
            f"/api/classrooms/{classroom_id}",
            headers=auth_header(teacher["token"]),
        )
        assert detail_resp.status_code == 200
        assert detail_resp.json()["join_code"] == join_code

    def test_join_code_in_list_response(self, client, teacher, school_id):
        resp = client.get(
            "/api/classrooms",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        for item in resp.json()["items"]:
            assert "join_code" in item


# ===========================================================================
# POST /api/classrooms/{id}/regenerate-code
# ===========================================================================


class TestRegenerateClassroomCode:
    def test_regenerate_returns_new_code(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Regen Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]
        old_code = create_resp.json()["join_code"]

        regen_resp = client.post(
            f"/api/classrooms/{classroom_id}/regenerate-code",
            headers=auth_header(teacher["token"]),
        )
        assert regen_resp.status_code == 200
        new_code = regen_resp.json()["join_code"]
        assert new_code is not None
        assert len(new_code) == 6
        assert new_code != old_code

    def test_regenerate_requires_auth(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Regen Auth Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.post(f"/api/classrooms/{classroom_id}/regenerate-code")
        assert resp.status_code == 401

    def test_regenerate_403_for_other_teacher(self, client, teacher, other_teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Regen 403", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/classrooms/{classroom_id}/regenerate-code",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_regenerate_allowed_for_admin(self, client, teacher, admin_user, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Regen Admin", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/classrooms/{classroom_id}/regenerate-code",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200

    def test_regenerate_404_nonexistent(self, client, teacher):
        resp = client.post(
            "/api/classrooms/99999/regenerate-code",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404


# ===========================================================================
# POST /api/classrooms/join
# ===========================================================================


class TestJoinClassroomByCode:
    def test_join_success(self, client, teacher, student_user, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Join Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        join_code = create_resp.json()["join_code"]
        classroom_id = create_resp.json()["id"]

        join_resp = client.post(
            "/api/classrooms/join",
            json={"join_code": join_code},
            headers=auth_header(student_user["token"]),
        )
        assert join_resp.status_code == 200
        assert join_resp.json()["id"] == classroom_id
        assert join_resp.json()["student_count"] == 1

    def test_join_case_insensitive(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Case Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        join_code = create_resp.json()["join_code"]

        joiner = _register_user(client, "case_joiner")
        join_resp = client.post(
            "/api/classrooms/join",
            json={"join_code": join_code.lower()},
            headers=auth_header(joiner["token"]),
        )
        assert join_resp.status_code == 200

    def test_join_invalid_code_returns_404(self, client, student_user):
        resp = client.post(
            "/api/classrooms/join",
            json={"join_code": "XXXXXX"},
            headers=auth_header(student_user["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Invalid join code"

    def test_join_duplicate_returns_409(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Dup Join", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        join_code = create_resp.json()["join_code"]

        joiner = _register_user(client, "dup_joiner")
        # First join
        resp1 = client.post(
            "/api/classrooms/join",
            json={"join_code": join_code},
            headers=auth_header(joiner["token"]),
        )
        assert resp1.status_code == 200

        # Second join - duplicate
        resp2 = client.post(
            "/api/classrooms/join",
            json={"join_code": join_code},
            headers=auth_header(joiner["token"]),
        )
        assert resp2.status_code == 409
        assert resp2.json()["detail"] == "Already enrolled in this classroom"

    def test_join_requires_auth(self, client):
        resp = client.post(
            "/api/classrooms/join",
            json={"join_code": "ABC123"},
        )
        assert resp.status_code == 401

    def test_join_empty_code_returns_422(self, client, student_user):
        resp = client.post(
            "/api/classrooms/join",
            json={"join_code": ""},
            headers=auth_header(student_user["token"]),
        )
        assert resp.status_code == 422


# ===========================================================================
# Task 2: Batch Student Creation
# ===========================================================================


class TestBatchStudentCreation:
    def test_batch_create_success(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Batch Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]
        join_code = create_resp.json()["join_code"]

        batch_resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch",
            json={
                "students": [
                    {"name": "Alice", "seat_number": "01"},
                    {"name": "Bob", "seat_number": "02"},
                    {"name": "Charlie", "seat_number": "03"},
                ]
            },
            headers=auth_header(teacher["token"]),
        )
        assert batch_resp.status_code == 201
        data = batch_resp.json()
        assert len(data["created"]) == 3
        assert len(data["errors"]) == 0

        # Check each created student has expected fields
        for student in data["created"]:
            assert "name" in student
            assert "seat_number" in student
            assert "username" in student
            assert "password" in student
            assert "user_id" in student
            assert len(student["password"]) == 8
            assert student["username"].startswith(join_code)

    def test_batch_create_students_are_enrolled(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Batch Enroll Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        client.post(
            f"/api/classrooms/{classroom_id}/students/batch",
            json={
                "students": [
                    {"name": "Enrolled1", "seat_number": "01"},
                    {"name": "Enrolled2", "seat_number": "02"},
                ]
            },
            headers=auth_header(teacher["token"]),
        )

        # Verify enrollment via student list
        list_resp = client.get(
            f"/api/classrooms/{classroom_id}/students",
            headers=auth_header(teacher["token"]),
        )
        assert list_resp.status_code == 200
        assert len(list_resp.json()) == 2
        names = {s["name"] for s in list_resp.json()}
        assert "Enrolled1" in names
        assert "Enrolled2" in names

    def test_batch_create_generates_valid_credentials(self, client, teacher, school_id):
        """Verify batch-created students have proper username/password format."""
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Batch Creds Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]
        join_code = create_resp.json()["join_code"]

        batch_resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch",
            json={
                "students": [
                    {"name": "CredTest", "seat_number": "99"},
                ]
            },
            headers=auth_header(teacher["token"]),
        )
        created = batch_resp.json()["created"][0]

        # Verify username format: {join_code}{seat_number}
        assert created["username"] == f"{join_code}99"
        # Verify password is 8-char uppercase+digits
        assert len(created["password"]) == 8
        assert re.match(r"^[A-Z0-9]{8}$", created["password"])
        # Verify user_id is set
        assert created["user_id"] > 0

    def test_batch_create_duplicate_seat_number(self, client, teacher, school_id):
        """Same seat number in same classroom creates duplicate email -> error."""
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Batch Dup Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        # First batch
        client.post(
            f"/api/classrooms/{classroom_id}/students/batch",
            json={
                "students": [{"name": "First", "seat_number": "01"}]
            },
            headers=auth_header(teacher["token"]),
        )

        # Second batch with same seat number
        batch_resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch",
            json={
                "students": [{"name": "Duplicate", "seat_number": "01"}]
            },
            headers=auth_header(teacher["token"]),
        )
        assert batch_resp.status_code == 201
        data = batch_resp.json()
        assert len(data["created"]) == 0
        assert len(data["errors"]) == 1
        assert "already exists" in data["errors"][0]["error"]

    def test_batch_create_403_for_other_teacher(self, client, teacher, other_teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Batch 403", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch",
            json={
                "students": [{"name": "Forbidden", "seat_number": "01"}]
            },
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_batch_create_requires_auth(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Batch Auth", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch",
            json={
                "students": [{"name": "NoAuth", "seat_number": "01"}]
            },
        )
        assert resp.status_code == 401

    def test_batch_create_empty_list_returns_422(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Batch Empty", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch",
            json={"students": []},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_batch_create_admin_allowed(self, client, teacher, admin_user, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Batch Admin", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch",
            json={
                "students": [{"name": "AdminCreated", "seat_number": "01"}]
            },
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 201
        assert len(resp.json()["created"]) == 1


# ===========================================================================
# Task 3: School Join Code
# ===========================================================================


class TestSchoolJoinCode:
    def test_create_school_has_join_code(self, client, admin_user):
        resp = client.post(
            "/api/schools",
            json={"name": "School JoinCode Test"},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "join_code" in data
        assert data["join_code"] is not None
        assert len(data["join_code"]) == 8
        assert re.match(r"^[A-Z0-9]{8}$", data["join_code"])

    def test_regenerate_school_code(self, client, admin_user):
        create_resp = client.post(
            "/api/schools",
            json={"name": "School Regen Test"},
            headers=auth_header(admin_user["token"]),
        )
        school_id = create_resp.json()["id"]
        old_code = create_resp.json()["join_code"]

        regen_resp = client.post(
            f"/api/schools/{school_id}/regenerate-code",
            headers=auth_header(admin_user["token"]),
        )
        assert regen_resp.status_code == 200
        new_code = regen_resp.json()["join_code"]
        assert new_code is not None
        assert len(new_code) == 8
        assert new_code != old_code

    def test_regenerate_school_code_requires_admin(self, client, admin_user):
        create_resp = client.post(
            "/api/schools",
            json={"name": "School Regen Forbidden"},
            headers=auth_header(admin_user["token"]),
        )
        school_id = create_resp.json()["id"]

        # Non-admin user
        regular = _register_user(client, "non_admin_regen")
        resp = client.post(
            f"/api/schools/{school_id}/regenerate-code",
            headers=auth_header(regular["token"]),
        )
        assert resp.status_code == 403

    def test_regenerate_school_code_404(self, client, admin_user):
        resp = client.post(
            "/api/schools/99999/regenerate-code",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 404

    def test_regenerate_school_code_requires_auth(self, client, admin_user):
        create_resp = client.post(
            "/api/schools",
            json={"name": "School Regen Auth"},
            headers=auth_header(admin_user["token"]),
        )
        school_id = create_resp.json()["id"]

        resp = client.post(f"/api/schools/{school_id}/regenerate-code")
        assert resp.status_code == 401

    def test_school_join_code_in_get_response(self, client, admin_user):
        create_resp = client.post(
            "/api/schools",
            json={"name": "School Get Code"},
            headers=auth_header(admin_user["token"]),
        )
        school_id = create_resp.json()["id"]
        join_code = create_resp.json()["join_code"]

        get_resp = client.get(
            f"/api/schools/{school_id}",
            headers=auth_header(admin_user["token"]),
        )
        assert get_resp.status_code == 200
        assert get_resp.json()["join_code"] == join_code


# ===========================================================================
# Task 4: Student Search
# ===========================================================================


class TestStudentSearch:
    def test_search_by_name(self, client, teacher, school_id):
        # Create classroom
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Search Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        # Register a searchable user
        searchable = _register_user(client, "searchable_user")

        # Search by partial name
        search_resp = client.post(
            f"/api/classrooms/{classroom_id}/students/search",
            json={"query": "Searchable"},
            headers=auth_header(teacher["token"]),
        )
        assert search_resp.status_code == 200
        results = search_resp.json()
        assert len(results) >= 1
        found_ids = {r["id"] for r in results}
        assert searchable["user_id"] in found_ids

    def test_search_excludes_enrolled(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Search Exclude", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        # Register and enroll a student
        enrolled = _register_user(client, "enrolled_search")
        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": enrolled["user_id"]},
            headers=auth_header(teacher["token"]),
        )

        # Search should NOT include enrolled student
        search_resp = client.post(
            f"/api/classrooms/{classroom_id}/students/search",
            json={"query": "Enrolled_search"},
            headers=auth_header(teacher["token"]),
        )
        assert search_resp.status_code == 200
        found_ids = {r["id"] for r in search_resp.json()}
        assert enrolled["user_id"] not in found_ids

    def test_search_by_email(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Search Email", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        searchable = _register_user(client, "email_search_user")

        search_resp = client.post(
            f"/api/classrooms/{classroom_id}/students/search",
            json={"query": searchable["email"].split("@")[0]},
            headers=auth_header(teacher["token"]),
        )
        assert search_resp.status_code == 200
        found_ids = {r["id"] for r in search_resp.json()}
        assert searchable["user_id"] in found_ids

    def test_search_403_for_other_teacher(self, client, teacher, other_teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Search 403", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/search",
            json={"query": "test"},
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_search_requires_auth(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Search Auth", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/search",
            json={"query": "test"},
        )
        assert resp.status_code == 401

    def test_search_returns_max_10(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Search Limit", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        # The search should return at most 10 results
        search_resp = client.post(
            f"/api/classrooms/{classroom_id}/students/search",
            json={"query": "@"},  # Matches many emails
            headers=auth_header(teacher["token"]),
        )
        assert search_resp.status_code == 200
        assert len(search_resp.json()) <= 10

    def test_search_empty_query_returns_422(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Search Empty", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/search",
            json={"query": ""},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422


# ===========================================================================
# Full flow integration test
# ===========================================================================


class TestJoinCodeFullFlow:
    """End-to-end: create classroom -> batch students -> join by code -> search."""

    def test_full_flow(self, client, school_id):
        # 1. Register teacher
        teacher = _register_user(client, "flow2_teacher")
        headers = auth_header(teacher["token"])

        # 2. Create classroom (auto-generates join code)
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Full Flow Class", "school_id": school_id, "grade": 5},
            headers=headers,
        )
        assert create_resp.status_code == 201
        classroom_id = create_resp.json()["id"]
        join_code = create_resp.json()["join_code"]
        assert join_code is not None

        # 3. Batch create 2 students
        batch_resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch",
            json={
                "students": [
                    {"name": "FlowStudent1", "seat_number": "01"},
                    {"name": "FlowStudent2", "seat_number": "02"},
                ]
            },
            headers=headers,
        )
        assert batch_resp.status_code == 201
        assert len(batch_resp.json()["created"]) == 2

        # 4. Verify students are enrolled
        detail_resp = client.get(
            f"/api/classrooms/{classroom_id}",
            headers=headers,
        )
        assert detail_resp.json()["student_count"] == 2

        # 5. Another user joins via code
        joiner = _register_user(client, "flow2_joiner")
        join_resp = client.post(
            "/api/classrooms/join",
            json={"join_code": join_code},
            headers=auth_header(joiner["token"]),
        )
        assert join_resp.status_code == 200
        assert join_resp.json()["student_count"] == 3

        # 6. Regenerate code
        regen_resp = client.post(
            f"/api/classrooms/{classroom_id}/regenerate-code",
            headers=headers,
        )
        assert regen_resp.status_code == 200
        new_code = regen_resp.json()["join_code"]
        assert new_code != join_code

        # 7. Old code no longer works
        another = _register_user(client, "flow2_another")
        old_join_resp = client.post(
            "/api/classrooms/join",
            json={"join_code": join_code},
            headers=auth_header(another["token"]),
        )
        assert old_join_resp.status_code == 404

        # 8. New code works
        new_join_resp = client.post(
            "/api/classrooms/join",
            json={"join_code": new_code},
            headers=auth_header(another["token"]),
        )
        assert new_join_resp.status_code == 200

        # 9. Search for students not in classroom
        not_enrolled = _register_user(client, "flow2_searchable")
        search_resp = client.post(
            f"/api/classrooms/{classroom_id}/students/search",
            json={"query": "flow2_searchable"},
            headers=headers,
        )
        assert search_resp.status_code == 200
        found_ids = {r["id"] for r in search_resp.json()}
        assert not_enrolled["user_id"] in found_ids

        # 10. Search excludes enrolled users
        search_enrolled_resp = client.post(
            f"/api/classrooms/{classroom_id}/students/search",
            json={"query": "FlowStudent1"},
            headers=headers,
        )
        assert search_enrolled_resp.status_code == 200
        enrolled_names = {r["name"] for r in search_enrolled_resp.json()}
        assert "FlowStudent1" not in enrolled_names
