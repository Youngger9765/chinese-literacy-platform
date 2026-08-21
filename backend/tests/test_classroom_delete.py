"""
Tests for deleting classrooms.

Run with:
    cd /Users/young/project/chinese-literacy-platform/backend
    source .venv/bin/activate
    python -m pytest tests/test_classroom_delete.py -q
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

from app.database import get_db
from app.main import app
from app.models import Base
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.organization import Organization
from app.models.school import Classroom, ClassroomStudent, ClassroomTeacher, ClassroomText, School
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
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "org_owner", "display_name": "Org Owner", "scope_level": "organization"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]

VALID_STORY_ID = "20001"


def _seed_roles(session):
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    session.commit()


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
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


def _reset_rate_limiters() -> None:
    try:
        from app.routes.auth import rate_limiter

        rate_limiter.reset()
    except (ImportError, AttributeError):
        pass
    try:
        from app.auth.rate_limiter import general_rate_limiter

        general_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "TestOnlyPassword123!"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "name": f"{suffix.title()} {unique}"},
    )
    assert resp.status_code == 201, resp.text

    verification_token = resp.json().get("verification_token")
    if verification_token:
        verify_resp = client.get(f"/api/auth/verify-email?token={verification_token}")
        assert verify_resp.status_code == 200

    _reset_rate_limiters()
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    assert me_resp.status_code == 200
    return {"email": email, "token": token, "user_id": me_resp.json()["id"]}


def _create_org_and_school(org_id: str) -> int:
    db = TestingSessionLocal()
    try:
        if db.query(Organization).filter(Organization.id == org_id).first() is None:
            db.add(Organization(id=org_id, name=f"Org {org_id} {uuid.uuid4().hex[:6]}"))
            db.commit()
        school = School(name=f"School {org_id} {uuid.uuid4().hex[:6]}", organization_id=org_id)
        db.add(school)
        db.commit()
        db.refresh(school)
        return school.id
    finally:
        db.close()


def _assign_role(
    user_id: int,
    role_name: str,
    *,
    scope_type: str,
    scope_id: str | None = None,
) -> None:
    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == role_name).first()
        assert role is not None
        exists = (
            db.query(UserRole)
            .filter(
                UserRole.user_id == user_id,
                UserRole.role_id == role.id,
                UserRole.scope_type == scope_type,
                UserRole.scope_id == scope_id,
            )
            .first()
        )
        if exists is None:
            db.add(
                UserRole(
                    user_id=user_id,
                    role_id=role.id,
                    scope_type=scope_type,
                    scope_id=scope_id,
                )
            )
            db.commit()
    finally:
        db.close()


def _create_school_for_teacher(teacher_id: int, *, org_id: str | None = None) -> int:
    school_id = _create_org_and_school(org_id) if org_id else _create_org_and_school(f"org-{uuid.uuid4().hex[:8]}")
    _assign_role(teacher_id, "teacher", scope_type="school", scope_id=str(school_id))
    return school_id


def _create_classroom(client, teacher: dict, school_id: int, name: str = "Delete Test") -> int:
    resp = client.post(
        "/api/classrooms",
        json={"name": f"{name} {uuid.uuid4().hex[:6]}", "school_id": school_id},
        headers=auth_header(teacher["token"]),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _enroll_student(client, teacher: dict, classroom_id: int, student_id: int) -> None:
    resp = client.post(
        f"/api/classrooms/{classroom_id}/students",
        json={"student_id": student_id},
        headers=auth_header(teacher["token"]),
    )
    assert resp.status_code in (200, 201), resp.text


def _create_assignment(client, teacher: dict, classroom_id: int) -> int:
    resp = client.post(
        f"/api/classrooms/{classroom_id}/assignments",
        json={"classroom_id": classroom_id, "story_id": VALID_STORY_ID, "title": "Cascade Delete"},
        headers=auth_header(teacher["token"]),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["submission_count"] == 1
    return resp.json()["id"]


def test_owner_deletes_classroom_then_get_404_and_list_excludes_it(client):
    teacher = _register_user(client, "delete_owner")
    school_id = _create_school_for_teacher(teacher["user_id"])
    classroom_id = _create_classroom(client, teacher, school_id, "Owner Delete")

    delete_resp = client.delete(
        f"/api/classrooms/{classroom_id}",
        headers=auth_header(teacher["token"]),
    )
    assert delete_resp.status_code in (200, 204), delete_resp.text

    get_resp = client.get(
        f"/api/classrooms/{classroom_id}",
        headers=auth_header(teacher["token"]),
    )
    assert get_resp.status_code == 404

    list_resp = client.get("/api/classrooms", headers=auth_header(teacher["token"]))
    assert list_resp.status_code == 200
    listed_ids = {item["id"] for item in list_resp.json()["items"]}
    assert classroom_id not in listed_ids


def test_system_admin_deletes_any_classroom(client):
    owner = _register_user(client, "delete_admin_owner")
    admin = _register_user(client, "delete_system_admin")
    _assign_role(admin["user_id"], "system_admin", scope_type="platform")
    school_id = _create_school_for_teacher(owner["user_id"])
    classroom_id = _create_classroom(client, owner, school_id, "Admin Delete")

    delete_resp = client.delete(
        f"/api/classrooms/{classroom_id}",
        headers=auth_header(admin["token"]),
    )
    assert delete_resp.status_code in (200, 204), delete_resp.text

    owner_get_resp = client.get(
        f"/api/classrooms/{classroom_id}",
        headers=auth_header(owner["token"]),
    )
    assert owner_get_resp.status_code == 404


def test_delete_classroom_cascades_assignments_submissions_students_and_links(client):
    teacher = _register_user(client, "delete_cascade_teacher")
    student = _register_user(client, "delete_cascade_student")
    school_id = _create_school_for_teacher(teacher["user_id"])
    _assign_role(student["user_id"], "student", scope_type="school", scope_id=str(school_id))
    classroom_id = _create_classroom(client, teacher, school_id, "Cascade")
    _enroll_student(client, teacher, classroom_id, student["user_id"])
    assignment_id = _create_assignment(client, teacher, classroom_id)

    delete_resp = client.delete(
        f"/api/classrooms/{classroom_id}",
        headers=auth_header(teacher["token"]),
    )
    assert delete_resp.status_code in (200, 204), delete_resp.text

    db = TestingSessionLocal()
    try:
        assert db.query(Classroom).filter(Classroom.id == classroom_id).first() is None
        assert (
            db.query(ClassroomStudent)
            .filter(ClassroomStudent.classroom_id == classroom_id)
            .count()
            == 0
        )
        assert db.query(Assignment).filter(Assignment.classroom_id == classroom_id).count() == 0
        assert (
            db.query(AssignmentSubmission)
            .filter(AssignmentSubmission.assignment_id == assignment_id)
            .count()
            == 0
        )
        assert db.query(ClassroomText).filter(ClassroomText.classroom_id == classroom_id).count() == 0
        assert (
            db.query(ClassroomTeacher)
            .filter(ClassroomTeacher.classroom_id == classroom_id)
            .count()
            == 0
        )
    finally:
        db.close()


def test_delete_classroom_non_owner_teacher_403(client):
    owner = _register_user(client, "delete_owner_forbidden")
    other = _register_user(client, "delete_other_forbidden")
    school_id = _create_school_for_teacher(owner["user_id"])
    _assign_role(other["user_id"], "teacher", scope_type="school", scope_id=str(school_id))
    classroom_id = _create_classroom(client, owner, school_id, "Non Owner")

    resp = client.delete(
        f"/api/classrooms/{classroom_id}",
        headers=auth_header(other["token"]),
    )
    assert resp.status_code == 403


def test_delete_classroom_cross_org_admin_403(client):
    org_a = f"org-a-{uuid.uuid4().hex[:8]}"
    org_b = f"org-b-{uuid.uuid4().hex[:8]}"
    school_a_id = _create_org_and_school(org_a)
    admin_a = _register_user(client, "delete_org_admin_a")
    _assign_role(admin_a["user_id"], "org_admin", scope_type="organization", scope_id=org_a)

    owner_b = _register_user(client, "delete_owner_b")
    school_b_id = _create_school_for_teacher(owner_b["user_id"], org_id=org_b)
    _assign_role(admin_a["user_id"], "teacher", scope_type="school", scope_id=str(school_a_id))
    classroom_id = _create_classroom(client, owner_b, school_b_id, "Cross Org")

    resp = client.delete(
        f"/api/classrooms/{classroom_id}",
        headers=auth_header(admin_a["token"]),
    )
    assert resp.status_code == 403


def test_delete_classroom_not_found_404(client):
    teacher = _register_user(client, "delete_not_found")
    school_id = _create_school_for_teacher(teacher["user_id"])
    _assign_role(teacher["user_id"], "teacher", scope_type="school", scope_id=str(school_id))

    resp = client.delete(
        "/api/classrooms/99999999",
        headers=auth_header(teacher["token"]),
    )
    assert resp.status_code == 404


def test_delete_classroom_requires_auth(client):
    teacher = _register_user(client, "delete_unauth")
    school_id = _create_school_for_teacher(teacher["user_id"])
    classroom_id = _create_classroom(client, teacher, school_id, "Unauth")

    resp = client.delete(f"/api/classrooms/{classroom_id}")
    assert resp.status_code == 401
