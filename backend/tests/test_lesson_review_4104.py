"""#4104 學習批閱 — teacher reviews a student's lesson; the student sees it once sent.

Covers: started-lesson detection, draft vs sent visibility, per-step return /
comment / score + total, "redone" after a return (server-stamped step
activity, correction counts), re-sending keeps a still-waiting return's time,
and permissions (non-member 403, viewer co-teacher can read but not write,
student not in the class 404).
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.jwt import create_access_token
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.school import Classroom, ClassroomStudent, ClassroomTeacher, School
from app.models.session import LearningSession
from app.models.user import User

_engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
_Session = sessionmaker(bind=_engine, autocommit=False, autoflush=False)

STEP = "comprehension#c1"
STEP2 = "vocab-definition#c2"


@pytest.fixture(scope="module", autouse=True)
def _db():
    Base.metadata.create_all(bind=_engine)

    def _override():
        db = _Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=_engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _user(db, tag: str) -> User:
    u = User(email=f"r4104_{tag}@example.com", password_hash="x", name=f"名{tag}",
             is_active=True, email_verified=True, onboarding_completed=True)
    db.add(u)
    db.flush()
    return u


@pytest.fixture(scope="module")
def world():
    db = _Session()
    teacher, viewer, stranger = _user(db, "t"), _user(db, "v"), _user(db, "x")
    s1, s2, outsider = _user(db, "s1"), _user(db, "s2"), _user(db, "o")
    school = School(name="測試國小")
    db.add(school)
    db.flush()
    c = Classroom(school_id=school.id, teacher_id=teacher.id, name="五年甲班", grade=5)
    db.add(c)
    db.flush()
    db.add_all([
        ClassroomStudent(classroom_id=c.id, student_id=s1.id, seat_number=2),
        ClassroomStudent(classroom_id=c.id, student_id=s2.id, seat_number=1),
        ClassroomTeacher(classroom_id=c.id, teacher_id=viewer.id, role="viewer", status="accepted"),
    ])
    # s1: lesson 6 started (real work), lesson 7 only opened (bootstrap, nothing done)
    sess = LearningSession(student_id=s1.id, story_slug="6", status="in_progress",
                           step_progress={"current_step": STEP, "steps_completed": [STEP],
                                          "step_data": {STEP: {"score": 3, "total": 5}}, "version": 1})
    db.add(sess)
    db.add(LearningSession(student_id=s1.id, story_slug="7", status="in_progress",
                           step_progress={"current_step": None, "steps_completed": [], "step_data": {}}))
    db.add(LearningSession(student_id=outsider.id, story_slug="6", status="in_progress",
                           step_progress={"steps_completed": [STEP], "step_data": {}}))
    db.commit()
    ids = dict(classroom=c.id, s1=s1.id, s2=s2.id, outsider=outsider.id, session=sess.id)
    tokens = {k: create_access_token(u.id) for k, u in
              dict(teacher=teacher, viewer=viewer, stranger=stranger, s1=s1).items()}
    db.close()
    return ids, tokens


def H(token):
    return {"Authorization": f"Bearer {token}"}


def _base(ids):
    return f"/api/teacher/classrooms/{ids['classroom']}/review/students"


def test_student_cards_count_only_started_lessons(client, world):
    ids, tk = world
    r = client.get(_base(ids), headers=H(tk["teacher"]))
    assert r.status_code == 200, r.text
    cards = r.json()
    assert [c["seat_number"] for c in cards] == [1, 2]  # seat order
    s1 = next(c for c in cards if c["student_id"] == ids["s1"])
    assert s1["started_count"] == 1  # lesson 7 was only opened
    assert s1["unreviewed_count"] == 1

    lessons = client.get(f"{_base(ids)}/{ids['s1']}/lessons", headers=H(tk["teacher"])).json()
    assert [l["story_slug"] for l in lessons] == ["6"]
    assert lessons[0]["steps_completed"] == 1


def test_permissions(client, world):
    ids, tk = world
    assert client.get(_base(ids), headers=H(tk["stranger"])).status_code == 403
    assert client.get(_base(ids), headers=H(tk["viewer"])).status_code == 200
    url = f"{_base(ids)}/{ids['s1']}/lessons/6"
    assert client.post(f"{url}/send", json={}, headers=H(tk["viewer"])).status_code == 403
    assert client.get(f"{_base(ids)}/{ids['outsider']}/lessons", headers=H(tk["teacher"])).status_code == 404
    assert client.get(f"{_base(ids)}/{ids['s1']}/lessons/7", headers=H(tk["teacher"])).status_code == 404


def test_draft_is_invisible_then_send_reaches_student(client, world):
    ids, tk = world
    url = f"{_base(ids)}/{ids['s1']}/lessons/6"
    body = {"total_score": 88, "steps": [
        {"step_key": STEP, "returned": True, "comment": "  重做一次，看清楚題目  ", "score": 70},
        {"step_key": STEP2, "returned": False, "comment": None, "score": 95},
    ]}
    d = client.put(f"{url}/draft", json=body, headers=H(tk["teacher"]))
    assert d.status_code == 200, d.text
    assert d.json()["draft"]["total_score"] == 88
    assert client.get("/api/learning/reviews/6", headers=H(tk["s1"])).json()["sent_at"] is None
    assert client.get("/api/learning/reviews", headers=H(tk["s1"])).json() == {}

    s = client.post(f"{url}/send", json=body, headers=H(tk["teacher"]))
    assert s.status_code == 200, s.text
    assert s.json()["draft"] is None

    mine = client.get("/api/learning/reviews/6", headers=H(tk["s1"])).json()
    assert mine["total_score"] == 88
    assert mine["teacher_name"] == "名t"
    assert mine["steps"][STEP] == {"returned": True, "redone": False, "comment": "重做一次，看清楚題目", "score": 70}
    assert mine["steps"][STEP2]["score"] == 95
    summary = client.get("/api/learning/reviews", headers=H(tk["s1"])).json()
    assert summary["6"]["total_score"] == 88 and summary["6"]["returned_count"] == 1


def test_correcting_the_returned_step_counts_as_redone(client, world):
    ids, tk = world
    # Re-saving identical data (a restored step mounting) is not a redo.
    same = {"current_step": STEP, "steps_completed": [STEP],
            "step_data": {STEP: {"score": 3, "total": 5}}}
    r = client.put(f"/api/learning/sessions/{ids['session']}/progress", json=same, headers=H(tk["s1"]))
    assert r.status_code == 200, r.text
    assert client.get("/api/learning/reviews/6", headers=H(tk["s1"])).json()["steps"][STEP]["returned"] is True

    fixed = {"current_step": STEP, "steps_completed": [STEP],
             "step_data": {STEP: {"score": 3, "total": 5, "latest": {"q1": True}}}}
    r = client.put(f"/api/learning/sessions/{ids['session']}/progress", json=fixed, headers=H(tk["s1"]))
    assert r.status_code == 200, r.text
    st = client.get("/api/learning/reviews/6", headers=H(tk["s1"])).json()["steps"][STEP]
    assert st == {"returned": False, "redone": True, "comment": "重做一次，看清楚題目", "score": 70}

    cards = client.get(_base(ids), headers=H(tk["teacher"])).json()
    s1 = next(c for c in cards if c["student_id"] == ids["s1"])
    assert s1["redone_count"] == 1 and s1["returned_count"] == 0


def test_returning_again_after_redo_is_a_fresh_return(client, world):
    ids, tk = world
    url = f"{_base(ids)}/{ids['s1']}/lessons/6"
    body = {"total_score": 90, "steps": [{"step_key": STEP, "returned": True, "comment": "再一次", "score": 80}]}
    assert client.post(f"{url}/send", json=body, headers=H(tk["teacher"])).status_code == 200
    mine = client.get("/api/learning/reviews/6", headers=H(tk["s1"])).json()
    assert mine["steps"][STEP]["returned"] is True
    # STEP2 was left out of this send → removed
    assert STEP2 not in mine["steps"]


def test_out_of_range_score_rejected(client, world):
    ids, tk = world
    url = f"{_base(ids)}/{ids['s1']}/lessons/6"
    r = client.post(f"{url}/send", json={"total_score": 101}, headers=H(tk["teacher"]))
    assert r.status_code == 422
