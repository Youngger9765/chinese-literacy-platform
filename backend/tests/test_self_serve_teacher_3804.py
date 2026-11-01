"""#3804 Phase 2 — self-serve teacher activation.

Young 2026-11-01 (second instruction, verbatim): "你應該讓老師跟學生都可以進來使用；
想要當老師就自己開通老師身份就好（填寫學校）。"

Locks:
1. Registration / SSO default every new account to `student` (platform-scoped) —
   no more "register = teacher" branch.
2. POST /api/users/me/activate-teacher: any logged-in account can self-activate
   as a teacher by naming school(s), no approval, idempotent, no domain guessing.
3. Permission matrix (Young's point 4): declaring the same school name as
   another teacher does NOT grant visibility into that teacher's classrooms —
   written with the lowest-privilege account (a freshly self-activated
   teacher), with a positive control (the same account managing its own
   classroom must still work).

Run: cd backend && python -m pytest tests/test_self_serve_teacher_3804.py -v
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
from app.database import get_db
from app.models import Base
from app.models.school import School
from app.models.user import Role, User, UserRole
from app.services.sso_login_service import resolve_google_user, resolve_junyi_user

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


def _seed_roles(session):
    for r in SEED_ROLES:
        session.add(Role(**r))
    session.commit()


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _reset_rate_limiters():
    try:
        from app.routes.auth import rate_limiter
        rate_limiter.reset()
    except (ImportError, AttributeError):
        pass
    try:
        from app.auth.rate_limiter import general_rate_limiter
        general_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass


def _register_login(client, label: str) -> tuple[int, str]:
    _reset_rate_limiters()
    uid = uuid.uuid4().hex[:8]
    email = f"{label}_{uid}@test.example"
    r = client.post("/api/auth/register", json={
        "email": email,
        "password": "Secure99!",
        "name": label,
    })
    assert r.status_code == 201, r.text
    tok = r.json().get("verification_token")
    if tok:
        client.get(f"/api/auth/verify-email?token={tok}")
    _reset_rate_limiters()
    login = client.post("/api/auth/login", json={"email": email, "password": "Secure99!"})
    assert login.status_code == 200, login.text
    access = login.json()["access_token"]
    me = client.get("/api/users/me", headers=auth_header(access))
    user_id = me.json()["id"]
    return user_id, access


def _user_roles(user_id: int) -> list[tuple[str, str, str | None]]:
    db = TestingSessionLocal()
    try:
        rows = (
            db.query(Role.name, UserRole.scope_type, UserRole.scope_id)
            .join(UserRole, UserRole.role_id == Role.id)
            .filter(UserRole.user_id == user_id, UserRole.is_active == True)  # noqa: E712
            .all()
        )
        return [(r.name, r.scope_type, r.scope_id) for r in rows]
    finally:
        db.close()


# ===========================================================================
# 1. Registration / SSO default to student
# ===========================================================================


class TestEveryAccountDefaultsToStudent:
    def test_register_grants_exactly_one_platform_scoped_student_role(self, client):
        user_id, _ = _register_login(client, "fresh_default")
        roles = _user_roles(user_id)
        assert roles == [("student", "platform", None)], (
            f"a fresh registration must be exactly one platform-scoped student role, got {roles}"
        )

    def test_register_never_escalates_to_teacher_or_admin(self, client):
        user_id, token = _register_login(client, "no_escalation")
        resp = client.get("/api/users/me", headers=auth_header(token))
        role_names = {r["role_name"] for r in resp.json()["roles"]}
        assert role_names == {"student"}

    def test_explicit_role_teacher_hint_is_ignored_now(self, client):
        """#3804: there is no more register=teacher branch. An old client
        still sending role="teacher" (or any value other than "parent") gets
        a student account, same as omitting role entirely."""
        _reset_rate_limiters()
        uid = uuid.uuid4().hex[:8]
        email = f"old_client_hint_{uid}@test.example"
        r = client.post("/api/auth/register", json={
            "email": email, "password": "Secure99!", "name": "x", "role": "teacher",
        })
        assert r.status_code == 201, r.text
        login = client.post("/api/auth/login", json={"email": email, "password": "Secure99!"})
        me = client.get("/api/users/me", headers=auth_header(login.json()["access_token"]))
        role_names = {r["role_name"] for r in me.json()["roles"]}
        assert role_names == {"student"}

    def test_parent_opt_in_still_works_and_grants_no_student_role(self, client, monkeypatch):
        """#3513 parent portal is an unrelated, still-valid opt-in branch."""
        from app.config import settings
        monkeypatch.setattr(settings, "parent_portal_enabled", True)
        _reset_rate_limiters()
        uid = uuid.uuid4().hex[:8]
        email = f"parent_optin_{uid}@test.example"
        r = client.post("/api/auth/register", json={
            "email": email, "password": "Secure99!", "name": "x", "role": "parent",
        })
        assert r.status_code == 201, r.text
        login = client.post("/api/auth/login", json={"email": email, "password": "Secure99!"})
        me = client.get("/api/users/me", headers=auth_header(login.json()["access_token"]))
        role_names = {r["role_name"] for r in me.json()["roles"]}
        assert role_names == {"parent"}, "parent opt-in must not also grant a default student role"


