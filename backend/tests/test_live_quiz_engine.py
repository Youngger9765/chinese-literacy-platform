"""End-to-end tests for /api/live-quiz/* — the full host+player lifecycle
through the real FastAPI app (TestClient), mirroring the pattern in
test_assignments.py. Uses real lesson data (L0125 / L0137, both verified to
carry comprehension + vocab_definitions + vocab_application) rather than a
mocked lesson loader, so these tests exercise the real adapters end to end.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.auth.jwt import create_access_token
from app.database import get_db
from app.models import Base
from app.models.user import Role, User, UserRole
from app.models.school import School
from app.services.live_quiz import engine as live_quiz_engine

LESSON_A = "L0125"
LESSON_B = "L0137"

engine_db = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine_db, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_db)

SEED_ROLES = [
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]

_test_school_id = 0


def _seed_roles(session):
    for r in SEED_ROLES:
        session.add(Role(**r))
    session.commit()


def _seed_school(session) -> int:
    school = School(name="Live Quiz Test School")
    session.add(school)
    session.commit()
    session.refresh(school)
    return school.id


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _test_school_id
    Base.metadata.create_all(bind=engine_db)
    session = TestingSessionLocal()
    _seed_roles(session)
    _test_school_id = _seed_school(session)
    session.close()

    from app.routes.auth import rate_limiter
    rate_limiter.reset()

    app.dependency_overrides[get_db] = _override_get_db

    # GlobalRateLimitMiddleware's live-quiz membership check (app/main.py)
    # is pure ASGI, not a FastAPI dependency — it can't go through
    # app.dependency_overrides, so it does its own lazy
    # `from .database import SessionLocal`. Point that at this test's
    # engine too, or every /state and /answer call 500s looking for
    # live_quiz_games in the OTHER (real, file-backed) test.db.
    import app.database as app_database
    original_session_local = app_database.SessionLocal
    app_database.SessionLocal = TestingSessionLocal

    yield

    app_database.SessionLocal = original_session_local
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine_db)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{suffix.title()} {unique}"
    resp = client.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    assert resp.status_code == 201, resp.text
    token_v = resp.json().get("verification_token")
    if token_v:
        v = client.get(f"/api/auth/verify-email?token={token_v}")
        assert v.status_code == 200
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    me = client.get("/api/users/me", headers=auth_header(token))
    user_id = me.json()["id"]
    return {"email": email, "name": name, "token": token, "user_id": user_id}


def _grant_teacher_role(user_id: int) -> None:
    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == "teacher").first()
        db.add(UserRole(user_id=user_id, role_id=role.id, scope_type="school", scope_id=str(_test_school_id)))
        db.commit()
    finally:
        db.close()


def _grant_student_role(user_id: int) -> None:
    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == "student").first()
        db.add(UserRole(user_id=user_id, role_id=role.id, scope_type="school", scope_id=str(_test_school_id)))
        db.commit()
    finally:
        db.close()


def _direct_student_token(suffix: str) -> dict:
    """Creates a ``User`` row + "student" role directly via the DB and mints
    a JWT with ``create_access_token`` — bypassing `/api/auth/register`
    entirely, which is rate-limited at 5 requests/60s PER IP
    (`app/routes/auth.py`) and every `TestClient` call shares one fake IP.
    A single scenario needing >4 simultaneous players (on top of the
    `teacher` fixture's own registration) hits that cap through the normal
    fixtures; this is the escape hatch for exactly that, used only by
    issue #3631's rank-visibility tests below."""
    db = TestingSessionLocal()
    try:
        unique = uuid.uuid4().hex[:8]
        user = User(
            email=f"{suffix}_{unique}@example.com",
            password_hash="x",  # never used — no login flow, token is minted directly
            name=f"{suffix.title()} {unique}",
            is_active=True,
            email_verified=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        role = db.query(Role).filter(Role.name == "student").first()
        db.add(UserRole(user_id=user.id, role_id=role.id, scope_type="school", scope_id=str(_test_school_id)))
        db.commit()
        token = create_access_token(user.id)
        return {"email": user.email, "name": user.name, "token": token, "user_id": user.id}
    finally:
        db.close()


@pytest.fixture()
def teacher(client):
    u = _register_user(client, "lq_teacher")
    _grant_teacher_role(u["user_id"])
    return u


@pytest.fixture()
def other_teacher(client):
    u = _register_user(client, "lq_other_teacher")
    _grant_teacher_role(u["user_id"])
    return u


@pytest.fixture()
def student1(client):
    u = _register_user(client, "lq_stu1")
    _grant_student_role(u["user_id"])
    return u


@pytest.fixture()
def student2(client):
    u = _register_user(client, "lq_stu2")
    _grant_student_role(u["user_id"])
    return u


@pytest.fixture()
def student3(client):
    u = _register_user(client, "lq_stu3")
    _grant_student_role(u["user_id"])
    return u


def _fake_lesson(n_questions: int) -> dict:
    return {
        "title": "假課文",
        "version_id": "v1",
        "comprehension": {
            "questions": [
                {"index": i, "stem": f"題{i}？", "answer": "A",
                 "options": {"A": "正確", "B": "錯誤1", "C": "錯誤2", "D": "錯誤3"}}
                for i in range(1, n_questions + 1)
            ]
        },
    }


@pytest.fixture()
def tiny_lessons(monkeypatch):
    """PRD's question_count_mode only accepts all/10/15/20 (the UI dropdown)
    — too coarse to pin an exact small round count for settings tests
    (double_points_last / streak_bonus need to know precisely which round
    is "last"). Monkeypatches the engine's lesson loader to serve a tiny
    fixed-size fake lesson instead, so `question_count_mode="all"` over a
    2- or 3-question fake lesson gives an exact, known round count."""
    def _fake_load_lesson(uid):
        if uid == "FAKE2":
            return _fake_lesson(2)
        if uid == "FAKE3":
            return _fake_lesson(3)
        return None

    monkeypatch.setattr(live_quiz_engine, "load_lesson", _fake_load_lesson)


def _create_game(client, teacher, lesson_uids=(LESSON_A,), **overrides):
    body = {
        "lesson_uids": list(lesson_uids),
        "source_modules": ["comprehension", "vocab_definitions", "vocab_application"],
        "seconds": 30,
        # Tests answer immediately after start/next — a nonzero reading
        # phase would reject every one of them as "too early". The reading
        # phase itself is covered by its own dedicated tests below.
        "reading_seconds": 0,
        "question_count_mode": "all",
    }
    body.update(overrides)
    resp = client.post("/api/live-quiz/games", json=body, headers=auth_header(teacher["token"]))
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestCreateGame:
    def test_creates_game_with_valid_lessons(self, client, teacher):
        game = _create_game(client, teacher)
        assert len(game["code"]) == 6
        assert game["status"] == "lobby"
        assert game["rounds_total"] > 0

    def test_grade_6_comprehension_with_blank_answer_image_question_creates(self, client, teacher):
        # #3616 prod hotfix: L0052 Q3's correct option D has no text; on
        # production every game including L0052 + comprehension 500'd.
        game = _create_game(
            client, teacher, lesson_uids=["L0051", "L0052", "L0053"], source_modules=["comprehension"]
        )
        assert game["rounds_total"] > 0
        solo = _create_game(client, teacher, lesson_uids=["L0052"], source_modules=["comprehension"])
        assert solo["rounds_total"] > 0

    def test_multi_lesson_mix_pools_both_lessons(self, client, teacher):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A, LESSON_B])
        state = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(teacher["token"])
        ).json()
        assert state["rounds_total"] > 0

    def test_rejects_empty_lesson_list(self, client, teacher):
        resp = client.post(
            "/api/live-quiz/games",
            json={"lesson_uids": [], "seconds": 30},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code in (400, 422)

    def test_rejects_unknown_lesson(self, client, teacher):
        resp = client.post(
            "/api/live-quiz/games",
            json={"lesson_uids": ["L9999"], "seconds": 30},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 400

    def test_rejects_invalid_seconds(self, client, teacher):
        resp = client.post(
            "/api/live-quiz/games",
            json={"lesson_uids": [LESSON_A], "seconds": 7},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_reading_pace_lands_in_settings_when_reading_seconds_not_given(self, client, teacher):
        """issue #3631 P0 #1: the public API no longer exposes a raw
        "讀題時間（秒）" number — teachers pick a 慢/標準/快 preset, and the
        actual per-round seconds are computed server-side from each round's
        own stem length (see test_live_quiz_round_choice.py)."""
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], reading_seconds=None, reading_pace="fast")
        assert game["settings"]["reading_pace"] == "fast"
        assert "reading_seconds" not in game["settings"]

    def test_reading_pace_defaults_to_standard(self, client, teacher):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], reading_seconds=None)
        assert game["settings"]["reading_pace"] == "standard"

    def test_rejects_invalid_reading_pace(self, client, teacher):
        resp = client.post(
            "/api/live-quiz/games",
            json={"lesson_uids": [LESSON_A], "source_modules": ["comprehension"], "seconds": 30,
                  "question_count_mode": "all", "reading_pace": "ludicrous-speed"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422

    def test_explicit_reading_seconds_still_accepted_for_backward_compat(self, client, teacher):
        """PK and any other internal caller of the lower-level
        ``choice.generate_rounds`` keep the explicit-override escape hatch;
        this just confirms the PUBLIC schema field itself hasn't been
        removed, only made optional (default None -> pace-based)."""
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], reading_seconds=12)
        assert game["settings"]["reading_seconds"] == 12
        assert "reading_pace" not in game["settings"]


