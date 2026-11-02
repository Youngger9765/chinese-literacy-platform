"""
Tests for the co-teaching API (Issue #244, extended for #3820).

Covers:
- GET    /api/classrooms/{id}/teachers                 (list teachers)
- POST   /api/classrooms/{id}/teachers                 (invite co-teacher, role required)
- POST   /api/classrooms/{id}/teachers/{tid}/accept     (accept a pending invite)
- DELETE /api/classrooms/{id}/teachers/{tid}            (remove/reject/revoke/leave)

Permission scenarios:
- Owner can invite and remove
- A pending invite grants NO access until accepted
- Once accepted, an 'editor' co-teacher can view and write; a 'viewer'
  co-teacher can view but not write (see test_co_teacher_viewer_role.py for
  the full write-endpoint boundary matrix)
- Stranger cannot access

Uses SQLite in-memory DB.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-244/backend
    python -m pytest tests/test_co_teaching_api.py -v
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
from _school_student import grant_school_student_role


# ---------------------------------------------------------------------------
# DB setup
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _fk(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]

# Module-level state shared across tests
_state: dict = {}
_test_school_id: int = 0


def _seed_roles(session):
    for r in SEED_ROLES:
        session.add(Role(name=r["name"], display_name=r["display_name"], scope_level=r["scope_level"]))
    session.commit()


def _seed_school(session) -> int:
    school = School(name="Test School")
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


def _register(client, name, email, password="Password123!"):
    """Register a user, verify their email (dev-mode token), then login to get JWT."""
    r = client.post("/api/auth/register", json={
        "name": name,
        "email": email,
        "password": password,
    })
    assert r.status_code in (200, 201), r.text
    # Dev mode returns verification_token directly; verify it before login
    verification_token = r.json().get("verification_token")
    if verification_token:
        verify_r = client.get(f"/api/auth/verify-email?token={verification_token}")
        assert verify_r.status_code == 200, verify_r.text
    # Login to get access_token
    login_r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_r.status_code == 200, login_r.text
    token = login_r.json()["access_token"]

    me_r = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    user_id = me_r.json()["id"]

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

    return token


def _create_classroom(client, token, school_id):
    r = client.post("/api/classrooms", json={"name": "Test Class", "school_id": school_id},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_module():
    """Create tables, seed data, register users, create classroom."""
    global _test_school_id
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    school_id = _seed_school(session)
    _test_school_id = school_id
    session.close()

    app.dependency_overrides[get_db] = _override_get_db

    with TestClient(app) as client:
        _state["client"] = client
        _state["owner_token"] = _register(client, "Owner Teacher", "owner@test.com")
        _state["co_teacher_token"] = _register(client, "Co Teacher", "coteacher@test.com")
        _state["stranger_token"] = _register(client, "Stranger", "stranger@test.com")

        cr = _create_classroom(client, _state["owner_token"], school_id)
        _state["classroom_id"] = cr["id"]
        _state["owner_id"] = cr["teacher_id"]

        yield

    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    return _state["client"]


@pytest.fixture
def owner_token():
    return _state["owner_token"]


@pytest.fixture
def co_teacher_token():
    return _state["co_teacher_token"]


@pytest.fixture
def stranger_token():
    return _state["stranger_token"]


@pytest.fixture
def classroom_id():
    return _state["classroom_id"]


@pytest.fixture
def owner_id():
    return _state["owner_id"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _fresh_co_teacher(client, owner_token, classroom_id, role: str = "editor") -> str:
    """Register+invite+accept a brand-new co-teacher, returning their token.

    Accepting immediately mirrors what a real invitee does after an invite —
    most callers of this helper want to assert on *accepted* co-teacher
    access, not on the pending state itself (see
    test_pending_co_teacher_has_no_access for that).
    """
    suffix = uuid.uuid4().hex[:8]
    email = f"{role}_{suffix}@test.com"
    token = _register(client, f"{role.title()} Co Teacher", email)
    me = client.get("/api/users/me", headers=_h(token))
    assert me.status_code == 200, me.text
    teacher_id = me.json()["id"]

    invite = client.post(
        f"/api/classrooms/{classroom_id}/teachers",
        json={"email": email, "role": role},
        headers=_h(owner_token),
    )
    assert invite.status_code == 201, invite.text
    assert invite.json()["status"] == "pending"

    accept = client.post(
        f"/api/classrooms/{classroom_id}/teachers/{teacher_id}/accept",
        headers=_h(token),
    )
    assert accept.status_code == 200, accept.text
    assert accept.json()["status"] == "accepted"
    return token


def _fresh_student(client) -> dict:
    suffix = uuid.uuid4().hex[:8]
    token = _register(client, "Boundary Student", f"boundary_student_{suffix}@test.com")
    me = client.get("/api/users/me", headers=_h(token))
    assert me.status_code == 200, me.text
    # #3534: a real student of the boundary classrooms' school, so it can be enrolled.
    grant_school_student_role(TestingSessionLocal, me.json()["id"], school_id=_test_school_id)
    return {"token": token, "user_id": me.json()["id"]}


def _create_assignment(client, owner_token, classroom_id) -> int:
    r = client.post(
        f"/api/classrooms/{classroom_id}/assignments",
        json={"story_id": "20001", "title": f"Co-teacher Boundary {uuid.uuid4().hex[:6]}"},
        headers=_h(owner_token),
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _create_boundary_classroom(client, owner_token) -> int:
    r = client.post(
        "/api/classrooms",
        json={"name": f"Boundary Class {uuid.uuid4().hex[:6]}", "school_id": _test_school_id},
        headers=_h(owner_token),
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _first_submission_id(assignment_id: int) -> int:
    from app.models.assignment import AssignmentSubmission

    db = TestingSessionLocal()
    try:
        submission = (
            db.query(AssignmentSubmission)
            .filter(AssignmentSubmission.assignment_id == assignment_id)
            .first()
        )
        assert submission is not None, "assignment setup should create at least one submission"
        return submission.id
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_list_teachers_includes_primary_owner(client, owner_token, classroom_id, owner_id):
    """After classroom creation, GET /teachers should return 1 primary teacher."""
    r = client.get(f"/api/classrooms/{classroom_id}/teachers", headers=_h(owner_token))
    assert r.status_code == 200
    teachers = r.json()
    assert len(teachers) == 1
    assert teachers[0]["role"] == "primary"
    assert teachers[0]["teacher_id"] == owner_id


def test_stranger_cannot_list_teachers(client, stranger_token, classroom_id):
    """Stranger cannot see teacher list."""
    r = client.get(f"/api/classrooms/{classroom_id}/teachers", headers=_h(stranger_token))
    assert r.status_code == 403


def test_invite_co_teacher(client, owner_token, classroom_id):
    """Owner can invite a co-teacher by email, specifying a role. Starts pending."""
    r = client.post(
        f"/api/classrooms/{classroom_id}/teachers",
        json={"email": "coteacher@test.com", "role": "editor"},
        headers=_h(owner_token),
    )
    assert r.status_code == 201
    data = r.json()
    assert data["role"] == "editor"
    assert data["status"] == "pending"
    assert data["accepted_at"] is None
    assert data["classroom_id"] == classroom_id


def test_invite_requires_role(client, owner_token, classroom_id):
    """role is a required field -- #3820 invites must say editor or viewer."""
    r = client.post(
        f"/api/classrooms/{classroom_id}/teachers",
        json={"email": "stranger@test.com"},
        headers=_h(owner_token),
    )
    assert r.status_code == 422


