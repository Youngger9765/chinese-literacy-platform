"""
Tests for the classroom management API.

Covers:
- POST   /api/classrooms                          (create classroom)
- GET    /api/classrooms                           (list my classrooms)
- GET    /api/classrooms/{id}                      (classroom detail)
- PATCH  /api/classrooms/{id}                      (update classroom)
- POST   /api/classrooms/{id}/students             (add student)
- DELETE /api/classrooms/{id}/students/{student_id} (remove student)
- GET    /api/classrooms/{id}/students             (list students)

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-223/backend
    python -m pytest tests/test_classrooms_api.py -v
"""

import sys
import os

# Allow running pytest from the repo root or from backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role
from app.models.school import School


# ---------------------------------------------------------------------------
# Test database setup (SQLite in-memory with StaticPool)
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
        role = Role(
            name=role_data["name"],
            display_name=role_data["display_name"],
            scope_level=role_data["scope_level"],
        )
        session.add(role)
    session.commit()


def _seed_school(session) -> int:
    """Insert a test school and return its ID."""
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
    """Create all tables, seed roles + school, override get_db, clean up at end."""
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
    """Register a user and return {email, name, token, user_id}."""
    import uuid
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
    # Get user ID from /users/me
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    user_id = me_resp.json()["id"]
    return {"email": email, "name": name, "token": token, "user_id": user_id}


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "teacher")


@pytest.fixture(scope="module")
def other_teacher(client):
    return _register_user(client, "other_teacher")


@pytest.fixture(scope="module")
def student1(client):
    return _register_user(client, "student1")


@pytest.fixture(scope="module")
def student2(client):
    return _register_user(client, "student2")


# ===========================================================================
# POST /api/classrooms — Create classroom
# ===========================================================================


