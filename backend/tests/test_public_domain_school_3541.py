"""#3541 — public email domains (gmail, yahoo …) are not a school.

Registration used to group teachers by email domain, so every gmail teacher
landed in one "gmail.com 學校". #3534 limited add/search to same-school
students — which, for a public domain, means every stranger who signed up
with gmail.

#3804 (Young 2026-11-01, point 5) retired that whole email-domain-guessing
mechanism: `assign_teacher_to_school` is gone. A teacher now names their
school explicitly via self-serve activation (`activate_teacher_for_schools`),
matched by exact name — see PRD §4.1.1 for the documented trade-off (two
teachers who type the same school name land in the same school, regardless
of their email domain; this is now the only grouping axis, by design).

1. Two teachers who name DIFFERENT schools each get their own school,
   regardless of sharing an email domain (public or institutional — domain
   is simply no longer part of the decision).
2. Two teachers who name the SAME school (by exact name) share it — the
   §3541 problem does not reappear here because sharing is now something a
   teacher does on purpose by typing a specific name, not an accident of
   signing up with the same free-mail provider.
3. In a school that *is* shared (the legacy case this file originally
   existed to fix, or two teachers who intentionally named the same school),
   a teacher may only search/add students they created or already teach.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.school import Classroom, ClassroomStudent, School
from app.models.user import Role, User, UserRole
from app.schemas.user import ActivateTeacherSchoolInput
from app.services.auth_registration_service import activate_teacher_for_schools

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def db():
    Base.metadata.create_all(bind=engine)
    s = Session()
    for n in ("teacher", "student", "system_admin"):
        s.add(Role(name=n, display_name=n, scope_level="school"))
    s.commit()
    yield s
    s.close()
    Base.metadata.drop_all(bind=engine)


def _teacher(db, email, school_name, name="t"):
    u = User(email=email, name=name, password_hash="x", is_active=True)
    db.add(u)
    db.flush()
    activate_teacher_for_schools(db, u, [ActivateTeacherSchoolInput(name=school_name)])
    db.commit()
    role = db.query(UserRole).join(Role).filter(UserRole.user_id == u.id, Role.name == "teacher").one()
    return u, int(role.scope_id)


# ── 1. self-serve activation (#3804: no more domain guessing) ───────────────

@pytest.mark.parametrize("domain", ["gmail.com", "Yahoo.com.tw", "hotmail.com", "outlook.com", "icloud.com"])
def test_teachers_who_name_different_schools_each_get_their_own_school(db, domain):
    _, s1 = _teacher(db, f"alice@{domain}", "Alice 的學校")
    _, s2 = _teacher(db, f"bob@{domain}", "Bob 的學校")
    assert s1 != s2
    assert db.get(School, s1).domain is None and db.get(School, s2).domain is None


def test_teachers_who_name_the_same_school_share_it_regardless_of_domain(db):
    """#3804: sharing is now opt-in (same typed name), not an accident of
    email domain. A gmail teacher and an institutional-domain teacher who
    both type "abc 國小" land in the SAME school -- this is intended."""
    _, s1 = _teacher(db, "alice@gmail.com", "abc 國小")
    _, s2 = _teacher(db, "bob@abc.edu.tw", "abc 國小")
    assert s1 == s2


# ── 2. add / search inside an existing shared public-domain school ───────────

def _student(db, school_id, granted_by, name):
    role = db.query(Role).filter_by(name="student").one()
    u = User(email=f"{name}@student.lingoleap.local", name=name, password_hash="x", is_active=True)
    db.add(u)
    db.flush()
    db.add(UserRole(user_id=u.id, role_id=role.id, scope_type="school", scope_id=str(school_id), granted_by=granted_by))
    return u


@pytest.fixture
def shared(db):
    """Two teachers already sharing a legacy public-domain school (pre-#3541 data)."""
    school = School(name="gmail.com 學校", domain="gmail.com")
    db.add(school)
    db.flush()
    trole = db.query(Role).filter_by(name="teacher").one()
    users = {}
    for n in ("a", "b"):
        u = User(email=f"{n}@gmail.com", name=n, password_hash="x", is_active=True)
        db.add(u)
        db.flush()
        db.add(UserRole(user_id=u.id, role_id=trole.id, scope_type="school", scope_id=str(school.id)))
        users[n] = u
    a_class1 = Classroom(name="a1", school_id=school.id, teacher_id=users["a"].id, grade=4, is_active=True)
    a_class2 = Classroom(name="a2", school_id=school.id, teacher_id=users["a"].id, grade=4, is_active=True)
    b_class = Classroom(name="b1", school_id=school.id, teacher_id=users["b"].id, grade=4, is_active=True)
    db.add_all([a_class1, a_class2, b_class])
    db.flush()
    kid_a = _student(db, school.id, users["a"].id, "kid_of_a")  # created by a
    kid_b = _student(db, school.id, users["b"].id, "kid_of_b")
    db.add(ClassroomStudent(classroom_id=a_class1.id, student_id=kid_a.id))
    db.commit()

    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db
    client = TestClient(app)

    def as_(u):
        uid = u.id
        app.dependency_overrides[get_current_user] = lambda d=Depends(get_db): d.get(User, uid)
        return client

    yield {"as": as_, "a": users["a"], "b": users["b"], "kid_a": kid_a, "kid_b": kid_b,
           "a2": a_class2.id, "b1": b_class.id}
    app.dependency_overrides.clear()


def test_stranger_in_shared_gmail_school_cannot_find_or_add_anothers_student(shared):
    c = shared["as"](shared["b"])
    names = {x["name"] for x in c.post(f"/api/classrooms/{shared['b1']}/students/search", json={"query": "kid"}).json()}
    assert "kid_of_a" not in names
    assert "kid_of_b" in names  # positive control: b still finds b's own student
    assert c.post(f"/api/classrooms/{shared['b1']}/students", json={"student_id": shared["kid_a"].id}).status_code == 404


def test_teacher_can_move_their_own_student_between_their_classes(shared):
    c = shared["as"](shared["a"])
    assert c.post(f"/api/classrooms/{shared['a2']}/students", json={"student_id": shared["kid_a"].id}).status_code == 201
