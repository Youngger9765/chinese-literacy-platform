"""
Tests for a student claiming their teacher-created ("child") account as their
own (#3824 — child-account handover), TWO-PHASE design.

History: the first version of this feature cleared created_by_teacher_id the
instant a single claim-account call succeeded. A security review (finding
H1) found that let anyone who merely knew the account's printed card
password (e.g. a classmate who saw it) PERMANENTLY strip the real creator's
recovery authority in one shot — before #3824 existed a stolen card was
recoverable (the teacher could still reset it); the single-phase design made
it not. This suite now exercises the two-phase replacement:

  Phase 1 (POST /auth/claim-account): requests the handover. Sets a NEW
  password immediately, but only RESERVES the new email (`pending_email`)
  and does NOT touch `created_by_teacher_id` — the original teacher can
  still reset the password during this window, which also revokes the
  pending request (see test_teacher_reset_during_pending_window_*).

  Phase 2 (GET/POST /auth/verify-email): redeeming the token actually writes
  the new email and clears created_by_teacher_id. This is the moment that
  matters for authorization — not phase 1.

Mirrors the fixture style of tests/test_classroom_reset_password.py (#3818),
which this feature builds directly on top of.

Run with:
    cd /Users/young/project/chinese-literacy-platform/backend
    source .venv/bin/activate
    python -m pytest tests/test_claim_account_3824.py -q
"""

import logging
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
from app.models.school import ClassroomStudent, School
from app.models.user import Role, User, UserRole


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
    return {"email": email, "password": password, "token": token, "user_id": me_resp.json()["id"]}


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
        else:
            db.commit()
    finally:
        db.close()


def _create_school_for_teacher(teacher_id: int, *, org_id: str | None = None) -> int:
    school_id = _create_org_and_school(org_id) if org_id else _create_org_and_school(f"org-{uuid.uuid4().hex[:8]}")
    _assign_role(teacher_id, "teacher", scope_type="school", scope_id=str(school_id))
    return school_id


