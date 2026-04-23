"""
Regression tests for Issue #1251 — list_my_sessions assignment completion logic.

Context (PR #1250 / Issue #1245):
  submit_assignment() does NOT update LearningSession.status to 'completed'.
  The endpoint must treat a session as "completed" when the linked
  AssignmentSubmission.status is 'submitted' or 'graded', regardless of
  LearningSession.status.

Tests:
  1. Assignment session (LearningSession.status='in_progress',
     AssignmentSubmission.status='submitted') → included in
     ?learning_source=assignment&status=completed
  2. Self-practice session (LearningSession.status='in_progress') →
     excluded from ?learning_source=assignment&status=completed
  3. Self-practice session (LearningSession.status='completed') →
     included in ?learning_source=self&status=completed
  4. Assignment session (AssignmentSubmission.status='graded') →
     included in ?learning_source=assignment&status=completed
  5. Assignment session (AssignmentSubmission.status='pending') →
     excluded from ?learning_source=assignment&status=completed
  6. No sessions → endpoint returns empty list (not 500)
  7. Multiple sessions — only completed-assignment ones appear in filtered list
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, User
from app.models.session import LearningSession
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.school import School, Classroom, ClassroomStudent
from app.auth.password import hash_password


# ---------------------------------------------------------------------------
# In-memory SQLite DB
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    # Disable FK constraints so we can insert test rows without full cascade setup
    cursor.execute("PRAGMA foreign_keys=OFF")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

_SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin",    "display_name": "Org Admin",    "scope_level": "organization"},
    {"name": "teacher",      "display_name": "Teacher",      "scope_level": "school"},
    {"name": "student",      "display_name": "Student",      "scope_level": "school"},
]


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Module-scoped fixture: create tables once
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    for r in _SEED_ROLES:
        db.add(Role(**r))
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _register_and_login(client, suffix: str) -> dict:
    """Register a new user and return {token, user_id, email}."""
    email = f"list_sess_{suffix}@example.com"
    password = "Password1!"
    resp = client.post("/api/auth/register", json={
        "email": email, "password": password, "name": f"User {suffix}",
    })
    assert resp.status_code == 201, resp.text
    token = resp.json().get("verification_token")
    if token:
        client.get(f"/api/auth/verify-email?token={token}")
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200, login.text
    return {
        "token": login.json()["access_token"],
        "email": email,
    }


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _get_user_id(db, email: str) -> int:
    return db.query(User).filter(User.email == email).one().id


def _create_raw_session(db, student_id: int, status: str = "in_progress") -> int:
    """Insert a LearningSession row directly and return its id."""
    s = LearningSession(
        student_id=student_id,
        story_slug=None,
        status=status,
        current_step=1,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s.id


def _create_assignment_with_submission(
    db,
    teacher_id: int,
    classroom_id: int,
    student_id: int,
    session_id: int,
    sub_status: str,
) -> None:
    """Create an Assignment + AssignmentSubmission linked to the given session."""
    assignment = Assignment(
        classroom_id=classroom_id,
        teacher_id=teacher_id,
        story_id="1",
        title="Test Assignment",
        assignment_type="reading",
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)

    submission = AssignmentSubmission(
        assignment_id=assignment.id,
        student_id=student_id,
        session_id=session_id,
        status=sub_status,
    )
    db.add(submission)
    db.commit()


# ---------------------------------------------------------------------------
# Shared school/teacher/classroom (module-scoped)
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def shared_classroom(client) -> dict:
    """
    Create a teacher + school + classroom once for the module.
    Returns {teacher_id, classroom_id}.
    """
    db = TestingSessionLocal()

    school = School(name="Regression Test School 1251")
    db.add(school)
    db.commit()
    db.refresh(school)

    teacher = User(
        email="reg1251_teacher@example.com",
        username="reg1251_teacher",
        password_hash=hash_password("Password1!"),
        name="Reg Teacher",
        is_active=True,
        email_verified=True,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)

    classroom = Classroom(
        name="Reg Classroom 1251",
        school_id=school.id,
        teacher_id=teacher.id,
        join_code="REG1251",
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)

    teacher_id = teacher.id
    classroom_id = classroom.id
    db.close()

    return {"teacher_id": teacher_id, "classroom_id": classroom_id}


# ===========================================================================
# Test 1: assignment session with submission.status='submitted', session.status='in_progress'
# → MUST appear in ?learning_source=assignment&status=completed
# ===========================================================================

class TestAssignmentSubmittedCountsAsCompleted:
    """
    Core regression: submit_assignment() leaves LearningSession.status='in_progress'.
    The endpoint must still surface this session when filtering for completed
    assignment sessions.
    """

    @pytest.fixture(scope="class")
    def student(self, client):
        return _register_and_login(client, "t1_student")

    @pytest.fixture(scope="class")
    def session_and_submission(self, student, shared_classroom):
        db = TestingSessionLocal()
        student_id = _get_user_id(db, student["email"])

        # LearningSession.status is deliberately 'in_progress' (as submit_assignment leaves it)
        session_id = _create_raw_session(db, student_id, status="in_progress")

        _create_assignment_with_submission(
            db,
            teacher_id=shared_classroom["teacher_id"],
            classroom_id=shared_classroom["classroom_id"],
            student_id=student_id,
            session_id=session_id,
            sub_status="submitted",
        )
        db.close()
        return {"session_id": session_id}

    def test_appears_in_assignment_completed_filter(self, client, student, session_and_submission):
        resp = client.get(
            "/api/learning/sessions?learning_source=assignment&status=completed",
            headers=_auth(student["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        session_ids = [item["id"] for item in data["items"]]
        assert session_and_submission["session_id"] in session_ids, (
            "assignment session with submission.status='submitted' must appear "
            "in ?learning_source=assignment&status=completed even though "
            "LearningSession.status='in_progress'"
        )

    def test_total_is_positive(self, client, student):
        resp = client.get(
            "/api/learning/sessions?learning_source=assignment&status=completed",
            headers=_auth(student["token"]),
        )
        assert resp.json()["total"] >= 1

    def test_learning_source_field_is_assignment(self, client, student, session_and_submission):
        resp = client.get(
            "/api/learning/sessions?learning_source=assignment&status=completed",
            headers=_auth(student["token"]),
        )
        items = resp.json()["items"]
        target = next((i for i in items if i["id"] == session_and_submission["session_id"]), None)
        assert target is not None
        assert target.get("learning_source") == "assignment"


# ===========================================================================
# Test 2: self-practice in_progress session is excluded from assignment filter
# ===========================================================================

class TestSelfPracticeExcludedFromAssignmentCompletedFilter:
    """
    A self-practice session with status='in_progress' must NOT appear when
    filtering for completed assignment sessions.
    """

    @pytest.fixture(scope="class")
    def student(self, client):
        return _register_and_login(client, "t2_student")

    @pytest.fixture(scope="class")
    def self_session(self, student):
        db = TestingSessionLocal()
        student_id = _get_user_id(db, student["email"])
        session_id = _create_raw_session(db, student_id, status="in_progress")
        # No AssignmentSubmission — pure self practice
        db.close()
        return {"session_id": session_id}

    def test_excluded_from_assignment_completed(self, client, student, self_session):
        resp = client.get(
            "/api/learning/sessions?learning_source=assignment&status=completed",
            headers=_auth(student["token"]),
        )
        assert resp.status_code == 200
        session_ids = [item["id"] for item in resp.json()["items"]]
        assert self_session["session_id"] not in session_ids, (
            "self-practice in_progress session must NOT appear in "
            "?learning_source=assignment&status=completed"
        )

    def test_total_is_zero(self, client, student):
        resp = client.get(
            "/api/learning/sessions?learning_source=assignment&status=completed",
            headers=_auth(student["token"]),
        )
        assert resp.json()["total"] == 0


# ===========================================================================
# Test 3: self-practice completed session appears in self completed filter
# ===========================================================================

class TestSelfPracticeCompletedSessionAppears:
    """
    A self-practice session with LearningSession.status='completed' must appear
    when filtering ?learning_source=self&status=completed.
    """

    @pytest.fixture(scope="class")
    def student(self, client):
        return _register_and_login(client, "t3_student")

    @pytest.fixture(scope="class")
    def completed_self_session(self, student):
        db = TestingSessionLocal()
        student_id = _get_user_id(db, student["email"])
        session_id = _create_raw_session(db, student_id, status="completed")
        db.close()
        return {"session_id": session_id}

    def test_appears_in_self_completed_filter(self, client, student, completed_self_session):
        resp = client.get(
            "/api/learning/sessions?learning_source=self&status=completed",
            headers=_auth(student["token"]),
        )
        assert resp.status_code == 200
        session_ids = [item["id"] for item in resp.json()["items"]]
        assert completed_self_session["session_id"] in session_ids, (
            "self-practice session with status='completed' must appear "
            "in ?learning_source=self&status=completed"
        )

    def test_learning_source_field_is_self(self, client, student, completed_self_session):
        resp = client.get(
            "/api/learning/sessions?learning_source=self&status=completed",
            headers=_auth(student["token"]),
        )
        items = resp.json()["items"]
        target = next((i for i in items if i["id"] == completed_self_session["session_id"]), None)
        assert target is not None
        assert target.get("learning_source") == "self"


# ===========================================================================
# Test 4: assignment session with submission.status='graded' also counts
# ===========================================================================

class TestAssignmentGradedCountsAsCompleted:
    """
    submission.status='graded' is another terminal state that should appear
    in ?learning_source=assignment&status=completed.
    """

    @pytest.fixture(scope="class")
    def student(self, client):
        return _register_and_login(client, "t4_student")

    @pytest.fixture(scope="class")
    def graded_session(self, student, shared_classroom):
        db = TestingSessionLocal()
        student_id = _get_user_id(db, student["email"])
        session_id = _create_raw_session(db, student_id, status="in_progress")
        _create_assignment_with_submission(
            db,
            teacher_id=shared_classroom["teacher_id"],
            classroom_id=shared_classroom["classroom_id"],
            student_id=student_id,
            session_id=session_id,
            sub_status="graded",
        )
        db.close()
        return {"session_id": session_id}

    def test_graded_appears_in_completed_filter(self, client, student, graded_session):
        resp = client.get(
            "/api/learning/sessions?learning_source=assignment&status=completed",
            headers=_auth(student["token"]),
        )
        assert resp.status_code == 200
        session_ids = [item["id"] for item in resp.json()["items"]]
        assert graded_session["session_id"] in session_ids, (
            "assignment session with submission.status='graded' must appear "
            "in ?learning_source=assignment&status=completed"
        )


# ===========================================================================
# Test 5: assignment session with submission.status='pending' is excluded
# ===========================================================================

class TestAssignmentPendingExcludedFromCompleted:
    """
    submission.status='pending' (not done) must NOT appear in the completed filter.
    """

    @pytest.fixture(scope="class")
    def student(self, client):
        return _register_and_login(client, "t5_student")

    @pytest.fixture(scope="class")
    def pending_session(self, student, shared_classroom):
        db = TestingSessionLocal()
        student_id = _get_user_id(db, student["email"])
        session_id = _create_raw_session(db, student_id, status="in_progress")
        _create_assignment_with_submission(
            db,
            teacher_id=shared_classroom["teacher_id"],
            classroom_id=shared_classroom["classroom_id"],
            student_id=student_id,
            session_id=session_id,
            sub_status="pending",
        )
        db.close()
        return {"session_id": session_id}

    def test_pending_excluded_from_completed_filter(self, client, student, pending_session):
        resp = client.get(
            "/api/learning/sessions?learning_source=assignment&status=completed",
            headers=_auth(student["token"]),
        )
        assert resp.status_code == 200
        session_ids = [item["id"] for item in resp.json()["items"]]
        assert pending_session["session_id"] not in session_ids, (
            "assignment session with submission.status='pending' must NOT "
            "appear in ?learning_source=assignment&status=completed"
        )


# ===========================================================================
# Test 6: student with no sessions returns empty list (not 500)
# ===========================================================================

class TestNoSessionsReturnsEmpty:
    @pytest.fixture(scope="class")
    def fresh_student(self, client):
        return _register_and_login(client, "t6_fresh")

    def test_empty_list(self, client, fresh_student):
        resp = client.get(
            "/api/learning/sessions",
            headers=_auth(fresh_student["token"]),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["items"] == []
        assert body["total"] == 0

    def test_empty_with_assignment_completed_filter(self, client, fresh_student):
        resp = client.get(
            "/api/learning/sessions?learning_source=assignment&status=completed",
            headers=_auth(fresh_student["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["total"] == 0


# ===========================================================================
# Test 7: mixed sessions — filter precision (only correct ones surface)
# ===========================================================================

class TestMixedSessionsFilterPrecision:
    """
    A student has three sessions:
    - assignment session with submission='submitted'  → completed assignment
    - assignment session with submission='pending'    → NOT completed
    - self-practice session with status='completed'   → NOT assignment

    ?learning_source=assignment&status=completed should return exactly 1 item.
    """

    @pytest.fixture(scope="class")
    def student(self, client):
        return _register_and_login(client, "t7_mixed")

    @pytest.fixture(scope="class")
    def mixed_sessions(self, student, shared_classroom):
        db = TestingSessionLocal()
        student_id = _get_user_id(db, student["email"])

        # Session A: assignment, submission submitted → should appear
        sess_a_id = _create_raw_session(db, student_id, status="in_progress")
        _create_assignment_with_submission(
            db,
            teacher_id=shared_classroom["teacher_id"],
            classroom_id=shared_classroom["classroom_id"],
            student_id=student_id,
            session_id=sess_a_id,
            sub_status="submitted",
        )

        # Session B: assignment, submission pending → should NOT appear
        sess_b_id = _create_raw_session(db, student_id, status="in_progress")
        _create_assignment_with_submission(
            db,
            teacher_id=shared_classroom["teacher_id"],
            classroom_id=shared_classroom["classroom_id"],
            student_id=student_id,
            session_id=sess_b_id,
            sub_status="pending",
        )

        # Session C: self-practice completed → should NOT appear for assignment filter
        sess_c_id = _create_raw_session(db, student_id, status="completed")

        db.close()
        return {"submitted": sess_a_id, "pending": sess_b_id, "self_completed": sess_c_id}

    def test_only_submitted_assignment_appears(self, client, student, mixed_sessions):
        resp = client.get(
            "/api/learning/sessions?learning_source=assignment&status=completed",
            headers=_auth(student["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        session_ids = [item["id"] for item in data["items"]]

        assert mixed_sessions["submitted"] in session_ids
        assert mixed_sessions["pending"] not in session_ids
        assert mixed_sessions["self_completed"] not in session_ids

    def test_total_is_exactly_one(self, client, student):
        resp = client.get(
            "/api/learning/sessions?learning_source=assignment&status=completed",
            headers=_auth(student["token"]),
        )
        assert resp.json()["total"] == 1

    def test_self_completed_appears_in_self_filter(self, client, student, mixed_sessions):
        resp = client.get(
            "/api/learning/sessions?learning_source=self&status=completed",
            headers=_auth(student["token"]),
        )
        session_ids = [item["id"] for item in resp.json()["items"]]
        assert mixed_sessions["self_completed"] in session_ids
        assert mixed_sessions["submitted"] not in session_ids
        assert mixed_sessions["pending"] not in session_ids
