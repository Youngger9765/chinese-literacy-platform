"""Regression test: overall_score DB WRITE path (Issue 1063).

Bug: overall_score stayed NULL after session completion because the write
path in process_session_completion() was missing / not persisting the value.

This file tests the DB *write* path only — it does NOT test the weighted
formula in isolation (that lives in test_session_scoring_formula.py).

The entry-point under test is:
    gamification_service.process_session_completion(
        db, student_id, session_id,
        reading_accuracy=..., comprehension_passed=...
    )

After calling it we re-query the LearningSession row from the DB and assert
that overall_score has been written with the expected weighted value.

Weighted formula (from L311-L337 of gamification_service.py):
    reading  weight 0.4   → sourced from session.accuracy (×100) if set,
                             else from reading_accuracy arg
    comprehension weight 0.4 → sourced from session.comprehension_score if set,
                             else 80.0 if comprehension_passed=True
    vocab    weight 0.2   → session.vocab_result["accuracy"] (×100 if <=1)

overall = sum(score_i × weight_i) / sum(weight_i)   [normalised by actual weights present]
overall_score = round(overall, 1)
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
import app.models  # noqa: F401 — register all ORM tables


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def db_session():
    """Isolated in-memory SQLite DB; mirrors the pattern in test_gamification.py."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _make_user(db, user_id: int = 1):
    db.execute(
        text(
            "INSERT INTO users"
            " (id, email, password_hash, name, is_active, email_verified,"
            "  onboarding_completed, created_at, updated_at)"
            " VALUES (:id, :email, 'x', :name, 1, 0, 0,"
            " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ),
        {"id": user_id, "email": f"student{user_id}@test.com", "name": f"Student{user_id}"},
    )
    db.commit()


def _make_session(
    db,
    session_id: int,
    student_id: int,
    *,
    accuracy: float | None = None,
    comprehension_score: float | None = None,
    vocab_result: dict | None = None,
    status: str = "in_progress",
):
    """Insert a LearningSession with optional component scores pre-populated.

    Explicitly sets full_reading_attempts='[]' to avoid SQLite reading back
    the PostgreSQL server_default ``'[]'::jsonb`` which causes JSONDecodeError.
    The conftest _patch_pg_server_defaults() strips :: server_defaults but the
    column still needs a value in each INSERT row.
    """
    import json

    vocab_json = json.dumps(vocab_result) if vocab_result is not None else None
    db.execute(
        text(
            "INSERT INTO learning_sessions"
            " (id, student_id, status, current_step, started_at,"
            "  accuracy, comprehension_score, vocab_result, full_reading_attempts)"
            " VALUES (:id, :student_id, :status, 1, CURRENT_TIMESTAMP,"
            "  :accuracy, :comprehension_score, :vocab_result, '[]')"
        ),
        {
            "id": session_id,
            "student_id": student_id,
            "status": status,
            "accuracy": accuracy,
            "comprehension_score": comprehension_score,
            "vocab_result": vocab_json,
        },
    )
    db.commit()


# ---------------------------------------------------------------------------
# Helper: expected weighted score (same formula as the service)
# ---------------------------------------------------------------------------


def _expected_overall(
    accuracy_pct: float | None,
    comprehension_pct: float | None,
    vocab_pct: float | None,
) -> float:
    """Compute the expected overall_score using the service's formula.

    Each component is only included when its value is not None.
    """
    scores: list[float] = []
    weights: list[float] = []
    if accuracy_pct is not None:
        scores.append(accuracy_pct)
        weights.append(0.4)
    if comprehension_pct is not None:
        scores.append(comprehension_pct)
        weights.append(0.4)
    if vocab_pct is not None:
        scores.append(vocab_pct)
        weights.append(0.2)
    if not scores:
        return None  # type: ignore[return-value]
    return round(sum(s * w for s, w in zip(scores, weights)) / sum(weights), 1)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSessionScoringWrite1063:
    """overall_score write-path regression tests (Issue 1063)."""

    def test_overall_score_not_null_after_completion(self, db_session):
        """Regression: overall_score must be written (was NULL before fix)."""
        from app.services.gamification_service import process_session_completion

        _make_user(db_session, 1)
        # Pre-set component scores on the session row so the formula has inputs
        _make_session(
            db_session,
            session_id=1,
            student_id=1,
            accuracy=0.8,            # reading accuracy as a 0-1 fraction
            comprehension_score=70.0, # comprehension as 0-100
        )

        process_session_completion(
            db_session,
            student_id=1,
            session_id=1,
            reading_accuracy=80.0,
            comprehension_passed=True,
        )

        from app.models.session import LearningSession
        row = db_session.query(LearningSession).filter(LearningSession.id == 1).first()
        assert row is not None
        # Regression: this was None before the fix
        assert row.overall_score is not None, (
            "overall_score must be written by process_session_completion (Issue 1063 regression)"
        )

    def test_overall_score_matches_weighted_formula(self, db_session):
        """overall_score == weighted average of the three component scores."""
        from app.services.gamification_service import process_session_completion
        from app.models.session import LearningSession

        _make_user(db_session, 1)
        # Pre-populate all three components on the session row.
        # accuracy=0.8  → reading_pct = 80.0   weight 0.4
        # comprehension_score=70.0              weight 0.4
        # vocab_result={"accuracy": 0.9} → 90.0 weight 0.2
        _make_session(
            db_session,
            session_id=1,
            student_id=1,
            accuracy=0.8,
            comprehension_score=70.0,
            vocab_result={"accuracy": 0.9},
        )

        process_session_completion(
            db_session,
            student_id=1,
            session_id=1,
            reading_accuracy=80.0,
            comprehension_passed=True,
        )

        row = db_session.query(LearningSession).filter(LearningSession.id == 1).first()

        # Service code reads accuracy from session.accuracy (×100),
        # comprehension from session.comprehension_score,
        # vocab from session.vocab_result["accuracy"] (×100 because <=1).
        expected = _expected_overall(
            accuracy_pct=80.0,   # 0.8 × 100
            comprehension_pct=70.0,
            vocab_pct=90.0,      # 0.9 × 100
        )
        # Formula check: (80×0.4 + 70×0.4 + 90×0.2) / 1.0 = (32 + 28 + 18) / 1.0 = 78.0
        assert expected == 78.0, f"Hand-computed expected={expected}, wanted 78.0"
        assert row.overall_score == expected, (
            f"DB-persisted overall_score={row.overall_score!r} != expected {expected!r}"
        )

    def test_session_status_set_to_completed(self, db_session):
        """process_session_completion must flip status to 'completed'."""
        from app.services.gamification_service import process_session_completion
        from app.models.session import LearningSession

        _make_user(db_session, 1)
        _make_session(db_session, session_id=1, student_id=1, accuracy=0.75)

        process_session_completion(db_session, student_id=1, session_id=1)

        row = db_session.query(LearningSession).filter(LearningSession.id == 1).first()
        assert row.status == "completed"

    def test_no_component_scores_overall_score_stays_null(self, db_session):
        """Edge case: session with no component scores → overall_score remains NULL.

        The service only writes overall_score when there is at least one
        component present.  A session where accuracy / comprehension_score /
        vocab_result are all NULL and the caller passes no reading_accuracy /
        comprehension_passed should leave overall_score as NULL.
        """
        from app.services.gamification_service import process_session_completion
        from app.models.session import LearningSession

        _make_user(db_session, 1)
        # Session with no component scores, no arg scores passed
        _make_session(db_session, session_id=1, student_id=1)

        process_session_completion(
            db_session,
            student_id=1,
            session_id=1,
            reading_accuracy=None,
            comprehension_passed=False,
        )

        row = db_session.query(LearningSession).filter(LearningSession.id == 1).first()
        # No scores → formula has nothing to average → overall_score stays NULL
        assert row.overall_score is None, (
            f"Expected overall_score=None when no component scores present, "
            f"got {row.overall_score!r}"
        )

    def test_reading_accuracy_arg_used_when_session_accuracy_null(self, db_session):
        """Fallback: if session.accuracy is NULL, the reading_accuracy arg is used."""
        from app.services.gamification_service import process_session_completion
        from app.models.session import LearningSession

        _make_user(db_session, 1)
        # Session has no accuracy column value — only the arg will supply it
        _make_session(db_session, session_id=1, student_id=1)

        process_session_completion(
            db_session,
            student_id=1,
            session_id=1,
            reading_accuracy=60.0,
            comprehension_passed=False,
        )

        row = db_session.query(LearningSession).filter(LearningSession.id == 1).first()
        # Only reading_accuracy=60.0 (weight 0.4) supplied → overall = 60.0/0.4*0.4 = 60.0
        expected = _expected_overall(accuracy_pct=60.0, comprehension_pct=None, vocab_pct=None)
        assert expected == 60.0
        assert row.overall_score == expected, (
            f"overall_score={row.overall_score!r} != expected {expected!r} "
            "when only reading_accuracy arg present"
        )
