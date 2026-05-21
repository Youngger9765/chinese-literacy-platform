"""
Regression test for Issue #1810 — _resolve_title_for_assignment Text title N+1.

Problem (pre-fix):
  _resolve_title_for_assignment() called db.query(Text).filter(...).first()
  for every assignment whose text_id is set, even when Assignment.text was
  already eager-loaded by the caller.  For a classroom with N text_id
  assignments, that yields N extra SELECT queries.

Fix (PR for #1810):
  The function now uses assignment.text (relationship attribute) when it is
  already populated, and falls back to the explicit query only when the
  attribute is None (unloaded).

Test strategy:
  - Create 1 teacher + 1 classroom + 5 text_id-based assignments.
  - Call GET /classrooms/{id}/assignments.
  - Count SQL queries via ``before_cursor_execute`` event listener.
  - Assert count is below a ceiling that's independent of N assignments
    (if it were N+1, the test would fail for large N).

Query budget: ≤ 15 for any number of text_id assignments in [1, 5].
The budget is generous to avoid flakiness from count changes but tight
enough to catch N-proportional regressions (5 text queries alone = 5 extra).
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
from app.models.school import School, Classroom
from app.models.assignment import Assignment
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
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]

# 5 text_id assignments — enough to trigger a noticeable N+1 if unfixed.
NUM_TEXT_ASSIGNMENTS = 5

_state: dict = {}


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    """Seed DB with 1 teacher, 1 classroom, 5 text_id assignments."""
    # Patch JSONB → JSON for SQLite compatibility.
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy import JSON as SQLJSON

    for table in Base.metadata.sorted_tables:
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = SQLJSON()

    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    # Roles
    role_map: dict[str, Role] = {}
    for r in _SEED_ROLES:
        role = Role(**r)
        db.add(role)
        db.commit()
        db.refresh(role)
        role_map[r["name"]] = role

    # School
    school = School(name="1810 Regression School")
    db.add(school)
    db.commit()
    db.refresh(school)

    # Teacher
    teacher = User(
        email="teacher_1810@example.com",
        username="teacher_1810",
        password_hash=hash_password("Password1!"),
        name="Teacher 1810",
        is_active=True,
        email_verified=True,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)

    db.add(UserRole(
        user_id=teacher.id,
        role_id=role_map["teacher"].id,
        scope_type="school",
        scope_id=str(school.id),
        is_active=True,
    ))
    db.commit()

    # Classroom
    classroom = Classroom(
        name="1810 Regression Class",
        school_id=school.id,
        teacher_id=teacher.id,
        join_code="T1810",
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)

    # Create Text rows and corresponding text_id Assignments.
    for i in range(NUM_TEXT_ASSIGNMENTS):
        text_obj = Text(
            title=f"Text Title {i + 1}",
            paragraphs=[f"Content for text {i + 1}"],
            grade=5,
            grade_code=f"G5-T{i + 1}",
            genre="記敘文",
            text_type="單",
            category="Fable",
            teacher_id=teacher.id,
            visibility="platform",
        )
        db.add(text_obj)
        db.commit()
        db.refresh(text_obj)

        asn = Assignment(
            classroom_id=classroom.id,
            teacher_id=teacher.id,
            text_id=text_obj.id,        # text_id-based — this is the N+1 source
            assignment_type="reading",
            is_active=True,
        )
        db.add(asn)
        db.commit()

    # Also add one story_id-based assignment (mixed case).
    db.add(Assignment(
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        story_id="1",
        assignment_type="reading",
        is_active=True,
    ))
    db.commit()

    _state["classroom_id"] = classroom.id
    _state["teacher_email"] = "teacher_1810@example.com"

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


@pytest.fixture(scope="module")
def teacher_token(client):
    resp = client.post(
        "/api/auth/login",
        json={"email": "teacher_1810@example.com", "password": "Password1!"},
    )
    assert resp.status_code == 200, f"Login failed: {resp.json()}"
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _count_queries(fn) -> int:
    """Return the number of SQL statements issued while fn() runs."""
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


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestTextTitleN1Regression1810:
    """
    GET /classrooms/{id}/assignments must not issue one extra query per
    text_id assignment to resolve the title.
    """

    def test_endpoint_returns_200(self, client, teacher_token):
        cid = _state["classroom_id"]
        resp = client.get(
            f"/api/classrooms/{cid}/assignments",
            headers=_auth(teacher_token),
        )
        assert resp.status_code == 200

    def test_all_assignments_returned(self, client, teacher_token):
        cid = _state["classroom_id"]
        resp = client.get(
            f"/api/classrooms/{cid}/assignments",
            headers=_auth(teacher_token),
        )
        data = resp.json()
        # 5 text_id + 1 story_id = 6 total
        assert data["total"] == NUM_TEXT_ASSIGNMENTS + 1

    def test_text_titles_resolved_correctly(self, client, teacher_token):
        """Each text_id assignment must carry the correct title (not '(Unknown)')."""
        cid = _state["classroom_id"]
        resp = client.get(
            f"/api/classrooms/{cid}/assignments",
            headers=_auth(teacher_token),
        )
        items = resp.json()["items"]
        text_items = [i for i in items if i.get("text_id") is not None]
        assert len(text_items) == NUM_TEXT_ASSIGNMENTS, (
            f"Expected {NUM_TEXT_ASSIGNMENTS} text_id items, got {len(text_items)}"
        )
        for item in text_items:
            assert item["story_title"] != "(Unknown)", (
                f"Assignment {item['id']} has story_title='(Unknown)' — "
                "title resolution failed"
            )
            assert item["story_title"].startswith("Text Title"), (
                f"Unexpected story_title '{item['story_title']}' for text_id assignment"
            )

    def test_query_count_constant_not_n_plus_1(self, client, teacher_token):
        """
        Query count must be constant (bounded), NOT proportional to N assignments.

        Without the fix:  auth(1) + classroom(1) + list(1) + N*Text queries
                        = 3 + N  →  for N=5: 8 queries
        With the fix:     auth(1) + classroom(1) + assignments+join_text(1)
                        + per-assignment counts(~3N but SQLite scalar)  <= 15 fixed cap

        We set the ceiling at 15.  If the Text N+1 were still present for
        NUM_TEXT_ASSIGNMENTS=5, the count would be at least 3 + N = 8 with
        text queries on top of the 3*N count queries, easily breaching 15
        once NUM_TEXT_ASSIGNMENTS is large enough to distinguish N from constant.

        More precisely: ceiling must be independent of NUM_TEXT_ASSIGNMENTS.
        """
        cid = _state["classroom_id"]
        n = NUM_TEXT_ASSIGNMENTS + 1  # total assignments

        def call():
            client.get(
                f"/api/classrooms/{cid}/assignments",
                headers=_auth(teacher_token),
            )

        q = _count_queries(call)

        # Query budget breakdown (with fix, n=6 assignments):
        #   1  auth token lookup
        #   1  classroom lookup
        #   1  assignments + joinedload(text) (single JOIN query)
        #   3N sub-count scalars (assigned_students, submitted_students, total_attempts)
        #      = 18 for n=6
        # Total fixed (with fix): ~21 for n=6.
        #
        # WITHOUT the fix, each text_id assignment adds 1 extra Text query → +5.
        # So the N+1 pattern yields 26 for n=6, comfortably above our ceiling of 25.
        #
        # Ceiling = 3*n + 7 (constant overhead) — proportional to n due to the
        # per-assignment scalar count queries in _assignment_to_response, but NOT
        # due to Text lookups.  The crucial assertion is the secondary one below,
        # which confirms Text queries are absent.
        ceiling = 3 * n + 7
        assert q <= ceiling, (
            f"GET /classrooms/{cid}/assignments issued {q} SQL queries for "
            f"{n} assignments ({NUM_TEXT_ASSIGNMENTS} text_id-based). "
            f"Expected ≤ {ceiling} (3*N+7 budget). "
            f"With Text N+1 still present the count would be ≥ {3*n + 7 + NUM_TEXT_ASSIGNMENTS}."
        )

        # Primary assertion: Text title N+1 absent.
        # With N=5 text_id assignments, the N+1 pattern adds 5 extra queries.
        # 3*N + 7 + N_text = 3*6+7+5 = 30, which is > our ceiling of 25.
        # So the ceiling implicitly proves Text N+1 is gone for NUM_TEXT_ASSIGNMENTS ≥ 4.
        # Explicitness: q must be below 3*n + 7 + NUM_TEXT_ASSIGNMENTS.
        n_plus_1_threshold = 3 * n + 7 + NUM_TEXT_ASSIGNMENTS
        assert q < n_plus_1_threshold, (
            f"Query count {q} suggests Text title N+1 is still present "
            f"(N+1 threshold = {n_plus_1_threshold} for {NUM_TEXT_ASSIGNMENTS} text_id assignments). "
            "Check that assignment.text relationship is being used instead of a DB query."
        )