class TestSsoDefaultsToStudent:
    def _db(self):
        db = TestingSessionLocal()
        return db

    def test_new_google_account_gets_default_student_role(self):
        db = self._db()
        try:
            id_info = {
                "sub": f"google-sub-{uuid.uuid4().hex[:8]}",
                "email": f"newgoogle_{uuid.uuid4().hex[:8]}@test.example",
                "email_verified": True,
                "name": "Google 新帳號",
            }
            user, is_new = resolve_google_user(db, id_info)
            db.commit()
            assert is_new is True
            assert _user_roles(user.id) == [("student", "platform", None)]
        finally:
            db.close()

    def test_new_junyi_account_gets_default_student_role(self):
        db = self._db()
        try:
            payload = {
                "userId": f"junyi-{uuid.uuid4().hex[:8]}",
                "userEmail": f"newjunyi_{uuid.uuid4().hex[:8]}@test.example",
                "userDisplayName": "均一新帳號",
            }
            user, is_new = resolve_junyi_user(db, payload)
            db.commit()
            assert is_new is True
            assert _user_roles(user.id) == [("student", "platform", None)]
        finally:
            db.close()

    def test_returning_google_account_is_not_re_granted_or_escalated(self):
        """Linking/returning accounts are untouched -- only brand-new accounts
        get the default-student grant. An existing teacher linking Google
        must not silently gain an extra platform-scoped student role."""
        db = self._db()
        try:
            teacher = User(
                email=f"existing_teacher_{uuid.uuid4().hex[:8]}@test.example",
                password_hash="x", name="既有老師", is_active=True, email_verified=True,
            )
            db.add(teacher)
            db.flush()
            role = db.query(Role).filter(Role.name == "teacher").first()
            db.add(UserRole(user_id=teacher.id, role_id=role.id, scope_type="school", scope_id="1"))
            db.commit()

            id_info = {
                "sub": f"google-link-{uuid.uuid4().hex[:8]}",
                "email": teacher.email,
                "email_verified": True,
                "name": teacher.name,
            }
            user, is_new = resolve_google_user(db, id_info)
            db.commit()
            assert is_new is False
            assert user.id == teacher.id
            roles = _user_roles(user.id)
            assert roles == [("teacher", "school", "1")], (
                f"linking Google to an existing teacher must not add a student role, got {roles}"
            )
        finally:
            db.close()


# ===========================================================================
# 2. POST /api/users/me/activate-teacher
# ===========================================================================