def test_list_teachers_after_invite(client, owner_token, classroom_id):
    """After invite, list should have 2 teachers (one still pending)."""
    r = client.get(f"/api/classrooms/{classroom_id}/teachers", headers=_h(owner_token))
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_pending_co_teacher_has_no_access(client, co_teacher_token, classroom_id):
    """A pending invite grants NO access until accepted -- #3820 core invariant."""
    r = client.get(f"/api/classrooms/{classroom_id}/teachers", headers=_h(co_teacher_token))
    assert r.status_code == 403

    r = client.get(f"/api/classrooms/{classroom_id}", headers=_h(co_teacher_token))
    assert r.status_code == 403

    r = client.get("/api/classrooms", headers=_h(co_teacher_token))
    assert r.status_code == 200
    ids = [c["id"] for c in r.json()["items"]]
    assert classroom_id not in ids, "pending invite must not surface in the dashboard list"


def test_pending_invitation_appears_in_my_invitations(client, co_teacher_token, classroom_id):
    """The invitee can discover their pending invite via the dedicated endpoint."""
    me = client.get("/api/users/me", headers=_h(co_teacher_token))
    my_id = me.json()["id"]

    r = client.get("/api/co-teaching/invitations", headers=_h(co_teacher_token))
    assert r.status_code == 200
    invites = r.json()
    match = next(i for i in invites if i["classroom_id"] == classroom_id and i["role"] == "editor")
    # teacher_id must be the invitee's own user id -- it's what the accept/
    # DELETE endpoints key off in their URL path, NOT the ClassroomTeacher
    # row's own id (classroom_teacher_id is a distinct, informational field).
    assert match["teacher_id"] == my_id


