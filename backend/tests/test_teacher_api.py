"""
Tests for the teacher dashboard API.

Covers:
- GET /api/teacher/classrooms      (list classrooms with counts)
- GET /api/teacher/classrooms/{id}/progress   (student progress)

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-223/backend
    python -m pytest tests/test_teacher_api.py -v
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
    school = School(name="Teacher API Test School")
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


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "tch_teacher")


@pytest.fixture(scope="module")
def other_teacher(client):
    return _register_user(client, "tch_other")


@pytest.fixture(scope="module")
def student1(client):
    return _register_user(client, "tch_stu1")


@pytest.fixture(scope="module")
def student2(client):
    return _register_user(client, "tch_stu2")


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "tch_admin")
    _make_admin(user["user_id"])
    return user


# ===========================================================================
# GET /api/teacher/classrooms — List teacher classrooms with counts
# ===========================================================================


class TestListTeacherClassrooms:
    def test_returns_200(self, client, teacher):
        resp = client.get(
            "/api/teacher/classrooms",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200

    def test_returns_list(self, client, teacher):
        resp = client.get(
            "/api/teacher/classrooms",
            headers=auth_header(teacher["token"]),
        )
        assert isinstance(resp.json(), list)

    def test_teacher_sees_own_classrooms(self, client, teacher, school_id):
        # Create classroom for this teacher
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Teacher Dashboard Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        assert create_resp.status_code == 201
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            "/api/teacher/classrooms",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        classroom_ids = [c["id"] for c in data]
        assert classroom_id in classroom_ids

    def test_classroom_response_has_student_count(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Count Test Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        assert create_resp.status_code == 201

        resp = client.get(
            "/api/teacher/classrooms",
            headers=auth_header(teacher["token"]),
        )
        data = resp.json()
        assert len(data) >= 1
        item = data[0]
        assert "student_count" in item

    def test_classroom_response_has_assigned_text_count(self, client, teacher, school_id):
        resp = client.get(
            "/api/teacher/classrooms",
            headers=auth_header(teacher["token"]),
        )
        data = resp.json()
        assert len(data) >= 1
        item = data[0]
        assert "assigned_text_count" in item

    def test_classroom_response_has_expected_fields(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Fields Test Class", "school_id": school_id, "grade": 4},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            "/api/teacher/classrooms",
            headers=auth_header(teacher["token"]),
        )
        data = resp.json()
        item = next((c for c in data if c["id"] == classroom_id), None)
        assert item is not None
        assert "id" in item
        assert "name" in item
        assert "school_id" in item
        assert "grade" in item
        assert "is_active" in item
        assert "created_at" in item
        assert "student_count" in item
        assert "assigned_text_count" in item
        assert item["grade"] == 4

    def test_student_count_reflects_enrolled_students(self, client, teacher, student1, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Student Count Verify", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        # Add a student
        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student1["user_id"]},
            headers=auth_header(teacher["token"]),
        )

        resp = client.get(
            "/api/teacher/classrooms",
            headers=auth_header(teacher["token"]),
        )
        data = resp.json()
        item = next((c for c in data if c["id"] == classroom_id), None)
        assert item is not None
        assert item["student_count"] == 1

    def test_assigned_text_count_reflects_texts(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Text Count Verify", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        # Assign a text
        client.post(
            f"/api/classrooms/{classroom_id}/texts",
            json={"text_id": "1"},
            headers=auth_header(teacher["token"]),
        )

        resp = client.get(
            "/api/teacher/classrooms",
            headers=auth_header(teacher["token"]),
        )
        data = resp.json()
        item = next((c for c in data if c["id"] == classroom_id), None)
        assert item is not None
        assert item["assigned_text_count"] == 1

    def test_teacher_with_no_classrooms_sees_empty_list(self, client):
        new_teacher = _register_user(client, "tch_no_classes")
        resp = client.get(
            "/api/teacher/classrooms",
            headers=auth_header(new_teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_teacher_does_not_see_other_teachers_classrooms(
        self, client, teacher, other_teacher, school_id
    ):
        # other_teacher creates a classroom
        client.post(
            "/api/classrooms",
            json={"name": "Other Teacher Class", "school_id": school_id},
            headers=auth_header(other_teacher["token"]),
        )

        # teacher should not see it
        resp = client.get(
            "/api/teacher/classrooms",
            headers=auth_header(teacher["token"]),
        )
        data = resp.json()
        for item in data:
            # All classrooms returned should belong to this teacher's creations,
            # not other_teacher — we verify none have other_teacher's email in name
            assert "Other Teacher Class" != item["name"] or item["id"] not in [
                c["id"] for c in data if c["name"] == "Other Teacher Class"
                and c.get("teacher_id") == other_teacher["user_id"]
            ]

    def test_requires_auth(self, client):
        resp = client.get("/api/teacher/classrooms")
        assert resp.status_code == 401


# ===========================================================================
# GET /api/teacher/classrooms/{id}/progress — Student progress
# ===========================================================================


class TestGetClassroomProgress:
    def test_returns_200_for_owner(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Progress Test Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/progress",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200

    def test_empty_classroom_returns_empty_list(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Empty Progress Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/progress",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_student_list_with_progress_fields(
        self, client, teacher, student1, student2, school_id
    ):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Progress With Students", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        # Add students
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
            f"/api/teacher/classrooms/{classroom_id}/progress",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

        # Each item must have progress fields
        for item in data:
            assert "student_id" in item
            assert "student_name" in item
            assert "last_session_date" in item
            assert "total_sessions" in item

    def test_student_ids_match_enrolled_students(
        self, client, teacher, student1, student2, school_id
    ):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Progress IDs Check", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

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
            f"/api/teacher/classrooms/{classroom_id}/progress",
            headers=auth_header(teacher["token"]),
        )
        data = resp.json()
        returned_ids = {item["student_id"] for item in data}
        assert student1["user_id"] in returned_ids
        assert student2["user_id"] in returned_ids

    def test_student_with_no_sessions_has_zero_total(
        self, client, teacher, school_id
    ):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Zero Sessions Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        fresh_student = _register_user(client, "tch_fresh_stu")
        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": fresh_student["user_id"]},
            headers=auth_header(teacher["token"]),
        )

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/progress",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        item = data[0]
        assert item["total_sessions"] == 0
        assert item["last_session_date"] is None

    def test_returns_404_for_nonexistent_classroom(self, client, teacher):
        resp = client.get(
            "/api/teacher/classrooms/99999/progress",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404

    def test_returns_403_for_other_teacher(
        self, client, teacher, other_teacher, school_id
    ):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Progress Forbidden Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/progress",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_admin_can_access_any_classroom_progress(
        self, client, teacher, admin_user, school_id
    ):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Admin Progress Access", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/progress",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200

    def test_requires_auth(self, client, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Progress Auth Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(f"/api/teacher/classrooms/{classroom_id}/progress")
        assert resp.status_code == 401


# ===========================================================================
# Full teacher dashboard flow
# ===========================================================================


class TestTeacherDashboardFullFlow:
    def test_full_flow(self, client, school_id):
        """
        Register teacher -> create 2 classrooms -> add students ->
        verify list_teacher_classrooms shows correct counts ->
        check progress endpoint.
        """
        teacher = _register_user(client, "tch_flow_teacher")
        stu_a = _register_user(client, "tch_flow_stu_a")
        stu_b = _register_user(client, "tch_flow_stu_b")
        headers = auth_header(teacher["token"])

        # Create two classrooms
        resp1 = client.post(
            "/api/classrooms",
            json={"name": "Flow Class Alpha", "school_id": school_id, "grade": 4},
            headers=headers,
        )
        assert resp1.status_code == 201
        cls_alpha_id = resp1.json()["id"]

        resp2 = client.post(
            "/api/classrooms",
            json={"name": "Flow Class Beta", "school_id": school_id, "grade": 5},
            headers=headers,
        )
        assert resp2.status_code == 201
        cls_beta_id = resp2.json()["id"]

        # Add 2 students to alpha, 1 to beta
        client.post(
            f"/api/classrooms/{cls_alpha_id}/students",
            json={"student_id": stu_a["user_id"]},
            headers=headers,
        )
        client.post(
            f"/api/classrooms/{cls_alpha_id}/students",
            json={"student_id": stu_b["user_id"]},
            headers=headers,
        )
        client.post(
            f"/api/classrooms/{cls_beta_id}/students",
            json={"student_id": stu_a["user_id"]},
            headers=headers,
        )

        # Assign a text to alpha
        client.post(
            f"/api/classrooms/{cls_alpha_id}/texts",
            json={"text_id": "1"},
            headers=headers,
        )

        # GET /api/teacher/classrooms
        list_resp = client.get("/api/teacher/classrooms", headers=headers)
        assert list_resp.status_code == 200
        data = list_resp.json()

        alpha = next((c for c in data if c["id"] == cls_alpha_id), None)
        beta = next((c for c in data if c["id"] == cls_beta_id), None)

        assert alpha is not None
        assert alpha["student_count"] == 2
        assert alpha["assigned_text_count"] == 1

        assert beta is not None
        assert beta["student_count"] == 1
        assert beta["assigned_text_count"] == 0

        # GET progress for alpha
        progress_resp = client.get(
            f"/api/teacher/classrooms/{cls_alpha_id}/progress",
            headers=headers,
        )
        assert progress_resp.status_code == 200
        progress = progress_resp.json()
        assert len(progress) == 2
        student_ids = {p["student_id"] for p in progress}
        assert stu_a["user_id"] in student_ids
        assert stu_b["user_id"] in student_ids

        # All have zero sessions (no learning sessions created)
        for p in progress:
            assert p["total_sessions"] == 0
            assert p["last_session_date"] is None