class TestActivateTeacherEndpoint:
    def test_requires_auth(self, client):
        resp = client.post("/api/users/me/activate-teacher", json={"school_names": ["某國小"]})
        assert resp.status_code == 401

    def test_empty_list_is_422(self, client):
        _, token = _register_login(client, "act_empty")
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": []},
            headers=auth_header(token),
        )
        assert resp.status_code == 422

    def test_blank_name_is_422(self, client):
        _, token = _register_login(client, "act_blank")
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": ["   "]},
            headers=auth_header(token),
        )
        assert resp.status_code == 422

    def test_more_than_ten_schools_is_422(self, client):
        _, token = _register_login(client, "act_toomany")
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [f"學校{i}" for i in range(11)]},
            headers=auth_header(token),
        )
        assert resp.status_code == 422

    def test_activating_a_new_school_name_creates_it_and_grants_teacher(self, client):
        user_id, token = _register_login(client, "act_new")
        school_name = f"大安國小_{uuid.uuid4().hex[:6]}"
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [school_name]},
            headers=auth_header(token),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["schools"]) == 1
        assert body["schools"][0]["name"] == school_name
        assert body["schools"][0]["is_new"] is True

        role_names = {r["role_name"] for r in body["roles"]}
        assert "teacher" in role_names
        assert "student" in role_names, "activating teacher must not remove the existing student role"

        roles = _user_roles(user_id)
        teacher_roles = [r for r in roles if r[0] == "teacher"]
        assert len(teacher_roles) == 1
        assert teacher_roles[0][1] == "school"

    def test_activating_twice_with_the_same_name_is_idempotent(self, client):
        _, token = _register_login(client, "act_idem")
        school_name = f"重複國小_{uuid.uuid4().hex[:6]}"
        r1 = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [school_name]},
            headers=auth_header(token),
        )
        school_id = r1.json()["schools"][0]["id"]

        r2 = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [school_name]},
            headers=auth_header(token),
        )
        assert r2.status_code == 200
        assert r2.json()["schools"][0]["id"] == school_id
        assert r2.json()["schools"][0]["is_new"] is False

        db = TestingSessionLocal()
        try:
            count = db.query(School).filter(School.id == school_id).count()
            assert count == 1, "activating the same name twice must not create a duplicate school"
        finally:
            db.close()

    def test_deactivated_teacher_role_cannot_self_reactivate(self, client):
        """Security review finding (2026-11-01): a system_admin can revoke a
        teacher's role at a school (DELETE /roles/assignments/{id}, soft
        delete via is_active=False -- app/routes/roles.py::revoke_role).
        Before this fix, calling activate-teacher again with the SAME school
        name silently flipped is_active back to True -- a real
        self-service privilege escalation around an admin's revocation.
        Must now 403 and leave is_active=False untouched."""
        from app.models.user import Role, UserRole

        _, token = _register_login(client, "act_revoked")
        school_name = f"停權國小_{uuid.uuid4().hex[:6]}"
        r1 = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [school_name]},
            headers=auth_header(token),
        )
        assert r1.status_code == 200, r1.text
        school_id = r1.json()["schools"][0]["id"]

        # Simulate a system_admin revoking the teacher role at this school.
        db = TestingSessionLocal()
        try:
            teacher_role = db.query(Role).filter(Role.name == "teacher").first()
            ur = (
                db.query(UserRole)
                .filter(
                    UserRole.role_id == teacher_role.id,
                    UserRole.scope_type == "school",
                    UserRole.scope_id == str(school_id),
                )
                .first()
            )
            ur.is_active = False
            db.commit()
            revoked_ur_id = ur.id
        finally:
            db.close()

        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [school_name]},
            headers=auth_header(token),
        )
        assert resp.status_code == 403, resp.text

        db = TestingSessionLocal()
        try:
            ur = db.query(UserRole).filter(UserRole.id == revoked_ur_id).first()
            assert ur.is_active is False, (
                "a revoked role must stay revoked after a failed self-reactivation attempt"
            )
        finally:
            db.close()

    def test_activating_multiple_schools_in_one_call(self, client):
        _, token = _register_login(client, "act_multi")
        names = [f"學校A_{uuid.uuid4().hex[:5]}", f"學校B_{uuid.uuid4().hex[:5]}"]
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": names},
            headers=auth_header(token),
        )
        assert resp.status_code == 200
        returned_names = {s["name"] for s in resp.json()["schools"]}
        assert returned_names == set(names)

    def test_matching_is_case_insensitive_and_trims_whitespace(self, client):
        _, token_a = _register_login(client, "act_case_a")
        _, token_b = _register_login(client, "act_case_b")
        base = f"Case國小_{uuid.uuid4().hex[:5]}"

        r_a = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [base]},
            headers=auth_header(token_a),
        )
        r_b = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [f"  {base.upper()}  "]},
            headers=auth_header(token_b),
        )
        assert r_a.json()["schools"][0]["id"] == r_b.json()["schools"][0]["id"], (
            "same name (case/whitespace aside) must resolve to the same school, "
            "per §4.1.1's documented exact-name-match design"
        )
        assert r_b.json()["schools"][0]["is_new"] is False