def _create_classroom(client, teacher: dict, school_id: int, name: str = "Claim Account Test") -> int:
    resp = client.post(
        "/api/classrooms",
        json={"name": f"{name} {uuid.uuid4().hex[:6]}", "school_id": school_id},
        headers=auth_header(teacher["token"]),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _batch_create_student(
    client, teacher: dict, classroom_id: int, *, name: str = "Batch Student", seat: str | None = None
) -> dict:
    """Create a student through the real batch-create endpoint — the one
    production path that stamps created_by_teacher_id (#3818)."""
    seat_number = seat or uuid.uuid4().hex[:6]
    resp = client.post(
        f"/api/classrooms/{classroom_id}/students/batch",
        json={"students": [{"name": name, "seat_number": seat_number}]},
        headers=auth_header(teacher["token"]),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["errors"] == [], body["errors"]
    created = body["created"][0]
    synthetic_email = f"{created['username'].lower()}@student.lingoleap.local"
    return {
        "user_id": created["user_id"],
        "username": created["username"],
        "password": created["password"],
        "email": synthetic_email,
    }


def _login(client, email: str, password: str) -> str:
    _reset_rate_limiters()
    resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _change_password(client, token: str, *, old_password: str, new_password: str):
    return client.post(
        "/api/auth/change-password",
        json={"old_password": old_password, "new_password": new_password},
        headers=auth_header(token),
    )


def _claim_account(client, caller_token: str, *, current_password: str, new_email: str, new_password: str):
    return client.post(
        "/api/auth/claim-account",
        json={
            "current_password": current_password,
            "new_email": new_email,
            "new_password": new_password,
        },
        headers=auth_header(caller_token),
    )


def _verify_email(client, token: str):
    return client.get(f"/api/auth/verify-email?token={token}")


def _reset_password(client, caller: dict, classroom_id: int, student_id: int):
    return client.post(
        f"/api/classrooms/{classroom_id}/students/{student_id}/reset-password",
        headers=auth_header(caller["token"]),
    )


def _get_db_user(user_id: int) -> User:
    db = TestingSessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        assert user is not None
        db.expunge(user)
        return user
    finally:
        db.close()


def _setup_student_ready_to_claim(client, *, name: str) -> dict:
    """Common fixture path for the happy-path tests: batch-create a student,
    log in, and complete the FORCED first password change (#3438) — a
    prerequisite for reaching claim-account at all (security review finding
    H1: claim-account is deliberately NOT exempt from that gate). Returns the
    student dict with an updated 'password' reflecting the post-change value
    and a live 'token'."""
    teacher = _register_user(client, f"handover_{name}_teacher")
    school_id = _create_school_for_teacher(teacher["user_id"])
    classroom_id = _create_classroom(client, teacher, school_id)
    student = _batch_create_student(client, teacher, classroom_id, name=f"{name} Target")
    token = _login(client, student["email"], student["password"])

    first_own_password = "FirstOwnPassword123!"
    change_resp = _change_password(
        client, token, old_password=student["password"], new_password=first_own_password
    )
    assert change_resp.status_code == 200, change_resp.text

    return {
        **student,
        "password": first_own_password,
        "token": token,
        "teacher": teacher,
        "classroom_id": classroom_id,
    }


# ---------------------------------------------------------------------------
# Phase 1 (request) — pending state, nothing irreversible yet.
# ---------------------------------------------------------------------------


def test_phase1_request_sets_pending_state_not_final(client):
    ctx = _setup_student_ready_to_claim(client, name="phase1")
    new_email = f"realstudent_{uuid.uuid4().hex[:8]}@example.com"

    resp = _claim_account(
        client, ctx["token"], current_password=ctx["password"], new_email=new_email, new_password="FinalOwn456!"
    )
    assert resp.status_code == 200, resp.text
    assert resp.json().get("verification_token"), resp.text

    after = _get_db_user(ctx["user_id"])
    assert after.email == ctx["email"], "live email must NOT change in phase 1"
    assert after.pending_email == new_email
    assert after.created_by_teacher_id == ctx["teacher"]["user_id"], (
        "creator authority must survive phase 1 -- that is the whole point of H1's fix"
    )

    # The NEW password already works (password changes immediately)...
    new_pw_token = _login(client, ctx["email"], "FinalOwn456!")
    assert new_pw_token
    # ...but the NEW email does not resolve to anything yet.
    _reset_rate_limiters()
    bad_login = client.post("/api/auth/login", json={"email": new_email, "password": "FinalOwn456!"})
    assert bad_login.status_code in (401, 403)


def test_phase2_verification_finalizes_the_claim(client):
    ctx = _setup_student_ready_to_claim(client, name="phase2")
    new_email = f"realstudent_{uuid.uuid4().hex[:8]}@example.com"

    claim_resp = _claim_account(
        client, ctx["token"], current_password=ctx["password"], new_email=new_email, new_password="FinalOwn456!"
    )
    assert claim_resp.status_code == 200, claim_resp.text
    token = claim_resp.json()["verification_token"]

    verify_resp = _verify_email(client, token)
    assert verify_resp.status_code == 200, verify_resp.text

    after = _get_db_user(ctx["user_id"])
    assert after.email == new_email
    assert after.pending_email is None
    assert after.created_by_teacher_id is None, "this is the moment authority actually transfers"

    # Positive control: new credentials log in; old email no longer does.
    final_login = _login(client, new_email, "FinalOwn456!")
    assert final_login
    _reset_rate_limiters()
    old_login = client.post("/api/auth/login", json={"email": ctx["email"], "password": "FinalOwn456!"})
    assert old_login.status_code in (401, 403)


# ---------------------------------------------------------------------------
# H1 — the core security fix. A reset by the original creator during the
# pending window both succeeds AND revokes the in-flight claim.
# ---------------------------------------------------------------------------


def test_teacher_can_still_reset_password_during_pending_window_200(client):
    """This is the exact acceptance criterion the security review gave for
    H1: claim moves the account to PENDING, not CLAIMED — the original
    creator's reset must still work (200) while a claim is pending, where
    the single-phase design would have already returned 403."""
    ctx = _setup_student_ready_to_claim(client, name="pending_reset")
    claim_resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"attacker_controlled_{uuid.uuid4().hex[:8]}@example.com",
        new_password="StolenCardClaim456!",
    )
    assert claim_resp.status_code == 200, claim_resp.text

    reset_resp = _reset_password(client, ctx["teacher"], ctx["classroom_id"], ctx["user_id"])
    assert reset_resp.status_code == 200, reset_resp.text


def test_teacher_reset_during_pending_window_revokes_the_claim(client):
    ctx = _setup_student_ready_to_claim(client, name="revoke")
    claim_resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"attacker_controlled_{uuid.uuid4().hex[:8]}@example.com",
        new_password="StolenCardClaim456!",
    )
    assert claim_resp.status_code == 200, claim_resp.text
    stolen_token = claim_resp.json()["verification_token"]

    reset_resp = _reset_password(client, ctx["teacher"], ctx["classroom_id"], ctx["user_id"])
    assert reset_resp.status_code == 200, reset_resp.text

    after_reset = _get_db_user(ctx["user_id"])
    assert after_reset.pending_email is None, "reset must clear the pending claim"
    assert after_reset.created_by_teacher_id == ctx["teacher"]["user_id"], "teacher keeps authority"

    # The token the claimant was holding must now be dead -- they cannot
    # resurrect their claim just because they still have the old token.
    verify_resp = _verify_email(client, stolen_token)
    assert verify_resp.status_code == 400, verify_resp.text

    # And confirm the teacher is STILL the password teacher going forward
    # (a second, fresh reset also succeeds).
    second_reset = _reset_password(client, ctx["teacher"], ctx["classroom_id"], ctx["user_id"])
    assert second_reset.status_code == 200, second_reset.text