class TestJoinAndRoster:
    def test_student_can_join_by_code(self, client, teacher, student1):
        game = _create_game(client, teacher)
        resp = client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        assert resp.status_code == 201
        assert resp.json()["display_name"] == student1["name"]

    def test_nameless_player_never_shows_email_anywhere(self, client, teacher, student1):
        """#3630 security review (Young): display_name used to fall back to
        user.email when the profile had no name — leaking the student's
        email on the host's screen, the leaderboard, and the projected
        podium. A nameless player must get a non-PII placeholder instead,
        and that email must never surface on ANY of the three surfaces a
        teacher/projector can see: the join response itself, the live
        /state leaderboard, and the post-game /results ranking+players.
        """
        db = TestingSessionLocal()
        try:
            user = db.get(User, student1["user_id"])
            user.name = ""  # falsy, like a never-completed profile — NOT NULL at the DB level
            db.commit()
        finally:
            db.close()

        game = _create_game(client, teacher, lesson_uids=[LESSON_A])

        join_resp = client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        assert join_resp.status_code == 201
        joined_name = join_resp.json()["display_name"]
        assert student1["email"] not in joined_name
        assert "@" not in joined_name
        assert joined_name.startswith("學生")

        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        state = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(teacher["token"])
        ).json()
        state_names = [p["display_name"] for p in state["players"]]
        assert all(student1["email"] not in n and "@" not in n for n in state_names)
        assert joined_name in state_names

        client.post(f"/api/live-quiz/games/{game['code']}/end", headers=auth_header(teacher["token"]))
        results = client.get(
            f"/api/live-quiz/games/{game['code']}/results", headers=auth_header(teacher["token"])
        ).json()
        ranking_names = [p["display_name"] for p in results["ranking"]]
        players_names = [p["display_name"] for p in results["players"]]
        assert all(student1["email"] not in n and "@" not in n for n in ranking_names)
        assert all(student1["email"] not in n and "@" not in n for n in players_names)

    def test_joining_twice_is_idempotent(self, client, teacher, student1):
        game = _create_game(client, teacher)
        r1 = client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        r2 = client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        assert r1.json()["player_id"] == r2.json()["player_id"]

    def test_host_cannot_join_own_game(self, client, teacher):
        game = _create_game(client, teacher)
        resp = client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(teacher["token"]))
        assert resp.status_code == 403

    def test_late_join_succeeds_but_cannot_answer_the_in_flight_round(
        self, client, teacher, student1, student2
    ):
        """UI/UX review 2026-10-15 #3: late join is allowed (not rejected)
        — the late joiner just starts from the NEXT question."""
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], question_count_mode="all")
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))

        late_join = client.post(
            f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student2["token"])
        )
        assert late_join.status_code == 201

        # The round that was already showing when they joined is off-limits.
        resp = client.post(
            f"/api/live-quiz/games/{game['code']}/answer", json={"submission": {"choice_key": "A"}},
            headers=auth_header(student2["token"]),
        )
        assert resp.status_code == 409

        # They ARE eligible once the host advances to the next round.
        client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))
        nxt = client.post(f"/api/live-quiz/games/{game['code']}/next", headers=auth_header(teacher["token"]))
        if nxt.json()["status"] != "question":
            return  # fewer than 2 rounds in this fixture lesson — nothing more to assert
        state = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student2["token"])
        ).json()
        assert state["your_player"]["eligible"] is True

    def test_late_join_round_excluded_from_accuracy_denominator(self, client, teacher, student1, student2):
        """The round the late joiner missed never gets an answer row from
        them, so it is excluded from that round's accuracy denominator
        (not counted as a wrong answer) — see get_game_results."""
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], question_count_mode="all")
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student2["token"]))

        db = TestingSessionLocal()
        try:
            row = live_quiz_engine.get_game_by_code(db, game["code"])
            correct_key = row.rounds_snapshot[0]["payload"]["correct_key"]
        finally:
            db.close()
        client.post(
            f"/api/live-quiz/games/{game['code']}/answer", json={"submission": {"choice_key": correct_key}},
            headers=auth_header(student1["token"]),
        )
        client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/end", headers=auth_header(teacher["token"]))

        results = client.get(
            f"/api/live-quiz/games/{game['code']}/results", headers=auth_header(teacher["token"])
        ).json()
        round0 = results["rounds"][0]
        assert round0["answered"] == 1  # only student1 — student2 is excluded, not counted wrong
        assert round0["correct"] == 1
        assert round0["accuracy"] == 1.0

    def test_max_players_enforced(self, client, teacher, monkeypatch):
        monkeypatch.setattr(live_quiz_engine, "MAX_PLAYERS_PER_GAME", 1)
        game = _create_game(client, teacher)
        s1 = _register_user(client, "lq_cap1")
        s2 = _register_user(client, "lq_cap2")
        r1 = client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(s1["token"]))
        assert r1.status_code == 201
        r2 = client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(s2["token"]))
        assert r2.status_code == 409


