"""
Teacher override: mark a stuck/incomplete assignment submission complete.

Production report (teacher at 三民國中, reflected in #3682): once a student's
lesson got stuck on a broken step, that step could never be recorded in
steps_completed, so the server-side auto-submit gate
(assignment_queries.is_assignment_ready_for_submit —
maybe_auto_submit_assignment_session's independent re-check, #3695 follow-up)
never passes. The assignment sits "in_progress" forever even after the
teacher has looked at the student's recorded progress
(/teacher/students/{id}/sessions/{id}/report) and judged the work done, and
the teacher-facing assignment screen gave no indication of WHICH steps were
missing or ANY way to resolve it.

This file locks two things end to end:

1. GET /api/assignments/{id} exposes, per submission/attempt, the exact same
   required-step accounting the auto-submit gate uses
   (required_step_count / completed_step_count / missing_step_ids) — so the
   teacher-facing "完成 X/Y 關，缺：..." display can never show a different
   answer than what actually decides submission.
2. POST /api/assignments/{id}/submissions/{sub_id}/mark-complete lets a
   teacher who owns the classroom force-submit a stuck/incomplete
   submission, reusing the same submit_assignment_session path a student's
   own submit uses (so scoring/session-status sync behave identically), and
   records who did it in the linked session's step_progress.__meta so the
   response can carry marked_complete_by_teacher back to the UI.

Authorization is locked with the SAME three-case shape
TestTeacherGradingAuthorization already locks for grade_submission (another
teacher 403, student 403, owning teacher 200) — this is deliberately the
same endpoint family.
"""

import sys
import os
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.session import LearningSession
from app.models.school import School
from app.models.user import Role, UserRole

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
    {"name": "org_admin", "display_name": "Organization Admin", "scope_level": "organization"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "parent", "display_name": "Parent", "scope_level": "school"},
]

_test_school_id: int = 0


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _test_school_id
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    for role_data in SEED_ROLES:
        db.add(Role(**role_data))
    db.commit()
    school = School(name="Mark Complete Test School")
    db.add(school)
    db.commit()
    db.refresh(school)
    _test_school_id = school.id
    db.close()

    from app.routes.auth import rate_limiter
    rate_limiter.reset()

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


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{suffix.title()} {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email, "password": password, "name": name,
    })
    assert resp.status_code == 201, resp.text
    verification_token = resp.json().get("verification_token")
    if verification_token:
        verify_resp = client.get(f"/api/auth/verify-email?token={verification_token}")
        assert verify_resp.status_code == 200
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    user_id = me_resp.json()["id"]
    return {"email": email, "name": name, "token": token, "user_id": user_id}


def _grant_school_teacher_role(user_id: int) -> None:
    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == "teacher").first()
        if not db.query(UserRole).filter(
            UserRole.user_id == user_id, UserRole.role_id == role.id,
            UserRole.scope_type == "school", UserRole.scope_id == str(_test_school_id),
        ).first():
            db.add(UserRole(user_id=user_id, role_id=role.id,
                             scope_type="school", scope_id=str(_test_school_id)))
            db.commit()
    finally:
        db.close()


def _make_student_role(user_id: int) -> None:
    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == "student").first()
        db.add(UserRole(user_id=user_id, role_id=role.id,
                         scope_type="school", scope_id=str(_test_school_id)))
        db.commit()
    finally:
        db.close()


# A real seeded lesson with its own round-keyed step_sequence (same "2000x"
# test-data convention as test_assignments.py's VALID_STORY_ID="20001" and
# test_assignment_autosubmit_3682.py's "2010x" fixtures) -- NOT the
# DEFAULT_REQUIRED_STEP_IDS fallback, so these tests exercise the same
# composite-id (`base#slug`) path production lessons actually use.
STORY_ID = "20050"

from app.services.assignment_queries import compute_required_step_ids_for_assignment


def _required_steps() -> list[str]:
    return compute_required_step_ids_for_assignment(Assignment(story_id=STORY_ID))


