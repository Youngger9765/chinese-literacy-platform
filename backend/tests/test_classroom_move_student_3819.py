"""
Tests for moving a student between two of the SAME teacher's classrooms (#3819).

Covers:
- POST /api/classrooms/{from_classroom_id}/students/{student_id}/move

Uses SQLite in-memory DB, following the same pattern as test_classrooms_api.py.

Run with:
    cd backend && python -m pytest tests/test_classroom_move_student_3819.py -v
"""

import sys
import os

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
from app.models.school import Classroom, ClassroomStudent, School
from app.models.assignment import Assignment, AssignmentSubmission

from _school_student import grant_school_student_role

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
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]


def _seed_roles(session):
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    session.commit()


def _seed_school(session, name="Test School") -> int:
    school = School(name=name)
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


_school_a_id: int = 0
_school_b_id: int = 0


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _school_a_id, _school_b_id
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    _school_a_id = _seed_school(session, "School A")
    _school_b_id = _seed_school(session, "School B (other)")
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


def _register_user(client, suffix: str) -> dict:
    import uuid
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{suffix.title()} {unique}"
    resp = client.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    assert resp.status_code == 201
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    user_id = me_resp.json()["id"]
    return {"email": email, "name": name, "token": token, "user_id": user_id}


def _register_teacher(client, suffix: str, school_id: int) -> dict:
    user = _register_user(client, suffix)
    db = TestingSessionLocal()
    try:
        trole = db.query(Role).filter(Role.name == "teacher").first()
        db.add(UserRole(user_id=user["user_id"], role_id=trole.id, scope_type="school", scope_id=str(school_id)))
        db.commit()
    finally:
        db.close()
    return user


def _register_student(client, suffix: str, school_id: int) -> dict:
    user = _register_user(client, suffix)
    grant_school_student_role(TestingSessionLocal, user["user_id"], school_id=school_id)
    return user