class TestLifecycleAndAuthz:
    def test_non_host_cannot_start(self, client, teacher, other_teacher):
        game = _create_game(client, teacher)
        resp = client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(other_teacher["token"]))
        assert resp.status_code == 403

    def test_unjoined_player_cannot_answer(self, client, teacher, student1):
        game = _create_game(client, teacher)
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        resp = client.post(
            f"/api/live-quiz/games/{game['code']}/answer",
            json={"submission": {"choice_key": "A"}},
            headers=auth_header(student1["token"]),
        )
        assert resp.status_code == 403

    def test_teacher_host_cannot_answer(self, client, teacher, student1):
        game = _create_game(client, teacher)
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        resp = client.post(
            f"/api/live-quiz/games/{game['code']}/answer",
            json={"submission": {"choice_key": "A"}},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 403

    def test_expired_game_rejects_start(self, client, teacher):
        game = _create_game(client, teacher)
        db = TestingSessionLocal()
        try:
            row = live_quiz_engine.get_game_by_code(db, game["code"])
            from datetime import datetime, timedelta, timezone
            row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            db.commit()
        finally:
            db.close()
        resp = client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        assert resp.status_code == 409


class TestAnswerScoringAndReveal:
    def _play_one_round(self, client, teacher, players, answers):
        """answers: list of (player, submission_dict_or_None, elapsed hint ignored —
        we just submit immediately; speed differences are covered at the
        round_types.choice unit-test level) submitted in order."""
        game = _create_game(client, teacher, lesson_uids=[LESSON_A])
        for p in players:
            client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(p["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        return game

    def test_correct_wrong_and_no_answer_each_score_as_expected(self, client, teacher, student1, student2, student3):
        game = self._play_one_round(client, teacher, [student1, student2, student3], None)

        state = client.get(f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(teacher["token"])).json()
        correct_key = None
        # Correct key is hidden from the HOST too before reveal (uniform rule).
        assert "correct_key" not in (state["round"] or {})

        # Discover the correct key via a controlled DB peek (test-only), since
        # neither role's /state exposes it pre-reveal (that's the point).
        db = TestingSessionLocal()
        try:
            row = live_quiz_engine.get_game_by_code(db, game["code"])
            correct_key = row.rounds_snapshot[0]["payload"]["correct_key"]
            all_keys = {o["key"] for o in row.rounds_snapshot[0]["payload"]["options"]}
        finally:
            db.close()
        wrong_key = next(k for k in all_keys if k != correct_key)

        r1 = client.post(
            f"/api/live-quiz/games/{game['code']}/answer", json={"submission": {"choice_key": correct_key}},
            headers=auth_header(student1["token"]),
        )
        assert r1.json()["is_correct"] is True
        assert r1.json()["points"] >= 500

        r2 = client.post(
            f"/api/live-quiz/games/{game['code']}/answer", json={"submission": {"choice_key": wrong_key}},
            headers=auth_header(student2["token"]),
        )
        assert r2.json() == {"round_index": 0, "is_correct": False, "points": 0}

        # student3 never answers.

        reveal = client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))
        assert reveal.json()["round"]["correct_key"] == correct_key

        s1_state = client.get(f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student1["token"])).json()
        assert s1_state["your_player"]["last_answer_correct"] is True
        s3_state = client.get(f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student3["token"])).json()
        # None (not False) — "not_participated" is distinct from "wrong"
        # (UI/UX review #3); student3 was eligible, just didn't answer.
        assert s3_state["your_player"]["last_answer_correct"] is None
        assert s3_state["your_player"]["eligible"] is True

    def test_duplicate_answer_rejected(self, client, teacher, student1):
        game = self._play_one_round(client, teacher, [student1], None)
        body = {"submission": {"choice_key": "A"}}
        first = client.post(f"/api/live-quiz/games/{game['code']}/answer", json=body, headers=auth_header(student1["token"]))
        assert first.status_code == 200
        second = client.post(f"/api/live-quiz/games/{game['code']}/answer", json=body, headers=auth_header(student1["token"]))
        assert second.status_code == 409

    def test_late_answer_rejected(self, client, teacher, student1):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], seconds=20)
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        db = TestingSessionLocal()
        try:
            from datetime import datetime, timedelta, timezone
            row = live_quiz_engine.get_game_by_code(db, game["code"])
            row.current_round_started_at = datetime.now(timezone.utc) - timedelta(seconds=25)
            db.commit()
        finally:
            db.close()
        resp = client.post(
            f"/api/live-quiz/games/{game['code']}/answer", json={"submission": {"choice_key": "A"}},
            headers=auth_header(student1["token"]),
        )
        assert resp.status_code == 409


class TestFullGameToEnd:
    def test_next_round_advances_then_ends_after_last(self, client, teacher, student1):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A])
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))

        db = TestingSessionLocal()
        try:
            row = live_quiz_engine.get_game_by_code(db, game["code"])
            total_rounds = len(row.rounds_snapshot)
        finally:
            db.close()

        for i in range(total_rounds):
            reveal = client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))
            assert reveal.status_code == 200
            nxt = client.post(f"/api/live-quiz/games/{game['code']}/next", headers=auth_header(teacher["token"]))
            if i < total_rounds - 1:
                assert nxt.json()["status"] == "question"
                assert nxt.json()["round_index"] == i + 1
            else:
                assert nxt.json()["status"] == "ended"

    def test_host_can_force_end(self, client, teacher, student1):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A])
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        resp = client.post(f"/api/live-quiz/games/{game['code']}/end", headers=auth_header(teacher["token"]))
        assert resp.json()["status"] == "ended"


