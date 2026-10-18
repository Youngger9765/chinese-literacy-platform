"""mcq_attempt session_id / attempt_no / choice_text (Issue #3028).

Star ratings ("用一次就答對 vs 按了 N 次") need to know which *session* an
answer click belongs to and which attempt-within-that-session it is — the
pre-#3028 table only had (user_id, lesson_id, question_id, choice,
is_correct, created_at), so repeated plays of the same lesson accumulated
into one undifferentiated wrong-answer count forever (Hans's 2026-10-14
comment, section 二之一: the same bug independently made the teacher
live-monitor "stuck on this question" signal wrong today).

Contract locked here (POST /api/learning/mcq-attempt):
  - session_id is resolved server-side from the caller's in_progress
    LearningSession for the normalized lesson slug — never trusted from
    the client (Hans's plan, section 零: "前端不送").
  - attempt_no is the 1-based ordinal of this attempt within
    (session_id, question_id); NULL whenever session_id is NULL (no
    guessing an ordinal we can't attribute to a session).
  - A brand-new session restarts attempt_no at 1 — this is the actual bug
    fix: without session scoping, a student's accuracy could only ever
    decay across every session they've ever had.
  - "G4-L1" (Layer-2 grade-code) and "20011" (its underlying numeric id)
    must resolve to the SAME session, because the spotlight writers send
    one form and the comprehension writer sends the other.
  - choice_text passes through to the new nullable column untouched.

Run with:
    cd backend && python -m pytest tests/test_mcq_attempt_3028.py -v
"""
from __future__ import annotations

import sys
import os
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import User
from app.models.session import LearningSession
from app.models.mcq_attempt import McqAttempt
from app.auth.dependencies import get_current_user
from app.auth.rate_limiter import general_rate_limiter

# ---------------------------------------------------------------------------
# SQLite in-memory test DB (pattern copied from test_teacher_live_monitor_3025.py)
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

FAKE_USER_ID = 9001


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


_fake_user = User(
    id=FAKE_USER_ID,
    username="mcq_attempt_3028_student",
    name="3028 Test Student",
    email="mcq-attempt-3028@example.com",
    password_hash="fake",
)


def _override_get_current_user():
    return _fake_user


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy import JSON

    for table in Base.metadata.sorted_tables:
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = JSON()

    Base.metadata.create_all(bind=engine)

    # A real row is required: FK pragma is ON (see _set_sqlite_pragma below),
    # and LearningSession.student_id / McqAttempt.user_id both FK -> users.id.
    # _override_get_current_user hands the route a floating Python object
    # with the same id, so the FK target just needs to exist, not match
    # field-for-field.
    db = TestingSessionLocal()
    db.add(
        User(
            id=FAKE_USER_ID,
            username="mcq_attempt_3028_student",
            name="3028 Test Student",
            email="mcq-attempt-3028@example.com",
            password_hash="fake",
        )
    )
    db.commit()
    db.close()

    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def reset_rate_limiter_and_db():
    """Reset rate limiter + wipe mcq_attempt/learning_sessions between tests.

    Each test asserts attempt_no counting from a clean slate, so leftover
    rows from a previous test would silently shift every count by N.
    """
    general_rate_limiter.reset()
    db = TestingSessionLocal()
    try:
        db.query(McqAttempt).delete()
        db.query(LearningSession).delete()
        db.commit()
    finally:
        db.close()
    yield


@pytest.fixture(scope="module")
def client():
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_get_current_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


URL = "/api/learning/mcq-attempt"


