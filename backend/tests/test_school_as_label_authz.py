"""HTTP-level regression lock for #3804 — school-as-teacher-attribute authz.

Covers the bug class left after #3800/#3802 (GET /schools/{id} was fixed,
these siblings were not) plus the org_admin cross-tenant bypass removal and
the SSO/self-join missing-role defect.

Run: cd backend && python -m pytest tests/test_school_as_label_authz.py -v
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
from app.models.organization import Organization
from app.models.school import Classroom, School
from app.models.user import Role, User, UserRole

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


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


def _seed_roles(session):
    for r in SEED_ROLES:
        session.add(Role(**r))
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


def _reset_rate_limiters():
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


def _register_login(client, label: str) -> tuple[int, str]:
    _reset_rate_limiters()
    uid = uuid.uuid4().hex[:8]
    email = f"{label}_{uid}@test.example"
    r = client.post("/api/auth/register", json={
        "email": email,
        "password": "Secure99!",
        "name": label,
    })
    assert r.status_code == 201, r.text
    tok = r.json().get("verification_token")
    if tok:
        client.get(f"/api/auth/verify-email?token={tok}")
    _reset_rate_limiters()
    login = client.post("/api/auth/login", json={"email": email, "password": "Secure99!"})
    assert login.status_code == 200, login.text
    access = login.json()["access_token"]
    me = client.get("/api/users/me", headers=auth_header(access))
    user_id = me.json()["id"]
    return user_id, access


def _assign_role(user_id: int, role_name: str, scope_type: str, scope_id: str | None) -> None:
    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == role_name).first()
        db.add(UserRole(user_id=user_id, role_id=role.id, scope_type=scope_type, scope_id=scope_id))
        db.commit()
    finally:
        db.close()


def _create_school(organization_id: str | None = None) -> int:
    db = TestingSessionLocal()
    try:
        school = School(name=f"School {uuid.uuid4().hex[:6]}", organization_id=organization_id)
        db.add(school)
        db.commit()
        db.refresh(school)
        return school.id
    finally:
        db.close()


def _create_org() -> str:
    db = TestingSessionLocal()
    try:
        org = Organization(name=f"Org {uuid.uuid4().hex[:6]}")
        db.add(org)
        db.commit()
        db.refresh(org)
        return org.id


    finally:
        db.close()


def _create_classroom(school_id: int, teacher_id: int) -> int:
    db = TestingSessionLocal()
    try:
        c = Classroom(school_id=school_id, teacher_id=teacher_id, name="測試班級", is_active=True)
        db.add(c)
        db.commit()
        db.refresh(c)
        return c.id
    finally:
        db.close()


def _user_roles(user_id: int) -> list[tuple[str, str, str | None]]:
    db = TestingSessionLocal()
    try:
        rows = (
            db.query(Role.name, UserRole.scope_type, UserRole.scope_id)
            .join(UserRole, UserRole.role_id == Role.id)
            .filter(UserRole.user_id == user_id, UserRole.is_active == True)  # noqa: E712
            .all()
        )
        return [(r.name, r.scope_type, r.scope_id) for r in rows]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# A. a plain school-scoped teacher reading/writing THEIR OWN school
# ---------------------------------------------------------------------------


class TestOwnSchoolAccess:
    @pytest.fixture(scope="class")
    def actors(self, client):
        school_id = _create_school()
        other_school_id = _create_school()

        teacher_id, teacher_tok = _register_login(client, "own_school_teacher")
        _assign_role(teacher_id, "teacher", "school", str(school_id))
        # (#3804 security review, 2026-11-01) A school-scoped role alone no
        # longer grants the member roster / classroom list -- that gate now
        # also requires owning (or co-teaching) at least one classroom at
        # this school, per Young's own instruction point 4: "宣告了某所學校，
        # 不代表能看到那所學校的其他班". A plain "I belong to this school"
        # teacher gives themselves a classroom here, same as a real teacher
        # would, so this fixture still represents "an ordinary teacher at
        # their own school" -- not "the owner of a school-wide admin view".
        _create_classroom(school_id, teacher_id)

        return {
            "teacher_tok": teacher_tok,
            "school_id": school_id,
            "other_school_id": other_school_id,
        }

    def test_get_school_own_is_200(self, client, actors):
        """Already fixed by #3800/#3802 — locked here too so a regression is caught."""
        r = client.get(f"/api/schools/{actors['school_id']}", headers=auth_header(actors["teacher_tok"]))
        assert r.status_code == 200, r.text

    def test_get_school_other_is_403(self, client, actors):
        r = client.get(f"/api/schools/{actors['other_school_id']}", headers=auth_header(actors["teacher_tok"]))
        assert r.status_code == 403, r.text

    def test_list_school_members_own_is_403_for_plain_teacher(self, client, actors):
        r = client.get(f"/api/schools/{actors['school_id']}/members", headers=auth_header(actors["teacher_tok"]))
        assert r.status_code == 403, r.text  # #3804: roster is admin-only now

    def test_list_school_members_other_is_403(self, client, actors):
        r = client.get(
            f"/api/schools/{actors['other_school_id']}/members",
            headers=auth_header(actors["teacher_tok"]),
        )
        assert r.status_code == 403, r.text

    def test_list_school_classrooms_own_is_403_for_plain_teacher(self, client, actors):
        r = client.get(
            f"/api/schools/{actors['school_id']}/classrooms",
            headers=auth_header(actors["teacher_tok"]),
        )
        assert r.status_code == 403, r.text  # #3804: roster is admin-only now

    def test_list_school_classrooms_other_is_403(self, client, actors):
        r = client.get(
            f"/api/schools/{actors['other_school_id']}/classrooms",
            headers=auth_header(actors["teacher_tok"]),
        )
        assert r.status_code == 403, r.text

    def test_create_semester_for_own_school_is_201(self, client, actors):
        r = client.post(
            f"/api/schools/{actors['school_id']}/semesters",
            json={"name": "114學年第一學期", "start_date": "2025-09-01", "end_date": "2026-01-31"},
            headers=auth_header(actors["teacher_tok"]),
        )
        assert r.status_code == 201, r.text

    def test_create_semester_for_other_school_is_403(self, client, actors):
        r = client.post(
            f"/api/schools/{actors['other_school_id']}/semesters",
            json={"name": "114學年第一學期", "start_date": "2025-09-01", "end_date": "2026-01-31"},
            headers=auth_header(actors["teacher_tok"]),
        )
        assert r.status_code == 403, r.text

    def test_update_semester_for_own_school_is_200(self, client, actors):
        created = client.post(
            f"/api/schools/{actors['school_id']}/semesters",
            json={"name": "114學年第二學期", "start_date": "2026-02-01", "end_date": "2026-06-30"},
            headers=auth_header(actors["teacher_tok"]),
        )
        assert created.status_code == 201, created.text
        semester_id = created.json()["id"]
        r = client.patch(
            f"/api/schools/{actors['school_id']}/semesters/{semester_id}",
            json={"name": "114學年第二學期（改名）"},
            headers=auth_header(actors["teacher_tok"]),
        )
        assert r.status_code == 200, r.text

    def test_activate_semester_for_own_school_is_200(self, client, actors):
        created = client.post(
            f"/api/schools/{actors['school_id']}/semesters",
            json={"name": "115學年第一學期", "start_date": "2026-09-01", "end_date": "2027-01-31"},
            headers=auth_header(actors["teacher_tok"]),
        )
        assert created.status_code == 201, created.text
        semester_id = created.json()["id"]
        r = client.post(
            f"/api/schools/{actors['school_id']}/semesters/{semester_id}/activate",
            headers=auth_header(actors["teacher_tok"]),
        )
        assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# B. org_admin no longer has a cross-tenant bypass