def test_after_full_completion_original_creator_cannot_reset_403(client):
    ctx = _setup_student_ready_to_claim(client, name="post_claim")
    new_email = f"realstudent_{uuid.uuid4().hex[:8]}@example.com"
    claim_resp = _claim_account(
        client, ctx["token"], current_password=ctx["password"], new_email=new_email, new_password="FinalOwn456!"
    )
    assert claim_resp.status_code == 200, claim_resp.text
    verify_resp = _verify_email(client, claim_resp.json()["verification_token"])
    assert verify_resp.status_code == 200, verify_resp.text

    reset_resp = _reset_password(client, ctx["teacher"], ctx["classroom_id"], ctx["user_id"])
    assert reset_resp.status_code == 403, reset_resp.text


# ---------------------------------------------------------------------------
# H1, second half — claim-account must be unreachable before the forced
# first password change (#3438), closing the "do everything in one shot off
# a card you merely read" amplifier.
# ---------------------------------------------------------------------------


def test_claim_account_blocked_before_first_password_change_403(client):
    teacher = _register_user(client, "handover_gate_teacher")
    school_id = _create_school_for_teacher(teacher["user_id"])
    classroom_id = _create_classroom(client, teacher, school_id)
    student = _batch_create_student(client, teacher, classroom_id, name="Never Changed Password")
    token = _login(client, student["email"], student["password"])

    resp = _claim_account(
        client,
        token,
        current_password=student["password"],
        new_email=f"shouldnotwork_{uuid.uuid4().hex[:8]}@example.com",
        new_password="WhateverOwn456!",
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"] == "PASSWORD_CHANGE_REQUIRED"

    after = _get_db_user(student["user_id"])
    assert after.pending_email is None
    assert after.created_by_teacher_id == teacher["user_id"]


def test_claim_account_reachable_after_first_password_change(client):
    """Positive control for the test above: the forced-change gate does not
    also block the legitimate case once satisfied."""
    ctx = _setup_student_ready_to_claim(client, name="gate_positive")
    resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"realstudent_{uuid.uuid4().hex[:8]}@example.com",
        new_password="FinalOwn456!",
    )
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# AC3 — wrong current password fails closed; nothing changes.
# ---------------------------------------------------------------------------


