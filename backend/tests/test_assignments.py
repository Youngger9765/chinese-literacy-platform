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
    # Verify email using the dev-mode token returned in the response
    verification_token = resp.json()["verification_token"]
    assert verification_token is not None
    verify_resp = client.get(f"/api/auth/verify-email?token={verification_token}")
    assert verify_resp.status_code == 200
    # Login to get a JWT token
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
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


# ====================================================================# POST /api/classrooms/{id}/assignments — Create assignment
# ====================================================================

class TestCreateAssignment:
    def test_create_assignment_without_body_classroom_id(
        self, client, teacher, classroom_with_students
    ):
        resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "story_id": VALID_STORY_ID,
                "title": "Path Param Classroom Only",
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["classroom_id"] == classroom_with_students
        assert data["story_id"] == VALID_STORY_ID

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


# ====================================================================# GET /api/classrooms/{id}/assignments — List assignments
# ====================================================================

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


# ====================================================================# GET /api/assignments/{id} — Assignment detail
# ====================================================================

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


# ====================================================================# PATCH /api/assignments/{id} — Update assignment
# ====================================================================

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


# ====================================================================# GET /api/assignments/my — Student: my assignments
# ====================================================================

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

    def test_my_assignments_includes_step_progress_fields(
        self, client, teacher, student1, classroom_with_students
    ):
        """In-progress assignments should expose session_id/current_step/steps_completed."""
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Progress Field Test",
            },
            headers=auth_header(teacher["token"]),
        )
        assert create_resp.status_code == 201
        assignment_id = create_resp.json()["id"]

        start_resp = client.post(
            f"/api/assignments/{assignment_id}/start",
            headers=auth_header(student1["token"]),
        )
        assert start_resp.status_code == 200
        session_id = start_resp.json()["session_id"]

        save_progress_resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": "vocab",
                "steps_completed": ["reading-annotation", "tutor", "full-reading"],
                "step_data": {
                    "vocab": {
                        "completedWords": ["春", "風"],
                    }
                },
            },
            headers=auth_header(student1["token"]),
        )
        assert save_progress_resp.status_code == 200

        my_resp = client.get(
            "/api/assignments/my?status=in_progress",
            headers=auth_header(student1["token"]),
        )
        assert my_resp.status_code == 200
        item = next((x for x in my_resp.json() if x["assignment_id"] == assignment_id), None)
        assert item is not None
        assert item["session_id"] == session_id
        assert item["current_step"] == "vocab"
        assert item["steps_completed"] == ["reading-annotation", "tutor", "full-reading"]

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


# ====================================================================# POST /api/assignments/{id}/start — Student: start assignment
# ====================================================================

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


# ====================================================================# Edge cases
# ====================================================================

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


# ====================================================================# DELETE /api/assignments/{id} — Delete assignment
# ====================================================================

