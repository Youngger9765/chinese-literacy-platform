"""TDD：閱讀寶貝的證據紀錄掛點（#3780 第一階段），取代
`tests/test_word_baby_step_progress_hook.py`（文字寶貝 v1 整套刪除）。

掛點一樣是 `save_step_progress()`（PUT /api/learning/sessions/{id}/progress），
跟 v1 同一個「每個 step 完成都會流經這裡」的位置（issue #3024 的先例）。
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
from app.models.reading_baby import StudentIndicatorEvidence
from app.services.lesson_loader import get_all_lessons, get_lesson_by_id
from app.services import reading_baby_config
from app.utils.slug import normalize_story_slug

# 選一課真的在 179 課課綱對照裡、而且內容樹也有這課的 lesson（兩邊 lesson_uid
# 要對得上，才能真的走到證據判定邏輯，不是落在 `lesson_meta is None` 的早退路徑）。
_TRACKED_LESSON_UIDS = set(reading_baby_config.all_lesson_uids())


def _find_tracked_lesson_slug() -> tuple[str, str]:
    for lesson in get_all_lessons():
        lesson_uid = lesson.get("lesson_uid")
        if lesson_uid in _TRACKED_LESSON_UIDS:
            return str(lesson["id"]), lesson_uid
    raise RuntimeError("no lesson in the content tree matches the 179-lesson reading-baby catalog")


_VALID_SLUG, _VALID_LESSON_UID = _find_tracked_lesson_slug()
_LESSON_META = reading_baby_config.get_lesson_indicator(_VALID_LESSON_UID)

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
    email = f"rbhook_{unique}@example.com"
    password = "SecurePass3780!"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "name": f"RBHook {unique}"},
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


def _first_assessable_station() -> str:
    return _LESSON_META["assessable_stations"][0]


class TestCompletingAStepRecordsEvidence:
    def test_newly_completed_assessable_station_creates_an_evidence_row(self, client, student, session_id):
        station = _first_assessable_station()
        resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={"current_step": station, "steps_completed": [station], "step_data": {}},
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text

        with TestingSessionLocal() as db:
            rows = (
                db.query(StudentIndicatorEvidence)
                .filter_by(student_id=student["id"], lesson_uid=_VALID_LESSON_UID, station=station)
                .all()
            )
            assert len(rows) == 1

    def test_resaving_the_same_completed_step_does_not_duplicate_evidence(self, client, student, session_id):
        station = _first_assessable_station()
        payload = {"current_step": station, "steps_completed": [station], "step_data": {}}
        client.put(
            f"/api/learning/sessions/{session_id}/progress", json=payload, headers=auth_header(student["token"])
        )
        resp2 = client.put(
            f"/api/learning/sessions/{session_id}/progress", json=payload, headers=auth_header(student["token"])
        )
        assert resp2.status_code == 200, resp2.text

        with TestingSessionLocal() as db:
            count = (
                db.query(StudentIndicatorEvidence)
                .filter_by(student_id=student["id"], lesson_uid=_VALID_LESSON_UID, station=station)
                .count()
            )
            assert count == 1

    def test_lesson_intro_is_recorded_on_first_step_save_even_though_never_in_steps_completed(
        self, client, student, session_id
    ):
        """跟 v1 一樣的特例（PRD §1.1）：lesson-intro 永遠不會出現在
        steps_completed，但第一次儲存就該記一筆『遇見』證據。"""
        station = _first_assessable_station()
        client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={"current_step": station, "steps_completed": [station], "step_data": {}},
            headers=auth_header(student["token"]),
        )

        with TestingSessionLocal() as db:
            rows = (
                db.query(StudentIndicatorEvidence)
                .filter_by(student_id=student["id"], lesson_uid=_VALID_LESSON_UID, station="lesson-intro")
                .all()
            )
            assert len(rows) == 1

    def test_report_step_does_not_earn_any_evidence(self, client, student, session_id):
        client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={"current_step": "report", "steps_completed": ["report"], "step_data": {}},
            headers=auth_header(student["token"]),
        )
        with TestingSessionLocal() as db:
            rows = (
                db.query(StudentIndicatorEvidence)
                .filter_by(student_id=student["id"], lesson_uid=_VALID_LESSON_UID, station="report")
                .all()
            )
            assert rows == []

    def test_passing_payload_marks_quality_passed_true(self, client, student, session_id):
        # 挑一個 signal_type 真的是 first_try_accuracy 的可評量站，payload 的
        # 形狀要跟那個 signal_type 對得上（reading_fluency 要 cpm/accuracy，
        # first_try_accuracy 要 firstTryResults）——不能假設固定站名。
        station = next(
            s for s in _LESSON_META["assessable_stations"]
            if _LESSON_META["stations"][s]["signal_type"] == "first_try_accuracy"
        )
        client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": station,
                "steps_completed": [station],
                "step_data": {station: {"firstTryResults": {"score": 10, "total": 10}}},
            },
            headers=auth_header(student["token"]),
        )
        with TestingSessionLocal() as db:
            row = (
                db.query(StudentIndicatorEvidence)
                .filter_by(student_id=student["id"], lesson_uid=_VALID_LESSON_UID, station=station)
                .one()
            )
            assert row.quality_passed is True


class TestReadingBabyBugDoesNotBreakStepProgressSave:
    """跟 v1 同一條防線：掛在既有端點上的新邏輯壞掉，不能連累真正的學習資料
    （step_progress／XP）一起存不進去。"""

    def test_step_progress_and_xp_still_save_when_evidence_recording_raises(
        self, client, student, session_id, monkeypatch
    ):
        from app.routes.learning import learning_step_progress as mod

        def _boom(*args, **kwargs):
            raise RuntimeError("simulated bug in reading-baby evidence logic")

        monkeypatch.setattr(mod, "record_station_evidence", _boom)

        station = _first_assessable_station()
        resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={"current_step": station, "steps_completed": [station], "step_data": {}},
            headers=auth_header(student["token"]),
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["step_progress"]["steps_completed"] == [station]
        assert body["xp_awarded"] > 0

    def test_one_failing_station_does_not_roll_back_other_stations_in_the_same_save(
        self, client, student, session_id, monkeypatch
    ):
        from app.routes.learning import learning_step_progress as mod

        real_record = mod.record_station_evidence
        assessable = _LESSON_META["assessable_stations"]
        assert len(assessable) >= 2, "需要至少兩個可評量站才能測這個情境"
        good_station, bad_station = assessable[0], assessable[1]

        def _flaky(db, *, station, **kwargs):
            if station == bad_station:
                raise RuntimeError("simulated failure on second station")
            return real_record(db, station=station, **kwargs)

        monkeypatch.setattr(mod, "record_station_evidence", _flaky)

        resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": bad_station,
                "steps_completed": [good_station, bad_station],
                "step_data": {},
            },
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text

        with TestingSessionLocal() as db:
            good_rows = (
                db.query(StudentIndicatorEvidence)
                .filter_by(student_id=student["id"], lesson_uid=_VALID_LESSON_UID, station=good_station)
                .count()
            )
            assert good_rows == 1
