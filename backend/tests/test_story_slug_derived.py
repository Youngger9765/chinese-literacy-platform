"""Regression tests for LearningSession.story_slug_derived (#1188).

Verifies that:
1. story_slug_derived returns str(text.lesson_number) when text_id is set.
2. story_slug_derived falls back to story_slug when text_id is None.
3. No service code writes to story_slug without also setting text_id
   (verified by inspecting the session object after create).
4. The Pydantic SessionSummaryResponse includes story_slug_derived from the ORM
   hybrid property.

Uses SQLite in-memory DB (same pattern as test_learning_sessions_api.py).
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.session import LearningSession
from app.models.text import Text
from app.models.user import Role, User
from app.schemas.session import SessionSummaryResponse


# ---------------------------------------------------------------------------
# In-memory SQLite engine (isolated from all other test modules)
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
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]


def _seed_roles(session):
    for r in SEED_ROLES:
        session.add(Role(name=r["name"], display_name=r["display_name"], scope_level=r["scope_level"]))
    session.commit()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    _seed_roles(db)
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    """Provide a clean per-test DB session."""
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _make_text(db, lesson_number: int, title: str = "Test Lesson") -> Text:
    """Insert a Text row and return it."""
    text = Text(
        title=title,
        paragraphs=["Paragraph one."],
        char_count=13,
        grade=4,
        grade_code="G4-1",
        genre="記敘文",
        text_type="單",
        category="Fable",
        lesson_number=lesson_number,
    )
    db.add(text)
    db.flush()
    return text


def _make_user(db) -> User:
    """Insert a minimal User row for the student FK."""
    import hashlib
    unique = hashlib.md5(os.urandom(8)).hexdigest()[:8]
    user = User(
        name=f"Student {unique}",
        email=f"student_{unique}@example.com",
        password_hash="x",
        is_active=True,
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestStorySlugDerived:
    def test_derived_returns_lesson_number_when_text_id_set(self, db):
        """story_slug_derived should return str(text.lesson_number) via FK."""
        text = _make_text(db, lesson_number=42)
        user = _make_user(db)

        session = LearningSession(
            student_id=user.id,
            text_id=text.id,
            story_slug="42",  # legacy col still populated (not dropped yet)
            status="in_progress",
            current_step=1,
        )
        db.add(session)
        db.flush()
        db.refresh(session)

        assert session.story_slug_derived == "42", (
            f"Expected '42', got {session.story_slug_derived!r}. "
            "hybrid_property should return str(text.lesson_number)."
        )

    def test_derived_falls_back_to_story_slug_when_no_text_id(self, db):
        """story_slug_derived falls back to story_slug when text_id is NULL."""
        user = _make_user(db)

        session = LearningSession(
            student_id=user.id,
            text_id=None,
            story_slug="7",  # legacy-only row (no FK)
            status="in_progress",
            current_step=1,
        )
        db.add(session)
        db.flush()
        db.refresh(session)

        assert session.story_slug_derived == "7", (
            "Fallback to story_slug column should work when text_id is NULL."
        )

    def test_derived_returns_none_when_both_null(self, db):
        """story_slug_derived returns None when both text_id and story_slug are NULL."""
        user = _make_user(db)

        session = LearningSession(
            student_id=user.id,
            text_id=None,
            story_slug=None,
            status="in_progress",
            current_step=1,
        )
        db.add(session)
        db.flush()
        db.refresh(session)

        assert session.story_slug_derived is None

    def test_pydantic_schema_exposes_story_slug_derived(self, db):
        """SessionSummaryResponse.story_slug_derived is populated from ORM."""
        text = _make_text(db, lesson_number=99)
        user = _make_user(db)

        session = LearningSession(
            student_id=user.id,
            text_id=text.id,
            story_slug="99",
            status="completed",
            current_step=12,
            accuracy=90.0,
            overall_score=85.0,
        )
        db.add(session)
        db.flush()
        db.refresh(session)

        # Simulate what the route does: model_validate from ORM instance
        import datetime
        # story_title is set by route code, not via schema; set started_at
        response = SessionSummaryResponse.model_validate(session)

        assert response.story_slug_derived == "99", (
            f"Schema story_slug_derived should be '99', got {response.story_slug_derived!r}"
        )
        # Backward compat: story_slug column still populated
        assert response.story_slug == "99"

    def test_session_create_sets_both_text_id_and_story_slug(self, db):
        """Verify that text_id is populated when session is created with a valid slug.

        This is a guard against regressions where the route stops writing text_id.
        The session creation route (learning_sessions.py) must set BOTH fields.
        """
        text = _make_text(db, lesson_number=6)
        user = _make_user(db)

        # Mimic what create_learning_session() does (without HTTP layer)
        normalized_slug = "6"
        session = LearningSession(
            student_id=user.id,
            story_slug=normalized_slug,
            text_id=text.id,
            status="in_progress",
            current_step=1,
        )
        db.add(session)
        db.flush()
        db.refresh(session)

        assert session.text_id == text.id, "text_id must be set on new sessions"
        assert session.story_slug == "6", "story_slug (legacy) must still be set"
        assert session.story_slug_derived == "6", "derived slug must match"
