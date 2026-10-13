"""Teacher audio replay: who may get a signed URL to a child's recording.

Three endpoints, each with layered guards (assignment owner → submission belongs to
assignment → attempt belongs to the submission's session). None had a route test.
Every negative case runs with a role that can log in, and each has a positive control
(the owning teacher gets the URL) so a 403/404 can't come from a route that never works.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.school import Classroom, ClassroomStudent, School
from app.models.session import LearningSession, ReadingAttemptHistory
from app.models.user import Role, User, UserRole
from app.routes.teacher import teacher_audio_replay

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def world(monkeypatch):
    Base.metadata.create_all(bind=engine)
    db = Session()
    monkeypatch.setattr(
        teacher_audio_replay, "generate_audio_signed_url",
        lambda path, expiration_seconds=600: f"https://signed.example/{path}",
    )
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

    def assignment_with_recording(teacher, student, tag):
        c = Classroom(name=f"c{tag}", school_id=school.id, teacher_id=teacher.id, grade=4, is_active=True)
        db.add(c)
        db.flush()
        db.add(ClassroomStudent(classroom_id=c.id, student_id=student.id))
        a = Assignment(classroom_id=c.id, teacher_id=teacher.id, story_id="20011", title=f"a{tag}")
        s = LearningSession(student_id=student.id, story_slug="20011", status="completed",
                            started_at=datetime.now(timezone.utc))
        db.add_all([a, s])
        db.flush()
        sub = AssignmentSubmission(assignment_id=a.id, student_id=student.id, session_id=s.id,
                                   audio_gcs_path=f"reading-audio/sub-{tag}.webm")
        att = ReadingAttemptHistory(session_id=s.id, attempt_no=1, reading_result={},
                                    audio_gcs_path=f"reading-audio/attempts/att-{tag}.webm")
        db.add_all([sub, att])
        db.flush()
        return a, sub, att

    t_a, t_b = user("teacher_a", "teacher"), user("teacher_b", "teacher")
    kid_a, kid_b = user("kid_a", "student"), user("kid_b", "student")
    A = assignment_with_recording(t_a, kid_a, "A")
    B = assignment_with_recording(t_b, kid_b, "B")
    db.commit()

    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db
    client = TestClient(app)

    def get(as_user, path):
        app.dependency_overrides[get_current_user] = lambda: as_user
        return client.get(path)

    yield {"get": get, "t_a": t_a, "t_b": t_b, "kid_a": kid_a, "A": A, "B": B}
    app.dependency_overrides.clear()
    db.close()
    Base.metadata.drop_all(bind=engine)


def _paths(a, sub, att):
    base = f"/api/teacher/assignments/{a.id}/submissions/{sub.id}"
    return {
        "submission_audio": f"{base}/reading-audio",
        "attempt_list": f"{base}/reading-attempts",
        "attempt_audio": f"{base}/reading-attempts/{att.id}/audio",
    }


@pytest.mark.parametrize("which", ["submission_audio", "attempt_list", "attempt_audio"])
def test_owning_teacher_gets_it(world, which):
    r = world["get"](world["t_a"], _paths(*world["A"])[which])
    assert r.status_code == 200, r.text
    body = r.json()
    if which == "attempt_list":
        assert body["attempts"][0]["has_audio"] is True
    else:
        assert body["signed_url"].endswith("-A.webm")


@pytest.mark.parametrize("who", ["t_b", "kid_a"])
@pytest.mark.parametrize("which", ["submission_audio", "attempt_list", "attempt_audio"])
def test_other_teacher_and_the_student_are_refused(world, who, which):
    # Another class's teacher, and the child themself (the student side has its own route).
    r = world["get"](world[who], _paths(*world["A"])[which])
    assert r.status_code == 403, (who, which, r.status_code)


@pytest.mark.parametrize("which", ["submission_audio", "attempt_list", "attempt_audio"])
def test_own_assignment_with_someone_elses_submission_is_not_found(world, which):
    a_a, _, att_a = world["A"]
    _, sub_b, _ = world["B"]
    r = world["get"](world["t_a"], _paths(a_a, sub_b, att_a)[which])
    assert r.status_code == 404


def test_own_submission_with_someone_elses_attempt_is_not_found(world):
    a_a, sub_a, _ = world["A"]
    _, _, att_b = world["B"]
    r = world["get"](world["t_a"], _paths(a_a, sub_a, att_b)["attempt_audio"])
    assert r.status_code == 404
