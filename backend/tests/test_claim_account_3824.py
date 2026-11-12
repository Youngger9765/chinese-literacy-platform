"""
Tests for a student claiming their teacher-created ("child") account as their
own (#3824 — child-account handover), APPROVAL-GATED design.

Design history (why this is approval-gated, not email-verification-gated):
v1 (single-phase) cleared created_by_teacher_id the instant one call
succeeded — a security review (H1) found anyone who merely knew a teacher-
issued card password could permanently strip the real creator's recovery
authority in one shot. v2 (email-verification two-phase) moved completion to
redeeming an emailed token — a SECOND review pass found this only
DOWNGRADES H1: an attacker who sets new_email to an address they control can
file the request and redeem their own token within about a minute, with no
teacher notification. v3 (this suite, Young's explicit direction,
2026-11-03) requires an EXPLICIT APPROVAL by the account's recorded creator
(the "password teacher") before anything transfers — mirrors Junyi's own
model (the creator controls the child account) and closes H1 completely:
whoever merely knows the current password can FILE a request, but nothing
they do by themselves can ever complete it.

  Request  (POST /auth/claim-account): verifies current_password, sets a new
  password immediately, reserves the desired new email in `pending_email`.
  Does NOT touch `email` or `created_by_teacher_id`.

  Approve  (POST /classrooms/{id}/students/{sid}/approve-claim): ONLY the
  recorded password teacher (or system_admin) may call this. Writes
  `pending_email` into `email`, clears `created_by_teacher_id`.

  Reject   (POST /classrooms/{id}/students/{sid}/reject-claim): same gate.
  Clears `pending_email`; created_by_teacher_id is untouched.

  A teacher's ordinary password reset also clears any pending request
  (revocation), since the password the requester proved they knew is no
  longer valid.

Mirrors the fixture style of tests/test_classroom_reset_password.py (#3818),
which this feature builds directly on top of (reset-password and approve/
reject-claim share the exact same authorization gate: require_classroom_editor
+ helpers.require_renameable_student_target — consolidated there during the
#3828 rebase so this suite doesn't carry a second, independently-drifting
copy of the same check).

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
from app.models.school import Classroom, ClassroomStudent, ClassroomTeacher, School
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


def _approve_claim(client, teacher: dict, classroom_id: int, student_id: int):
    return client.post(
        f"/api/classrooms/{classroom_id}/students/{student_id}/approve-claim",
        headers=auth_header(teacher["token"]),
    )


def _reject_claim(client, teacher: dict, classroom_id: int, student_id: int):
    return client.post(
        f"/api/classrooms/{classroom_id}/students/{student_id}/reject-claim",
        headers=auth_header(teacher["token"]),
    )


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
    and a live 'token', plus the owning teacher/classroom.

    Re-logs in AFTER the password change (find_016vZk1d3wRKkhjQMTUbGU6Y,
    2026-11-06): the pre-change login token is now correctly invalidated by
    get_current_user once password_changed_at is set -- reusing it for the
    caller's own subsequent claim-account call would be relying on exactly
    the bug this feature exists to close (a token staying valid across a
    password change it does not know about). The bcrypt hashing in login +
    change-password routinely pushes them into different whole seconds, so
    this is not even the "same instant" edge case -- the old token is
    genuinely, correctly stale by the time this fixture returns.
    """
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

    fresh_token = _login(client, student["email"], first_own_password)

    return {
        **student,
        "password": first_own_password,
        "token": fresh_token,
        "teacher": teacher,
        "classroom_id": classroom_id,
    }


# ---------------------------------------------------------------------------
# Request only reserves a pending state — nothing irreversible yet.
# ---------------------------------------------------------------------------


def test_request_sets_pending_state_not_final(client):
    ctx = _setup_student_ready_to_claim(client, name="request")
    new_email = f"realstudent_{uuid.uuid4().hex[:8]}@example.com"

    resp = _claim_account(
        client, ctx["token"], current_password=ctx["password"], new_email=new_email, new_password="FinalOwn456!"
    )
    assert resp.status_code == 200, resp.text

    after = _get_db_user(ctx["user_id"])
    assert after.email == ctx["email"], "live email must NOT change on request"
    assert after.pending_email == new_email
    assert after.created_by_teacher_id == ctx["teacher"]["user_id"], (
        "creator authority must survive the request -- that is the whole point of H1's fix"
    )

    # The NEW password already works at the OLD email (password changes
    # immediately, same as change-password always has)...
    new_pw_token = _login(client, ctx["email"], "FinalOwn456!")
    assert new_pw_token
    # ...but the NEW email does not resolve to anything yet -- nothing
    # transfers on request alone.
    _reset_rate_limiters()
    bad_login = client.post("/api/auth/login", json={"email": new_email, "password": "FinalOwn456!"})
    assert bad_login.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Coordinator's required test #1 — stolen credentials can file a request,
