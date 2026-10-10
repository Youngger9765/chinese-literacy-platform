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
- ID mapping is UNVERIFIED (Junyi's BigQuery table backfills T+1 after this
  issue was filed): teacher_user_id / student_user_id are assumed to be
  "user_id_key_" + our User.junyi_identity_id. Because it is unverified, every
  code path that consumes it must fail closed: a non-matching prefix is
  skipped, never guessed at or crashed on.
- Dedup: students by User.junyi_identity_id (already unique). Classrooms by
  (teacher_id, school_id, name) — v1, isolated behind one function so it can
  be swapped for a real classrooms.junyi_class_id column later without
  touching every call site.

Run:
    cd backend && python -m pytest tests/test_junyi_class_import.py -v
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


def _row(teacher_key, class_id, class_name, student_key, student_nickname, class_code="ABCDE"):
    return {
        "teacher_user_id": teacher_key,
        "class_id": class_id,
        "class_name": class_name,
        "class_code": class_code,
        "student_user_id": student_key,
        "student_nickname": student_nickname,
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
# Dedup — classrooms (v1: teacher + name)
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
