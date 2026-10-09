"""Classroom access guard + cross-text analysis scoping (Issue #3346, batch 4).

`_check_classroom_access` (backend/app/dependencies/tenant.py) is the shared
gate in front of ~23 teacher/classroom routes. It had no direct test. This file
covers it at unit level and through its least-tested caller,

    GET /api/teacher/classrooms/{classroom_id}/cross-text-analysis
    (backend/app/routes/teacher/teacher_cross_text.py)

which aggregates every enrolled student's sessions and character errors.

Least-privilege discipline (rules/testing-strategy.md): every rejection uses a
real, authenticated user who is *almost* allowed — a teacher of another class,
a co-teacher of another class, an org admin of another org, an org admin whose
role was deactivated, a member of the right org without an admin role, a
student enrolled in the class. Each is paired with the matching allowed user
(owner, co-teacher of this class, org admin of this org) so a green 403 cannot
mean "the guard denies everybody".

Run with:
    cd backend
    python -m pytest tests/test_classroom_access_cross_text_3346.py -v
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.password import hash_password
from app.database import get_db
from app.dependencies.tenant import _check_classroom_access
from app.main import app
from app.models import Base
from app.models.organization import Organization
from app.models.school import Classroom, ClassroomStudent, ClassroomTeacher, School
from app.models.session import CharacterError, LearningSession
from app.models.user import Role, User, UserRole

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

PASSWORD = "Password1!"

U: dict[str, int] = {}
C: dict[str, int] = {}


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _user(db, key: str) -> User:
    user = User(
        email=f"cca3346_{key}@example.com",
        username=f"cca3346_{key}",
        password_hash=hash_password(PASSWORD),
        name=key,
        is_active=True,
        email_verified=True,
    )
    db.add(user)
    db.flush()
    U[key] = user.id
    return user


def _role(db, name: str, scope_level: str) -> Role:
    role = db.query(Role).filter(Role.name == name).first()
    if role is None:
        role = Role(name=name, display_name=name, scope_level=scope_level)
        db.add(role)
        db.flush()
    return role


def _session(db, student_id: int, slug: str, score: float) -> LearningSession:
    s = LearningSession(student_id=student_id, story_slug=slug, status="completed", overall_score=score)
    db.add(s)
    db.flush()
    return s


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    org_a = Organization(name="CCA 3346 Org A")
    org_b = Organization(name="CCA 3346 Org B")
    db.add_all([org_a, org_b])
    db.flush()

    school_a = School(name="CCA 3346 School A", organization_id=org_a.id)
    school_b = School(name="CCA 3346 School B", organization_id=org_b.id)
    db.add_all([school_a, school_b])
    db.flush()

    owner = _user(db, "owner")                    # Classroom.teacher_id of class A
    co_teacher = _user(db, "co_teacher")          # ClassroomTeacher of class A
    other_teacher = _user(db, "other_teacher")    # owns class B (school B)
    other_co_teacher = _user(db, "other_co_teacher")  # ClassroomTeacher of class B only
    student = _user(db, "student")                # enrolled in class A
    other_student = _user(db, "other_student")    # enrolled in class B
    org_admin = _user(db, "org_admin")            # org_admin of org A
    org_owner = _user(db, "org_owner")            # org_owner of org A
    other_org_admin = _user(db, "other_org_admin")  # org_admin of org B
    revoked_org_admin = _user(db, "revoked_org_admin")  # org_admin of org A, is_active=False
    org_member = _user(db, "org_member")          # non-admin role in org A
    sysadmin = _user(db, "sysadmin")

    class_a = Classroom(name="CCA-A", school_id=school_a.id, teacher_id=owner.id, join_code="CCA3346A")
    class_b = Classroom(name="CCA-B", school_id=school_b.id, teacher_id=other_teacher.id, join_code="CCA3346B")
    db.add_all([class_a, class_b])
    db.flush()
    C["a"], C["b"] = class_a.id, class_b.id

    r_org_admin = _role(db, "org_admin", "organization")
    r_org_owner = _role(db, "org_owner", "organization")
    r_teacher = _role(db, "teacher", "organization")
    r_sys = _role(db, "system_admin", "platform")

    db.add_all([
        ClassroomTeacher(classroom_id=class_a.id, teacher_id=co_teacher.id, role="assistant"),
        ClassroomTeacher(classroom_id=class_b.id, teacher_id=other_co_teacher.id, role="assistant"),
        ClassroomStudent(classroom_id=class_a.id, student_id=student.id),
        ClassroomStudent(classroom_id=class_b.id, student_id=other_student.id),
        UserRole(user_id=org_admin.id, role_id=r_org_admin.id, scope_type="organization", scope_id=org_a.id),
        UserRole(user_id=org_owner.id, role_id=r_org_owner.id, scope_type="organization", scope_id=org_a.id),
        UserRole(user_id=other_org_admin.id, role_id=r_org_admin.id, scope_type="organization", scope_id=org_b.id),
        UserRole(user_id=revoked_org_admin.id, role_id=r_org_admin.id, scope_type="organization",
                 scope_id=org_a.id, is_active=False),
        UserRole(user_id=org_member.id, role_id=r_teacher.id, scope_type="organization", scope_id=org_a.id),
        UserRole(user_id=sysadmin.id, role_id=r_sys.id, scope_type="platform", scope_id=None),
    ])

    # Class A: student has 2 completed sessions on 2 texts, both with 「蘋」 wrong.
    s1 = _session(db, student.id, "cca-text-1", 90.0)
    s2 = _session(db, student.id, "cca-text-2", 50.0)
    # Class B: other_student's session with a distinctive error char 「鑫」.
    s3 = _session(db, other_student.id, "cca-text-1", 10.0)
    db.add_all([
        CharacterError(session_id=s1.id, character="蘋", error_type="misread"),
        CharacterError(session_id=s2.id, character="蘋", error_type="misread"),
        CharacterError(session_id=s3.id, character="鑫", error_type="misread"),
    ])
    db.commit()
    db.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def _get(db, key: str) -> User:
    return db.get(User, U[key])


# ---------------------------------------------------------------------------
# _check_classroom_access — unit level
# ---------------------------------------------------------------------------


class TestClassroomAccessAllowed:
    @pytest.mark.parametrize("key", ["owner", "co_teacher", "org_admin", "org_owner", "sysadmin"])
    def test_allowed(self, db, key):
        classroom = _check_classroom_access(_get(db, key), C["a"], db)
        assert classroom.id == C["a"]

    def test_other_teacher_can_access_own_class(self, db):
        # control for the other_teacher denial
        assert _check_classroom_access(_get(db, "other_teacher"), C["b"], db).id == C["b"]

    def test_other_co_teacher_can_access_own_class(self, db):
        assert _check_classroom_access(_get(db, "other_co_teacher"), C["b"], db).id == C["b"]

    def test_other_org_admin_can_access_own_org_class(self, db):
        assert _check_classroom_access(_get(db, "other_org_admin"), C["b"], db).id == C["b"]


class TestClassroomAccessDenied:
    @pytest.mark.parametrize("key", [
        "other_teacher",       # a teacher — of a different class
        "other_co_teacher",    # a co-teacher — of a different class
        "other_org_admin",     # an org admin — of a different org
        "revoked_org_admin",   # right org, role is_active=False
        "org_member",          # right org, role is not an admin role
        "student",             # enrolled in the class, but not staff
    ])
    def test_denied(self, db, key):
        with pytest.raises(HTTPException) as exc:
            _check_classroom_access(_get(db, key), C["a"], db)
        assert exc.value.status_code == 403

    def test_missing_classroom_is_404_even_for_owner(self, db):
        with pytest.raises(HTTPException) as exc:
            _check_classroom_access(_get(db, "owner"), 999_999, db)
        assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/teacher/classrooms/{id}/cross-text-analysis
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


_TOKENS: dict[str, dict] = {}


def _auth(client, key: str) -> dict:
    if key not in _TOKENS:
        resp = client.post(
            "/api/auth/login",
            json={"email": f"cca3346_{key}@example.com", "password": PASSWORD},
        )
        assert resp.status_code == 200, resp.text
        _TOKENS[key] = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    return _TOKENS[key]


def _analysis(client, as_key: str, cls: str = "a"):
    return client.get(
        f"/api/teacher/classrooms/{C[cls]}/cross-text-analysis",
        headers=_auth(client, as_key),
    )


class TestCrossTextEndpoint:
    def test_owner_gets_200_with_class_data(self, client):
        r = _analysis(client, "owner")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["classroom_id"] == C["a"]
        assert body["total_students"] == 1
        assert body["total_sessions"] == 2

    def test_co_teacher_gets_200(self, client):
        assert _analysis(client, "co_teacher").status_code == 200

    @pytest.mark.parametrize("key", ["other_teacher", "student", "other_org_admin"])
    def test_unrelated_user_gets_403(self, client, key):
        r = _analysis(client, key)
        assert r.status_code == 403, r.text
        assert "student_patterns" not in r.json()

    def test_unauthenticated_gets_401(self, client):
        assert client.get(f"/api/teacher/classrooms/{C['a']}/cross-text-analysis").status_code == 401

    def test_missing_classroom_gets_404(self, client):
        r = client.get("/api/teacher/classrooms/999999/cross-text-analysis", headers=_auth(client, "owner"))
        assert r.status_code == 404


class TestCrossTextScoping:
    """Aggregates must only contain the requested classroom's students."""

    def test_only_enrolled_students_appear(self, client):
        body = _analysis(client, "owner").json()
        assert [p["student_id"] for p in body["student_patterns"]] == [U["student"]]

    def test_other_class_error_chars_do_not_leak(self, client):
        chars = {c["char"] for c in _analysis(client, "owner").json()["common_error_chars"]}
        assert chars == {"蘋"}

    def test_other_class_scores_do_not_affect_difficulty_ranking(self, client):
        ranking = {t["story_slug"]: t for t in _analysis(client, "owner").json()["text_difficulty_ranking"]}
        assert ranking["cca-text-1"]["avg_score"] == 90.0
        assert ranking["cca-text-1"]["attempt_count"] == 1

    def test_other_teacher_sees_only_their_class(self, client):
        # positive control: the scoping is per-classroom, not "hide everything"
        body = _analysis(client, "other_teacher", "b").json()
        assert [p["student_id"] for p in body["student_patterns"]] == [U["other_student"]]
        assert {c["char"] for c in body["common_error_chars"]} == {"鑫"}

    def test_repeated_error_char_across_texts_is_reported(self, client):
        pattern = _analysis(client, "owner").json()["student_patterns"][0]
        assert [c["char"] for c in pattern["repeated_error_chars"]] == ["蘋"]
        assert pattern["strong_texts"] == ["cca-text-1"]
        assert pattern["weak_texts"] == ["cca-text-2"]