class TestSettingsBehaviour:
    def test_double_points_last_round(self, client, teacher, student1, tiny_lessons):
        game = _create_game(
            client, teacher, lesson_uids=["FAKE2"], source_modules=["comprehension"],
            question_count_mode="all", double_points_last=True,
        )
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))

        def correct_key_for_round(i):
            db = TestingSessionLocal()
            try:
                row = live_quiz_engine.get_game_by_code(db, game["code"])
                return row.rounds_snapshot[i]["payload"]["correct_key"]
            finally:
                db.close()

        r0 = client.post(
            f"/api/live-quiz/games/{game['code']}/answer",
            json={"submission": {"choice_key": correct_key_for_round(0)}}, headers=auth_header(student1["token"]),
        ).json()
        client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/next", headers=auth_header(teacher["token"]))
        r1 = client.post(
            f"/api/live-quiz/games/{game['code']}/answer",
            json={"submission": {"choice_key": correct_key_for_round(1)}}, headers=auth_header(student1["token"]),
        ).json()
        # Both answers land within a few ms of their round starting, so the
        # speed bonus is ~max (~1000) either way; real HTTP round-trip jitter
        # between the two calls can shift the UNDOUBLED base by a point or
        # two, so assert "doubled" with a small tolerance rather than exact
        # equality (an exact `== r0*2` is what broke on the first run: 2000
        # vs 999*2=1998 purely from sub-millisecond timing jitter, not a
        # scoring bug).
        assert abs(r1["points"] - r0["points"] * 2) <= 4

    def test_streak_bonus_across_three_rounds(self, client, teacher, student1, tiny_lessons):
        game = _create_game(
            client, teacher, lesson_uids=["FAKE3"], source_modules=["comprehension"],
            question_count_mode="all", streak_bonus=True,
        )
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        points = []
        for i in range(3):
            db = TestingSessionLocal()
            try:
                row = live_quiz_engine.get_game_by_code(db, game["code"])
                key = row.rounds_snapshot[i]["payload"]["correct_key"]
            finally:
                db.close()
            resp = client.post(
                f"/api/live-quiz/games/{game['code']}/answer",
                json={"submission": {"choice_key": key}}, headers=auth_header(student1["token"]),
            ).json()
            points.append(resp["points"])
            if i < 2:
                client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))
                client.post(f"/api/live-quiz/games/{game['code']}/next", headers=auth_header(teacher["token"]))
        # bonuses: 0, +100, +200 on top of each round's own base/speed points.
        assert points[1] - 100 <= points[0] + 1000  # sanity: still within plausible per-round base range
        assert (points[1] - points[0]) in range(50, 151)  # ~100 bonus allowing speed-bonus jitter is NOT expected here (fixed elapsed), so this is close to exactly 100
        assert (points[2] - points[1]) in range(50, 151)

    def test_practice_mode_hides_score_and_rank(self, client, teacher, student1):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], practice_mode=True)
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        client.post(
            f"/api/live-quiz/games/{game['code']}/answer", json={"submission": {"choice_key": "A"}},
            headers=auth_header(student1["token"]),
        )
        client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))
        state = client.get(f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student1["token"])).json()
        assert "total_score" not in state["your_player"]
        assert "rank" not in state["your_player"]
        assert "rank_delta" not in state["your_player"]  # issue #3631 P0 #4 — practice mode hides this too
        assert "leaderboard" not in state

    def test_show_leaderboard_after_each_toggle(self, client, teacher, student1, tiny_lessons):
        game_on = _create_game(
            client, teacher, lesson_uids=["FAKE2"], source_modules=["comprehension"],
            question_count_mode="all", show_leaderboard_after_each=True,
        )
        game_off = _create_game(
            client, teacher, lesson_uids=["FAKE2"], source_modules=["comprehension"],
            question_count_mode="all", show_leaderboard_after_each=False,
        )
        for game in (game_on, game_off):
            client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
            client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
            client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))

        on_state = client.get(f"/api/live-quiz/games/{game_on['code']}/state", headers=auth_header(teacher["token"])).json()
        off_state = client.get(f"/api/live-quiz/games/{game_off['code']}/state", headers=auth_header(teacher["token"])).json()
        assert "leaderboard" in on_state
        assert "leaderboard" not in off_state


class TestInvitesHistoryAndResults:
    def test_invite_only_visible_to_enrolled_classroom_students(self, client, teacher, student1, student2):
        classroom_resp = client.post(
            "/api/classrooms", json={"name": "LQ Test Classroom", "school_id": _test_school_id},
            headers=auth_header(teacher["token"]),
        )
        assert classroom_resp.status_code == 201, classroom_resp.text
        classroom_id = classroom_resp.json()["id"]
        client.post(
            f"/api/classrooms/{classroom_id}/students", json={"student_id": student1["user_id"]},
            headers=auth_header(teacher["token"]),
        )
        # issue #3607: live_quiz is OFF by default per classroom (a brand
        # new classroom here has no history to fall back on) — this test
        # is about invite visibility, not the feature gate itself (that
        # gets its own dedicated class below), so opt the room in first.
        enable = client.patch(
            f"/api/classrooms/{classroom_id}/pk-settings", json={"live_quiz": True},
            headers=auth_header(teacher["token"]),
        )
        assert enable.status_code == 200, enable.text
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], classroom_id=classroom_id)

        invited = client.get("/api/live-quiz/invites", headers=auth_header(student1["token"])).json()
        assert invited["invite"]["code"] == game["code"]

        not_invited = client.get("/api/live-quiz/invites", headers=auth_header(student2["token"])).json()
        assert not_invited["invite"] is None

    def test_results_only_visible_to_host(self, client, teacher, other_teacher, student1):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A])
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/end", headers=auth_header(teacher["token"]))

        forbidden = client.get(f"/api/live-quiz/games/{game['code']}/results", headers=auth_header(other_teacher["token"]))
        assert forbidden.status_code == 403

        ok = client.get(f"/api/live-quiz/games/{game['code']}/results", headers=auth_header(teacher["token"]))
        assert ok.status_code == 200
        body = ok.json()
        assert body["players"][0]["display_name"] == student1["name"]
        assert "round_type" in body
        assert "settings" in body
        assert len(body["rounds"]) > 0

    def test_list_my_games_shows_hosts_own_games(self, client, teacher):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A])
        listing = client.get("/api/live-quiz/games", headers=auth_header(teacher["token"])).json()
        codes = {g["code"] for g in listing["games"]}
        assert game["code"] in codes