def _make_session(lesson_slug: str, status: str = "in_progress", started_at=None) -> int:
    db = TestingSessionLocal()
    try:
        session = LearningSession(
            student_id=FAKE_USER_ID,
            story_slug=lesson_slug,
            status=status,
            started_at=started_at or datetime.now(timezone.utc),
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return session.id
    finally:
        db.close()


def _complete_session(session_id: int) -> None:
    db = TestingSessionLocal()
    try:
        row = db.query(LearningSession).filter(LearningSession.id == session_id).first()
        row.status = "completed"
        db.commit()
    finally:
        db.close()


def _post(client, **overrides):
    payload = {
        "lesson_id": "20011",
        "question_id": "q1",
        "choice": "A",
        "choice_text": "選項甲",
        "is_correct": True,
    }
    payload.update(overrides)
    return client.post(URL, json=payload)


# ---------------------------------------------------------------------------
# session_id resolution
# ---------------------------------------------------------------------------


def test_resolves_session_id_from_in_progress_session(client):
    """Has a matching in_progress session -> session_id is filled."""
    session_id = _make_session("20011")

    res = _post(client, lesson_id="20011", question_id="q1")

    assert res.status_code == 200
    attempt_id = res.json()["id"]

    db = TestingSessionLocal()
    row = db.query(McqAttempt).filter(McqAttempt.id == attempt_id).first()
    db.close()
    assert row.session_id == session_id
    assert row.attempt_no == 1
    assert row.choice_text == "選項甲"


def test_no_session_leaves_session_id_and_attempt_no_null_no_error(client):
    """No in_progress session at all (e.g. practice toolbox) -> 200, both NULL."""
    res = _post(client, lesson_id="99999999", question_id="q-no-session")

    assert res.status_code == 200
    attempt_id = res.json()["id"]

    db = TestingSessionLocal()
    row = db.query(McqAttempt).filter(McqAttempt.id == attempt_id).first()
    db.close()
    assert row.session_id is None
    assert row.attempt_no is None


def test_completed_session_is_not_resolved(client):
    """A session that's no longer in_progress must not be matched —
    otherwise reopening a finished lesson from the history page would
    silently keep stacking attempts onto an already-finished run."""
    session_id = _make_session("20011")
    _complete_session(session_id)

    res = _post(client, lesson_id="20011", question_id="q1")

    assert res.status_code == 200
    attempt_id = res.json()["id"]
    db = TestingSessionLocal()
    row = db.query(McqAttempt).filter(McqAttempt.id == attempt_id).first()
    db.close()
    assert row.session_id is None
    assert row.attempt_no is None


# ---------------------------------------------------------------------------
# attempt_no counting
# ---------------------------------------------------------------------------


def test_same_question_three_times_attempt_no_is_1_2_3(client):
    _make_session("20011")

    r1 = _post(client, lesson_id="20011", question_id="q1", is_correct=False)
    r2 = _post(client, lesson_id="20011", question_id="q1", is_correct=False)
    r3 = _post(client, lesson_id="20011", question_id="q1", is_correct=True)

    db = TestingSessionLocal()
    attempt_nos = [
        db.query(McqAttempt).filter(McqAttempt.id == r.json()["id"]).first().attempt_no
        for r in (r1, r2, r3)
    ]
    db.close()
    assert attempt_nos == [1, 2, 3]


def test_new_session_restarts_attempt_no_at_1(client):
    """The actual bug fix: without session scoping, attempt_no (and
    therefore accuracy) could only ever go down across the student's whole
    history. A fresh session for the same lesson must start counting over."""
    session_a = _make_session("20011")
    _post(client, lesson_id="20011", question_id="q1", is_correct=False)
    _post(client, lesson_id="20011", question_id="q1", is_correct=False)
    _complete_session(session_a)

    _make_session("20011")
    res = _post(client, lesson_id="20011", question_id="q1", is_correct=True)

    db = TestingSessionLocal()
    row = db.query(McqAttempt).filter(McqAttempt.id == res.json()["id"]).first()
    db.close()
    assert row.attempt_no == 1


def test_different_questions_count_independently(client):
    """attempt_no is per (session, question) -- answering q1 must not bump
    q2's counter in the same session."""
    _make_session("20011")
    _post(client, lesson_id="20011", question_id="q1")
    _post(client, lesson_id="20011", question_id="q1")
    res_q2 = _post(client, lesson_id="20011", question_id="q2")

    db = TestingSessionLocal()
    row = db.query(McqAttempt).filter(McqAttempt.id == res_q2.json()["id"]).first()
    db.close()
    assert row.attempt_no == 1


# ---------------------------------------------------------------------------
# slug normalization — the "別人可能不知道" land mine from Hans's plan
# ---------------------------------------------------------------------------


def test_grade_code_and_numeric_lesson_id_resolve_same_session(client):
    """"G4-L1" (what the spotlight writers send) and "20011" (its real
    numeric lesson id, per lesson_loader's actual catalogue -- "G4-L1" is a
    real lesson_code in backend/data/lessons, not a fixture fabrication)
    must resolve to the SAME in_progress session. If they didn't, the
    spotlight and comprehension writers for the exact same lesson would
    each silently open their own shadow session and never share an
    attempt_no sequence."""
    session_id = _make_session("20011")

    res_numeric = _post(client, lesson_id="20011", question_id="q-numeric")
    res_code = _post(client, lesson_id="G4-L1", question_id="q-code")

    db = TestingSessionLocal()
    row_numeric = db.query(McqAttempt).filter(
        McqAttempt.id == res_numeric.json()["id"]
    ).first()
    row_code = db.query(McqAttempt).filter(
        McqAttempt.id == res_code.json()["id"]
    ).first()
    db.close()

    assert row_numeric.session_id == session_id
    assert row_code.session_id == session_id


def test_grade_code_attempt_no_continues_numeric_sequence(client):
    """Same question_id answered first via the numeric form then the
    grade-code form, inside the same session, must share one attempt_no
    sequence -- proof the two forms are really treated as the same
    question, not accidentally disambiguated by lesson_id spelling."""
    _make_session("20011")
    r1 = _post(client, lesson_id="20011", question_id="q1")
    r2 = _post(client, lesson_id="G4-L1", question_id="q1")

    db = TestingSessionLocal()
    n1 = db.query(McqAttempt).filter(McqAttempt.id == r1.json()["id"]).first().attempt_no
    n2 = db.query(McqAttempt).filter(McqAttempt.id == r2.json()["id"]).first().attempt_no
    db.close()
    assert [n1, n2] == [1, 2]


# ---------------------------------------------------------------------------
# existing contract untouched
# ---------------------------------------------------------------------------


def test_choice_text_is_optional_existing_clients_still_work(client):
    """A caller that doesn't send choice_text at all (old frontend bundle
    mid-deploy, or a non-UI caller) must still succeed with choice_text
    left NULL -- this field must never become a breaking requirement."""
    res = client.post(
        URL,
        json={
            "lesson_id": "20011",
            "question_id": "q1",
            "choice": "A",
            "is_correct": True,
        },
    )
    assert res.status_code == 200
    db = TestingSessionLocal()
    row = db.query(McqAttempt).filter(McqAttempt.id == res.json()["id"]).first()
    db.close()
    assert row.choice_text is None
    assert row.choice == "A"
