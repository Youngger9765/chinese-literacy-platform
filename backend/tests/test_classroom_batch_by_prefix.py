"""
Tests for POST /api/classrooms/{id}/students/batch-by-prefix (#3991).

Junyi-parity batch creation: teacher picks ONE account-name prefix + ONE
shared initial password + a count, instead of naming each student. The
system creates `{prefix}01`..`{prefix}NN` accounts that all start with the
same password and enrolls them in the classroom in one call.

Uses SQLite in-memory DB (same pattern as test_classroom_join_and_batch.py).

Run with:
    cd backend && python -m pytest tests/test_classroom_batch_by_prefix.py -v
"""

import os
import sys
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
    from app.models.school import School

    school = School(name="Batch Prefix Test School")
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


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "demo1234"
    name = f"{suffix.title()} {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    user_id = me_resp.json()["id"]

    _mk = TestingSessionLocal()
    try:
        _trole = _mk.query(Role).filter(Role.name == "teacher").first()
        if _trole and not _mk.query(UserRole).filter(
            UserRole.user_id == user_id, UserRole.role_id == _trole.id,
            UserRole.scope_type == "school", UserRole.scope_id == str(_test_school_id),
        ).first():
            _mk.add(UserRole(user_id=user_id, role_id=_trole.id,
                             scope_type="school", scope_id=str(_test_school_id)))
            _mk.commit()
    finally:
        _mk.close()

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
    return _register_user(client, "bp_teacher")


@pytest.fixture(scope="module")
def other_teacher(client):
    return _register_user(client, "bp_other_teacher")


@pytest.fixture(scope="module")
def student_user(client):
    return _register_user(client, "bp_student")


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "bp_admin")
    return _make_admin(user)


def _create_classroom(client, teacher, school_id, name) -> dict:
    resp = client.post(
        "/api/classrooms",
        json={"name": name, "school_id": school_id},
        headers=auth_header(teacher["token"]),
    )
    assert resp.status_code == 201
    return resp.json()


# ===========================================================================
# Happy path
# ===========================================================================


class TestBatchCreateByPrefixSuccess:
    def test_creates_sequential_accounts_with_shared_password(self, client, teacher, school_id):
        classroom = _create_classroom(client, teacher, school_id, "Prefix Happy Path")

        resp = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "ptest", "password": "sharedpw1", "count": 3},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert len(data["created"]) == 3
        assert len(data["errors"]) == 0

        usernames = sorted(s["username"] for s in data["created"])
        assert usernames == ["PTEST01", "PTEST02", "PTEST03"]
        for s in data["created"]:
            # Junyi-parity: every account shares the SAME password (not a
            # random per-student one like the roster-based /students/batch).
            assert s["password"] == "sharedpw1"
            assert s["user_id"] > 0

    def test_zero_pads_to_fit_the_count(self, client, teacher, school_id):
        """count=12 needs 2-digit padding (matches Junyi's default-2-digit rule)."""
        classroom = _create_classroom(client, teacher, school_id, "Prefix Padding")

        resp = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "padtest", "password": "sharedpw1", "count": 12},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        usernames = sorted(s["username"] for s in resp.json()["created"])
        assert usernames[0] == "PADTEST01"
        assert usernames[-1] == "PADTEST12"

    def test_students_are_enrolled_in_the_classroom(self, client, teacher, school_id):
        classroom = _create_classroom(client, teacher, school_id, "Prefix Enroll Test")

        client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "enrolltest", "password": "sharedpw1", "count": 2},
            headers=auth_header(teacher["token"]),
        )

        list_resp = client.get(
            f"/api/classrooms/{classroom['id']}/students",
            headers=auth_header(teacher["token"]),
        )
        assert list_resp.status_code == 200
        assert len(list_resp.json()) == 2

    def test_created_accounts_can_log_in_with_the_shared_password(self, client, teacher, school_id):
        """End-to-end: the generated username + shared password is a real,
        usable login -- not just a DB row."""
        classroom = _create_classroom(client, teacher, school_id, "Prefix Login Test")

        resp = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "logintest", "password": "loginpw1", "count": 2},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        created = resp.json()["created"]

        for student in created:
            login_resp = client.post(
                "/api/auth/login",
                json={"email": student["username"], "password": "loginpw1"},
            )
            assert login_resp.status_code == 200, (
                f"login failed for {student['username']}: {login_resp.json()}"
            )
            assert "access_token" in login_resp.json()

        # Negative control: the wrong password must NOT work.
        bad_login = client.post(
            "/api/auth/login",
            json={"email": created[0]["username"], "password": "wrongpw1"},
        )
        assert bad_login.status_code == 401


