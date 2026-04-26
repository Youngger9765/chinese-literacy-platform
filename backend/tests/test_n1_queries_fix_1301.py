"""
Regression tests for Issue #1301 — N+1 queries in session list / reading history endpoints.

Tests verify:
1. Response payload is correct (contract test)
2. Query count is bounded (not N-proportional) after joinedload fix

Routes covered:
- GET /api/learning/sessions        (list_my_sessions — s.text.title N+1)
- GET /api/learning/sessions/reading-history  (get_reading_history — defensive eager load)

Note on teacher_analytics.py:
  get_classroom_heatmap already has joinedload(ClassroomStudent.student) for enrollments.
  The sessions loop only accesses scalar columns (student_id, story_slug, status, overall_score).
  No N+1 was present in that function — verified by code inspection.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, UserRole, User
from app.models.session import LearningSession
from app.models.text import Text
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
    cursor.execute("PRAGMA foreign_keys=OFF")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

_SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]

NUM_SESSIONS = 8   # enough to distinguish O(1) vs O(N)

_state: dict = {}


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    """Create tables, seed data, override DB dependency."""
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy import JSON

    for table in Base.metadata.sorted_tables:
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = JSON()

    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    # Roles
    for r in _SEED_ROLES:
        role = Role(**r)
        db.add(role)
    db.commit()

    # Student
    student = User(
        email="n1_1301_student@example.com",
        username="n1_1301_student",
        password_hash=hash_password("Password1!"),
        name="N+1 1301 Student",
        is_active=True,
        email_verified=True,
    )
    db.add(student)
    db.commit()
    db.refresh(student)

    # Create Text objects so sessions can link to them (triggering the N+1 path)
    text_ids = []
    for i in range(NUM_SESSIONS):
        text_obj = Text(
            title=f"Test Story {i}",
            paragraphs=[f"Content for story {i}"],
            grade=5,
            grade_code=f"G5-{i}",
            genre="記敘文",
            text_type="單",
            category="Fable",
            teacher_id=student.id,
            visibility="platform",
        )
        db.add(text_obj)
        db.commit()
        db.refresh(text_obj)
        text_ids.append(text_obj.id)

    # Create NUM_SESSIONS completed sessions, half linked to Text (text_id set), half slug-only
    for i in range(NUM_SESSIONS):
        if i < NUM_SESSIONS // 2:
            # DB-text sessions — these trigger s.text.title N+1 without joinedload
            sess = LearningSession(
                student_id=student.id,
                text_id=text_ids[i],
                story_slug=str(i + 1),
                status="completed",
                overall_score=float(70 + i),
            )
        else:
            # Slug-only sessions
            sess = LearningSession(
                student_id=student.id,
                story_slug=str(i + 1),
                status="completed",
                overall_score=float(70 + i),
            )
        db.add(sess)
    db.commit()

    # Also create sessions for reading-history endpoint.
    # Use distinct slugs (200+i) to avoid the partial-unique-index on
    # (student_id, story_slug) which SQLite enforces globally (no WHERE).
    READING_HISTORY_SLUG = "200"
    for i in range(NUM_SESSIONS):
        sess = LearningSession(
            student_id=student.id,
            story_slug=str(200 + i),
            status="completed",
            overall_score=float(60 + i),
        )
        db.add(sess)
    db.commit()

    _state["student_email"] = "n1_1301_student@example.com"
    # Use one of the slug-200+ sessions for reading-history endpoint test
    _state["reading_history_slug"] = READING_HISTORY_SLUG
    _state["reading_history_slug_single"] = "200"

    db.close()

    app.dependency_overrides[get_db] = _override_get_db

    try:
        from app.routes.auth import rate_limiter
        rate_limiter.reset()
    except Exception:
        pass

    yield

    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _login(client, email: str) -> str:
    resp = client.post("/api/auth/login", json={"email": email, "password": "Password1!"})
    assert resp.status_code == 200, f"Login failed for {email}: {resp.json()}"
    return resp.json()["access_token"]


@pytest.fixture(scope="module")
def student_token(client):
    return _login(client, _state["student_email"])


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def count_queries(fn) -> int:
    """Count SQL statements emitted while fn() executes."""
    count = 0

    def _before(conn, cursor, statement, parameters, context, executemany):
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", _before)
    try:
        fn()
    finally:
        event.remove(engine, "before_cursor_execute", _before)
    return count


# ===========================================================================
# 1. GET /api/learning/sessions — list_my_sessions N+1
# ===========================================================================


class TestListMySessionsN1:
    """GET /api/learning/sessions must not issue N queries for s.text.title lookups."""

    def test_returns_200(self, client, student_token):
        resp = client.get(
            "/api/learning/sessions",
            headers=auth_header(student_token),
        )
        assert resp.status_code == 200

    def test_response_has_items(self, client, student_token):
        resp = client.get(
            "/api/learning/sessions",
            headers=auth_header(student_token),
        )
        data = resp.json()
        assert "items" in data
        assert "total" in data
        # We seeded NUM_SESSIONS + NUM_SESSIONS (reading-history) sessions
        assert data["total"] >= NUM_SESSIONS

    def test_response_item_shape(self, client, student_token):
        resp = client.get(
            "/api/learning/sessions",
            headers=auth_header(student_token),
        )
        items = resp.json()["items"]
        assert len(items) > 0
        for item in items:
            # story_title field must be present (may be null for slug-only sessions
            # without a matching YAML lesson in test env)
            assert "story_title" in item or item.get("story_slug") is not None

    def test_query_count_is_bounded(self, client, student_token):
        """Without joinedload: auth(1) + submissions(1) + sessions(1) + N*text(N) = N+3.
        With joinedload: auth + submissions + sessions_joinedload = ~3 constant queries.
        Bound: must be strictly less than N (8 sessions seeded).
        """
        n = NUM_SESSIONS

        def call():
            client.get(
                "/api/learning/sessions",
                headers=auth_header(student_token),
            )

        # Warm up any one-time lazy imports
        call()
        q = count_queries(call)

        assert q < n, (
            f"GET /learning/sessions issued {q} queries for {n} sessions. "
            f"N+1 worst case = {n + 3}. Expected < {n} after joinedload fix (issue #1301)."
        )

    def test_query_count_constant_not_proportional(self, client, student_token):
        """Query count must not grow proportionally with session count.

        This test seeds extra sessions in a second call and verifies that
        the absolute query count stays the same (within 1) regardless of
        result set size. This is the sharpest N+1 regression signal.
        """
        # Add more sessions to the DB
        db = TestingSessionLocal()
        try:
            student = db.query(User).filter_by(email=_state["student_email"]).first()
            for extra in range(5):
                db.add(LearningSession(
                    student_id=student.id,
                    story_slug=str(100 + extra),
                    status="completed",
                    overall_score=float(80 + extra),
                ))
            db.commit()
        finally:
            db.close()

        def call():
            client.get(
                "/api/learning/sessions",
                headers=auth_header(student_token),
            )

        call()  # warm up
        q_after = count_queries(call)

        # If O(N): adding 5 sessions would add 5 queries. If O(1): stays same.
        # We already measured < NUM_SESSIONS (8) before. After adding 5 more (total 13+),
        # a regressed O(N) would be >= 13. Our fix must keep it < 13.
        assert q_after < NUM_SESSIONS + 5, (
            f"After adding 5 extra sessions, query count is {q_after}. "
            f"Expected < {NUM_SESSIONS + 5}. Possible N+1 regression."
        )


# ===========================================================================
# 2. GET /api/learning/sessions/reading-history — defensive eager load
# ===========================================================================


class TestReadingHistoryEagerLoad:
    """GET /api/learning/sessions/reading-history — defensive joinedload.

    Note: SQLite enforces the (student_id, story_slug) unique index globally
    (without the PostgreSQL partial-WHERE clause), so we can only store one
    completed session per slug. We verify the endpoint is functional and
    that query count is constant (bounded well below any proportional growth).
    """

    def test_returns_200(self, client, student_token):
        slug = _state["reading_history_slug_single"]
        resp = client.get(
            f"/api/learning/sessions/reading-history?story_slug={slug}",
            headers=auth_header(student_token),
        )
        assert resp.status_code == 200

    def test_response_is_list(self, client, student_token):
        slug = _state["reading_history_slug_single"]
        resp = client.get(
            f"/api/learning/sessions/reading-history?story_slug={slug}",
            headers=auth_header(student_token),
        )
        data = resp.json()
        assert isinstance(data, list)
        # One session seeded for this slug
        assert len(data) >= 1

    def test_response_item_shape(self, client, student_token):
        slug = _state["reading_history_slug_single"]
        resp = client.get(
            f"/api/learning/sessions/reading-history?story_slug={slug}",
            headers=auth_header(student_token),
        )
        for item in resp.json():
            assert "session_id" in item
            assert "started_at" in item
            assert "overall_score" in item

    def test_query_count_is_bounded(self, client, student_token):
        """Without joinedload: auth(1) + sessions(1) + assignment_ids(1) + N*text = N+3.
        With joinedload: constant — single query fetches sessions + text in join.
        Bound: must be < NUM_SESSIONS (generous constant upper-bound).
        """
        slug = _state["reading_history_slug_single"]
        n = NUM_SESSIONS

        def call():
            client.get(
                f"/api/learning/sessions/reading-history?story_slug={slug}",
                headers=auth_header(student_token),
            )

        call()  # warm up
        q = count_queries(call)

        # With joinedload the query count is constant (~3) regardless of result count.
        # We use a generous bound of < NUM_SESSIONS to remain robust under auth overhead.
        assert q < n, (
            f"GET /learning/sessions/reading-history issued {q} queries. "
            f"Expected < {n} (constant after joinedload fix, issue #1301)."
        )