class TestCreateClassroom:
    def test_create_returns_201(self, client, teacher, school_id):
        resp = client.post(
            "/api/classrooms",
            json={"name": "Math 5A", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201

    def test_create_returns_classroom_data(self, client, teacher, school_id):
        resp = client.post(
            "/api/classrooms",
            json={"name": "Science 5B", "school_id": school_id, "grade": 5},
            headers=auth_header(teacher["token"]),
        )
        data = resp.json()
        assert data["name"] == "Science 5B"
        assert data["school_id"] == school_id
        assert data["teacher_id"] == teacher["user_id"]
        assert data["grade"] == 5
        assert data["is_active"] is True
        assert data["student_count"] == 0
        assert "id" in data
        assert "created_at" in data

    def test_create_missing_name_returns_422(self, client, teacher, school_id):
        resp = client.post(
            "/api/classrooms",
            json={"school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_create_empty_name_returns_422(self, client, teacher, school_id):
        resp = client.post(
            "/api/classrooms",
            json={"name": "", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_create_requires_auth(self, client, school_id):
        resp = client.post(
            "/api/classrooms",
            json={"name": "No Auth Class", "school_id": school_id},
        )
        assert resp.status_code == 401

    def test_create_school_must_exist(self, client, teacher):
        resp = client.post(
            "/api/classrooms",
            json={"name": "Ghost School Class", "school_id": 99999},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "School not found"

    def test_create_with_grade(self, client, teacher, school_id):
        resp = client.post(
            "/api/classrooms",
            json={"name": "Grade 3 Class", "school_id": school_id, "grade": 3},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        assert resp.json()["grade"] == 3

    def test_create_without_grade(self, client, teacher, school_id):
        resp = client.post(
            "/api/classrooms",
            json={"name": "No Grade Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        assert resp.json()["grade"] is None


# ===========================================================================
# GET /api/classrooms — List my classrooms
# ===========================================================================


class TestListClassrooms:
    def test_list_returns_only_my_classrooms(self, client, teacher, other_teacher, school_id):
        # Create a classroom for teacher
        client.post(
            "/api/classrooms",
            json={"name": "Teacher List Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        # Create a classroom for other_teacher
        client.post(
            "/api/classrooms",
            json={"name": "Other Teacher Class", "school_id": school_id},
            headers=auth_header(other_teacher["token"]),
        )

        resp = client.get("/api/classrooms", headers=auth_header(other_teacher["token"]))
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        # All returned classrooms should belong to other_teacher
        for item in data["items"]:
            assert item["teacher_id"] == other_teacher["user_id"]

    def test_list_empty_for_new_teacher(self, client):
        new_teacher = _register_user(client, "empty_teacher")
        resp = client.get("/api/classrooms", headers=auth_header(new_teacher["token"]))
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["items"] == []

    def test_list_requires_auth(self, client):
        resp = client.get("/api/classrooms")
        assert resp.status_code == 401

    def test_list_returns_items_and_total(self, client, teacher, school_id):
        resp = client.get("/api/classrooms", headers=auth_header(teacher["token"]))
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)
        assert isinstance(data["total"], int)


# ===========================================================================
# GET /api/classrooms/{id} — Classroom detail
# ===========================================================================


class TestGetClassroomDetail:
    def test_get_detail_success(self, client, teacher, school_id):
        # Create a classroom
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Detail Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/classrooms/{classroom_id}",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == classroom_id
        assert data["name"] == "Detail Test"
        assert "students" in data
        assert isinstance(data["students"], list)

    def test_get_detail_404_for_nonexistent(self, client, teacher):
        resp = client.get(
            "/api/classrooms/99999",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Classroom not found"

    def test_get_detail_403_for_other_teacher(self, client, teacher, other_teacher, school_id):
        # teacher creates classroom
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Private Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        # other_teacher tries to access it
        resp = client.get(
            f"/api/classrooms/{classroom_id}",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "Not your classroom"

    def test_get_detail_requires_auth(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Auth Detail Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]
        resp = client.get(f"/api/classrooms/{classroom_id}")
        assert resp.status_code == 401


# ===========================================================================
# PATCH /api/classrooms/{id} — Update classroom
# ===========================================================================


class TestUpdateClassroom:
    def test_update_name(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Old Name", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/classrooms/{classroom_id}",
            json={"name": "New Name"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Name"

    def test_update_grade(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Grade Update", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/classrooms/{classroom_id}",
            json={"grade": 6},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["grade"] == 6

    def test_deactivate_classroom(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Deactivate Me", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/classrooms/{classroom_id}",
            json={"is_active": False},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

    def test_update_403_for_other_teacher(self, client, teacher, other_teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Update Forbidden", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/classrooms/{classroom_id}",
            json={"name": "Hacked Name"},
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_update_404_for_nonexistent(self, client, teacher):
        resp = client.patch(
            "/api/classrooms/99999",
            json={"name": "Ghost"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404


# ===========================================================================
# POST /api/classrooms/{id}/students — Add student
# ===========================================================================


class TestAddStudent:
    def test_add_student_success(self, client, teacher, student1, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Add Student Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student1["user_id"]},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["id"] == student1["user_id"]
        assert data["name"] == student1["name"]
        assert data["email"] == student1["email"]
        assert "enrolled_at" in data

    def test_add_duplicate_student_returns_409(self, client, teacher, student1, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Dup Student Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        # First add
        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student1["user_id"]},
            headers=auth_header(teacher["token"]),
        )

        # Second add - duplicate
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student1["user_id"]},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 409
        assert resp.json()["detail"] == "Student already in classroom"

    def test_add_nonexistent_student_returns_404(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Missing Student", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": 99999},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Student user not found"

    def test_add_student_403_for_other_teacher(self, client, teacher, other_teacher, student1, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Forbidden Add", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student1["user_id"]},
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_add_student_requires_auth(self, client, teacher, student1, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Auth Add Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student1["user_id"]},
        )
        assert resp.status_code == 401


# ===========================================================================
# DELETE /api/classrooms/{id}/students/{student_id} — Remove student
# ===========================================================================


class TestRemoveStudent:
    def test_remove_student_success(self, client, teacher, student1, school_id):
        # Create classroom and add student
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Remove Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student1["user_id"]},
            headers=auth_header(teacher["token"]),
        )

        resp = client.delete(
            f"/api/classrooms/{classroom_id}/students/{student1['user_id']}",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 204

    def test_remove_student_not_in_classroom_returns_404(self, client, teacher, student1, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Remove 404 Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.delete(
            f"/api/classrooms/{classroom_id}/students/{student1['user_id']}",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Student not in classroom"

    def test_remove_student_403_for_other_teacher(self, client, teacher, other_teacher, student1, school_id):
        # teacher creates classroom and adds student
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Forbidden Remove", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student1["user_id"]},
            headers=auth_header(teacher["token"]),
        )

        # other_teacher tries to remove
        resp = client.delete(
            f"/api/classrooms/{classroom_id}/students/{student1['user_id']}",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403


# ===========================================================================
# GET /api/classrooms/{id}/students — List students
# ===========================================================================


class TestListStudents:
    def test_list_students_returns_enrolled(self, client, teacher, student1, student2, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "List Students Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        # Add two students
        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student1["user_id"]},
            headers=auth_header(teacher["token"]),
        )
        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student2["user_id"]},
            headers=auth_header(teacher["token"]),
        )

        resp = client.get(
            f"/api/classrooms/{classroom_id}/students",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        student_ids = {s["id"] for s in data}
        assert student1["user_id"] in student_ids
        assert student2["user_id"] in student_ids

    def test_list_students_empty_classroom(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Empty Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/classrooms/{classroom_id}/students",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_students_403_for_other_teacher(self, client, teacher, other_teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Forbidden List", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/classrooms/{classroom_id}/students",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_list_students_requires_auth(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Auth List Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(f"/api/classrooms/{classroom_id}/students")
        assert resp.status_code == 401


# ===========================================================================
# Full flow test
# ===========================================================================


class TestFullClassroomFlow:
    def test_full_flow(self, client, school_id):
        """
        Register teacher -> create classroom -> add 2 students ->
        list students (2) -> remove 1 -> verify count (1) ->
        deactivate classroom -> verify detail.
        """
        # Register a fresh teacher
        teacher = _register_user(client, "flow_teacher")

        # Register two fresh students
        stu1 = _register_user(client, "flow_stu1")
        stu2 = _register_user(client, "flow_stu2")

        headers = auth_header(teacher["token"])

        # 1. Create classroom
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Flow Class", "school_id": school_id, "grade": 5},
            headers=headers,
        )
        assert create_resp.status_code == 201
        classroom_id = create_resp.json()["id"]
        assert create_resp.json()["student_count"] == 0

        # 2. Add student 1
        add1_resp = client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": stu1["user_id"]},
            headers=headers,
        )
        assert add1_resp.status_code == 201

        # 3. Add student 2
        add2_resp = client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": stu2["user_id"]},
            headers=headers,
        )
        assert add2_resp.status_code == 201

        # 4. List students: should be 2
        list_resp = client.get(
            f"/api/classrooms/{classroom_id}/students",
            headers=headers,
        )
        assert list_resp.status_code == 200
        assert len(list_resp.json()) == 2

        # 5. Verify student_count in classroom detail
        detail_resp = client.get(
            f"/api/classrooms/{classroom_id}",
            headers=headers,
        )
        assert detail_resp.status_code == 200
        assert detail_resp.json()["student_count"] == 2
        assert len(detail_resp.json()["students"]) == 2

        # 6. Remove student 1
        remove_resp = client.delete(
            f"/api/classrooms/{classroom_id}/students/{stu1['user_id']}",
            headers=headers,
        )
        assert remove_resp.status_code == 204

        # 7. List students: should be 1
        list_resp2 = client.get(
            f"/api/classrooms/{classroom_id}/students",
            headers=headers,
        )
        assert list_resp2.status_code == 200
        assert len(list_resp2.json()) == 1
        assert list_resp2.json()[0]["id"] == stu2["user_id"]

        # 8. Verify student_count in detail
        detail_resp2 = client.get(
            f"/api/classrooms/{classroom_id}",
            headers=headers,
        )
        assert detail_resp2.json()["student_count"] == 1

        # 9. Deactivate classroom
        deact_resp = client.patch(
            f"/api/classrooms/{classroom_id}",
            json={"is_active": False},
            headers=headers,
        )
        assert deact_resp.status_code == 200
        assert deact_resp.json()["is_active"] is False

        # 10. Verify in list
        list_classrooms_resp = client.get("/api/classrooms", headers=headers)
        classroom_in_list = next(
            (c for c in list_classrooms_resp.json()["items"] if c["id"] == classroom_id),
            None,
        )
        assert classroom_in_list is not None
        assert classroom_in_list["is_active"] is False


# ===========================================================================
# GET /api/classrooms/my-enrollments — Student enrolled classrooms (Issue #462)
# ===========================================================================


class TestMyEnrollments:
    """Tests for GET /api/classrooms/my-enrollments.

    Covers the auto-navigation flow: student logs in → system fetches their
    classrooms → frontend auto-navigates if exactly 1 active classroom.
    """

    def test_unauthenticated_returns_401(self, client):
        resp = client.get("/api/classrooms/my-enrollments")
        assert resp.status_code == 401

    def test_student_with_no_classrooms_returns_empty_list(self, client, school_id):
        """A brand-new student not enrolled in any classroom gets an empty list."""
        lonely = _register_user(client, "lonely_student")
        resp = client.get(
            "/api/classrooms/my-enrollments",
            headers=auth_header(lonely["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["classrooms"] == []

    def test_student_enrolled_in_one_classroom(self, client, school_id):
        """Student enrolled in exactly 1 classroom: list returns that classroom with teacher info."""
        teacher = _register_user(client, "enroll_teacher_single")
        student = _register_user(client, "enroll_student_single")

        # Teacher creates classroom
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "My Enrollment Class", "school_id": school_id, "grade": 4},
            headers=auth_header(teacher["token"]),
        )
        assert create_resp.status_code == 201
        classroom_id = create_resp.json()["id"]

        # Teacher adds student
        add_resp = client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student["user_id"]},
            headers=auth_header(teacher["token"]),
        )
        assert add_resp.status_code == 201

        # Student fetches their enrollments
        resp = client.get(
            "/api/classrooms/my-enrollments",
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert len(data["classrooms"]) == 1

        classroom = data["classrooms"][0]
        assert classroom["id"] == classroom_id
        assert classroom["name"] == "My Enrollment Class"
        assert classroom["grade"] == 4
        assert classroom["teacher_id"] == teacher["user_id"]
        assert classroom["teacher_name"] == teacher["name"]
        assert classroom["is_active"] is True
        assert "enrolled_at" in classroom

    def test_student_enrolled_in_multiple_classrooms(self, client, school_id):
        """Student enrolled in 2 classrooms: list returns both."""
        teacher_a = _register_user(client, "multi_teacher_a")
        teacher_b = _register_user(client, "multi_teacher_b")
        student = _register_user(client, "multi_student")

        # Create two classrooms
        class_a_id = client.post(
            "/api/classrooms",
            json={"name": "Multi Class A", "school_id": school_id},
            headers=auth_header(teacher_a["token"]),
        ).json()["id"]

        class_b_id = client.post(
            "/api/classrooms",
            json={"name": "Multi Class B", "school_id": school_id},
            headers=auth_header(teacher_b["token"]),
        ).json()["id"]

        # Enroll student in both
        client.post(
            f"/api/classrooms/{class_a_id}/students",
            json={"student_id": student["user_id"]},
            headers=auth_header(teacher_a["token"]),
        )
        client.post(
            f"/api/classrooms/{class_b_id}/students",
            json={"student_id": student["user_id"]},
            headers=auth_header(teacher_b["token"]),
        )

        resp = client.get(
            "/api/classrooms/my-enrollments",
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert len(data["classrooms"]) == 2

        names = {c["name"] for c in data["classrooms"]}
        assert "Multi Class A" in names
        assert "Multi Class B" in names

    def test_enrollments_scoped_to_current_student(self, client, school_id):
        """A student does NOT see classrooms belonging to other students."""
        teacher = _register_user(client, "scope_teacher")
        student_a = _register_user(client, "scope_student_a")
        student_b = _register_user(client, "scope_student_b")

        # Create classroom, enroll only student_a
        classroom_id = client.post(
            "/api/classrooms",
            json={"name": "Scoped Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        ).json()["id"]

        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student_a["user_id"]},
            headers=auth_header(teacher["token"]),
        )

        # student_b has no enrollments — should see empty list
        resp_b = client.get(
            "/api/classrooms/my-enrollments",
            headers=auth_header(student_b["token"]),
        )
        assert resp_b.status_code == 200
        assert resp_b.json()["total"] == 0

        # student_a sees exactly 1 classroom
        resp_a = client.get(
            "/api/classrooms/my-enrollments",
            headers=auth_header(student_a["token"]),
        )
        assert resp_a.status_code == 200
        assert resp_a.json()["total"] == 1
        assert resp_a.json()["classrooms"][0]["id"] == classroom_id

    def test_inactive_classroom_still_returned(self, client, school_id):
        """Inactive classrooms are still included — frontend handles is_active filtering."""
        teacher = _register_user(client, "inactive_teacher")
        student = _register_user(client, "inactive_student")

        classroom_id = client.post(
            "/api/classrooms",
            json={"name": "Inactive Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        ).json()["id"]

        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student["user_id"]},
            headers=auth_header(teacher["token"]),
        )

        # Deactivate the classroom
        client.patch(
            f"/api/classrooms/{classroom_id}",
            json={"is_active": False},
            headers=auth_header(teacher["token"]),
        )

        resp = client.get(
            "/api/classrooms/my-enrollments",
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["classrooms"][0]["is_active"] is False
