"""Route-level authz tests for /api/pk/* and /api/classrooms/{id}/pk-activity
— Issue #3586.

Every id a caller supplies (path OR body) must be bound to the caller:
- classroom_id in POST /api/pk/queue, /api/pk/invite, /api/pk/challenge-ai
  body -> 403 unless the caller is actually enrolled.
- queue_id / match_id path params -> 403 unless the caller owns/participates.
- invite_code in POST /api/pk/queue body -> redemption re-validates
  classroom membership against the INVITE's own classroom, not the caller's
  claim.

Each authz test uses the LOWEST-privilege account for the role under test
(a bare registered+student-roled account, nothing elevated) and pairs every
negative assertion with a positive control (the legitimate owner CAN do the
same call) — a 403 proves nothing if the route would 403 everyone.
"""
from __future__ import annotations

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
from app.database import get_db
from app.models import Base
from app.models.user import Role, UserRole
from app.models.school import Classroom, ClassroomStudent, ClassroomTeacher, School

LESSON_A = "L0125"

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

_school_id = 0
_room_a_id = 0  # the classroom under test
_room_b_id = 0  # a DIFFERENT classroom, for cross-classroom negative tests


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _school_id, _room_a_id, _room_b_id
    Base.metadata.create_all(bind=engine_db)
    session = TestingSessionLocal()
    for r in SEED_ROLES:
        session.add(Role(**r))
    school = School(name="PK Route Test School")
    session.add(school)
    session.commit()
    _school_id = school.id

    teacher_owner = _bootstrap_user(session, "pk_route_owner_teacher")
    teacher_other = _bootstrap_user(session, "pk_route_other_teacher")
    # This file tests authz boundaries (who can join/invite/poll/answer),
    # not the pk_human feature gate itself (that's test_pk_matchmaking.py's
    # TestPkHumanFeatureGate) — so both rooms start with it pre-enabled,
    # otherwise every queue/invite call below 403s on the gate before ever
    # reaching the authz check it's meant to exercise.
    room_a = Classroom(
        school_id=_school_id, teacher_id=teacher_owner.id, name="room A", grade=4,
        feature_settings={"pk_human": True},
    )
    room_b = Classroom(
        school_id=_school_id, teacher_id=teacher_other.id, name="room B", grade=4,
        feature_settings={"pk_human": True},
    )
    session.add_all([room_a, room_b])
    session.commit()
    _room_a_id = room_a.id
    _room_b_id = room_b.id
    session.close()

    app.dependency_overrides[get_db] = _override_get_db

    import app.database as app_database
    original_session_local = app_database.SessionLocal
    app_database.SessionLocal = TestingSessionLocal

    from app.routes.auth import rate_limiter
    rate_limiter.reset()

    yield

    app_database.SessionLocal = original_session_local
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine_db)


def _bootstrap_user(session, name):
    """Used only during module setup (teachers that own the two classrooms)
    — real per-test users go through the HTTP register flow below so their
    tokens are real JWTs from the real auth stack, not a shortcut."""
    from app.models.user import User

    unique = uuid.uuid4().hex[:8]
    u = User(email=f"{name}_{unique}@example.com", password_hash="x", name=name)
    session.add(u)
    session.commit()
    return u


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_student(client) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"pk_stu_{unique}@example.com"
    password = "SecurePass123!"
    name = f"PK Student {unique}"
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

    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == "student").first()
        db.add(UserRole(user_id=user_id, role_id=role.id, scope_type="school", scope_id=str(_school_id)))
        db.commit()
    finally:
        db.close()
    return {"token": token, "user_id": user_id}


def _enroll(student_user_id: int, classroom_id: int) -> None:
    db = TestingSessionLocal()
    try:
        db.add(ClassroomStudent(classroom_id=classroom_id, student_id=student_user_id))
        db.commit()
    finally:
        db.close()


@pytest.fixture()
def student_in_room_a(client):
    s = _register_student(client)
    _enroll(s["user_id"], _room_a_id)
    return s


@pytest.fixture()
def another_student_in_room_a(client):
    s = _register_student(client)
    _enroll(s["user_id"], _room_a_id)
    return s


@pytest.fixture()
def student_in_room_b(client):
    s = _register_student(client)
    _enroll(s["user_id"], _room_b_id)
    return s


@pytest.fixture()
def unenrolled_student(client):
    """A real, lowest-privilege account enrolled nowhere — the strictest
    negative-control identity."""
    return _register_student(client)


# ---------------------------------------------------------------------------
# POST /api/pk/queue — classroom_id body binding
# ---------------------------------------------------------------------------