def _create_classroom(client, teacher_token, name, school_id):
    resp = client.post(
        "/api/classrooms",
        json={"name": name, "school_id": school_id},
        headers=auth_header(teacher_token),
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def _create_classroom_direct(teacher_id, name, school_id) -> int:
    """Insert a Classroom row directly, bypassing the create-classroom API's
    same-school-membership check — used only to simulate a teacher who
    (for whatever legitimate reason) already owns a classroom in a school
    they are not separately registered as a member of, so the /move
    endpoint's OWN cross-school guard is what gets exercised, not the
    create-classroom endpoint's unrelated membership check."""
    db = TestingSessionLocal()
    try:
        classroom = Classroom(name=name, school_id=school_id, teacher_id=teacher_id)
        db.add(classroom)
        db.commit()
        db.refresh(classroom)
        return classroom.id
    finally:
        db.close()


def _add_student(client, teacher_token, classroom_id, student_id):
    resp = client.post(
        f"/api/classrooms/{classroom_id}/students",
        json={"student_id": student_id},
        headers=auth_header(teacher_token),
    )
    assert resp.status_code == 201, resp.text
    return resp


@pytest.fixture
def teacher(client):
    return _register_teacher(client, "move_teacher", _school_a_id)


@pytest.fixture
def other_teacher(client):
    return _register_teacher(client, "move_other_teacher", _school_a_id)


@pytest.fixture
def student(client):
    return _register_student(client, "move_student", _school_a_id)


class TestMoveStudent:
    def test_move_removes_from_source_and_adds_to_destination(self, client, teacher, student):
        class_a = _create_classroom(client, teacher["token"], "Move Source A", _school_a_id)
        class_b = _create_classroom(client, teacher["token"], "Move Dest B", _school_a_id)
        _add_student(client, teacher["token"], class_a, student["user_id"])

        resp = client.post(
            f"/api/classrooms/{class_a}/students/{student['user_id']}/move",
            json={"to_classroom_id": class_b},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["student_id"] == student["user_id"]
        assert body["from_classroom_id"] == class_a
        assert body["to_classroom_id"] == class_b
        assert "enrolled_at" in body

        # Source no longer lists the student
        a_students = client.get(f"/api/classrooms/{class_a}/students", headers=auth_header(teacher["token"])).json()
        assert student["user_id"] not in [s["id"] for s in a_students]

        # Destination lists the student
        b_students = client.get(f"/api/classrooms/{class_b}/students", headers=auth_header(teacher["token"])).json()
        assert student["user_id"] in [s["id"] for s in b_students]

    def test_move_preserves_assignment_submissions(self, client, teacher, student):
        """AC2: existing submissions tied to the source classroom's assignment
        must survive the move untouched (learning history is never deleted)."""
        class_a = _create_classroom(client, teacher["token"], "Move Source A2", _school_a_id)
        class_b = _create_classroom(client, teacher["token"], "Move Dest B2", _school_a_id)
        _add_student(client, teacher["token"], class_a, student["user_id"])

        db = TestingSessionLocal()
        try:
            assignment = Assignment(
                classroom_id=class_a,
                teacher_id=teacher["user_id"],
                title="Pre-move assignment",
                story_id="1",
                is_active=True,
                assigned_to_all=True,
            )
            db.add(assignment)
            db.flush()
            submission = AssignmentSubmission(
                assignment_id=assignment.id,
                student_id=student["user_id"],
                status="completed",
            )
            db.add(submission)
            db.commit()
            submission_id = submission.id
        finally:
            db.close()

        resp = client.post(
            f"/api/classrooms/{class_a}/students/{student['user_id']}/move",
            json={"to_classroom_id": class_b},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text

        db = TestingSessionLocal()
        try:
            still_there = db.query(AssignmentSubmission).filter(AssignmentSubmission.id == submission_id).first()
            assert still_there is not None
            assert still_there.status == "completed"
        finally:
            db.close()

    def test_move_to_other_teachers_classroom_is_403(self, client, teacher, other_teacher, student):
        class_a = _create_classroom(client, teacher["token"], "Move Source A3", _school_a_id)
        class_other = _create_classroom(client, other_teacher["token"], "Other Teacher Class", _school_a_id)
        _add_student(client, teacher["token"], class_a, student["user_id"])

        resp = client.post(
            f"/api/classrooms/{class_a}/students/{student['user_id']}/move",
            json={"to_classroom_id": class_other},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 403

        # Student still in A, not added to the other teacher's class
        a_students = client.get(f"/api/classrooms/{class_a}/students", headers=auth_header(teacher["token"])).json()
        assert student["user_id"] in [s["id"] for s in a_students]

    def test_move_cross_school_is_400(self, client, teacher, student):
        class_a = _create_classroom(client, teacher["token"], "Move Source A4", _school_a_id)
        class_other_school = _create_classroom_direct(teacher["user_id"], "Move Dest Other School", _school_b_id)
        _add_student(client, teacher["token"], class_a, student["user_id"])

        resp = client.post(
            f"/api/classrooms/{class_a}/students/{student['user_id']}/move",
            json={"to_classroom_id": class_other_school},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 400

        a_students = client.get(f"/api/classrooms/{class_a}/students", headers=auth_header(teacher["token"])).json()
        assert student["user_id"] in [s["id"] for s in a_students]

    def test_move_student_not_in_source_is_404(self, client, teacher, student):
        class_a = _create_classroom(client, teacher["token"], "Move Source A5", _school_a_id)
        class_b = _create_classroom(client, teacher["token"], "Move Dest B5", _school_a_id)
        # student never added to class_a

        resp = client.post(
            f"/api/classrooms/{class_a}/students/{student['user_id']}/move",
            json={"to_classroom_id": class_b},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404

    def test_move_to_classroom_student_already_in_is_409(self, client, teacher, student):
        class_a = _create_classroom(client, teacher["token"], "Move Source A6", _school_a_id)
        class_b = _create_classroom(client, teacher["token"], "Move Dest B6", _school_a_id)
        _add_student(client, teacher["token"], class_a, student["user_id"])
        _add_student(client, teacher["token"], class_b, student["user_id"])

        resp = client.post(
            f"/api/classrooms/{class_a}/students/{student['user_id']}/move",
            json={"to_classroom_id": class_b},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 409

        # Source untouched by the rejected move
        a_students = client.get(f"/api/classrooms/{class_a}/students", headers=auth_header(teacher["token"])).json()
        assert student["user_id"] in [s["id"] for s in a_students]

    def test_move_requires_auth(self, client, teacher, student):
        class_a = _create_classroom(client, teacher["token"], "Move Source A7", _school_a_id)
        class_b = _create_classroom(client, teacher["token"], "Move Dest B7", _school_a_id)
        _add_student(client, teacher["token"], class_a, student["user_id"])

        resp = client.post(
            f"/api/classrooms/{class_a}/students/{student['user_id']}/move",
            json={"to_classroom_id": class_b},
        )
        assert resp.status_code == 401

    def test_move_nonexistent_destination_is_404(self, client, teacher, student):
        class_a = _create_classroom(client, teacher["token"], "Move Source A8", _school_a_id)
        _add_student(client, teacher["token"], class_a, student["user_id"])

        resp = client.post(
            f"/api/classrooms/{class_a}/students/{student['user_id']}/move",
            json={"to_classroom_id": 999999},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404
