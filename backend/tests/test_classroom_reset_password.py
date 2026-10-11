"""
Tests for a teacher resetting a student's password (#3384).

Mirrors the fixture style of tests/test_classroom_delete.py.

Run with:
    cd /Users/young/project/chinese-literacy-platform/backend
    source .venv/bin/activate
    python -m pytest tests/test_classroom_reset_password.py -q
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
from app.models.organization import Organization
from app.models.school import ClassroomStudent, ClassroomTeacher, School
from app.models.user import Role, StudentProfile, User, UserRole
from app.services.password_reset_service import generate_password_reset_token


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
        if role_name == "student":
            teacher_role = db.query(Role).filter(Role.name == "teacher").first()
            assert teacher_role is not None
            (
                db.query(UserRole)
                .filter(
                    UserRole.user_id == user_id,
                    UserRole.role_id == teacher_role.id,
                    UserRole.is_active.is_(True),
                )
                .update({UserRole.is_active: False}, synchronize_session=False)
            )
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


def _deactivate_teacher_roles(user_id: int) -> None:
    db = TestingSessionLocal()
    try:
        teacher_role = db.query(Role).filter(Role.name == "teacher").first()
        assert teacher_role is not None
        (
            db.query(UserRole)
            .filter(
                UserRole.user_id == user_id,
                UserRole.role_id == teacher_role.id,
                UserRole.is_active.is_(True),
            )
            .update({UserRole.is_active: False}, synchronize_session=False)
        )
        db.commit()
    finally:
        db.close()


def _deactivate_all_roles(user_id: int) -> None:
    db = TestingSessionLocal()
    try:
        (
            db.query(UserRole)
            .filter(UserRole.user_id == user_id, UserRole.is_active.is_(True))
            .update({UserRole.is_active: False}, synchronize_session=False)
        )
        db.commit()
    finally:
        db.close()


def _create_school_for_teacher(teacher_id: int, *, org_id: str | None = None) -> int:
    school_id = _create_org_and_school(org_id) if org_id else _create_org_and_school(f"org-{uuid.uuid4().hex[:8]}")
    _assign_role(teacher_id, "teacher", scope_type="school", scope_id=str(school_id))
    return school_id


def _create_classroom(client, teacher: dict, school_id: int, name: str = "Reset PW Test") -> int:
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


def _reset_password(client, caller: dict, classroom_id: int, student_id: int):
    return client.post(
        f"/api/classrooms/{classroom_id}/students/{student_id}/reset-password",
        headers=auth_header(caller["token"]),
    )


def test_owner_resets_enrolled_student_password_returns_200_and_new_password_works(client):
    teacher = _register_user(client, "resetpw_owner")
    student = _register_user(client, "resetpw_student")
    school_id = _create_school_for_teacher(teacher["user_id"])
    _assign_role(student["user_id"], "student", scope_type="school", scope_id=str(school_id))
    classroom_id = _create_classroom(client, teacher, school_id)
    _enroll_student(client, teacher, classroom_id, student["user_id"])

    resp = _reset_password(client, teacher, classroom_id, student["user_id"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "password" in body and len(body["password"]) >= 6
    assert "username" in body or "email" in body

    # Positive control: the new password actually works.
    _reset_rate_limiters()
    login_resp = client.post(
        "/api/auth/login",
        json={"email": student["email"], "password": body["password"]},
    )
    assert login_resp.status_code == 200, login_resp.text

    # Old password must no longer work.
    _reset_rate_limiters()
    old_login_resp = client.post(
        "/api/auth/login",
        json={"email": student["email"], "password": "TestOnlyPassword123!"},
    )
    assert old_login_resp.status_code in (401, 403)


def test_other_teacher_cannot_reset_password_403(client):
    owner = _register_user(client, "resetpw_owner2")
    other = _register_user(client, "resetpw_other_teacher")
    student = _register_user(client, "resetpw_student2")
    school_id = _create_school_for_teacher(owner["user_id"])
    _assign_role(other["user_id"], "teacher", scope_type="school", scope_id=str(school_id))
    _assign_role(student["user_id"], "student", scope_type="school", scope_id=str(school_id))
    classroom_id = _create_classroom(client, owner, school_id)
    _enroll_student(client, owner, classroom_id, student["user_id"])

    resp = _reset_password(client, other, classroom_id, student["user_id"])
    assert resp.status_code == 403


def test_student_cannot_reset_own_password_via_teacher_endpoint_403(client):
    teacher = _register_user(client, "resetpw_owner3")
    student = _register_user(client, "resetpw_student3")
    school_id = _create_school_for_teacher(teacher["user_id"])
    _assign_role(student["user_id"], "student", scope_type="school", scope_id=str(school_id))
    classroom_id = _create_classroom(client, teacher, school_id)
    _enroll_student(client, teacher, classroom_id, student["user_id"])

    resp = _reset_password(client, student, classroom_id, student["user_id"])
    assert resp.status_code == 403


def test_student_only_owner_cannot_reset_enrolled_victims_password_403(client):
    caller = _register_user(client, "resetpw_student_only_owner")
    victim = _register_user(client, "resetpw_cross_school_victim")
    caller_school_id = _create_org_and_school(f"org-{uuid.uuid4().hex[:8]}")
    victim_school_id = _create_school_for_teacher(victim["user_id"])
    _assign_role(caller["user_id"], "student", scope_type="school", scope_id=str(caller_school_id))
    _assign_role(victim["user_id"], "student", scope_type="school", scope_id=str(victim_school_id))
    classroom_id = _create_classroom(client, caller, caller_school_id)
    _enroll_student(client, caller, classroom_id, victim["user_id"])

    db = TestingSessionLocal()
    try:
        victim_before = db.query(User).filter(User.id == victim["user_id"]).first()
        assert victim_before is not None
        password_hash_before = victim_before.password_hash
    finally:
        db.close()

    resp = _reset_password(client, caller, classroom_id, victim["user_id"])
    assert resp.status_code == 403, resp.text

    db = TestingSessionLocal()
    try:
        victim_after = db.query(User).filter(User.id == victim["user_id"]).first()
        assert victim_after is not None
        assert victim_after.password_hash == password_hash_before
    finally:
        db.close()


def test_non_enrolled_student_404_or_403(client):
    teacher = _register_user(client, "resetpw_owner4")
    not_enrolled = _register_user(client, "resetpw_not_enrolled")
    school_id = _create_school_for_teacher(teacher["user_id"])
    _assign_role(not_enrolled["user_id"], "student", scope_type="school", scope_id=str(school_id))
    classroom_id = _create_classroom(client, teacher, school_id)
    # Deliberately not enrolled.

    resp = _reset_password(client, teacher, classroom_id, not_enrolled["user_id"])
    assert resp.status_code in (403, 404)


def test_requires_auth_401(client):
    teacher = _register_user(client, "resetpw_owner5")
    student = _register_user(client, "resetpw_student5")
    school_id = _create_school_for_teacher(teacher["user_id"])
    _assign_role(student["user_id"], "student", scope_type="school", scope_id=str(school_id))
    classroom_id = _create_classroom(client, teacher, school_id)
    _enroll_student(client, teacher, classroom_id, student["user_id"])

    resp = client.post(f"/api/classrooms/{classroom_id}/students/{student['user_id']}/reset-password")
    assert resp.status_code == 401


def test_invalid_path_params_422(client):
    """Non-integer classroom_id / student_id must be rejected by FastAPI's own
    path-param validation (422), before any auth/business logic runs."""
    teacher = _register_user(client, "resetpw_owner7")
    resp = client.post(
        "/api/classrooms/not-a-number/students/also-not-a-number/reset-password",
        headers=auth_header(teacher["token"]),
    )
    assert resp.status_code == 422


def test_side_effects_verified_by_direct_db_reread(client):
    """Re-read the DB directly (not through the API) to prove the password
    hash actually changed and password_changed was flipped to False — not
    inferred from the HTTP response alone."""
    teacher = _register_user(client, "resetpw_owner8")
    student = _register_user(client, "resetpw_student8")
    school_id = _create_school_for_teacher(teacher["user_id"])
    _assign_role(student["user_id"], "student", scope_type="school", scope_id=str(school_id))
    classroom_id = _create_classroom(client, teacher, school_id)
    _enroll_student(client, teacher, classroom_id, student["user_id"])

    # Give the student a StudentProfile with password_changed already True,
    # simulating a student who already changed their password once — the
    # reset must flip it back to False to force a change on next login.
    db = TestingSessionLocal()
    try:
        profile = StudentProfile(
            user_id=student["user_id"],
            school_id=school_id,
            student_number=f"S{student['user_id']}",
            password_changed=True,
        )
        db.add(profile)
        db.commit()
        before = db.query(User).filter(User.id == student["user_id"]).first()
        hash_before = before.password_hash
    finally:
        db.close()

    resp = _reset_password(client, teacher, classroom_id, student["user_id"])
    assert resp.status_code == 200, resp.text

    db = TestingSessionLocal()
    try:
        after = db.query(User).filter(User.id == student["user_id"]).first()
        assert after.password_hash != hash_before, "password_hash must change in the DB"
        assert after.student_profile is not None
        assert after.student_profile.password_changed is False, (
            "password_changed must be reset to False to force a change on next login"
        )
    finally:
        db.close()


def test_profileless_student_gets_password_changed_enforced(client):
    teacher = _register_user(client, "resetpw_profileless_owner")
    student = _register_user(client, "resetpw_profileless_student")
    school_id = _create_school_for_teacher(teacher["user_id"])
    _assign_role(student["user_id"], "student", scope_type="school", scope_id=str(school_id))
    classroom_id = _create_classroom(client, teacher, school_id)
    _enroll_student(client, teacher, classroom_id, student["user_id"])

    db = TestingSessionLocal()
    try:
        before = db.query(User).filter(User.id == student["user_id"]).first()
        assert before is not None
        assert before.student_profile is None
    finally:
        db.close()

    resp = _reset_password(client, teacher, classroom_id, student["user_id"])
    assert resp.status_code == 200, resp.text

    db = TestingSessionLocal()
    try:
        after = db.query(User).filter(User.id == student["user_id"]).first()
        assert after is not None
        assert after.student_profile is not None
        assert after.student_profile.password_changed is False
    finally:
        db.close()


def test_teacher_reset_invalidates_outstanding_recovery_token(client):
    teacher = _register_user(client, "resetpw_recovery_owner")
    student = _register_user(client, "resetpw_recovery_student")
    school_id = _create_school_for_teacher(teacher["user_id"])
    _assign_role(student["user_id"], "student", scope_type="school", scope_id=str(school_id))
    classroom_id = _create_classroom(client, teacher, school_id)
    _enroll_student(client, teacher, classroom_id, student["user_id"])

    db = TestingSessionLocal()
    try:
        user = db.query(User).filter(User.id == student["user_id"]).first()
        assert user is not None
        generate_password_reset_token(db, user)
        assert user.password_reset_token is not None
        assert user.password_reset_expires is not None
    finally:
        db.close()

    resp = _reset_password(client, teacher, classroom_id, student["user_id"])
    assert resp.status_code == 200, resp.text

    db = TestingSessionLocal()
    try:
        after = db.query(User).filter(User.id == student["user_id"]).first()
        assert after is not None
        assert after.password_reset_token is None
        assert after.password_reset_expires is None
    finally:
        db.close()


def test_password_never_appears_in_logs(client, caplog):
    teacher = _register_user(client, "resetpw_owner6")
    student = _register_user(client, "resetpw_student6")
    school_id = _create_school_for_teacher(teacher["user_id"])
    _assign_role(student["user_id"], "student", scope_type="school", scope_id=str(school_id))
    classroom_id = _create_classroom(client, teacher, school_id)
    _enroll_student(client, teacher, classroom_id, student["user_id"])

    with caplog.at_level(logging.DEBUG):
        resp = _reset_password(client, teacher, classroom_id, student["user_id"])
    assert resp.status_code == 200, resp.text
    new_password = resp.json()["password"]

    for record in caplog.records:
        assert new_password not in record.getMessage(), (
            "New password leaked into logs — reset-password endpoint must never log the plaintext password"
        )


def test_cannot_reset_password_of_a_teacher_account_403(client):
    owner = _register_user(client, "resetpw_privileged_owner")
    teacher_target = _register_user(client, "resetpw_privileged_teacher")
    owner_school_id = _create_school_for_teacher(owner["user_id"])
    _deactivate_all_roles(teacher_target["user_id"])
    _assign_role(teacher_target["user_id"], "teacher", scope_type="school", scope_id=str(owner_school_id))
    classroom_id = _create_classroom(client, owner, owner_school_id)

    db = TestingSessionLocal()
    try:
        db.add(
            ClassroomStudent(
                classroom_id=classroom_id,
                student_id=teacher_target["user_id"],
            )
        )
        db.commit()
    finally:
        db.close()

    resp = _reset_password(client, owner, classroom_id, teacher_target["user_id"])
    assert resp.status_code == 403, resp.text


def test_cannot_reset_password_of_an_admin_account_403(client):
    owner = _register_user(client, "resetpw_privileged_owner2")
    admin_target = _register_user(client, "resetpw_privileged_admin")
    _deactivate_teacher_roles(admin_target["user_id"])
    _assign_role(admin_target["user_id"], "system_admin", scope_type="platform")
    owner_school_id = _create_school_for_teacher(owner["user_id"])
    classroom_id = _create_classroom(client, owner, owner_school_id)

    db = TestingSessionLocal()
    try:
        db.add(
            ClassroomStudent(
                classroom_id=classroom_id,
                student_id=admin_target["user_id"],
            )
        )
        db.commit()
    finally:
        db.close()

    resp = _reset_password(client, owner, classroom_id, admin_target["user_id"])
    assert resp.status_code == 403, resp.text


def test_co_teacher_can_reset_password_200(client):
    owner = _register_user(client, "resetpw_coteacher_owner")
    co_teacher = _register_user(client, "resetpw_coteacher")
    student = _register_user(client, "resetpw_coteacher_student")
    school_id = _create_school_for_teacher(owner["user_id"])
    _assign_role(co_teacher["user_id"], "teacher", scope_type="school", scope_id=str(school_id))
    _assign_role(student["user_id"], "student", scope_type="school", scope_id=str(school_id))
    classroom_id = _create_classroom(client, owner, school_id)
    _enroll_student(client, owner, classroom_id, student["user_id"])

    db = TestingSessionLocal()
    try:
        db.add(
            ClassroomTeacher(
                classroom_id=classroom_id,
                teacher_id=co_teacher["user_id"],
                role="assistant",
            )
        )
        db.commit()
    finally:
        db.close()

    resp = _reset_password(client, co_teacher, classroom_id, student["user_id"])
    assert resp.status_code == 200, resp.text


def test_gate_matches_get_classroom_detail_semantics(client):
    owner = _register_user(client, "resetpw_gate_owner")
    co_teacher = _register_user(client, "resetpw_gate_coteacher")
    student = _register_user(client, "resetpw_gate_student")
    school_id = _create_school_for_teacher(owner["user_id"])
    _assign_role(co_teacher["user_id"], "teacher", scope_type="school", scope_id=str(school_id))
    _assign_role(student["user_id"], "student", scope_type="school", scope_id=str(school_id))
    classroom_id = _create_classroom(client, owner, school_id)
    _enroll_student(client, owner, classroom_id, student["user_id"])

    db = TestingSessionLocal()
    try:
        db.add(
            ClassroomTeacher(
                classroom_id=classroom_id,
                teacher_id=co_teacher["user_id"],
                role="assistant",
            )
        )
        db.commit()
    finally:
        db.close()

    detail_resp = client.get(
        f"/api/classrooms/{classroom_id}", headers=auth_header(co_teacher["token"])
    )
    reset_resp = _reset_password(client, co_teacher, classroom_id, student["user_id"])

    assert detail_resp.status_code == 200, detail_resp.text
    assert reset_resp.status_code == 200, reset_resp.text


def test_cross_school_student_cannot_have_password_reset_403(client):
    owner = _register_user(client, "resetpw_cross_school_owner")
    victim = _register_user(client, "resetpw_cross_school_victim2")
    school_a_id = _create_school_for_teacher(owner["user_id"], org_id=f"org-{uuid.uuid4().hex[:8]}")
    school_b_id = _create_org_and_school(f"org-{uuid.uuid4().hex[:8]}")
    _assign_role(victim["user_id"], "student", scope_type="school", scope_id=str(school_b_id))
    classroom_id = _create_classroom(client, owner, school_a_id)

    db = TestingSessionLocal()
    try:
        db.add(ClassroomStudent(classroom_id=classroom_id, student_id=victim["user_id"]))
        db.commit()
        victim_before = db.query(User).filter(User.id == victim["user_id"]).first()
        assert victim_before is not None
        password_hash_before = victim_before.password_hash
    finally:
        db.close()

    resp = _reset_password(client, owner, classroom_id, victim["user_id"])
    assert resp.status_code == 403, resp.text

    db = TestingSessionLocal()
    try:
        victim_after = db.query(User).filter(User.id == victim["user_id"]).first()
        assert victim_after is not None
        assert victim_after.password_hash == password_hash_before
    finally:
        db.close()


def test_no_determinable_school_affiliation_still_allows_reset(client):
    owner = _register_user(client, "resetpw_no_profile_owner")
    student = _register_user(client, "resetpw_no_profile_student")
    school_id = _create_school_for_teacher(owner["user_id"])
    _assign_role(student["user_id"], "student", scope_type="school", scope_id=str(school_id))
    classroom_id = _create_classroom(client, owner, school_id)
    _enroll_student(client, owner, classroom_id, student["user_id"])

    db = TestingSessionLocal()
    try:
        student_before = db.query(User).filter(User.id == student["user_id"]).first()
        assert student_before is not None
        assert student_before.student_profile is None
    finally:
        db.close()

    resp = _reset_password(client, owner, classroom_id, student["user_id"])
    assert resp.status_code == 200, resp.text


def test_roleless_sso_style_student_now_denied_403(client):
    owner = _register_user(client, "resetpw_roleless_owner")
    roleless_student = _register_user(client, "resetpw_roleless_sso_student")
    _deactivate_all_roles(roleless_student["user_id"])
    school_id = _create_school_for_teacher(owner["user_id"])
    classroom_id = _create_classroom(client, owner, school_id)
    _enroll_student(client, owner, classroom_id, roleless_student["user_id"])

    db = TestingSessionLocal()
    try:
        active_roles = (
            db.query(UserRole)
            .filter(
                UserRole.user_id == roleless_student["user_id"],
                UserRole.is_active.is_(True),
            )
            .all()
        )
        assert active_roles == []
        target = db.query(User).filter(User.id == roleless_student["user_id"]).first()
        assert target is not None
        assert target.student_profile is None
    finally:
        db.close()

    # Intentionally reverses the previous round's allow-when-no-signal design:
    # the project owner explicitly chose fail-closed for roleless SSO-style targets.
    resp = _reset_password(client, owner, classroom_id, roleless_student["user_id"])
    assert resp.status_code == 403, resp.text


def test_roleless_target_with_mismatching_school_role_still_denied_403(client):
    owner = _register_user(client, "resetpw_roleless_cross_school_owner")
    target = _register_user(client, "resetpw_roleless_cross_school_target")
    _deactivate_all_roles(target["user_id"])
    classroom_school_id = _create_school_for_teacher(owner["user_id"])
    other_school_id = _create_org_and_school(f"org-{uuid.uuid4().hex[:8]}")
    _assign_role(target["user_id"], "teacher", scope_type="school", scope_id=str(other_school_id))
    classroom_id = _create_classroom(client, owner, classroom_school_id)
    _enroll_student(client, owner, classroom_id, target["user_id"])

    db = TestingSessionLocal()
    try:
        active_roles = (
            db.query(UserRole)
            .filter(
                UserRole.user_id == target["user_id"],
                UserRole.is_active.is_(True),
            )
            .all()
        )
        assert len(active_roles) == 1
        assert active_roles[0].scope_id == str(other_school_id)
    finally:
        db.close()

    resp = _reset_password(client, owner, classroom_id, target["user_id"])
    assert resp.status_code == 403, resp.text


def test_system_admin_can_reset_password_200(client):
    owner = _register_user(client, "resetpw_admin_owner")
    system_admin = _register_user(client, "resetpw_system_admin")
    student = _register_user(client, "resetpw_admin_student")
    school_id = _create_school_for_teacher(owner["user_id"])
    _assign_role(system_admin["user_id"], "system_admin", scope_type="platform")
    _assign_role(student["user_id"], "student", scope_type="school", scope_id=str(school_id))
    classroom_id = _create_classroom(client, owner, school_id)
    _enroll_student(client, owner, classroom_id, student["user_id"])

    resp = _reset_password(client, system_admin, classroom_id, student["user_id"])
    assert resp.status_code == 200, resp.text


def test_caller_teacher_role_scoped_to_different_school_denied_403(client):
    """Coverage gap found during the fail-closed caller-scoping fix (#3384):
    a caller who is classroom.teacher_id (so require_classroom_member passes)
    but whose own active teacher role is scoped to a DIFFERENT school than
    the classroom must still be denied -- holding a teacher-tier role
    somewhere is not enough, it must be a teacher role at THIS classroom's
    school."""
    owner = _register_user(client, "resetpw_wrongschool_caller")
    student = _register_user(client, "resetpw_wrongschool_student")
    _deactivate_all_roles(owner["user_id"])
    school_a_id = _create_org_and_school(f"org-{uuid.uuid4().hex[:8]}")
    school_b_id = _create_org_and_school(f"org-{uuid.uuid4().hex[:8]}")
    # Caller has standing to CREATE a classroom at School A (any active
    # school-scoped role satisfies create_classroom's is_school_member check
    # -- a pre-existing architectural gap, see
    # test_student_only_owner_cannot_reset_enrolled_victims_password_403),
    # but their only TEACHER role is at School B, a different school.
    _assign_role(owner["user_id"], "student", scope_type="school", scope_id=str(school_a_id))
    _assign_role(owner["user_id"], "teacher", scope_type="school", scope_id=str(school_b_id))
    _assign_role(student["user_id"], "student", scope_type="school", scope_id=str(school_a_id))
    classroom_id = _create_classroom(client, owner, school_a_id)
    _enroll_student(client, owner, classroom_id, student["user_id"])

    resp = _reset_password(client, owner, classroom_id, student["user_id"])
    assert resp.status_code == 403, resp.text
