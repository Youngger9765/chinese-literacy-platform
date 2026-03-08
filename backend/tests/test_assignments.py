"""
Tests for the Assignment System API.

Covers:
- POST /api/classrooms/{id}/assignments  (create assignment)
- GET  /api/classrooms/{id}/assignments  (list assignments)
- GET  /api/assignments/{id}             (assignment detail)
- PATCH /api/assignments/{id}            (update assignment)
- GET  /api/assignments/my               (student: my assignments)
- POST /api/assignments/{id}/start       (student: start assignment)

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-231/backend
    python -m pytest tests/test_assignments.py -v
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
from app.models.user import Role, UserRole
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
        session.add(Role(**role_data))
    session.commit()


def _seed_school(session) -> int:
    school = School(name="Assignment Test School")
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

    # Reset rate limiter so tests aren't affected by other test state
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
    token = resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    user_id = me_resp.json()["id"]
    return {"email": email, "name": name, "token": token, "user_id": user_id}


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


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


def _make_student_role(user_id: int, school_id: int):
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == "student").first()
    user_role = UserRole(
        user_id=user_id,
        role_id=role.id,
        scope_type="school",
        scope_id=str(school_id),
    )
    db.add(user_role)
    db.commit()
    db.close()


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "asn_teacher")


@pytest.fixture(scope="module")
def other_teacher(client):
    return _register_user(client, "asn_other_teacher")


@pytest.fixture(scope="module")
def student1(client, school_id):
    user = _register_user(client, "asn_stu1")
    _make_student_role(user["user_id"], school_id)
    return user


@pytest.fixture(scope="module")
def student2(client, school_id):
    user = _register_user(client, "asn_stu2")
    _make_student_role(user["user_id"], school_id)
    return user


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "asn_admin")
    _make_admin(user["user_id"])
    return user


@pytest.fixture(scope="module")
def classroom_with_students(client, teacher, student1, student2, school_id):
    """Create a classroom and enroll 2 students. Returns classroom_id."""
    create_resp = client.post(
        "/api/classrooms",
        json={"name": "Assignment Test Classroom", "school_id": school_id},
        headers=auth_header(teacher["token"]),
    )
    assert create_resp.status_code == 201
    classroom_id = create_resp.json()["id"]

    # Enroll students
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

    return classroom_id


# A valid story_id from the YAML lesson data (L01.yml -> lesson_number=1)
VALID_STORY_ID = "1"
INVALID_STORY_ID = "99999"


# ===========================================================================
# POST /api/classrooms/{id}/assignments — Create assignment
# ===========================================================================


class TestCreateAssignment:
    def test_create_assignment_success(self, client, teacher, classroom_with_students):
        resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Read Lesson 1",
                "description": "Please complete lesson 1",
                "assignment_type": "reading",
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["classroom_id"] == classroom_with_students
        assert data["story_id"] == VALID_STORY_ID
        assert data["title"] == "Read Lesson 1"
        assert data["description"] == "Please complete lesson 1"
        assert data["assignment_type"] == "reading"
        assert data["is_active"] is True
        assert "story_title" in data
        assert "id" in data
        assert "created_at" in data

    def test_create_assignment_auto_creates_submissions(
        self, client, teacher, classroom_with_students
    ):
        resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        # 2 students enrolled -> 2 submissions
        assert data["submission_count"] == 2
        assert data["completed_count"] == 0

    def test_create_assignment_invalid_story_id(self, client, teacher, classroom_with_students):
        resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": INVALID_STORY_ID,
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_create_assignment_not_owner(
        self, client, other_teacher, classroom_with_students
    ):
        resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
            },
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_create_assignment_admin_can_create(
        self, client, admin_user, classroom_with_students
    ):
        resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Admin Created Assignment",
            },
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 201
        assert resp.json()["title"] == "Admin Created Assignment"

    def test_create_assignment_student_forbidden(
        self, client, student1, classroom_with_students
    ):
        resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
            },
            headers=auth_header(student1["token"]),
        )
        assert resp.status_code == 403

    def test_create_assignment_requires_auth(self, client, classroom_with_students):
        resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
            },
        )
        assert resp.status_code == 401


# ===========================================================================
# GET /api/classrooms/{id}/assignments — List assignments
# ===========================================================================


class TestListAssignments:
    def test_list_classroom_assignments(self, client, teacher, classroom_with_students):
        # Create an assignment first
        client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "List Test Assignment",
            },
            headers=auth_header(teacher["token"]),
        )

        resp = client.get(
            f"/api/classrooms/{classroom_with_students}/assignments",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert data["total"] >= 1
        assert len(data["items"]) >= 1

        # Check structure of each item
        item = data["items"][0]
        assert "id" in item
        assert "story_id" in item
        assert "story_title" in item
        assert "submission_count" in item
        assert "completed_count" in item

    def test_list_assignments_empty_classroom(self, client, teacher, school_id):
        # Create an empty classroom
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Empty Assignment Classroom", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        empty_classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/classrooms/{empty_classroom_id}/assignments",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["items"] == []

    def test_list_assignments_filter_active(self, client, teacher, classroom_with_students):
        resp = client.get(
            f"/api/classrooms/{classroom_with_students}/assignments?is_active=true",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        for item in data["items"]:
            assert item["is_active"] is True

    def test_list_assignments_not_owner(self, client, other_teacher, classroom_with_students):
        resp = client.get(
            f"/api/classrooms/{classroom_with_students}/assignments",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403


# ===========================================================================
# GET /api/assignments/{id} — Assignment detail
# ===========================================================================


class TestGetAssignmentDetail:
    def test_get_assignment_detail_with_submissions(
        self, client, teacher, classroom_with_students
    ):
        # Create assignment
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Detail Test Assignment",
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        # Get detail
        resp = client.get(
            f"/api/assignments/{assignment_id}",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == assignment_id
        assert data["title"] == "Detail Test Assignment"
        assert "submissions" in data
        assert len(data["submissions"]) == 2  # 2 students enrolled

        # Check submission structure
        sub = data["submissions"][0]
        assert "id" in sub
        assert "student_id" in sub
        assert "student_name" in sub
        assert "status" in sub
        assert sub["status"] == "pending"

    def test_get_assignment_detail_not_found(self, client, teacher):
        resp = client.get(
            "/api/assignments/99999",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404

    def test_get_assignment_detail_not_owner(
        self, client, teacher, other_teacher, classroom_with_students
    ):
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/assignments/{assignment_id}",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403


# ===========================================================================
# PATCH /api/assignments/{id} — Update assignment
# ===========================================================================


class TestUpdateAssignment:
    def test_update_assignment_title(self, client, teacher, classroom_with_students):
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Original Title",
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/assignments/{assignment_id}",
            json={"title": "Updated Title"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Updated Title"

    def test_update_assignment_due_date(self, client, teacher, classroom_with_students):
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/assignments/{assignment_id}",
            json={"due_date": "2026-12-31T23:59:59+08:00"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["due_date"] is not None

    def test_deactivate_assignment(self, client, teacher, classroom_with_students):
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/assignments/{assignment_id}",
            json={"is_active": False},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

    def test_update_assignment_not_owner(
        self, client, teacher, other_teacher, classroom_with_students
    ):
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/assignments/{assignment_id}",
            json={"title": "Hacked Title"},
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_update_assignment_not_found(self, client, teacher):
        resp = client.patch(
            "/api/assignments/99999",
            json={"title": "Should Fail"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404


# ===========================================================================
# GET /api/assignments/my — Student: my assignments
# ===========================================================================


class TestStudentMyAssignments:
    def test_student_get_my_assignments(
        self, client, teacher, student1, classroom_with_students
    ):
        # Create assignment (auto-creates submission for student1)
        client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Student My Test",
            },
            headers=auth_header(teacher["token"]),
        )

        resp = client.get(
            "/api/assignments/my",
            headers=auth_header(student1["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 1

        # Check response structure
        item = data[0]
        assert "assignment_id" in item
        assert "story_id" in item
        assert "story_title" in item
        assert "classroom_name" in item
        assert "status" in item
        assert item["status"] == "pending"

    def test_student_get_my_assignments_empty(self, client):
        """Student with no enrollments should see empty list."""
        new_student = _register_user(client, "asn_no_assignments")
        resp = client.get(
            "/api/assignments/my",
            headers=auth_header(new_student["token"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_student_filter_by_status(
        self, client, teacher, student1, classroom_with_students
    ):
        resp = client.get(
            "/api/assignments/my?status=pending",
            headers=auth_header(student1["token"]),
        )
        assert resp.status_code == 200
        for item in resp.json():
            assert item["status"] == "pending"

    def test_teacher_can_also_access_my_endpoint(self, client, teacher):
        """Teachers can call /assignments/my but will see only their own submissions (none)."""
        resp = client.get(
            "/api/assignments/my",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        # Teacher has no submissions, so should be empty
        assert isinstance(resp.json(), list)

    def test_my_assignments_requires_auth(self, client):
        resp = client.get("/api/assignments/my")
        assert resp.status_code == 401


# ===========================================================================
# POST /api/assignments/{id}/start — Student: start assignment
# ===========================================================================


class TestStartAssignment:
    def test_student_start_assignment(
        self, client, teacher, student1, classroom_with_students
    ):
        # Create assignment
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Start Test Assignment",
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        # Student starts it
        resp = client.post(
            f"/api/assignments/{assignment_id}/start",
            headers=auth_header(student1["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "session_id" in data
        assert data["story_id"] == VALID_STORY_ID
        assert data["status"] == "in_progress"

    def test_student_start_assignment_creates_session(
        self, client, teacher, student2, classroom_with_students
    ):
        # Create assignment
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Session Create Test",
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        # Start it
        resp = client.post(
            f"/api/assignments/{assignment_id}/start",
            headers=auth_header(student2["token"]),
        )
        assert resp.status_code == 200
        session_id = resp.json()["session_id"]
        assert session_id > 0

    def test_student_start_already_started_idempotent(
        self, client, teacher, student1, classroom_with_students
    ):
        # Create assignment
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Idempotent Start Test",
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        # Start first time
        resp1 = client.post(
            f"/api/assignments/{assignment_id}/start",
            headers=auth_header(student1["token"]),
        )
        assert resp1.status_code == 200
        session_id_1 = resp1.json()["session_id"]

        # Start second time — should be idempotent
        resp2 = client.post(
            f"/api/assignments/{assignment_id}/start",
            headers=auth_header(student1["token"]),
        )
        assert resp2.status_code == 200
        session_id_2 = resp2.json()["session_id"]
        assert session_id_1 == session_id_2  # same session

    def test_student_start_not_enrolled(self, client, teacher, school_id):
        """A student not enrolled in the classroom should get 403."""
        # Create a new classroom with no students
        create_cls_resp = client.post(
            "/api/classrooms",
            json={"name": "No Enrollment Classroom", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_cls_resp.json()["id"]

        # Create assignment
        create_asn_resp = client.post(
            f"/api/classrooms/{classroom_id}/assignments",
            json={
                "classroom_id": classroom_id,
                "story_id": VALID_STORY_ID,
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_asn_resp.json()["id"]

        # Unenrolled student tries to start
        unenrolled = _register_user(client, "asn_unenrolled")
        resp = client.post(
            f"/api/assignments/{assignment_id}/start",
            headers=auth_header(unenrolled["token"]),
        )
        assert resp.status_code == 403

    def test_start_assignment_not_found(self, client, student1):
        resp = client.post(
            "/api/assignments/99999/start",
            headers=auth_header(student1["token"]),
        )
        assert resp.status_code == 404

    def test_start_assignment_requires_auth(self, client):
        resp = client.post("/api/assignments/1/start")
        assert resp.status_code == 401


# ===========================================================================
# Edge cases
# ===========================================================================


class TestAssignmentEdgeCases:
    def test_unique_constraint_no_duplicate_submissions(
        self, client, teacher, student1, classroom_with_students
    ):
        """Creating a second assignment for the same story should still
        create separate submissions (unique is per assignment, not story)."""
        resp1 = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Unique Test 1",
            },
            headers=auth_header(teacher["token"]),
        )
        resp2 = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Unique Test 2",
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp1.status_code == 201
        assert resp2.status_code == 201

        # Both should have submissions
        detail1 = client.get(
            f"/api/assignments/{resp1.json()['id']}",
            headers=auth_header(teacher["token"]),
        )
        detail2 = client.get(
            f"/api/assignments/{resp2.json()['id']}",
            headers=auth_header(teacher["token"]),
        )
        assert detail1.json()["submission_count"] == 2
        assert detail2.json()["submission_count"] == 2

    def test_assignment_with_no_students(self, client, teacher, school_id):
        """Assignment in empty classroom should have 0 submissions."""
        create_cls_resp = client.post(
            "/api/classrooms",
            json={"name": "Empty Student Classroom", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_cls_resp.json()["id"]

        resp = client.post(
            f"/api/classrooms/{classroom_id}/assignments",
            json={
                "classroom_id": classroom_id,
                "story_id": VALID_STORY_ID,
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        assert resp.json()["submission_count"] == 0

    def test_nonexistent_classroom(self, client, teacher):
        resp = client.post(
            "/api/classrooms/99999/assignments",
            json={
                "classroom_id": 99999,
                "story_id": VALID_STORY_ID,
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404

    def test_deactivated_assignment_hidden_from_students(
        self, client, teacher, student1, classroom_with_students
    ):
        """Deactivated assignments should not appear in /assignments/my."""
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Will Be Deactivated",
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        # Deactivate
        client.patch(
            f"/api/assignments/{assignment_id}",
            json={"is_active": False},
            headers=auth_header(teacher["token"]),
        )

        # Student should not see it
        resp = client.get(
            "/api/assignments/my",
            headers=auth_header(student1["token"]),
        )
        assignment_ids = [a["assignment_id"] for a in resp.json()]
        assert assignment_id not in assignment_ids

    def test_admin_can_update_any_assignment(
        self, client, teacher, admin_user, classroom_with_students
    ):
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Admin Update Test",
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/assignments/{assignment_id}",
            json={"title": "Admin Updated"},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Admin Updated"

    def test_admin_can_view_any_assignment_detail(
        self, client, teacher, admin_user, classroom_with_students
    ):
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/assignments/{assignment_id}",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
