"""
Tests for the batch seat-number assignment endpoint (#3992).

Covers:
- PATCH /api/classrooms/{classroom_id}/students/seats

Junyi-parity "新增座號" dialog renumbers the whole roster in one request.
Doing that as N sequential single-row PATCH calls
(PATCH .../students/{id}/seat, #3826) is unsafe: reassigning seats that
swap/rotate can transiently collide with the `uq_classroom_students_seat`
unique constraint mid-sequence even though the FINAL state has no
duplicates. This batch endpoint clears the affected rows first, then
applies the new numbers in one commit, so only genuine duplicates in the
requested (or resulting) state can ever 409.

Uses SQLite in-memory DB, following the same pattern as
test_classroom_rename_seat_3826.py.

Run with:
    cd backend && JWT_SECRET_KEY=test-secret python -m pytest tests/test_classroom_seat_batch_3992.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from unittest.mock import patch

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, UserRole, User
from app.models.school import ClassroomStudent, School

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
    from _school_student import grant_school_student_role
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
    return _register_teacher(client, "sb_teacher")


@pytest.fixture
def other_teacher(client):
    return _register_teacher(client, "sb_other_teacher")


def _batch_patch(client, token, classroom_id, assignments):
    return client.patch(
        f"/api/classrooms/{classroom_id}/students/seats",
        json={"assignments": assignments},
        headers=auth_header(token),
    )


class TestBatchSeatAssignment:
    def test_assigns_seats_for_whole_roster_in_one_call(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch A")
        s1 = _register_student(client, "sb_a1")
        s2 = _register_student(client, "sb_a2")
        s3 = _register_student(client, "sb_a3")
        for s in (s1, s2, s3):
            _add_student(client, teacher["token"], classroom_id, s["user_id"])

        resp = _batch_patch(client, teacher["token"], classroom_id, [
            {"student_id": s1["user_id"], "seat_number": 1},
            {"student_id": s2["user_id"], "seat_number": 2},
            {"student_id": s3["user_id"], "seat_number": 3},
        ])
        assert resp.status_code == 200, resp.text
        updated = {row["id"]: row["seat_number"] for row in resp.json()["updated"]}
        assert updated == {s1["user_id"]: 1, s2["user_id"]: 2, s3["user_id"]: 3}

        roster = client.get(f"/api/classrooms/{classroom_id}/students", headers=auth_header(teacher["token"])).json()
        by_id = {s["id"]: s["seat_number"] for s in roster}
        assert by_id[s1["user_id"]] == 1
        assert by_id[s2["user_id"]] == 2
        assert by_id[s3["user_id"]] == 3

    def test_swapping_two_seats_in_one_call_does_not_transiently_conflict(self, client, teacher):
        """The exact scenario that makes N sequential single-row PATCH calls
        unsafe: s1 currently holds seat 1, s2 holds seat 2. Swapping them
        with two independent PATCH calls would 409 on whichever goes first
        (its target seat is still held by the other student at that
        instant). The batch endpoint must apply this atomically."""
        classroom_id = _create_classroom(client, teacher["token"], "Batch B")
        s1 = _register_student(client, "sb_b1")
        s2 = _register_student(client, "sb_b2")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])
        _add_student(client, teacher["token"], classroom_id, s2["user_id"])

        setup = _batch_patch(client, teacher["token"], classroom_id, [
            {"student_id": s1["user_id"], "seat_number": 1},
            {"student_id": s2["user_id"], "seat_number": 2},
        ])
        assert setup.status_code == 200, setup.text

        resp = _batch_patch(client, teacher["token"], classroom_id, [
            {"student_id": s1["user_id"], "seat_number": 2},
            {"student_id": s2["user_id"], "seat_number": 1},
        ])
        assert resp.status_code == 200, resp.text
        updated = {row["id"]: row["seat_number"] for row in resp.json()["updated"]}
        assert updated == {s1["user_id"]: 2, s2["user_id"]: 1}

    def test_insert_empty_seat_leaves_a_gap_in_numbering(self, client, teacher):
        """Junyi's '＋ 插入空號' -- a seat number with nobody in it to mark
        an absent/reserved seat. The dialog represents this client-side by
        simply not sending that number for any student; the backend has
        no concept of an empty seat row, it just sees a gap."""
        classroom_id = _create_classroom(client, teacher["token"], "Batch C")
        s1 = _register_student(client, "sb_c1")
        s2 = _register_student(client, "sb_c2")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])
        _add_student(client, teacher["token"], classroom_id, s2["user_id"])

        resp = _batch_patch(client, teacher["token"], classroom_id, [
            {"student_id": s1["user_id"], "seat_number": 1},
            {"student_id": s2["user_id"], "seat_number": 3},
        ])
        assert resp.status_code == 200, resp.text
        roster = client.get(f"/api/classrooms/{classroom_id}/students", headers=auth_header(teacher["token"])).json()
        by_id = {s["id"]: s["seat_number"] for s in roster}
        assert by_id[s1["user_id"]] == 1
        assert by_id[s2["user_id"]] == 3

    def test_conflict_with_a_student_outside_the_batch_is_409_and_nothing_changes(self, client, teacher):
        """s3 is NOT included in this batch and already holds seat 5. A
        batch that tries to give s1 seat 5 must 409 and leave BOTH s1 and
        s3's seat numbers untouched (whole request is one transaction)."""
        classroom_id = _create_classroom(client, teacher["token"], "Batch D")
        s1 = _register_student(client, "sb_d1")
        s3 = _register_student(client, "sb_d3")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])
        _add_student(client, teacher["token"], classroom_id, s3["user_id"])

        setup = _batch_patch(client, teacher["token"], classroom_id, [
            {"student_id": s3["user_id"], "seat_number": 5},
        ])
        assert setup.status_code == 200, setup.text

        resp = _batch_patch(client, teacher["token"], classroom_id, [
            {"student_id": s1["user_id"], "seat_number": 5},
        ])
        assert resp.status_code == 409, resp.text

        roster = client.get(f"/api/classrooms/{classroom_id}/students", headers=auth_header(teacher["token"])).json()
        by_id = {s["id"]: s["seat_number"] for s in roster}
        assert by_id[s1["user_id"]] is None  # unchanged
        assert by_id[s3["user_id"]] == 5  # unchanged

    def test_duplicate_seat_number_within_the_same_payload_is_422(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch E")
        s1 = _register_student(client, "sb_e1")
        s2 = _register_student(client, "sb_e2")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])
        _add_student(client, teacher["token"], classroom_id, s2["user_id"])

        resp = _batch_patch(client, teacher["token"], classroom_id, [
            {"student_id": s1["user_id"], "seat_number": 1},
            {"student_id": s2["user_id"], "seat_number": 1},
        ])
        assert resp.status_code == 422, resp.text

    def test_student_not_in_this_classroom_is_404_and_nothing_changes(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch F")
        s1 = _register_student(client, "sb_f1")
        s_outside = _register_student(client, "sb_fout")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])
        # s_outside is NOT enrolled in classroom_id

        resp = _batch_patch(client, teacher["token"], classroom_id, [
            {"student_id": s1["user_id"], "seat_number": 1},
            {"student_id": s_outside["user_id"], "seat_number": 2},
        ])
        assert resp.status_code == 404, resp.text

        roster = client.get(f"/api/classrooms/{classroom_id}/students", headers=auth_header(teacher["token"])).json()
        assert roster[0]["seat_number"] is None  # unchanged -- whole request had no effect

    def test_requires_owner_or_admin(self, client, teacher, other_teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch G")
        s1 = _register_student(client, "sb_g1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        resp = _batch_patch(client, other_teacher["token"], classroom_id, [
            {"student_id": s1["user_id"], "seat_number": 1},
        ])
        assert resp.status_code == 403

    def test_requires_auth(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch H")
        s1 = _register_student(client, "sb_h1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        resp = client.patch(
            f"/api/classrooms/{classroom_id}/students/seats",
            json={"assignments": [{"student_id": s1["user_id"], "seat_number": 1}]},
        )
        assert resp.status_code == 401

    def test_seat_range_validation(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch I")
        s1 = _register_student(client, "sb_i1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        resp = _batch_patch(client, teacher["token"], classroom_id, [
            {"student_id": s1["user_id"], "seat_number": 0},
        ])
        assert resp.status_code == 422

    def test_success_writes_one_audit_entry(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch J")
        s1 = _register_student(client, "sb_j1")
        s2 = _register_student(client, "sb_j2")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])
        _add_student(client, teacher["token"], classroom_id, s2["user_id"])

        with patch("app.routes.classrooms.classroom_students.audit_log_endpoint") as mock_audit:
            resp = _batch_patch(client, teacher["token"], classroom_id, [
                {"student_id": s1["user_id"], "seat_number": 1},
                {"student_id": s2["user_id"], "seat_number": 2},
            ])
            assert resp.status_code == 200, resp.text
            mock_audit.assert_called_once()

    def test_404_does_not_write_audit(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch K")
        s_outside = _register_student(client, "sb_kout")
        # not enrolled

        with patch("app.routes.classrooms.classroom_students.audit_log_endpoint") as mock_audit:
            resp = _batch_patch(client, teacher["token"], classroom_id, [
                {"student_id": s_outside["user_id"], "seat_number": 1},
            ])
            assert resp.status_code == 404, resp.text
            mock_audit.assert_not_called()

    def test_409_does_not_write_audit(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch L")
        s1 = _register_student(client, "sb_l1")
        s3 = _register_student(client, "sb_l3")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])
        _add_student(client, teacher["token"], classroom_id, s3["user_id"])

        setup = _batch_patch(client, teacher["token"], classroom_id, [
            {"student_id": s3["user_id"], "seat_number": 9},
        ])
        assert setup.status_code == 200, setup.text

        with patch("app.routes.classrooms.classroom_students.audit_log_endpoint") as mock_audit:
            resp = _batch_patch(client, teacher["token"], classroom_id, [
                {"student_id": s1["user_id"], "seat_number": 9},
            ])
            assert resp.status_code == 409, resp.text
            mock_audit.assert_not_called()
