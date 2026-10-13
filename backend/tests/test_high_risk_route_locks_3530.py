"""#3530 — route-level locks for student-data endpoints that had no "someone else asks" test.

Each endpoint is run as the child, the child's teacher, an unrelated teacher and another
child. The guards are shared helpers (`verify_student_access`, `get_owned_session`,
`_check_classroom_access`); these tests pin that every route actually calls them.
Every negative case has a positive control on the same route.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import Depends
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.school import Classroom, ClassroomStudent, School
from app.models.session import LearningSession
from app.models.user import Role, User, UserRole

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def w():
    Base.metadata.create_all(bind=engine)
    db = Session()
    roles = {n: Role(name=n, display_name=n, scope_level="school") for n in ("teacher", "student")}
    db.add_all(roles.values())
    school = School(name="S")
    db.add(school)
    db.flush()

    def user(name, role):
        u = User(email=f"{name}@example.com", name=name, password_hash="x", is_active=True)
        db.add(u)
        db.flush()
        db.add(UserRole(user_id=u.id, role_id=roles[role].id, scope_type="school", scope_id=str(school.id)))
        return u

    kid, other_kid = user("kid", "student"), user("other_kid", "student")
    teacher, stranger = user("teacher", "teacher"), user("stranger", "teacher")
    c = Classroom(name="c", school_id=school.id, teacher_id=teacher.id, grade=4, is_active=True)
    c2 = Classroom(name="c2", school_id=school.id, teacher_id=stranger.id, grade=4, is_active=True)
    db.add_all([c, c2])
    db.flush()
    db.add(ClassroomStudent(classroom_id=c.id, student_id=kid.id))
    db.add(ClassroomStudent(classroom_id=c2.id, student_id=other_kid.id))
    sess = LearningSession(student_id=kid.id, story_slug="20011", status="completed",
                           started_at=datetime.now(timezone.utc))
    db.add(sess)
    db.commit()

    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db
    client = TestClient(app)

    def call(as_user, method, path, **kw):
        # Load the caller from the request's own DB session, as the real dependency
        # does — a user object from another session can't be written back.
        uid = as_user.id

        def _current(db=Depends(get_db)):
            return db.get(User, uid)

        app.dependency_overrides[get_current_user] = _current
        return client.request(method, path, **kw)

    yield {"call": call, "kid": kid, "other_kid": other_kid, "teacher": teacher,
           "stranger": stranger, "classroom": c.id, "session": sess.id}
    app.dependency_overrides.clear()
    db.close()
    Base.metadata.drop_all(bind=engine)


STUDENT_DATA = [
    "/api/learning/recommendations/{sid}",
    "/api/learning/students/{sid}/recommendations",
    "/api/learning/students/{sid}/recommended-vocab",
    "/api/learning/students/{sid}/stuck-points",
]


@pytest.mark.parametrize("path", STUDENT_DATA)
def test_child_and_their_teacher_may_read(w, path):
    p = path.format(sid=w["kid"].id)
    for who in ("kid", "teacher"):
        r = w["call"](w[who], "GET", p)
        assert r.status_code == 200, (who, p, r.status_code, r.text[:200])


@pytest.mark.parametrize("path", STUDENT_DATA)
def test_another_child_and_an_unrelated_teacher_may_not(w, path):
    p = path.format(sid=w["kid"].id)
    for who in ("other_kid", "stranger"):
        assert w["call"](w[who], "GET", p).status_code == 403, (who, p)


def test_classroom_stuck_overview_is_for_that_classrooms_teacher(w):
    p = f"/api/teacher/classrooms/{w['classroom']}/stuck-overview"
    assert w["call"](w["teacher"], "GET", p).status_code == 200
    assert w["call"](w["stranger"], "GET", p).status_code in (403, 404)


def _ann(n):
    return {"annotations": [{"paragraph_index": 0, "char_start": i, "char_end": i + 1,
                             "annotation_type": "important", "client_id": f"c{i}"} for i in range(n)]}


def test_annotations_belong_to_the_sessions_child(w):
    p = f"/api/learning/sessions/{w['session']}/annotations"
    assert w["call"](w["kid"], "PUT", p, json=_ann(2)).status_code == 200
    # Another child can neither read nor overwrite (PUT replaces everything) ...
    assert w["call"](w["other_kid"], "GET", p).status_code == 403
    assert w["call"](w["other_kid"], "PUT", p, json=_ann(0)).status_code == 403
    # ... and the child's marks survive the attempt.
    r = w["call"](w["kid"], "GET", p)
    assert r.status_code == 200 and len(r.json()["annotations"]) == 2


def test_exit_ticket_submit_is_for_the_sessions_child(w):
    p = f"/api/learning/sessions/{w['session']}/exit-ticket/submit"
    body = {"answers": [{"question_id": 1, "selected_index": 0}], "score": 80, "total_questions": 5}
    r = w["call"](w["kid"], "POST", p, json=body)
    assert r.status_code == 200 and r.json() == {"score": 80, "correct_count": 4, "total": 5, "passed": True}
    assert w["call"](w["other_kid"], "POST", p, json=body).status_code == 403
    assert w["call"](w["kid"], "POST", p, json={**body, "score": 101}).status_code == 422


def test_patch_me_changes_only_profile_fields(w):
    """Extra keys must be ignored: a child must not be able to switch email, deactivate
    or promote themself through the profile endpoint."""
    r = w["call"](w["kid"], "PATCH", "/api/users/me",
                  json={"name": "新名字", "email": "evil@example.com", "is_active": False,
                        "roles": [{"role_name": "system_admin"}], "password_hash": "x"})
    assert r.status_code == 200, r.text
    s = Session()
    try:
        u = s.query(User).filter(User.id == w["kid"].id).one()
        assert u.name == "新名字"  # positive control: the allowed field did change
        assert u.email == "kid@example.com" and u.is_active is True and u.password_hash == "x"
        role_names = {ur.role.name for ur in s.query(UserRole).filter(UserRole.user_id == u.id)}
        assert role_names == {"student"}
    finally:
        s.close()
