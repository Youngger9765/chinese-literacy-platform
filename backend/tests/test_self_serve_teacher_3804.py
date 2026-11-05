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
        """#3513 parent portal is an unrelated, still-valid opt-in branch.

        Patches "app.routes.auth.settings.parent_portal_enabled" (the exact
        object app.routes.auth.register() reads), not a fresh
        `from app.config import settings` import. In the full suite,
        test_preview_cors_3139.py calls importlib.reload(app.config) in two
        of its tests, which replaces the `app.config.settings` module
        attribute with a brand-new Settings() instance. Any module already
        imported earlier in the run (routes.auth included -- it's pulled in
        by `from app.main import app`, which happens during collection of
        far earlier test files) keeps its OLD reference via
        `from ..config import settings`, since `from X import Y` binds a
        name, it does not keep a live link back to X's namespace. A fresh
        `from app.config import settings` done afterwards therefore gets a
        DIFFERENT object than the one routes.auth actually consults --
        monkeypatching that fresh object is invisible to the real request.
        Confirmed in CI (2026-11-01): 1 failure in a 6910-test run, this
        exact test, 403 instead of 201, reproduced locally twice in a
        full-suite run and NOT reproduced in an 82-file alphabetical slice
        around it (consistent with this being an import-order-dependent
        staleness, not a logic bug in the registration code itself)."""
        monkeypatch.setattr("app.routes.auth.settings.parent_portal_enabled", True)
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

    def test_parent_opt_in_refused_while_portal_is_off(self, client, monkeypatch):
        """Negative counterpart requested in security review (2026-11-01):
        lock BOTH directions of the parent_portal_enabled flag, not just the
        enabled one -- same "app.routes.auth.settings" patch target as above,
        for the same import-staleness reason."""
        monkeypatch.setattr("app.routes.auth.settings.parent_portal_enabled", False)
        _reset_rate_limiters()
        uid = uuid.uuid4().hex[:8]
        email = f"parent_refused_{uid}@test.example"
        r = client.post("/api/auth/register", json={
            "email": email, "password": "Secure99!", "name": "x", "role": "parent",
        })
        assert r.status_code == 403, r.text
        assert r.json()["detail"] == "家長功能目前暫時關閉，請聯繫老師或管理員。"


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
        resp = client.post("/api/users/me/activate-teacher", json={"schools": [{"name": n} for n in (["某國小"])]})
        assert resp.status_code == 401

    def test_empty_list_is_422(self, client):
        _, token = _register_login(client, "act_empty")
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"name": n} for n in ([])]},
            headers=auth_header(token),
        )
        assert resp.status_code == 422

    def test_blank_name_is_422(self, client):
        _, token = _register_login(client, "act_blank")
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"name": n} for n in (["   "])]},
            headers=auth_header(token),
        )
        assert resp.status_code == 422

    def test_more_than_ten_schools_is_422(self, client):
        _, token = _register_login(client, "act_toomany")
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"name": n} for n in ([f"學校{i}" for i in range(11)])]},
            headers=auth_header(token),
        )
        assert resp.status_code == 422

    def test_activating_a_new_school_name_creates_it_and_grants_teacher(self, client):
        user_id, token = _register_login(client, "act_new")
        school_name = f"大安國小_{uuid.uuid4().hex[:6]}"
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"name": n} for n in ([school_name])]},
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
            json={"schools": [{"name": n} for n in ([school_name])]},
            headers=auth_header(token),
        )
        school_id = r1.json()["schools"][0]["id"]

        r2 = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"name": n} for n in ([school_name])]},
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
            json={"schools": [{"name": n} for n in ([school_name])]},
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
            json={"schools": [{"name": n} for n in ([school_name])]},
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
            json={"schools": [{"name": n} for n in (names)]},
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
            json={"schools": [{"name": n} for n in ([base])]},
            headers=auth_header(token_a),
        )
        r_b = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"name": n} for n in ([f"  {base.upper()}  "])]},
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
            json={"schools": [{"name": n} for n in ([school_name])]},
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
            json={"schools": [{"name": n} for n in ([school_name])]},
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

    def test_declaring_same_school_does_not_grant_viewing_someone_elses_classroom(self, client, actors):
        """Given test from PRD §10.7 — the negative assertion.

        #3816: this used to mint its own `TestClient(_app)` instead of
        reusing the module's `client` fixture. A short-lived, never-entered
        TestClient does not run ASGI lifespan, and — empirically confirmed
        by reproducing the exact CI failure in a container matching CI's
        Python/OS — its teardown timing is not deterministic enough to rely
        on for a dependency_overrides-based test DB swap under a full-suite
        run: the request would occasionally land on a stale app state and
        raise "no such table: users" for a table that very much exists on
        the module's own engine. Every call in this class now goes through
        the single, properly entered `client` fixture instead."""
        resp = client.get(
            f"/api/classrooms/{actors['classroom_a_id']}",
            headers=auth_header(actors["b_tok"]),
        )
        assert resp.status_code == 403, resp.text

    def test_positive_control_same_teacher_can_create_and_manage_own_classroom_in_that_school(self, client, actors):
        """Positive control (PRD §10.7): B is not broken wholesale -- B can
        open and manage their OWN classroom in the same declared school."""
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

    def test_declaring_same_school_does_not_grant_viewing_someone_elses_students(self, client, actors):
        """Third assertion from PRD §10.7: can(user,"view","student",...) is
        also unaffected by the shared school declaration. Uses the dedicated
        student-resource policy endpoint (gamification summary), not the
        classroom-detail endpoint already covered above."""
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
            json={"schools": [{"name": n} for n in ([school_name])]},
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
            json={"schools": [{"name": n} for n in ([school_name])]},
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

    def test_joining_by_name_does_not_grant_the_schools_classroom_list(self, client, actors):
        # #3816: reuse the module's `client` fixture instead of minting a
        # fresh `TestClient(app)` per call -- see the note on
        # test_declaring_same_school_does_not_grant_viewing_someone_elses_classroom.
        resp = client.get(
            f"/api/schools/{actors['school_id']}/classrooms",
            headers=auth_header(actors["b_tok"]),
        )
        assert resp.status_code == 403, resp.text

    def test_joining_by_name_does_not_grant_the_schools_member_roster(self, client, actors):
        resp = client.get(
            f"/api/schools/{actors['school_id']}/members",
            headers=auth_header(actors["b_tok"]),
        )
        assert resp.status_code == 403, resp.text

    def test_owner_of_a_self_activated_school_also_does_not_get_the_school_wide_list(self, client, actors):
        """(Finding #5, 2026-11-01) Even A -- the teacher who OWNS a
        classroom at this self-activated school -- gets no school-wide
        roster view either. This is not a regression: A's own classroom is
        still fully visible to A via GET /classrooms (classroom_crud.py
        list_my_classrooms, scoped to owns-or-co-teaches regardless of
        school), which is what the real "我的班級" page actually calls. The
        admin-style /schools/{id}/classrooms list has no legitimate purpose
        for a self-activated school -- see _can_view_school_roster."""
        resp = client.get(
            f"/api/schools/{actors['school_id']}/classrooms",
            headers=auth_header(actors["a_tok"]),
        )
        assert resp.status_code == 403, resp.text

        my_classrooms = client.get(
            "/api/classrooms",
            headers=auth_header(actors["a_tok"]),
        )
        assert my_classrooms.status_code == 200, my_classrooms.text
        names = {c["name"] for c in my_classrooms.json()["items"]}
        assert "RosterA1" in names, (
            "A must still see their own classroom via the real "
            f"'my classrooms' endpoint. Visible: {names}"
        )

    def test_owning_a_classroom_does_not_unlock_a_strangers_classroom_in_the_same_self_activated_school(
        self, client, actors,
    ):
        """Probe for the gap a bare ownership-boolean gate would leave open:
        once B (who shares nothing with A but typing the same school name)
        creates their OWN classroom at that school, does the school-wide
        list hand B A's classroom too?

        Young's point 4 (verbatim): "自助開通的老師一樣只看得到自己開的班、
        自己班上的學生。宣告了某所學校，不代表能看到那所學校的其他班。"
        This must hold even after B legitimately owns a classroom there --
        owning ONE classroom at a self-activated school must not be read as
        "therefore see ALL classrooms at that school"."""
        cls_b = client.post(
            "/api/classrooms",
            json={"name": "RosterB1", "school_id": actors["school_id"], "grade": 4},
            headers=auth_header(actors["b_tok"]),
        )
        assert cls_b.status_code == 201, cls_b.text

        resp = client.get(
            f"/api/schools/{actors['school_id']}/classrooms",
            headers=auth_header(actors["b_tok"]),
        )
        if resp.status_code == 200:
            names = {c["name"] for c in resp.json()}
            assert "RosterA1" not in names, (
                "B can see A's classroom merely by having created one of "
                f"their own at the same self-declared school. Visible: {names}"
            )
        else:
            assert resp.status_code == 403, resp.text
        # B's own classroom remains fully visible via the real endpoint.
        my_classrooms = client.get(
            "/api/classrooms",
            headers=auth_header(actors["b_tok"]),
        )
        assert "RosterB1" in {c["name"] for c in my_classrooms.json()["items"]}