def _setup_classroom_assignment(client, suffix: str):
    """Fresh teacher + student + classroom + assignment, isolated per test."""
    teacher = _register_user(client, f"mc_teacher_{suffix}")
    _grant_school_teacher_role(teacher["user_id"])
    student = _register_user(client, f"mc_student_{suffix}")
    _make_student_role(student["user_id"])

    cls_resp = client.post(
        "/api/classrooms",
        json={"name": f"Mark Complete {suffix}", "school_id": _test_school_id},
        headers=auth_header(teacher["token"]),
    )
    assert cls_resp.status_code == 201, cls_resp.text
    classroom_id = cls_resp.json()["id"]

    enroll_resp = client.post(
        f"/api/classrooms/{classroom_id}/students",
        json={"student_id": student["user_id"]},
        headers=auth_header(teacher["token"]),
    )
    assert enroll_resp.status_code in (200, 201), enroll_resp.text

    asn_resp = client.post(
        f"/api/classrooms/{classroom_id}/assignments",
        json={"classroom_id": classroom_id, "story_id": STORY_ID, "title": f"MC Assignment {suffix}"},
        headers=auth_header(teacher["token"]),
    )
    assert asn_resp.status_code == 201, asn_resp.text
    assignment_id = asn_resp.json()["id"]

    return teacher, student, classroom_id, assignment_id