def test_other_user_cannot_accept_someone_elses_invitation(client, stranger_token, owner_id, classroom_id):
    """Only the invitee can accept their own invitation."""
    r = client.post(
        f"/api/classrooms/{classroom_id}/teachers/{owner_id}/accept",
        headers=_h(stranger_token),
    )
    assert r.status_code == 403


def test_co_teacher_accepts_invitation(client, co_teacher_token, classroom_id):
    """Invitee accepts -- status flips to accepted and they gain access."""
    me = client.get("/api/users/me", headers=_h(co_teacher_token))
    teacher_id = me.json()["id"]

    r = client.post(
        f"/api/classrooms/{classroom_id}/teachers/{teacher_id}/accept",
        headers=_h(co_teacher_token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "accepted"
    assert r.json()["accepted_at"] is not None


def test_accept_already_accepted_invitation_returns_409(client, co_teacher_token, classroom_id):
    """Accepting a non-pending invitation (already accepted by the previous test) 409s."""
    me = client.get("/api/users/me", headers=_h(co_teacher_token))
    teacher_id = me.json()["id"]

    r = client.post(
        f"/api/classrooms/{classroom_id}/teachers/{teacher_id}/accept",
        headers=_h(co_teacher_token),
    )
    assert r.status_code == 409


def test_co_teacher_can_list_teachers(client, co_teacher_token, classroom_id):
    """Once accepted, co-teacher can view the teacher list."""
    r = client.get(f"/api/classrooms/{classroom_id}/teachers", headers=_h(co_teacher_token))
    assert r.status_code == 200


def test_co_teacher_can_view_classroom(client, co_teacher_token, classroom_id):
    """Once accepted, co-teacher can GET classroom detail."""
    r = client.get(f"/api/classrooms/{classroom_id}", headers=_h(co_teacher_token))
    assert r.status_code == 200


def test_co_teacher_sees_classroom_in_dashboard(client, co_teacher_token, classroom_id):
    """Once accepted, co-teacher should see the classroom in GET /classrooms list."""
    r = client.get("/api/classrooms", headers=_h(co_teacher_token))
    assert r.status_code == 200
    ids = [c["id"] for c in r.json()["items"]]
    assert classroom_id in ids


def test_viewer_cannot_create_assignment(client, owner_token):
    """Viewer co-teacher can read the classroom but cannot create assignments (#3820)."""
    classroom_id = _create_boundary_classroom(client, owner_token)
    token = _fresh_co_teacher(client, owner_token, classroom_id, role="viewer")

    read = client.get(f"/api/classrooms/{classroom_id}", headers=_h(token))
    assert read.status_code == 200

    r = client.post(
        f"/api/classrooms/{classroom_id}/assignments",
        json={"story_id": "20001", "title": "Viewer should be read-only"},
        headers=_h(token),
    )
    assert r.status_code == 403, r.text


def test_editor_can_create_assignment(client, owner_token):
    """Positive control: editor co-teacher CAN create assignments (#3820)."""
    classroom_id = _create_boundary_classroom(client, owner_token)
    token = _fresh_co_teacher(client, owner_token, classroom_id, role="editor")

    r = client.post(
        f"/api/classrooms/{classroom_id}/assignments",
        json={"story_id": "20001", "title": "Editor can create assignments"},
        headers=_h(token),
    )
    assert r.status_code == 201, r.text


def test_viewer_cannot_add_student(client, owner_token):
    """Viewer co-teacher can read the classroom but cannot add students (#3820)."""
    classroom_id = _create_boundary_classroom(client, owner_token)
    token = _fresh_co_teacher(client, owner_token, classroom_id, role="viewer")
    student = _fresh_student(client)

    read = client.get(f"/api/classrooms/{classroom_id}", headers=_h(token))
    assert read.status_code == 200

    r = client.post(
        f"/api/classrooms/{classroom_id}/students",
        json={"student_id": student["user_id"]},
        headers=_h(token),
    )
    assert r.status_code == 403, r.text


def test_editor_can_add_student(client, owner_token):
    """Positive control: editor co-teacher CAN add students (#3820)."""
    classroom_id = _create_boundary_classroom(client, owner_token)
    token = _fresh_co_teacher(client, owner_token, classroom_id, role="editor")
    student = _fresh_student(client)

    r = client.post(
        f"/api/classrooms/{classroom_id}/students",
        json={"student_id": student["user_id"]},
        headers=_h(token),
    )
    assert r.status_code == 201, r.text


def test_viewer_cannot_grade_submission(client, owner_token):
    """Viewer co-teacher can read the classroom but cannot grade submissions (#3820)."""
    classroom_id = _create_boundary_classroom(client, owner_token)
    token = _fresh_co_teacher(client, owner_token, classroom_id, role="viewer")
    student = _fresh_student(client)
    add = client.post(
        f"/api/classrooms/{classroom_id}/students",
        json={"student_id": student["user_id"]},
        headers=_h(owner_token),
    )
    assert add.status_code == 201, add.text
    assignment_id = _create_assignment(client, owner_token, classroom_id)
    submission_id = _first_submission_id(assignment_id)

    read = client.get(f"/api/classrooms/{classroom_id}", headers=_h(token))
    assert read.status_code == 200

    r = client.patch(
        f"/api/assignments/{assignment_id}/submissions/{submission_id}",
        json={"score": 88, "teacher_feedback": "Viewer grading must be denied"},
        headers=_h(token),
    )
    assert r.status_code == 403, r.text


def test_editor_can_grade_submission(client, owner_token):
    """Positive control: editor co-teacher CAN grade submissions (#3820)."""
    classroom_id = _create_boundary_classroom(client, owner_token)
    token = _fresh_co_teacher(client, owner_token, classroom_id, role="editor")
    student = _fresh_student(client)
    add = client.post(
        f"/api/classrooms/{classroom_id}/students",
        json={"student_id": student["user_id"]},
        headers=_h(owner_token),
    )
    assert add.status_code == 201, add.text
    assignment_id = _create_assignment(client, owner_token, classroom_id)
    submission_id = _first_submission_id(assignment_id)

    r = client.patch(
        f"/api/assignments/{assignment_id}/submissions/{submission_id}",
        json={"score": 91, "teacher_feedback": "Editor grading is allowed"},
        headers=_h(token),
    )
    assert r.status_code == 200, r.text


def test_co_teacher_cannot_invite_others(client, co_teacher_token, classroom_id):
    """Co-teacher (any role) cannot invite another teacher -- owner-only (#3820 req #4)."""
    r = client.post(
        f"/api/classrooms/{classroom_id}/teachers",
        json={"email": "stranger@test.com", "role": "editor"},
        headers=_h(co_teacher_token),
    )
    assert r.status_code == 403


def test_co_teacher_cannot_change_role(client, co_teacher_token, classroom_id, owner_id):
    """Co-teacher cannot change another co-teacher's role -- owner-only (#3820 req #4)."""
    r = client.patch(
        f"/api/classrooms/{classroom_id}/teachers/{owner_id}",
        json={"role": "viewer"},
        headers=_h(co_teacher_token),
    )
    assert r.status_code == 403


def test_owner_cannot_change_own_role(client, owner_token, classroom_id, owner_id):
    """The owner's 'primary' row cannot be retargeted through this endpoint."""
    r = client.patch(
        f"/api/classrooms/{classroom_id}/teachers/{owner_id}",
        json={"role": "viewer"},
        headers=_h(owner_token),
    )
    assert r.status_code == 400


def test_owner_can_change_co_teacher_role(client, owner_token):
    """Owner can change an accepted co-teacher's role editor<->viewer (#3820 req #4).

    Uses its own boundary classroom -- this test leaves a co-teacher row
    behind by design (to prove the role change held), and must not pollute
    the shared `classroom_id` fixture that the end-of-file cleanup tests
    (test_owner_can_remove_co_teacher / test_list_after_removal_has_one_teacher)
    count rows against.
    """
    classroom_id = _create_boundary_classroom(client, owner_token)
    token = _fresh_co_teacher(client, owner_token, classroom_id, role="editor")
    me = client.get("/api/users/me", headers=_h(token))
    teacher_id = me.json()["id"]

    r = client.patch(
        f"/api/classrooms/{classroom_id}/teachers/{teacher_id}",
        json={"role": "viewer"},
        headers=_h(owner_token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "viewer"
    assert r.json()["status"] == "accepted", "role change must not disturb acceptance status"

    # Now actually blocked from a write, proving the role change took effect
    student = _fresh_student(client)
    write = client.post(
        f"/api/classrooms/{classroom_id}/students",
        json={"student_id": student["user_id"]},
        headers=_h(token),
    )
    assert write.status_code == 403, write.text


def test_duplicate_invite_returns_409(client, owner_token, classroom_id):
    """Inviting the same already-accepted teacher again returns 409."""
    r = client.post(
        f"/api/classrooms/{classroom_id}/teachers",
        json={"email": "coteacher@test.com", "role": "editor"},
        headers=_h(owner_token),
    )
    assert r.status_code == 409


def test_invite_nonexistent_email_returns_404(client, owner_token, classroom_id):
    """Inviting unknown email returns 404."""
    r = client.post(
        f"/api/classrooms/{classroom_id}/teachers",
        json={"email": "nobody@nowhere.com", "role": "editor"},
        headers=_h(owner_token),
    )
    assert r.status_code == 404


def test_cannot_remove_owner_via_co_teaching_endpoint(client, owner_token, classroom_id, owner_id):
    """Attempting to remove the owner via DELETE /teachers/{owner_id} returns 400."""
    r = client.delete(
        f"/api/classrooms/{classroom_id}/teachers/{owner_id}",
        headers=_h(owner_token),
    )
    assert r.status_code == 400


def test_owner_can_revoke_pending_invitation(client, owner_token, classroom_id):
    """Owner can revoke (DELETE) a still-pending invite -- same endpoint as removal."""
    suffix = uuid.uuid4().hex[:8]
    email = f"revoke_me_{suffix}@test.com"
    _register(client, "Revoke Me", email)
    invite = client.post(
        f"/api/classrooms/{classroom_id}/teachers",
        json={"email": email, "role": "viewer"},
        headers=_h(owner_token),
    )
    assert invite.status_code == 201, invite.text
    teacher_id = invite.json()["teacher_id"]

    r = client.delete(
        f"/api/classrooms/{classroom_id}/teachers/{teacher_id}",
        headers=_h(owner_token),
    )
    assert r.status_code == 204


def test_invitee_can_reject_pending_invitation(client, owner_token, classroom_id):
    """The invitee can reject (DELETE their own row) while it's still pending."""
    suffix = uuid.uuid4().hex[:8]
    email = f"reject_me_{suffix}@test.com"
    token = _register(client, "Reject Me", email)
    me = client.get("/api/users/me", headers=_h(token))
    teacher_id = me.json()["id"]

    invite = client.post(
        f"/api/classrooms/{classroom_id}/teachers",
        json={"email": email, "role": "viewer"},
        headers=_h(owner_token),
    )
    assert invite.status_code == 201, invite.text

    r = client.delete(
        f"/api/classrooms/{classroom_id}/teachers/{teacher_id}",
        headers=_h(token),
    )
    assert r.status_code == 204

    # Rejected invite no longer shows up as a pending invitation
    pending = client.get("/api/co-teaching/invitations", headers=_h(token))
    assert all(i["classroom_id"] != classroom_id for i in pending.json())


def test_owner_can_remove_co_teacher(client, owner_token, classroom_id):
    """Owner can remove an accepted co-teacher."""
    r = client.get(f"/api/classrooms/{classroom_id}/teachers", headers=_h(owner_token))
    teachers = r.json()
    editor = next(t for t in teachers if t["role"] == "editor")
    co_teacher_id = editor["teacher_id"]

    r = client.delete(
        f"/api/classrooms/{classroom_id}/teachers/{co_teacher_id}",
        headers=_h(owner_token),
    )
    assert r.status_code == 204


def test_list_after_removal_has_one_teacher(client, owner_token, classroom_id):
    """After removal, only the owner remains."""
    r = client.get(f"/api/classrooms/{classroom_id}/teachers", headers=_h(owner_token))
    assert r.status_code == 200
    assert len(r.json()) == 1