# but cannot complete the handover by themselves under ANY circumstance.
# ---------------------------------------------------------------------------


def test_stolen_credentials_cannot_transfer_the_account(client):
    """This is the core H1 regression lock. Someone who merely knows the
    account's current password (e.g. read a printed credential card) can
    file a request -- but the account must still belong to the creator
    afterwards, and the "attacker" (who is logged in as the student, not a
    teacher) cannot themselves complete it: they hold no teacher role at
    all, so approve-claim is unreachable to them."""
    ctx = _setup_student_ready_to_claim(client, name="stolen")
    stolen_new_email = f"attacker_controlled_{uuid.uuid4().hex[:8]}@example.com"

    resp = _claim_account(
        client,
        ctx["token"],  # the "attacker" is using the student's own (stolen) session
        current_password=ctx["password"],
        new_email=stolen_new_email,
        new_password="StolenCardClaim456!",
    )
    assert resp.status_code == 200, resp.text  # filing a request is allowed...

    after = _get_db_user(ctx["user_id"])
    assert after.email == ctx["email"], "the account must NOT be transferred by the request alone"
    assert after.created_by_teacher_id == ctx["teacher"]["user_id"], (
        "the real creator must still own this account after a mere request"
    )

    # The "attacker" cannot self-approve: they have no teacher role, so this
    # is rejected before even reaching the creator-identity check.
    #
    # find_016vZk1d3wRKkhjQMTUbGU6Y (2026-11-06): request_claim changes the
    # PASSWORD immediately (only the email is queued as pending_email), so
    # ctx["token"] -- minted before that call -- is now itself correctly
    # stale per this fix. Re-login with the credentials the "attacker"
    # actually possesses (the account's current password, which is now the
    # one they just set) to isolate what this test means to check: the
    # ROLE rejection, not an incidental token-staleness rejection that
    # would mask it.
    attacker_fresh_token = _login(client, ctx["email"], "StolenCardClaim456!")
    self_approve = client.post(
        f"/api/classrooms/{ctx['classroom_id']}/students/{ctx['user_id']}/approve-claim",
        headers=auth_header(attacker_fresh_token),
    )
    assert self_approve.status_code == 403, self_approve.text

    # And the account is still exactly as it was: new email never took effect.
    still_after = _get_db_user(ctx["user_id"])
    assert still_after.email == ctx["email"]
    assert still_after.pending_email == stolen_new_email  # request still sitting there, unapproved
    assert still_after.created_by_teacher_id == ctx["teacher"]["user_id"]


# ---------------------------------------------------------------------------
# Coordinator's required test #2 — a teacher who did NOT create this account
# cannot approve (or reject) the claim.
# ---------------------------------------------------------------------------


def _get_classroom_school_id(classroom_id: int) -> int:
    db = TestingSessionLocal()
    try:
        classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
        assert classroom is not None
        return classroom.school_id
    finally:
        db.close()


def _add_co_teacher(classroom_id: int, teacher_id: int, *, role: str = "editor") -> None:
    """Enroll `teacher_id` as a co-teacher on an EXISTING classroom via the
    real ClassroomTeacher membership row -- default role="editor" is what
    makes require_classroom_editor (the OUTER, classroom-access gate) pass
    for them, so a test using the default actually exercises
    require_renameable_student_target (the INNER, creator-specific gate)
    instead of vacuously passing at the outer gate. role="editor" (not the
    weaker role string this fixture used pre-#3828-rebase) matches both
    #3818's own test_co_teacher_who_is_not_creator_cannot_reset_password_403
    fixture AND the post-rebase outer gate (require_classroom_editor,
    upgraded from require_classroom_member so approve/reject-claim stay
    "the exact same gate" as reset-password, #3820) -- caught by mutation
    testing: the first version of this test used a teacher from an
    unrelated classroom/school, which the outer gate alone already rejects,
    so removing the inner creator-check entirely did NOT turn it red.
    role="viewer" is for the OPPOSITE case: confirming the outer gate itself
    still blocks a read-only co-teacher (independent security review,
    2026-11-03, point 2 — same role #3820 already locks for reset-password,
    but approve/reject-claim had never been exercised against it)."""
    db = TestingSessionLocal()
    try:
        db.add(ClassroomTeacher(classroom_id=classroom_id, teacher_id=teacher_id, role=role))
        db.commit()
    finally:
        db.close()