# ===========================================================================
# Validation
# ===========================================================================


class TestBatchCreateByPrefixValidation:
    def test_count_above_cap_returns_422(self, client, teacher, school_id):
        classroom = _create_classroom(client, teacher, school_id, "Prefix Cap Test")
        resp = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "captest", "password": "sharedpw1", "count": 51},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_count_zero_returns_422(self, client, teacher, school_id):
        classroom = _create_classroom(client, teacher, school_id, "Prefix Zero Test")
        resp = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "zerotest", "password": "sharedpw1", "count": 0},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_prefix_starting_with_digit_returns_422(self, client, teacher, school_id):
        classroom = _create_classroom(client, teacher, school_id, "Prefix Digit Start")
        resp = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "9badstart", "password": "sharedpw1", "count": 1},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_prefix_with_special_characters_returns_422(self, client, teacher, school_id):
        classroom = _create_classroom(client, teacher, school_id, "Prefix Special Chars")
        resp = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "bad-prefix!", "password": "sharedpw1", "count": 1},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_prefix_too_short_returns_422(self, client, teacher, school_id):
        classroom = _create_classroom(client, teacher, school_id, "Prefix Too Short")
        resp = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "ab", "password": "sharedpw1", "count": 1},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_password_too_short_returns_422(self, client, teacher, school_id):
        classroom = _create_classroom(client, teacher, school_id, "Password Too Short")
        resp = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "shorttest", "password": "ab1", "count": 1},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_password_with_special_characters_returns_422(self, client, teacher, school_id):
        classroom = _create_classroom(client, teacher, school_id, "Password Special Chars")
        resp = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "pwspecial", "password": "bad pw!", "count": 1},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422


# ===========================================================================
# Authorization
# ===========================================================================


class TestBatchCreateByPrefixAuthorization:
    def test_requires_auth(self, client, teacher, school_id):
        classroom = _create_classroom(client, teacher, school_id, "Prefix No Auth")
        resp = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "noauth", "password": "sharedpw1", "count": 1},
        )
        assert resp.status_code == 401

    def test_403_for_other_teacher(self, client, teacher, other_teacher, school_id):
        classroom = _create_classroom(client, teacher, school_id, "Prefix 403 Test")
        resp = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "forbidden", "password": "sharedpw1", "count": 1},
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_owner_teacher_succeeds_positive_control(self, client, teacher, school_id):
        """Positive control for the 403 test above: the SAME classroom, the
        OWNING teacher -- must succeed. Without this, the 403 could mean
        "the whole endpoint is broken", not "authorization works"."""
        classroom = _create_classroom(client, teacher, school_id, "Prefix Owner OK")
        resp = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "ownerok", "password": "sharedpw1", "count": 1},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201

    def test_student_role_forbidden_403(self, client, teacher, student_user, school_id):
        classroom = _create_classroom(client, teacher, school_id, "Prefix Student 403")
        resp = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "studentno", "password": "sharedpw1", "count": 1},
            headers=auth_header(student_user["token"]),
        )
        assert resp.status_code == 403

    def test_admin_allowed(self, client, teacher, admin_user, school_id):
        classroom = _create_classroom(client, teacher, school_id, "Prefix Admin OK")
        resp = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "adminok", "password": "sharedpw1", "count": 1},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 201


# ===========================================================================
# Collision handling -- never overwrite or attach someone else's account
# ===========================================================================