class TestUiUxReview20261015:
    """Tests explicitly requested for the 2026-10-15 UI/UX review items
    #1 (numeric code), #2 (reading phase), #7 (host end-early reason).
    #3 and #8 are covered above (TestJoinAndRoster /
    TestInvitesHistoryAndResults and TestCreateGame respectively)."""

    def test_game_code_is_six_digits(self, client, teacher):
        game = _create_game(client, teacher)
        assert len(game["code"]) == 6
        assert game["code"].isdigit()

    def test_reading_phase_rejects_early_answer_and_hides_options(self, client, teacher, student1):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], reading_seconds=4)
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))

        state = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student1["token"])
        ).json()
        assert "options" not in (state["round"] or {})
        assert state["reading_seconds"] == 4
        assert state["answer_open_at"] is not None

        resp = client.post(
            f"/api/live-quiz/games/{game['code']}/answer", json={"submission": {"choice_key": "A"}},
            headers=auth_header(student1["token"]),
        )
        assert resp.status_code == 409

    def test_reading_phase_opens_after_delay_elapses(self, client, teacher, student1):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], reading_seconds=4)
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))

        # Simulate the 4s reading delay having elapsed, instead of a real
        # `time.sleep(4)` in every test run.
        db = TestingSessionLocal()
        try:
            from datetime import datetime, timedelta, timezone
            row = live_quiz_engine.get_game_by_code(db, game["code"])
            row.current_round_started_at = datetime.now(timezone.utc) - timedelta(seconds=5)
            db.commit()
        finally:
            db.close()

        state = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student1["token"])
        ).json()
        assert "options" in state["round"]

        resp = client.post(
            f"/api/live-quiz/games/{game['code']}/answer", json={"submission": {"choice_key": "A"}},
            headers=auth_header(student1["token"]),
        )
        assert resp.status_code == 200

    def test_reading_seconds_zero_disables_the_delay(self, client, teacher, student1):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], reading_seconds=0)
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        state = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student1["token"])
        ).json()
        assert "options" in state["round"]
        resp = client.post(
            f"/api/live-quiz/games/{game['code']}/answer", json={"submission": {"choice_key": "A"}},
            headers=auth_header(student1["token"]),
        )
        assert resp.status_code == 200

    def test_natural_completion_reason_is_completed(self, client, teacher, student1, tiny_lessons):
        game = _create_game(
            client, teacher, lesson_uids=["FAKE2"], source_modules=["comprehension"],
            question_count_mode="all",
        )
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        for _ in range(2):
            client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))
            final = client.post(f"/api/live-quiz/games/{game['code']}/next", headers=auth_header(teacher["token"]))
        assert final.json()["status"] == "ended"
        assert final.json()["ended_reason"] == "completed"
        assert final.json()["ended_by_host"] is False

    def test_host_end_early_reason_is_host_ended(self, client, teacher, student1):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A])
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        ended = client.post(f"/api/live-quiz/games/{game['code']}/end", headers=auth_header(teacher["token"]))
        assert ended.json()["ended_reason"] == "host_ended"
        assert ended.json()["ended_by_host"] is True

        player_state = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student1["token"])
        ).json()
        assert player_state["ended_by_host"] is True

    def test_host_device_takeover_requires_explicit_confirm(self, client, teacher, student1):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A])
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(
            f"/api/live-quiz/games/{game['code']}/start", json={"device_id": "device-a"},
            headers=auth_header(teacher["token"]),
        )
        blocked = client.post(
            f"/api/live-quiz/games/{game['code']}/reveal", json={"device_id": "device-b"},
            headers=auth_header(teacher["token"]),
        )
        assert blocked.status_code == 409

        allowed = client.post(
            f"/api/live-quiz/games/{game['code']}/reveal",
            json={"device_id": "device-b", "confirm_takeover": True},
            headers=auth_header(teacher["token"]),
        )
        assert allowed.status_code == 200

    def test_host_can_remove_player_before_start_only(self, client, teacher, student1, student2):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A])
        p1 = client.post(
            f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"])
        ).json()
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student2["token"]))

        removed = client.delete(
            f"/api/live-quiz/games/{game['code']}/players/{p1['player_id']}",
            headers=auth_header(teacher["token"]),
        )
        assert removed.status_code == 204

        rejoin_check = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student1["token"])
        )
        assert rejoin_check.status_code == 403  # no longer a player

        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        p2_state = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(teacher["token"])
        ).json()
        p2_id = p2_state["players"][0]["player_id"]
        after_start = client.delete(
            f"/api/live-quiz/games/{game['code']}/players/{p2_id}", headers=auth_header(teacher["token"])
        )
        assert after_start.status_code == 409

    def test_zhuyin_only_game_returns_zhuyin_rounds_and_scores_correctly(self, client, teacher, student1):
        """Coordinator instruction (zhuyin merged into staging): a game
        created with ONLY the zhuyin type returns zhuyin questions whose
        answers match the module's output, and plays through normally."""
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], source_modules=["zhuyin"])
        assert game["rounds_total"] > 0
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))

        db = TestingSessionLocal()
        try:
            row = live_quiz_engine.get_game_by_code(db, game["code"])
            payload = row.rounds_snapshot[0]["payload"]
        finally:
            db.close()
        assert payload["source_module"] == "zhuyin"
        assert "extra" in payload and "target_index" in payload["extra"]
        assert 2 <= len(payload["options"]) <= 4

        resp = client.post(
            f"/api/live-quiz/games/{game['code']}/answer",
            json={"submission": {"choice_key": payload["correct_key"]}},
            headers=auth_header(student1["token"]),
        )
        assert resp.json()["is_correct"] is True

        # Player view during the question phase must never leak correct_key,
        # same uniform rule as every other source module.
        state = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student1["token"])
        ).json()
        assert "correct_key" not in state["round"]
        assert state["round"]["extra"]["target_index"] == payload["extra"]["target_index"]

    def test_players_never_see_the_full_ranked_leaderboard_object(
        self, client, teacher, student1, student2
    ):
        """PRD §13 (2026-10-15) said students never see rank or total_score
        at all; issue #3631 P0 #4 (2026-10-18, Young) overrides that for
        PER-QUESTION feedback — see TestPlayerRankVisibility3631 below for
        the new rank/total_score/rank_delta behaviour. What's UNCHANGED:
        the full ranked ``leaderboard`` array (every player's name + score +
        rank) is still host-only, full stop — a player's own
        ``your_player.rank`` is a single number about THEMSELVES, never the
        list."""
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], practice_mode=False)
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student2["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        db = TestingSessionLocal()
        try:
            row = live_quiz_engine.get_game_by_code(db, game["code"])
            correct_key = row.rounds_snapshot[0]["payload"]["correct_key"]
        finally:
            db.close()
        client.post(
            f"/api/live-quiz/games/{game['code']}/answer", json={"submission": {"choice_key": correct_key}},
            headers=auth_header(student1["token"]),
        )
        client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))

        state = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student1["token"])
        ).json()
        assert "leaderboard" not in state  # the ranked LIST is host-only, full stop
        assert state["your_player"]["correct_count"] == 1
        # With only 2 players, student1 (who answered correctly) is
        # unambiguously in the top 5 -> sees an actual rank number.
        assert state["your_player"]["rank"] in (1, 2)
        assert "rank_delta" not in state["your_player"]
        assert state["your_player"]["total_score"] >= 500

    def test_host_still_sees_full_leaderboard_and_roster(self, client, teacher, student1):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A])
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        client.post(
            f"/api/live-quiz/games/{game['code']}/answer", json={"submission": {"choice_key": "A"}},
            headers=auth_header(student1["token"]),
        )
        client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))

        host_state = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(teacher["token"])
        ).json()
        assert "leaderboard" in host_state
        assert host_state["leaderboard"][0]["player_id"] == (
            next(p["player_id"] for p in host_state["players"] if p["display_name"] == student1["name"])
        )
        assert "total_score" in host_state["players"][0]

    def test_improvement_vs_previous_game_shown_at_end(self, client, teacher, student1):
        """UI/UX §13: "改顯示答對題數與進步" — the second game shows
        whether the student did better than their last one."""
        game1 = _create_game(client, teacher, lesson_uids=[LESSON_A], question_count_mode="all")
        client.post(f"/api/live-quiz/games/{game1['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game1['code']}/start", headers=auth_header(teacher["token"]))
        wrong_resp = client.post(
            f"/api/live-quiz/games/{game1['code']}/answer", json={"submission": {"choice_key": "Z"}},
            headers=auth_header(student1["token"]),
        )
        assert wrong_resp.json()["is_correct"] is False
        client.post(f"/api/live-quiz/games/{game1['code']}/end", headers=auth_header(teacher["token"]))

        game2 = _create_game(client, teacher, lesson_uids=[LESSON_A])
        client.post(f"/api/live-quiz/games/{game2['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game2['code']}/start", headers=auth_header(teacher["token"]))
        db = TestingSessionLocal()
        try:
            row = live_quiz_engine.get_game_by_code(db, game2["code"])
            correct_key = row.rounds_snapshot[0]["payload"]["correct_key"]
        finally:
            db.close()
        client.post(
            f"/api/live-quiz/games/{game2['code']}/answer", json={"submission": {"choice_key": correct_key}},
            headers=auth_header(student1["token"]),
        )
        client.post(f"/api/live-quiz/games/{game2['code']}/end", headers=auth_header(teacher["token"]))

        state = client.get(
            f"/api/live-quiz/games/{game2['code']}/state", headers=auth_header(student1["token"])
        ).json()
        assert state["your_player"]["previous_game_correct_count"] == 0
        assert state["your_player"]["correct_count"] == 1
        assert state["your_player"]["improved"] is True

    def test_presence_online_count(self, client, teacher, student1, student2):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A])
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student2["token"]))
        # student1 polls (bumping last_seen_at); student2 never does.
        client.get(f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student1["token"]))

        db = TestingSessionLocal()
        try:
            from datetime import datetime, timedelta, timezone
            row = live_quiz_engine.get_game_by_code(db, game["code"])
            p2 = next(p for p in row.players if p.user_id == student2["user_id"])
            p2.last_seen_at = datetime.now(timezone.utc) - timedelta(seconds=30)
            db.commit()
        finally:
            db.close()

        host_state = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(teacher["token"])
        ).json()
        assert host_state["online_count"] == 1