def test_non_creator_teacher_cannot_approve_403(client):
    """AC2-equivalent (#3818's own pattern): an 'editor'-role co-teacher on
    the SAME classroom (so require_classroom_editor, the OUTER gate,
    passes) is still not the account's password teacher, and must be
    denied by require_renameable_student_target (the INNER gate)
    specifically."""
    ctx = _setup_student_ready_to_claim(client, name="non_creator")
    co_teacher = _register_user(client, "handover_coteacher")
    classroom_school_id = _get_classroom_school_id(ctx["classroom_id"])
    _assign_role(co_teacher["user_id"], "teacher", scope_type="school", scope_id=str(classroom_school_id))
    _add_co_teacher(ctx["classroom_id"], co_teacher["user_id"])

    claim_resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"realstudent_{uuid.uuid4().hex[:8]}@example.com",
        new_password="FinalOwn456!",
    )
    assert claim_resp.status_code == 200, claim_resp.text

    resp = _approve_claim(client, co_teacher, ctx["classroom_id"], ctx["user_id"])
    assert resp.status_code == 403, resp.text

    after = _get_db_user(ctx["user_id"])
    assert after.created_by_teacher_id == ctx["teacher"]["user_id"]
    assert after.pending_email is not None, "an unauthorized approve attempt must not consume the request"


def test_non_creator_teacher_cannot_reject_403(client):
    ctx = _setup_student_ready_to_claim(client, name="non_creator_reject")
    co_teacher = _register_user(client, "handover_coteacher_reject")
    classroom_school_id = _get_classroom_school_id(ctx["classroom_id"])
    _assign_role(co_teacher["user_id"], "teacher", scope_type="school", scope_id=str(classroom_school_id))
    _add_co_teacher(ctx["classroom_id"], co_teacher["user_id"])

    claim_resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"realstudent_{uuid.uuid4().hex[:8]}@example.com",
        new_password="FinalOwn456!",
    )
    assert claim_resp.status_code == 200, claim_resp.text

    resp = _reject_claim(client, co_teacher, ctx["classroom_id"], ctx["user_id"])
    assert resp.status_code == 403, resp.text

    after = _get_db_user(ctx["user_id"])
    assert after.pending_email is not None


def test_viewer_coteacher_cannot_approve_403(client):
    """Independent security review (2026-11-03, point 2): a 'viewer'-role
    (#3820, read-only) co-teacher must be denied at the OUTER gate
    (require_classroom_editor) -- never mind the inner creator-check, they
    shouldn't even get that far. Distinct from
    test_non_creator_teacher_cannot_approve_403 above, which deliberately
    uses role="editor" so THAT test exercises the inner gate instead."""
    ctx = _setup_student_ready_to_claim(client, name="viewer_coteacher")
    viewer = _register_user(client, "handover_viewer")
    classroom_school_id = _get_classroom_school_id(ctx["classroom_id"])
    _assign_role(viewer["user_id"], "teacher", scope_type="school", scope_id=str(classroom_school_id))
    _add_co_teacher(ctx["classroom_id"], viewer["user_id"], role="viewer")

    claim_resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"realstudent_{uuid.uuid4().hex[:8]}@example.com",
        new_password="FinalOwn456!",
    )
    assert claim_resp.status_code == 200, claim_resp.text

    resp = _approve_claim(client, viewer, ctx["classroom_id"], ctx["user_id"])
    assert resp.status_code == 403, resp.text

    after = _get_db_user(ctx["user_id"])
    assert after.created_by_teacher_id == ctx["teacher"]["user_id"]
    assert after.pending_email is not None