class TestBatchCreateByPrefixCollisions:
    def test_duplicate_prefix_in_same_classroom_errors_not_overwrites(
        self, client, teacher, school_id
    ):
        classroom = _create_classroom(client, teacher, school_id, "Prefix Dup Same Class")

        first = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "duptest", "password": "firstpw1", "count": 2},
            headers=auth_header(teacher["token"]),
        )
        assert first.status_code == 201
        assert len(first.json()["created"]) == 2
        first_user_ids = {s["user_id"] for s in first.json()["created"]}

        second = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "duptest", "password": "secondpw1", "count": 2},
            headers=auth_header(teacher["token"]),
        )
        assert second.status_code == 201
        data = second.json()
        assert len(data["created"]) == 0
        assert len(data["errors"]) == 2
        assert all("已經存在" in e["error"] for e in data["errors"])

        # The original accounts must be untouched -- still log in with the
        # FIRST password, not silently overwritten by the second call.
        login_resp = client.post(
            "/api/auth/login",
            json={"email": "DUPTEST01", "password": "firstpw1"},
        )
        assert login_resp.status_code == 200

        # And the classroom roster must not have grown or duplicated.
        list_resp = client.get(
            f"/api/classrooms/{classroom['id']}/students",
            headers=auth_header(teacher["token"]),
        )
        assert len(list_resp.json()) == 2
        assert {s["id"] for s in list_resp.json()} == first_user_ids

    def test_collision_across_different_classrooms_does_not_cross_attach(
        self, client, teacher, other_teacher, school_id
    ):
        """Two different teachers pick the same prefix for two different
        classrooms -- the second must error (global username/email
        uniqueness), and must NOT silently enroll that other teacher's
        existing student into its own classroom."""
        classroom_a = _create_classroom(client, teacher, school_id, "Prefix Cross A")
        resp_a = client.post(
            f"/api/classrooms/{classroom_a['id']}/students/batch-by-prefix",
            json={"prefix": "crosstest", "password": "firstpw1", "count": 1},
            headers=auth_header(teacher["token"]),
        )
        assert resp_a.status_code == 201
        student_in_a = resp_a.json()["created"][0]["user_id"]

        classroom_b = _create_classroom(client, other_teacher, school_id, "Prefix Cross B")
        resp_b = client.post(
            f"/api/classrooms/{classroom_b['id']}/students/batch-by-prefix",
            json={"prefix": "crosstest", "password": "secondpw1", "count": 1},
            headers=auth_header(other_teacher["token"]),
        )
        assert resp_b.status_code == 201
        assert len(resp_b.json()["created"]) == 0
        assert len(resp_b.json()["errors"]) == 1

        list_b = client.get(
            f"/api/classrooms/{classroom_b['id']}/students",
            headers=auth_header(other_teacher["token"]),
        )
        assert len(list_b.json()) == 0
        assert all(s["id"] != student_in_a for s in list_b.json())


# ===========================================================================
# Rate limiting
# ===========================================================================


class TestBatchCreateByPrefixRateLimit:
    def test_rate_limit_blocks_after_ten_calls_per_minute(self, client, school_id):
        """Dedicated fresh teacher so this doesn't share a budget with any
        other test in this module that also calls the endpoint."""
        rl_teacher = _register_user(client, "bp_ratelimit_teacher")
        classroom = _create_classroom(client, rl_teacher, school_id, "Prefix Rate Limit")

        for i in range(10):
            resp = client.post(
                f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
                json={"prefix": f"rl{i}aaa", "password": "sharedpw1", "count": 1},
                headers=auth_header(rl_teacher["token"]),
            )
            assert resp.status_code == 201, f"call {i} should be allowed, got {resp.status_code}"

        eleventh = client.post(
            f"/api/classrooms/{classroom['id']}/students/batch-by-prefix",
            json={"prefix": "rl10aaa", "password": "sharedpw1", "count": 1},
            headers=auth_header(rl_teacher["token"]),
        )
        assert eleventh.status_code == 429