class TestPlayerRankVisibility3631:
    """issue #3631 P0 #4 (2026-10-18, Young — overrides PRD §13's "players
    never see rank/score"): each question's reveal gives a player their OWN
    points for that round + running total; a top-5 player sees their actual
    rank; 6th place or lower sees "advanced/retreated N places" instead,
    never "第 N 名". The full ranked ``leaderboard`` array stays host-only
    (TestUiUxReview20261015.test_players_never_see_the_full_ranked_leaderboard_object).

    All three HTTP-level tests below separate players by WRONG(=0 points)
    vs CORRECT(=500-1000 points) rather than by relative speed among
    correct answers — that gap is large enough to make rank purely
    deterministic regardless of real wall-clock jitter between POSTs.
    """

    def test_top5_player_sees_own_rank_not_a_delta(self, client, teacher):
        # 5 players via `_direct_student_token` (not 5 separate fixtures) —
        # combined with the `teacher` fixture's own registration, 5 more
        # `/register` calls would exceed that endpoint's 5/60s-per-IP cap.
        players = [_direct_student_token(f"lq_top5_{i}") for i in range(5)]
        game = _create_game(client, teacher, lesson_uids=[LESSON_A])
        for p in players:
            client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(p["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        db = TestingSessionLocal()
        try:
            row = live_quiz_engine.get_game_by_code(db, game["code"])
            correct_key = row.rounds_snapshot[0]["payload"]["correct_key"]
        finally:
            db.close()
        for p in players:
            client.post(
                f"/api/live-quiz/games/{game['code']}/answer",
                json={"submission": {"choice_key": correct_key}}, headers=auth_header(p["token"]),
            )
        client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))

        state = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(players[0]["token"])
        ).json()
        your = state["your_player"]
        assert 1 <= your["rank"] <= 5
        assert "rank_delta" not in your
        assert your["total_score"] >= 500
        assert your["last_answer_points"] >= 500

    def test_sixth_place_sees_rank_delta_not_rank(self, client, teacher):
        # 6 players via `_direct_student_token`, same reason as the test
        # above (6 `/register` calls would exceed the 5/60s-per-IP cap).
        players = [_direct_student_token(f"lq_6th_{i}") for i in range(6)]
        sixth = players[-1]

        game = _create_game(client, teacher, lesson_uids=[LESSON_A])
        for p in players:
            client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(p["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        db = TestingSessionLocal()
        try:
            row = live_quiz_engine.get_game_by_code(db, game["code"])
            correct_key = row.rounds_snapshot[0]["payload"]["correct_key"]
        finally:
            db.close()
        # The first 5 answer correctly (>=500 each); the 6th never answers
        # at all -> guaranteed 0 points, guaranteed last place.
        for p in players[:5]:
            client.post(
                f"/api/live-quiz/games/{game['code']}/answer",
                json={"submission": {"choice_key": correct_key}}, headers=auth_header(p["token"]),
            )
        client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))

        state = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(sixth["token"])
        ).json()
        your = state["your_player"]
        assert "rank" not in your
        assert "rank_delta" in your
        # Round 0: EVERY player's score-before-this-round is 0 (nobody has
        # scored yet), so the "before" ranking is a full tie broken by join
        # order alone — the 6th-to-join player is already last there too.
        # Round 0 itself therefore moved this player zero places.
        assert your["rank_delta"] == 0
        assert your["total_score"] == 0

    def test_practice_mode_hides_rank_delta_too(self, client, teacher, student1):
        """Extends test_practice_mode_hides_score_and_rank's existing
        coverage (same gate, `if not practice_mode`) to the new field."""
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], practice_mode=True)
        client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        # Deliberately never answer -> would be "last place" if scored at all.
        client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))
        state = client.get(
            f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student1["token"])
        ).json()
        assert "rank" not in state["your_player"]
        assert "rank_delta" not in state["your_player"]
        assert "total_score" not in state["your_player"]

    def test_rank_delta_sign_reflects_movement_caused_by_this_round(self, client, teacher):
        """Direct DB construction (not HTTP) for exact, non-flaky score
        control — the two tests above correctly avoid asserting on relative
        speed-bonus ordering between two CORRECT answers; this one needs
        that precision, so it builds the rows directly instead, the same
        pattern `test_presence_online_count` / `test_late_answer_rejected`
        already use for exact DB-level control elsewhere in this file.

        8 players, round 1 just revealed. Round-0-only contributions (used
        as the "before this round" baseline) are 800/700/600/500/400/300/
        200/0 for p1..p8. In round 1, p1..p7 answer nothing (unchanged);
        p8 alone scores +250 this round. Both the mover (p8) and its
        nearest neighbour (p7) stay OUTSIDE the top 5 both before and
        after — this isolates the SIGN of rank_delta from the (separately,
        already covered) top-5-vs-not boundary.

            before (= round-0 totals):  p1..p8 ranked 1..8 in listed order
            after  (= current totals):  p1(800) p2(700) p3(600) p4(500)
                                         p5(400) p6(300) p8(250) p7(200)
                                         -> ranks 1..8
            p8: before=8, after=7 -> delta = +1 (advanced)
            p7: before=7, after=8 -> delta = -1 (retreated)
        """
        from datetime import datetime, timedelta, timezone

        from app.models.live_quiz import LiveQuizAnswer, LiveQuizGame, LiveQuizPlayer

        db = TestingSessionLocal()
        try:
            now = datetime.now(timezone.utc)

            def _payload(stem):
                return {"item_id": f"x:{stem}", "source_module": "comprehension", "lesson_uid": "L1",
                        "lesson_title": "t", "stem": stem, "options": [], "correct_key": "A",
                        "seconds": 30, "reading_seconds": 2}

            game = LiveQuizGame(
                code="999002", host_teacher_id=teacher["user_id"], status="reveal",
                settings={"seconds": 30, "reading_pace": "standard", "source_modules": ["comprehension"]},
                rounds_snapshot=[
                    {"round_index": 0, "round_type": "choice", "payload": _payload("round0")},
                    {"round_index": 1, "round_type": "choice", "payload": _payload("round1")},
                ],
                seed=1, current_round_index=1, current_round_started_at=now, version=1,
                created_at=now, expires_at=now + timedelta(hours=3),
            )
            db.add(game)
            db.commit()
            db.refresh(game)

            round0_scores = [800, 700, 600, 500, 400, 300, 200, 0]
            round1_scores = [0, 0, 0, 0, 0, 0, 0, 250]  # only p8 (index 7) scores this round
            users = []
            players = []
            for i, (r0, r1) in enumerate(zip(round0_scores, round1_scores)):
                u = _direct_student_token(f"lq_rankdelta_{i}")
                users.append(u)
                p = LiveQuizPlayer(
                    game_id=game.id, user_id=u["user_id"], display_name=f"p{i + 1}",
                    total_score=r0 + r1, joined_at=now - timedelta(seconds=100 - i),
                    joined_at_round_index=-1,
                )
                db.add(p)
                players.append(p)
            db.commit()
            for p in players:
                db.refresh(p)

            for i, p in enumerate(players):
                if round0_scores[i]:
                    db.add(LiveQuizAnswer(
                        game_id=game.id, player_id=p.id, round_index=0, submission={"choice_key": "A"},
                        is_correct=True, points=round0_scores[i], elapsed_ms=0,
                        round_started_at=now, answered_at=now,
                    ))
                if round1_scores[i]:
                    db.add(LiveQuizAnswer(
                        game_id=game.id, player_id=p.id, round_index=1, submission={"choice_key": "A"},
                        is_correct=True, points=round1_scores[i], elapsed_ms=0,
                        round_started_at=now, answered_at=now,
                    ))
            db.commit()
            db.refresh(game)

            p1_user = db.query(User).filter(User.id == users[0]["user_id"]).first()
            p7_user = db.query(User).filter(User.id == users[6]["user_id"]).first()
            p8_user = db.query(User).filter(User.id == users[7]["user_id"]).first()

            p1_state = live_quiz_engine.build_state(db, game, p1_user)
            assert p1_state["your_player"]["rank"] == 1
            assert "rank_delta" not in p1_state["your_player"]

            p7_state = live_quiz_engine.build_state(db, game, p7_user)
            assert "rank" not in p7_state["your_player"]
            assert p7_state["your_player"]["rank_delta"] == -1

            p8_state = live_quiz_engine.build_state(db, game, p8_user)
            assert "rank" not in p8_state["your_player"]
            assert p8_state["your_player"]["rank_delta"] == 1
        finally:
            db.close()


