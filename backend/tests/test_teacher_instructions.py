"""
Tests for teacher special instructions API (Issue #90).

Covers:
- POST /api/teacher/students/{student_id}/instructions  (create)
- GET  /api/teacher/students/{student_id}/instructions   (list active)
- PATCH /api/teacher/instructions/{instruction_id}       (update)
- DELETE /api/teacher/instructions/{instruction_id}      (soft delete)
- Authorization checks (teacher must own classroom)
- Instruction type validation
- Integration with Socratic agent (verify instructions in system prompt)

Run with:
    cd backend && python -m pytest tests/test_teacher_instructions.py -v
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
from app.models.user import Role, UserRole
from app.models.school import School


# ---------------------------------------------------------------------------
# Test database setup (SQLite in-memory with StaticPool)
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
        session.add(Role(**role_data))
    session.commit()


def _seed_school(session) -> int:
    school = School(name="Instruction Test School")
    session.add(school)
    session.commit()
    session.refresh(school)
    return school.id


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_test_school_id: int = 0


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _test_school_id
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    _test_school_id = _seed_school(session)
    session.close()

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


@pytest.fixture(scope="module")
def school_id():
    return _test_school_id


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{suffix.title()} {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    user_id = me_resp.json()["id"]
    return {"email": email, "name": name, "token": token, "user_id": user_id}


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_admin(user_id: int):
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == "system_admin").first()
    user_role = UserRole(
        user_id=user_id,
        role_id=role.id,
        scope_type="platform",
        scope_id=None,
    )
    db.add(user_role)
    db.commit()
    db.close()


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "instr_teacher")


@pytest.fixture(scope="module")
def other_teacher(client):
    return _register_user(client, "instr_other")


@pytest.fixture(scope="module")
def student1(client):
    return _register_user(client, "instr_stu1")


@pytest.fixture(scope="module")
def student2(client):
    return _register_user(client, "instr_stu2")


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "instr_admin")
    _make_admin(user["user_id"])
    return user


@pytest.fixture(scope="module")
def classroom_with_student(client, teacher, student1, school_id):
    """Create a classroom with student1 enrolled, owned by teacher."""
    create_resp = client.post(
        "/api/classrooms",
        json={"name": "Instruction Test Class", "school_id": school_id},
        headers=auth_header(teacher["token"]),
    )
    assert create_resp.status_code == 201
    classroom_id = create_resp.json()["id"]

    # Add student
    add_resp = client.post(
        f"/api/classrooms/{classroom_id}/students",
        json={"student_id": student1["user_id"]},
        headers=auth_header(teacher["token"]),
    )
    assert add_resp.status_code == 201

    return classroom_id


# ===========================================================================
# POST /api/teacher/students/{student_id}/instructions — Create instruction
# ===========================================================================


class TestCreateInstruction:
    def test_create_instruction_happy_path(self, client, teacher, student1, classroom_with_student):
        resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "general",
                "content": "This student needs extra encouragement",
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["teacher_id"] == teacher["user_id"]
        assert data["student_id"] == student1["user_id"]
        assert data["classroom_id"] == classroom_with_student
        assert data["instruction_type"] == "general"
        assert data["content"] == "This student needs extra encouragement"
        assert data["is_active"] is True
        assert "id" in data
        assert "created_at" in data

    def test_create_instruction_with_reading_type(self, client, teacher, student1, classroom_with_student):
        resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "reading",
                "content": "Please slow down reading pace for this student",
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        assert resp.json()["instruction_type"] == "reading"

    def test_create_instruction_with_comprehension_type(self, client, teacher, student1, classroom_with_student):
        resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "comprehension",
                "content": "Focus on inference questions",
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        assert resp.json()["instruction_type"] == "comprehension"

    def test_create_instruction_with_vocabulary_type(self, client, teacher, student1, classroom_with_student):
        resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "vocabulary",
                "content": "Extra focus on stroke order practice",
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        assert resp.json()["instruction_type"] == "vocabulary"

    def test_teacher_must_own_classroom(self, client, other_teacher, student1, classroom_with_student):
        """other_teacher does not own the classroom -> 403."""
        resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "general",
                "content": "Some instruction",
            },
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_student_must_be_in_classroom(self, client, teacher, student2, classroom_with_student):
        """student2 is not enrolled in the classroom -> 404."""
        resp = client.post(
            f"/api/teacher/students/{student2['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "general",
                "content": "Some instruction",
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404

    def test_invalid_instruction_type(self, client, teacher, student1, classroom_with_student):
        resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "invalid_type",
                "content": "Some instruction",
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_content_max_length_500(self, client, teacher, student1, classroom_with_student):
        """Content exceeding 500 characters should be rejected."""
        long_content = "x" * 501
        resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "general",
                "content": long_content,
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_empty_content_rejected(self, client, teacher, student1, classroom_with_student):
        resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "general",
                "content": "",
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_requires_auth(self, client, student1, classroom_with_student):
        resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "general",
                "content": "Some instruction",
            },
        )
        assert resp.status_code == 401


# ===========================================================================
# GET /api/teacher/students/{student_id}/instructions — List instructions
# ===========================================================================


class TestListInstructions:
    def test_list_active_instructions(self, client, teacher, student1):
        resp = client.get(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        # Should have the instructions created in TestCreateInstruction
        assert len(data) >= 1
        # All returned instructions should be active
        for item in data:
            assert item["is_active"] is True

    def test_other_teacher_cannot_list(self, client, other_teacher, student1):
        resp = client.get(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_requires_auth(self, client, student1):
        resp = client.get(
            f"/api/teacher/students/{student1['user_id']}/instructions",
        )
        assert resp.status_code == 401


# ===========================================================================
# PATCH /api/teacher/instructions/{id} — Update instruction
# ===========================================================================


class TestUpdateInstruction:
    def test_update_content(self, client, teacher, student1, classroom_with_student):
        # Create a fresh instruction
        create_resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "general",
                "content": "Original content",
            },
            headers=auth_header(teacher["token"]),
        )
        assert create_resp.status_code == 201
        instruction_id = create_resp.json()["id"]

        # Update it
        resp = client.patch(
            f"/api/teacher/instructions/{instruction_id}",
            json={"content": "Updated content"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["content"] == "Updated content"

    def test_update_instruction_type(self, client, teacher, student1, classroom_with_student):
        create_resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "general",
                "content": "Type change test",
            },
            headers=auth_header(teacher["token"]),
        )
        instruction_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/teacher/instructions/{instruction_id}",
            json={"instruction_type": "reading"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["instruction_type"] == "reading"

    def test_update_invalid_type_rejected(self, client, teacher, student1, classroom_with_student):
        create_resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "general",
                "content": "Invalid type update test",
            },
            headers=auth_header(teacher["token"]),
        )
        instruction_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/teacher/instructions/{instruction_id}",
            json={"instruction_type": "nonexistent"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_other_teacher_cannot_update(self, client, teacher, other_teacher, student1, classroom_with_student):
        create_resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "general",
                "content": "Auth test",
            },
            headers=auth_header(teacher["token"]),
        )
        instruction_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/teacher/instructions/{instruction_id}",
            json={"content": "Hacked"},
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_update_nonexistent_instruction(self, client, teacher):
        resp = client.patch(
            "/api/teacher/instructions/99999",
            json={"content": "Does not exist"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404

    def test_requires_auth(self, client):
        resp = client.patch(
            "/api/teacher/instructions/1",
            json={"content": "Unauthenticated"},
        )
        assert resp.status_code == 401


# ===========================================================================
# DELETE /api/teacher/instructions/{id} — Soft delete
# ===========================================================================


class TestDeleteInstruction:
    def test_soft_delete(self, client, teacher, student1, classroom_with_student):
        # Create instruction
        create_resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "general",
                "content": "Will be deleted",
            },
            headers=auth_header(teacher["token"]),
        )
        instruction_id = create_resp.json()["id"]

        # Delete it
        resp = client.delete(
            f"/api/teacher/instructions/{instruction_id}",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

    def test_deleted_instructions_not_in_list(self, client, teacher, student1, classroom_with_student):
        # Create a fresh instruction
        create_resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "general",
                "content": "Will be soft deleted and hidden",
            },
            headers=auth_header(teacher["token"]),
        )
        instruction_id = create_resp.json()["id"]

        # Delete it
        client.delete(
            f"/api/teacher/instructions/{instruction_id}",
            headers=auth_header(teacher["token"]),
        )

        # List should not contain the deleted instruction
        resp = client.get(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            headers=auth_header(teacher["token"]),
        )
        data = resp.json()
        ids = [item["id"] for item in data]
        assert instruction_id not in ids

    def test_other_teacher_cannot_delete(self, client, teacher, other_teacher, student1, classroom_with_student):
        create_resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "general",
                "content": "Not yours to delete",
            },
            headers=auth_header(teacher["token"]),
        )
        instruction_id = create_resp.json()["id"]

        resp = client.delete(
            f"/api/teacher/instructions/{instruction_id}",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_delete_nonexistent_instruction(self, client, teacher):
        resp = client.delete(
            "/api/teacher/instructions/99999",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404

    def test_requires_auth(self, client):
        resp = client.delete("/api/teacher/instructions/1")
        assert resp.status_code == 401


# ===========================================================================
# Integration: Socratic Agent receives teacher instructions
# ===========================================================================


class TestSocraticAgentIntegration:
    def test_instructions_included_in_system_prompt(self):
        """Verify teacher instructions are injected into the system prompt."""
        from app.services.socratic_agent import SocraticAgent, SessionState

        agent = SocraticAgent()
        state = SessionState(
            session_id="test-session",
            story_title="Test Story",
            story_text="This is paragraph one.\nThis is paragraph two.",
            teacher_instructions=["Read slowly for this student", "Focus on comprehension questions"],
        )

        prompt = agent._build_system_prompt(state)
        assert "Read slowly for this student" in prompt
        assert "Focus on comprehension questions" in prompt
        assert "please adjust" in prompt.lower() or "adjust" in prompt.lower() or "根據以上指示調整" in prompt

    def test_no_instructions_section_when_none(self):
        """System prompt should not contain teacher instructions section when none given."""
        from app.services.socratic_agent import SocraticAgent, SessionState

        agent = SocraticAgent()
        state = SessionState(
            session_id="test-session-2",
            story_title="Test Story",
            story_text="Content here.",
            teacher_instructions=None,
        )

        prompt = agent._build_system_prompt(state)
        assert "teacher instructions" not in prompt.lower() or "教師特別指示" not in prompt

    def test_empty_instructions_list_no_section(self):
        """System prompt should not contain instructions section for empty list."""
        from app.services.socratic_agent import SocraticAgent, SessionState

        agent = SocraticAgent()
        state = SessionState(
            session_id="test-session-3",
            story_title="Test Story",
            story_text="Content here.",
            teacher_instructions=[],
        )

        prompt = agent._build_system_prompt(state)
        assert "教師特別指示" not in prompt


# ===========================================================================
# GET /api/teacher/classrooms/{classroom_id}/instruction-counts — Bulk counts
# ===========================================================================


class TestBulkInstructionCounts:
    """Tests for the bulk instruction-counts endpoint (fixes N+1 problem, Issue #429)."""

    def test_returns_counts_for_classroom(self, client, teacher, student1, classroom_with_student):
        """Should return a dict with the enrolled student's active instruction count."""
        resp = client.get(
            f"/api/teacher/classrooms/{classroom_with_student}/instruction-counts",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, dict)
        # student1 should be present; counts created by TestCreateInstruction are active
        assert str(student1["user_id"]) in data or student1["user_id"] in data
        student_count = data.get(str(student1["user_id"])) or data.get(student1["user_id"]) or 0
        assert student_count >= 1

    def test_empty_classroom_returns_empty_dict(self, client, teacher, school_id):
        """A classroom with no students should return an empty dict."""
        create_resp = client.post(
            "/api/classrooms",
            json={"name": "Empty Classroom for Count Test", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        assert create_resp.status_code == 201
        empty_classroom_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/teacher/classrooms/{empty_classroom_id}/instruction-counts",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json() == {}

    def test_other_teacher_cannot_access(self, client, other_teacher, classroom_with_student):
        """A teacher who does not own the classroom should get 403."""
        resp = client.get(
            f"/api/teacher/classrooms/{classroom_with_student}/instruction-counts",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_requires_auth(self, client, classroom_with_student):
        """Unauthenticated request should get 401."""
        resp = client.get(
            f"/api/teacher/classrooms/{classroom_with_student}/instruction-counts",
        )
        assert resp.status_code == 401

    def test_deleted_instructions_not_counted(self, client, teacher, student1, classroom_with_student):
        """Soft-deleted instructions (is_active=False) should not be counted."""
        # Create a fresh instruction
        create_resp = client.post(
            f"/api/teacher/students/{student1['user_id']}/instructions",
            json={
                "classroom_id": classroom_with_student,
                "instruction_type": "general",
                "content": "Instruction to be deleted for count test",
            },
            headers=auth_header(teacher["token"]),
        )
        assert create_resp.status_code == 201
        instruction_id = create_resp.json()["id"]

        # Get count before deletion
        before_resp = client.get(
            f"/api/teacher/classrooms/{classroom_with_student}/instruction-counts",
            headers=auth_header(teacher["token"]),
        )
        before_count = (
            before_resp.json().get(str(student1["user_id"]))
            or before_resp.json().get(student1["user_id"])
            or 0
        )

        # Soft-delete the instruction
        del_resp = client.delete(
            f"/api/teacher/instructions/{instruction_id}",
            headers=auth_header(teacher["token"]),
        )
        assert del_resp.status_code == 200

        # Count should decrease by 1
        after_resp = client.get(
            f"/api/teacher/classrooms/{classroom_with_student}/instruction-counts",
            headers=auth_header(teacher["token"]),
        )
        after_count = (
            after_resp.json().get(str(student1["user_id"]))
            or after_resp.json().get(student1["user_id"])
            or 0
        )
        assert after_count == before_count - 1
