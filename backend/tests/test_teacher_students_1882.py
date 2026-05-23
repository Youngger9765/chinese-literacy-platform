"""
TDD tests for #1882 — teacher_students.py split.

Three characterization tests that must pass BEFORE the refactor,
and must continue to pass AFTER the split (regression guard).

Run with:
    cd backend && python -m pytest tests/test_teacher_students_1882.py -v
"""

import sys
import os
import uuid
from datetime import datetime, timezone

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
from app.models.school import School, Classroom, ClassroomStudent
from app.models.session import LearningSession


# ---------------------------------------------------------------------------
# Extended conftest patch: fix str-based server_defaults with ::jsonb
# (conftest only handles text()-based, not raw string defaults)
# ---------------------------------------------------------------------------

def _patch_str_server_defaults():
    """Patch server_defaults that are plain strings containing '::' (SQLite can't parse them)."""
    from sqlalchemy.sql.schema import DefaultClause
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            sd = column.server_default
            if sd is None:
                continue
            arg = getattr(sd, "arg", None)
            if isinstance(arg, str) and "::" in arg:
                column.server_default = None


_patch_str_server_defaults()


# ---------------------------------------------------------------------------
# Shared DB setup
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
    school = School(name="1882 Test School")
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


_test_school_id: int = 0


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
    try:
        from app.auth.rate_limiter import general_rate_limiter
        general_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass

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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_and_login(client, prefix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{prefix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{prefix.title()} {unique}"
    resp = client.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    assert resp.status_code == 201
    token_resp = resp.json().get("verification_token")
    if token_resp:
        client.get(f"/api/auth/verify-email?token={token_resp}")
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login.json()["access_token"]
    me = client.get("/api/users/me", headers=auth_header(token))
    user_id = me.json()["id"]
    return {"email": email, "token": token, "user_id": user_id}


def _create_classroom(client, teacher_token: str, school_id: int, name: str) -> int:
    resp = client.post(
        "/api/classrooms",
        json={"name": name, "school_id": school_id},
        headers=auth_header(teacher_token),
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def _enroll_student(client, teacher_token: str, classroom_id: int, student_id: int):
    resp = client.post(
        f"/api/classrooms/{classroom_id}/students",
        json={"student_id": student_id},
        headers=auth_header(teacher_token),
    )
    assert resp.status_code in (200, 201)


def _seed_session_with_scores(student_id: int, story_slug: str, fr, rr,
                               overall_score: float = 80.0):
    """Directly insert a completed LearningSession with reading metrics.

    Pass None for fr/rr to leave the column NULL (SQLite-safe).
    Non-empty dicts are passed through; empty dicts become None.
    """
    db = TestingSessionLocal()
    session = LearningSession(
        student_id=student_id,
        story_slug=story_slug,
        status="completed",
        overall_score=overall_score,
        started_at=datetime.now(timezone.utc),
        full_reading_result=fr if fr else None,
        reading_result=rr if rr else None,
        # full_reading_attempts is nullable=False; set to [] explicitly
        full_reading_attempts=[],
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    session_id = session.id
    db.close()
    return session_id


# ===========================================================================
# Test 1: teacher_visibility_required_for_every_student_route
#
# An unauthorized teacher (not enrolled this student) must get 403 on ALL
# sub-routes that touch student-specific data.
# ===========================================================================


class TestTeacherVisibilityRequiredForEveryStudentRoute:
    """Unauthorized teacher should get 403 across sessions/tags/reports sub-routes."""

    @pytest.fixture(scope="class")
    def teacher_a(self, client):
        return _register_and_login(client, "vis_teacher_a")

    @pytest.fixture(scope="class")
    def teacher_b(self, client):
        """teacher_b owns no classroom with our student."""
        return _register_and_login(client, "vis_teacher_b")

    @pytest.fixture(scope="class")
    def student(self, client, teacher_a, school_id):
        s = _register_and_login(client, "vis_student")
        cls_id = _create_classroom(client, teacher_a["token"], school_id, "Vis Class A")
        _enroll_student(client, teacher_a["token"], cls_id, s["user_id"])
        return s

    @pytest.fixture(scope="class")
    def session_id(self, student):
        # Use None for JSONB fields so SQLite doesn't error on empty dict
        return _seed_session_with_scores(student["user_id"], "1", None, None)

    def test_sessions_list_returns_403_for_unauthorized_teacher(
        self, client, teacher_b, student
    ):
        resp = client.get(
            f"/api/teacher/students/{student['user_id']}/sessions",
            headers=auth_header(teacher_b["token"]),
        )
        assert resp.status_code == 403, (
            f"Expected 403 on /sessions for unauthorized teacher, got {resp.status_code}"
        )

    def test_tags_list_returns_403_for_unauthorized_teacher(
        self, client, teacher_b, student
    ):
        resp = client.get(
            f"/api/teacher/students/{student['user_id']}/tags",
            headers=auth_header(teacher_b["token"]),
        )
        assert resp.status_code == 403, (
            f"Expected 403 on /tags for unauthorized teacher, got {resp.status_code}"
        )

    def test_tags_add_returns_403_for_unauthorized_teacher(
        self, client, teacher_b, student
    ):
        resp = client.post(
            f"/api/teacher/students/{student['user_id']}/tags",
            json={"tag_name": "hacked"},
            headers=auth_header(teacher_b["token"]),
        )
        assert resp.status_code == 403, (
            f"Expected 403 on POST /tags for unauthorized teacher, got {resp.status_code}"
        )

    def test_learning_curve_returns_403_for_unauthorized_teacher(
        self, client, teacher_b, student
    ):
        resp = client.get(
            f"/api/teacher/students/{student['user_id']}/learning-curve",
            headers=auth_header(teacher_b["token"]),
        )
        assert resp.status_code == 403, (
            f"Expected 403 on /learning-curve for unauthorized teacher, got {resp.status_code}"
        )

    def test_session_report_returns_403_for_unauthorized_teacher(
        self, client, teacher_b, student, session_id
    ):
        resp = client.get(
            f"/api/teacher/students/{student['user_id']}/sessions/{session_id}/report",
            headers=auth_header(teacher_b["token"]),
        )
        assert resp.status_code == 403, (
            f"Expected 403 on /report for unauthorized teacher, got {resp.status_code}"
        )

    def test_session_comment_returns_403_for_unauthorized_teacher(
        self, client, teacher_b, student, session_id
    ):
        resp = client.post(
            f"/api/teacher/students/{student['user_id']}/sessions/{session_id}/comment",
            json={"comment": "unauthorized"},
            headers=auth_header(teacher_b["token"]),
        )
        assert resp.status_code == 403, (
            f"Expected 403 on POST /comment for unauthorized teacher, got {resp.status_code}"
        )

    def test_authorized_teacher_can_still_access_sessions(
        self, client, teacher_a, student
    ):
        resp = client.get(
            f"/api/teacher/students/{student['user_id']}/sessions",
            headers=auth_header(teacher_a["token"]),
        )
        assert resp.status_code == 200


# ===========================================================================
# Test 2: learning_curve_prefers_full_reading_metrics_then_reading_result
#
# CPM and accuracy fallback logic:
#   full_reading_result.cpm  →  preferred (if present)
#   reading_result.cpm       →  fallback (if fr.cpm absent)
#   accuracy: fr.match_rate * 100  →  preferred
#             fr.accuracy          →  secondary
#             rr.accuracy          →  fallback
# ===========================================================================


class TestLearningCurveFallbackOrder:
    """CPM and accuracy must use full_reading_result first, then reading_result."""

    @pytest.fixture(scope="class")
    def teacher(self, client, school_id):
        t = _register_and_login(client, "lc_teacher")
        cls_id = _create_classroom(client, t["token"], school_id, "LC Class")
        t["classroom_id"] = cls_id
        return t

    @pytest.fixture(scope="class")
    def student(self, client, teacher):
        s = _register_and_login(client, "lc_student")
        _enroll_student(client, teacher["token"], teacher["classroom_id"], s["user_id"])
        return s

    def test_cpm_comes_from_full_reading_result_when_present(
        self, client, teacher, student
    ):
        """full_reading_result.cpm=120 should appear; reading_result.cpm=60 ignored."""
        _seed_session_with_scores(
            student["user_id"],
            story_slug="1",
            fr={"cpm": 120, "match_rate": 0.95},
            rr={"cpm": 60, "accuracy": 0.80},
            overall_score=85.0,
        )
        resp = client.get(
            f"/api/teacher/students/{student['user_id']}/learning-curve",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert len(data) >= 1
        pt = data[-1]
        assert pt["cpm"] == 120.0, f"Expected CPM=120 from full_reading_result, got {pt['cpm']}"

    def test_cpm_falls_back_to_reading_result_when_fr_missing(
        self, client, teacher, student
    ):
        """When full_reading_result has no cpm, use reading_result.cpm."""
        _seed_session_with_scores(
            student["user_id"],
            story_slug="2",
            fr={"match_rate": 0.90},          # no cpm key
            rr={"cpm": 75, "accuracy": 0.75},
            overall_score=78.0,
        )
        resp = client.get(
            f"/api/teacher/students/{student['user_id']}/learning-curve",
            params={"story_slug": "2"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert len(data) >= 1
        pt = data[0]
        assert pt["cpm"] == 75.0, f"Expected CPM=75 fallback from reading_result, got {pt['cpm']}"

    def test_accuracy_uses_match_rate_when_present(
        self, client, teacher, student
    ):
        """full_reading_result.match_rate*100 should be accuracy."""
        _seed_session_with_scores(
            student["user_id"],
            story_slug="3",
            fr={"cpm": 100, "match_rate": 0.88},
            rr={"cpm": 50, "accuracy": 0.50},
            overall_score=82.0,
        )
        resp = client.get(
            f"/api/teacher/students/{student['user_id']}/learning-curve",
            params={"story_slug": "3"},
            headers=auth_header(teacher["token"]),
        )
        data = resp.json()["data"]
        pt = data[0]
        assert pt["accuracy"] == pytest.approx(88.0, abs=0.1), (
            f"Expected accuracy=88.0 from match_rate*100, got {pt['accuracy']}"
        )

    def test_accuracy_falls_back_to_fr_accuracy_then_rr_accuracy(
        self, client, teacher, student
    ):
        """When fr has no match_rate, use fr.accuracy; fallback to rr.accuracy."""
        # Case A: fr.accuracy present
        _seed_session_with_scores(
            student["user_id"],
            story_slug="4",
            fr={"cpm": 90, "accuracy": 92.0},    # no match_rate
            rr={"cpm": 50, "accuracy": 40.0},
            overall_score=79.0,
        )
        resp = client.get(
            f"/api/teacher/students/{student['user_id']}/learning-curve",
            params={"story_slug": "4"},
            headers=auth_header(teacher["token"]),
        )
        data = resp.json()["data"]
        pt = data[0]
        assert pt["accuracy"] == pytest.approx(92.0, abs=0.1), (
            f"Expected accuracy=92.0 from fr.accuracy, got {pt['accuracy']}"
        )

        # Case B: only rr.accuracy
        _seed_session_with_scores(
            student["user_id"],
            story_slug="5",
            fr={"cpm": 80},                      # no match_rate, no accuracy
            rr={"cpm": 50, "accuracy": 55.0},
            overall_score=72.0,
        )
        resp2 = client.get(
            f"/api/teacher/students/{student['user_id']}/learning-curve",
            params={"story_slug": "5"},
            headers=auth_header(teacher["token"]),
        )
        data2 = resp2.json()["data"]
        pt2 = data2[0]
        assert pt2["accuracy"] == pytest.approx(55.0, abs=0.1), (
            f"Expected accuracy=55.0 from rr.accuracy fallback, got {pt2['accuracy']}"
        )


# ===========================================================================
# Test 3: generate_ai_comment_returns_cached_comment_without_new_ai_call
#
# If session.ai_comment is already set, the endpoint must return the cached
# value immediately without calling generate_teacher_comment().
# ===========================================================================


class TestAiCommentCacheBehavior:
    """ai_comment field is returned directly when cached; no new AI call."""

    @pytest.fixture(scope="class")
    def teacher(self, client, school_id):
        t = _register_and_login(client, "ai_cache_teacher")
        cls_id = _create_classroom(client, t["token"], school_id, "AI Cache Class")
        t["classroom_id"] = cls_id
        return t

    @pytest.fixture(scope="class")
    def student(self, client, teacher):
        s = _register_and_login(client, "ai_cache_student")
        _enroll_student(client, teacher["token"], teacher["classroom_id"], s["user_id"])
        return s

    def _seed_session_with_ai_comment(self, student_id: int, ai_comment: str) -> int:
        """Insert session that already has ai_comment set."""
        db = TestingSessionLocal()
        session = LearningSession(
            student_id=student_id,
            story_slug="1",
            status="completed",
            overall_score=80.0,
            started_at=datetime.now(timezone.utc),
            ai_comment=ai_comment,
            full_reading_attempts=[],
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        session_id = session.id
        db.close()
        return session_id

    def test_returns_cached_ai_comment_without_calling_ai(
        self, client, teacher, student, monkeypatch
    ):
        """Endpoint must return cached ai_comment; ai service must NOT be called."""
        cached_comment = "Pre-cached AI comment for testing"
        session_id = self._seed_session_with_ai_comment(
            student["user_id"], cached_comment
        )

        call_count = {"n": 0}

        async def _fake_generate(*args, **kwargs):
            call_count["n"] += 1
            return "Should not be called"

        monkeypatch.setattr(
            "app.services.ai_generation.generate_teacher_comment",
            _fake_generate,
        )

        resp = client.post(
            f"/api/teacher/students/{student['user_id']}/sessions/{session_id}/generate-ai-comment",
            headers=auth_header(teacher["token"]),
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["ai_comment"] == cached_comment, (
            f"Expected cached comment, got: {body['ai_comment']!r}"
        )
        assert call_count["n"] == 0, (
            f"AI service was called {call_count['n']} times despite cached comment existing"
        )

    def test_calls_ai_service_when_no_cached_comment(
        self, client, teacher, student, monkeypatch
    ):
        """When ai_comment is None, the AI service MUST be invoked."""
        # Session with no ai_comment — use different slug to avoid UNIQUE constraint
        db = TestingSessionLocal()
        session = LearningSession(
            student_id=student["user_id"],
            story_slug="99",
            status="completed",
            overall_score=75.0,
            started_at=datetime.now(timezone.utc),
            ai_comment=None,
            full_reading_attempts=[],
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        session_id = session.id
        db.close()

        call_count = {"n": 0}

        async def _fake_generate(*args, **kwargs):
            call_count["n"] += 1
            return "AI generated comment"

        monkeypatch.setattr(
            "app.services.ai_generation.generate_teacher_comment",
            _fake_generate,
        )

        resp = client.post(
            f"/api/teacher/students/{student['user_id']}/sessions/{session_id}/generate-ai-comment",
            headers=auth_header(teacher["token"]),
        )

        assert resp.status_code == 200
        assert call_count["n"] == 1, (
            f"Expected exactly 1 AI call, got {call_count['n']}"
        )
        body = resp.json()
        assert body["ai_comment"] == "AI generated comment"