# ---------------------------------------------------------------------------
# issue #3607 — 課堂搶答 (live_quiz) is OFF by default per classroom. Gated:
# (1) creating a game TARGETED at a classroom (classroom_id set), (2) the
# "class-based join without code" banner (students only ever see/discover a
# game through /api/live-quiz/invites, never by typing a code, when it's
# tied to a classroom), and (3) actually joining a class-tied game whose
# classroom has since had the feature turned off. A classless game
# (classroom_id=None, "code/QR-only") is NEVER gated — that's the explicit
# "code-based join for games not tied to a class keeps working" carve-out.
# Each negative case pairs with a positive control (rules/testing-strategy.md).
# ---------------------------------------------------------------------------

def _make_classroom_via_api(client, teacher, *, live_quiz: bool | None = None) -> int:
    resp = client.post(
        "/api/classrooms", json={"name": f"LQ Gate Room {uuid.uuid4().hex[:6]}", "school_id": _test_school_id},
        headers=auth_header(teacher["token"]),
    )
    assert resp.status_code == 201, resp.text
    classroom_id = resp.json()["id"]
    if live_quiz is not None:
        patched = client.patch(
            f"/api/classrooms/{classroom_id}/pk-settings", json={"live_quiz": live_quiz},
            headers=auth_header(teacher["token"]),
        )
        assert patched.status_code == 200, patched.text
    return classroom_id