class TestRealAdminCreatedSchoolRosterStillWorksForItsOwnTeachers:
    """Positive control for Finding #5: the school-wide roster/classroom-list
    endpoints still work as before for a REAL (non-self-activated, e.g.
    admin-created or MOE-directory-imported) school, where "own/co-teach at
    least one classroom there" remains the gate. Finding #5 narrows the gap
    specifically for self-activated schools -- it must not regress the
    admin dashboard views for institutionally-real schools."""

    def test_classroom_owner_at_a_real_school_sees_the_schools_classroom_list(self, client):
        db = TestingSessionLocal()
        try:
            school = School(name=f"真實學校_{uuid.uuid4().hex[:6]}", domain=None)
            db.add(school)
            db.commit()
            db.refresh(school)
            school_id = school.id
        finally:
            db.close()

        _, token = _register_login(client, "real_school_teacher")
        role = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"name": n} for n in ([school.name])]},
            headers=auth_header(token),
        )
        assert role.status_code == 200, role.text
        cls = client.post(
            "/api/classrooms",
            json={"name": "RealSchoolClassroom", "school_id": school_id, "grade": 4},
            headers=auth_header(token),
        )
        assert cls.status_code == 201, cls.text

        # 2026-11-02 staging repro: at a real/MOE school, owning one classroom
        # is something any stranger can do, so it no longer unlocks the
        # school-wide list. Only system_admin / the school's admin_user_id do.
        resp = client.get(f"/api/schools/{school_id}/classrooms", headers=auth_header(token))
        assert resp.status_code == 403, resp.text
        # Their own classroom is still visible through the normal list.
        own = client.get("/api/classrooms", headers=auth_header(token))
        assert own.status_code == 200, own.text
        assert "RealSchoolClassroom" in own.text


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
            json={"schools": [{"name": n} for n in ([school_name])]},
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


