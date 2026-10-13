"""#3534 — a teacher may only add students of their own school to their classroom.

Before: any user id was accepted (another school's student, a teacher, an admin). Once
enrolled, `verify_student_access` treats them as the teacher's student, and the
response already leaked their email — so ids could be walked to list every account.
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

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def w():
    Base.metadata.create_all(bind=engine)
    db = Session()
    roles = {n: Role(name=n, display_name=n, scope_level="school") for n in ("teacher", "student", "system_admin")}
    db.add_all(roles.values())
    s1, s2 = School(name="S1"), School(name="S2")
    db.add_all([s1, s2])
    db.flush()

    def user(name, role, school, scope_type="school"):
        u = User(email=f"{name}@example.com", name=name, password_hash="x", is_active=True)
        db.add(u)
        db.flush()
        db.add(UserRole(user_id=u.id, role_id=roles[role].id, scope_type=scope_type,
                        scope_id=str(school.id) if school else None))
        return u

    teacher = user("teacher", "teacher", s1)
    same_school_kid = user("kid1", "student", s1)
    other_school_kid = user("kid2", "student", s2)
    colleague = user("colleague", "teacher", s1)
    admin = user("admin", "system_admin", None, scope_type="platform")
    c = Classroom(name="c", school_id=s1.id, teacher_id=teacher.id, grade=4, is_active=True)
    db.add(c)
    db.commit()

    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db
    client = TestClient(app)

    def add(as_user, student):
        uid = as_user.id
        app.dependency_overrides[get_current_user] = lambda db=Depends(get_db): db.get(User, uid)
        return client.post(f"/api/classrooms/{c.id}/students", json={"student_id": student.id})

    def enrolled(student):
        s = Session()
        try:
            return s.query(ClassroomStudent).filter_by(classroom_id=c.id, student_id=student.id).first() is not None
        finally:
            s.close()

    yield {"add": add, "enrolled": enrolled, "teacher": teacher, "admin": admin,
           "same": same_school_kid, "other": other_school_kid, "colleague": colleague}
    app.dependency_overrides.clear()
    db.close()
    Base.metadata.drop_all(bind=engine)


def test_same_school_student_can_be_added(w):
    r = w["add"](w["teacher"], w["same"])
    assert r.status_code == 201, r.text
    assert w["enrolled"](w["same"])


@pytest.mark.parametrize("who", ["other", "colleague", "admin"])
def test_non_students_and_other_schools_are_refused_without_leaking_email(w, who):
    r = w["add"](w["teacher"], w[who])
    assert r.status_code in (403, 404), (who, r.status_code)
    assert f"{w[who].name}@example.com" not in r.text
    assert not w["enrolled"](w[who])


def test_system_admin_may_add_across_schools(w):
    assert w["add"](w["admin"], w["other"]).status_code == 201


def test_student_search_only_returns_this_schools_students(w):
    uid = w["teacher"].id
    app.dependency_overrides[get_current_user] = lambda db=Depends(get_db): db.get(User, uid)
    from app.models.school import Classroom as C
    s = Session()
    cid = s.query(C.id).scalar()
    s.close()
    r = TestClient(app).post(f"/api/classrooms/{cid}/students/search", json={"query": "@example.com"})
    assert r.status_code == 200, r.text
    names = {x["name"] for x in r.json()}
    assert names == {"kid1"}, names  # not kid2 (other school), colleague, admin, or the teacher
