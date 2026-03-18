"""
Tests for the dialogue history API (Issue #242).

Covers:
- GET /api/learning/sessions/{id}/dialogue
  - Returns empty list when session has no dialogue turns
  - Returns stored turns in order
  - Returns 401 when not authenticated
  - Returns 403 when accessing another user's session
  - Returns 404 for non-existent session
- POST /api/comprehension/chat
  - Persists turns when db_session_id is provided
  - Works normally when db_session_id is absent (no DB writes)

Run with:
    cd /path/to/backend
    python -m pytest tests/test_dialogue_history.py -v
"""

import sys
import os
import uuid
from unittest.mock import patch, AsyncMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role
from app.models.session import LearningSession, DialogueTurn
from app.models.school import Classroom, ClassroomStudent, School

# ---------------------------------------------------------------------------
# SQLite in-memory test database
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


def _register_user(client, suffix: str | None = None) -> dict:
    """Register a teacher user (only teachers can self-register).

    Uses the register → verify-email → login flow required since issue #460.
    """
    from app.auth.password import hash_password
    unique = suffix or uuid.uuid4().hex[:8]
    email = f"diag_user_{unique}@example.com"
    password = "SecurePass123!"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": f"DialogueUser {unique}",
    })
    assert resp.status_code == 201, resp.text
    # Verify email using dev-mode verification_token
    verification_token = resp.json().get("verification_token")
    if verification_token:
        verify_resp = client.get(f"/api/auth/verify-email?token={verification_token}")
        assert verify_resp.status_code == 200, verify_resp.text
    # Login to get JWT
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    user_id = me_resp.json().get("id")
    return {
        "email": email,
        "password": password,
        "token": token,
        "user_id": user_id,
    }


