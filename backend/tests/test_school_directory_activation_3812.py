"""#3812 — activate-teacher binds to the MOE directory by code, not by name.

Young (2026-11-02, verbatim): "後端：開通老師如果帶的是 moe_school_code，就
綁到名錄那間學校，不再用校名比對；用校名比對正是錯字會把學校拆成兩間的根源。"

Also covers the two other pieces of this same instruction:
- "找不到我的學校" manual entry is stored as a to-be-confirmed school, not
  silently treated as an official one (PRD §4.4 addendum).
- The directory search ranking fix: a near-miss typo candidate must not be
  pushed down purely by import order (county) when scores tie.

Follows the TestClient + SQLite-in-memory pattern from
test_school_directory_api_3804.py / test_self_serve_teacher_3804.py.
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
from app.models.user import Role, UserRole

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

# The exact decoy set that reproduced the real bug on staging 2026-11-02:
# searching "大按國小" (typo for 大安國小) with no county filter put the
# phonetically-correct match (安, pinyin "an") 10th, behind a dozen
# "大X國小" schools from an earlier-imported county that tie on raw
# character-overlap score with the query but share NO phonetic relationship
# to the typo at all (同 tong, 埔 pu, 成 cheng, ...).
_DECOY_NAMES = ["大同國小", "大埔國小", "大成國小", "大鵬國小", "大坪國小", "大豐國小", "大觀國小", "大崁國小"]


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))

    # Decoys inserted FIRST (mirrors elementary.csv listing 新北市 before
    # 台北市) so a stable sort on tied scores alone would rank them ahead.
    for i, name in enumerate(_DECOY_NAMES):
        session.add(
            School(
                name=f"市立{name}",
                moe_school_code=f"DECOY{i:03d}",
                county_name="新北市",
                school_level="elementary",
                is_public=True,
            )
        )
    # The actual target, inserted AFTER all the decoys.
    session.add(
        School(
            name="市立大安國小",
            moe_school_code="333602",
            county_name="台北市",
            school_level="elementary",
            is_public=True,
        )
    )
    # A second directory school sharing the exact same name in a different
    # county -- the "two typos, same code, same school" test picks THIS one
    # by code to prove code-based binding ignores name collisions entirely.
    session.add(
        School(
            name="市立大安國小",
            moe_school_code="034651",
            county_name="桃園市",
            school_level="elementary",
            is_public=True,
        )
    )
    session.commit()
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


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
    r = client.post("/api/auth/register", json={"email": email, "password": "Secure99!", "name": label})
    assert r.status_code == 201, r.text
    tok = r.json().get("verification_token")
    if tok:
        client.get(f"/api/auth/verify-email?token={tok}")
    _reset_rate_limiters()
    login = client.post("/api/auth/login", json={"email": email, "password": "Secure99!"})
    assert login.status_code == 200, login.text
    access = login.json()["access_token"]
    me = client.get("/api/users/me", headers=auth_header(access))
    return me.json()["id"], access


# ===========================================================================
# 1. Activating with a moe_school_code binds directly -- no name matching
# ===========================================================================


class TestActivateWithMoeSchoolCode:
    def test_activating_with_a_code_binds_to_that_exact_directory_row(self, client):
        """There are TWO schools named "市立大安國小" (Taipei 333602, Taoyuan
        034651) -- the whole point of code-based binding is that passing the
        Taoyuan code must bind to the TAOYUAN row, not whichever one a
        name-based `.first()` query happens to return."""
        _, token = _register_login(client, "code_bind")
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"moe_school_code": "034651"}]},
            headers=auth_header(token),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert len(data["schools"]) == 1
        assert data["schools"][0]["id"] is not None
        assert data["schools"][0]["is_new"] is False

        school_id = data["schools"][0]["id"]
        db = TestingSessionLocal()
        try:
            school = db.get(School, school_id)
            assert school.moe_school_code == "034651"
            assert school.county_name == "桃園市"
        finally:
            db.close()

    def test_two_people_with_different_typos_picking_the_same_code_land_on_the_same_school(self, client):
        """This is the actual bug #3812 fixes: before, teacher A typing
        "大安國小" and teacher B typing "大安过小" (OCR-ish typo) would risk
        matching different rows (or one creating a duplicate) purely from
        string comparison. With code-based binding, as long as both picked
        the SAME search result (same code), they land on the identical
        school.id regardless of what either of them actually typed."""
        _, token_a = _register_login(client, "typo_a")
        _, token_b = _register_login(client, "typo_b")

        resp_a = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"moe_school_code": "333602"}]},
            headers=auth_header(token_a),
        )
        resp_b = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"moe_school_code": "333602"}]},
            headers=auth_header(token_b),
        )
        assert resp_a.status_code == 200, resp_a.text
        assert resp_b.status_code == 200, resp_b.text
        shared_id = resp_a.json()["schools"][0]["id"]
        assert shared_id == resp_b.json()["schools"][0]["id"]

        # Not just "both calls produced the same id" (a name-matching
        # mutation that creates one new school named literally "333602" and
        # has the second call match it by that same literal string would
        # ALSO pass that weaker assertion) -- pin down that the shared
        # school is the REAL imported directory row, not a freshly-created
        # one that merely happens to be shared.
        db = TestingSessionLocal()
        try:
            school = db.get(School, shared_id)
            assert school.moe_school_code == "333602"
            assert school.county_name == "台北市"
        finally:
            db.close()

    def test_an_unknown_code_is_rejected_not_silently_turned_into_a_new_school(self, client):
        _, token = _register_login(client, "bad_code")
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"moe_school_code": "NOT-A-REAL-CODE"}]},
            headers=auth_header(token),
        )
        assert resp.status_code == 404, resp.text

    def test_activating_with_code_is_idempotent(self, client):
        _, token = _register_login(client, "code_idem")
        resolved_ids = set()
        for _ in range(2):
            resp = client.post(
                "/api/users/me/activate-teacher",
                json={"schools": [{"moe_school_code": "333602"}]},
                headers=auth_header(token),
            )
            assert resp.status_code == 200, resp.text
            resolved_ids.add(resp.json()["schools"][0]["id"])

        assert len(resolved_ids) == 1, f"both calls must resolve to the same school id, got {resolved_ids}"

        db = TestingSessionLocal()
        try:
            school = db.get(School, next(iter(resolved_ids)))
            assert school.moe_school_code == "333602", (
                "idempotency must hold on the REAL directory row -- a mutation "
                "that routes the code through name-matching instead would also "
                "look idempotent (same literal string matches itself) without "
                "ever actually binding to the directory"
            )
            me = client.get("/api/users/me", headers=auth_header(token)).json()
            user_id = me["id"]
            count = (
                db.query(UserRole)
                .filter(UserRole.user_id == user_id, UserRole.scope_type == "school")
                .count()
            )
            assert count == 1, f"expected exactly one school-scoped role, got {count}"
        finally:
            db.close()


# ===========================================================================
# 1a. Claude Security find_019JwPDXdBingpryA61iCoJR (high) / issue #3931:
#     "Self-activated teacher at a directory or admin-created school can
#     enrol and read any student there." The admin-created-school half of
#     this chain already has a regression test
#     (test_self_serve_teacher_3804.py::
#     test_self_activating_into_an_admin_created_school_grants_an_inactive_
#     role). The MOE-DIRECTORY-BY-CODE half -- the other attack vector the
#     finding names -- had none: every test in TestActivateWithMoeSchoolCode
#     above checks `is_new is False` but never `role_active`, so a
#     regression in the code-path specifically (as opposed to the
#     name-matching path find_01RzZ2bXyjs6SrNmD7KkKy91's fix actually
#     touches) would have shipped silently. Closing that gap here, plus the
#     end-to-end chain the finding's own fix criteria names explicitly:
#     "Enrolling such a student returns 404 [and] that account also cannot
#     read the student's sessions or mint a preview token for them" --
#     verified by confirming the chain is dead at its FIRST step
#     (create_classroom), since every other step in the finding's chain
#     requires a classroom this account cannot create.
# ===========================================================================


class TestMoeDirectorySelfActivationGrantsNoRealAccess:
    def test_activating_by_code_into_a_directory_school_grants_an_inactive_role(self, client):
        """The MOE-directory-by-code counterpart to
        test_self_activating_into_an_admin_created_school_grants_an_inactive_role
        -- same property, the other of the finding's two named attack
        vectors, and the one path within activate_teacher_for_schools that
        test_activating_with_a_code_binds_to_that_exact_directory_row never
        actually checked `role_active` for."""
        _, token = _register_login(client, "moe_code_pending_confirm")
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"moe_school_code": "333602"}]},  # 市立大安國小, 台北市 -- genuinely pre-existing, not self-activation-born
            headers=auth_header(token),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()["schools"][0]
        assert data["is_new"] is False, "sanity: this must be the pre-seeded directory row, not a new one"
        assert data["role_active"] is False, (
            "self-activating by MOE code into a genuinely pre-existing directory "
            "school must grant an INACTIVE role -- an active one here is exactly "
            "find_019JwPDXdBingpryA61iCoJR's attack vector"
        )

        me = client.get("/api/users/me", headers=auth_header(token)).json()
        school_id = data["id"]
        assert not any(
            r["role_name"] == "teacher" and r["scope_id"] == str(school_id)
            for r in me["roles"]
        ), "an inactive role must not appear as an active teacher role in /users/me"

    def test_self_activated_moe_directory_teacher_cannot_create_a_classroom_there(self, client):
        """End-to-end: find_019JwPDXdBingpryA61iCoJR's whole attack chain
        (self-activate -> create a classroom -> search/enrol/read students)
        starts with creating a classroom. With an inactive role,
        is_school_teacher() returns False and create_classroom's own gate
        (classroom_crud.py, Claude Security find_01RzZ2bXyjs6SrNmD7KkKy91
        part 3) refuses it -- every later step in the finding's chain
        (search_students_for_classroom, add_student_to_classroom,
        require_student_visible_to_teacher, teacher_preview's preview-token
        mint) is unreachable without a classroom id this account owns, so
        closing this one step closes the whole chain."""
        _, token = _register_login(client, "moe_code_attacker")
        activate = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"moe_school_code": "034651"}]},  # 市立大安國小, 桃園市
            headers=auth_header(token),
        )
        assert activate.status_code == 200, activate.text
        school_id = activate.json()["schools"][0]["id"]
        assert activate.json()["schools"][0]["role_active"] is False  # positive control for the gate below

        resp = client.post(
            "/api/classrooms",
            json={"name": "滲透測試班級", "school_id": school_id, "grade": 4},
            headers=auth_header(token),
        )
        assert resp.status_code == 403, (
            f"an inactive, self-activated-by-code teacher role must not be able to "
            f"create a classroom at that school -- got {resp.status_code}: {resp.text}"
        )

    def test_positive_control_an_active_teacher_at_the_same_directory_school_can_create_a_classroom(self, client):
        """Negative control for the test above: the 403 is specific to the
        inactive-role attacker, not e.g. a missing fixture or a broken
        route -- a REAL teacher at the identical directory school (admin-
        granted, bypassing self-activation) must still succeed."""
        from app.models.user import Role, UserRole

        _, token = _register_login(client, "moe_code_real_teacher")
        user_id = client.get("/api/users/me", headers=auth_header(token)).json()["id"]

        db = TestingSessionLocal()
        try:
            school = db.query(School).filter(School.moe_school_code == "333602").first()
            teacher_role = db.query(Role).filter(Role.name == "teacher").first()
            db.add(
                UserRole(
                    user_id=user_id,
                    role_id=teacher_role.id,
                    scope_type="school",
                    scope_id=str(school.id),
                    is_active=True,
                )
            )
            db.commit()
            school_id = school.id
        finally:
            db.close()

        resp = client.post(
            "/api/classrooms",
            json={"name": "真老師的班級", "school_id": school_id, "grade": 4},
            headers=auth_header(token),
        )
        assert resp.status_code == 201, (
            f"a genuinely active teacher role at this same school must be able to "
            f"create a classroom -- got {resp.status_code}: {resp.text}"
        )


# ===========================================================================
# 1b. Backward compatibility: the pre-#3812 `school_names` field must keep
#     working (CI found this the hard way: 3 security regression locks in
#     tests/security/test_dynamic_security.py and the Playwright game E2E
#     helpers all still send `school_names`, which this app's own rolling
#     deploy can also momentarily send if the frontend lags the backend).
#     "不要改名" -- Young: accept BOTH shapes, don't force every caller to
#     migrate in lockstep.
# ===========================================================================


class TestLegacySchoolNamesFieldStillWorks:
    def test_school_names_only_still_activates_by_name_matching(self, client):
        _, token = _register_login(client, "legacy_caller")
        unique_name = f"舊呼叫方學校_{uuid.uuid4().hex[:6]}"
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [unique_name]},
            headers=auth_header(token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["schools"][0]["name"] == unique_name

    def test_neither_schools_nor_school_names_is_rejected(self, client):
        _, token = _register_login(client, "legacy_empty")
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={},
            headers=auth_header(token),
        )
        assert resp.status_code == 422, resp.text

    def test_schools_and_school_names_can_both_be_sent_in_one_request(self, client):
        _, token = _register_login(client, "legacy_mixed")
        legacy_name = f"舊混合請求學校_{uuid.uuid4().hex[:6]}"
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"moe_school_code": "333602"}], "school_names": [legacy_name]},
            headers=auth_header(token),
        )
        assert resp.status_code == 200, resp.text
        assert len(resp.json()["schools"]) == 2


# ===========================================================================
# 2. Manual fallback ("找不到我的學校") -- stored as to-be-confirmed, not a
#    formal school. Young (verbatim): "依 PRD 存成待確認的學校，不要直接新建
#    正式學校。"
# ===========================================================================


class TestManualFallbackIsMarkedPendingReview:
    def test_a_brand_new_manual_name_is_flagged_pending_review(self, client):
        _, token = _register_login(client, "manual_new")
        unique_name = f"手動輸入學校_{uuid.uuid4().hex[:6]}"
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"name": unique_name}]},
            headers=auth_header(token),
        )
        assert resp.status_code == 200, resp.text
        school_id = resp.json()["schools"][0]["id"]

        db = TestingSessionLocal()
        try:
            school = db.get(School, school_id)
            assert school.settings is not None
            assert school.settings.get("created_via") == "self_activation"
            assert school.settings.get("pending_review") is True, (
                "a brand-new manually-typed school must be flagged pending_review "
                f"so it isn't indistinguishable from an official MOE-recognized school. settings={school.settings}"
            )
            assert school.moe_school_code is None
        finally:
            db.close()

    def test_manual_name_matching_an_existing_school_joins_it_without_flagging_it(self, client):
        """Typing a name that happens to match an EXISTING row (directory or
        otherwise) must still just join it -- not retroactively mark an
        established school as pending_review."""
        _, token = _register_login(client, "manual_match_existing")
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"name": "市立大安國小"}]},
            headers=auth_header(token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["schools"][0]["is_new"] is False

        db = TestingSessionLocal()
        try:
            school = db.get(School, resp.json()["schools"][0]["id"])
            assert school.moe_school_code is not None, "must have joined an existing directory row, not created one"
            assert not (school.settings or {}).get("pending_review"), "an existing directory school must not be flagged pending_review"
        finally:
            db.close()

    def test_mixing_a_code_selection_and_a_manual_entry_in_one_request_works(self, client):
        _, token = _register_login(client, "mixed")
        unique_name = f"混合請求手動校_{uuid.uuid4().hex[:6]}"
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"moe_school_code": "333602"}, {"name": unique_name}]},
            headers=auth_header(token),
        )
        assert resp.status_code == 200, resp.text
        assert len(resp.json()["schools"]) == 2

    def test_a_school_entry_needs_exactly_one_of_code_or_name(self, client):
        _, token = _register_login(client, "neither")
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{}]},
            headers=auth_header(token),
        )
        assert resp.status_code == 422, resp.text

    def test_a_school_entry_cannot_have_both_code_and_name(self, client):
        _, token = _register_login(client, "both")
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"schools": [{"moe_school_code": "333602", "name": "市立大安國小"}]},
            headers=auth_header(token),
        )
        assert resp.status_code == 422, resp.text


# ===========================================================================
# 3. Directory search ranking fix -- a near-miss must not be pushed down
#    purely by import order when scores tie (the "大按國小" -> 大安國小 bug).
# ===========================================================================


class TestDirectorySearchRankingIsNotBiasedByImportOrder:
    def test_a_phonetically_close_typo_outranks_unrelated_same_score_decoys(self, client):
        """8 decoys ("大同/大埔/大成/大鵬/大坪/大豐/大觀/大崁國小") were seeded
        BEFORE 市立大安國小 and all tie with it at the same raw
        difflib.SequenceMatcher ratio (0.75) against the query "大按國小" --
        verified empirically (every "大X國小" 4-char name ties at exactly
        0.75 regardless of which character X is). A stable sort over tied
        scores would keep the decoys' earlier insertion order ahead of it,
        which is exactly the reported bug (大安國小 landed 10th).

        This must rank 大安國小 ahead of ALL the unrelated decoys -- not
        necessarily literally 1st against the whole candidate pool, but
        strictly better than every single one of the 8 decoys, since 按/安
        share the same pinyin reading (an) and none of the decoy characters
        (同/埔/成/鵬/坪/豐/觀/崁) share any reading with it.
        """
        _, token = _register_login(client, "ranking")
        resp = client.get(
            "/api/schools/directory/search?q=大按國小",
            headers=auth_header(token),
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        codes_in_order = [item["moe_school_code"] for item in items]
        assert "333602" in codes_in_order, f"大安國小 missing entirely from results: {codes_in_order}"

        target_rank = codes_in_order.index("333602")
        decoy_codes = {f"DECOY{i:03d}" for i in range(len(_DECOY_NAMES))}
        decoy_ranks = [codes_in_order.index(c) for c in codes_in_order if c in decoy_codes]
        assert decoy_ranks, "decoys must still appear in results (they are legitimate >=0.6 matches too)"
        assert target_rank < min(decoy_ranks), (
            f"大安國小 (333602) ranked {target_rank}, but at least one unrelated decoy "
            f"ranked ahead of it (decoy ranks: {sorted(decoy_ranks)}). Full order: {codes_in_order}"
        )
