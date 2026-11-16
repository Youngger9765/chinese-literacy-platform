"""Regression test for Issue #4042: concurrent badge-award race deadlocks/duplicates.

Production evidence (Cloud Logging, lingoleap-backend, 30d window):

  2026-10-26T08:39  IntegrityError: duplicate key (student_id, badge_key)=(1184, story_5)
  2026-11-02T02:29  IntegrityError: duplicate key (student_id, badge_key)=(1257, first_session)
  2026-11-06T05:05  psycopg2.errors.DeadlockDetected while inserting index tuple in
                     relation "uq_student_badge" (student_id=1297, badge_key='story_5')
  2026-11-06T05:05  psycopg2.errors.DeadlockDetected while updating tuple in relation
                     "learning_sessions" (same session_id=1244, ~1s apart)

Root cause: `_award_badge()` in gamification_service.py did a plain
check-then-insert (SELECT "does this badge exist?" -> if not, db.add(...)).
Two different HTTP routes settle the SAME session's gamification state
nearly simultaneously when a student finishes the last step:

  PUT  /api/learning/sessions/{id}/progress   (learning_step_progress.py,
       mid-session step-complete XP + badge check)
  POST /api/gamification/session-complete     (gamification.py ->
       process_session_completion, the full settlement)

Both independently query "is story_5 unlocked for this student yet?",
both see "no" (neither has committed), both try to INSERT the same
(student_id, badge_key) row. Postgres resolves the race either as a plain
unique-constraint violation, or -- when the two transactions' lock orders
also cross on the session's own learning_sessions row -- as a full
deadlock that kills one of the two HTTP requests with a 500.

This test reproduces the check-then-insert race with two REAL OS threads,
each on its own SQLAlchemy engine/session bound to a SHARED on-disk
SQLite file (a single `:memory:` SQLite DB is per-connection, so it can't
model "two independent transactions racing each other" -- a shared file
can). A `threading.Barrier` forces both threads to attempt the award at
the same instant, so neither has committed when the other acts -- the
same timing as the production incident (PUT .../progress and POST
/session-complete firing within ~1s of each other).

This does not reproduce Postgres's specific multi-resource deadlock
machinery (that needs two transactions also racing a SEPARATE resource --
see #4042's FOR UPDATE lock-ordering fix in the route handlers for that
half), but it reproduces the exact application-level race that is common
to all four production incidents above: two concurrent callers both
deciding a badge is newly-unlockable and racing to persist it.

TDD phases:
  RED   -> against the pre-fix `_award_badge()` (SELECT-then-`db.add()`),
           one of the two threads' commit raises IntegrityError (or, on a
           slower machine, "database is locked" -- SQLite's analogue of
           Postgres making the loser wait on the winner's transaction).
  GREEN -> against the fixed `_award_badge()` (INSERT ... ON CONFLICT DO
           NOTHING ... RETURNING), neither thread raises; exactly one row
           exists afterward.
"""
import os
import sys
import threading

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))  # test_support/

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
import app.models  # noqa: F401 -- registers all tables on Base.metadata
from app.models.gamification import StudentBadge
from app.services.gamification_service import _award_badge
from test_support.sqlite_compat import _apply_sqlite_metadata_patches


def _award_badge_in_thread(db_path, student_id, badge_key, barrier, results, name):
    """Run one full award attempt on its own engine/session, synchronized
    via `barrier` so both threads reach `_award_badge` at the same instant.
    """
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"timeout": 15})
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    try:
        barrier.wait(timeout=10)
        try:
            badge = _award_badge(db, student_id=student_id, badge_key=badge_key)
            db.commit()
            results[f"{name}_badge"] = badge
            results[f"{name}_error"] = None
        except SQLAlchemyError as exc:
            db.rollback()
            results[f"{name}_badge"] = None
            results[f"{name}_error"] = repr(exc)
    finally:
        db.close()
        engine.dispose()


@pytest.fixture()
def shared_sqlite_file(tmp_path):
    """A schema-initialized, on-disk SQLite DB with one seeded user, shared
    by multiple independent engines/connections (one per thread) -- the
    property a `:memory:` DB can't give us (that's per-connection).
    """
    _apply_sqlite_metadata_patches()
    db_path = tmp_path / "badge_race_4042.sqlite3"

    setup_engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(setup_engine)
    with setup_engine.connect() as conn:
        conn.execute(text(
            "INSERT INTO users (id, email, password_hash, name, is_active,"
            " email_verified, onboarding_completed, created_at, updated_at)"
            " VALUES (1, 'student@test.com', 'x', 'Student', 1, 0, 0,"
            " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ))
        conn.commit()
    setup_engine.dispose()

    yield str(db_path)


class TestConcurrentBadgeAwardIsSafe:
    def test_two_real_threads_racing_the_same_badge_do_not_corrupt_state(self, shared_sqlite_file):
        """The actual #4042 race, with genuine OS-level concurrency."""
        results: dict = {}
        barrier = threading.Barrier(2)

        t_a = threading.Thread(
            target=_award_badge_in_thread,
            args=(shared_sqlite_file, 1, "story_5", barrier, results, "a"),
        )
        t_b = threading.Thread(
            target=_award_badge_in_thread,
            args=(shared_sqlite_file, 1, "story_5", barrier, results, "b"),
        )
        t_a.start()
        t_b.start()
        t_a.join(timeout=15)
        t_b.join(timeout=15)

        assert not t_a.is_alive() and not t_b.is_alive(), "a thread hung -- deadlock reproduced at the SQLite level"

        errors = {k: v for k, v in results.items() if k.endswith("_error") and v is not None}
        assert errors == {}, (
            f"a concurrent badge award raised instead of being a clean no-op: {errors}\n"
            "This is the #4042 race: two concurrent requests deciding the same badge "
            "is newly-unlockable must not surface a 500 to either caller."
        )

        # Exactly one of the two calls should have actually unlocked the badge;
        # the other must have seen the conflict and returned None cleanly.
        badges = [results["a_badge"], results["b_badge"]]
        assert sum(1 for b in badges if b is not None) == 1, (
            f"expected exactly one winner, got: {badges}"
        )

        verify_engine = create_engine(f"sqlite:///{shared_sqlite_file}")
        with verify_engine.connect() as conn:
            total = conn.execute(
                text("SELECT COUNT(*) FROM student_badges WHERE student_id=1 AND badge_key='story_5'")
            ).scalar()
        verify_engine.dispose()
        assert total == 1, f"expected exactly 1 row, found {total} -- duplicate or lost award"

    def test_awarding_an_already_committed_badge_again_is_a_clean_noop(self, shared_sqlite_file):
        """Simpler sequential case: a retried request re-checks a badge that
        was already committed by an earlier call. Must return None, never
        raise -- the unique index on (student_id, badge_key) must never
        surface as an exception from this function.
        """
        engine = create_engine(f"sqlite:///{shared_sqlite_file}")
        SessionLocal = sessionmaker(bind=engine)
        db = SessionLocal()
        try:
            first = _award_badge(db, student_id=1, badge_key="first_session")
            assert first is not None
            db.commit()

            second = _award_badge(db, student_id=1, badge_key="first_session")
            db.commit()  # must not raise
            assert second is None

            total = db.execute(
                text("SELECT COUNT(*) FROM student_badges WHERE student_id=1 AND badge_key='first_session'")
            ).scalar()
            assert total == 1
        finally:
            db.close()
            engine.dispose()
