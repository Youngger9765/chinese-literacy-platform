"""
Tests for GET /api/teacher/classrooms/{id}/error-heatmap endpoint.

This endpoint returns a student × character error matrix, letting teachers
see at a glance which students struggle with which characters.

Response shape:
  {
    "students": [{"id": 1, "name": "..."}, ...],
    "characters": ["字", "的", ...],
    "errors": [{"student_id": 1, "character": "字", "error_count": 3}, ...]
  }

Run with:
    cd backend && python -m pytest tests/test_error_heatmap.py -v
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
from app.models.user import Role
from app.models.school import School, Classroom, ClassroomStudent
from app.models.session import LearningSession, CharacterError


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
        session.add(Role(
            name=role_data["name"],
            display_name=role_data["display_name"],
            scope_level=role_data["scope_level"],
        ))
    session.commit()


def _seed_school(session) -> int:
    school = School(name="Error Heatmap Test School")
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


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_user(client, suffix: str) -> dict:
    """Register a new user using dev-mode email verification flow."""
    unique = uuid.uuid4().hex[:8]
    email = f"eh_{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"Eh {suffix.title()} {unique}"

    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201, resp.text

    verification_token = resp.json().get("verification_token")
    assert verification_token is not None, "Expected dev-mode verification_token"
    verify_resp = client.get(f"/api/auth/verify-email?token={verification_token}")
    assert verify_resp.status_code == 200, verify_resp.text

    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json()["access_token"]

    me_resp = client.get("/api/users/me", headers=auth_header(token))
    assert me_resp.status_code == 200, me_resp.text

    return {
        "token": token,
        "id": me_resp.json()["id"],
        "email": email,
        "name": name,
    }


def _seed_classroom(teacher_id: int, school_id: int, name: str = "Error Heatmap Class") -> int:
    db = TestingSessionLocal()
    classroom = Classroom(name=name, teacher_id=teacher_id, school_id=school_id)
    db.add(classroom)
    db.commit()
    db.refresh(classroom)
    cid = classroom.id
    db.close()
    return cid


def _enroll_student(classroom_id: int, student_id: int):
    db = TestingSessionLocal()
    db.add(ClassroomStudent(classroom_id=classroom_id, student_id=student_id))
    db.commit()
    db.close()


def _seed_character_errors(student_id: int, classroom_id: int, errors: list[tuple[str, str]]):
    """errors: list of (character, error_type) tuples."""
    db = TestingSessionLocal()
    sess = LearningSession(
        student_id=student_id,
        classroom_id=classroom_id,
        story_slug="test-story",
        status="completed",
    )
    db.add(sess)
    db.flush()
    for character, error_type in errors:
        db.add(CharacterError(session_id=sess.id, character=character, error_type=error_type))
    db.commit()
    db.close()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "teacher")


@pytest.fixture(scope="module")
def other_teacher(client):
    return _register_user(client, "other_teacher")


@pytest.fixture(scope="module")
def student_a(client):
    return _register_user(client, "student_a")


@pytest.fixture(scope="module")
def student_b(client):
    return _register_user(client, "student_b")


@pytest.fixture(scope="module")
def classroom(teacher, school_id):
    return _seed_classroom(teacher["id"], school_id)


@pytest.fixture(scope="module")
def empty_classroom(teacher, school_id):
    return _seed_classroom(teacher["id"], school_id, name="Empty Error Heatmap Class")


@pytest.fixture(scope="module")
def seeded_classroom(classroom, student_a, student_b):
    """Classroom with enrolled students and character error data."""
    _enroll_student(classroom, student_a["id"])
    _enroll_student(classroom, student_b["id"])

    # student_a errors: "字" x3, "的" x1
    _seed_character_errors(student_a["id"], classroom, [
        ("字", "stroke_order"),
        ("字", "stroke_order"),
        ("字", "wrong_character"),
        ("的", "pronunciation"),
    ])

    # student_b errors: "字" x1, "學" x2
    _seed_character_errors(student_b["id"], classroom, [
        ("字", "stroke_order"),
        ("學", "stroke_order"),
        ("學", "wrong_character"),
    ])

    return classroom


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestErrorHeatmapEndpoint:
    def test_returns_correct_structure(self, client, teacher, seeded_classroom):
        """Response must have students, characters, errors keys."""
        resp = client.get(
            f"/api/teacher/classrooms/{seeded_classroom}/error-heatmap",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "students" in data
        assert "characters" in data
        assert "errors" in data

    def test_students_list(self, client, teacher, seeded_classroom, student_a, student_b):
        """Both enrolled students with errors should appear."""
        resp = client.get(
            f"/api/teacher/classrooms/{seeded_classroom}/error-heatmap",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        student_ids = [s["id"] for s in data["students"]]
        assert student_a["id"] in student_ids
        assert student_b["id"] in student_ids

    def test_characters_list_contains_error_chars(self, client, teacher, seeded_classroom):
        """Characters that had errors must appear in characters list."""
        resp = client.get(
            f"/api/teacher/classrooms/{seeded_classroom}/error-heatmap",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        chars = data["characters"]
        assert "字" in chars
        assert "的" in chars
        assert "學" in chars

    def test_error_counts_aggregated_per_student_per_character(
        self, client, teacher, seeded_classroom, student_a, student_b
    ):
        """student_a has 3 errors on '字'; student_b has 1 error on '字'."""
        resp = client.get(
            f"/api/teacher/classrooms/{seeded_classroom}/error-heatmap",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        errors = data["errors"]

        def get_count(student_id, character):
            entry = next(
                (e for e in errors if e["student_id"] == student_id and e["character"] == character),
                None,
            )
            return entry["error_count"] if entry else 0

        assert get_count(student_a["id"], "字") == 3
        assert get_count(student_a["id"], "的") == 1
        # student_a has no '學' errors — entry may be absent (count=0)
        assert get_count(student_a["id"], "學") == 0

        assert get_count(student_b["id"], "字") == 1
        assert get_count(student_b["id"], "學") == 2
        # student_b has no '的' errors — entry may be absent (count=0)
        assert get_count(student_b["id"], "的") == 0

    def test_characters_ordered_by_total_errors_descending(
        self, client, teacher, seeded_classroom
    ):
        """Characters with most total errors should appear first."""
        resp = client.get(
            f"/api/teacher/classrooms/{seeded_classroom}/error-heatmap",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        chars = data["characters"]
        # '字' has 4 total errors (3+1), '學' has 2, '的' has 1
        assert chars.index("字") < chars.index("學")
        assert chars.index("學") < chars.index("的")

    def test_empty_classroom_returns_empty_lists(self, client, teacher, empty_classroom):
        """Empty classroom should return empty lists."""
        resp = client.get(
            f"/api/teacher/classrooms/{empty_classroom}/error-heatmap",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["students"] == []
        assert data["characters"] == []
        assert data["errors"] == []

    def test_unauthenticated_returns_401_or_403(self, client, seeded_classroom):
        """No token should return 401 or 403."""
        resp = client.get(f"/api/teacher/classrooms/{seeded_classroom}/error-heatmap")
        assert resp.status_code in (401, 403)

    def test_other_teacher_forbidden(self, client, other_teacher, seeded_classroom):
        """Teacher who does not own the classroom should get 403."""
        resp = client.get(
            f"/api/teacher/classrooms/{seeded_classroom}/error-heatmap",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403