def test_viewer_coteacher_cannot_reject_403(client):
    """Same as test_viewer_coteacher_cannot_approve_403, for reject-claim."""
    ctx = _setup_student_ready_to_claim(client, name="viewer_coteacher_reject")
    viewer = _register_user(client, "handover_viewer_reject")
    classroom_school_id = _get_classroom_school_id(ctx["classroom_id"])
    _assign_role(viewer["user_id"], "teacher", scope_type="school", scope_id=str(classroom_school_id))
    _add_co_teacher(ctx["classroom_id"], viewer["user_id"], role="viewer")

    claim_resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"realstudent_{uuid.uuid4().hex[:8]}@example.com",
        new_password="FinalOwn456!",
    )
    assert claim_resp.status_code == 200, claim_resp.text

    resp = _reject_claim(client, viewer, ctx["classroom_id"], ctx["user_id"])
    assert resp.status_code == 403, resp.text

    after = _get_db_user(ctx["user_id"])
    assert after.pending_email is not None


def test_creator_with_revoked_teacher_role_cannot_approve_403(client):
    """Independent security review (2026-11-03, point 1): the account's
    recorded creator (created_by_teacher_id) whose school-scoped `teacher`
    UserRole was deactivated (is_active=False — e.g. offboarded) must still
    be denied. require_renameable_student_target's first check is "caller
    CURRENTLY holds an active teacher role at this classroom's school" --
    this is the fail-closed case that check exists for: knowing you WERE
    the creator is not enough if the role itself was revoked."""
    ctx = _setup_student_ready_to_claim(client, name="revoked_creator")

    claim_resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"realstudent_{uuid.uuid4().hex[:8]}@example.com",
        new_password="FinalOwn456!",
    )
    assert claim_resp.status_code == 200, claim_resp.text

    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == "teacher").first()
        ur = (
            db.query(UserRole)
            .filter(
                UserRole.user_id == ctx["teacher"]["user_id"],
                UserRole.role_id == role.id,
                UserRole.scope_type == "school",
            )
            .first()
        )
        assert ur is not None
        ur.is_active = False
        db.commit()
    finally:
        db.close()

    resp = _approve_claim(client, ctx["teacher"], ctx["classroom_id"], ctx["user_id"])
    assert resp.status_code == 403, resp.text

    after = _get_db_user(ctx["user_id"])
    assert after.created_by_teacher_id == ctx["teacher"]["user_id"]
    assert after.pending_email is not None, (
        "an unauthorized approve attempt (revoked role) must not consume the request"
    )


def test_approve_404_when_student_not_in_this_classroom(client):
    """Independent security review (2026-11-03, point 3): the real creator
    teacher, correctly authenticated, must NOT be able to approve a claim
    by supplying the WRONG classroom_id in the URL (one they also happen to
    be an editor of, but the target student isn't enrolled in). Mirrors
    #3826's own test_rename_404_when_student_not_in_this_classroom --
    _require_enrolled (classroom_password.py) must reject this before the
    creator-check even runs, so a URL-level classroom/student mismatch can
    never be used to approve a claim for a student in a DIFFERENT
    classroom the caller happens to also have editor access to."""
    ctx = _setup_student_ready_to_claim(client, name="wrong_classroom")

    claim_resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"realstudent_{uuid.uuid4().hex[:8]}@example.com",
        new_password="FinalOwn456!",
    )
    assert claim_resp.status_code == 200, claim_resp.text

    # A second classroom, owned by the SAME creator teacher, that the
    # target student is NOT enrolled in.
    other_classroom_id = _create_classroom(
        client, ctx["teacher"], _get_classroom_school_id(ctx["classroom_id"]), name="Unrelated Classroom"
    )

    resp = _approve_claim(client, ctx["teacher"], other_classroom_id, ctx["user_id"])
    assert resp.status_code == 404, resp.text

    after = _get_db_user(ctx["user_id"])
    assert after.created_by_teacher_id == ctx["teacher"]["user_id"]
    assert after.pending_email is not None, (
        "a wrong-classroom approve attempt must not consume the request"
    )


# ---------------------------------------------------------------------------
# Coordinator's required test #3 — creator approves, student logs in with
# their own email, and the creator can no longer reset the password.
# ---------------------------------------------------------------------------