class TestLiveQuizFeatureGate:
    def test_create_game_targeted_at_a_classroom_is_blocked_when_off(self, client, teacher):
        room_id = _make_classroom_via_api(client, teacher, live_quiz=False)
        resp = client.post(
            "/api/live-quiz/games",
            json={"lesson_uids": [LESSON_A], "classroom_id": room_id},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 403, resp.text
        assert "開放" in resp.json()["detail"]

    def test_create_game_targeted_at_a_brand_new_classroom_with_empty_settings_is_blocked(self, client, teacher):
        """No explicit key at all (== {}) behaves the same as explicit
        False — default OFF, not an implicit "undecided == on"."""
        room_id = _make_classroom_via_api(client, teacher, live_quiz=None)
        resp = client.post(
            "/api/live-quiz/games",
            json={"lesson_uids": [LESSON_A], "classroom_id": room_id},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 403, resp.text

    def test_create_game_targeted_at_a_classroom_succeeds_when_on(self, client, teacher):
        """Positive control for the two tests above."""
        room_id = _make_classroom_via_api(client, teacher, live_quiz=True)
        resp = client.post(
            "/api/live-quiz/games",
            json={"lesson_uids": [LESSON_A], "classroom_id": room_id},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201, resp.text

    def test_create_game_with_no_classroom_is_never_gated(self, client, teacher):
        """classroom_id omitted entirely ("不指定班級（只用代碼／QR 加入）")
        must always work regardless of any classroom's feature state —
        there is no classroom to gate against."""
        resp = client.post(
            "/api/live-quiz/games", json={"lesson_uids": [LESSON_A]}, headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201, resp.text

    def test_invite_banner_hides_games_from_a_disabled_classroom(self, client, teacher, student1):
        room_id = _make_classroom_via_api(client, teacher, live_quiz=True)
        client.post(
            f"/api/classrooms/{room_id}/students", json={"student_id": student1["user_id"]},
            headers=auth_header(teacher["token"]),
        )
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], classroom_id=room_id)

        # Visible while on.
        visible = client.get("/api/live-quiz/invites", headers=auth_header(student1["token"])).json()
        assert visible["invite"]["code"] == game["code"]

        # Teacher turns it off mid-session — the banner must stop surfacing it.
        off = client.patch(
            f"/api/classrooms/{room_id}/pk-settings", json={"live_quiz": False},
            headers=auth_header(teacher["token"]),
        )
        assert off.status_code == 200, off.text
        hidden = client.get("/api/live-quiz/invites", headers=auth_header(student1["token"])).json()
        assert hidden["invite"] is None

    def test_joining_a_class_tied_game_is_blocked_once_the_classroom_is_disabled(self, client, teacher, student2):
        """The explicit-code join endpoint is the same one the banner's
        link points at — if the classroom backing the game has since been
        turned off, the direct join call must 403 too, not just the banner
        discovery step."""
        room_id = _make_classroom_via_api(client, teacher, live_quiz=True)
        client.post(
            f"/api/classrooms/{room_id}/students", json={"student_id": student2["user_id"]},
            headers=auth_header(teacher["token"]),
        )
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], classroom_id=room_id)

        client.patch(
            f"/api/classrooms/{room_id}/pk-settings", json={"live_quiz": False},
            headers=auth_header(teacher["token"]),
        )

        resp = client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student2["token"]))
        assert resp.status_code == 403, resp.text
        assert "開放" in resp.json()["detail"]

    def test_joining_a_classless_game_by_code_is_never_gated(self, client, teacher, student1):
        """Positive control for the carve-out: a game with NO classroom_id
        is pure code/QR join and must always work, independent of any
        classroom's live_quiz state (there's nothing to check it against)."""
        game = _create_game(client, teacher, lesson_uids=[LESSON_A])  # classroom_id omitted
        resp = client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(student1["token"]))
        assert resp.status_code == 201, resp.text

    def test_a_classroom_with_real_live_quiz_history_but_no_key_is_treated_as_on(self, client, teacher, student1):
        """Backward compat (#3607): a classroom that already hosted a
        live-quiz game before this toggle existed, and has no explicit
        `live_quiz` key, must still be able to create (and students join) a
        NEW game — the feature was already in use."""
        room_id = _make_classroom_via_api(client, teacher, live_quiz=True)
        _create_game(client, teacher, lesson_uids=[LESSON_A], classroom_id=room_id)
        # Clear the key back to "never set" (simulating a pre-toggle
        # classroom whose only signal is real usage history) while keeping
        # the game that already exists for it.
        db = TestingSessionLocal()
        try:
            from app.models.school import Classroom

            room = db.query(Classroom).filter(Classroom.id == room_id).first()
            room.feature_settings = {}
            db.commit()
        finally:
            db.close()

        resp = client.post(
            "/api/live-quiz/games",
            json={"lesson_uids": [LESSON_A], "classroom_id": room_id},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201, resp.text


class TestRevealOptionCounts:
    """PRD §4 step 4: reveal shows how many players picked each option —
    host only, and only once the round is revealed (never during the
    question, which would hint the crowd's choice)."""

    def _play_round(self, client, teacher, student1, student2, student3):
        game = _create_game(client, teacher, lesson_uids=[LESSON_A], practice_mode=False)
        for s in (student1, student2, student3):
            client.post(f"/api/live-quiz/games/{game['code']}/join", headers=auth_header(s["token"]))
        client.post(f"/api/live-quiz/games/{game['code']}/start", headers=auth_header(teacher["token"]))
        db = TestingSessionLocal()
        try:
            row = live_quiz_engine.get_game_by_code(db, game["code"])
            payload = row.rounds_snapshot[0]["payload"]
            correct = payload["correct_key"]
            wrong = next(o["key"] for o in payload["options"] if o["key"] != correct)
        finally:
            db.close()
        for s, key in ((student1, correct), (student2, correct), (student3, wrong)):
            client.post(
                f"/api/live-quiz/games/{game['code']}/answer",
                json={"submission": {"choice_key": key}}, headers=auth_header(s["token"]),
            )
        return game, correct, wrong

    def test_host_sees_counts_per_option_after_reveal(self, client, teacher, student1, student2, student3):
        game, correct, wrong = self._play_round(client, teacher, student1, student2, student3)
        before = client.get(f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(teacher["token"])).json()
        assert "option_counts" not in before  # not during the question
        client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))
        state = client.get(f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(teacher["token"])).json()
        counts = state["option_counts"]
        assert counts[correct] == 2
        assert counts[wrong] == 1
        assert sum(counts.values()) == 3
        option_keys = {o["key"] for o in state["round"]["options"]}
        assert set(counts) == option_keys  # every option present, zero if nobody picked it

    def test_players_never_see_option_counts(self, client, teacher, student1, student2, student3):
        game, _, _ = self._play_round(client, teacher, student1, student2, student3)
        client.post(f"/api/live-quiz/games/{game['code']}/reveal", headers=auth_header(teacher["token"]))
        state = client.get(f"/api/live-quiz/games/{game['code']}/state", headers=auth_header(student1["token"])).json()
        assert "option_counts" not in state


class TestMemberByCodeResolvesNewestGame:
    """#3647: codes are reused once a game ends. The rate-limit exemption
    check must resolve a code to the SAME game the route does (newest row),
    not to every game that ever used it."""

    def test_old_game_member_is_not_member_of_reused_code(self, client, teacher, student1, student2):
        old = _create_game(client, teacher, lesson_uids=[LESSON_A])
        client.post(f"/api/live-quiz/games/{old['code']}/join", headers=auth_header(student1["token"]))
        client.post(f"/api/live-quiz/games/{old['code']}/end", headers=auth_header(teacher["token"]))
        new = _create_game(client, teacher, lesson_uids=[LESSON_A])
        db = TestingSessionLocal()
        try:
            new_row = live_quiz_engine.get_game_by_code(db, new["code"])
            new_row.code = old["code"]  # simulate the code being reused
            db.commit()
        finally:
            db.close()
        client.post(f"/api/live-quiz/games/{old['code']}/join", headers=auth_header(student2["token"]))
        db = TestingSessionLocal()
        try:
            # student1 only joined the ENDED game that used this code before
            assert live_quiz_engine.is_authenticated_member_by_code(db, old["code"], student1["user_id"]) is False
            # positive control: student2 joined the current game
            assert live_quiz_engine.is_authenticated_member_by_code(db, old["code"], student2["user_id"]) is True
            assert live_quiz_engine.is_authenticated_member_by_code(db, old["code"].lower(), student2["user_id"]) is True
        finally:
            db.close()
