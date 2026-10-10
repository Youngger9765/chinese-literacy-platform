"""
Tests for issue #3380 — import classes/students from Junyi via BigQuery.

Architecture under test (see issue #3380 for full rationale):
- On-demand query at import time (no nightly sync, no new DB table).
- Feature flag: settings.junyi_class_import_enabled (default False) — fully
  gates GET + POST endpoints with 404 when off.
- `FakeJunyiBigQueryClient` stands in for BigQuery in every test via FastAPI
  dependency override — the autouse `_no_outbound_network` fixture in
  conftest.py would hard-fail any test that tried to reach real BigQuery, so
  this also proves the route layer never touches the network in tests.
- The verified ID mapping uses "user_id_key_" + User.junyi_identity_id;
  malformed prefixes still fail closed.
- Dedup: students by User.junyi_identity_id, then an unlinked email account;
  classrooms by (teacher_id, junyi_class_id) with a partial unique index.

Run:
    cd backend && python -m pytest tests/test_junyi_class_import.py -v
"""

import os
import sys
import uuid
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, User, UserRole
from app.models.school import Classroom, ClassroomStudent, School
from app.config import settings

# ---------------------------------------------------------------------------
# Test database setup (self-contained — mirrors test_csv_upload.py)
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

SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin", "display_name": "Organization Admin", "scope_level": "organization"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]


def _seed_roles(session):
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    session.commit()


def _seed_school(session, name="Junyi Import Test School") -> int:
    school = School(name=name)
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


_test_school_id: int = 0
_other_school_id: int = 0


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _test_school_id, _other_school_id
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    _test_school_id = _seed_school(session, "Junyi Import Test School")
    _other_school_id = _seed_school(session, "Junyi Import Other School")
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


def _register_teacher(client, suffix: str, school_id: int, junyi_identity_id: str | None = None) -> dict:
    """Register + verify + log in a teacher, scoped to school_id.

    Optionally links a junyi_identity_id directly on the User row (bypassing
    the real Junyi SSO flow, which is out of scope for this test file).
    """
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{suffix.title()} {unique}"
    resp = client.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    assert resp.status_code == 201
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    user_id = me_resp.json()["id"]

    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == "teacher").first()
        db.add(UserRole(user_id=user_id, role_id=role.id, scope_type="school", scope_id=str(school_id)))
        if junyi_identity_id is not None:
            user = db.query(User).filter(User.id == user_id).first()
            user.junyi_identity_id = junyi_identity_id
        db.commit()
    finally:
        db.close()

    return {"email": email, "name": name, "token": token, "user_id": user_id, "school_id": school_id}


# ---------------------------------------------------------------------------
# Fake BigQuery client + dependency override wiring
#
# Imported lazily inside each test (not at module scope) because the service
# module does not exist yet at RED time — importing it at collection time
# would turn every test in this file into a collection error instead of a
# clean, individually-attributable failure.
# ---------------------------------------------------------------------------


def _bq_dependency_override(fake_client):
    from app.routes.classrooms.classroom_junyi_import import get_junyi_bq_client

    def _override():
        return fake_client

    return get_junyi_bq_client, _override


def _make_fake_client(rows):
    from app.services.junyi_bigquery_client import FakeJunyiBigQueryClient

    return FakeJunyiBigQueryClient(rows)


def _row(teacher_key, class_id, class_name, student_key, student_nickname, class_code="ABCDE",
         user_data_nickname=None, user_data_username=None, user_data_email=None):
    return {
        "teacher_user_id": teacher_key,
        "class_id": class_id,
        "class_name": class_name,
        "class_code": class_code,
        "student_user_id": student_key,
        "student_nickname": student_nickname,
        "user_data_nickname": user_data_nickname,
        "user_data_username": user_data_username,
        "user_data_email": user_data_email,
    }


@pytest.fixture(autouse=True)
def _enable_flag_by_default():
    """Most tests want the flag ON; the dedicated flag-off tests flip it back."""
    original = settings.junyi_class_import_enabled
    settings.junyi_class_import_enabled = True
    yield
    settings.junyi_class_import_enabled = original


@pytest.fixture(autouse=True)
def _clear_bq_override():
    yield
    from app.routes.classrooms.classroom_junyi_import import get_junyi_bq_client

    app.dependency_overrides.pop(get_junyi_bq_client, None)