def _start(client, student, assignment_id: int) -> tuple[int, int]:
    """Returns (session_id, submission_id)."""
    resp = client.post(
        f"/api/assignments/{assignment_id}/start",
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 200, resp.text
    session_id = resp.json()["session_id"]
    sub = (
        TestingSessionLocal()
        .query(AssignmentSubmission)
        .filter(AssignmentSubmission.session_id == session_id)
        .first()
    )
    return session_id, sub.id


def _save_partial_progress(client, student, session_id: int, steps_done: list[str]) -> None:
    resp = client.put(
        f"/api/learning/sessions/{session_id}/progress",
        json={
            "current_step": steps_done[-1] if steps_done else None,
            "steps_completed": steps_done,
            "step_data": {},
            "assignment_ready_for_submit": False,
        },
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 200, resp.text


def _get_detail(client, teacher, assignment_id: int) -> dict:
    resp = client.get(
        f"/api/assignments/{assignment_id}",
        headers=auth_header(teacher["token"]),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# 1. Required/missing step accounting on the teacher-facing assignment detail
# ---------------------------------------------------------------------------

class TestSubmissionMissingStepsFields:
    def test_pending_submission_shows_zero_completed_of_all_required(self, client):
        teacher, student, classroom_id, assignment_id = _setup_classroom_assignment(client, "pending")
        required = _required_steps()

        detail = _get_detail(client, teacher, assignment_id)
        sub = next(s for s in detail["submissions"] if s["student_id"] == student["user_id"])

        assert sub["status"] == "pending"
        assert sub["required_step_count"] == len(required)
        assert sub["completed_step_count"] == 0
        assert sub["missing_step_ids"] == required

    def test_in_progress_submission_shows_partial_completion_and_exact_missing_ids(self, client):
        teacher, student, classroom_id, assignment_id = _setup_classroom_assignment(client, "partial")
        required = _required_steps()
        session_id, _ = _start(client, student, assignment_id)

        done = required[:2]
        _save_partial_progress(client, student, session_id, done)

        detail = _get_detail(client, teacher, assignment_id)
        flat_sub = next(s for s in detail["submissions"] if s["student_id"] == student["user_id"])
        assert flat_sub["status"] == "in_progress"
        assert flat_sub["required_step_count"] == len(required)
        assert flat_sub["completed_step_count"] == 2
        assert flat_sub["missing_step_ids"] == required[2:]
        assert flat_sub["marked_complete_by_teacher"] is False

        # The grouped view (submissions_by_student, #1764) must carry the same
        # fields on its attempt -- that is the shape the desktop table actually
        # reads once useGrouped is true (which it almost always is).
        group = next(
            g for g in detail["submissions_by_student"] if g["student_id"] == student["user_id"]
        )
        attempt = group["attempts"][0]
        assert attempt["required_step_count"] == len(required)
        assert attempt["completed_step_count"] == 2
        assert attempt["missing_step_ids"] == required[2:]

    def test_fully_completed_submission_has_no_missing_steps(self, client):
        teacher, student, classroom_id, assignment_id = _setup_classroom_assignment(client, "full")
        required = _required_steps()
        session_id, _ = _start(client, student, assignment_id)
        _save_partial_progress(client, student, session_id, required)

        submit_resp = client.post(
            f"/api/assignments/{assignment_id}/submit",
            headers=auth_header(student["token"]),
        )
        assert submit_resp.status_code == 200, submit_resp.text

        detail = _get_detail(client, teacher, assignment_id)
        sub = next(s for s in detail["submissions"] if s["student_id"] == student["user_id"])
        assert sub["status"] == "submitted"
        assert sub["completed_step_count"] == sub["required_step_count"]
        assert sub["missing_step_ids"] == []


# ---------------------------------------------------------------------------
# 2. POST .../mark-complete
# ---------------------------------------------------------------------------

class TestMarkSubmissionCompleteByTeacher:
    def test_owning_teacher_marks_a_stuck_submission_complete(self, client):
        teacher, student, classroom_id, assignment_id = _setup_classroom_assignment(client, "owner")
        required = _required_steps()
        session_id, submission_id = _start(client, student, assignment_id)
        _save_partial_progress(client, student, session_id, required[:1])  # badly stuck

        resp = client.post(
            f"/api/assignments/{assignment_id}/submissions/{submission_id}/mark-complete",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "submitted"
        assert body["submitted_at"] is not None
        assert body["marked_complete_by_teacher"] is True

        # Persisted, not just in the response -- a fresh GET must agree.
        detail = _get_detail(client, teacher, assignment_id)
        sub = next(s for s in detail["submissions"] if s["id"] == submission_id)
        assert sub["status"] == "submitted"
        assert sub["marked_complete_by_teacher"] is True

        # The underlying LearningSession must also flip to completed, same as
        # the student's own submit path (submit_assignment_session).
        db = TestingSessionLocal()
        session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
        assert session.status == "completed"
        meta = (session.step_progress or {}).get("__meta", {})
        assert meta["teacher_marked_complete"]["by_user_id"] == teacher["user_id"]
        db.close()

    def test_normal_fully_completed_submission_has_no_teacher_badge(self, client):
        """Regression guard: a submission a STUDENT finished normally must
        never show the teacher-marked badge."""
        teacher, student, classroom_id, assignment_id = _setup_classroom_assignment(client, "normal")
        required = _required_steps()
        session_id, _ = _start(client, student, assignment_id)
        _save_partial_progress(client, student, session_id, required)
        submit_resp = client.post(
            f"/api/assignments/{assignment_id}/submit",
            headers=auth_header(student["token"]),
        )
        assert submit_resp.status_code == 200

        detail = _get_detail(client, teacher, assignment_id)
        sub = next(s for s in detail["submissions"] if s["student_id"] == student["user_id"])
        assert sub["marked_complete_by_teacher"] is False

    def test_other_teacher_cannot_mark_complete(self, client):
        teacher, student, classroom_id, assignment_id = _setup_classroom_assignment(client, "otherteacher")
        _, submission_id = _start(client, student, assignment_id)
        other_teacher = _register_user(client, "mc_other_teacher")
        _grant_school_teacher_role(other_teacher["user_id"])

        resp = client.post(
            f"/api/assignments/{assignment_id}/submissions/{submission_id}/mark-complete",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_student_cannot_mark_complete(self, client):
        teacher, student, classroom_id, assignment_id = _setup_classroom_assignment(client, "studentcant")
        _, submission_id = _start(client, student, assignment_id)

        resp = client.post(
            f"/api/assignments/{assignment_id}/submissions/{submission_id}/mark-complete",
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 403

    def test_cannot_mark_complete_before_student_ever_started(self, client):
        teacher, student, classroom_id, assignment_id = _setup_classroom_assignment(client, "neverstarted")
        detail = _get_detail(client, teacher, assignment_id)
        submission_id = next(
            s["id"] for s in detail["submissions"] if s["student_id"] == student["user_id"]
        )

        resp = client.post(
            f"/api/assignments/{assignment_id}/submissions/{submission_id}/mark-complete",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 400

    def test_already_submitted_cannot_be_marked_complete_again(self, client):
        teacher, student, classroom_id, assignment_id = _setup_classroom_assignment(client, "alreadydone")
        required = _required_steps()
        session_id, submission_id = _start(client, student, assignment_id)
        _save_partial_progress(client, student, session_id, required)
        client.post(
            f"/api/assignments/{assignment_id}/submit",
            headers=auth_header(student["token"]),
        )

        resp = client.post(
            f"/api/assignments/{assignment_id}/submissions/{submission_id}/mark-complete",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 400

    def test_submission_id_must_belong_to_path_assignment(self, client):
        teacher1, student1, classroom1, assignment1 = _setup_classroom_assignment(client, "cross1")
        teacher2, student2, classroom2, assignment2 = _setup_classroom_assignment(client, "cross2")
        _, submission2_id = _start(client, student2, assignment2)

        resp = client.post(
            f"/api/assignments/{assignment1}/submissions/{submission2_id}/mark-complete",
            headers=auth_header(teacher1["token"]),
        )
        assert resp.status_code == 404