def test_wrong_current_password_401_and_fields_unchanged(client):
    ctx = _setup_student_ready_to_claim(client, name="wrong_pw")

    resp = _claim_account(
        client,
        ctx["token"],
        current_password="DefinitelyWrongPassword999!",
        new_email=f"shouldnotbind_{uuid.uuid4().hex[:8]}@example.com",
        new_password="FinalOwn456!",
    )
    assert resp.status_code == 401, resp.text

    after = _get_db_user(ctx["user_id"])
    assert after.email == ctx["email"]
    assert after.pending_email is None
    assert after.created_by_teacher_id == ctx["teacher"]["user_id"]


# ---------------------------------------------------------------------------
# AC4 / M1 — email collision fails closed, and weak-password short-circuits
# BEFORE the email check (closing the free enumeration oracle).
# ---------------------------------------------------------------------------


def test_new_email_already_used_409_and_fields_unchanged(client):
    other = _register_user(client, "handover_other_email")
    ctx = _setup_student_ready_to_claim(client, name="dup_email")

    resp = _claim_account(
        client, ctx["token"], current_password=ctx["password"], new_email=other["email"], new_password="FinalOwn456!"
    )
    assert resp.status_code == 409, resp.text

    after = _get_db_user(ctx["user_id"])
    assert after.email == ctx["email"]
    assert after.pending_email is None
    assert after.created_by_teacher_id == ctx["teacher"]["user_id"]


def test_weak_password_returns_422_even_when_email_already_taken(client):
    """M1 regression lock: before the fix, a weak password + a colliding
    email returned 409 (email check ran first) -- letting an attacker use a
    throwaway weak password as a side-effect-free oracle for "does this
    email exist on the platform?". Strength must be checked first."""
    other = _register_user(client, "handover_other_email2")
    ctx = _setup_student_ready_to_claim(client, name="order_fix")

    resp = _claim_account(
        client, ctx["token"], current_password=ctx["password"], new_email=other["email"], new_password="short"
    )
    assert resp.status_code == 422, resp.text


def test_new_email_already_pending_for_someone_else_409(client):
    """The email-collision check also covers another account's PENDING
    target, not just a live email -- otherwise two accounts could both
    request the same target email and only discover the conflict later."""
    ctx_a = _setup_student_ready_to_claim(client, name="pending_conflict_a")
    ctx_b = _setup_student_ready_to_claim(client, name="pending_conflict_b")
    contested_email = f"contested_{uuid.uuid4().hex[:8]}@example.com"

    first = _claim_account(
        client, ctx_a["token"], current_password=ctx_a["password"], new_email=contested_email, new_password="FinalOwn456!"
    )
    assert first.status_code == 200, first.text

    second = _claim_account(
        client, ctx_b["token"], current_password=ctx_b["password"], new_email=contested_email, new_password="FinalOwn456!"
    )
    assert second.status_code == 409, second.text


# ---------------------------------------------------------------------------
# AC5 — an account that is not a teacher-created child account in the first
# place cannot "claim" itself.
# ---------------------------------------------------------------------------


def test_self_registered_account_claim_400(client):
    self_registered = _register_user(client, "handover_selfreg")

    resp = _claim_account(
        client,
        self_registered["token"],
        current_password=self_registered["password"],
        new_email=f"newmail_{uuid.uuid4().hex[:8]}@example.com",
        new_password="FinalOwn456!",
    )
    assert resp.status_code == 400, resp.text

    after = _get_db_user(self_registered["user_id"])
    assert after.email == self_registered["email"]


# ---------------------------------------------------------------------------
# AC6 — claiming (through full completion) does not move or break any
# user_id-linked data.
# ---------------------------------------------------------------------------