# ===========================================================================
# 3. Permission matrix (Young's point 4): same school declared != same
#    classroom visibility. Written with the LOWEST-privilege account
#    (a freshly self-activated teacher, no admin), with a positive control.
# ===========================================================================


class TestSameSchoolDoesNotGrantClassroomVisibility:
    @pytest.fixture(scope="class")
    def actors(self, client):
        school_name = f"某國小_{uuid.uuid4().hex[:6]}"

        a_id, a_tok = _register_login(client, "sameschool_a")
        client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [school_name]},
            headers=auth_header(a_tok),
        )
        # school_id must come from /users/me after activation, not guessed.
        me_a = client.get("/api/users/me", headers=auth_header(a_tok)).json()
        school_id = next(r["scope_id"] for r in me_a["roles"] if r["role_name"] == "teacher")
        cls_a = client.post(
            "/api/classrooms",
            json={"name": "A1", "school_id": int(school_id), "grade": 4},
            headers=auth_header(a_tok),
        )
        assert cls_a.status_code == 201, cls_a.text

        b_id, b_tok = _register_login(client, "sameschool_b")
        act_b = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [school_name]},
            headers=auth_header(b_tok),
        )
        assert act_b.json()["schools"][0]["id"] == int(school_id), (
            "sanity: A and B must have landed in the SAME school for this test to be meaningful"
        )

        return {
            "a_tok": a_tok, "b_tok": b_tok,
            "school_id": int(school_id),
            "classroom_a_id": cls_a.json()["id"],
        }

    def test_declaring_same_school_does_not_grant_viewing_someone_elses_classroom(self, actors):
        """Given test from PRD §10.7 — the negative assertion."""
        from app.main import app as _app
        client = TestClient(_app)
        resp = client.get(
            f"/api/classrooms/{actors['classroom_a_id']}",
            headers=auth_header(actors["b_tok"]),
        )
        assert resp.status_code == 403, resp.text

    def test_positive_control_same_teacher_can_create_and_manage_own_classroom_in_that_school(self, actors):
        """Positive control (PRD §10.7): B is not broken wholesale -- B can
        open and manage their OWN classroom in the same declared school."""
        from app.main import app as _app
        client = TestClient(_app)
        resp = client.post(
            "/api/classrooms",
            json={"name": "B1", "school_id": actors["school_id"], "grade": 4},
            headers=auth_header(actors["b_tok"]),
        )
        assert resp.status_code == 201, resp.text
        b1_id = resp.json()["id"]

        manage = client.patch(
            f"/api/classrooms/{b1_id}",
            json={"name": "B1-renamed"},
            headers=auth_header(actors["b_tok"]),
        )
        assert manage.status_code == 200, manage.text

    def test_declaring_same_school_does_not_grant_viewing_someone_elses_students(self, actors):
        """Third assertion from PRD §10.7: can(user,"view","student",...) is
        also unaffected by the shared school declaration. Uses the dedicated
        student-resource policy endpoint (gamification summary), not the
        classroom-detail endpoint already covered above."""
        from app.main import app as _app
        client = TestClient(_app)

        batch = client.post(
            f"/api/classrooms/{actors['classroom_a_id']}/students/batch",
            json={"students": [{"name": "小明", "seat_number": "01"}]},
            headers=auth_header(actors["a_tok"]),
        )
        assert batch.status_code == 201, batch.text
        student_id = batch.json()["created"][0]["user_id"]

        # positive control: A (the owning teacher) CAN view their own student
        as_a = client.get(
            f"/api/gamification/summary/{student_id}",
            headers=auth_header(actors["a_tok"]),
        )
        assert as_a.status_code == 200, as_a.text

        as_b = client.get(
            f"/api/gamification/summary/{student_id}",
            headers=auth_header(actors["b_tok"]),
        )
        assert as_b.status_code == 403, as_b.text