# ===========================================================================
# 6. Security review finding (2026-11-02): self-activating into an EXISTING
#    school must not grant the ability to SEARCH or ADD a student who
#    belongs to a DIFFERENT teacher at that same school.
#
#    _eligible_student_ids() (classroom_students.py) only narrowed "students
#    of this school" down to "students I created or already teach" when the
#    school's domain looked like a public mail provider (#3541). A
#    self-activated school always has domain=None -- not a public email
#    domain, so is_public_email_domain(None) is False and the narrowing was
#    skipped entirely, treating it like a real institutional (email-domain
#    -verified) school where #3541 intentionally keeps sharing. A
#    self-activated school has no such verification; declaring the same
#    name is now trivial and open to anyone. Same root cause, same fix
#    shape as finding 2 (roster leak), different endpoint.
#
#    Written with the LOWEST-privilege account (a freshly self-activated
#    teacher), with a positive control (the same teacher's own student is
#    both searchable and addable).
# ===========================================================================


class TestJoiningAnExistingSchoolDoesNotLeakItsStudents:
    @pytest.fixture(scope="class")
    def actors(self, client):
        school_name = f"學生測試國小_{uuid.uuid4().hex[:6]}"

        a_id, a_tok = _register_login(client, "students_a")
        act_a = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"name": n} for n in ([school_name])]},
            headers=auth_header(a_tok),
        )
        school_id = act_a.json()["schools"][0]["id"]
        cls_a = client.post(
            "/api/classrooms",
            json={"name": "StudentsA1", "school_id": school_id, "grade": 4},
            headers=auth_header(a_tok),
        )
        assert cls_a.status_code == 201, cls_a.text
        cls_a_id = cls_a.json()["id"]

        b_id, b_tok = _register_login(client, "students_b")
        act_b = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"name": n} for n in ([school_name])]},
            headers=auth_header(b_tok),
        )
        assert act_b.json()["schools"][0]["id"] == school_id, (
            "sanity: A and B must share the same school for this test to be meaningful"
        )
        cls_b = client.post(
            "/api/classrooms",
            json={"name": "StudentsB1", "school_id": school_id, "grade": 4},
            headers=auth_header(b_tok),
        )
        cls_b_id = cls_b.json()["id"]

        # B's own student -- a unique, searchable name planted via batch-create,
        # which grants a school-scoped `student` role at `school_id` (#3534/#3541
        # wiring), exactly the real-world path.
        unique_name = f"乙生_{uuid.uuid4().hex[:6]}"
        batch_b = client.post(
            f"/api/classrooms/{cls_b_id}/students/batch",
            json={"students": [{"name": unique_name, "seat_number": "01"}]},
            headers=auth_header(b_tok),
        )
        assert batch_b.status_code == 201, batch_b.text
        b_student_id = batch_b.json()["created"][0]["user_id"]

        # A's own student, for the positive control.
        own_name = f"甲生_{uuid.uuid4().hex[:6]}"
        batch_a = client.post(
            f"/api/classrooms/{cls_a_id}/students/batch",
            json={"students": [{"name": own_name, "seat_number": "01"}]},
            headers=auth_header(a_tok),
        )
        assert batch_a.status_code == 201, batch_a.text
        a_student_id = batch_a.json()["created"][0]["user_id"]

        return {
            "a_tok": a_tok, "b_tok": b_tok, "school_id": school_id,
            "cls_a_id": cls_a_id, "cls_b_id": cls_b_id,
            "b_student_id": b_student_id, "b_student_name": unique_name,
            "a_student_id": a_student_id, "a_student_name": own_name,
        }

    def test_cannot_search_for_another_teachers_student_in_the_same_school(self, client, actors):
        # #3816: reuse the module's `client` fixture instead of minting a
        # fresh TestClient per call -- see the note on
        # test_declaring_same_school_does_not_grant_viewing_someone_elses_classroom.
        resp = client.post(
            f"/api/classrooms/{actors['cls_a_id']}/students/search",
            json={"query": actors["b_student_name"]},
            headers=auth_header(actors["a_tok"]),
        )
        assert resp.status_code == 200, resp.text
        found_ids = {r["id"] for r in resp.json()}
        assert actors["b_student_id"] not in found_ids, (
            f"teacher A must not be able to search up teacher B's student via shared "
            f"school membership alone: {resp.json()}"
        )

    def test_cannot_add_another_teachers_student_to_own_classroom(self, client, actors):
        resp = client.post(
            f"/api/classrooms/{actors['cls_a_id']}/students",
            json={"student_id": actors["b_student_id"]},
            headers=auth_header(actors["a_tok"]),
        )
        assert resp.status_code == 404, (
            f"teacher A must not be able to enrol teacher B's student into A's "
            f"classroom via shared school membership alone: {resp.status_code} {resp.text}"
        )

    def test_positive_control_can_search_and_add_own_student(self, client, actors):
        """A's OWN student (already enrolled in A's own classroom) must still
        be findable and addable -- this isn't "nothing works", it's "cross
        -teacher strangers don't leak"."""
        c = client

        search = c.post(
            f"/api/classrooms/{actors['cls_a_id']}/students/search",
            json={"query": actors["a_student_name"]},
            headers=auth_header(actors["a_tok"]),
        )
        assert search.status_code == 200, search.text
        # a_student is already enrolled in cls_a_id so search (which excludes
        # already-enrolled students) legitimately returns empty -- the real
        # positive control is adding them to a SECOND classroom A owns.
        cls_a2 = c.post(
            "/api/classrooms",
            json={"name": "StudentsA2", "school_id": actors["school_id"], "grade": 4},
            headers=auth_header(actors["a_tok"]),
        )
        assert cls_a2.status_code == 201, cls_a2.text
        cls_a2_id = cls_a2.json()["id"]

        search2 = c.post(
            f"/api/classrooms/{cls_a2_id}/students/search",
            json={"query": actors["a_student_name"]},
            headers=auth_header(actors["a_tok"]),
        )
        assert search2.status_code == 200, search2.text
        assert actors["a_student_id"] in {r["id"] for r in search2.json()}, (
            f"positive control failed: A could not find their OWN student via "
            f"search: {search2.json()}"
        )

        add2 = c.post(
            f"/api/classrooms/{cls_a2_id}/students",
            json={"student_id": actors["a_student_id"]},
            headers=auth_header(actors["a_tok"]),
        )
        assert add2.status_code == 201, (
            f"positive control failed: A could not add their OWN student to "
            f"another of A's classrooms: {add2.status_code} {add2.text}"
        )