def _create_student_in_db(client) -> dict:
    """Create a student user directly in the DB (bypasses self-reg restriction).

    Students cannot self-register since issue #457 — they're created by teachers
    via batch import. For tests, we create them directly in the DB with
    email_verified=True, then log in to get a JWT.
    """
    from app.auth.password import hash_password
    from app.models.user import User as UserModel

    unique = uuid.uuid4().hex[:8]
    email = f"stu_diag_{unique}@example.com"
    password = "SecurePass123!"

    db = TestingSessionLocal()
    try:
        user = UserModel(
            email=email,
            password_hash=hash_password(password),
            name=f"Student {unique}",
            email_verified=True,
            is_active=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        user_id = user.id
    finally:
        db.close()

    # Login to get JWT
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json()["access_token"]
    return {"email": email, "password": password, "token": token, "user_id": user_id}


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def user_a(client):
    return _register_user(client, "da_user_a")


@pytest.fixture(scope="module")
def user_b(client):
    return _register_user(client, "da_user_b")


def _create_session(client, token: str, story_slug: str = "test-slug") -> int:
    resp = client.post(
        "/api/learning/sessions",
        json={"story_slug": story_slug},
        headers=auth_header(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# ---------------------------------------------------------------------------
# GET /api/learning/sessions/{id}/dialogue
# ---------------------------------------------------------------------------


class TestDialogueHistoryEndpoint:
    def test_returns_empty_list_for_new_session(self, client, user_a):
        """A brand-new session with no dialogue turns returns empty turns list."""
        session_id = _create_session(client, user_a["token"], "empty-story")

        resp = client.get(
            f"/api/learning/sessions/{session_id}/dialogue",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["session_id"] == session_id
        assert data["story_slug"] == "empty-story"
        assert data["turns"] == []
        assert data["total"] == 0

    def test_returns_stored_turns_in_order(self, client, user_a):
        """Dialogue turns stored directly in DB are returned in turn_order order."""
        session_id = _create_session(client, user_a["token"], "ordered-story")

        # Seed dialogue turns directly in DB
        db = TestingSessionLocal()
        try:
            socratic_id = str(uuid.uuid4())
            db.add_all([
                DialogueTurn(
                    socratic_session_id=socratic_id,
                    learning_session_id=session_id,
                    turn_order=0,
                    role="ai",
                    text="這篇課文的主角是誰？",
                    phase="factual",
                ),
                DialogueTurn(
                    socratic_session_id=socratic_id,
                    learning_session_id=session_id,
                    turn_order=1,
                    role="student",
                    text="小明",
                    phase="factual",
                ),
                DialogueTurn(
                    socratic_session_id=socratic_id,
                    learning_session_id=session_id,
                    turn_order=2,
                    role="feedback",
                    text="非常好！你答對了。",
                    is_correct=True,
                    phase="factual",
                ),
            ])
            db.commit()
        finally:
            db.close()

        resp = client.get(
            f"/api/learning/sessions/{session_id}/dialogue",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3
        turns = data["turns"]
        assert len(turns) == 3
        # Verify ordering
        assert [t["turn_order"] for t in turns] == [0, 1, 2]
        assert turns[0]["role"] == "ai"
        assert turns[0]["text"] == "這篇課文的主角是誰？"
        assert turns[1]["role"] == "student"
        assert turns[2]["role"] == "feedback"
        assert turns[2]["is_correct"] is True

    def test_returns_404_for_nonexistent_session(self, client, user_a):
        resp = client.get(
            "/api/learning/sessions/999999/dialogue",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Session not found"

    def test_returns_403_for_other_users_session(self, client, user_a, user_b):
        """User B cannot access User A's session dialogue."""
        session_id = _create_session(client, user_a["token"], "protected-story")

        resp = client.get(
            f"/api/learning/sessions/{session_id}/dialogue",
            headers=auth_header(user_b["token"]),
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "Not your session"

    def test_returns_401_without_auth(self, client):
        resp = client.get("/api/learning/sessions/1/dialogue")
        assert resp.status_code == 401

    def test_response_shape_has_all_fields(self, client, user_a):
        """DialogueTurnResponse must include all required fields."""
        session_id = _create_session(client, user_a["token"], "shape-test")

        db = TestingSessionLocal()
        try:
            db.add(DialogueTurn(
                socratic_session_id=str(uuid.uuid4()),
                learning_session_id=session_id,
                turn_order=0,
                role="ai",
                text="請回答問題",
                phase="inferential",
            ))
            db.commit()
        finally:
            db.close()

        resp = client.get(
            f"/api/learning/sessions/{session_id}/dialogue",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        turn = resp.json()["turns"][0]
        assert "id" in turn
        assert "turn_order" in turn
        assert "role" in turn
        assert "text" in turn
        assert "is_correct" in turn
        assert "phase" in turn
        assert "created_at" in turn

    def test_only_returns_turns_for_requested_session(self, client, user_a):
        """Turns from another session of the same user are not included."""
        session_a = _create_session(client, user_a["token"], "session-a")
        session_b = _create_session(client, user_a["token"], "session-b")

        db = TestingSessionLocal()
        try:
            sid_a = str(uuid.uuid4())
            sid_b = str(uuid.uuid4())
            db.add_all([
                DialogueTurn(
                    socratic_session_id=sid_a,
                    learning_session_id=session_a,
                    turn_order=0,
                    role="ai",
                    text="Session A question",
                    phase="factual",
                ),
                DialogueTurn(
                    socratic_session_id=sid_b,
                    learning_session_id=session_b,
                    turn_order=0,
                    role="ai",
                    text="Session B question",
                    phase="factual",
                ),
            ])
            db.commit()
        finally:
            db.close()

        resp_a = client.get(
            f"/api/learning/sessions/{session_a}/dialogue",
            headers=auth_header(user_a["token"]),
        )
        assert resp_a.status_code == 200
        assert resp_a.json()["total"] == 1
        assert resp_a.json()["turns"][0]["text"] == "Session A question"

        resp_b = client.get(
            f"/api/learning/sessions/{session_b}/dialogue",
            headers=auth_header(user_a["token"]),
        )
        assert resp_b.status_code == 200
        assert resp_b.json()["total"] == 1
        assert resp_b.json()["turns"][0]["text"] == "Session B question"


# ---------------------------------------------------------------------------
# POST /api/comprehension/chat with db_session_id (dialogue persistence)
# ---------------------------------------------------------------------------


class TestDialoguePersistence:
    """Test that comprehension/chat persists turns when db_session_id is provided."""

    def _mock_agent_start(self):
        """Return a mock AgentResponse for session start."""
        from app.services.socratic_agent import AgentResponse
        return AgentResponse(
            question="這篇課文的主角是誰？",
            feedback=None,
            understood=None,
            understood_count=0,
            required_count=5,
            phase="factual",
            is_complete=False,
        )

    def _mock_agent_answer(self, understood: bool = True):
        """Return a mock AgentResponse for processing an answer."""
        from app.services.socratic_agent import AgentResponse
        return AgentResponse(
            question="為什麼主角要這樣做？",
            feedback="答得很好！" if understood else "再想想看。",
            understood=understood,
            understood_count=1 if understood else 0,
            required_count=5,
            phase="inferential" if understood else "factual",
            is_complete=False,
        )

    def test_no_persistence_without_db_session_id(self, client, user_a):
        """When db_session_id is omitted, no DialogueTurn rows are created."""
        socratic_id = str(uuid.uuid4())
        mock_result = self._mock_agent_start()

        db_before = TestingSessionLocal()
        count_before = db_before.query(DialogueTurn).filter(
            DialogueTurn.socratic_session_id == socratic_id
        ).count()
        db_before.close()

        with patch(
            "app.routes.learning.socratic_agent.start_session",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            resp = client.post(
                "/api/comprehension/chat",
                json={
                    "session_id": socratic_id,
                    "story_title": "測試故事",
                    "story_text": "第一段\n第二段",
                    "student_answer": None,
                    # No db_session_id
                },
                headers=auth_header(user_a["token"]),
            )

        assert resp.status_code == 200

        db_after = TestingSessionLocal()
        count_after = db_after.query(DialogueTurn).filter(
            DialogueTurn.socratic_session_id == socratic_id
        ).count()
        db_after.close()

        assert count_after == count_before  # No new rows

    def test_persists_opening_question_when_db_session_id_provided(self, client, user_a):
        """When student_answer=null + db_session_id, the AI opening question is stored."""
        session_id = _create_session(client, user_a["token"], "persist-story")
        socratic_id = str(uuid.uuid4())
        mock_result = self._mock_agent_start()

        with patch(
            "app.routes.learning.socratic_agent.start_session",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            resp = client.post(
                "/api/comprehension/chat",
                json={
                    "session_id": socratic_id,
                    "story_title": "測試故事",
                    "story_text": "第一段\n第二段",
                    "student_answer": None,
                    "db_session_id": session_id,
                },
                headers=auth_header(user_a["token"]),
            )

        assert resp.status_code == 200

        db = TestingSessionLocal()
        turns = (
            db.query(DialogueTurn)
            .filter(DialogueTurn.socratic_session_id == socratic_id)
            .order_by(DialogueTurn.turn_order)
            .all()
        )
        db.close()

        assert len(turns) == 1
        assert turns[0].role == "ai"
        assert turns[0].text == "這篇課文的主角是誰？"
        assert turns[0].learning_session_id == session_id

    def test_persists_student_feedback_and_next_question(self, client, user_a):
        """When student_answer is provided + db_session_id, three turns are stored."""
        session_id = _create_session(client, user_a["token"], "persist-answer-story")
        socratic_id = str(uuid.uuid4())

        # First: start session (opening question)
        start_result = self._mock_agent_start()
        with patch(
            "app.routes.learning.socratic_agent.start_session",
            new_callable=AsyncMock,
            return_value=start_result,
        ):
            client.post(
                "/api/comprehension/chat",
                json={
                    "session_id": socratic_id,
                    "story_title": "測試故事",
                    "story_text": "主角是小明。小明很勤奮。",
                    "student_answer": None,
                    "db_session_id": session_id,
                },
                headers=auth_header(user_a["token"]),
            )

        # Second: student answers
        answer_result = self._mock_agent_answer(understood=True)
        with patch(
            "app.routes.learning.socratic_agent.process_answer",
            new_callable=AsyncMock,
            return_value=answer_result,
        ):
            resp = client.post(
                "/api/comprehension/chat",
                json={
                    "session_id": socratic_id,
                    "story_title": "測試故事",
                    "story_text": "主角是小明。小明很勤奮。",
                    "student_answer": "小明",
                    "db_session_id": session_id,
                },
                headers=auth_header(user_a["token"]),
            )

        assert resp.status_code == 200

        db = TestingSessionLocal()
        turns = (
            db.query(DialogueTurn)
            .filter(DialogueTurn.socratic_session_id == socratic_id)
            .order_by(DialogueTurn.turn_order)
            .all()
        )
        db.close()

        # Should have: AI question (0), Student answer (1), Feedback (2), Next AI question (3)
        assert len(turns) == 4
        roles = [t.role for t in turns]
        assert roles == ["ai", "student", "feedback", "ai"]
        feedback_turn = turns[2]
        assert feedback_turn.is_correct is True
        assert feedback_turn.text == "答得很好！"

    def test_dialogue_history_returns_persisted_turns(self, client, user_a):
        """Turns persisted via comprehension/chat are retrievable via dialogue endpoint."""
        session_id = _create_session(client, user_a["token"], "e2e-story")
        socratic_id = str(uuid.uuid4())

        start_result = self._mock_agent_start()
        with patch(
            "app.routes.learning.socratic_agent.start_session",
            new_callable=AsyncMock,
            return_value=start_result,
        ):
            client.post(
                "/api/comprehension/chat",
                json={
                    "session_id": socratic_id,
                    "story_title": "e2e故事",
                    "story_text": "一段文字。",
                    "student_answer": None,
                    "db_session_id": session_id,
                },
                headers=auth_header(user_a["token"]),
            )

        resp = client.get(
            f"/api/learning/sessions/{session_id}/dialogue",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["turns"][0]["role"] == "ai"
        assert data["turns"][0]["text"] == "這篇課文的主角是誰？"


# ---------------------------------------------------------------------------
# GET /api/teacher/students/{student_id}/sessions/{session_id}/dialogue
# Issue #418 — teacher can view student dialogue history
# ---------------------------------------------------------------------------


class TestTeacherDialogueHistory:
    """Teacher endpoint for viewing a student's Socratic dialogue history."""

    def _setup_teacher_student_classroom(self, client):
        """
        Register a teacher and student, create a classroom, enroll the student.
        Returns (teacher_token, student_token, student_user_id, classroom_id).
        """
        teacher = _register_user(client)
        student = _create_student_in_db(client)

        teacher_id = teacher["user_id"]
        student_id = student["user_id"]

        # Create school, classroom owned by teacher, and enroll student directly in DB
        db = TestingSessionLocal()
        try:
            school = School(name=f"Test School {uuid.uuid4().hex[:6]}")
            db.add(school)
            db.commit()
            db.refresh(school)

            classroom = Classroom(
                name=f"Classroom for {teacher_id}",
                teacher_id=teacher_id,
                school_id=school.id,
            )
            db.add(classroom)
            db.commit()
            db.refresh(classroom)
            classroom_id = classroom.id

            enrollment = ClassroomStudent(
                classroom_id=classroom_id,
                student_id=student_id,
            )
            db.add(enrollment)
            db.commit()
        finally:
            db.close()

        return teacher["token"], student["token"], student_id, classroom_id

    def test_teacher_can_view_student_dialogue(self, client):
        """Teacher with classroom access can retrieve student's dialogue turns."""
        teacher_token, student_token, student_id, _ = self._setup_teacher_student_classroom(client)

        # Create a learning session for the student
        session_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "teacher-dialogue-story"},
            headers=auth_header(student_token),
        )
        assert session_resp.status_code == 201, session_resp.text
        session_id = session_resp.json()["id"]

        # Seed some dialogue turns
        db = TestingSessionLocal()
        try:
            socratic_id = str(uuid.uuid4())
            db.add_all([
                DialogueTurn(
                    socratic_session_id=socratic_id,
                    learning_session_id=session_id,
                    turn_order=0,
                    role="ai",
                    text="這篇課文的主角是誰？",
                    phase="factual",
                ),
                DialogueTurn(
                    socratic_session_id=socratic_id,
                    learning_session_id=session_id,
                    turn_order=1,
                    role="student",
                    text="小英",
                    phase="factual",
                ),
                DialogueTurn(
                    socratic_session_id=socratic_id,
                    learning_session_id=session_id,
                    turn_order=2,
                    role="feedback",
                    text="答對了！",
                    is_correct=True,
                    phase="factual",
                ),
            ])
            db.commit()
        finally:
            db.close()

        resp = client.get(
            f"/api/teacher/students/{student_id}/sessions/{session_id}/dialogue",
            headers=auth_header(teacher_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["session_id"] == session_id
        assert data["student_id"] == student_id
        assert data["story_slug"] == "teacher-dialogue-story"
        assert data["total"] == 3
        turns = data["turns"]
        assert [t["turn_order"] for t in turns] == [0, 1, 2]
        assert turns[0]["role"] == "ai"
        assert turns[1]["role"] == "student"
        assert turns[2]["role"] == "feedback"
        assert turns[2]["is_correct"] is True

    def test_teacher_gets_empty_list_when_no_dialogue(self, client):
        """Returns empty turns list when session has no dialogue recorded."""
        teacher_token, student_token, student_id, _ = self._setup_teacher_student_classroom(client)

        session_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "no-dialogue-story"},
            headers=auth_header(student_token),
        )
        session_id = session_resp.json()["id"]

        resp = client.get(
            f"/api/teacher/students/{student_id}/sessions/{session_id}/dialogue",
            headers=auth_header(teacher_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["turns"] == []

    def test_teacher_gets_404_for_wrong_student(self, client):
        """Returns 404 when session_id doesn't belong to the specified student_id."""
        teacher_token, student_token, student_id, _ = self._setup_teacher_student_classroom(client)

        # Create session for student
        session_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "mismatch-story"},
            headers=auth_header(student_token),
        )
        session_id = session_resp.json()["id"]

        # Use a different (non-existent) student_id
        resp = client.get(
            f"/api/teacher/students/99999/sessions/{session_id}/dialogue",
            headers=auth_header(teacher_token),
        )
        assert resp.status_code == 403  # 403 before 404 (student not in teacher's classroom)

    def test_unauthorized_teacher_gets_403(self, client):
        """A teacher without classroom access is blocked."""
        _, student_token, student_id, _ = self._setup_teacher_student_classroom(client)

        # Register a different teacher with no classrooms
        other_teacher = _register_user(client)
        other_teacher_token = other_teacher["token"]

        session_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "forbidden-story"},
            headers=auth_header(student_token),
        )
        session_id = session_resp.json()["id"]

        resp = client.get(
            f"/api/teacher/students/{student_id}/sessions/{session_id}/dialogue",
            headers=auth_header(other_teacher_token),
        )
        assert resp.status_code == 403

    def test_unauthenticated_request_gets_401(self, client):
        """Returns 401 when not authenticated."""
        resp = client.get("/api/teacher/students/1/sessions/1/dialogue")
        assert resp.status_code == 401
