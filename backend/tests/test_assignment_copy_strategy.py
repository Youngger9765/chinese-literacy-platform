"""
TDD tests for the assignment copy strategy (副本策略).

Tests cover:
- needs_fork(): which visibility levels require a fork
- fork_text_for_assignment(): correct fork content and provenance
- resolve_text_for_assignment(): integration — mutable texts are forked,
  stable texts are returned as-is
- API create_assignment with text_id: fork is created for mutable texts;
  no fork for platform-visible DB texts
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime
from unittest.mock import MagicMock, patch
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.text import Text, VisibilityLevel, TextStatus
from app.services.assignment_copy_strategy import (
    needs_fork,
    fork_text_for_assignment,
    resolve_text_for_assignment,
)


# ---------------------------------------------------------------------------
# In-memory SQLite test database
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_pragma(dbapi_conn, _):
    # Foreign keys are disabled so tests can insert texts without needing
    # classrooms/schools/users tables to be populated.
    dbapi_conn.execute("PRAGMA foreign_keys=OFF")


TestingSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture()
def db():
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()


def _make_text(
    db,
    visibility: VisibilityLevel = VisibilityLevel.platform,
    title: str = "測試課文",
    grade: int = 5,
) -> Text:
    text = Text(
        title=title,
        paragraphs=["第一段", "第二段"],
        full_text="第一段第二段",
        char_count=6,
        grade=grade,
        grade_code=f"G{grade}-1",
        genre="記敘文",
        text_type="單",
        category="課文",
        visibility=visibility,
        status=TextStatus.published,
    )
    db.add(text)
    db.commit()
    db.refresh(text)
    return text


# ---------------------------------------------------------------------------
# Tests for needs_fork()
# ---------------------------------------------------------------------------


class TestNeedsFork:
    def test_platform_visibility_does_not_need_fork(self):
        text = MagicMock(visibility=VisibilityLevel.platform)
        assert needs_fork(text) is False

    def test_organization_visibility_needs_fork(self):
        text = MagicMock(visibility=VisibilityLevel.organization)
        assert needs_fork(text) is True

    def test_school_visibility_needs_fork(self):
        text = MagicMock(visibility=VisibilityLevel.school)
        assert needs_fork(text) is True

    def test_class_visibility_needs_fork(self):
        text = MagicMock(visibility=VisibilityLevel.class_)
        assert needs_fork(text) is True

    def test_private_visibility_needs_fork(self):
        text = MagicMock(visibility=VisibilityLevel.private)
        assert needs_fork(text) is True


# ---------------------------------------------------------------------------
# Tests for fork_text_for_assignment()
# ---------------------------------------------------------------------------


class TestForkText:
    def test_fork_copies_content_fields(self, db):
        original = _make_text(db, visibility=VisibilityLevel.school)

        fork = fork_text_for_assignment(
            text=original,
            teacher_id=99,
            classroom_id=42,
            db=db,
        )
        db.commit()
        db.refresh(fork)

        assert fork.title == original.title
        assert fork.paragraphs == original.paragraphs
        assert fork.full_text == original.full_text
        assert fork.char_count == original.char_count
        assert fork.grade == original.grade
        assert fork.genre == original.genre

    def test_fork_sets_provenance(self, db):
        original = _make_text(db, visibility=VisibilityLevel.school)

        fork = fork_text_for_assignment(
            text=original,
            teacher_id=99,
            classroom_id=42,
            db=db,
        )
        db.commit()
        db.refresh(fork)

        assert fork.forked_from_id == original.id

    def test_fork_scoped_to_classroom(self, db):
        original = _make_text(db, visibility=VisibilityLevel.school)

        fork = fork_text_for_assignment(
            text=original,
            teacher_id=99,
            classroom_id=42,
            db=db,
        )
        db.commit()
        db.refresh(fork)

        assert fork.visibility == VisibilityLevel.class_
        assert fork.class_id == 42
        assert fork.teacher_id == 99
        assert fork.created_by_id == 99

    def test_fork_has_no_lesson_number(self, db):
        """Forks are not platform texts — lesson_number must be None."""
        original = _make_text(db, visibility=VisibilityLevel.school)
        fork = fork_text_for_assignment(original, 99, 42, db)
        db.commit()
        db.refresh(fork)

        assert fork.lesson_number is None

    def test_fork_does_not_modify_original(self, db):
        original = _make_text(db, visibility=VisibilityLevel.school)
        original_id = original.id
        original_title = original.title

        fork_text_for_assignment(original, 99, 42, db)
        db.commit()

        db.expire(original)
        refreshed = db.query(Text).filter(Text.id == original_id).first()
        assert refreshed.title == original_title
        assert refreshed.forked_from_id is None  # original is unchanged


# ---------------------------------------------------------------------------
# Tests for resolve_text_for_assignment()
# ---------------------------------------------------------------------------


class TestResolveText:
    def test_platform_text_is_returned_as_is(self, db):
        platform_text = _make_text(db, visibility=VisibilityLevel.platform)

        result = resolve_text_for_assignment(platform_text, 99, 42, db)
        db.commit()

        assert result.id == platform_text.id
        # No new text should have been created beyond the original
        count = db.query(Text).count()
        assert count == 1

    def test_school_text_is_forked(self, db):
        school_text = _make_text(db, visibility=VisibilityLevel.school)

        result = resolve_text_for_assignment(school_text, 99, 42, db)
        db.commit()

        assert result.id != school_text.id
        assert result.forked_from_id == school_text.id
        count = db.query(Text).count()
        assert count == 2  # original + fork

    def test_private_text_is_forked(self, db):
        private_text = _make_text(db, visibility=VisibilityLevel.private)

        result = resolve_text_for_assignment(private_text, 99, 42, db)
        db.commit()

        assert result.forked_from_id == private_text.id

    def test_org_text_is_forked(self, db):
        org_text = _make_text(db, visibility=VisibilityLevel.organization)

        result = resolve_text_for_assignment(org_text, 99, 42, db)
        db.commit()

        assert result.forked_from_id == org_text.id

    def test_class_text_is_forked(self, db):
        class_text = _make_text(db, visibility=VisibilityLevel.class_)

        result = resolve_text_for_assignment(class_text, 99, 42, db)
        db.commit()

        assert result.forked_from_id == class_text.id

    def test_editing_original_does_not_affect_fork(self, db):
        """After forking, editing the original must not change the fork."""
        school_text = _make_text(db, visibility=VisibilityLevel.school, title="原始標題")

        fork = resolve_text_for_assignment(school_text, 99, 42, db)
        db.commit()

        # Now edit the original
        school_text.title = "修改後標題"
        db.commit()

        db.expire(fork)
        db.expire(school_text)

        refreshed_fork = db.query(Text).filter(Text.id == fork.id).first()
        refreshed_original = db.query(Text).filter(Text.id == school_text.id).first()

        assert refreshed_original.title == "修改後標題"
        assert refreshed_fork.title == "原始標題"  # fork is unchanged