# ---------------------------------------------------------------------------


class TestOrgAdminLosesBypass:
    @pytest.fixture(scope="class")
    def actors(self, client):
        org_id = _create_org()
        school_id = _create_school(organization_id=org_id)

        teacher_id, teacher_tok = _register_login(client, "org_test_teacher")
        _assign_role(teacher_id, "teacher", "school", str(school_id))
        classroom_id = _create_classroom(school_id, teacher_id)

        org_admin_id, org_admin_tok = _register_login(client, "org_test_admin")
        _assign_role(org_admin_id, "org_admin", "organization", org_id)

        return {
            "org_id": org_id,
            "school_id": school_id,
            "classroom_id": classroom_id,
            "org_admin_tok": org_admin_tok,
        }

    def test_org_admin_cannot_list_school_members(self, client, actors):
        r = client.get(
            f"/api/schools/{actors['school_id']}/members",
            headers=auth_header(actors["org_admin_tok"]),
        )
        assert r.status_code == 403, r.text

    def test_org_admin_cannot_list_school_classrooms(self, client, actors):
        r = client.get(
            f"/api/schools/{actors['school_id']}/classrooms",
            headers=auth_header(actors["org_admin_tok"]),
        )
        assert r.status_code == 403, r.text

    def test_org_admin_cannot_write_semester_for_the_school(self, client, actors):
        r = client.post(
            f"/api/schools/{actors['school_id']}/semesters",
            json={"name": "測試學期", "start_date": "2025-09-01", "end_date": "2026-01-31"},
            headers=auth_header(actors["org_admin_tok"]),
        )
        assert r.status_code == 403, r.text

    def test_org_admin_cannot_see_classroom_in_list_my_classrooms(self, client, actors):
        r = client.get("/api/classrooms", headers=auth_header(actors["org_admin_tok"]))
        assert r.status_code == 200, r.text
        ids = [c["id"] for c in r.json()["items"]]
        assert actors["classroom_id"] not in ids, (
            "org_admin must not see another teacher's classroom via the old org bypass"
        )