def test_claim_preserves_classroom_membership_and_assignment_submissions(client):
    teacher = _register_user(client, "handover_owner6")
    school_id = _create_school_for_teacher(teacher["user_id"])
    classroom_id = _create_classroom(client, teacher, school_id)

    db = TestingSessionLocal()
    try:
        assignment = Assignment(
            classroom_id=classroom_id,
            teacher_id=teacher["user_id"],
            story_id="1",
            is_active=True,
            assigned_to_all=True,
        )
        db.add(assignment)
        db.commit()
        db.refresh(assignment)
        assignment_id = assignment.id
    finally:
        db.close()

    student = _batch_create_student(client, teacher, classroom_id, name="Data Integrity Target")
    token = _login(client, student["email"], student["password"])
    first_own_password = "FirstOwnPassword123!"
    assert _change_password(client, token, old_password=student["password"], new_password=first_own_password).status_code == 200

    db = TestingSessionLocal()
    try:
        enrollment_before = (
            db.query(ClassroomStudent)
            .filter(ClassroomStudent.classroom_id == classroom_id, ClassroomStudent.student_id == student["user_id"])
            .first()
        )
        assert enrollment_before is not None, "batch-create must enroll the student"

        submission_before = (
            db.query(AssignmentSubmission)
            .filter(AssignmentSubmission.assignment_id == assignment_id, AssignmentSubmission.student_id == student["user_id"])
            .first()
        )
        assert submission_before is not None, "batch-create must back-fill a submission"
        submission_id = submission_before.id
    finally:
        db.close()

    new_email = f"realstudent_{uuid.uuid4().hex[:8]}@example.com"
    claim_resp = _claim_account(
        client, token, current_password=first_own_password, new_email=new_email, new_password="FinalOwn456!"
    )
    assert claim_resp.status_code == 200, claim_resp.text
    verify_resp = _verify_email(client, claim_resp.json()["verification_token"])
    assert verify_resp.status_code == 200, verify_resp.text

    db = TestingSessionLocal()
    try:
        enrollment_after = (
            db.query(ClassroomStudent)
            .filter(ClassroomStudent.classroom_id == classroom_id, ClassroomStudent.student_id == student["user_id"])
            .first()
        )
        assert enrollment_after is not None
        assert enrollment_after.student_id == student["user_id"]

        submission_after = db.query(AssignmentSubmission).filter(AssignmentSubmission.id == submission_id).first()
        assert submission_after is not None
        assert submission_after.student_id == student["user_id"]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# AC7 / L1 — audit trail covers request (success + failure) and completion.
# ---------------------------------------------------------------------------


def test_phase1_success_and_failure_both_emit_audit_log(client, caplog):
    ctx = _setup_student_ready_to_claim(client, name="audit_phase1")

    with caplog.at_level(logging.INFO, logger="audit"):
        wrong_resp = _claim_account(
            client, ctx["token"], current_password="WrongPassword999!", new_email="x@example.com", new_password="FinalOwn456!"
        )
        assert wrong_resp.status_code == 401

        ok_resp = _claim_account(
            client,
            ctx["token"],
            current_password=ctx["password"],
            new_email=f"realstudent_{uuid.uuid4().hex[:8]}@example.com",
            new_password="FinalOwn456!",
        )
        assert ok_resp.status_code == 200, ok_resp.text

    audit_messages = [r.getMessage() for r in caplog.records if r.name == "audit"]
    assert any(
        '"claim_account_requested"' in msg and '"rejected"' in msg and f'"user_id": {ctx["user_id"]}' in msg
        for msg in audit_messages
    ), audit_messages
    assert any(
        '"claim_account_requested"' in msg and '"pending"' in msg and f'"user_id": {ctx["user_id"]}' in msg
        for msg in audit_messages
    ), audit_messages


def test_phase2_completion_emits_audit_log(client, caplog):
    ctx = _setup_student_ready_to_claim(client, name="audit_phase2")
    claim_resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"realstudent_{uuid.uuid4().hex[:8]}@example.com",
        new_password="FinalOwn456!",
    )
    assert claim_resp.status_code == 200, claim_resp.text

    with caplog.at_level(logging.INFO, logger="audit"):
        verify_resp = _verify_email(client, claim_resp.json()["verification_token"])
    assert verify_resp.status_code == 200, verify_resp.text

    audit_messages = [r.getMessage() for r in caplog.records if r.name == "audit"]
    assert any(
        '"claim_account_completed"' in msg and f'"user_id": {ctx["user_id"]}' in msg
        for msg in audit_messages
    ), audit_messages