def test_creator_approves_student_logs_in_then_creator_reset_403(client):
    ctx = _setup_student_ready_to_claim(client, name="approve_flow")
    new_email = f"realstudent_{uuid.uuid4().hex[:8]}@example.com"
    claim_resp = _claim_account(
        client, ctx["token"], current_password=ctx["password"], new_email=new_email, new_password="FinalOwn456!"
    )
    assert claim_resp.status_code == 200, claim_resp.text

    approve_resp = _approve_claim(client, ctx["teacher"], ctx["classroom_id"], ctx["user_id"])
    assert approve_resp.status_code == 200, approve_resp.text
    assert approve_resp.json()["email"] == new_email

    after = _get_db_user(ctx["user_id"])
    assert after.email == new_email
    assert after.pending_email is None
    assert after.created_by_teacher_id is None, "this is the moment authority actually transfers"

    # Student logs in with their own new credentials.
    final_login = _login(client, new_email, "FinalOwn456!")
    assert final_login
    # Old (synthetic) email no longer resolves to this account.
    _reset_rate_limiters()
    old_login = client.post("/api/auth/login", json={"email": ctx["email"], "password": "FinalOwn456!"})
    assert old_login.status_code in (401, 403)

    # The original creator can no longer reset this account's password.
    reset_resp = _reset_password(client, ctx["teacher"], ctx["classroom_id"], ctx["user_id"])
    assert reset_resp.status_code == 403, reset_resp.text


def test_creator_rejects_claim_account_unchanged(client):
    ctx = _setup_student_ready_to_claim(client, name="reject_flow")
    claim_resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"realstudent_{uuid.uuid4().hex[:8]}@example.com",
        new_password="FinalOwn456!",
    )
    assert claim_resp.status_code == 200, claim_resp.text

    reject_resp = _reject_claim(client, ctx["teacher"], ctx["classroom_id"], ctx["user_id"])
    assert reject_resp.status_code == 200, reject_resp.text

    after = _get_db_user(ctx["user_id"])
    assert after.pending_email is None
    assert after.email == ctx["email"]
    assert after.created_by_teacher_id == ctx["teacher"]["user_id"], "rejection keeps the creator's authority intact"

    # Creator can still reset (never lost authority).
    reset_resp = _reset_password(client, ctx["teacher"], ctx["classroom_id"], ctx["user_id"])
    assert reset_resp.status_code == 200, reset_resp.text


def test_approve_without_pending_request_404(client):
    ctx = _setup_student_ready_to_claim(client, name="no_pending_approve")
    resp = _approve_claim(client, ctx["teacher"], ctx["classroom_id"], ctx["user_id"])
    assert resp.status_code == 404, resp.text


def test_reject_without_pending_request_404(client):
    ctx = _setup_student_ready_to_claim(client, name="no_pending_reject")
    resp = _reject_claim(client, ctx["teacher"], ctx["classroom_id"], ctx["user_id"])
    assert resp.status_code == 404, resp.text


def test_system_admin_can_approve_claim_200(client):
    ctx = _setup_student_ready_to_claim(client, name="admin_approve")
    system_admin = _register_user(client, "handover_system_admin")
    _assign_role(system_admin["user_id"], "system_admin", scope_type="platform")

    claim_resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"realstudent_{uuid.uuid4().hex[:8]}@example.com",
        new_password="FinalOwn456!",
    )
    assert claim_resp.status_code == 200, claim_resp.text

    resp = _approve_claim(client, system_admin, ctx["classroom_id"], ctx["user_id"])
    assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# A teacher reset during the pending window revokes the request.
# ---------------------------------------------------------------------------


def test_teacher_reset_during_pending_window_revokes_the_request(client):
    ctx = _setup_student_ready_to_claim(client, name="revoke")
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

    after_reset = _get_db_user(ctx["user_id"])
    assert after_reset.pending_email is None, "reset must clear the pending request"
    assert after_reset.created_by_teacher_id == ctx["teacher"]["user_id"]

    # There is nothing left to approve.
    approve_resp = _approve_claim(client, ctx["teacher"], ctx["classroom_id"], ctx["user_id"])
    assert approve_resp.status_code == 404, approve_resp.text