# ===========================================================================
# 4. Security review finding (2026-11-01): self-activating into an EXISTING
#    school must not grant visibility into that school's roster or
#    classroom list -- declaring a school is now a trivial self-service
#    action, so "any school member can see the school's roster/classrooms"
#    (a Phase-1 policy, authz.py::_can_view_school_roster) becomes
#    practically exploitable the moment anyone can join by typing a name.
#    Written with the LOWEST-privilege account (freshly self-activated
#    teacher with zero classrooms of their own in that school), with a
#    positive control (the same teacher's own classroom IS visible).
# ===========================================================================


class TestJoiningAnExistingSchoolDoesNotLeakItsRoster:
    @pytest.fixture(scope="class")
    def actors(self, client):
        school_name = f"名冊測試國小_{uuid.uuid4().hex[:6]}"

        a_id, a_tok = _register_login(client, "roster_a")
        act_a = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [school_name]},
            headers=auth_header(a_tok),
        )
        school_id = act_a.json()["schools"][0]["id"]
        cls_a = client.post(
            "/api/classrooms",
            json={"name": "RosterA1", "school_id": school_id, "grade": 4},
            headers=auth_header(a_tok),
        )
        assert cls_a.status_code == 201, cls_a.text

        b_id, b_tok = _register_login(client, "roster_b")
        act_b = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [school_name]},
            headers=auth_header(b_tok),
        )
        assert act_b.json()["schools"][0]["id"] == school_id, (
            "sanity: A and B must share the same school for this test to be meaningful"
        )

        return {
            "a_tok": a_tok, "b_tok": b_tok,
            "school_id": school_id,
            "classroom_a_id": cls_a.json()["id"],
        }

    def test_joining_by_name_does_not_grant_the_schools_classroom_list(self, actors):
        resp = TestClient(app).get(
            f"/api/schools/{actors['school_id']}/classrooms",
            headers=auth_header(actors["b_tok"]),
        )
        assert resp.status_code == 403, resp.text

    def test_joining_by_name_does_not_grant_the_schools_member_roster(self, actors):
        resp = TestClient(app).get(
            f"/api/schools/{actors['school_id']}/members",
            headers=auth_header(actors["b_tok"]),
        )
        assert resp.status_code == 403, resp.text

    def test_positive_control_owner_can_still_see_their_own_schools_classroom_list(self, actors):
        """A (who owns a classroom at this school) must still be able to
        read the classroom list -- this is not "nobody can ever see it",
        it's "membership-by-declaration alone isn't enough"."""
        resp = TestClient(app).get(
            f"/api/schools/{actors['school_id']}/classrooms",
            headers=auth_header(actors["a_tok"]),
        )
        assert resp.status_code == 200, resp.text
        names = {c["name"] for c in resp.json()}
        assert "RosterA1" in names


# ===========================================================================
# 5. Security review finding (2026-11-01, #3): self-activating into a BRAND
#    NEW school does not make the activator that school's admin in any
#    permission sense. admin_user_id is a "who created it" breadcrumb, not
#    a grant -- can()'s ("school","manage") policy is hardcoded False for
#    everyone except system_admin regardless of admin_user_id.
# ===========================================================================


class TestCreatingANewSchoolGrantsNoAdminPrivilege:
    def test_self_activating_creator_still_cannot_manage_the_school_they_created(self, client):
        _, token = _register_login(client, "creates_new_school")
        school_name = f"全新學校_{uuid.uuid4().hex[:6]}"
        act = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [school_name]},
            headers=auth_header(token),
        )
        assert act.status_code == 200, act.text
        assert act.json()["schools"][0]["is_new"] is True
        school_id = act.json()["schools"][0]["id"]

        resp = client.patch(
            f"/api/schools/{school_id}",
            json={"name": "改名"},
            headers=auth_header(token),
        )
        assert resp.status_code == 403, (
            "creating a brand-new school via self-activation must not grant "
            f"PATCH /schools/{{id}} (system_admin-only): {resp.text}"
        )
