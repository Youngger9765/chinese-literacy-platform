"""
Tests for the student tag system.

Covers:
- GET  /api/teacher/students/{id}/tags        — list tags
- POST /api/teacher/students/{id}/tags        — add tag
- DELETE /api/teacher/students/{id}/tags/{tag_name} — remove tag
- Tags included in GET /api/teacher/classrooms/{id}/progress

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd backend
    python -m pytest tests/test_student_tags.py -v
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
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "parent", "display_name": "Parent", "scope_level": "school"},
]

_test_school_id: int = 0


def _seed_roles(session):
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    session.commit()


def _seed_school(session) -> int:
    school = School(name="Tag Test School")
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
    token = resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    user_id = me_resp.json()["id"]
    return {"email": email, "name": name, "token": token, "user_id": user_id}


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


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "tag_teacher")


@pytest.fixture(scope="module")
def other_teacher(client):
    return _register_user(client, "tag_other_tch")


@pytest.fixture(scope="module")
def student(client):
    return _register_user(client, "tag_student")


@pytest.fixture(scope="module")
def classroom_id(client, teacher, student, school_id):
    """Create a classroom, enroll the student, and return the classroom id."""
    create_resp = client.post(
        "/api/classrooms",
        json={"name": "Tag Test Classroom", "school_id": school_id},
        headers=auth_header(teacher["token"]),
    )
    assert create_resp.status_code == 201
    cid = create_resp.json()["id"]

    enroll_resp = client.post(
        f"/api/classrooms/{cid}/students",
        json={"student_id": student["user_id"]},
        headers=auth_header(teacher["token"]),
    )
    assert enroll_resp.status_code in (200, 201)
    return cid


# ===========================================================================
# GET /api/teacher/students/{id}/tags — list tags
# ===========================================================================


class TestListStudentTags:
    def test_returns_empty_list_initially(self, client, teacher, student, classroom_id):
        resp = client.get(
            f"/api/teacher/students/{student['user_id']}/tags",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_requires_auth(self, client, student, classroom_id):
        resp = client.get(f"/api/teacher/students/{student['user_id']}/tags")
        assert resp.status_code == 401

    def test_returns_403_for_non_owner_teacher(
        self, client, other_teacher, student, classroom_id
    ):
        resp = client.get(
            f"/api/teacher/students/{student['user_id']}/tags",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_returns_403_for_nonexistent_student(self, client, teacher):
        resp = client.get(
            "/api/teacher/students/99999/tags",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 403


# ===========================================================================
# POST /api/teacher/students/{id}/tags — add tag
# ===========================================================================


class TestAddStudentTag:
    def test_add_tag_returns_201(self, client, teacher, student, classroom_id):
        resp = client.post(
            f"/api/teacher/students/{student['user_id']}/tags",
            json={"tag_name": "需要關注", "color": "red"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["tag_name"] == "需要關注"
        assert data["color"] == "red"
        assert data["student_id"] == student["user_id"]
        assert data["teacher_id"] == teacher["user_id"]

    def test_add_tag_default_color_is_gray(self, client, teacher, student, classroom_id):
        resp = client.post(
            f"/api/teacher/students/{student['user_id']}/tags",
            json={"tag_name": "進步中"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        assert resp.json()["color"] == "gray"

    def test_add_duplicate_tag_returns_409(self, client, teacher, student, classroom_id):
        # "需要關注" was already added in test_add_tag_returns_201
        resp = client.post(
            f"/api/teacher/students/{student['user_id']}/tags",
            json={"tag_name": "需要關注", "color": "red"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 409

    def test_add_blank_tag_name_returns_422(self, client, teacher, student, classroom_id):
        resp = client.post(
            f"/api/teacher/students/{student['user_id']}/tags",
            json={"tag_name": "   "},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_add_tag_name_too_long_returns_422(self, client, teacher, student, classroom_id):
        long_name = "a" * 51
        resp = client.post(
            f"/api/teacher/students/{student['user_id']}/tags",
            json={"tag_name": long_name},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_requires_auth(self, client, student, classroom_id):
        resp = client.post(
            f"/api/teacher/students/{student['user_id']}/tags",
            json={"tag_name": "test"},
        )
        assert resp.status_code == 401

    def test_returns_403_for_non_owner_teacher(
        self, client, other_teacher, student, classroom_id
    ):
        resp = client.post(
            f"/api/teacher/students/{student['user_id']}/tags",
            json={"tag_name": "unauthorized"},
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403


# ===========================================================================
# DELETE /api/teacher/students/{id}/tags/{tag_name} — remove tag
# ===========================================================================


class TestRemoveStudentTag:
    def test_remove_tag_returns_204(self, client, teacher, student, classroom_id):
        # First add a tag to remove
        add_resp = client.post(
            f"/api/teacher/students/{student['user_id']}/tags",
            json={"tag_name": "閱讀困難", "color": "orange"},
            headers=auth_header(teacher["token"]),
        )
        assert add_resp.status_code == 201

        remove_resp = client.delete(
            f"/api/teacher/students/{student['user_id']}/tags/閱讀困難",
            headers=auth_header(teacher["token"]),
        )
        assert remove_resp.status_code == 204

    def test_remove_nonexistent_tag_returns_404(self, client, teacher, student, classroom_id):
        resp = client.delete(
            f"/api/teacher/students/{student['user_id']}/tags/nonexistent_tag",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404

    def test_requires_auth(self, client, student, classroom_id):
        resp = client.delete(
            f"/api/teacher/students/{student['user_id']}/tags/需要關注",
        )
        assert resp.status_code == 401

    def test_returns_403_for_non_owner_teacher(
        self, client, other_teacher, student, classroom_id
    ):
        resp = client.delete(
            f"/api/teacher/students/{student['user_id']}/tags/需要關注",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403


# ===========================================================================
# Tags included in classroom progress response
# ===========================================================================


class TestTagsInProgressResponse:
    def test_progress_response_includes_tags_field(
        self, client, teacher, classroom_id
    ):
        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/progress",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        for item in data:
            assert "tags" in item
            assert isinstance(item["tags"], list)

    def test_progress_response_includes_student_tags(
        self, client, teacher, student, classroom_id
    ):
        # Ensure student has the "需要關注" tag (added in TestAddStudentTag)
        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/progress",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        student_entry = next(
            (s for s in data if s["student_id"] == student["user_id"]), None
        )
        assert student_entry is not None
        tag_names = [t["tag_name"] for t in student_entry["tags"]]
        assert "需要關注" in tag_names


# ===========================================================================
# Full CRUD flow
# ===========================================================================


class TestTagCRUDFlow:
    def test_full_flow(self, client, school_id):
        """Register teacher + student, create classroom, add/list/remove tags."""
        teacher_data = _register_user(client, "tag_flow_tch")
        student_data = _register_user(client, "tag_flow_stu")
        headers = auth_header(teacher_data["token"])

        # Create classroom and enroll student
        cls_resp = client.post(
            "/api/classrooms",
            json={"name": "Tag Flow Class", "school_id": school_id},
            headers=headers,
        )
        assert cls_resp.status_code == 201
        cid = cls_resp.json()["id"]

        enroll = client.post(
            f"/api/classrooms/{cid}/students",
            json={"student_id": student_data["user_id"]},
            headers=headers,
        )
        assert enroll.status_code in (200, 201)

        sid = student_data["user_id"]

        # Add multiple tags
        for tag_name, color in [("資優", "blue"), ("進步中", "green")]:
            r = client.post(
                f"/api/teacher/students/{sid}/tags",
                json={"tag_name": tag_name, "color": color},
                headers=headers,
            )
            assert r.status_code == 201

        # List tags — expect 2
        list_resp = client.get(
            f"/api/teacher/students/{sid}/tags",
            headers=headers,
        )
        assert list_resp.status_code == 200
        tags = list_resp.json()
        assert len(tags) == 2
        tag_names = {t["tag_name"] for t in tags}
        assert "資優" in tag_names
        assert "進步中" in tag_names

        # Remove one tag
        del_resp = client.delete(
            f"/api/teacher/students/{sid}/tags/資優",
            headers=headers,
        )
        assert del_resp.status_code == 204

        # List again — expect 1
        list_resp2 = client.get(
            f"/api/teacher/students/{sid}/tags",
            headers=headers,
        )
        remaining = list_resp2.json()
        assert len(remaining) == 1
        assert remaining[0]["tag_name"] == "進步中"

        # Tags show in progress endpoint
        progress_resp = client.get(
            f"/api/teacher/classrooms/{cid}/progress",
            headers=headers,
        )
        assert progress_resp.status_code == 200
        progress = progress_resp.json()
        stu_entry = next(s for s in progress if s["student_id"] == sid)
        assert len(stu_entry["tags"]) == 1
        assert stu_entry["tags"][0]["tag_name"] == "進步中"
