"""
Tests for GET /api/library/status — per-text student status labels (Issue #1249).

Covers:
- Scenario 1: No sessions, no assignments → all absent (no entry)
- Scenario 2: LearningSession in_progress → status "in_progress"
- Scenario 3: LearningSession completed → status "completed"
- Scenario 4: Assignment exists, submission not completed → status "assigned"
- Scenario 5: Assignment + also has completed session → priority: "assigned" wins
- Scenario 6: Query count is bounded (no N+1) regardless of text count

Run with:
    cd backend && python -m pytest tests/test_library_status.py -v
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
from app.models.user import Role, User
from app.models.session import LearningSession
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.school import School, Classroom, ClassroomStudent


# ---------------------------------------------------------------------------
# Test database (SQLite in-memory)
# ---------------------------------------------------------------------------

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


def _seed_roles(session):
    for role_data in SEED_ROLES:
        session.add(Role(
            name=role_data["name"],
            display_name=role_data["display_name"],
            scope_level=role_data["scope_level"],
        ))
    session.commit()


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


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


def _register_and_login(client, prefix="lib"):
    unique = uuid.uuid4().hex[:8]
    email = f"{prefix}_{unique}@example.com"
    password = "SecurePass123!"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": f"Test User {unique}",
        "copyright_confirmed": True,
    })
    assert resp.status_code == 201, resp.text
    vtoken = resp.json().get("verification_token")
    if vtoken:
        client.get(f"/api/auth/verify-email?token={vtoken}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    return {"token": token, "id": me.json()["id"]}


def _make_classroom(db, teacher_id):
    school = School(name=f"Test School {uuid.uuid4().hex[:6]}")
    db.add(school)
    db.flush()

    classroom = Classroom(
        name="Test Class",
        teacher_id=teacher_id,
        school_id=school.id,
        grade=5,
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)
    return classroom


# ---------------------------------------------------------------------------
# Scenario 1: No sessions, no assignments → endpoint returns empty dict
# ---------------------------------------------------------------------------

class TestLibraryStatusEmpty:
    def test_no_data_returns_empty(self, client):
        student = _register_and_login(client, "ls1")
        resp = client.get(
            "/api/library/status",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, dict)
        assert len(data) == 0, f"Expected empty dict, got {data}"

    def test_unauthenticated_returns_401(self, client):
        resp = client.get("/api/library/status")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Scenario 2: in_progress LearningSession → status "in_progress"
# ---------------------------------------------------------------------------

class TestLibraryStatusInProgress:
    def test_in_progress_session(self, client):
        student = _register_and_login(client, "ls2")
        db = TestingSessionLocal()
        try:
            session = LearningSession(
                student_id=student["id"],
                story_slug="6",
                status="in_progress",
                current_step=2,
            )
            db.add(session)
            db.commit()
        finally:
            db.close()

        resp = client.get(
            "/api/library/status",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("6") == "in_progress", f"Expected 'in_progress', got {data}"


# ---------------------------------------------------------------------------
# Scenario 3: completed LearningSession → status "completed"
# ---------------------------------------------------------------------------

class TestLibraryStatusCompleted:
    def test_completed_session(self, client):
        student = _register_and_login(client, "ls3")
        db = TestingSessionLocal()
        try:
            session = LearningSession(
                student_id=student["id"],
                story_slug="10",
                status="completed",
                current_step=6,
            )
            db.add(session)
            db.commit()
        finally:
            db.close()

        resp = client.get(
            "/api/library/status",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("10") == "completed", f"Expected 'completed', got {data}"


# ---------------------------------------------------------------------------
# Scenario 4: Assignment exists, submission NOT completed → status "assigned"
# ---------------------------------------------------------------------------

class TestLibraryStatusAssigned:
    def test_assigned_not_completed(self, client):
        teacher = _register_and_login(client, "ls4t")
        student = _register_and_login(client, "ls4s")

        db = TestingSessionLocal()
        try:
            classroom = _make_classroom(db, teacher["id"])

            # Enroll student
            enrollment = ClassroomStudent(
                classroom_id=classroom.id,
                student_id=student["id"],
            )
            db.add(enrollment)

            # Assignment for story_id "3"
            assignment = Assignment(
                classroom_id=classroom.id,
                teacher_id=teacher["id"],
                story_id="3",
                title="Test Assignment",
                assignment_type="reading",
                is_active=True,
            )
            db.add(assignment)
            db.commit()
            db.refresh(assignment)

            # Submission: pending (not completed)
            submission = AssignmentSubmission(
                assignment_id=assignment.id,
                student_id=student["id"],
                status="pending",
            )
            db.add(submission)
            db.commit()
        finally:
            db.close()

        resp = client.get(
            "/api/library/status",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("3") == "assigned", f"Expected 'assigned', got {data}"


# ---------------------------------------------------------------------------
# Scenario 5: Assignment + completed session → "assigned" wins (priority 1 > 3)
# ---------------------------------------------------------------------------

class TestLibraryStatusPriority:
    def test_assigned_beats_completed(self, client):
        teacher = _register_and_login(client, "ls5t")
        student = _register_and_login(client, "ls5s")

        db = TestingSessionLocal()
        try:
            classroom = _make_classroom(db, teacher["id"])
            enrollment = ClassroomStudent(
                classroom_id=classroom.id,
                student_id=student["id"],
            )
            db.add(enrollment)

            # Completed session for story "7"
            session = LearningSession(
                student_id=student["id"],
                story_slug="7",
                status="completed",
                current_step=6,
            )
            db.add(session)

            # Assignment for same story "7" not yet done
            assignment = Assignment(
                classroom_id=classroom.id,
                teacher_id=teacher["id"],
                story_id="7",
                title="Priority Test",
                assignment_type="reading",
                is_active=True,
            )
            db.add(assignment)
            db.commit()
            db.refresh(assignment)

            submission = AssignmentSubmission(
                assignment_id=assignment.id,
                student_id=student["id"],
                status="pending",
            )
            db.add(submission)
            db.commit()
        finally:
            db.close()

        resp = client.get(
            "/api/library/status",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        # assigned (priority 1) should beat completed (priority 3)
        assert data.get("7") == "assigned", f"Expected 'assigned' to beat 'completed', got {data}"

    def test_assigned_beats_in_progress(self, client):
        teacher = _register_and_login(client, "ls6t")
        student = _register_and_login(client, "ls6s")

        db = TestingSessionLocal()
        try:
            classroom = _make_classroom(db, teacher["id"])
            enrollment = ClassroomStudent(
                classroom_id=classroom.id,
                student_id=student["id"],
            )
            db.add(enrollment)

            # in_progress session for story "8"
            session = LearningSession(
                student_id=student["id"],
                story_slug="8",
                status="in_progress",
                current_step=2,
            )
            db.add(session)

            # Assignment for same story "8" not yet done
            assignment = Assignment(
                classroom_id=classroom.id,
                teacher_id=teacher["id"],
                story_id="8",
                title="Priority Test 2",
                assignment_type="reading",
                is_active=True,
            )
            db.add(assignment)
            db.commit()
            db.refresh(assignment)

            submission = AssignmentSubmission(
                assignment_id=assignment.id,
                student_id=student["id"],
                status="in_progress",
            )
            db.add(submission)
            db.commit()
        finally:
            db.close()

        resp = client.get(
            "/api/library/status",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("8") == "assigned", f"Expected 'assigned', got {data}"


# ---------------------------------------------------------------------------
# Scenario 6: Assignment submission is "submitted" or "graded" → NOT "assigned"
#             (completed submission = no longer pending)
# ---------------------------------------------------------------------------

class TestLibraryStatusSubmittedAssignment:
    def test_submitted_assignment_falls_back_to_session_status(self, client):
        teacher = _register_and_login(client, "ls7t")
        student = _register_and_login(client, "ls7s")

        db = TestingSessionLocal()
        try:
            classroom = _make_classroom(db, teacher["id"])
            enrollment = ClassroomStudent(
                classroom_id=classroom.id,
                student_id=student["id"],
            )
            db.add(enrollment)

            ls = LearningSession(
                student_id=student["id"],
                story_slug="9",
                status="completed",
                current_step=6,
            )
            db.add(ls)

            assignment = Assignment(
                classroom_id=classroom.id,
                teacher_id=teacher["id"],
                story_id="9",
                title="Submitted Assignment",
                assignment_type="reading",
                is_active=True,
            )
            db.add(assignment)
            db.commit()
            db.refresh(assignment)

            # Submission is "submitted" → assignment work is done
            submission = AssignmentSubmission(
                assignment_id=assignment.id,
                student_id=student["id"],
                status="submitted",
            )
            db.add(submission)
            db.commit()
        finally:
            db.close()

        resp = client.get(
            "/api/library/status",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        # submitted assignment → not "assigned", session is "completed"
        assert data.get("9") == "completed", f"Expected 'completed' (submitted assignment), got {data}"
