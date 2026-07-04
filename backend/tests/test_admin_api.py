"""
Tests for admin system endpoints.

Covers:
- GET    /api/users                           (list users, admin only)
- GET    /api/users/{user_id}                 (user detail, admin only)
- POST   /api/classrooms with teacher_id      (admin creates for another teacher)
- GET    /api/classrooms/{id}                 (admin can view any classroom)
- PATCH  /api/classrooms/{id}                 (admin can update any classroom)
- POST   /api/classrooms/{id}/students        (admin can add students to any classroom)
- DELETE /api/classrooms/{id}/students/{sid}   (admin can remove students from any classroom)
- GET    /api/classrooms/{id}/students        (admin can list students in any classroom)
- GET    /api/schools/{school_id}/members     (list school members)

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-223/backend
    python -m pytest tests/test_admin_api.py -v
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
from app.models.organization import Organization


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
        session.add(Role(**role_data))
    session.commit()


def _seed_school(session) -> int:
    # Give the school a real organization so org_admin scoping (school→org) works.
    # Orphan schools (organization_id=None) are intentionally NOT claimable by any
    # org_admin under the tenant-scoped authz model (#2470).
    global _test_org_id
    org = Organization(name="Admin Test Org")
    session.add(org)
    session.commit()
    session.refresh(org)
    _test_org_id = str(org.id)
    school = School(name="Admin Test School", organization_id=org.id)
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
_test_org_id: str = ""


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
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    return {
        "token": token,
        "user_id": me_resp.json()["id"],
        "email": email,
        "name": name,
    }


def _make_admin(user_id: int, role_name: str = "system_admin", scope_id: str | None = None):
    """Assign admin role to a user directly via DB.

    system_admin is platform-scoped (scope_id=None). org_admin/org_owner MUST be
    scoped to a concrete org (scope_id=org.id) to match production; an org_admin
    with scope_id=None manages no org and is correctly denied under tenant scoping.
    """
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == role_name).first()
    scope_type = "platform" if role_name == "system_admin" else "organization"
    user_role = UserRole(
        user_id=user_id,
        role_id=role.id,
        scope_type=scope_type,
        scope_id=scope_id,
    )
    db.add(user_role)
    db.commit()
    db.close()


def _assign_school_role(user_id: int, school_id: int, role_name: str = "teacher"):
    """Assign a school-scoped role to a user directly via DB (idempotent)."""
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == role_name).first()
    existing = (
        db.query(UserRole)
        .filter(
            UserRole.user_id == user_id,
            UserRole.role_id == role.id,
            UserRole.scope_type == "school",
            UserRole.scope_id == str(school_id),
        )
        .first()
    )
    if existing is None:
        db.add(
            UserRole(
                user_id=user_id,
                role_id=role.id,
                scope_type="school",
                scope_id=str(school_id),
            )
        )
        db.commit()
    db.close()


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "admin")
    _make_admin(user["user_id"], "system_admin")
    return user


@pytest.fixture(scope="module")
def org_admin_user(client):
    user = _register_user(client, "org_admin")
    # Scope org_admin to the test org (which owns the test school), matching prod.
    _make_admin(user["user_id"], "org_admin", scope_id=_test_org_id)
    return user


@pytest.fixture(scope="module")
def teacher(client):
    user = _register_user(client, "teacher")
    # Make the teacher a member of the test school so they can create classrooms
    # there (#2470 NEW-2: create requires school membership / org-admin / sysadmin).
    _assign_school_role(user["user_id"], _test_school_id, "teacher")
    return user


@pytest.fixture(scope="module")
def other_teacher(client):
    return _register_user(client, "other_teacher")


@pytest.fixture(scope="module")
def student1(client):
    return _register_user(client, "student1")


@pytest.fixture(scope="module")
def student2(client):
    return _register_user(client, "student2")


# ===========================================================================
# Task 1: GET /api/users — List all users (admin only)
# ===========================================================================


class TestListUsers:
    def test_list_returns_200_for_system_admin(self, client, admin_user):
        resp = client.get("/api/users", headers=auth_header(admin_user["token"]))
        assert resp.status_code == 200

    def test_list_returns_200_for_org_admin(self, client, org_admin_user):
        resp = client.get("/api/users", headers=auth_header(org_admin_user["token"]))
        assert resp.status_code == 200

    def test_list_returns_items_and_total(self, client, admin_user):
        resp = client.get("/api/users", headers=auth_header(admin_user["token"]))
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)
        assert isinstance(data["total"], int)
        assert data["total"] >= 1

    def test_list_user_item_has_expected_fields(self, client, admin_user):
        resp = client.get("/api/users", headers=auth_header(admin_user["token"]))
        data = resp.json()
        assert len(data["items"]) > 0
        item = data["items"][0]
        assert "id" in item
        assert "email" in item
        assert "name" in item
        assert "is_active" in item
        assert "created_at" in item
        assert "roles" in item
        assert isinstance(item["roles"], list)

    def test_list_pagination(self, client, admin_user):
        resp = client.get(
            "/api/users?limit=2&offset=0",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        assert len(data["items"]) <= 2

    def test_list_search_by_name(self, client, admin_user, teacher):
        # Search for the teacher by a substring of their name
        search_term = teacher["name"][:6]
        resp = client.get(
            f"/api/users?search={search_term}",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        assert data["total"] >= 1
        found_ids = {item["id"] for item in data["items"]}
        assert teacher["user_id"] in found_ids

    def test_list_search_by_email(self, client, admin_user, teacher):
        search_term = teacher["email"][:10]
        resp = client.get(
            f"/api/users?search={search_term}",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        assert data["total"] >= 1

    def test_list_search_no_results(self, client, admin_user):
        resp = client.get(
            "/api/users?search=zzz_nonexistent_zzz",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        assert data["total"] == 0
        assert data["items"] == []

    def test_list_requires_auth(self, client):
        resp = client.get("/api/users")
        assert resp.status_code == 401

    def test_list_forbidden_for_non_admin(self, client, teacher):
        resp = client.get("/api/users", headers=auth_header(teacher["token"]))
        assert resp.status_code == 403

    def test_list_includes_roles(self, client, admin_user):
        resp = client.get("/api/users", headers=auth_header(admin_user["token"]))
        data = resp.json()
        # The admin user should have at least system_admin role
        admin_item = next(
            (item for item in data["items"] if item["id"] == admin_user["user_id"]),
            None,
        )
        assert admin_item is not None
        assert len(admin_item["roles"]) >= 1
        role_names = {r["role_name"] for r in admin_item["roles"]}
        assert "system_admin" in role_names


# ===========================================================================
# Task 1: GET /api/users/{user_id} — User detail (admin only)
# ===========================================================================


class TestGetUserDetail:
    def test_get_detail_returns_200(self, client, admin_user, teacher):
        resp = client.get(
            f"/api/users/{teacher['user_id']}",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200

    def test_get_detail_has_expected_fields(self, client, admin_user, teacher):
        resp = client.get(
            f"/api/users/{teacher['user_id']}",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        assert data["id"] == teacher["user_id"]
        assert data["email"] == teacher["email"]
        assert data["name"] == teacher["name"]
        assert "is_active" in data
        assert "email_verified" in data
        assert "created_at" in data
        assert "roles" in data
        assert isinstance(data["roles"], list)

    def test_get_detail_404_for_nonexistent(self, client, admin_user):
        resp = client.get(
            "/api/users/99999",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "User not found"

    def test_get_detail_requires_auth(self, client, teacher):
        resp = client.get(f"/api/users/{teacher['user_id']}")
        assert resp.status_code == 401

    def test_get_detail_forbidden_for_non_admin(self, client, teacher, student1):
        resp = client.get(
            f"/api/users/{student1['user_id']}",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 403

    def test_get_detail_works_for_org_admin(self, client, org_admin_user, teacher):
        resp = client.get(
            f"/api/users/{teacher['user_id']}",
            headers=auth_header(org_admin_user["token"]),
        )
        assert resp.status_code == 200


# ===========================================================================
# Task 2: Admin override for classrooms
# ===========================================================================


class TestAdminClassroomAccess:
    def test_admin_can_view_any_classroom(self, client, admin_user, teacher, school_id):
        # Teacher creates a classroom
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Admin View Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        assert create_resp.status_code == 201
        classroom_id = create_resp.json()["id"]

        # Admin can view it
        resp = client.get(
            f"/api/classrooms/{classroom_id}",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["id"] == classroom_id

    def test_admin_can_update_any_classroom(self, client, admin_user, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Admin Update Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/classrooms/{classroom_id}",
            json={"name": "Admin Updated"},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Admin Updated"

    def test_admin_can_add_student(self, client, admin_user, teacher, student1, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Admin Add Student", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student1["user_id"]},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 201

    def test_admin_can_remove_student(self, client, admin_user, teacher, student2, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Admin Remove Student", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        # Teacher adds student
        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student2["user_id"]},
            headers=auth_header(teacher["token"]),
        )

        # Admin removes student
        resp = client.delete(
            f"/api/classrooms/{classroom_id}/students/{student2['user_id']}",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 204

    def test_admin_can_list_students(self, client, admin_user, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Admin List Students", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/classrooms/{classroom_id}/students",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200

    def test_org_admin_can_view_any_classroom(self, client, org_admin_user, teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Org Admin View Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/classrooms/{classroom_id}",
            headers=auth_header(org_admin_user["token"]),
        )
        assert resp.status_code == 200

    def test_non_admin_non_owner_still_gets_403(self, client, teacher, other_teacher, school_id):
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Forbidden Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/classrooms/{classroom_id}",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403


# ===========================================================================
# Task 3: Admin classroom creation with explicit teacher_id
# ===========================================================================


class TestAdminCreateClassroomForTeacher:
    def test_admin_creates_classroom_for_another_teacher(
        self, client, admin_user, teacher, school_id,
    ):
        resp = client.post(
            "/api/classrooms",
            json={
                "name": "Delegated Class",
                "school_id": school_id,
                "teacher_id": teacher["user_id"],
            },
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["teacher_id"] == teacher["user_id"]

    def test_non_admin_cannot_set_teacher_id(self, client, teacher, other_teacher, school_id):
        resp = client.post(
            "/api/classrooms",
            json={
                "name": "Forbidden Delegate",
                "school_id": school_id,
                "teacher_id": other_teacher["user_id"],
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "Only admins can create classrooms for other teachers"

    def test_admin_teacher_id_not_found(self, client, admin_user, school_id):
        resp = client.post(
            "/api/classrooms",
            json={
                "name": "Ghost Teacher Class",
                "school_id": school_id,
                "teacher_id": 99999,
            },
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Teacher user not found"

    def test_teacher_id_same_as_self_works_without_admin(
        self, client, teacher, school_id,
    ):
        """If teacher_id == current_user.id, no admin check needed."""
        resp = client.post(
            "/api/classrooms",
            json={
                "name": "Self Teacher Class",
                "school_id": school_id,
                "teacher_id": teacher["user_id"],
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        assert resp.json()["teacher_id"] == teacher["user_id"]

    def test_teacher_id_none_defaults_to_current_user(
        self, client, teacher, school_id,
    ):
        resp = client.post(
            "/api/classrooms",
            json={"name": "Default Teacher", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        assert resp.json()["teacher_id"] == teacher["user_id"]

    def test_org_admin_creates_classroom_for_teacher(
        self, client, org_admin_user, teacher, school_id,
    ):
        resp = client.post(
            "/api/classrooms",
            json={
                "name": "Org Admin Delegated",
                "school_id": school_id,
                "teacher_id": teacher["user_id"],
            },
            headers=auth_header(org_admin_user["token"]),
        )
        assert resp.status_code == 201
        assert resp.json()["teacher_id"] == teacher["user_id"]


# ===========================================================================
# Task 4: GET /api/schools/{school_id}/members
# ===========================================================================


class TestSchoolMembers:
    def test_returns_200(self, client, admin_user, school_id):
        resp = client.get(
            f"/api/schools/{school_id}/members",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_returns_members_with_school_roles(self, client, admin_user, teacher, school_id):
        # Assign teacher role scoped to school
        _assign_school_role(teacher["user_id"], school_id, "teacher")

        resp = client.get(
            f"/api/schools/{school_id}/members",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        assert len(data) >= 1
        teacher_entry = next(
            (m for m in data if m["user_id"] == teacher["user_id"]),
            None,
        )
        assert teacher_entry is not None
        assert teacher_entry["role_name"] == "teacher"
        assert teacher_entry["name"] == teacher["name"]
        assert teacher_entry["email"] == teacher["email"]
        assert "role_display_name" in teacher_entry

    def test_member_has_expected_fields(self, client, admin_user, school_id):
        resp = client.get(
            f"/api/schools/{school_id}/members",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        if len(data) > 0:
            member = data[0]
            assert "user_id" in member
            assert "name" in member
            assert "email" in member
            assert "role_name" in member
            assert "role_display_name" in member

    def test_404_for_nonexistent_school(self, client, admin_user):
        resp = client.get(
            "/api/schools/99999/members",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "School not found"

    def test_requires_auth(self, client, school_id):
        resp = client.get(f"/api/schools/{school_id}/members")
        assert resp.status_code == 401

    def test_empty_when_no_members(self, client, admin_user):
        # Create a new school with no members
        db = TestingSessionLocal()
        school = School(name="Empty School")
        db.add(school)
        db.commit()
        empty_school_id = school.id
        db.close()

        resp = client.get(
            f"/api/schools/{empty_school_id}/members",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_multiple_roles_same_school(self, client, admin_user, student1, school_id):
        # Assign student role scoped to school
        _assign_school_role(student1["user_id"], school_id, "student")

        resp = client.get(
            f"/api/schools/{school_id}/members",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        user_ids = [m["user_id"] for m in data]
        assert student1["user_id"] in user_ids


# ===========================================================================
# Full admin flow test
# ===========================================================================


class TestAdminFullFlow:
    def test_full_admin_flow(self, client, school_id):
        """
        Register admin + teacher + student ->
        Admin lists users -> search works ->
        Admin creates classroom for teacher ->
        Admin adds student -> Admin views detail ->
        Admin removes student -> verify.
        """
        admin = _register_user(client, "flow_admin")
        _make_admin(admin["user_id"])
        teacher = _register_user(client, "flow_teacher")
        student = _register_user(client, "flow_student")
        admin_headers = auth_header(admin["token"])

        # 1. List users
        list_resp = client.get("/api/users", headers=admin_headers)
        assert list_resp.status_code == 200
        assert list_resp.json()["total"] >= 3

        # 2. Search by teacher name
        search_resp = client.get(
            f"/api/users?search={teacher['name'][:5]}",
            headers=admin_headers,
        )
        assert search_resp.status_code == 200
        assert search_resp.json()["total"] >= 1

        # 3. Get teacher detail
        detail_resp = client.get(
            f"/api/users/{teacher['user_id']}",
            headers=admin_headers,
        )
        assert detail_resp.status_code == 200
        assert detail_resp.json()["email"] == teacher["email"]

        # 4. Admin creates classroom for teacher
        create_resp = client.post(
            "/api/classrooms",
            json={
                "name": "Full Flow Class",
                "school_id": school_id,
                "teacher_id": teacher["user_id"],
                "grade": 5,
            },
            headers=admin_headers,
        )
        assert create_resp.status_code == 201
        classroom_id = create_resp.json()["id"]
        assert create_resp.json()["teacher_id"] == teacher["user_id"]

        # 5. Admin adds student to that classroom
        add_resp = client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student["user_id"]},
            headers=admin_headers,
        )
        assert add_resp.status_code == 201

        # 6. Admin views classroom detail
        detail_resp = client.get(
            f"/api/classrooms/{classroom_id}",
            headers=admin_headers,
        )
        assert detail_resp.status_code == 200
        assert detail_resp.json()["student_count"] == 1

        # 7. Admin removes student
        remove_resp = client.delete(
            f"/api/classrooms/{classroom_id}/students/{student['user_id']}",
            headers=admin_headers,
        )
        assert remove_resp.status_code == 204

        # 8. Verify empty
        students_resp = client.get(
            f"/api/classrooms/{classroom_id}/students",
            headers=admin_headers,
        )
        assert students_resp.status_code == 200
        assert len(students_resp.json()) == 0