# ===========================================================================
# 7. Security review finding (2026-11-02, via code-reviewer on #3820): a
#    merely-PENDING (not yet accepted) co-teaching invite must not count as
#    "a classroom I already teach" for _eligible_student_ids()'s narrowing.
#
#    _eligible_student_ids()'s `my_classrooms` union queried ClassroomTeacher
#    by teacher_id alone, with no status filter -- so being invited (but not
#    having accepted) as a co-teacher of classroom C let that invitee pull
#    C's enrolled students into their OWN, unrelated classroom's search/add
#    flow, for self-activated/public-email-domain schools where finding 6
#    above already narrows who counts as "sharing" a student. #3820 added
#    status='pending'|'accepted' precisely so a pending invite grants zero
#    access anywhere; this was the one place in that PR's sweep that missed
#    the filter. Fixed in classroom_students.py::_eligible_student_ids.
# ===========================================================================


class TestPendingCoTeachingInviteDoesNotLeakTheOtherClassroomsStudents:
    @pytest.fixture(scope="class")
    def actors(self, client):
        school_name = f"待確認邀請測試國小_{uuid.uuid4().hex[:6]}"

        owner_id, owner_tok = _register_login(client, "pending_leak_owner")
        act_owner = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"name": school_name}]},
            headers=auth_header(owner_tok),
        )
        school_id = act_owner.json()["schools"][0]["id"]
        cls_owner = client.post(
            "/api/classrooms",
            json={"name": "PendingLeakOwnerClass", "school_id": school_id, "grade": 4},
            headers=auth_header(owner_tok),
        )
        assert cls_owner.status_code == 201, cls_owner.text
        cls_owner_id = cls_owner.json()["id"]

        # Owner's own student -- the one a pending invite must NOT leak.
        unique_name = f"待洩漏學生_{uuid.uuid4().hex[:6]}"
        batch = client.post(
            f"/api/classrooms/{cls_owner_id}/students/batch",
            json={"students": [{"name": unique_name, "seat_number": "01"}]},
            headers=auth_header(owner_tok),
        )
        assert batch.status_code == 201, batch.text
        owner_student_id = batch.json()["created"][0]["user_id"]

        # Invitee: shares the same self-activated school, owns their own
        # separate classroom, and is invited (but has NOT accepted) as a
        # co-teacher of the owner's classroom.
        invitee_id, invitee_tok = _register_login(client, "pending_leak_invitee")
        act_invitee = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"name": school_name}]},
            headers=auth_header(invitee_tok),
        )
        assert act_invitee.json()["schools"][0]["id"] == school_id, (
            "sanity: owner and invitee must share the same self-activated school"
        )
        cls_invitee = client.post(
            "/api/classrooms",
            json={"name": "PendingLeakInviteeClass", "school_id": school_id, "grade": 4},
            headers=auth_header(invitee_tok),
        )
        assert cls_invitee.status_code == 201, cls_invitee.text
        cls_invitee_id = cls_invitee.json()["id"]

        # The invite endpoint looks up by email; read it back via /me rather
        # than reconstructing _register_login's internal format by guessing.
        me_invitee = client.get("/api/users/me", headers=auth_header(invitee_tok))
        invitee_email = me_invitee.json()["email"]
        invite = client.post(
            f"/api/classrooms/{cls_owner_id}/teachers",
            json={"email": invitee_email, "role": "viewer"},
            headers=auth_header(owner_tok),
        )
        assert invite.status_code == 201, invite.text
        assert invite.json()["status"] == "pending", (
            "test setup requires the invite to still be pending (NOT accepted) "
            "-- that's the exact condition this leak only reproduces under"
        )

        return {
            "owner_tok": owner_tok, "invitee_tok": invitee_tok, "school_id": school_id,
            "cls_owner_id": cls_owner_id, "cls_invitee_id": cls_invitee_id,
            "owner_student_id": owner_student_id, "owner_student_name": unique_name,
        }

    def test_pending_invitee_cannot_search_for_the_other_classrooms_student(self, client, actors):
        # #3816: reuse the module's `client` fixture instead of minting a
        # fresh TestClient per call -- see the note on
        # test_declaring_same_school_does_not_grant_viewing_someone_elses_classroom.
        resp = client.post(
            f"/api/classrooms/{actors['cls_invitee_id']}/students/search",
            json={"query": actors["owner_student_name"]},
            headers=auth_header(actors["invitee_tok"]),
        )
        assert resp.status_code == 200, resp.text
        found_ids = {r["id"] for r in resp.json()}
        assert actors["owner_student_id"] not in found_ids, (
            f"a still-PENDING (not accepted) co-teaching invite must not let the "
            f"invitee search up the other classroom's student: {resp.json()}"
        )

    def test_pending_invitee_cannot_add_the_other_classrooms_student(self, client, actors):
        resp = client.post(
            f"/api/classrooms/{actors['cls_invitee_id']}/students",
            json={"student_id": actors["owner_student_id"]},
            headers=auth_header(actors["invitee_tok"]),
        )
        assert resp.status_code == 404, (
            f"a still-PENDING (not accepted) co-teaching invite must not let the "
            f"invitee enrol the other classroom's student into their own "
            f"classroom: {resp.status_code} {resp.text}"
        )

    def test_positive_control_accepting_the_invite_then_unlocks_it(self, client, actors):
        """Not "nothing ever works" -- once the invite is ACCEPTED, the
        invitee legitimately co-teaches cls_owner_id, so the owner's
        classroom's roster becoming reachable from the invitee's search is
        the correct, intended behavior (#3820: accepted editor/viewer can
        both read). This also proves the two tests above failed for the
        right reason (pending-ness), not because search/add are broken."""
        c = client

        me_invitee = c.get("/api/users/me", headers=auth_header(actors["invitee_tok"]))
        invitee_id = me_invitee.json()["id"]
        accept = c.post(
            f"/api/classrooms/{actors['cls_owner_id']}/teachers/{invitee_id}/accept",
            headers=auth_header(actors["invitee_tok"]),
        )
        assert accept.status_code == 200, accept.text

        search = c.post(
            f"/api/classrooms/{actors['cls_invitee_id']}/students/search",
            json={"query": actors["owner_student_name"]},
            headers=auth_header(actors["invitee_tok"]),
        )
        assert search.status_code == 200, search.text
        assert actors["owner_student_id"] in {r["id"] for r in search.json()}, (
            f"positive control failed: once ACCEPTED, the invitee should be "
            f"able to find the co-taught classroom's student: {search.json()}"
        )