# ---------------------------------------------------------------------------
# H1, second half — claim-account must be unreachable before the forced
# first password change (#3438).
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
# #3833 — a forgotten pending_email must not squat an email target forever.
#
# There is no dedicated "pending_email filed at" column (adding one needs a
# migration, out of scope for this low-priority issue). `updated_at` is
# reused instead: request_claim() is exactly the write that sets BOTH the
# new password hash AND pending_email together in the same transaction, so
# updated_at faithfully captures "when this claim was filed" at that moment.
# See account_claim_service.PENDING_EMAIL_EXPIRY_DAYS for the accepted
# limitation (logging in again also bumps updated_at).
# ---------------------------------------------------------------------------


def _age_pending_claim(user_id: int, days_old: int) -> None:
    """Back-date a user row's updated_at via a raw UPDATE, bypassing the
    ORM's onupdate=func.now() (which would just overwrite a value set
    through the ORM on the next flush)."""
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import update

    db = TestingSessionLocal()
    try:
        db.execute(
            update(User)
            .where(User.id == user_id)
            .values(updated_at=datetime.now(timezone.utc) - timedelta(days=days_old))
        )
        db.commit()
    finally:
        db.close()


def test_stale_pending_claim_is_auto_expired_and_does_not_block_a_new_claim(client):
    """A's claim on `contested_email` is 20 days stale (past the 14-day
    expiry) with no teacher action ever taken on it. B filing the same
    target email must succeed -- A's forgotten claim is treated as if it
    was never filed -- instead of permanently squatting the email."""
    ctx_a = _setup_student_ready_to_claim(client, name="stale_conflict_a")
    ctx_b = _setup_student_ready_to_claim(client, name="stale_conflict_b")
    contested_email = f"stale_contested_{uuid.uuid4().hex[:8]}@example.com"

    first = _claim_account(
        client, ctx_a["token"], current_password=ctx_a["password"], new_email=contested_email, new_password="FinalOwn456!"
    )
    assert first.status_code == 200, first.text
    _age_pending_claim(ctx_a["user_id"], days_old=20)

    second = _claim_account(
        client, ctx_b["token"], current_password=ctx_b["password"], new_email=contested_email, new_password="FinalOwn456!"
    )
    assert second.status_code == 200, second.text

    stale_a = _get_db_user(ctx_a["user_id"])
    assert stale_a.pending_email is None, (
        "the stale claim must be cleared (treated as unfiled), not merely "
        "skipped for the collision check"
    )
    fresh_b = _get_db_user(ctx_b["user_id"])
    assert fresh_b.pending_email == contested_email


def test_recent_pending_claim_still_blocks_even_though_an_older_one_would_expire(client):
    """Positive control for the test above: a claim that is NOT yet stale
    (13 days, just under the 14-day threshold) still blocks a collision --
    proves the fix narrows the block to genuinely stale claims, it does not
    quietly disable the collision check altogether."""
    ctx_a = _setup_student_ready_to_claim(client, name="recent_conflict_a")
    ctx_b = _setup_student_ready_to_claim(client, name="recent_conflict_b")
    contested_email = f"recent_contested_{uuid.uuid4().hex[:8]}@example.com"

    first = _claim_account(
        client, ctx_a["token"], current_password=ctx_a["password"], new_email=contested_email, new_password="FinalOwn456!"
    )
    assert first.status_code == 200, first.text
    _age_pending_claim(ctx_a["user_id"], days_old=13)

    second = _claim_account(
        client, ctx_b["token"], current_password=ctx_b["password"], new_email=contested_email, new_password="FinalOwn456!"
    )
    assert second.status_code == 409, second.text


def test_a_stale_claim_on_a_live_email_still_blocks_live_emails_never_expire(client):
    """A LIVE email (another account's actual `email`, not a pending
    target) must never be treated as expirable, no matter how old that
    account's `updated_at` is -- expiry only ever applies to a PENDING
    claim, never to someone's real, already-owned address."""
    other = _register_user(client, "handover_live_email_old")
    _age_pending_claim(other["user_id"], days_old=999)
    ctx = _setup_student_ready_to_claim(client, name="live_email_vs_stale")

    resp = _claim_account(
        client, ctx["token"], current_password=ctx["password"], new_email=other["email"], new_password="FinalOwn456!"
    )
    assert resp.status_code == 409, resp.text


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
# Coordinator's required test #4 — claiming (through approval) does not move
# or break any user_id-linked data.
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
    # find_016vZk1d3wRKkhjQMTUbGU6Y (2026-11-06): the pre-change token is
    # now correctly stale after change-password sets password_changed_at --
    # re-login for the token this test reuses below (same fix as
    # _setup_student_ready_to_claim's own re-login).
    token = _login(client, student["email"], first_own_password)

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
    approve_resp = _approve_claim(client, teacher, classroom_id, student["user_id"])
    assert approve_resp.status_code == 200, approve_resp.text

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
# AC7 / L1 — audit trail covers request (success + failure), approval, and
# rejection/revocation.
# ---------------------------------------------------------------------------


