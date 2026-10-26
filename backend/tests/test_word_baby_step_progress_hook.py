"""TDD test for the word-baby reward trigger hook (#3780).

Team-lead: "觸發點選在哪裡、為什麼，要寫成「我的判斷」報給你" — the hook point
is `save_step_progress()` in learning_step_progress.py, right next to the
existing `_award_step_complete_xp()` call (issue #3024's precedent: that's
already "the ONE place every step completion flows through").

This test exercises the real PUT /api/learning/sessions/{id}/progress route
end-to-end and asserts reward_log rows appear — not a unit test of the
service in isolation (that's covered by test_word_baby_service.py).
"""
from __future__ import annotations

import sys
import os
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role
from app.services.lesson_loader import get_all_lessons, get_lesson_by_id
from app.utils.slug import normalize_story_slug

_ALL_LESSON_SLUGS = [str(lesson["id"]) for lesson in get_all_lessons()]
_VALID_SLUG = _ALL_LESSON_SLUGS[0]
_VALID_LESSON_UID = get_lesson_by_id(int(normalize_story_slug(_VALID_SLUG)))["lesson_uid"]

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    with TestingSessionLocal() as db:
        for role_data in SEED_ROLES:
            if not db.query(Role).filter_by(name=role_data["name"]).first():
                db.add(Role(**role_data))
        db.commit()
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _register_and_login(client, suffix: str | None = None) -> dict:
    unique = suffix or uuid.uuid4().hex[:8]
    email = f"wbhook_{unique}@example.com"
    password = "SecurePass3780!"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "name": f"WBHook {unique}"},
    )
    assert resp.status_code == 201, resp.text
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json()["access_token"]
    me = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    return {"id": me.json()["id"], "token": token}


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def student(client):
    return _register_and_login(client)


@pytest.fixture()
def session_id(client, student):
    resp = client.post(
        "/api/learning/sessions",
        json={"story_slug": _VALID_SLUG},
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


class TestCompletingAStepTriggersWordBabyReward:
    def test_newly_completed_station_creates_a_reward_log_row(self, client, student, session_id):
        from app.models.word_baby import StudentStationRewardLog

        resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": "vocab-definition",
                "steps_completed": ["vocab-definition"],
                "step_data": {},
            },
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text

        with TestingSessionLocal() as db:
            rows = (
                db.query(StudentStationRewardLog)
                .filter_by(student_id=student["id"], lesson_uid=_VALID_LESSON_UID, station="vocab-definition")
                .all()
            )
            assert len(rows) == 1

    def test_resaving_the_same_completed_step_does_not_double_reward(self, client, student, session_id):
        from app.models.word_baby import StudentStationRewardLog

        payload = {
            "current_step": "vocab-review",
            "steps_completed": ["vocab-review"],
            "step_data": {},
        }
        client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json=payload, headers=auth_header(student["token"]),
        )
        resp2 = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json=payload, headers=auth_header(student["token"]),
        )
        assert resp2.status_code == 200, resp2.text

        with TestingSessionLocal() as db:
            count = (
                db.query(StudentStationRewardLog)
                .filter_by(student_id=student["id"], lesson_uid=_VALID_LESSON_UID, station="vocab-review")
                .count()
            )
            assert count == 1

    def test_lesson_intro_is_rewarded_on_first_step_save_even_though_never_in_steps_completed(
        self, client, student, session_id
    ):
        """PRD §5.2: lesson-intro never appears in steps_completed by design
        ("有學習紀錄就算完成"). The hook must still credit it once a session's
        first step_progress save happens, since that's the first real signal
        this lesson has a session."""
        from app.models.word_baby import StudentStationRewardLog

        client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={"current_step": "spotlight", "steps_completed": ["spotlight"], "step_data": {}},
            headers=auth_header(student["token"]),
        )

        with TestingSessionLocal() as db:
            rows = (
                db.query(StudentStationRewardLog)
                .filter_by(student_id=student["id"], lesson_uid=_VALID_LESSON_UID, station="lesson-intro")
                .all()
            )
            assert len(rows) == 1

    def test_report_step_does_not_earn_a_reward(self, client, student, session_id):
        """Mirrors the XP exclusion: 'report' mounts automatically on the results
        page, it's not a genuine student action — rewarding it would let fragments
        drop for free, against the "學得會 > 看得下去 > 好看" priority rule."""
        from app.models.word_baby import StudentStationRewardLog

        client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={"current_step": "report", "steps_completed": ["report"], "step_data": {}},
            headers=auth_header(student["token"]),
        )

        with TestingSessionLocal() as db:
            rows = (
                db.query(StudentStationRewardLog)
                .filter_by(student_id=student["id"], lesson_uid=_VALID_LESSON_UID, station="report")
                .all()
            )
            assert rows == []


class TestWordBabyBugDoesNotBreakStepProgressSave:
    """code-reviewer finding: a new feature hooked into a critical, pre-existing
    endpoint must not be able to take the whole endpoint down. A bug inside
    word-baby reward logic must not cost the student their actual step-progress
    save or XP — those are real learning data, the pet system is not."""

    def test_step_progress_and_xp_still_save_when_word_baby_reward_raises(
        self, client, student, session_id, monkeypatch
    ):
        from app.routes.learning import learning_step_progress as mod

        def _boom(*args, **kwargs):
            raise RuntimeError("simulated bug in word-baby reward logic")

        monkeypatch.setattr(mod, "award_station_rewards", _boom)

        resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": "vocab-definition",
                "steps_completed": ["vocab-definition"],
                "step_data": {},
            },
            headers=auth_header(student["token"]),
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["step_progress"]["steps_completed"] == ["vocab-definition"]
        assert body["xp_awarded"] > 0

    def test_one_failing_station_does_not_roll_back_other_stations_in_the_same_save(
        self, client, student, session_id, monkeypatch
    ):
        """code-reviewer finding (round 2): wrapping the whole multi-station loop
        in one SAVEPOINT meant station 3 failing would roll back stations 1 and
        2's ALREADY-SUCCESSFUL rewards too — and since those step ids are now in
        steps_completed, they'd never be retried. Fragments would be lost forever.
        Each station must get its own SAVEPOINT."""
        from app.models.word_baby import StudentStationRewardLog
        from app.routes.learning import learning_step_progress as mod

        real_award = mod.award_station_rewards

        def _poison_third_station(db, *, student_id, lesson_uid, station):
            if station == "comprehension":
                raise RuntimeError("simulated bug on the 3rd station only")
            return real_award(db, student_id=student_id, lesson_uid=lesson_uid, station=station)

        monkeypatch.setattr(mod, "award_station_rewards", _poison_third_station)

        resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": "comprehension",
                "steps_completed": ["vocab-definition", "vocab-review", "comprehension"],
                "step_data": {},
            },
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text

        with TestingSessionLocal() as db:
            def _rewarded(station: str) -> bool:
                return (
                    db.query(StudentStationRewardLog)
                    .filter_by(student_id=student["id"], lesson_uid=_VALID_LESSON_UID, station=station)
                    .count()
                    == 1
                )

            assert _rewarded("vocab-definition") is True
            assert _rewarded("vocab-review") is True
            assert _rewarded("comprehension") is False  # the poisoned one — no orphaned row
