"""Route-level tests for /api/league/* — the invitation authorization
matrix (owner-only, same-org-only, revoked/expired rejected, double-accept
idempotent) at the HTTP boundary, and the PRIVACY CONTRACT required by the
2026-10-15 spec: every league endpoint response must not contain the
name / email / user_id / student_id of any student outside the viewer's
own team/class, nor any other classroom's teacher name.

Pattern follows tests/test_co_teaching_api.py: real register/login gives a
real JWT exercised through the real auth dependency; supporting entities
(schools/classrooms/orgs/enrollments/lesson completions) are seeded
directly via the DB session.
"""
from __future__ import annotations

import json
import sys
import os
import uuid
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
from app.models.league import LeagueInvitation, LeagueSeason, LeagueTeam
from app.models.organization import Organization
from app.models.school import Classroom, ClassroomStudent, ClassroomTeacher, School
from app.models.session import LearningSession
from app.models.user import User

engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)


@event.listens_for(engine, "connect")
def _fk(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def _setup_module():
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _register(client, *, name="User") -> tuple[str, int]:
    # Email local-part is always ASCII/random — independent of `name` (which
    # may be Chinese, used only for the PII-leak assertions) to avoid
    # EmailStr validation quirks with non-ASCII local parts.
    email = f"user{uuid.uuid4().hex[:12]}@test.com"
    password = "Password123!"
    r = client.post(
        "/api/auth/register", json={"name": name, "email": email, "password": password}
    )
    assert r.status_code in (200, 201), r.text
    verification_token = r.json().get("verification_token")
    if verification_token:
        v = client.get(f"/api/auth/verify-email?token={verification_token}")
        assert v.status_code == 200, v.text
    login_r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_r.status_code == 200, login_r.text
    token = login_r.json()["access_token"]
    me = client.get("/api/users/me", headers=_h(token))
    assert me.status_code == 200, me.text
    return token, me.json()["id"]


def _make_org(db) -> Organization:
    org = Organization(name=f"機構-{uuid.uuid4().hex[:6]}")
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def _make_school(db, org: Organization | None) -> School:
    school = School(name=f"學校-{uuid.uuid4().hex[:6]}", organization_id=org.id if org else None)
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


def _make_classroom(db, school: School, teacher_id: int, *, grade: int = 5) -> Classroom:
    classroom = Classroom(
        school_id=school.id, teacher_id=teacher_id, name=f"班級-{uuid.uuid4().hex[:6]}", grade=grade
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)
    db.add(ClassroomTeacher(classroom_id=classroom.id, teacher_id=teacher_id, role="primary"))
    db.commit()
    return classroom


def _enroll(db, classroom: Classroom, student_id: int):
    db.add(ClassroomStudent(classroom_id=classroom.id, student_id=student_id))
    db.commit()


def _complete_lesson(db, student_id, story_slug, *, started_at, completed_at, mode="assignment"):
    session = LearningSession(
        student_id=student_id, status="completed", session_mode=mode,
        story_slug=story_slug, started_at=started_at, completed_at=completed_at,
    )
    db.add(session)
    db.commit()


NOW = datetime.now(timezone.utc)


def _invite_payload(classroom_id, grade=5, start=None, end=None):
    return {
        "inviter_classroom_id": classroom_id,
        "inviter_team_grade": grade,
        "game_start": (start or NOW + timedelta(days=1)).isoformat(),
        "game_end": (end or NOW + timedelta(days=2)).isoformat(),
    }


class TestInvitationAuthzMatrix:
    def test_requires_auth(self, client):
        r = client.post("/api/league/invitations", json={})
        assert r.status_code == 401

    def test_non_owner_cannot_create_invitation(self, client, db):
        org = _make_org(db)
        school = _make_school(db, org)
        owner_token, owner_id = _register(client, name="Owner1")
        classroom = _make_classroom(db, school, owner_id)
        stranger_token, _ = _register(client, name="Stranger1")

        r = client.post(
            "/api/league/invitations", json=_invite_payload(classroom.id), headers=_h(stranger_token)
        )
        assert r.status_code == 403

    def test_assistant_co_teacher_cannot_create_invitation(self, client, db):
        org = _make_org(db)
        school = _make_school(db, org)
        owner_token, owner_id = _register(client, name="Owner2")
        classroom = _make_classroom(db, school, owner_id)
        assistant_token, assistant_id = _register(client, name="Assistant1")
        db.add(ClassroomTeacher(classroom_id=classroom.id, teacher_id=assistant_id, role="assistant"))
        db.commit()

        r = client.post(
            "/api/league/invitations", json=_invite_payload(classroom.id), headers=_h(assistant_token)
        )
        assert r.status_code == 403

    def test_owner_can_create_invitation(self, client, db):
        org = _make_org(db)
        school = _make_school(db, org)
        owner_token, owner_id = _register(client, name="Owner3")
        classroom = _make_classroom(db, school, owner_id)

        r = client.post(
            "/api/league/invitations", json=_invite_payload(classroom.id), headers=_h(owner_token)
        )
        assert r.status_code == 201, r.text
        assert r.json()["status"] == "pending"
        assert len(r.json()["code"]) == 8

    def test_cross_org_accept_is_denied(self, client, db):
        org_a = _make_org(db)
        school_a = _make_school(db, org_a)
        owner_a_token, owner_a_id = _register(client, name="OwnerA1")
        classroom_a = _make_classroom(db, school_a, owner_a_id)
        created = client.post(
            "/api/league/invitations", json=_invite_payload(classroom_a.id), headers=_h(owner_a_token)
        ).json()

        org_b = _make_org(db)  # a DIFFERENT org
        school_b = _make_school(db, org_b)
        owner_b_token, owner_b_id = _register(client, name="OwnerB1")
        classroom_b = _make_classroom(db, school_b, owner_b_id)

        r = client.post(
            f"/api/league/invitations/{created['code']}/accept",
            json={"invitee_classroom_id": classroom_b.id, "invitee_team_grade": 5},
            headers=_h(owner_b_token),
        )
        assert r.status_code == 403

    def test_owner_accept_creates_season_and_double_accept_is_idempotent(self, client, db):
        org = _make_org(db)
        school = _make_school(db, org)
        owner_a_token, owner_a_id = _register(client, name="OwnerA2")
        owner_b_token, owner_b_id = _register(client, name="OwnerB2")
        classroom_a = _make_classroom(db, school, owner_a_id)
        classroom_b = _make_classroom(db, school, owner_b_id)
        created = client.post(
            "/api/league/invitations", json=_invite_payload(classroom_a.id), headers=_h(owner_a_token)
        ).json()

        first = client.post(
            f"/api/league/invitations/{created['code']}/accept",
            json={"invitee_classroom_id": classroom_b.id, "invitee_team_grade": 5},
            headers=_h(owner_b_token),
        )
        assert first.status_code == 200, first.text
        assert first.json()["status"] == "accepted"

        second = client.post(
            f"/api/league/invitations/{created['code']}/accept",
            json={"invitee_classroom_id": classroom_b.id, "invitee_team_grade": 5},
            headers=_h(owner_b_token),
        )
        assert second.status_code == 200
        assert second.json() == first.json()  # idempotent, no duplicate season

    def test_revoked_invitation_cannot_be_accepted(self, client, db):
        org = _make_org(db)
        school = _make_school(db, org)
        owner_a_token, owner_a_id = _register(client, name="OwnerA3")
        owner_b_token, owner_b_id = _register(client, name="OwnerB3")
        classroom_a = _make_classroom(db, school, owner_a_id)
        classroom_b = _make_classroom(db, school, owner_b_id)
        created = client.post(
            "/api/league/invitations", json=_invite_payload(classroom_a.id), headers=_h(owner_a_token)
        ).json()

        revoke = client.post(
            f"/api/league/invitations/{created['id']}/revoke", headers=_h(owner_a_token)
        )
        assert revoke.status_code == 200
        assert revoke.json()["status"] == "revoked"

        accept = client.post(
            f"/api/league/invitations/{created['code']}/accept",
            json={"invitee_classroom_id": classroom_b.id, "invitee_team_grade": 5},
            headers=_h(owner_b_token),
        )
        assert accept.status_code == 409

    def test_expired_invitation_cannot_be_accepted(self, client, db):
        org = _make_org(db)
        school = _make_school(db, org)
        owner_a_token, owner_a_id = _register(client, name="OwnerA4")
        owner_b_token, owner_b_id = _register(client, name="OwnerB4")
        classroom_a = _make_classroom(db, school, owner_a_id)
        classroom_b = _make_classroom(db, school, owner_b_id)
        created = client.post(
            "/api/league/invitations",
            json=_invite_payload(
                classroom_a.id, start=NOW - timedelta(minutes=1), end=NOW + timedelta(days=1)
            ),
            headers=_h(owner_a_token),
        ).json()

        accept = client.post(
            f"/api/league/invitations/{created['code']}/accept",
            json={"invitee_classroom_id": classroom_b.id, "invitee_team_grade": 5},
            headers=_h(owner_b_token),
        )
        assert accept.status_code == 409

    def test_list_invitations_requires_classroom_ownership(self, client, db):
        # Unlike create/accept, list_invitations_for_classroom has NO
        # redundant ownership check in the service layer — this endpoint's
        # authorization lives ENTIRELY in the route's _require_owner_strict,
        # so this is the test that actually isolates that guard.
        org = _make_org(db)
        school = _make_school(db, org)
        owner_token, owner_id = _register(client, name="Owner6")
        classroom = _make_classroom(db, school, owner_id)
        client.post(
            "/api/league/invitations", json=_invite_payload(classroom.id), headers=_h(owner_token)
        )

        stranger_token, _ = _register(client, name="Stranger3")
        denied = client.get(
            f"/api/league/invitations?classroom_id={classroom.id}", headers=_h(stranger_token)
        )
        assert denied.status_code == 403

        allowed = client.get(
            f"/api/league/invitations?classroom_id={classroom.id}", headers=_h(owner_token)
        )
        assert allowed.status_code == 200
        assert len(allowed.json()) == 1

    def test_only_invitee_owner_can_accept(self, client, db):
        org = _make_org(db)
        school = _make_school(db, org)
        owner_a_token, owner_a_id = _register(client, name="OwnerA5")
        owner_b_token, owner_b_id = _register(client, name="OwnerB5")
        classroom_a = _make_classroom(db, school, owner_a_id)
        classroom_b = _make_classroom(db, school, owner_b_id)
        created = client.post(
            "/api/league/invitations", json=_invite_payload(classroom_a.id), headers=_h(owner_a_token)
        ).json()

        stranger_token, _ = _register(client, name="Stranger2")
        r = client.post(
            f"/api/league/invitations/{created['code']}/accept",
            json={"invitee_classroom_id": classroom_b.id, "invitee_team_grade": 5},
            headers=_h(stranger_token),
        )
        assert r.status_code == 403


class TestInvitationPreview:
    def test_preview_shows_classroom_name_but_not_teacher_name(self, client, db):
        org = _make_org(db)
        school = _make_school(db, org)
        owner_token, owner_id = _register(client, name="秘密老師王大明")
        classroom = _make_classroom(db, school, owner_id, grade=5)
        created = client.post(
            "/api/league/invitations", json=_invite_payload(classroom.id), headers=_h(owner_token)
        ).json()

        viewer_token, _ = _register(client, name="Viewer1")
        r = client.get(f"/api/league/invitations/{created['code']}/preview", headers=_h(viewer_token))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["inviter_classroom_name"] == classroom.name
        assert body["status"] == "pending"
        assert "秘密老師王大明" not in r.text
        assert "teacher" not in r.text.lower()

    def test_preview_requires_auth(self, client):
        r = client.get("/api/league/invitations/NOPECODE/preview")
        assert r.status_code == 401

    def test_preview_unknown_code_404(self, client):
        owner_token, _ = _register(client, name="Owner7")
        r = client.get("/api/league/invitations/NOPECODE/preview", headers=_h(owner_token))
        assert r.status_code == 404


class TestMyHistoryParentAccess:
    def test_unlinked_user_cannot_view_another_students_history(self, client, db):
        student_token, student_id = _register(client, name="Student1")
        other_token, _ = _register(client, name="Other1")
        r = client.get(f"/api/league/my-history?student_id={student_id}", headers=_h(other_token))
        assert r.status_code == 403

    def test_linked_parent_can_view_childs_history(self, client, db):
        from app.models.parent_link import ParentStudentLink

        student_token, student_id = _register(client, name="Student2")
        parent_token, parent_id = _register(client, name="Parent1")
        db.add(ParentStudentLink(parent_id=parent_id, student_id=student_id, is_active=True))
        db.commit()

        r = client.get(f"/api/league/my-history?student_id={student_id}", headers=_h(parent_token))
        assert r.status_code == 200
        assert r.json() == []  # no seasons yet, but access itself is allowed


def _id_like_values(obj):
    """Every value stored under an id-like key (`id`, `*_id`) anywhere in a
    parsed JSON body. Student ids are small ints, so a substring search of the
    raw text matched points/averages/roster sizes that merely contain the same
    digits (e.g. id 5 inside 12.5) — once scoring produced non-zero numbers."""
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "id" or k.endswith("_id"):
                out.append(v)
            out += _id_like_values(v)
    elif isinstance(obj, list):
        for v in obj:
            out += _id_like_values(v)
    return out


class TestPrivacyContract:
    """The 2026-10-15 mandate: no league response may leak a student's
    name/email/user_id/student_id outside the viewer's own team/class, nor
    another classroom's teacher name."""

    def _full_match(self, client, db):
        org = _make_org(db)
        school = _make_school(db, org)
        owner_a_token, owner_a_id = _register(client, name="川普老師A")
        owner_b_token, owner_b_id = _register(client, name="拜登老師B")
        classroom_a = _make_classroom(db, school, owner_a_id)
        classroom_b = _make_classroom(db, school, owner_b_id)

        # game_start must be in the future (relative to real wall-clock time)
        # or /accept auto-expires the invitation — see accept_invitation's
        # "nobody responded before game_start" rule. Completions are then
        # timestamped INSIDE [game_start, game_end) so they land in the
        # season's actual scoring window.
        game_start = datetime.now(timezone.utc) + timedelta(minutes=10)
        game_end = game_start + timedelta(days=2)
        inside_window = game_start + timedelta(hours=1)

        secret_student_token, secret_student_id = _register(client, name="陳小秘密")
        _enroll(db, classroom_a, secret_student_id)
        _complete_lesson(
            db, secret_student_id, "100",
            started_at=inside_window - timedelta(minutes=10), completed_at=inside_window,
        )
        # A second student in classroom_a who has NOT participated — gives the
        # roster-progress "尚未參與 first" ordering something real to assert on.
        # Created directly in the DB (not through /api/auth/register) — this
        # student never needs to log in, and _full_match already spends 4 of
        # the register endpoint's 5-per-minute budget; a 5th real
        # registration here intermittently tipped tests using _full_match
        # into 429 Too Many Requests.
        idle_student = User(
            email=f"idle_{uuid.uuid4().hex[:10]}@test.com", password_hash="x", name="還沒開始的學生"
        )
        db.add(idle_student)
        db.commit()
        idle_student_id = idle_student.id
        _enroll(db, classroom_a, idle_student_id)

        b_student_token, b_student_id = _register(client, name="林小隱藏")
        _enroll(db, classroom_b, b_student_id)
        _complete_lesson(
            db, b_student_id, "200",
            started_at=inside_window - timedelta(minutes=10), completed_at=inside_window,
        )

        created = client.post(
            "/api/league/invitations",
            json=_invite_payload(classroom_a.id, start=game_start, end=game_end),
            headers=_h(owner_a_token),
        ).json()
        accepted = client.post(
            f"/api/league/invitations/{created['code']}/accept",
            json={"invitee_classroom_id": classroom_b.id, "invitee_team_grade": 5},
            headers=_h(owner_b_token),
        )
        assert accepted.status_code == 200, accepted.text
        season = db.query(LeagueSeason).filter(LeagueSeason.invitation_id == created["id"]).first()
        return {
            "season_id": season.id,
            "owner_a_token": owner_a_token,
            "idle_student_id": idle_student_id,
            "secret_student_token": secret_student_token,
            "secret_student_id": secret_student_id,
            "secret_student_name": "陳小秘密",
            "b_student_id": b_student_id,
            "b_student_name": "林小隱藏",
            "owner_a_name": "川普老師A",
            "owner_b_name": "拜登老師B",
        }

    def test_board_response_has_no_student_or_teacher_pii(self, client, db):
        ctx = self._full_match(client, db)
        r = client.get(
            f"/api/league/seasons/{ctx['season_id']}/board",
            headers=_h(ctx["secret_student_token"]),
        )
        assert r.status_code == 200, r.text
        dumped = r.text
        # 2026-10-16 (#3594): the bare `"name"` key used to be banned outright
        # as a belt-and-suspenders catch for a person's name ever landing
        # under a generically-named key. The board response now legitimately
        # carries a `theme` object (season storyline content — chest/badge
        # display names, e.g. `"chest":{"name":"絲路寶箱",...}`), which is
        # copy, not PII, and would false-positive on a bare `"name"` scan.
        # The REAL protection is unchanged: no endpoint in this file emits a
        # bare `"name"` key for a PERSON (people's names are always under
        # `student_name`/`teacher_name`, both still explicitly banned below),
        # and the value-leak + id-leak assertions further down in this test
        # independently verify no actual PII value/id made it into the
        # response regardless of which key it would have been under.
        banned_keys = ["student_id", "\"student_name\"", "email", "teacher_id", "\"teacher_name\""]
        for k in banned_keys:
            assert k not in dumped, f"found banned field {k!r}"
        for value in (
            ctx["secret_student_name"], ctx["b_student_name"],
            ctx["owner_a_name"], ctx["owner_b_name"],
        ):
            assert value not in dumped, f"leaked value {value!r}"
        ids = _id_like_values(r.json())
        for sid in (ctx["secret_student_id"], ctx["b_student_id"]):
            assert sid not in ids and str(sid) not in ids, f"leaked student id {sid} in {ids}"

    def test_my_summary_has_no_other_students_pii(self, client, db):
        ctx = self._full_match(client, db)
        r = client.get(
            f"/api/league/seasons/{ctx['season_id']}/my-summary",
            headers=_h(ctx["secret_student_token"]),
        )
        assert r.status_code == 200, r.text
        dumped = r.text
        assert ctx["b_student_name"] not in dumped
        ids = _id_like_values(r.json())
        assert ctx["b_student_id"] not in ids and str(ctx["b_student_id"]) not in ids, ids
        assert ctx["owner_a_name"] not in dumped
        assert ctx["owner_b_name"] not in dumped

    def test_outsider_cannot_view_board_or_summary(self, client, db):
        ctx = self._full_match(client, db)
        outsider_token, _ = _register(client, name="路人甲")
        board = client.get(
            f"/api/league/seasons/{ctx['season_id']}/board", headers=_h(outsider_token)
        )
        assert board.status_code == 403
        summary = client.get(
            f"/api/league/seasons/{ctx['season_id']}/my-summary", headers=_h(outsider_token)
        )
        assert summary.status_code == 404  # not a member of any team this season

    def test_roster_progress_lists_not_participated_first_teacher_only(self, client, db):
        ctx = self._full_match(client, db)
        season = db.query(LeagueSeason).filter(LeagueSeason.id == ctx["season_id"]).first()
        team_a = next(
            t for t in season.teams
            if any(m.student_id == ctx["idle_student_id"] for m in t.roster)
        )

        denied = client.get(
            f"/api/league/seasons/{ctx['season_id']}/teams/{team_a.id}/roster",
            headers=_h(ctx["secret_student_token"]),
        )
        assert denied.status_code == 403

        r = client.get(
            f"/api/league/seasons/{ctx['season_id']}/teams/{team_a.id}/roster",
            headers=_h(ctx["owner_a_token"]),
        )
        assert r.status_code == 200, r.text
        rows = r.json()
        assert len(rows) == 2
        assert rows[0]["student_id"] == ctx["idle_student_id"]
        assert rows[0]["participated"] is False
        assert rows[1]["participated"] is True

    def test_anomalies_endpoint_is_teacher_of_that_team_only(self, client, db):
        ctx = self._full_match(client, db)
        season = db.query(LeagueSeason).filter(LeagueSeason.id == ctx["season_id"]).first()
        team_a = next(t for t in season.teams if t.classroom_id is not None)
        # student cannot view the teacher-only anomaly list
        r = client.get(
            f"/api/league/seasons/{ctx['season_id']}/teams/{team_a.id}/anomalies",
            headers=_h(ctx["secret_student_token"]),
        )
        assert r.status_code == 403


class TestDeclineInvitationAuthz:
    """2026-10-15 security finding (reviewed, verified on commit 0ed1f0de0):
    `decline` had NO authorization at all — unlike its sibling `accept`,
    which requires `_require_owner_strict` on the invitee classroom. Any
    authenticated user holding the code (including a bare student) could
    kill a pending invitation.

    Fix mirrors `accept` exactly: the request body must name a classroom,
    the route checks `_require_owner_strict` on it, and the service
    independently re-checks owner-match + "not the inviter's own
    classroom" + same-org (defense in depth — these must hold even if the
    route-level check were ever bypassed by a future caller)."""

    def _setup_invitation(self, client, db):
        org = _make_org(db)
        school = _make_school(db, org)
        owner_a_token, owner_a_id = _register(client, name="邀請方老師")
        owner_b_token, owner_b_id = _register(client, name="受邀方老師")
        owner_c_token, owner_c_id = _register(client, name="不相干老師")
        student_token, student_id = _register(client, name="學生")
        classroom_a = _make_classroom(db, school, owner_a_id)
        classroom_b = _make_classroom(db, school, owner_b_id)
        classroom_c = _make_classroom(db, school, owner_c_id)
        _enroll(db, classroom_a, student_id)
        created = client.post(
            "/api/league/invitations", json=_invite_payload(classroom_a.id), headers=_h(owner_a_token)
        ).json()
        return {
            "code": created["code"],
            "classroom_a": classroom_a,
            "classroom_b": classroom_b,
            "classroom_c": classroom_c,
            "owner_a_token": owner_a_token,
            "owner_b_token": owner_b_token,
            "owner_c_token": owner_c_token,
            "student_token": student_token,
        }

    def test_student_with_code_cannot_decline(self, client, db):
        ctx = self._setup_invitation(client, db)
        r = client.post(
            f"/api/league/invitations/{ctx['code']}/decline",
            json={"invitee_classroom_id": ctx["classroom_b"].id},
            headers=_h(ctx["student_token"]),
        )
        assert r.status_code == 403, r.text

    def test_teacher_cannot_decline_citing_a_classroom_that_is_not_theirs(self, client, db):
        """Teacher C legitimately owns classroom_c elsewhere in the same
        org, but has nothing to do with this invitation. Citing someone
        else's classroom_id (classroom_b, not their own) must 403 — same
        as the existing `test_only_invitee_owner_can_accept` pattern."""
        ctx = self._setup_invitation(client, db)
        r = client.post(
            f"/api/league/invitations/{ctx['code']}/decline",
            json={"invitee_classroom_id": ctx["classroom_b"].id},
            headers=_h(ctx["owner_c_token"]),
        )
        assert r.status_code == 403, r.text

    def test_inviting_teacher_cannot_decline_own_invitation(self, client, db):
        """They should use revoke, not decline, for their own invitation."""
        ctx = self._setup_invitation(client, db)
        r = client.post(
            f"/api/league/invitations/{ctx['code']}/decline",
            json={"invitee_classroom_id": ctx["classroom_a"].id},
            headers=_h(ctx["owner_a_token"]),
        )
        assert r.status_code == 403, r.text

    def test_invitee_classroom_owner_can_decline(self, client, db):
        """Positive control — mirrors accept's success path exactly."""
        ctx = self._setup_invitation(client, db)
        r = client.post(
            f"/api/league/invitations/{ctx['code']}/decline",
            json={"invitee_classroom_id": ctx["classroom_b"].id},
            headers=_h(ctx["owner_b_token"]),
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "declined"

    def test_cross_org_classroom_cannot_decline(self, client, db):
        """`_require_same_org` must independently be enforced for decline,
        not just inherited from accept's code path — a classroom owner in
        a DIFFERENT org (who is not the inviter, so the self-invite check
        alone would let this through) must still 403. Nothing in the
        TestDeclineInvitationAuthz suite above ever exercised two
        different orgs, so this is the one that actually proves
        `_require_same_org` is load-bearing on the decline path
        specifically (mutation-checked below)."""
        ctx = self._setup_invitation(client, db)
        other_org = _make_org(db)
        other_school = _make_school(db, other_org)
        outside_token, outside_id = _register(client, name="跨機構老師")
        outside_classroom = _make_classroom(db, other_school, outside_id)
        r = client.post(
            f"/api/league/invitations/{ctx['code']}/decline",
            json={"invitee_classroom_id": outside_classroom.id},
            headers=_h(outside_token),
        )
        assert r.status_code == 403, r.text


class TestAuthzMatrixAllEndpoints:
    """Consolidated authz audit (2026-10-15, prompted by the decline_invitation
    finding above): every league endpoint that takes a caller-supplied
    classroom_id / team_id / invitation_id, exercised with the LOWEST-
    privilege role that should be denied (negative control) AND the
    legitimate role that should succeed (positive control) in the same
    test. This is the single place to look when adding a new league
    endpoint — add a pair of assertions here for it."""

    def _build(self, client, db):
        org = _make_org(db)
        school = _make_school(db, org)
        owner_a_token, owner_a_id = _register(client, name="矩陣老師A")
        owner_b_token, owner_b_id = _register(client, name="矩陣老師B")
        owner_c_token, owner_c_id = _register(client, name="矩陣老師C")
        stranger_token, _ = _register(client, name="矩陣路人")
        classroom_a = _make_classroom(db, school, owner_a_id)
        classroom_b = _make_classroom(db, school, owner_b_id)
        classroom_c = _make_classroom(db, school, owner_c_id)

        start = NOW + timedelta(minutes=10)
        end = start + timedelta(days=2)

        # Invitation 1: accepted (A invites, B accepts) — board / season-list
        # / roster / anomalies entries read from this one.
        inv1 = client.post(
            "/api/league/invitations",
            json=_invite_payload(classroom_a.id, start=start, end=end),
            headers=_h(owner_a_token),
        ).json()
        accepted = client.post(
            f"/api/league/invitations/{inv1['code']}/accept",
            json={"invitee_classroom_id": classroom_b.id, "invitee_team_grade": 5},
            headers=_h(owner_b_token),
        )
        assert accepted.status_code == 200, accepted.text
        season = db.query(LeagueSeason).filter(LeagueSeason.invitation_id == inv1["id"]).first()
        team_a = (
            db.query(LeagueTeam)
            .filter(LeagueTeam.season_id == season.id, LeagueTeam.classroom_id == classroom_a.id)
            .first()
        )

        # Invitation 2: left pending — decline / revoke entries consume this.
        inv2 = client.post(
            "/api/league/invitations",
            json=_invite_payload(classroom_a.id, start=start, end=end),
            headers=_h(owner_a_token),
        ).json()

        return {
            "owner_a_token": owner_a_token,
            "owner_c_token": owner_c_token,
            "stranger_token": stranger_token,
            "classroom_a": classroom_a,
            "classroom_c": classroom_c,
            "season_id": season.id,
            "team_a_id": team_a.id,
            "inv2_code": inv2["code"],
            "inv2_id": inv2["id"],
        }

    def test_create_invitation_owner_only(self, client, db):
        ctx = self._build(client, db)
        deny = client.post(
            "/api/league/invitations",
            json=_invite_payload(ctx["classroom_a"].id),
            headers=_h(ctx["owner_c_token"]),
        )
        assert deny.status_code == 403, deny.text
        allow = client.post(
            "/api/league/invitations",
            json=_invite_payload(ctx["classroom_a"].id),
            headers=_h(ctx["owner_a_token"]),
        )
        assert allow.status_code == 201, allow.text

    def test_list_invitations_owner_only(self, client, db):
        ctx = self._build(client, db)
        deny = client.get(
            f"/api/league/invitations?classroom_id={ctx['classroom_a'].id}",
            headers=_h(ctx["stranger_token"]),
        )
        assert deny.status_code == 403, deny.text
        allow = client.get(
            f"/api/league/invitations?classroom_id={ctx['classroom_a'].id}",
            headers=_h(ctx["owner_a_token"]),
        )
        assert allow.status_code == 200, allow.text

    def test_revoke_inviter_only(self, client, db):
        ctx = self._build(client, db)
        deny = client.post(
            f"/api/league/invitations/{ctx['inv2_id']}/revoke", headers=_h(ctx["owner_c_token"])
        )
        assert deny.status_code == 403, deny.text
        allow = client.post(
            f"/api/league/invitations/{ctx['inv2_id']}/revoke", headers=_h(ctx["owner_a_token"])
        )
        assert allow.status_code == 200, allow.text

    def test_decline_same_org_non_inviter_can_decline_stranger_cannot(self, client, db):
        """Mirrors accept's permissiveness exactly: any same-org classroom
        other than the inviter's own may legitimately decline on behalf of
        itself (just as any same-org classroom may legitimately accept —
        there is no pre-designated invitee until one or the other
        happens); a bare stranger with no classroom at all may not."""
        ctx = self._build(client, db)
        deny = client.post(
            f"/api/league/invitations/{ctx['inv2_code']}/decline",
            json={"invitee_classroom_id": ctx["classroom_c"].id},
            headers=_h(ctx["stranger_token"]),
        )
        assert deny.status_code == 403, deny.text
        allow = client.post(
            f"/api/league/invitations/{ctx['inv2_code']}/decline",
            json={"invitee_classroom_id": ctx["classroom_c"].id},
            headers=_h(ctx["owner_c_token"]),
        )
        assert allow.status_code == 200, allow.text

    def test_season_board_requires_season_membership(self, client, db):
        ctx = self._build(client, db)
        deny = client.get(
            f"/api/league/seasons/{ctx['season_id']}/board", headers=_h(ctx["stranger_token"])
        )
        assert deny.status_code == 403, deny.text
        allow = client.get(
            f"/api/league/seasons/{ctx['season_id']}/board", headers=_h(ctx["owner_a_token"])
        )
        assert allow.status_code == 200, allow.text

    def test_classroom_seasons_owner_only(self, client, db):
        ctx = self._build(client, db)
        deny = client.get(
            f"/api/league/classrooms/{ctx['classroom_a'].id}/seasons",
            headers=_h(ctx["owner_c_token"]),
        )
        assert deny.status_code == 403, deny.text
        allow = client.get(
            f"/api/league/classrooms/{ctx['classroom_a'].id}/seasons",
            headers=_h(ctx["owner_a_token"]),
        )
        assert allow.status_code == 200, allow.text

    def test_roster_progress_team_owner_only(self, client, db):
        ctx = self._build(client, db)
        deny = client.get(
            f"/api/league/seasons/{ctx['season_id']}/teams/{ctx['team_a_id']}/roster",
            headers=_h(ctx["owner_c_token"]),
        )
        assert deny.status_code == 403, deny.text
        allow = client.get(
            f"/api/league/seasons/{ctx['season_id']}/teams/{ctx['team_a_id']}/roster",
            headers=_h(ctx["owner_a_token"]),
        )
        assert allow.status_code == 200, allow.text

    def test_anomalies_team_owner_only(self, client, db):
        ctx = self._build(client, db)
        deny = client.get(
            f"/api/league/seasons/{ctx['season_id']}/teams/{ctx['team_a_id']}/anomalies",
            headers=_h(ctx["owner_c_token"]),
        )
        assert deny.status_code == 403, deny.text
        allow = client.get(
            f"/api/league/seasons/{ctx['season_id']}/teams/{ctx['team_a_id']}/anomalies",
            headers=_h(ctx["owner_a_token"]),
        )
        assert allow.status_code == 200, allow.text