# ---------------------------------------------------------------------------
# C. self-join (classroom join-by-code) must grant the school-scoped student role
# ---------------------------------------------------------------------------


def _create_bare_user(email: str) -> int:
    """A user with ZERO UserRole rows — mirrors what resolve_google_user() /
    resolve_junyi_user() produce for a brand-new SSO account (neither grants
    any role on account creation)."""
    db = TestingSessionLocal()
    try:
        u = User(email=email, password_hash="x", name=email, is_active=True, email_verified=True)
        db.add(u)
        db.commit()
        db.refresh(u)
        return u.id
    finally:
        db.close()


class TestSelfJoinGrantsSchoolRole:
    def test_join_classroom_by_code_grants_student_school_role(self, client):
        from app.auth.dependencies import get_current_user

        school_id = _create_school()
        teacher_id, teacher_tok = _register_login(client, "joinflow_teacher")
        _assign_role(teacher_id, "teacher", "school", str(school_id))
        classroom_id = _create_classroom(school_id, teacher_id)

        db = TestingSessionLocal()
        try:
            classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
            classroom.join_code = "JOINCOD1"
            db.commit()
        finally:
            db.close()

        # Simulate a bare SSO-created account (no UserRole at all) rather than
        # going through /auth/register — that endpoint is teacher-only and
        # auto-grants a school-scoped teacher role, which is not the scenario
        # being locked here.
        student_id = _create_bare_user(f"joinflow_student_{uuid.uuid4().hex[:8]}@test.example")
        assert _user_roles(student_id) == [], "sanity: a bare SSO-style account starts with no roles"

        from fastapi import Depends

        def _override_current_user(db=Depends(get_db)):
            return db.query(User).filter(User.id == student_id).first()

        app.dependency_overrides[get_current_user] = _override_current_user
        try:
            r = client.post("/api/classrooms/join", json={"join_code": "JOINCOD1"})
        finally:
            app.dependency_overrides.pop(get_current_user, None)
        assert r.status_code == 200, r.text

        roles_after = _user_roles(student_id)
        assert ("student", "school", str(school_id)) in roles_after, (
            f"expected a student role scoped to school {school_id} after joining by code, got {roles_after}"
        )