def test_request_success_and_failure_both_emit_audit_log(client, caplog):
    ctx = _setup_student_ready_to_claim(client, name="audit_request")

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


def test_approve_emits_audit_log(client, caplog):
    ctx = _setup_student_ready_to_claim(client, name="audit_approve")
    claim_resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"realstudent_{uuid.uuid4().hex[:8]}@example.com",
        new_password="FinalOwn456!",
    )
    assert claim_resp.status_code == 200, claim_resp.text

    with caplog.at_level(logging.INFO, logger="audit"):
        approve_resp = _approve_claim(client, ctx["teacher"], ctx["classroom_id"], ctx["user_id"])
    assert approve_resp.status_code == 200, approve_resp.text

    audit_messages = [r.getMessage() for r in caplog.records if r.name == "audit"]
    assert any(
        '"claim_account_completed"' in msg and f'"target_student_id": {ctx["user_id"]}' in msg
        for msg in audit_messages
    ), audit_messages


def test_reject_emits_audit_log(client, caplog):
    ctx = _setup_student_ready_to_claim(client, name="audit_reject")
    claim_resp = _claim_account(
        client,
        ctx["token"],
        current_password=ctx["password"],
        new_email=f"realstudent_{uuid.uuid4().hex[:8]}@example.com",
        new_password="FinalOwn456!",
    )
    assert claim_resp.status_code == 200, claim_resp.text

    with caplog.at_level(logging.INFO, logger="audit"):
        reject_resp = _reject_claim(client, ctx["teacher"], ctx["classroom_id"], ctx["user_id"])
    assert reject_resp.status_code == 200, reject_resp.text

    audit_messages = [r.getMessage() for r in caplog.records if r.name == "audit"]
    assert any(
        '"claim_account_revoked"' in msg and '"rejected_by_creator"' in msg
        for msg in audit_messages
    ), audit_messages


def test_revocation_via_reset_emits_audit_log(client, caplog):
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
    assert any(
        '"claim_account_revoked"' in msg and '"password_reset_by_creator"' in msg
        for msg in audit_messages
    ), audit_messages


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
# L2 — a genuine race on the same target email at approval time (not the
# common case phase 1 already rejects) fails closed with 409, not a bare 500.
# ---------------------------------------------------------------------------


def test_approve_race_on_same_email_returns_409_not_500(client):
    ctx_a = _setup_student_ready_to_claim(client, name="race_a")
    ctx_b = _setup_student_ready_to_claim(client, name="race_b")
    contested_email = f"raced_{uuid.uuid4().hex[:8]}@example.com"

    claim_a = _claim_account(
        client, ctx_a["token"], current_password=ctx_a["password"], new_email=contested_email, new_password="FinalOwn456!"
    )
    assert claim_a.status_code == 200, claim_a.text

    # Force B into the SAME pending state directly at the DB layer, bypassing
    # the request-time uniqueness check -- this is what a genuine race (two
    # requests both reading the DB before either commits) would produce.
    db = TestingSessionLocal()
    try:
        user_b = db.query(User).filter(User.id == ctx_b["user_id"]).first()
        assert user_b is not None
        user_b.pending_email = contested_email
        db.commit()
    finally:
        db.close()

    approve_a = _approve_claim(client, ctx_a["teacher"], ctx_a["classroom_id"], ctx_a["user_id"])
    assert approve_a.status_code == 200, approve_a.text

    approve_b = _approve_claim(client, ctx_b["teacher"], ctx_b["classroom_id"], ctx_b["user_id"])
    assert approve_b.status_code == 409, approve_b.text

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


def test_approve_requires_auth_401(client):
    ctx = _setup_student_ready_to_claim(client, name="approve_auth")
    resp = client.post(f"/api/classrooms/{ctx['classroom_id']}/students/{ctx['user_id']}/approve-claim")
    assert resp.status_code == 401
