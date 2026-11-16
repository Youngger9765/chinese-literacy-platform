"""Regression test for Issue #4042's lock-ordering half of the fix.

The other half of #4042 (see test_badge_award_race_4042.py) makes
`_award_badge` atomic at the DB level. That alone does not stop the
specific deadlock seen on 2026-11-06T05:05 (two `DeadlockDetected`
entries ~1s apart, both touching session_id=1244): a real Postgres
deadlock requires a circular wait across TWO resources, and here the
second resource is the `learning_sessions` row itself, which both
`PUT /learning/sessions/{id}/progress` and `POST
/gamification/session-complete` also write to for the same session_id
when a student finishes their last step.

The fix is for both routes to take a `SELECT ... FOR UPDATE` lock on the
session row BEFORE either touches XP/badge tables, so the two requests
serialize at that single point instead of interleaving:

  - app/routes/learning/_helpers.py::get_owned_session(..., for_update=True)
    -- called from learning_step_progress.py::save_step_progress
  - app/services/gamification_service.py::get_session_for_update()
    -- called from app/routes/gamification.py::on_session_complete

SQLite (this backend's test-suite dialect, see conftest.py) silently
drops FOR UPDATE for dialects that don't support it, so the lock itself
can't be observed by running a query against the SQLite test DB. This
test instead captures the REAL Query object each production function
builds (via a thin monkeypatch of Query.first that records `.statement`
before letting the original call through) and compiles that exact
statement against the Postgres dialect -- no live Postgres needed, this
is pure SQL-text inspection. Capturing the real function's query (rather
than hand-copying the same `.filter(...).with_for_update()` chain inside
the test) is deliberate: a replica would keep passing even if the
production code's locking clause were later deleted.

TDD phases:
  RED   -> against the pre-#4042 code, `get_owned_session()` has no
           `for_update` parameter at all (TypeError) and
           `get_session_for_update()` doesn't exist yet (ImportError) /
           its callsite was a plain `.first()` with no lock (compiled SQL
           has no "FOR UPDATE").
  GREEN -> against the #4042 fix, both compile with "FOR UPDATE".
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Query, sessionmaker

from app.models.base import Base
import app.models  # noqa: F401
from app.routes.learning._helpers import get_owned_session
from app.services.gamification_service import get_session_for_update
from test_support.sqlite_compat import _apply_sqlite_metadata_patches


class _FakeUser:
    def __init__(self, id):
        self.id = id


def _seeded_db_session():
    _apply_sqlite_metadata_patches()
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    db.execute(text(
        "INSERT INTO users (id, email, password_hash, name, is_active,"
        " email_verified, onboarding_completed, created_at, updated_at)"
        " VALUES (1, 'a@test.com', 'x', 'A', 1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    ))
    db.execute(text(
        "INSERT INTO learning_sessions (id, student_id, status, current_step, started_at, story_slug)"
        " VALUES (1, 1, 'in_progress', 1, CURRENT_TIMESTAMP, 'story-1')"
    ))
    db.commit()
    return db


def _call_and_capture_statement(fn):
    """Call `fn()` (which must internally run exactly one `Query.first()`)
    and return (result, compiled_postgres_sql_of_that_query). Captures the
    REAL statement the production code builds -- this is what makes the
    assertion below meaningful instead of a hand-copied replica."""
    captured = {}
    original_first = Query.first

    def _capturing_first(self):
        captured["statement"] = self.statement
        return original_first(self)

    Query.first = _capturing_first
    try:
        result = fn()
    finally:
        Query.first = original_first

    assert "statement" in captured, "fn() did not call Query.first() -- nothing to inspect"
    sql = str(captured["statement"].compile(dialect=postgresql.dialect()))
    return result, sql


class TestSessionRowLockedBeforeGamificationWrites:
    def test_get_owned_session_for_update_true_locks_on_postgres(self):
        """learning_step_progress.save_step_progress's call path."""
        db = _seeded_db_session()
        try:
            session, sql = _call_and_capture_statement(
                lambda: get_owned_session(1, _FakeUser(1), db, for_update=True)
            )
            assert session.id == 1
        finally:
            db.close()

        assert "FOR UPDATE" in sql.upper(), (
            f"get_owned_session(for_update=True) must compile to a locking "
            f"SELECT on Postgres. Got:\n{sql}"
        )

    def test_get_owned_session_default_does_not_lock(self):
        """Read-only callers (learning_annotations.py, GET step-progress)
        must NOT silently start taking row locks -- that would widen the
        serialization point to paths that never write XP/badges."""
        db = _seeded_db_session()
        try:
            session, sql = _call_and_capture_statement(
                lambda: get_owned_session(1, _FakeUser(1), db)  # for_update defaults False
            )
            assert session.id == 1
        finally:
            db.close()

        assert "FOR UPDATE" not in sql.upper()

    def test_get_session_for_update_locks_on_postgres(self):
        """gamification.py::on_session_complete's call path."""
        db = _seeded_db_session()
        try:
            session, sql = _call_and_capture_statement(
                lambda: get_session_for_update(db, 1)
            )
            assert session.id == 1
        finally:
            db.close()

        assert "FOR UPDATE" in sql.upper(), (
            f"get_session_for_update() must compile to a locking SELECT "
            f"on Postgres. Got:\n{sql}"
        )

    def test_get_session_for_update_returns_none_for_missing_session(self):
        """Contract parity with the pre-#4042 plain `.first()` lookup:
        the route itself raises 404, this helper just returns None."""
        db = _seeded_db_session()
        try:
            assert get_session_for_update(db, 999999) is None
        finally:
            db.close()
