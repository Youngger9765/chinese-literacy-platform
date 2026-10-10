"""Fixes from the independent audit of the teacher panel (#3376)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
import app.models  # noqa: F401


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


@pytest.mark.parametrize("stored,expected", [(0.8, 80.0), (80.0, 80.0)])
def test_reading_accuracy_in_either_scale_scores_as_a_percentage(db, stored, expected):
    """accuracy=80 used to become 8000 × weight; both 0-1 and 0-100 must give 80."""
    from app.models.session import LearningSession
    from app.models.user import User
    from app.services.gamification_service import process_session_completion

    db.add(User(id=1, email="s@t.com", password_hash="x", name="S", is_active=True))
    db.flush()
    db.add(LearningSession(id=1, student_id=1, accuracy=stored))
    db.commit()
    process_session_completion(db, student_id=1, session_id=1)
    got = db.execute(text("SELECT overall_score FROM learning_sessions WHERE id=1")).scalar()
    assert got == pytest.approx(expected)


def test_started_but_never_scored_is_insufficient_data_not_low():
    from app.services.prediction_service import _compute_risk_level

    recent = datetime.now(timezone.utc) - timedelta(days=1)
    sessions = [SimpleNamespace(accuracy=None, started_at=recent)]
    level, _ = _compute_risk_level([], sessions)
    assert level == "insufficient_data"


def test_scored_and_no_factors_is_still_low():
    """Positive control: real data with nothing wrong stays low."""
    from app.services.prediction_service import _compute_risk_level

    sessions = [SimpleNamespace(accuracy=92.0, started_at=datetime.now(timezone.utc))]
    level, _ = _compute_risk_level([], sessions)
    assert level == "low"