# ===========================================================================
# Feature flag gate
# ===========================================================================


class TestFeatureFlagOff:
    def test_list_classes_404_when_flag_disabled(self, client):
        settings.junyi_class_import_enabled = False
        teacher = _register_teacher(client, "flagoff_list", _test_school_id, junyi_identity_id="http://id.ju/flagoff1")
        resp = client.get(
            f"/api/classrooms/junyi-import/classes?school_id={_test_school_id}",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404

    def test_import_404_when_flag_disabled(self, client):
        settings.junyi_class_import_enabled = False
        teacher = _register_teacher(client, "flagoff_import", _test_school_id, junyi_identity_id="http://id.ju/flagoff2")
        resp = client.post(
            "/api/classrooms/junyi-import/import",
            json={"school_id": _test_school_id, "junyi_class_ids": ["c1"]},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404


# ===========================================================================
# Teacher without junyi_identity_id — hide / explain, never error
# ===========================================================================


class TestUnlinkedTeacher:
    def test_list_classes_reports_not_linked(self, client):
        teacher = _register_teacher(client, "unlinked", _test_school_id, junyi_identity_id=None)
        resp = client.get(
            f"/api/classrooms/junyi-import/classes?school_id={_test_school_id}",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["linked"] is False
        assert body["classes"] == []

    def test_import_rejected_for_unlinked_teacher(self, client):
        teacher = _register_teacher(client, "unlinked_import", _test_school_id, junyi_identity_id=None)
        resp = client.post(
            "/api/classrooms/junyi-import/import",
            json={"school_id": _test_school_id, "junyi_class_ids": ["c1"]},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 400


# ===========================================================================
# Fail-closed ID mapping
# ===========================================================================


class TestFailClosedMapping:
    def test_no_matching_bq_rows_returns_empty_not_error(self, client):
        """Teacher IS linked, but the (unverified) 'user_id_key_' + id guess
        doesn't match anything in BigQuery. Must look like "no classes yet",
        never crash, never fabricate a class."""
        teacher = _register_teacher(client, "nomatch", _test_school_id, junyi_identity_id="http://id.ju/nomatch")
        fake = _make_fake_client(rows=[])  # empty table for this teacher
        dep, override = _bq_dependency_override(fake)
        app.dependency_overrides[dep] = override

        resp = client.get(
            f"/api/classrooms/junyi-import/classes?school_id={_test_school_id}",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["linked"] is True
        assert body["classes"] == []

    def test_malformed_student_user_id_is_skipped_not_imported(self, client):
        """One row's student_user_id does NOT have the 'user_id_key_' prefix
        (simulates the mapping guess being wrong for that row). That student
        must be silently skipped — never crash the whole import, never create
        a user with a garbage identity."""
        teacher = _register_teacher(client, "malformed", _test_school_id, junyi_identity_id="http://id.ju/malformed")
        teacher_key = f"user_id_key_http://id.ju/malformed"
        rows = [
            _row(teacher_key, "jclass-1", "均一一班", "user_id_key_studentA", "小明"),
            _row(teacher_key, "jclass-1", "均一一班", "NOT_PREFIXED_studentB", "小華"),
        ]
        fake = _make_fake_client(rows)
        dep, override = _bq_dependency_override(fake)
        app.dependency_overrides[dep] = override

        resp = client.post(
            "/api/classrooms/junyi-import/import",
            json={"school_id": _test_school_id, "junyi_class_ids": ["jclass-1"]},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["added_students"] == 1  # only studentA, studentB skipped

        db = TestingSessionLocal()
        try:
            assert db.query(User).filter(User.junyi_identity_id == "studentA").count() == 1
            assert db.query(User).filter(User.junyi_identity_id == "NOT_PREFIXED_studentB").count() == 0
        finally:
            db.close()


# ===========================================================================
# Dedup — students
# ===========================================================================


class TestStudentDedup:
    def test_reimport_adds_only_new_students(self, client):
        teacher = _register_teacher(client, "dedup_students", _test_school_id, junyi_identity_id="http://id.ju/dedup1")
        teacher_key = "user_id_key_http://id.ju/dedup1"
        rows = [
            _row(teacher_key, "jclass-dedup", "均一二班", "user_id_key_stuA", "小安"),
            _row(teacher_key, "jclass-dedup", "均一二班", "user_id_key_stuB", "小貝"),
        ]
        fake = _make_fake_client(rows)
        dep, override = _bq_dependency_override(fake)
        app.dependency_overrides[dep] = override

        resp1 = client.post(
            "/api/classrooms/junyi-import/import",
            json={"school_id": _test_school_id, "junyi_class_ids": ["jclass-dedup"]},
            headers=auth_header(teacher["token"]),
        )
        assert resp1.status_code == 200
        assert resp1.json()["added_students"] == 2
        assert resp1.json()["skipped_existing_students"] == 0

        # Junyi adds one more student to the same class before re-import.
        rows.append(_row(teacher_key, "jclass-dedup", "均一二班", "user_id_key_stuC", "小丙"))
        fake2 = _make_fake_client(rows)
        app.dependency_overrides[dep] = lambda: fake2

        resp2 = client.post(
            "/api/classrooms/junyi-import/import",
            json={"school_id": _test_school_id, "junyi_class_ids": ["jclass-dedup"]},
            headers=auth_header(teacher["token"]),
        )
        assert resp2.status_code == 200
        body2 = resp2.json()
        assert body2["added_students"] == 1  # only stuC
        assert body2["skipped_existing_students"] == 2  # stuA, stuB already enrolled

        db = TestingSessionLocal()
        try:
            assert db.query(User).filter(User.junyi_identity_id == "stuA").count() == 1
            assert db.query(User).filter(User.junyi_identity_id == "stuB").count() == 1
            assert db.query(User).filter(User.junyi_identity_id == "stuC").count() == 1
        finally:
            db.close()

    def test_existing_account_reused_not_duplicated(self, client):
        """A student who already has a LingoLeap account (e.g. logged in
        directly via Junyi SSO before any teacher imported their class) must
        be reused by junyi_identity_id — not duplicated."""
        teacher = _register_teacher(client, "dedup_existing", _test_school_id, junyi_identity_id="http://id.ju/dedup2")
        teacher_key = "user_id_key_http://id.ju/dedup2"

        # Pre-existing student account from a prior direct Junyi SSO login.
        db = TestingSessionLocal()
        try:
            from app.auth.password import hash_password
            import secrets as _secrets

            existing = User(
                email="preexisting_student@example.com",
                password_hash=hash_password(_secrets.token_hex(32)),
                name="已經登入過的學生",
                junyi_identity_id="stuPre",
                email_verified=True,
            )
            db.add(existing)
            db.commit()
            db.refresh(existing)
            existing_user_id = existing.id
        finally:
            db.close()

        rows = [_row(teacher_key, "jclass-existing", "均一三班", "user_id_key_stuPre", "學生")]
        fake = _make_fake_client(rows)
        dep, override = _bq_dependency_override(fake)
        app.dependency_overrides[dep] = override

        resp = client.post(
            "/api/classrooms/junyi-import/import",
            json={"school_id": _test_school_id, "junyi_class_ids": ["jclass-existing"]},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["added_students"] == 1

        db = TestingSessionLocal()
        try:
            assert db.query(User).filter(User.junyi_identity_id == "stuPre").count() == 1
            cs = (
                db.query(ClassroomStudent)
                .join(Classroom)
                .filter(Classroom.name == "均一三班", ClassroomStudent.student_id == existing_user_id)
                .first()
            )
            assert cs is not None
        finally:
            db.close()


# ===========================================================================
# Dedup — classrooms
# ===========================================================================


class TestClassroomDedup:
    def test_reimport_same_class_does_not_duplicate_classroom(self, client):
        teacher = _register_teacher(client, "dedup_class", _test_school_id, junyi_identity_id="http://id.ju/dedupclass")
        teacher_key = "user_id_key_http://id.ju/dedupclass"
        rows = [_row(teacher_key, "jclass-dc", "均一四班", "user_id_key_stuDC", "小德")]
        fake = _make_fake_client(rows)
        dep, override = _bq_dependency_override(fake)
        app.dependency_overrides[dep] = override

        for _ in range(2):
            resp = client.post(
                "/api/classrooms/junyi-import/import",
                json={"school_id": _test_school_id, "junyi_class_ids": ["jclass-dc"]},
                headers=auth_header(teacher["token"]),
            )
            assert resp.status_code == 200

        db = TestingSessionLocal()
        try:
            count = (
                db.query(Classroom)
                .filter(Classroom.teacher_id == teacher["user_id"], Classroom.name == "均一四班")
                .count()
            )
            assert count == 1
        finally:
            db.close()

    def test_already_imported_class_flagged_in_listing(self, client):
        teacher = _register_teacher(client, "already_imp", _test_school_id, junyi_identity_id="http://id.ju/alreadyimp")
        teacher_key = "user_id_key_http://id.ju/alreadyimp"
        rows = [_row(teacher_key, "jclass-ai", "均一五班", "user_id_key_stuAI", "小艾")]
        fake = _make_fake_client(rows)
        dep, override = _bq_dependency_override(fake)
        app.dependency_overrides[dep] = override

        before = client.get(
            f"/api/classrooms/junyi-import/classes?school_id={_test_school_id}",
            headers=auth_header(teacher["token"]),
        ).json()
        assert before["classes"][0]["already_imported"] is False

        client.post(
            "/api/classrooms/junyi-import/import",
            json={"school_id": _test_school_id, "junyi_class_ids": ["jclass-ai"]},
            headers=auth_header(teacher["token"]),
        )

        after = client.get(
            f"/api/classrooms/junyi-import/classes?school_id={_test_school_id}",
            headers=auth_header(teacher["token"]),
        ).json()
        assert after["classes"][0]["already_imported"] is True


# ===========================================================================
# Authorization — lowest-privilege role + positive control + IDOR
# ===========================================================================


class TestAuthorization:
    def test_student_role_cannot_list_or_import(self, client):
        user = _register_teacher(client, "student_role", _test_school_id, "student-role")
        with TestingSessionLocal() as db:
            db.query(UserRole).filter(UserRole.user_id == user["user_id"]).delete()
            student_role = db.query(Role).filter(Role.name == "student").one()
            db.add(UserRole(user_id=user["user_id"], role_id=student_role.id, scope_type="school", scope_id=str(_test_school_id)))
            db.commit()
        headers = auth_header(user["token"])
        assert client.get(f"/api/classrooms/junyi-import/classes?school_id={_test_school_id}", headers=headers).status_code == 403
        assert client.post("/api/classrooms/junyi-import/import", json={"school_id": _test_school_id, "junyi_class_ids": ["x"]}, headers=headers).status_code == 403

    def test_unauthenticated_cannot_list_or_import(self, client):
        assert client.get(f"/api/classrooms/junyi-import/classes?school_id={_test_school_id}").status_code == 401
        assert client.post("/api/classrooms/junyi-import/import", json={"school_id": _test_school_id, "junyi_class_ids": ["x"]}).status_code == 401

    def test_teacher_without_school_membership_forbidden(self, client):
        """Lowest-privilege role (plain 'teacher'), but NOT a member of the
        school being queried — must be rejected, same boundary as
        create_classroom."""
        teacher = _register_teacher(client, "no_membership", _test_school_id, junyi_identity_id="http://id.ju/nomember")
        resp = client.get(
            f"/api/classrooms/junyi-import/classes?school_id={_other_school_id}",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 403

    def test_positive_control_own_school_succeeds(self, client):
        """Same lowest-privilege role, querying their OWN school — proves the
        403 above is a real boundary, not a blanket rejection."""
        teacher = _register_teacher(client, "positive_ctrl", _test_school_id, junyi_identity_id="http://id.ju/posctrl")
        resp = client.get(
            f"/api/classrooms/junyi-import/classes?school_id={_test_school_id}",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["linked"] is True

    def test_cannot_import_another_teachers_junyi_class_idor(self, client):
        """Core cross-tenant guard: Teacher A requests a junyi_class_id that
        belongs to Teacher B in BigQuery (same shared fake table). The real
        BQ query is always scoped `WHERE teacher_user_id = @caller`, so
        Teacher A's query simply never returns Teacher B's rows — this test
        proves the route layer can't be tricked into processing it either."""
        teacher_a = _register_teacher(client, "idor_a", _test_school_id, junyi_identity_id="http://id.ju/idorA")
        teacher_b_key = "user_id_key_http://id.ju/idorB"

        # Shared fake "table": class jclass-victim belongs to teacher B only.
        rows = [_row(teacher_b_key, "jclass-victim", "受害班級", "user_id_key_victimStu", "受害學生")]
        fake = _make_fake_client(rows)
        dep, override = _bq_dependency_override(fake)
        app.dependency_overrides[dep] = override

        resp = client.post(
            "/api/classrooms/junyi-import/import",
            json={"school_id": _test_school_id, "junyi_class_ids": ["jclass-victim"]},
            headers=auth_header(teacher_a["token"]),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["added_students"] == 0
        assert body["classes_created"] == 0

        db = TestingSessionLocal()
        try:
            assert db.query(User).filter(User.junyi_identity_id == "victimStu").count() == 0
            assert db.query(Classroom).filter(Classroom.name == "受害班級").count() == 0
        finally:
            db.close()


def _import_rows(client, teacher, rows, class_ids):
    fake = _make_fake_client(rows)
    dep, override = _bq_dependency_override(fake)
    app.dependency_overrides[dep] = override
    return client.post(
        "/api/classrooms/junyi-import/import",
        json={"school_id": _test_school_id, "junyi_class_ids": class_ids},
        headers=auth_header(teacher["token"]),
    )


# PRD R5 -- display name fallback order
class TestDisplayNameFallback:
    def test_empty_nickname_falls_back_to_username(self, client):
        teacher = _register_teacher(client, "name_user", _test_school_id, "name-user")
        row = _row("user_id_key_name-user", "name-class", "名字班", "user_id_key_name-stu", "", user_data_username="qizhuo")
        assert _import_rows(client, teacher, [row], ["name-class"]).status_code == 200
        with TestingSessionLocal() as db:
            assert db.query(User).filter(User.junyi_identity_id == "name-stu").one().name == "qizhuo"

    def test_both_nickname_and_username_empty_falls_back_to_placeholder(self, client):
        teacher = _register_teacher(client, "name_blank", _test_school_id, "name-blank")
        row = _row("user_id_key_name-blank", "blank-class", "空名班", "user_id_key_blank-stu", "")
        assert _import_rows(client, teacher, [row], ["blank-class"]).status_code == 200
        with TestingSessionLocal() as db:
            assert db.query(User).filter(User.junyi_identity_id == "blank-stu").one().name.startswith("均一學生 ")

    def test_two_nameless_students_in_same_import_get_distinct_placeholders(self, client):
        teacher = _register_teacher(client, "name_two", _test_school_id, "name-two")
        rows = [_row("user_id_key_name-two", "two-class", "雙人班", f"user_id_key_blank-{i}", "") for i in range(2)]
        assert _import_rows(client, teacher, rows, ["two-class"]).status_code == 200
        with TestingSessionLocal() as db:
            names = [db.query(User).filter(User.junyi_identity_id == f"blank-{i}").one().name for i in range(2)]
            assert len(set(names)) == 2


# PRD R4 -- dedup by email for pre-existing unlinked accounts
class TestEmailLinkFallback:
    def test_preexisting_email_account_is_linked_not_duplicated(self, client):
        teacher = _register_teacher(client, "email_link", _test_school_id, "email-link")
        with TestingSessionLocal() as db:
            user = User(email="student_old@example.com", password_hash="password", name="Existing", email_verified=True)
            db.add(user)
            db.commit()
            user_id = user.id
            before = db.query(User).count()
        row = _row("user_id_key_email-link", "email-class", "舊生班", "user_id_key_email-stu", "暱稱", user_data_email="Student_Old@example.com")
        assert _import_rows(client, teacher, [row], ["email-class"]).status_code == 200
        with TestingSessionLocal() as db:
            assert db.query(User).count() == before
            assert db.get(User, user_id).junyi_identity_id == "email-stu"
            assert db.query(ClassroomStudent).filter(ClassroomStudent.student_id == user_id).count() == 1

    def test_email_match_never_hijacks_an_already_linked_account(self, client):
        teacher = _register_teacher(client, "email_guard", _test_school_id, "email-guard")
        with TestingSessionLocal() as db:
            user = User(email="linked@example.com", password_hash="password", name="Linked", junyi_identity_id="prior-id", email_verified=True)
            db.add(user)
            db.commit()
            user_id = user.id
            before = db.query(User).count()
        row = _row("user_id_key_email-guard", "guard-class", "保護班", "user_id_key_other-id", "Other", user_data_email="linked@example.com")
        assert _import_rows(client, teacher, [row], ["guard-class"]).status_code == 200
        with TestingSessionLocal() as db:
            assert db.get(User, user_id).junyi_identity_id == "prior-id"
            assert db.query(User).count() == before + 1


# PRD R7 -- BigQuery failure surfaces as 503, writes nothing
class TestBigQueryErrorSurfacesAsServiceUnavailable:
    def test_list_classes_returns_503_on_bq_error(self, client):
        from app.services.junyi_bigquery_client import FakeJunyiBigQueryClient
        teacher = _register_teacher(client, "bq_list", _test_school_id, "bq-list")
        dep, override = _bq_dependency_override(FakeJunyiBigQueryClient([], raise_error=True))
        app.dependency_overrides[dep] = override
        response = client.get(f"/api/classrooms/junyi-import/classes?school_id={_test_school_id}", headers=auth_header(teacher["token"]))
        assert response.status_code == 503
        assert response.json()["detail"] == "暫時查不到均一資料，請稍後再試"

    def test_import_returns_503_and_writes_nothing_on_bq_error(self, client):
        from app.services.junyi_bigquery_client import FakeJunyiBigQueryClient
        teacher = _register_teacher(client, "bq_import", _test_school_id, "bq-import")
        with TestingSessionLocal() as db:
            before = (db.query(Classroom).count(), db.query(User).count())
        dep, override = _bq_dependency_override(FakeJunyiBigQueryClient([], raise_error=True))
        app.dependency_overrides[dep] = override
        response = client.post("/api/classrooms/junyi-import/import", json={"school_id": _test_school_id, "junyi_class_ids": ["bad"]}, headers=auth_header(teacher["token"]))
        assert response.status_code == 503
        with TestingSessionLocal() as db:
            assert (db.query(Classroom).count(), db.query(User).count()) == before


# PRD R3 -- stable classroom identity and concurrency
class TestClassroomDedupByJunyiClassId:
    def test_renamed_class_reimport_does_not_duplicate(self, client):
        teacher = _register_teacher(client, "rename_class", _test_school_id, "rename-class")
        row = _row("user_id_key_rename-class", "stable-id", "舊班名", "user_id_key_rename-stu", "甲")
        assert _import_rows(client, teacher, [row], ["stable-id"]).status_code == 200
        row["class_name"] = "新班名"
        response = _import_rows(client, teacher, [row], ["stable-id"])
        assert response.status_code == 200
        assert response.json()["classes_reused"] == 1
        with TestingSessionLocal() as db:
            assert db.query(Classroom).filter(Classroom.teacher_id == teacher["user_id"], Classroom.junyi_class_id == "stable-id").count() == 1

    def test_two_teachers_same_junyi_class_id_get_separate_classrooms(self, client):
        a = _register_teacher(client, "teacher_a", _test_school_id, "teacher-a")
        b = _register_teacher(client, "teacher_b", _test_school_id, "teacher-b")
        rows = [_row(f"user_id_key_teacher-{suffix}", "shared-class", "同編號班", f"user_id_key_student-{suffix}", suffix) for suffix in ("a", "b")]
        assert _import_rows(client, a, rows, ["shared-class"]).status_code == 200
        assert _import_rows(client, b, rows, ["shared-class"]).status_code == 200
        with TestingSessionLocal() as db:
            assert db.query(Classroom).filter(Classroom.junyi_class_id == "shared-class").count() == 2

    def test_concurrent_double_import_reuses_not_duplicates(self, client, monkeypatch):
        from app.services import junyi_class_import_service as service
        teacher = _register_teacher(client, "race_class", _test_school_id, "race-class")
        with TestingSessionLocal() as db:
            existing = Classroom(name="先建立", school_id=_test_school_id, teacher_id=teacher["user_id"], junyi_class_id="race-id", join_code=uuid.uuid4().hex[:8])
            db.add(existing)
            db.commit()
            existing_id = existing.id
        real_find = service.find_existing_imported_classroom
        calls = 0
        def race_find(db, teacher_id, class_id):
            nonlocal calls
            calls += 1
            return None if calls == 1 else real_find(db, teacher_id, class_id)
        monkeypatch.setattr(service, "find_existing_imported_classroom", race_find)
        row = _row("user_id_key_race-class", "race-id", "競爭班", "user_id_key_race-stu", "甲")
        response = _import_rows(client, teacher, [row], ["race-id"])
        assert response.status_code == 200
        assert response.json()["classes_reused"] == 1
        assert calls >= 2
        with TestingSessionLocal() as db:
            assert db.query(Classroom).filter(Classroom.teacher_id == teacher["user_id"], Classroom.junyi_class_id == "race-id").count() == 1
            assert db.get(Classroom, existing_id) is not None


# PRD R6/R8 -- synthetic accounts reject passwords, import stays fast
class TestSyntheticAccountsCannotPasswordLogin:
    def test_imported_student_cannot_password_login(self, client):
        teacher = _register_teacher(client, "no_pw", _test_school_id, "no-pw")
        row = _row("user_id_key_no-pw", "pw-class", "密碼班", "user_id_key_no-pw-stu", "甲")
        assert _import_rows(client, teacher, [row], ["pw-class"]).status_code == 200
        with TestingSessionLocal() as db:
            email = db.query(User).filter(User.junyi_identity_id == "no-pw-stu").one().email
        for guess in ("", "password", "123456", email):
            assert client.post("/api/auth/login", json={"email": email, "password": guess}).status_code == 401


class TestImportPerformance:
    def test_real_queries_set_byte_caps_and_split_list_from_import(self, monkeypatch):
        from app.services.junyi_bigquery_client import RealJunyiBigQueryClient
        calls = []
        class Job:
            def result(self):
                return []
        class QueryClient:
            def query(self, sql, job_config):
                calls.append((sql, job_config.maximum_bytes_billed))
                return Job()
        bq = RealJunyiBigQueryClient()
        monkeypatch.setattr(bq, "_build_client", lambda: QueryClient())
        assert bq.list_class_summaries_for_teacher("user_id_key_test") == []
        assert bq.list_class_and_student_rows_for_import("user_id_key_test") == []
        assert len(calls) == 2
        assert "UserData" not in calls[0][0]
        assert "LEFT JOIN" in calls[1][0]
        assert calls[0][1] == 2 * 1024 * 1024 * 1024
        assert calls[1][1] == 4 * 1024 * 1024 * 1024

    def test_real_query_billing_limit_failure_is_not_empty_result(self, monkeypatch):
        from app.services.junyi_bigquery_client import JunyiBigQueryError, RealJunyiBigQueryClient
        class QueryClient:
            def query(self, sql, job_config):
                raise RuntimeError("maximum bytes billed exceeded")
        bq = RealJunyiBigQueryClient()
        monkeypatch.setattr(bq, "_build_client", lambda: QueryClient())
        with pytest.raises(JunyiBigQueryError):
            bq.list_class_summaries_for_teacher("user_id_key_test")
        with pytest.raises(JunyiBigQueryError):
            bq.list_class_and_student_rows_for_import("user_id_key_test")

    def test_import_uses_one_combined_query(self, client):
        teacher = _register_teacher(client, "single_query", _test_school_id, "single-query")
        rows = [_row("user_id_key_single-query", f"one-query-{i}", f"班{i}", f"user_id_key_query-stu-{i}", f"學生{i}") for i in range(3)]
        fake = _make_fake_client(rows)
        calls = []
        original = fake.list_class_and_student_rows_for_import
        def counted(key):
            calls.append(key)
            return original(key)
        fake.list_class_and_student_rows_for_import = counted
        dep, override = _bq_dependency_override(fake)
        app.dependency_overrides[dep] = override
        response = client.post("/api/classrooms/junyi-import/import", json={"school_id": _test_school_id, "junyi_class_ids": [f"one-query-{i}" for i in range(3)]}, headers=auth_header(teacher["token"]))
        assert response.status_code == 200
        assert calls == ["user_id_key_single-query"]

    def test_70_student_import_completes_quickly(self, client):
        teacher = _register_teacher(client, "perf", _test_school_id, "perf-teacher")
        rows = [_row("user_id_key_perf-teacher", f"perf-class-{i % 3}", f"效能班{i % 3}", f"user_id_key_perf-stu-{i}", f"學生{i}") for i in range(70)]
        started = time.monotonic()
        response = _import_rows(client, teacher, rows, [f"perf-class-{i}" for i in range(3)])
        elapsed = time.monotonic() - started
        assert response.status_code == 200
        assert response.json()["added_students"] == 70
        assert elapsed < 5
