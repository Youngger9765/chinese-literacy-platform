"""
Tests for batch-removing students from a classroom (#3821).

Covers:
- POST /api/classrooms/{classroom_id}/students/batch-remove

Uses SQLite in-memory DB, following the same pattern as test_classrooms_api.py.

Run with:
    cd backend && python -m pytest tests/test_classroom_batch_remove_students_3821.py -v
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
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.session import LearningSession

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
    return _register_teacher(client, "br_teacher")


@pytest.fixture
def other_teacher(client):
    return _register_teacher(client, "br_other_teacher")


class TestBatchRemoveStudents:
    def test_batch_remove_removes_selected_only(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch Remove A")
        s1 = _register_student(client, "br_s1")
        s2 = _register_student(client, "br_s2")
        s3 = _register_student(client, "br_s3")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])
        _add_student(client, teacher["token"], classroom_id, s2["user_id"])
        _add_student(client, teacher["token"], classroom_id, s3["user_id"])

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch-remove",
            json={"student_ids": [s1["user_id"], s2["user_id"]]},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["removed_count"] == 2
        assert body["not_found_ids"] == []

        remaining = client.get(f"/api/classrooms/{classroom_id}/students", headers=auth_header(teacher["token"])).json()
        remaining_ids = [s["id"] for s in remaining]
        assert s1["user_id"] not in remaining_ids
        assert s2["user_id"] not in remaining_ids
        assert s3["user_id"] in remaining_ids

    def test_batch_remove_keeps_student_account_alive(self, client, teacher):
        """AC3: the User row and their learning history must survive — only
        the classroom membership is removed, never the account."""
        classroom_id = _create_classroom(client, teacher["token"], "Batch Remove B")
        s1 = _register_student(client, "br_keep_s1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        db = TestingSessionLocal()
        try:
            assignment = Assignment(
                classroom_id=classroom_id,
                teacher_id=teacher["user_id"],
                title="Batch remove assignment",
                story_id="1",
                is_active=True,
                assigned_to_all=True,
            )
            db.add(assignment)
            db.flush()
            submission = AssignmentSubmission(assignment_id=assignment.id, student_id=s1["user_id"], status="completed")
            db.add(submission)
            session_row = LearningSession(
                student_id=s1["user_id"],
                classroom_id=classroom_id,
                story_slug="batch-remove-keep-alive-story",
                status="in_progress",
            )
            db.add(session_row)
            db.commit()
            submission_id = submission.id
            session_id = session_row.id
        finally:
            db.close()

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch-remove",
            json={"student_ids": [s1["user_id"]]},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text

        db = TestingSessionLocal()
        try:
            user = db.query(User).filter(User.id == s1["user_id"]).first()
            assert user is not None
            submission_row = db.query(AssignmentSubmission).filter(AssignmentSubmission.id == submission_id).first()
            assert submission_row is not None
            session_row = db.query(LearningSession).filter(LearningSession.id == session_id).first()
            assert session_row is not None
        finally:
            db.close()

    def test_batch_remove_requires_owner_or_admin(self, client, teacher, other_teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch Remove C")
        s1 = _register_student(client, "br_perm_s1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch-remove",
            json={"student_ids": [s1["user_id"]]},
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

        remaining = client.get(f"/api/classrooms/{classroom_id}/students", headers=auth_header(teacher["token"])).json()
        assert s1["user_id"] in [s["id"] for s in remaining]

    def test_batch_remove_partial_success_reports_not_found(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch Remove D")
        s1 = _register_student(client, "br_partial_s1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch-remove",
            json={"student_ids": [s1["user_id"], 999999]},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["removed_count"] == 1
        assert body["not_found_ids"] == [999999]

    def test_batch_remove_real_student_in_different_classroom_is_not_found(self, client, teacher):
        """A real, existing student id that just isn't enrolled in THIS
        classroom must be reported the same way as a nonexistent id — not
        removed from the other classroom, and no information leak about
        which classroom it actually belongs to."""
        classroom_a = _create_classroom(client, teacher["token"], "Batch Remove D-A")
        classroom_b = _create_classroom(client, teacher["token"], "Batch Remove D-B")
        s1 = _register_student(client, "br_xclass_s1")
        s_other = _register_student(client, "br_xclass_other")
        _add_student(client, teacher["token"], classroom_a, s1["user_id"])
        _add_student(client, teacher["token"], classroom_b, s_other["user_id"])

        resp = client.post(
            f"/api/classrooms/{classroom_a}/students/batch-remove",
            json={"student_ids": [s1["user_id"], s_other["user_id"]]},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["removed_count"] == 1
        assert body["not_found_ids"] == [s_other["user_id"]]

        # s_other must still be enrolled in classroom_b, untouched
        b_roster = client.get(f"/api/classrooms/{classroom_b}/students", headers=auth_header(teacher["token"])).json()
        assert s_other["user_id"] in [s["id"] for s in b_roster]

    def test_batch_remove_duplicate_ids_in_one_request(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch Remove D-dup")
        s1 = _register_student(client, "br_dup_s1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        # A duplicated VALID id collapses to removed_count=1 either way (the
        # table has a UniqueConstraint(classroom_id, student_id), so SQL's
        # own IN(...) semantics already collapse it even without de-dupe) --
        # that alone wouldn't prove the de-dupe code path actually ran. A
        # duplicated id that ISN'T enrolled is the case that only passes if
        # de-dupe runs: without it, not_found_ids would come back as
        # [999999, 999999] instead of the de-duped [999999].
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch-remove",
            json={"student_ids": [s1["user_id"], 999999, 999999]},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["removed_count"] == 1
        assert body["not_found_ids"] == [999999]

        remaining = client.get(f"/api/classrooms/{classroom_id}/students", headers=auth_header(teacher["token"])).json()
        assert s1["user_id"] not in [s["id"] for s in remaining]

    def test_batch_remove_empty_list_is_422(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch Remove E")
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch-remove",
            json={"student_ids": []},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_batch_remove_over_100_is_422(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch Remove F")
        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch-remove",
            json={"student_ids": list(range(1, 102))},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_batch_remove_requires_auth(self, client, teacher):
        classroom_id = _create_classroom(client, teacher["token"], "Batch Remove G")
        s1 = _register_student(client, "br_auth_s1")
        _add_student(client, teacher["token"], classroom_id, s1["user_id"])

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students/batch-remove",
            json={"student_ids": [s1["user_id"]]},
        )
        assert resp.status_code == 401
