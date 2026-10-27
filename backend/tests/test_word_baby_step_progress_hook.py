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


class TestStationMustBeGenuinelyInThisLessonsSequence:
    """Security review finding: a student could claim ANY of the 15 valid
    station ids for a lesson that doesn't actually contain that station,
    farming rewards for content they never touched. `_award_word_baby_rewards`
    must check the station is both (a) a real station in word_baby_config's
    15-station table, and (b) actually present in THIS lesson's real
    `step_sequence` (not just plausible-looking)."""

    def test_valid_station_not_in_this_lessons_sequence_earns_nothing(
        self, client, student, session_id
    ):
        """"spotlight" is a genuine PRD §5.1 station id, but L0011's real
        step_sequence doesn't contain it — claiming it must not produce a
        reward_log row (not even a "no reward" one; see TestInvalidStation
        below for why no row at all)."""
        from app.models.word_baby import StudentStationRewardLog

        client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={"current_step": "spotlight", "steps_completed": ["spotlight"], "step_data": {}},
            headers=auth_header(student["token"]),
        )

        with TestingSessionLocal() as db:
            rows = (
                db.query(StudentStationRewardLog)
                .filter_by(student_id=student["id"], lesson_uid=_VALID_LESSON_UID, station="spotlight")
                .all()
            )
            assert rows == []

    def test_completely_made_up_step_id_earns_nothing(self, client, student, session_id):
        from app.models.word_baby import StudentStationRewardLog

        client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": "vocab-definition",
                "steps_completed": ["totally-made-up-station-xyz"],
                "step_data": {},
            },
            headers=auth_header(student["token"]),
        )

        with TestingSessionLocal() as db:
            rows = (
                db.query(StudentStationRewardLog)
                .filter_by(student_id=student["id"], station="totally-made-up-station-xyz")
                .all()
            )
            assert rows == []

    def test_slugged_multi_part_station_id_is_matched_by_its_base_id(
        self, client, student, session_id
    ):
        """L0011's real sequence has "full-text-annotate#dcavv" (multi-part round
        slug), not the bare "full-text-annotate" — a legitimate completion
        reported with the slug attached must still be recognized (stripped to
        its base id for both the step_sequence check and the reward_log key)."""
        from app.models.word_baby import StudentStationRewardLog

        client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": "full-text-annotate#dcavv",
                "steps_completed": ["full-text-annotate#dcavv"],
                "step_data": {},
            },
            headers=auth_header(student["token"]),
        )

        with TestingSessionLocal() as db:
            rows = (
                db.query(StudentStationRewardLog)
                .filter_by(
                    student_id=student["id"], lesson_uid=_VALID_LESSON_UID, station="full-text-annotate"
                )
                .all()
            )
            assert len(rows) == 1


class TestInvalidStationNeverGetsALogRow:
    """Security review finding: a station outside the 15-station table
    previously still got a (fragment_awarded=False) log row written, purely
    to stay idempotent against repeat calls. Simpler and safer: an invalid
    station has nothing to make idempotent — just don't persist anything."""

    def test_unknown_station_produces_no_row_at_all(self, client, student, session_id):
        from app.models.word_baby import StudentStationRewardLog

        client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={
                "current_step": "vocab-definition",
                "steps_completed": ["not-a-real-station-at-all"],
                "step_data": {},
            },
            headers=auth_header(student["token"]),
        )

        with TestingSessionLocal() as db:
            count = (
                db.query(StudentStationRewardLog)
                .filter_by(student_id=student["id"], station="not-a-real-station-at-all")
                .count()
            )
            assert count == 0


class TestWordBabyRewardsSurfacedInResponse:
    """#3780 接島上 round: the reward-judgement hook above has always computed
    fragment/encounter results, it just discarded them. This surfaces them
    on `StepProgressResponse.word_baby_rewards` so the island HUD can show a
    one-line hint — additive only, no new endpoint, no DB migration (the
    columns already exist on StudentStationRewardLog)."""

    def test_newly_completed_station_reward_appears_in_response(self, client, student, session_id):
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
        rewards = resp.json()["word_baby_rewards"]
        assert len(rewards) >= 1
        station_names = [r["station"] for r in rewards]
        assert "vocab-definition" in station_names

    def test_resaving_the_same_completed_step_does_not_resurface_the_reward(self, client, student, session_id):
        payload = {
            "current_step": "vocab-review",
            "steps_completed": ["vocab-review"],
            "step_data": {},
        }
        resp1 = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json=payload, headers=auth_header(student["token"]),
        )
        assert resp1.status_code == 200, resp1.text
        assert any(r["station"] == "vocab-review" for r in resp1.json()["word_baby_rewards"])

        resp2 = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json=payload, headers=auth_header(student["token"]),
        )
        assert resp2.status_code == 200, resp2.text
        assert resp2.json()["word_baby_rewards"] == []

    def test_lesson_intro_reward_only_surfaces_once_not_on_every_autosave(self, client, student, session_id):
        """THE critical regression lock: lesson-intro is re-attempted on EVERY
        save by design (PRD §5.2). Without the reward_log_exists pre-check,
        this would re-surface "you got a reward!" to the island HUD on every
        5-second autosave for the rest of the session — not a bug that shows
        up as a crash, just a silently wrong/annoying product behavior, so it
        needs its own explicit lock."""
        first = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={"current_step": "spotlight", "steps_completed": [], "step_data": {}},
            headers=auth_header(student["token"]),
        )
        assert first.status_code == 200, first.text
        first_rewards = first.json()["word_baby_rewards"]
        assert any(r["station"] == "lesson-intro" for r in first_rewards)

        second = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={"current_step": "spotlight", "steps_completed": [], "step_data": {"anything": "changed"}},
            headers=auth_header(student["token"]),
        )
        assert second.status_code == 200, second.text
        second_rewards = second.json()["word_baby_rewards"]
        assert not any(r["station"] == "lesson-intro" for r in second_rewards), (
            "lesson-intro's reward re-surfaced on a repeat save — this is exactly "
            "the bug reward_log_exists exists to prevent"
        )

    def test_word_baby_reward_failure_does_not_break_the_response_or_xp(
        self, client, student, session_id, monkeypatch
    ):
        """Mirrors TestWordBabyBugDoesNotBreakStepProgressSave above — a bug in
        reward logic must not cost step-progress or XP, and must not crash the
        response when `word_baby_rewards` is read."""
        from app.routes.learning import learning_step_progress as mod

        def _boom(*args, **kwargs):
            raise RuntimeError("simulated bug")

        monkeypatch.setattr(mod, "award_station_rewards", _boom)

        resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={"current_step": "vocab-definition", "steps_completed": ["vocab-definition"], "step_data": {}},
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["word_baby_rewards"] == []
        assert resp.json()["xp_awarded"] > 0