class TestJoinQueueClassroomBinding:
    def test_member_can_join_queue_for_their_own_classroom(self, client, student_in_room_a):
        resp = client.post(
            "/api/pk/queue",
            json={"scope_type": "grade_pool", "scope_ref": "4", "classroom_id": _room_a_id},
            headers=auth_header(student_in_room_a["token"]),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "waiting"

    def test_non_member_cannot_tag_a_classroom_they_are_not_in(self, client, unenrolled_student):
        resp = client.post(
            "/api/pk/queue",
            json={"scope_type": "grade_pool", "scope_ref": "4", "classroom_id": _room_a_id},
            headers=auth_header(unenrolled_student["token"]),
        )
        assert resp.status_code == 403, resp.text

    def test_student_of_a_DIFFERENT_classroom_cannot_tag_room_a(self, client, student_in_room_b):
        resp = client.post(
            "/api/pk/queue",
            json={"scope_type": "grade_pool", "scope_ref": "4", "classroom_id": _room_a_id},
            headers=auth_header(student_in_room_b["token"]),
        )
        assert resp.status_code == 403, resp.text

    def test_unauthenticated_request_is_rejected(self, client):
        resp = client.post(
            "/api/pk/queue",
            json={"scope_type": "grade_pool", "scope_ref": "4", "classroom_id": _room_a_id},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/pk/queue/{id}/poll, POST /cancel — path id binding
# ---------------------------------------------------------------------------

class TestQueueIdBinding:
    def test_owner_can_poll_their_own_queue_entry(self, client, student_in_room_a):
        create = client.post(
            "/api/pk/queue",
            json={"scope_type": "grade_pool", "scope_ref": "4", "classroom_id": _room_a_id},
            headers=auth_header(student_in_room_a["token"]),
        )
        queue_id = create.json()["queue_id"]
        resp = client.get(f"/api/pk/queue/{queue_id}/poll", headers=auth_header(student_in_room_a["token"]))
        assert resp.status_code == 200, resp.text

    def test_a_different_student_cannot_poll_someone_elses_queue_entry(
        self, client, student_in_room_a, another_student_in_room_a
    ):
        create = client.post(
            "/api/pk/queue",
            json={"scope_type": "grade_pool", "scope_ref": "4", "classroom_id": _room_a_id},
            headers=auth_header(student_in_room_a["token"]),
        )
        queue_id = create.json()["queue_id"]
        resp = client.get(
            f"/api/pk/queue/{queue_id}/poll", headers=auth_header(another_student_in_room_a["token"])
        )
        assert resp.status_code == 403, resp.text

    def test_a_different_student_cannot_cancel_someone_elses_queue_entry(
        self, client, student_in_room_a, another_student_in_room_a
    ):
        create = client.post(
            "/api/pk/queue",
            json={"scope_type": "grade_pool", "scope_ref": "4", "classroom_id": _room_a_id},
            headers=auth_header(student_in_room_a["token"]),
        )
        queue_id = create.json()["queue_id"]
        resp = client.post(
            f"/api/pk/queue/{queue_id}/cancel", headers=auth_header(another_student_in_room_a["token"])
        )
        assert resp.status_code == 403, resp.text
        # Positive control: the actual owner CAN cancel it.
        resp2 = client.post(
            f"/api/pk/queue/{queue_id}/cancel", headers=auth_header(student_in_room_a["token"])
        )
        assert resp2.status_code == 204, resp2.text

    def test_unknown_queue_id_is_404_not_500(self, client, student_in_room_a):
        resp = client.get("/api/pk/queue/999999999/poll", headers=auth_header(student_in_room_a["token"]))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/pk/invite — classroom_id required + bound
# ---------------------------------------------------------------------------

class TestCreateInviteBinding:
    def test_member_can_create_invite(self, client, student_in_room_a):
        resp = client.post(
            "/api/pk/invite",
            json={"scope_type": "lesson", "scope_ref": LESSON_A, "classroom_id": _room_a_id},
            headers=auth_header(student_in_room_a["token"]),
        )
        assert resp.status_code == 201, resp.text
        assert len(resp.json()["invite_code"]) == 6

    def test_non_member_cannot_create_invite_for_room_a(self, client, student_in_room_b):
        resp = client.post(
            "/api/pk/invite",
            json={"scope_type": "lesson", "scope_ref": LESSON_A, "classroom_id": _room_a_id},
            headers=auth_header(student_in_room_b["token"]),
        )
        assert resp.status_code == 403, resp.text


class TestRedeemInviteBinding:
    def test_student_from_a_different_classroom_cannot_redeem(
        self, client, student_in_room_a, student_in_room_b
    ):
        invite = client.post(
            "/api/pk/invite",
            json={"scope_type": "lesson", "scope_ref": LESSON_A, "classroom_id": _room_a_id},
            headers=auth_header(student_in_room_a["token"]),
        ).json()
        resp = client.post(
            "/api/pk/queue",
            json={
                "scope_type": "lesson",
                "scope_ref": LESSON_A,
                "invite_code": invite["invite_code"],
            },
            headers=auth_header(student_in_room_b["token"]),
        )
        assert resp.status_code == 403, resp.text

    def test_classmate_can_redeem(self, client, student_in_room_a, another_student_in_room_a):
        invite = client.post(
            "/api/pk/invite",
            json={"scope_type": "lesson", "scope_ref": LESSON_A, "classroom_id": _room_a_id},
            headers=auth_header(student_in_room_a["token"]),
        ).json()
        resp = client.post(
            "/api/pk/queue",
            json={
                "scope_type": "lesson",
                "scope_ref": LESSON_A,
                "invite_code": invite["invite_code"],
            },
            headers=auth_header(another_student_in_room_a["token"]),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "matched"
        assert resp.json()["match_id"] is not None


# ---------------------------------------------------------------------------
# POST /api/pk/challenge-ai + match id binding + answer stripping over HTTP
# ---------------------------------------------------------------------------

class TestChallengeAiAndMatchBinding:
    def test_non_member_cannot_tag_a_classroom_on_an_ai_match(self, client, unenrolled_student):
        resp = client.post(
            "/api/pk/challenge-ai",
            json={
                "scope_type": "lesson",
                "scope_ref": LESSON_A,
                "bot_tier": 1,
                "classroom_id": _room_a_id,
            },
            headers=auth_header(unenrolled_student["token"]),
        )
        assert resp.status_code == 403, resp.text

    def test_member_can_challenge_ai_and_only_they_can_see_the_match(self, client, student_in_room_a, another_student_in_room_a):
        resp = client.post(
            "/api/pk/challenge-ai",
            json={
                "scope_type": "lesson",
                "scope_ref": LESSON_A,
                "bot_tier": 3,
                "classroom_id": _room_a_id,
            },
            headers=auth_header(student_in_room_a["token"]),
        )
        assert resp.status_code == 201, resp.text
        match_id = resp.json()["match_id"]

        state = client.get(f"/api/pk/matches/{match_id}/state", headers=auth_header(student_in_room_a["token"]))
        assert state.status_code == 200, state.text
        assert "correct_key" not in state.json()["round"]  # not revealed yet

        intruder = client.get(
            f"/api/pk/matches/{match_id}/state", headers=auth_header(another_student_in_room_a["token"])
        )
        assert intruder.status_code == 403, intruder.text

    def test_bot_tier_out_of_range_is_422(self, client, student_in_room_a):
        resp = client.post(
            "/api/pk/challenge-ai",
            json={"scope_type": "lesson", "scope_ref": LESSON_A, "bot_tier": 8, "classroom_id": _room_a_id},
            headers=auth_header(student_in_room_a["token"]),
        )
        assert resp.status_code == 422

    def test_a_different_student_cannot_submit_an_answer_to_someone_elses_match(
        self, client, student_in_room_a, another_student_in_room_a
    ):
        match_id = client.post(
            "/api/pk/challenge-ai",
            json={"scope_type": "lesson", "scope_ref": LESSON_A, "bot_tier": 1, "classroom_id": _room_a_id},
            headers=auth_header(student_in_room_a["token"]),
        ).json()["match_id"]
        resp = client.post(
            f"/api/pk/matches/{match_id}/answer",
            json={"choice_key": "A"},
            headers=auth_header(another_student_in_room_a["token"]),
        )
        assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# GET /api/classrooms/{id}/pk-activity — teacher ownership
# ---------------------------------------------------------------------------

def _register_teacher(client) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"pk_teacher_{unique}@example.com"
    password = "SecurePass123!"
    name = f"PK Teacher {unique}"
    resp = client.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    assert resp.status_code == 201, resp.text
    token_v = resp.json().get("verification_token")
    if token_v:
        v = client.get(f"/api/auth/verify-email?token={token_v}")
        assert v.status_code == 200
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login.json()["access_token"]
    user_id = client.get("/api/users/me", headers=auth_header(token)).json()["id"]
    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == "teacher").first()
        db.add(UserRole(user_id=user_id, role_id=role.id, scope_type="school", scope_id=str(_school_id)))
        db.commit()
    finally:
        db.close()
    return {"token": token, "user_id": user_id}


class TestClassroomPkActivity:
    def test_owner_teacher_can_view_their_own_classroom(self, client):
        teacher = _register_teacher(client)
        db = TestingSessionLocal()
        try:
            room = Classroom(school_id=_school_id, teacher_id=teacher["user_id"], name="own room", grade=4)
            db.add(room)
            db.commit()
            room_id = room.id
        finally:
            db.close()

        resp = client.get(f"/api/classrooms/{room_id}/pk-activity", headers=auth_header(teacher["token"]))
        assert resp.status_code == 200, resp.text
        assert resp.json()["classroom_id"] == room_id

    def test_a_different_teacher_cannot_view_room_a(self, client):
        other_teacher = _register_teacher(client)
        resp = client.get(
            f"/api/classrooms/{_room_a_id}/pk-activity", headers=auth_header(other_teacher["token"])
        )
        assert resp.status_code == 403, resp.text

    def test_unauthenticated_request_is_rejected(self, client):
        resp = client.get(f"/api/classrooms/{_room_a_id}/pk-activity")
        assert resp.status_code == 401

    def test_student_cannot_view_teacher_activity_endpoint(self, client, student_in_room_a):
        resp = client.get(
            f"/api/classrooms/{_room_a_id}/pk-activity", headers=auth_header(student_in_room_a["token"])
        )
        assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# PATCH /api/classrooms/{id}/pk-settings — teacher-only 真人 PK toggle,
# issue #3586 §7.4 final revision (2026-10-16). Lowest-privilege accounts +
# positive controls per rule in rules/testing-strategy.md.
# ---------------------------------------------------------------------------

class TestClassroomPkSettings:
    def test_owner_teacher_can_turn_pk_human_on_and_it_persists(self, client):
        teacher = _register_teacher(client)
        db = TestingSessionLocal()
        try:
            room = Classroom(school_id=_school_id, teacher_id=teacher["user_id"], name="settings room", grade=4)
            db.add(room)
            db.commit()
            room_id = room.id
        finally:
            db.close()

        # brand-new classroom: GET must report the default (False) BEFORE
        # any PATCH, not omit the field.
        before = client.get(f"/api/classrooms/{room_id}", headers=auth_header(teacher["token"]))
        assert before.status_code == 200, before.text
        assert before.json()["pk_human"] is False

        patched = client.patch(
            f"/api/classrooms/{room_id}/pk-settings",
            json={"pk_human": True},
            headers=auth_header(teacher["token"]),
        )
        assert patched.status_code == 200, patched.text
        # issue #3607: the response now reports all three switches, not
        # just the one touched — league/live_quiz stay at their default
        # (False) since this room has no history for either.
        assert patched.json() == {"pk_human": True, "league": False, "live_quiz": False, "team_arena": False}

        after = client.get(f"/api/classrooms/{room_id}", headers=auth_header(teacher["token"]))
        assert after.status_code == 200, after.text
        assert after.json()["pk_human"] is True

        # and back off again — same endpoint, same shape.
        off = client.patch(
            f"/api/classrooms/{room_id}/pk-settings",
            json={"pk_human": False},
            headers=auth_header(teacher["token"]),
        )
        assert off.status_code == 200, off.text
        assert off.json() == {"pk_human": False, "league": False, "live_quiz": False, "team_arena": False}

    def test_a_different_teacher_cannot_toggle_room_a(self, client):
        other_teacher = _register_teacher(client)
        resp = client.patch(
            f"/api/classrooms/{_room_a_id}/pk-settings",
            json={"pk_human": True},
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403, resp.text

    def test_student_cannot_toggle_room_a(self, client, student_in_room_a):
        resp = client.patch(
            f"/api/classrooms/{_room_a_id}/pk-settings",
            json={"pk_human": True},
            headers=auth_header(student_in_room_a["token"]),
        )
        assert resp.status_code == 403, resp.text

    def test_unauthenticated_request_is_rejected(self, client):
        resp = client.patch(f"/api/classrooms/{_room_a_id}/pk-settings", json={"pk_human": True})
        assert resp.status_code == 401

    def test_non_boolean_value_is_rejected(self, client):
        teacher = _register_teacher(client)
        db = TestingSessionLocal()
        try:
            room = Classroom(school_id=_school_id, teacher_id=teacher["user_id"], name="bad value room", grade=4)
            db.add(room)
            db.commit()
            room_id = room.id
        finally:
            db.close()
        resp = client.patch(
            f"/api/classrooms/{room_id}/pk-settings",
            json={"pk_human": "not-a-bool"},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 422, resp.text

    def test_patch_only_touches_pk_human_other_settings_keys_survive(self, client):
        """Regression lock for the merge-not-overwrite behavior documented
        in classroom_pk_activity.update_pk_settings: a classroom that
        already has an (unrecognized, hypothetical future) key in
        feature_settings must not lose it when pk_human is patched."""
        teacher = _register_teacher(client)
        db = TestingSessionLocal()
        try:
            room = Classroom(
                school_id=_school_id,
                teacher_id=teacher["user_id"],
                name="merge room",
                grade=4,
                feature_settings={"some_future_key": "untouched"},
            )
            db.add(room)
            db.commit()
            room_id = room.id
        finally:
            db.close()

        resp = client.patch(
            f"/api/classrooms/{room_id}/pk-settings",
            json={"pk_human": True},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text

        db = TestingSessionLocal()
        try:
            room = db.query(Classroom).filter(Classroom.id == room_id).first()
            assert room.feature_settings == {"some_future_key": "untouched", "pk_human": True}
        finally:
            db.close()


# ---------------------------------------------------------------------------
# PATCH /api/classrooms/{id}/pk-settings — issue #3607 extension: the same
# endpoint now also carries `league` and `live_quiz`. These tests cover the
# three-switch surface specifically (independent toggling + per-key merge);
# TestClassroomPkSettings above still covers the original pk_human-only
# authz/validation matrix, which is unchanged.
# ---------------------------------------------------------------------------

class TestClassroomFeatureSettingsThreeSwitches:
    def _room(self, client, teacher, *, feature_settings=None):
        db = TestingSessionLocal()
        try:
            kwargs = {}
            if feature_settings is not None:
                kwargs["feature_settings"] = feature_settings
            room = Classroom(
                school_id=_school_id, teacher_id=teacher["user_id"], name="3-switch room", grade=4, **kwargs
            )
            db.add(room)
            db.commit()
            return room.id
        finally:
            db.close()

    def test_a_brand_new_classroom_reports_all_three_off(self, client):
        teacher = _register_teacher(client)
        room_id = self._room(client, teacher)
        resp = client.get(f"/api/classrooms/{room_id}", headers=auth_header(teacher["token"]))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["pk_human"] is False
        assert body["league"] is False
        assert body["live_quiz"] is False

    def test_toggling_league_alone_does_not_touch_pk_human_or_live_quiz(self, client):
        teacher = _register_teacher(client)
        room_id = self._room(client, teacher, feature_settings={"pk_human": True, "live_quiz": True})
        resp = client.patch(
            f"/api/classrooms/{room_id}/pk-settings",
            json={"league": True},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"pk_human": True, "league": True, "live_quiz": True, "team_arena": False}

    def test_toggling_live_quiz_off_does_not_revert_a_classroom_that_had_no_key_but_real_history(self, client):
        """Backward-compat (#3607): a classroom with real live-quiz history
        and NO explicit key reports True (legacy fallback). Explicitly
        turning league on must not disturb that live_quiz fallback."""
        teacher = _register_teacher(client)
        room_id = self._room(client, teacher)  # feature_settings == {}
        db = TestingSessionLocal()
        try:
            from datetime import datetime, timedelta, timezone
            from app.models.live_quiz import LiveQuizGame

            now = datetime.now(timezone.utc)
            db.add(
                LiveQuizGame(
                    code="998877", host_teacher_id=teacher["user_id"], classroom_id=room_id,
                    status="ended", settings={}, rounds_snapshot=[], seed=1, version=1,
                    created_at=now, expires_at=now + timedelta(hours=3),
                )
            )
            db.commit()
        finally:
            db.close()

        before = client.get(f"/api/classrooms/{room_id}", headers=auth_header(teacher["token"]))
        assert before.json()["live_quiz"] is True  # legacy fallback, no key written yet

        resp = client.patch(
            f"/api/classrooms/{room_id}/pk-settings",
            json={"league": True},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"pk_human": False, "league": True, "live_quiz": True, "team_arena": False}

    def test_a_different_teacher_cannot_toggle_league_or_live_quiz(self, client):
        teacher = _register_teacher(client)
        room_id = self._room(client, teacher)
        other_teacher = _register_teacher(client)
        resp = client.patch(
            f"/api/classrooms/{room_id}/pk-settings",
            json={"league": True, "live_quiz": True},
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403, resp.text

    def test_student_cannot_toggle_league_or_live_quiz(self, client, student_in_room_a):
        resp = client.patch(
            f"/api/classrooms/{_room_a_id}/pk-settings",
            json={"league": True},
            headers=auth_header(student_in_room_a["token"]),
        )
        assert resp.status_code == 403, resp.text
