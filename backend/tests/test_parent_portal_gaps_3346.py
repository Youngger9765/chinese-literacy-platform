"""Gap tests for the parent portal (Issue #3346, batch 10).

backend/app/routes/parents.py already has tests/test_parent_portal.py (14
tests). A mutation run against that file showed 10 of 12 single-point breaks
in parents.py survive it — including "any teacher can mint an invite code for
any enrolled child" and "an expired code still links". This file covers only
those gaps (see the PR description for the table).

Least-privilege discipline (rules/testing-strategy.md): the rejected callers
are a teacher of a *different* class, a plain student, and a parent whose link
was revoked — never admin. Each is paired with the legitimate caller
succeeding, and writes are re-read from the DB.

Run with:
    cd backend
    python -m pytest tests/test_parent_portal_gaps_3346.py -v
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.password import hash_password
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.parent_link import ParentInviteCode, ParentStudentLink
from app.models.school import Classroom, ClassroomStudent, School
from app.models.user import Role, User, UserRole
from app.routes.parents import _require_parent_link

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

PASSWORD = "Password1!"

U: dict[str, int] = {}


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _user(db, key: str, active: bool = True) -> User:
    user = User(
        email=f"par3346_{key}@example.com",
        username=f"par3346_{key}",
        password_hash=hash_password(PASSWORD),
        name=key,
        is_active=active,
        email_verified=True,
    )
    db.add(user)
    db.flush()
    U[key] = user.id
    return user


def _code(db, code: str, student: str, *, days: int = 30, used: bool = False) -> None:
    db.add(ParentInviteCode(
        code=code,
        student_id=U[student],
        created_by=U["teacher_a"],
        expires_at=datetime.now(timezone.utc) + timedelta(days=days),
        used=used,
    ))


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    school = School(name="PAR 3346 School")
    db.add(school)
    db.flush()
    teacher_a = _user(db, "teacher_a")          # teaches class A
    teacher_b = _user(db, "teacher_b")          # teaches class B only
    student = _user(db, "student")              # class A
    other_student = _user(db, "other_student")  # class B
    gone = _user(db, "gone_student", active=False)  # class A, deactivated
    _user(db, "parent")                         # active link to student
    _user(db, "revoked_parent")                 # link to student, is_active=False
    _user(db, "new_parent")                     # redeems codes in the tests
    _user(db, "relinker")                       # revoked, then redeems a fresh code

    class_a = Classroom(name="PAR-A", school_id=school.id, teacher_id=teacher_a.id, join_code="PAR3346A")
    class_b = Classroom(name="PAR-B", school_id=school.id, teacher_id=teacher_b.id, join_code="PAR3346B")
    db.add_all([class_a, class_b])
    db.flush()
    db.add_all([
        ClassroomStudent(classroom_id=class_a.id, student_id=student.id),
        ClassroomStudent(classroom_id=class_a.id, student_id=gone.id),
        ClassroomStudent(classroom_id=class_b.id, student_id=other_student.id),
        ParentStudentLink(parent_id=U["parent"], student_id=student.id, is_active=True),
        ParentStudentLink(parent_id=U["revoked_parent"], student_id=student.id, is_active=False),
        ParentStudentLink(parent_id=U["relinker"], student_id=student.id, is_active=False),
    ])
    _code(db, "EXPIRED1", "student", days=-1)
    _code(db, "FRESH001", "student")
    _code(db, "RELINK01", "student")
    _code(db, "OTHERKID", "other_student")
    db.commit()
    db.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


_TOKENS: dict[str, dict] = {}


def _auth(client, key: str) -> dict:
    if key not in _TOKENS:
        resp = client.post(
            "/api/auth/login",
            json={"email": f"par3346_{key}@example.com", "password": PASSWORD},
        )
        assert resp.status_code == 200, resp.text
        _TOKENS[key] = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    return _TOKENS[key]


def _codes_for(student: str) -> int:
    db = TestingSessionLocal()
    try:
        return db.query(ParentInviteCode).filter(ParentInviteCode.student_id == U[student]).count()
    finally:
        db.close()


def _link(parent: str, student: str) -> ParentStudentLink | None:
    db = TestingSessionLocal()
    try:
        return db.query(ParentStudentLink).filter(
            ParentStudentLink.parent_id == U[parent], ParentStudentLink.student_id == U[student]
        ).first()
    finally:
        db.close()


def _has_parent_role(key: str) -> bool:
    db = TestingSessionLocal()
    try:
        return db.query(UserRole).join(Role).filter(
            UserRole.user_id == U[key], Role.name == "parent", UserRole.is_active == True
        ).first() is not None
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Who may mint / list invite codes
# ---------------------------------------------------------------------------


class TestGenerateCode:
    def test_teacher_of_the_student_can_generate(self, client):
        before = _codes_for("student")
        r = client.post(f"/api/parents/invite-codes?student_id={U['student']}", headers=_auth(client, "teacher_a"))
        assert r.status_code == 201, r.text
        assert len(r.json()["code"]) == 8
        assert _codes_for("student") == before + 1

    @pytest.mark.parametrize("as_key", ["teacher_b", "other_student", "parent"])
    def test_user_who_does_not_teach_the_student_gets_403(self, client, as_key):
        # teacher_b teaches a class — just not this child's.
        before = _codes_for("student")
        r = client.post(f"/api/parents/invite-codes?student_id={U['student']}", headers=_auth(client, as_key))
        assert r.status_code == 403, r.text
        assert _codes_for("student") == before

    def test_teacher_b_can_generate_for_own_student(self, client):
        # positive control for the teacher_b denial
        r = client.post(f"/api/parents/invite-codes?student_id={U['other_student']}",
                        headers=_auth(client, "teacher_b"))
        assert r.status_code == 201, r.text

    def test_teacher_a_cannot_generate_for_student_outside_class(self, client):
        r = client.post(f"/api/parents/invite-codes?student_id={U['other_student']}",
                        headers=_auth(client, "teacher_a"))
        assert r.status_code == 403, r.text

    def test_deactivated_student_is_404(self, client):
        r = client.post(f"/api/parents/invite-codes?student_id={U['gone_student']}",
                        headers=_auth(client, "teacher_a"))
        assert r.status_code == 404
        assert _codes_for("gone_student") == 0


class TestListCodes:
    def test_teacher_sees_only_this_students_codes(self, client):
        r = client.get(f"/api/parents/invite-codes/student/{U['student']}", headers=_auth(client, "teacher_a"))
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert items and {i["student_id"] for i in items} == {U["student"]}
        assert "OTHERKID" not in {i["code"] for i in items}

    def test_other_class_teacher_cannot_list(self, client):
        r = client.get(f"/api/parents/invite-codes/student/{U['student']}", headers=_auth(client, "teacher_b"))
        assert r.status_code == 403, r.text
        assert "items" not in r.json()


# ---------------------------------------------------------------------------
# Redeeming codes
# ---------------------------------------------------------------------------


class TestRedeem:
    def test_expired_code_is_rejected_and_links_nothing(self, client):
        r = client.post("/api/parents/link", headers=_auth(client, "new_parent"), json={"code": "EXPIRED1"})
        assert r.status_code == 400, r.text
        assert _link("new_parent", "student") is None

    def test_code_is_normalised_case_and_whitespace(self, client):
        r = client.post("/api/parents/link", headers=_auth(client, "new_parent"), json={"code": "  fresh001 "})
        assert r.status_code == 201, r.text
        link = _link("new_parent", "student")
        assert link is not None and link.is_active is True

    def test_redeeming_grants_the_parent_role(self, client):
        # follows test_code_is_normalised_case_and_whitespace (file order)
        assert _has_parent_role("new_parent")
        assert not _has_parent_role("teacher_a")

    def test_fresh_code_reactivates_a_revoked_link(self, client):
        assert _link("relinker", "student").is_active is False
        r = client.post("/api/parents/link", headers=_auth(client, "relinker"), json={"code": "RELINK01"})
        assert r.status_code == 201, r.text
        assert _link("relinker", "student").is_active is True
        names = [c["student_name"] for c in client.get(
            "/api/parents/children", headers=_auth(client, "relinker")).json()["children"]]
        assert names == ["student"]


# ---------------------------------------------------------------------------
# Revoked links
# ---------------------------------------------------------------------------


class TestRevokedLink:
    def test_revoked_parent_does_not_list_the_child(self, client):
        r = client.get("/api/parents/children", headers=_auth(client, "revoked_parent"))
        assert r.status_code == 200, r.text
        assert r.json()["children"] == []

    def test_active_parent_lists_the_child(self, client):
        # positive control for the revoked-parent list
        r = client.get("/api/parents/children", headers=_auth(client, "parent"))
        assert [c["student_id"] for c in r.json()["children"]] == [U["student"]]

    def test_revoked_parent_cannot_open_child_dashboard(self, client):
        r = client.get(f"/api/parents/children/{U['student']}/dashboard", headers=_auth(client, "revoked_parent"))
        assert r.status_code == 403, r.text

    def test_active_parent_opens_child_dashboard(self, client):
        r = client.get(f"/api/parents/children/{U['student']}/dashboard", headers=_auth(client, "parent"))
        assert r.status_code == 200, r.text


class TestRequireParentLinkHelper:
    """Direct test of the helper: at endpoint level a revoked parent is ALSO
    stopped by verify_student_access inside get_student_dashboard, so dropping
    the helper's is_active check is invisible through HTTP. Defence in depth
    only counts if each layer is tested on its own."""

    def test_revoked_link_raises_403(self):
        db = TestingSessionLocal()
        try:
            with pytest.raises(HTTPException) as exc:
                _require_parent_link(db.get(User, U["revoked_parent"]), U["student"], db)
            assert exc.value.status_code == 403
        finally:
            db.close()

    def test_active_link_is_returned(self):
        db = TestingSessionLocal()
        try:
            link = _require_parent_link(db.get(User, U["parent"]), U["student"], db)
            assert (link.parent_id, link.student_id, link.is_active) == (U["parent"], U["student"], True)
        finally:
            db.close()
