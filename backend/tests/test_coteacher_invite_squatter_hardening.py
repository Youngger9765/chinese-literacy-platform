"""Claude Security finding find_01NKQLkX94VWRwpkBgYmc54s (high), CWE-287 --
"Co-teacher invite grants classroom access to squatter who pre-registered
invitee's email".

invite_co_teacher resolved the invitee by email alone: whichever account
held that address got granted, with no check that (a) the account's
ownership of the address was ever verified, or (b) the account held any
teacher standing at all. An anonymous attacker who registers a colleague's
school email before the real colleague does gets full co-teacher access
(roster + every enrolled student's learning records and reading audio) the
moment a classroom owner invites that address, believing it to be the real
colleague.

This file adds BOTH halves of the recommendation as independent,
each-blocks-on-its-own gates:
  1. The invitee's local account must have email_verified=True.
  2. The invitee must already hold an active, school-scoped `teacher` role
     at the classroom's school (uses authz.is_school_teacher, the same
     helper added for create_classroom in this same PR).

Known residual gap, documented not hidden: self-registration currently sets
email_verified=True unconditionally (settings.require_email_verification
defaults to False and there is no outbound-email integration in this repo
to deliver a real verification link -- see notification_service.py's
"log-only" docstring). Gate 1 is therefore not yet load-bearing against a
squatter who *only* self-registers -- it becomes fully protective the
moment real email verification ships. Gate 2 narrows the real-world attack
today: the attacker must ALSO separately self-activate as `teacher`
specifically at the victim's school (POST /users/me/activate-teacher) to
get past it, not just hold any account.

Uses a dedicated engine (same TestClient + SQLite-in-memory pattern as
test_self_serve_teacher_3804.py), NOT test_co_teaching_api.py's, because
that file's `_register()` test helper auto-grants every registered test
user a school-scoped `teacher` role as a matter of test-fixture
convenience -- which would silently make every invitee in that file look
like a legitimately-standing teacher and mask exactly the gap this file
exists to catch.
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
from app.models.school import School
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
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    for r in SEED_ROLES:
        session.add(Role(**r))
    session.commit()
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


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


def _register_login(client, label: str, email: str | None = None) -> tuple[int, str]:
    _reset_rate_limiters()
    uid = uuid.uuid4().hex[:8]
    email = email or f"{label}_{uid}@test.example"
    r = client.post("/api/auth/register", json={"email": email, "password": "Secure99!", "name": label})
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


def _set_email_verified(user_id: int, value: bool) -> None:
    session = TestingSessionLocal()
    try:
        user = session.query(User).filter(User.id == user_id).first()
        user.email_verified = value
        session.commit()
    finally:
        session.close()


def _seed_school() -> int:
    session = TestingSessionLocal()
    school = School(name=f"邀請測試國小_{uuid.uuid4().hex[:6]}")
    session.add(school)
    session.commit()
    sid = school.id
    session.close()
    return sid


def _grant_school_teacher_role(user_id: int, school_id: int) -> None:
    session = TestingSessionLocal()
    try:
        role = session.query(Role).filter(Role.name == "teacher").first()
        session.add(
            UserRole(user_id=user_id, role_id=role.id, scope_type="school", scope_id=str(school_id))
        )
        session.commit()
    finally:
        session.close()


class TestInviteRefusedForAnUnverifiedAccount:
    """Gate 1: email_verified must be True. Simulates the squatted row in
    the state it will be in once real email verification ships (and
    documents, in the module docstring above, that it is not yet
    load-bearing under today's auto-verify default)."""

    def test_invite_is_refused_for_an_unverified_invitee(self, client):
        school_id = _seed_school()
        owner_id, owner_tok = _register_login(client, "invite_owner_unverified")
        _grant_school_teacher_role(owner_id, school_id)
        cls = client.post(
            "/api/classrooms",
            json={"name": "UnverifiedInviteTest", "school_id": school_id, "grade": 4},
            headers=auth_header(owner_tok),
        )
        assert cls.status_code == 201, cls.text
        classroom_id = cls.json()["id"]

        squatter_email = f"squatter_{uuid.uuid4().hex[:6]}@victim-school.example"
        squatter_id, _ = _register_login(client, "squatter", email=squatter_email)
        _grant_school_teacher_role(squatter_id, school_id)  # would otherwise pass gate 2
        _set_email_verified(squatter_id, False)

        resp = client.post(
            f"/api/classrooms/{classroom_id}/teachers",
            json={"email": squatter_email, "role": "viewer"},
            headers=auth_header(owner_tok),
        )
        assert resp.status_code == 409, resp.text

    def test_no_classroomteacher_row_is_created_for_the_refused_invite(self, client):
        from app.models.school import ClassroomTeacher

        school_id = _seed_school()
        owner_id, owner_tok = _register_login(client, "invite_owner_unverified2")
        _grant_school_teacher_role(owner_id, school_id)
        cls = client.post(
            "/api/classrooms",
            json={"name": "UnverifiedInviteTest2", "school_id": school_id, "grade": 4},
            headers=auth_header(owner_tok),
        )
        classroom_id = cls.json()["id"]

        squatter_email = f"squatter2_{uuid.uuid4().hex[:6]}@victim-school.example"
        squatter_id, _ = _register_login(client, "squatter2", email=squatter_email)
        _grant_school_teacher_role(squatter_id, school_id)
        _set_email_verified(squatter_id, False)

        client.post(
            f"/api/classrooms/{classroom_id}/teachers",
            json={"email": squatter_email, "role": "viewer"},
            headers=auth_header(owner_tok),
        )

        session = TestingSessionLocal()
        try:
            row = (
                session.query(ClassroomTeacher)
                .filter(ClassroomTeacher.classroom_id == classroom_id, ClassroomTeacher.teacher_id == squatter_id)
                .first()
            )
        finally:
            session.close()
        assert row is None, "a refused invite must not leave a ClassroomTeacher row behind"


class TestInviteRefusedForAnAccountWithNoTeacherStandingAtTheSchool:
    """Gate 2: the invitee must already hold an active, school-scoped
    `teacher` role at the classroom's own school. This is the gate that
    narrows the real-world attack today, independent of email_verified."""

    def test_invite_is_refused_for_a_verified_account_with_no_teacher_role_there(self, client):
        school_id = _seed_school()
        owner_id, owner_tok = _register_login(client, "invite_owner_noteacher")
        _grant_school_teacher_role(owner_id, school_id)
        cls = client.post(
            "/api/classrooms",
            json={"name": "NoTeacherRoleInviteTest", "school_id": school_id, "grade": 4},
            headers=auth_header(owner_tok),
        )
        classroom_id = cls.json()["id"]

        # A perfectly ordinary, email_verified=True (default) account -- it
        # just never activated as teacher at THIS school. Could be the
        # squatter, or could be a plain student who happens to share an
        # email domain with the school.
        bystander_email = f"bystander_{uuid.uuid4().hex[:6]}@victim-school.example"
        _register_login(client, "bystander", email=bystander_email)

        resp = client.post(
            f"/api/classrooms/{classroom_id}/teachers",
            json={"email": bystander_email, "role": "viewer"},
            headers=auth_header(owner_tok),
        )
        assert resp.status_code == 403, resp.text

    def test_positive_control_a_real_colleague_who_self_activated_there_can_be_invited(self, client):
        """A real colleague who self-activated as teacher at the SAME
        school (the ordinary, legitimate onboarding path) must still be
        invitable -- this isn't "nothing works", it's "unvetted strangers
        don't get in"."""
        school_id = _seed_school()
        owner_id, owner_tok = _register_login(client, "invite_owner_positive")
        _grant_school_teacher_role(owner_id, school_id)
        cls = client.post(
            "/api/classrooms",
            json={"name": "PositiveControlInviteTest", "school_id": school_id, "grade": 4},
            headers=auth_header(owner_tok),
        )
        classroom_id = cls.json()["id"]

        colleague_email = f"colleague_{uuid.uuid4().hex[:6]}@real-school.example"
        _register_login(client, "colleague", email=colleague_email)
        colleague_id = (
            TestingSessionLocal()
            .query(User)
            .filter(User.email == colleague_email)
            .first()
            .id
        )
        _grant_school_teacher_role(colleague_id, school_id)

        resp = client.post(
            f"/api/classrooms/{classroom_id}/teachers",
            json={"email": colleague_email, "role": "editor"},
            headers=auth_header(owner_tok),
        )
        assert resp.status_code == 201, (
            f"positive control failed: a genuinely-activated teacher at the "
            f"SAME school must still be invitable: {resp.status_code} {resp.text}"
        )