def test_revocation_emits_audit_log(client, caplog):
    ctx = _setup_student_ready_to_claim(client, name="audit_revoke")
    claim_resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"attacker_{uuid.uuid4().hex[:8]}@example.com",
        new_password="StolenCardClaim456!",
    )
    assert claim_resp.status_code == 200, claim_resp.text

    with caplog.at_level(logging.INFO, logger="audit"):
        reset_resp = _reset_password(client, ctx["teacher"], ctx["classroom_id"], ctx["user_id"])
    assert reset_resp.status_code == 200, reset_resp.text

    audit_messages = [r.getMessage() for r in caplog.records if r.name == "audit"]
    assert any('"claim_account_revoked"' in msg for msg in audit_messages), audit_messages


# ---------------------------------------------------------------------------
# AC8 — weak new password is rejected; nothing changes.
# ---------------------------------------------------------------------------


def test_weak_new_password_422_and_fields_unchanged(client):
    ctx = _setup_student_ready_to_claim(client, name="weak_pw")

    resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"realstudent_{uuid.uuid4().hex[:8]}@example.com",
        new_password="short",
    )
    assert resp.status_code == 422, resp.text

    after = _get_db_user(ctx["user_id"])
    assert after.email == ctx["email"]
    assert after.pending_email is None
    assert after.created_by_teacher_id == ctx["teacher"]["user_id"]


# ---------------------------------------------------------------------------
# M2 — rate limiting bounds current_password / email-collision guessing.
# ---------------------------------------------------------------------------


def test_claim_account_is_rate_limited_per_account(client):
    ctx = _setup_student_ready_to_claim(client, name="rate_limited")

    last_status = None
    for _ in range(10):
        resp = _claim_account(
            client, ctx["token"], current_password="WrongOnPurpose999!", new_email="whatever@example.com", new_password="FinalOwn456!"
        )
        last_status = resp.status_code
        if last_status == 429:
            break
    assert last_status == 429, "expected the per-account bucket to eventually reject with 429"


# ---------------------------------------------------------------------------
# L2 — a genuine race on the same target email at verification time (not the
# common case phase 1 already rejects) fails closed with 409, not a bare 500.
# ---------------------------------------------------------------------------


def test_verification_race_on_same_email_returns_409_not_500(client):
    ctx_a = _setup_student_ready_to_claim(client, name="race_a")
    ctx_b = _setup_student_ready_to_claim(client, name="race_b")
    contested_email = f"raced_{uuid.uuid4().hex[:8]}@example.com"

    claim_a = _claim_account(
        client, ctx_a["token"], current_password=ctx_a["password"], new_email=contested_email, new_password="FinalOwn456!"
    )
    assert claim_a.status_code == 200, claim_a.text
    token_a = claim_a.json()["verification_token"]

    # Force B into the SAME pending state directly at the DB layer, bypassing
    # phase 1's own uniqueness check -- this is what a genuine race (two
    # requests both reading the DB before either commits) would produce.
    db = TestingSessionLocal()
    try:
        user_b = db.query(User).filter(User.id == ctx_b["user_id"]).first()
        assert user_b is not None
        user_b.pending_email = contested_email
        user_b.email_verification_token = "forced-race-token-" + uuid.uuid4().hex
        db.commit()
        token_b = user_b.email_verification_token
    finally:
        db.close()

    verify_a = _verify_email(client, token_a)
    assert verify_a.status_code == 200, verify_a.text

    verify_b = _verify_email(client, token_b)
    assert verify_b.status_code == 409, verify_b.text

    after_b = _get_db_user(ctx_b["user_id"])
    assert after_b.created_by_teacher_id == ctx_b["teacher"]["user_id"], (
        "the loser of the race must NOT have its authority silently transferred"
    )


# ---------------------------------------------------------------------------
# Baseline — unauthenticated callers are rejected.
# ---------------------------------------------------------------------------


def test_requires_auth_401(client):
    resp = client.post(
        "/api/auth/claim-account",
        json={
            "current_password": "whatever",
            "new_email": f"noone_{uuid.uuid4().hex[:8]}@example.com",
            "new_password": "FinalOwn456!",
        },
    )
    assert resp.status_code == 401