# ===========================================================================
# 9. Claude Security finding find_01RzZ2bXyjs6SrNmD7KkKy91 (high), part 3 of
#    its recommendation -- create_classroom's only gate is is_school_member,
#    which counts ANY school-scoped role, including a plain `student`
#    (e.g. granted automatically on join-by-code, or on self-activation of
#    a `student` row). A student (or any school-scoped non-teacher) could
#    therefore create a classroom at that school and, via the chain the
#    rest of this finding covers, enrol and reset the password of other
#    students there. Fixed in classroom_crud.py::create_classroom to
#    require a school-scoped `teacher` role specifically (or system_admin).
# ===========================================================================


class TestCreateClassroomRequiresATeacherRoleAtTheSchool:
    @pytest.fixture(scope="class")
    def school_id(self):
        session = TestingSessionLocal()
        school = School(name=f"建班權限測試國小_{uuid.uuid4().hex[:6]}")
        session.add(school)
        session.commit()
        sid = school.id
        session.close()
        return sid

    def _grant_school_scoped_role(self, user_id: int, role_name: str, school_id: int) -> None:
        session = TestingSessionLocal()
        try:
            role = session.query(Role).filter(Role.name == role_name).first()
            session.add(
                UserRole(
                    user_id=user_id,
                    role_id=role.id,
                    scope_type="school",
                    scope_id=str(school_id),
                )
            )
            session.commit()
        finally:
            session.close()

    def test_a_student_scoped_to_the_school_cannot_create_a_classroom_there(self, client, school_id):
        student_id, student_tok = _register_login(client, "create_cls_student")
        self._grant_school_scoped_role(student_id, "student", school_id)

        resp = client.post(
            "/api/classrooms",
            json={"name": "ShouldNotExist", "school_id": school_id, "grade": 4},
            headers=auth_header(student_tok),
        )
        assert resp.status_code == 403, (
            f"a school-scoped STUDENT must not be able to create a classroom "
            f"at that school: {resp.status_code} {resp.text}"
        )

    def test_positive_control_a_teacher_scoped_to_the_school_can_create_a_classroom(self, client, school_id):
        teacher_id, teacher_tok = _register_login(client, "create_cls_teacher")
        self._grant_school_scoped_role(teacher_id, "teacher", school_id)

        resp = client.post(
            "/api/classrooms",
            json={"name": "ShouldExist", "school_id": school_id, "grade": 4},
            headers=auth_header(teacher_tok),
        )
        assert resp.status_code == 201, (
            f"positive control failed: a school-scoped TEACHER must still be "
            f"able to create a classroom at that school: "
            f"{resp.status_code} {resp.text}"
        )