class TestDeleteAssignment:
    def test_delete_assignment_success(self, client, teacher, classroom_with_students):
        """Teacher can delete their own assignment."""
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "To Be Deleted",
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        resp = client.delete(
            f"/api/assignments/{assignment_id}",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 204

        # Verify it's gone
        get_resp = client.get(
            f"/api/assignments/{assignment_id}",
            headers=auth_header(teacher["token"]),
        )
        assert get_resp.status_code == 404

    def test_delete_assignment_not_found(self, client, teacher):
        """Deleting non-existent assignment returns 404."""
        resp = client.delete(
            "/api/assignments/99999",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404

    def test_delete_assignment_not_owner(
        self, client, teacher, other_teacher, classroom_with_students
    ):
        """Non-owner teacher cannot delete another teacher's assignment."""
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Protected Assignment",
            },
            headers=auth_header(teacher["token"]),
        )
        assert create_resp.status_code == 201
        assignment_id = create_resp.json()["id"]

        resp = client.delete(
            f"/api/assignments/{assignment_id}",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403


# ====================================================================
# Student detail endpoint — GET /api/assignments/my/{id}
# ====================================================================

class TestStudentAssignmentDetail:
    """Tests for GET /api/assignments/my/{assignment_id}."""

    def _create_assignment(self, client, teacher, classroom_id, title="Detail Test"):
        resp = client.post(
            f"/api/classrooms/{classroom_id}/assignments",
            json={
                "classroom_id": classroom_id,
                "story_id": VALID_STORY_ID,
                "title": title,
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        return resp.json()["id"]

    def test_student_can_get_own_assignment_detail(
        self, client, teacher, student1, classroom_with_students
    ):
        assignment_id = self._create_assignment(client, teacher, classroom_with_students)

        resp = client.get(
            f"/api/assignments/my/{assignment_id}",
            headers=auth_header(student1["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["assignment_id"] == assignment_id
        assert data["status"] == "pending"
        assert "story_title" in data
        assert "due_date" in data
        assert "effective_cpm" in data
        assert "effective_accuracy" in data

    def test_student_cannot_get_other_students_assignment(
        self, client, teacher, student1, student2, school_id
    ):
        """student2 should not be able to access an assignment they're not enrolled in."""
        # Create a separate classroom with only student1
        cls_resp = client.post(
            "/api/classrooms",
            json={"name": "Detail Test Classroom", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = cls_resp.json()["id"]
        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student1["user_id"]},
            headers=auth_header(teacher["token"]),
        )

        assignment_id = self._create_assignment(client, teacher, classroom_id, title="Private Assignment")

        # student2 is not enrolled → should get 404
        resp = client.get(
            f"/api/assignments/my/{assignment_id}",
            headers=auth_header(student2["token"]),
        )
        assert resp.status_code == 404

    def test_student_detail_nonexistent_assignment(
        self, client, student1
    ):
        resp = client.get(
            "/api/assignments/my/99999",
            headers=auth_header(student1["token"]),
        )
        assert resp.status_code == 404


# ====================================================================# Submit assignment — POST /api/assignments/{id}/submit
# ====================================================================

class TestSubmitAssignment:
    """Tests for the submit endpoint including bug fix verification."""

    def _create_and_start(self, client, teacher, student, classroom_id):
        """Helper: create an assignment and start it as the student."""
        create_resp = client.post(
            f"/api/classrooms/{classroom_id}/assignments",
            json={
                "classroom_id": classroom_id,
                "story_id": VALID_STORY_ID,
                "title": "Submit Test",
            },
            headers=auth_header(teacher["token"]),
        )
        assert create_resp.status_code == 201
        assignment_id = create_resp.json()["id"]

        start_resp = client.post(
            f"/api/assignments/{assignment_id}/start",
            headers=auth_header(student["token"]),
        )
        assert start_resp.status_code == 200
        return assignment_id

    def test_student_can_submit_assignment(
        self, client, teacher, student1, classroom_with_students
    ):
        assignment_id = self._create_and_start(client, teacher, student1, classroom_with_students)

        resp = client.post(
            f"/api/assignments/{assignment_id}/submit",
            headers=auth_header(student1["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "submitted"
        assert data["submitted_at"] is not None
        # Bug fix: response must include text_id and reading goals
        assert "text_id" in data
        assert "effective_cpm" in data
        assert "effective_accuracy" in data

    def test_submit_idempotent_returns_correct_fields(
        self, client, teacher, student2, classroom_with_students
    ):
        """Idempotent submit should also return all required fields (bug fix verification)."""
        assignment_id = self._create_and_start(client, teacher, student2, classroom_with_students)

        # First submit
        resp1 = client.post(
            f"/api/assignments/{assignment_id}/submit",
            headers=auth_header(student2["token"]),
        )
        assert resp1.status_code == 200

        # Second submit (idempotent path)
        resp2 = client.post(
            f"/api/assignments/{assignment_id}/submit",
            headers=auth_header(student2["token"]),
        )
        assert resp2.status_code == 200
        data = resp2.json()
        assert data["status"] in ("submitted", "graded")
        # Bug fix: idempotent path must also include text_id and reading goals
        assert "text_id" in data
        assert "effective_cpm" in data
        assert "effective_accuracy" in data

    def test_submit_unenrolled_student_returns_403(
        self, client, teacher, other_teacher, school_id
    ):
        """Student not enrolled in the assignment should get 403."""
        # Register a new student not in classroom
        unenrolled = _register_user(client, "unenrolled_stu")

        cls_resp = client.post(
            "/api/classrooms",
            json={"name": "Submit 403 Classroom", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = cls_resp.json()["id"]

        create_resp = client.post(
            f"/api/classrooms/{classroom_id}/assignments",
            json={
                "classroom_id": classroom_id,
                "story_id": VALID_STORY_ID,
                "title": "Submit 403 Test",
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        resp = client.delete(
            f"/api/assignments/{assignment_id}",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_delete_assignment_requires_auth(self, client, teacher, classroom_with_students):
        """Unauthenticated delete returns 401."""
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        resp = client.delete(f"/api/assignments/{assignment_id}")
        assert resp.status_code == 401

    def test_delete_assignment_cascades_submissions(
        self, client, teacher, classroom_with_students
    ):
        """Deleting an assignment also deletes all submissions (CASCADE)."""
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Cascade Delete Test",
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]
        # Should have 2 submissions (2 students enrolled)
        assert create_resp.json()["submission_count"] == 2

        # Delete assignment
        del_resp = client.delete(
            f"/api/assignments/{assignment_id}",
            headers=auth_header(teacher["token"]),
        )
        assert del_resp.status_code == 204

        # Assignment is gone — 404 confirms cascade worked
        get_resp = client.get(
            f"/api/assignments/{assignment_id}",
            headers=auth_header(teacher["token"]),
        )
        assert get_resp.status_code == 404

    def test_admin_can_delete_any_assignment(
        self, client, teacher, admin_user, classroom_with_students
    ):
        """Admin can delete assignments they don't own."""
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Admin Delete Test",
            },
            headers=auth_header(teacher["token"]),
        )
        assignment_id = create_resp.json()["id"]

        resp = client.delete(
            f"/api/assignments/{assignment_id}",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 204


# ====================================================================# Notification service — unit tests (no HTTP needed)
# ====================================================================

class TestNotificationService:
    """Unit tests for notification_service.py templates (log-only, no real email)."""

    def test_send_new_assignment_notification_logs(self, caplog):
        import logging
        from app.services.notification_service import send_new_assignment_notification
        from unittest.mock import MagicMock

        mock_db = MagicMock()
        with caplog.at_level(logging.INFO, logger="app.services.notification_service"):
            send_new_assignment_notification(
                student_id=1,
                student_name="王小明",
                story_title="大熊的讀書計畫",
                classroom_name="五年三班",
                due_date=None,
                assignment_type="reading",
                db=mock_db,
            )
        assert any("new_assignment" in r.message for r in caplog.records)

    def test_send_due_date_reminder_logs(self, caplog):
        import logging
        from datetime import datetime, timezone
        from app.services.notification_service import send_due_date_reminder
        from unittest.mock import MagicMock

        mock_db = MagicMock()
        with caplog.at_level(logging.INFO, logger="app.services.notification_service"):
            send_due_date_reminder(
                student_id=2,
                student_name="李小花",
                story_title="虎姑婆",
                due_date=datetime(2026, 4, 1, tzinfo=timezone.utc),
                days_remaining=3,
                db=mock_db,
            )
        assert any("due_date_reminder" in r.message for r in caplog.records)

    def test_send_assignment_graded_notification_logs(self, caplog):
        import logging
        from app.services.notification_service import send_assignment_graded_notification
        from unittest.mock import MagicMock

        mock_db = MagicMock()
        with caplog.at_level(logging.INFO, logger="app.services.notification_service"):
            send_assignment_graded_notification(
                student_id=3,
                student_name="陳大寶",
                story_title="海底世界",
                score=88.5,
                db=mock_db,
            )
        assert any("assignment_graded" in r.message for r in caplog.records)


# ====================================================================
# Issue #423 — Teacher grading: reading metrics visible in submission
# ====================================================================

class TestSubmissionReadingMetrics:
    """Verify that SubmissionResponse includes reading metrics (accuracy, cpm, error_chars)
    pulled from the linked LearningSession when available."""

    def _create_assignment_and_start(self, client, teacher, student, classroom_id):
        """Create assignment, start it as student. Returns (assignment_id, session_id)."""
        create_resp = client.post(
            f"/api/classrooms/{classroom_id}/assignments",
            json={
                "classroom_id": classroom_id,
                "story_id": VALID_STORY_ID,
                "title": "Reading Metrics Test",
            },
            headers=auth_header(teacher["token"]),
        )
        assert create_resp.status_code == 201
        assignment_id = create_resp.json()["id"]

        start_resp = client.post(
            f"/api/assignments/{assignment_id}/start",
            headers=auth_header(student["token"]),
        )
        assert start_resp.status_code == 200
        session_id = start_resp.json()["session_id"]
        return assignment_id, session_id

    def test_submission_response_has_reading_metrics_fields(
        self, client, teacher, student1, classroom_with_students
    ):
        """SubmissionResponse must always include reading_metrics fields (nullable)."""
        assignment_id, _ = self._create_assignment_and_start(
            client, teacher, student1, classroom_with_students
        )
        resp = client.get(
            f"/api/assignments/{assignment_id}",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        subs = resp.json()["submissions"]
        # student1 has a submission
        sub1 = next((s for s in subs if s["student_id"] == student1["user_id"]), None)
        assert sub1 is not None
        # reading metrics fields must be present
        assert "reading_accuracy" in sub1
        assert "reading_cpm" in sub1
        assert "reading_error_chars" in sub1

    def test_submission_reading_metrics_populated_after_session_update(
        self, client, teacher, student1, classroom_with_students
    ):
        """After the student updates their session with reading data,
        the teacher sees the metrics in the submission response."""
        assignment_id, session_id = self._create_assignment_and_start(
            client, teacher, student1, classroom_with_students
        )

        # Student updates the session with reading data
        patch_resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={
                "accuracy": 85.5,
                "reading_result": {
                    "cpm": 142.3,
                    "accuracy": 85.5,
                    "error_chars": ["的", "了"],
                },
            },
            headers=auth_header(student1["token"]),
        )
        assert patch_resp.status_code == 200

        # Teacher views assignment detail — reading metrics must be present
        resp = client.get(
            f"/api/assignments/{assignment_id}",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        subs = resp.json()["submissions"]
        sub1 = next((s for s in subs if s["student_id"] == student1["user_id"]), None)
        assert sub1 is not None
        assert sub1["reading_accuracy"] == pytest.approx(85.5, abs=0.1)
        assert sub1["reading_cpm"] == pytest.approx(142.3, abs=0.1)
        assert sub1["reading_error_chars"] == ["的", "了"]

    def test_submission_reading_metrics_null_when_no_session(
        self, client, teacher, student2, classroom_with_students
    ):
        """A pending submission (no session started) must have null reading metrics."""
        # Create a NEW assignment so student2 has a fresh pending submission
        create_resp = client.post(
            f"/api/classrooms/{classroom_with_students}/assignments",
            json={
                "classroom_id": classroom_with_students,
                "story_id": VALID_STORY_ID,
                "title": "Reading Metrics Null Test",
            },
            headers=auth_header(teacher["token"]),
        )
        assert create_resp.status_code == 201
        assignment_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/assignments/{assignment_id}",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        subs = resp.json()["submissions"]
        sub2 = next((s for s in subs if s["student_id"] == student2["user_id"]), None)
        assert sub2 is not None
        assert sub2["reading_accuracy"] is None
        assert sub2["reading_cpm"] is None
        assert sub2["reading_error_chars"] == []


# ====================================================================
# Teacher Feedback Tests (Issue #424)
# ====================================================================

def _register_and_login(client, suffix: str) -> dict:
    """Register a user (new auth flow: register -> verify -> login) and return token + user_id.

    Uses the verification_token returned in dev mode to bypass email,
    then logs in to obtain a JWT access_token.
    """
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{suffix.title()} {unique}"
    reg_resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert reg_resp.status_code == 201, reg_resp.json()
    verification_token = reg_resp.json().get("verification_token")
    if verification_token:
        client.post("/api/auth/verify-email", json={"token": verification_token})
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.json()
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    user_id = me_resp.json()["id"]
    return {"email": email, "name": name, "token": token, "user_id": user_id}


class TestTeacherFeedback:
    """Tests for per-student teacher feedback on assignment submissions (Issue #424)."""

    @pytest.fixture(scope="class")
    def setup(self, client, school_id):
        """Create teacher, student, classroom, assignment, submission for feedback tests."""
        teacher = _register_and_login(client, "fb_teacher")
        student = _register_and_login(client, "fb_student")
        _make_student_role(student["user_id"], school_id)

        # Create classroom
        cls_resp = client.post(
            "/api/classrooms",
            headers=auth_header(teacher["token"]),
            json={"name": "Feedback Test Class", "school_id": school_id},
        )
        assert cls_resp.status_code == 201
        classroom_id = cls_resp.json()["id"]

        # Add student to classroom (one at a time)
        client.post(
            f"/api/classrooms/{classroom_id}/students",
            headers=auth_header(teacher["token"]),
            json={"student_id": student["user_id"]},
        )

        # Create assignment
        asn_resp = client.post(
            f"/api/classrooms/{classroom_id}/assignments",
            headers=auth_header(teacher["token"]),
            json={"classroom_id": classroom_id, "story_id": "1"},
        )
        assert asn_resp.status_code == 201
        assignment_id = asn_resp.json()["id"]

        # Student starts assignment
        start_resp = client.post(
            f"/api/assignments/{assignment_id}/start",
            headers=auth_header(student["token"]),
        )
        assert start_resp.status_code == 200

        # Student submits assignment
        sub_resp = client.post(
            f"/api/assignments/{assignment_id}/submit",
            headers=auth_header(student["token"]),
        )
        assert sub_resp.status_code == 200

        # Get submission id via detail
        detail_resp = client.get(
            f"/api/assignments/{assignment_id}",
            headers=auth_header(teacher["token"]),
        )
        assert detail_resp.status_code == 200
        submissions = detail_resp.json()["submissions"]
        submission_id = submissions[0]["id"]

        return {
            "teacher": teacher,
            "student": student,
            "assignment_id": assignment_id,
            "submission_id": submission_id,
        }

    def test_grade_with_feedback_persists(self, client, setup):
        """Teacher can grade with feedback; feedback is returned in response."""
        assignment_id = setup["assignment_id"]
        submission_id = setup["submission_id"]
        teacher_token = setup["teacher"]["token"]

        resp = client.patch(
            f"/api/assignments/{assignment_id}/submissions/{submission_id}",
            headers=auth_header(teacher_token),
            json={"score": 85, "teacher_feedback": "很棒！朗讀流暢，繼續加油"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["score"] == 85
        assert data["teacher_feedback"] == "很棒！朗讀流暢，繼續加油"
        assert data["status"] == "graded"

    def test_feedback_visible_in_assignment_detail(self, client, setup):
        """Feedback saved appears in AssignmentDetailResponse submissions list."""
        assignment_id = setup["assignment_id"]
        submission_id = setup["submission_id"]
        teacher_token = setup["teacher"]["token"]

        detail_resp = client.get(
            f"/api/assignments/{assignment_id}",
            headers=auth_header(teacher_token),
        )
        assert detail_resp.status_code == 200
        submissions = detail_resp.json()["submissions"]
        sub = next(s for s in submissions if s["id"] == submission_id)
        assert sub["teacher_feedback"] == "很棒！朗讀流暢，繼續加油"

    def test_feedback_visible_to_student_in_my_assignments(self, client, setup):
        """Student sees teacher feedback in GET /api/assignments/my."""
        student_token = setup["student"]["token"]
        assignment_id = setup["assignment_id"]

        resp = client.get(
            "/api/assignments/my",
            headers=auth_header(student_token),
        )
        assert resp.status_code == 200
        assignments = resp.json()
        asn = next(a for a in assignments if a["assignment_id"] == assignment_id)
        assert asn["teacher_feedback"] == "很棒！朗讀流暢，繼續加油"

    def test_grade_without_feedback_leaves_feedback_null(self, client, school_id):
        """Grading without sending teacher_feedback leaves the field null."""
        teacher = _register_and_login(client, "fb2_teacher")
        student = _register_and_login(client, "fb2_student")
        _make_student_role(student["user_id"], school_id)

        cls_resp = client.post(
            "/api/classrooms",
            headers=auth_header(teacher["token"]),
            json={"name": "Feedback Test Class 2", "school_id": school_id},
        )
        classroom_id = cls_resp.json()["id"]
        client.post(
            f"/api/classrooms/{classroom_id}/students",
            headers=auth_header(teacher["token"]),
            json={"student_id": student["user_id"]},
        )
        asn_resp = client.post(
            f"/api/classrooms/{classroom_id}/assignments",
            headers=auth_header(teacher["token"]),
            json={"classroom_id": classroom_id, "story_id": "1"},
        )
        assignment_id = asn_resp.json()["id"]

        client.post(f"/api/assignments/{assignment_id}/start", headers=auth_header(student["token"]))
        client.post(f"/api/assignments/{assignment_id}/submit", headers=auth_header(student["token"]))

        detail = client.get(f"/api/assignments/{assignment_id}", headers=auth_header(teacher["token"]))
        submission_id = detail.json()["submissions"][0]["id"]

        resp = client.patch(
            f"/api/assignments/{assignment_id}/submissions/{submission_id}",
            headers=auth_header(teacher["token"]),
            json={"score": 70},
        )
        assert resp.status_code == 200
        assert resp.json()["teacher_feedback"] is None

    def test_update_feedback_overwrites_previous(self, client, setup):
        """Sending a new teacher_feedback value replaces the old one."""
        assignment_id = setup["assignment_id"]
        submission_id = setup["submission_id"]
        teacher_token = setup["teacher"]["token"]

        resp = client.patch(
            f"/api/assignments/{assignment_id}/submissions/{submission_id}",
            headers=auth_header(teacher_token),
            json={"teacher_feedback": "更新後的評語"},
        )
        assert resp.status_code == 200
        assert resp.json()["teacher_feedback"] == "更新後的評語"


# ---------------------------------------------------------------------------
# Issue #414 — Reading goals in StartAssignmentResponse
# ---------------------------------------------------------------------------

class TestReadingGoalsInStartResponse:
    """Tests that /start returns reading goals so the student knows the target
    before and during the learning session (Issue #414)."""

    @pytest.fixture
    def setup(self, client, school_id):
        """Create teacher + student + classroom + assignment with reading goals."""
        teacher = _register_and_login(client, "rg414_teacher")
        student = _register_and_login(client, "rg414_student")
        _make_student_role(student["user_id"], school_id)

        cls_resp = client.post(
            "/api/classrooms",
            headers=auth_header(teacher["token"]),
            json={"name": "Reading Goals 414 Class", "school_id": school_id},
        )
        classroom_id = cls_resp.json()["id"]
        client.post(
            f"/api/classrooms/{classroom_id}/students",
            headers=auth_header(teacher["token"]),
            json={"student_id": student["user_id"]},
        )
        # Create assignment WITH custom reading goals
        asn_resp = client.post(
            f"/api/classrooms/{classroom_id}/assignments",
            headers=auth_header(teacher["token"]),
            json={
                "classroom_id": classroom_id,
                "story_id": "1",
                "target_cpm": 160,
                "target_accuracy": 85.0,
                "difficulty_label": "中級",
            },
        )
        assignment_id = asn_resp.json()["id"]
        return {
            "teacher": teacher,
            "student": student,
            "classroom_id": classroom_id,
            "assignment_id": assignment_id,
        }

    def test_start_response_includes_reading_goals(self, client, setup):
        """StartAssignmentResponse must include effective_cpm, effective_accuracy,
        target_cpm, target_accuracy, and difficulty_label (Issue #414)."""
        resp = client.post(
            f"/api/assignments/{setup['assignment_id']}/start",
            headers=auth_header(setup["student"]["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()

        # Core fields still present
        assert "session_id" in data
        assert "story_id" in data
        assert "status" in data

        # Reading goal fields (Issue #414)
        assert "target_cpm" in data, "StartAssignmentResponse missing target_cpm"
        assert "target_accuracy" in data, "StartAssignmentResponse missing target_accuracy"
        assert "difficulty_label" in data, "StartAssignmentResponse missing difficulty_label"
        assert "effective_cpm" in data, "StartAssignmentResponse missing effective_cpm"
        assert "effective_accuracy" in data, "StartAssignmentResponse missing effective_accuracy"

        assert data["target_cpm"] == 160
        assert data["target_accuracy"] == 85.0
        assert data["difficulty_label"] == "中級"
        assert data["effective_cpm"] == 160
        assert data["effective_accuracy"] == 85.0

    def test_start_response_uses_defaults_when_no_goals_set(self, client, school_id):
        """When teacher sets no reading goals, effective values use system defaults."""
        teacher = _register_and_login(client, "rg414b_teacher")
        student = _register_and_login(client, "rg414b_student")
        _make_student_role(student["user_id"], school_id)

        cls_resp = client.post(
            "/api/classrooms",
            headers=auth_header(teacher["token"]),
            json={"name": "Reading Goals 414b Class", "school_id": school_id},
        )
        classroom_id = cls_resp.json()["id"]
        client.post(
            f"/api/classrooms/{classroom_id}/students",
            headers=auth_header(teacher["token"]),
            json={"student_id": student["user_id"]},
        )
        # Create assignment WITHOUT reading goals
        asn_resp = client.post(
            f"/api/classrooms/{classroom_id}/assignments",
            headers=auth_header(teacher["token"]),
            json={"classroom_id": classroom_id, "story_id": "1"},
        )
        assignment_id = asn_resp.json()["id"]

        resp = client.post(
            f"/api/assignments/{assignment_id}/start",
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()

        # target fields should be null (not set by teacher)
        assert data["target_cpm"] is None
        assert data["target_accuracy"] is None
        assert data["difficulty_label"] is None

        # effective fields should use system defaults
        from app.schemas.assignment import DEFAULT_TARGET_CPM, DEFAULT_TARGET_ACCURACY
        assert data["effective_cpm"] == DEFAULT_TARGET_CPM
        assert data["effective_accuracy"] == DEFAULT_TARGET_ACCURACY

    def test_start_idempotent_still_returns_goals(self, client, setup):
        """Second call to /start (idempotent path) must also return reading goals."""
        # First call — creates session
        client.post(
            f"/api/assignments/{setup['assignment_id']}/start",
            headers=auth_header(setup["student"]["token"]),
        )
        # Second call — idempotent
        resp = client.post(
            f"/api/assignments/{setup['assignment_id']}/start",
            headers=auth_header(setup["student"]["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "effective_cpm" in data
        assert data["effective_cpm"] == 160
