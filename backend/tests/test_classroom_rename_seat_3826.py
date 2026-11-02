"""
Tests for teacher-editable student display name and seat number (#3826).

Covers:
- PATCH /api/classrooms/{classroom_id}/students/{student_id}/name
- PATCH /api/classrooms/{classroom_id}/students/{student_id}/seat

Uses SQLite in-memory DB, following the same pattern as
test_classroom_batch_remove_students_3821.py / test_classroom_move_student_3819.py.

Run with:
    cd backend && JWT_SECRET_KEY=test-secret python -m pytest tests/test_classroom_rename_seat_3826.py -v
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
from app.models.user import Role, UserRole, User
from app.models.school import ClassroomStudent, School

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


_school_id: int = 0


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _school_id
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    _school_id = _seed_school(session)
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


def _register_teacher(client, suffix: str) -> dict:
    user = _register_user(client, suffix)
    db = TestingSessionLocal()
    try:
        trole = db.query(Role).filter(Role.name == "teacher").first()
        db.add(UserRole(user_id=user["user_id"], role_id=trole.id, scope_type="school", scope_id=str(_school_id)))
        db.commit()
    finally:
        db.close()
    return user


def _register_student(client, suffix: str) -> dict:
    user = _register_user(client, suffix)
    grant_school_student_role(TestingSessionLocal, user["user_id"], school_id=_school_id)
    return user


def _create_classroom(client, teacher_token, name):
    resp = client.post(
        "/api/classrooms",
        json={"name": name, "school_id": _school_id},
        headers=auth_header(teacher_token),
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def _add_student(client, teacher_token, classroom_id, student_id):
    resp = client.post(
        f"/api/classrooms/{classroom_id}/students",
        json={"student_id": student_id},
        headers=auth_header(teacher_token),
    )
    assert resp.status_code == 201, resp.text


@pytest.fixture
def teacher(client):
    return _register_teacher(client, "rs_teacher")


@pytest.fixture
def other_teacher(client):
    return _register_teacher(client, "rs_other_teacher")


class TestRenameStudent:
    def test_rename_updates_name_and_leaves_login_untouched(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Rename A")
        s1 = _register_student(client, "rs_s1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s1['user_id']}/name",
            json={"name": "新名字"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "新名字"

        db = TestingSessionLocal()
        try:
            user = db.query(User).filter(User.id == s1["user_id"]).first()
            assert user.name == "新名字"
            assert user.email == s1["email"]  # login untouched
        finally:
            db.close()

        roster = client.get(f"/api/classrooms/{classroom_id}/students", headers=auth_header(teacher["token"])).json()
        renamed = next(s for s in roster if s["id"] == s1["user_id"])
        assert renamed["name"] == "新名字"

    def test_rename_rejects_empty_or_too_long(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Rename B")
        s1 = _register_student(client, "rs_empty_s1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s1['user_id']}/name",
            json={"name": "   "},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s1['user_id']}/name",
            json={"name": "x" * 101},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_rename_requires_owner_or_admin(self, client, teacher, other_teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Rename C")
        s1 = _register_student(client, "rs_perm_s1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s1['user_id']}/name",
            json={"name": "別人改的名字"},
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

        db = TestingSessionLocal()
        try:
            user = db.query(User).filter(User.id == s1["user_id"]).first()
            assert user.name != "別人改的名字"
        finally:
            db.close()

    def test_rename_404_when_student_not_in_this_classroom(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Rename D")
        s1 = _register_student(client, "rs_notin_s1")
        # s1 is NOT added to classroom_id

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s1['user_id']}/name",
            json={"name": "不在這班"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404

    def test_rename_requires_auth(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Rename E")
        s1 = _register_student(client, "rs_auth_s1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s1['user_id']}/name",
            json={"name": "沒登入"},
        )
        assert resp.status_code == 401


class TestSeatNumber:
    def test_set_seat_number_success(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Seat A")
        s1 = _register_student(client, "rs_seat_s1")
        s2 = _register_student(client, "rs_seat_s2")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])
        _add_student(client, teacher["token"], classroom_id, s2["user_id"])

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s1['user_id']}/seat",
            json={"seat_number": 1},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["seat_number"] == 1

        roster = client.get(f"/api/classrooms/{classroom_id}/students", headers=auth_header(teacher["token"])).json()
        seated = next(s for s in roster if s["id"] == s1["user_id"])
        assert seated["seat_number"] == 1
        other = next(s for s in roster if s["id"] == s2["user_id"])
        assert other["seat_number"] is None

    def test_duplicate_seat_number_in_same_classroom_is_409(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Seat B")
        s1 = _register_student(client, "rs_dup_s1")
        s2 = _register_student(client, "rs_dup_s2")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])
        _add_student(client, teacher["token"], classroom_id, s2["user_id"])

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s2['user_id']}/seat",
            json={"seat_number": 2},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s1['user_id']}/seat",
            json={"seat_number": 2},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 409

        roster = client.get(f"/api/classrooms/{classroom_id}/students", headers=auth_header(teacher["token"])).json()
        s1_row = next(s for s in roster if s["id"] == s1["user_id"])
        assert s1_row["seat_number"] is None  # unchanged, whole request had no effect
        s2_row = next(s for s in roster if s["id"] == s2["user_id"])
        assert s2_row["seat_number"] == 2  # unchanged

    def test_same_seat_number_allowed_across_different_classrooms(self, client, teacher):
        classroom_a = _create_classroom(client, teacher["token"], "Seat C-A")
        classroom_b = _create_classroom(client, teacher["token"], "Seat C-B")
        s1 = _register_student(client, "rs_cross_s1")
        s3 = _register_student(client, "rs_cross_s3")
        _add_student(client, teacher["token"], classroom_a, s1["user_id"])
        _add_student(client, teacher["token"], classroom_b, s3["user_id"])

        resp = client.patch(
            f"/api/classrooms/{classroom_a}/students/{s1['user_id']}/seat",
            json={"seat_number": 1},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200

        resp = client.patch(
            f"/api/classrooms/{classroom_b}/students/{s3['user_id']}/seat",
            json={"seat_number": 1},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200  # different classroom, no conflict

    def test_seat_number_can_be_cleared_to_null(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Seat D")
        s1 = _register_student(client, "rs_clear_s1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s1['user_id']}/seat",
            json={"seat_number": 5},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s1['user_id']}/seat",
            json={"seat_number": None},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["seat_number"] is None

    def test_seat_number_range_validation(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Seat E")
        s1 = _register_student(client, "rs_range_s1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s1['user_id']}/seat",
            json={"seat_number": 0},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s1['user_id']}/seat",
            json={"seat_number": -1},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_seat_number_requires_owner_or_admin(self, client, teacher, other_teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Seat F")
        s1 = _register_student(client, "rs_seatperm_s1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s1['user_id']}/seat",
            json={"seat_number": 3},
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_seat_number_404_when_student_not_in_this_classroom(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Seat G")
        s1 = _register_student(client, "rs_seatnotin_s1")
        # not added

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s1['user_id']}/seat",
            json={"seat_number": 1},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404

    def test_seat_number_requires_auth(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Seat H")
        s1 = _register_student(client, "rs_seatauth_s1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/{s1['user_id']}/seat",
            json={"seat_number": 1},
        )
        assert resp.status_code == 401
