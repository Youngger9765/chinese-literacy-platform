"""
Viewer-vs-editor write-endpoint boundary matrix (#3820).

test_co_teaching_api.py already covers the invite/accept/reject/revoke/role-
change lifecycle plus add-student/create-assignment/grade-submission, and
test_classroom_reset_password.py covers password reset. This file is the rest
of the PRD's endpoint table (docs/prd/2026-11-02-coteacher-viewonly-prd.md
§4): every remaining classroom write-endpoint that was swapped from
owner-only to editor-level, each with a 'viewer cannot' test paired against
an 'editor can' positive control (so a test that silently passes because
NOBODY can do the thing would be caught by its own pair failing).

Uses SQLite in-memory DB, same pattern as test_co_teaching_api.py.
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
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]

_test_school_id: int = 0


def _seed_roles(session):
    for r in SEED_ROLES:
        session.add(Role(name=r["name"], display_name=r["display_name"], scope_level=r["scope_level"]))
    session.commit()


def _seed_school(session) -> int:
    school = School(name="Viewer Role Test School")
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


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _register(client, name, email, password="Password123!"):
    r = client.post("/api/auth/register", json={"name": name, "email": email, "password": password})
    assert r.status_code in (200, 201), r.text
    verification_token = r.json().get("verification_token")
    if verification_token:
        verify_r = client.get(f"/api/auth/verify-email?token={verification_token}")
        assert verify_r.status_code == 200, verify_r.text
    login_r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_r.status_code == 200, login_r.text
    token = login_r.json()["access_token"]

    me_r = client.get("/api/users/me", headers=_h(token))
    user_id = me_r.json()["id"]

    db = TestingSessionLocal()
    try:
        trole = db.query(Role).filter(Role.name == "teacher").first()
        if trole and not db.query(UserRole).filter(
            UserRole.user_id == user_id, UserRole.role_id == trole.id,
            UserRole.scope_type == "school", UserRole.scope_id == str(_test_school_id),
        ).first():
            db.add(UserRole(user_id=user_id, role_id=trole.id,
                             scope_type="school", scope_id=str(_test_school_id)))
            db.commit()
    finally:
        db.close()
    return token, user_id


def _create_classroom(client, owner_token) -> int:
    r = client.post(
        "/api/classrooms",
        json={"name": f"Viewer Role Class {uuid.uuid4().hex[:6]}", "school_id": _test_school_id},
        headers=_h(owner_token),
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _invite_and_accept(client, owner_token, classroom_id, role: str) -> str:
    suffix = uuid.uuid4().hex[:8]
    email = f"{role}_{suffix}@test.com"
    token, teacher_id = _register(client, f"{role.title()} CoTeacher", email)

    invite = client.post(
        f"/api/classrooms/{classroom_id}/teachers",
        json={"email": email, "role": role},
        headers=_h(owner_token),
    )
    assert invite.status_code == 201, invite.text

    accept = client.post(
        f"/api/classrooms/{classroom_id}/teachers/{teacher_id}/accept",
        headers=_h(token),
    )
    assert accept.status_code == 200, accept.text
    return token


def _fresh_student(client) -> dict:
    suffix = uuid.uuid4().hex[:8]
    token, user_id = _register(client, "Viewer Role Student", f"viewerrole_student_{suffix}@test.com")
    grant_school_student_role(TestingSessionLocal, user_id, school_id=_test_school_id)
    return {"token": token, "user_id": user_id}


@pytest.fixture(scope="module", autouse=True)
def setup_module():
    global _test_school_id
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    _test_school_id = _seed_school(session)
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(setup_module):
    return setup_module


@pytest.fixture
def owner_token(client):
    token, _ = _register(client, "Viewer Role Owner", f"viewerrole_owner_{uuid.uuid4().hex[:8]}@test.com")
    return token


# ---------------------------------------------------------------------------
# Classroom settings: PATCH /classrooms/{id}
# ---------------------------------------------------------------------------


def test_viewer_cannot_update_classroom_settings(client, owner_token):
    classroom_id = _create_classroom(client, owner_token)
    viewer = _invite_and_accept(client, owner_token, classroom_id, "viewer")

    r = client.patch(
        f"/api/classrooms/{classroom_id}",
        json={"name": "Viewer should not rename this"},
        headers=_h(viewer),
    )
    assert r.status_code == 403, r.text


def test_editor_can_update_classroom_settings(client, owner_token):
    classroom_id = _create_classroom(client, owner_token)
    editor = _invite_and_accept(client, owner_token, classroom_id, "editor")

    r = client.patch(
        f"/api/classrooms/{classroom_id}",
        json={"name": "Editor can rename this"},
        headers=_h(editor),
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Editor can rename this"


# ---------------------------------------------------------------------------
# Join code: POST /classrooms/{id}/regenerate-code
# ---------------------------------------------------------------------------


def test_viewer_cannot_regenerate_join_code(client, owner_token):
    classroom_id = _create_classroom(client, owner_token)
    viewer = _invite_and_accept(client, owner_token, classroom_id, "viewer")

    r = client.post(f"/api/classrooms/{classroom_id}/regenerate-code", headers=_h(viewer))
    assert r.status_code == 403, r.text


def test_editor_can_regenerate_join_code(client, owner_token):
    classroom_id = _create_classroom(client, owner_token)
    editor = _invite_and_accept(client, owner_token, classroom_id, "editor")

    r = client.post(f"/api/classrooms/{classroom_id}/regenerate-code", headers=_h(editor))
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Text assignment: POST/DELETE /classrooms/{id}/texts
# ---------------------------------------------------------------------------


def test_viewer_cannot_assign_text(client, owner_token):
    classroom_id = _create_classroom(client, owner_token)
    viewer = _invite_and_accept(client, owner_token, classroom_id, "viewer")

    r = client.post(
        f"/api/classrooms/{classroom_id}/texts",
        json={"text_id": "20001", "copyright_confirmed": True},
        headers=_h(viewer),
    )
    assert r.status_code == 403, r.text


def test_editor_can_assign_and_unassign_text(client, owner_token):
    classroom_id = _create_classroom(client, owner_token)
    editor = _invite_and_accept(client, owner_token, classroom_id, "editor")

    r = client.post(
        f"/api/classrooms/{classroom_id}/texts",
        json={"text_id": "20001", "copyright_confirmed": True},
        headers=_h(editor),
    )
    assert r.status_code == 201, r.text

    r2 = client.delete(f"/api/classrooms/{classroom_id}/texts/20001", headers=_h(editor))
    assert r2.status_code == 204, r2.text


# ---------------------------------------------------------------------------
# Batch student creation: POST /classrooms/{id}/students/batch
# ---------------------------------------------------------------------------


def test_viewer_cannot_batch_create_students(client, owner_token):
    classroom_id = _create_classroom(client, owner_token)
    viewer = _invite_and_accept(client, owner_token, classroom_id, "viewer")

    r = client.post(
        f"/api/classrooms/{classroom_id}/students/batch",
        json={"students": [{"name": "小明", "seat_number": "01"}]},
        headers=_h(viewer),
    )
    assert r.status_code == 403, r.text


def test_editor_can_batch_create_students(client, owner_token):
    classroom_id = _create_classroom(client, owner_token)
    editor = _invite_and_accept(client, owner_token, classroom_id, "editor")

    r = client.post(
        f"/api/classrooms/{classroom_id}/students/batch",
        json={"students": [{"name": "小華", "seat_number": "02"}]},
        headers=_h(editor),
    )
    assert r.status_code == 201, r.text


# ---------------------------------------------------------------------------
# CSV student import: POST /classrooms/{id}/students/upload-csv
# ---------------------------------------------------------------------------


def test_viewer_cannot_upload_csv(client, owner_token):
    classroom_id = _create_classroom(client, owner_token)
    viewer = _invite_and_accept(client, owner_token, classroom_id, "viewer")

    csv_bytes = "name,seat_number\n小皎,03\n".encode("utf-8")
    r = client.post(
        f"/api/classrooms/{classroom_id}/students/upload-csv",
        files={"file": ("students.csv", csv_bytes, "text/csv")},
        headers=_h(viewer),
    )
    assert r.status_code == 403, r.text


def test_editor_can_upload_csv(client, owner_token):
    classroom_id = _create_classroom(client, owner_token)
    editor = _invite_and_accept(client, owner_token, classroom_id, "editor")

    csv_bytes = "name,seat_number\n小君,04\n".encode("utf-8")
    r = client.post(
        f"/api/classrooms/{classroom_id}/students/upload-csv",
        files={"file": ("students.csv", csv_bytes, "text/csv")},
        headers=_h(editor),
    )
    assert r.status_code == 201, r.text


# ---------------------------------------------------------------------------
# Teacher instruction create: POST /teacher/students/{id}/instructions
# ---------------------------------------------------------------------------


def test_viewer_cannot_create_student_instruction(client, owner_token):
    classroom_id = _create_classroom(client, owner_token)
    viewer = _invite_and_accept(client, owner_token, classroom_id, "viewer")
    student = _fresh_student(client)
    add = client.post(
        f"/api/classrooms/{classroom_id}/students",
        json={"student_id": student["user_id"]},
        headers=_h(owner_token),
    )
    assert add.status_code == 201, add.text

    r = client.post(
        f"/api/teacher/students/{student['user_id']}/instructions",
        json={"classroom_id": classroom_id, "instruction_type": "general", "content": "Viewer cannot write this"},
        headers=_h(viewer),
    )
    assert r.status_code == 403, r.text


def test_editor_can_create_student_instruction(client, owner_token):
    classroom_id = _create_classroom(client, owner_token)
    editor = _invite_and_accept(client, owner_token, classroom_id, "editor")
    student = _fresh_student(client)
    add = client.post(
        f"/api/classrooms/{classroom_id}/students",
        json={"student_id": student["user_id"]},
        headers=_h(owner_token),
    )
    assert add.status_code == 201, add.text

    r = client.post(
        f"/api/teacher/students/{student['user_id']}/instructions",
        json={"classroom_id": classroom_id, "instruction_type": "general", "content": "Editor can write this"},
        headers=_h(editor),
    )
    assert r.status_code == 201, r.text


# ---------------------------------------------------------------------------
# PK/league/live-quiz feature settings: PATCH /classrooms/{id}/pk-settings
# ---------------------------------------------------------------------------


def test_viewer_cannot_update_pk_settings(client, owner_token):
    classroom_id = _create_classroom(client, owner_token)
    viewer = _invite_and_accept(client, owner_token, classroom_id, "viewer")

    r = client.patch(
        f"/api/classrooms/{classroom_id}/pk-settings",
        json={"live_quiz": True},
        headers=_h(viewer),
    )
    assert r.status_code == 403, r.text


def test_editor_can_update_pk_settings(client, owner_token):
    classroom_id = _create_classroom(client, owner_token)
    editor = _invite_and_accept(client, owner_token, classroom_id, "editor")

    r = client.patch(
        f"/api/classrooms/{classroom_id}/pk-settings",
        json={"live_quiz": True},
        headers=_h(editor),
    )
    assert r.status_code == 200, r.text
    assert r.json()["live_quiz"] is True


def test_viewer_can_view_pk_activity(client, owner_token):
    """Read endpoint: viewer CAN see this (it's a report), unlike the PATCH above."""
    classroom_id = _create_classroom(client, owner_token)
    viewer = _invite_and_accept(client, owner_token, classroom_id, "viewer")

    r = client.get(f"/api/classrooms/{classroom_id}/pk-activity", headers=_h(viewer))
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Viewer CAN still read everything editors can (reports/assignments list)
# ---------------------------------------------------------------------------


def test_viewer_can_list_assignments_and_see_detail(client, owner_token):
    classroom_id = _create_classroom(client, owner_token)
    viewer = _invite_and_accept(client, owner_token, classroom_id, "viewer")

    created = client.post(
        f"/api/classrooms/{classroom_id}/assignments",
        json={"story_id": "20001", "title": "Viewer should still see this"},
        headers=_h(owner_token),
    )
    assert created.status_code == 201, created.text
    assignment_id = created.json()["id"]

    listed = client.get(f"/api/classrooms/{classroom_id}/assignments", headers=_h(viewer))
    assert listed.status_code == 200, listed.text
    assert any(a["id"] == assignment_id for a in listed.json()["items"])

    detail = client.get(f"/api/assignments/{assignment_id}", headers=_h(viewer))
    assert detail.status_code == 200, detail.text


# ---------------------------------------------------------------------------
# live-quiz session start: services/live_quiz/engine._require_classroom_owned_by
#
# Unit-level (not through the full HTTP create_game endpoint): that endpoint
# also requires a feature flag enabled + real lesson_uids, which is unrelated
# machinery this permission change doesn't touch. Calling the function this
# PR actually modified directly is the lowest layer that faithfully exercises
# the change (testing-strategy doctrine: test at the layer the bug/behavior
# actually lives in).
# ---------------------------------------------------------------------------


def test_viewer_cannot_start_live_quiz_session(client, owner_token):
    from fastapi import HTTPException
    from app.services.live_quiz.engine import _require_classroom_owned_by
    from app.models.user import User

    classroom_id = _create_classroom(client, owner_token)
    viewer = _invite_and_accept(client, owner_token, classroom_id, "viewer")
    me = client.get("/api/users/me", headers=_h(viewer))
    viewer_id = me.json()["id"]

    db = TestingSessionLocal()
    try:
        viewer_user = db.query(User).filter(User.id == viewer_id).first()
        with pytest.raises(HTTPException) as exc_info:
            _require_classroom_owned_by(db, classroom_id, viewer_user)
        assert exc_info.value.status_code == 403
    finally:
        db.close()


def test_editor_can_start_live_quiz_session(client, owner_token):
    from app.services.live_quiz.engine import _require_classroom_owned_by
    from app.models.user import User

    classroom_id = _create_classroom(client, owner_token)
    editor = _invite_and_accept(client, owner_token, classroom_id, "editor")
    me = client.get("/api/users/me", headers=_h(editor))
    editor_id = me.json()["id"]

    db = TestingSessionLocal()
    try:
        editor_user = db.query(User).filter(User.id == editor_id).first()
        classroom = _require_classroom_owned_by(db, classroom_id, editor_user)
        assert classroom.id == classroom_id
    finally:
        db.close()