class TestWordBabyRewardsReadableViaGet:
    """#3780 接島上 二次修正（team-lead 2026-10-28）：原本靠 PUT 回應 +
    postMessage 通知島上的設計，在真實網路延遲下會輸給 ISLAND_STEP_DONE
    造成的 iframe 拆除——PUT 的回應永遠到不了。改成「拉」而不是「推」：
    回島之後，島自己打 GET /progress 把這一課目前所有的獎勵紀錄讀出來，
    不依賴任何訊息的時序。這裡是讀取既有紀錄，不是重新判定，所以沒有
    PUT handler 那邊的冪等/SAVEPOINT 顧慮。"""

    def test_get_after_put_reflects_the_granted_reward(self, client, student, session_id):
        put_resp = client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={"current_step": "vocab-definition", "steps_completed": ["vocab-definition"], "step_data": {}},
            headers=auth_header(student["token"]),
        )
        assert put_resp.status_code == 200, put_resp.text
        put_reward = next(r for r in put_resp.json()["word_baby_rewards"] if r["station"] == "vocab-definition")

        get_resp = client.get(
            f"/api/learning/sessions/{session_id}/progress",
            headers=auth_header(student["token"]),
        )
        assert get_resp.status_code == 200, get_resp.text
        get_rewards = get_resp.json()["word_baby_rewards"]
        get_reward = next(r for r in get_rewards if r["station"] == "vocab-definition")

        # 同一筆 log，id 要一致——前端靠這個 id 做「顯示過了沒」的排重。
        assert get_reward["id"] == put_reward["id"]
        assert get_reward["fragment_awarded"] == put_reward["fragment_awarded"]
        assert get_reward["fragment_flavor"] == put_reward["fragment_flavor"]

    def test_get_keeps_returning_the_reward_on_every_subsequent_call(self, client, student, session_id):
        """跟 PUT 不同：GET 是讀取，不是「這次新發放才出現」——同一筆獎勵
        第二次、第三次 GET 都該看得到（排重的責任在前端 sessionStorage，
        不是後端這個讀取端點）。"""
        client.put(
            f"/api/learning/sessions/{session_id}/progress",
            json={"current_step": "vocab-definition", "steps_completed": ["vocab-definition"], "step_data": {}},
            headers=auth_header(student["token"]),
        )
        first_get = client.get(
            f"/api/learning/sessions/{session_id}/progress", headers=auth_header(student["token"]),
        )
        second_get = client.get(
            f"/api/learning/sessions/{session_id}/progress", headers=auth_header(student["token"]),
        )
        assert any(r["station"] == "vocab-definition" for r in first_get.json()["word_baby_rewards"])
        assert any(r["station"] == "vocab-definition" for r in second_get.json()["word_baby_rewards"])

    def test_reward_from_a_different_lesson_does_not_leak_into_this_ones_get(self, client, student, session_id):
        """同一個學生、不同課——這一課的 GET 不該看到另一課的獎勵紀錄。"""
        other_slug = next(s for s in _ALL_LESSON_SLUGS if s != _VALID_SLUG)
        other_session = client.post(
            "/api/learning/sessions", json={"story_slug": other_slug}, headers=auth_header(student["token"]),
        ).json()["id"]
        client.put(
            f"/api/learning/sessions/{other_session}/progress",
            json={"current_step": "vocab-definition", "steps_completed": ["vocab-definition"], "step_data": {}},
            headers=auth_header(student["token"]),
        )

        get_resp = client.get(
            f"/api/learning/sessions/{session_id}/progress", headers=auth_header(student["token"]),
        )
        assert get_resp.status_code == 200, get_resp.text
        assert get_resp.json()["word_baby_rewards"] == []

    def test_another_students_session_is_403_not_leaked(self, client, student, session_id):
        """team-lead 明確要求的案例：別人的 reward 讀不到。get_owned_session
        在讀任何欄位之前就先擋 403，文字寶貝的獎勵資料不例外。"""
        other_student = _register_and_login(client)
        resp = client.get(
            f"/api/learning/sessions/{session_id}/progress", headers=auth_header(other_student["token"]),
        )
        assert resp.status_code == 403, resp.text
