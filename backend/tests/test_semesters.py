"""
Tests for semester management (Issue #406).

BDD acceptance criteria:
  Given an admin and a school
  When admin creates a semester with is_active=True
  Then it is stored and marked active
  And all sibling semesters for that school are deactivated

  Given an active semester with end_date + grace_days in the future
  And a ClassroomText with expires_at=NULL for a classroom in that school
  When the semester is activated
  Then ClassroomText.expires_at is set to end_date + grace_days

  Given a semester
  When a teacher (non-admin) tries to create/activate a semester
  Then they receive 403

  Given a school with semesters
  When any authenticated user fetches /schools/{id}/semesters
  Then they get the list ordered by start_date desc

Run with:
    cd backend
    python -m pytest tests/test_semesters.py -v
"""

import sys
import os
import uuid
from datetime import date, datetime, timedelta, timezone

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
from app.models.school import School, Classroom, ClassroomText
from app.models.semester import Semester
from app.services.semester_service import (
    activate_semester,
    create_semester,
    get_active_semester,
    list_semesters,
    SemesterCreateData,
)


# ── DB setup ──────────────────────────────────────────────────────────────────

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
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "parent", "display_name": "Parent", "scope_level": "school"},
]


def _seed_roles(session):
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    session.commit()


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


_test_school_id: int = 0
_test_school2_id: int = 0


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _test_school_id, _test_school2_id
    Base.metadata.create_all(bind=engine)

    session = TestingSessionLocal()
    _seed_roles(session)
    s1 = School(name="Semester Test School A")
    s2 = School(name="Semester Test School B")
    session.add_all([s1, s2])
    session.commit()
    session.refresh(s1)
    session.refresh(s2)
    _test_school_id = s1.id
    _test_school2_id = s2.id
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def school_id():
    return _test_school_id


@pytest.fixture(scope="module")
def school2_id():
    return _test_school2_id


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{suffix.title()} {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201
    verification_token = resp.json().get("verification_token")
    if verification_token:
        verify_resp = client.get(f"/api/auth/verify-email?token={verification_token}")
        assert verify_resp.status_code == 200
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
    me = client.get("/api/users/me", headers=auth_header(token))
    return {"email": email, "token": token, "user_id": me.json()["id"]}


def _make_admin(user_id: int):
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == "system_admin").first()
    db.add(UserRole(user_id=user_id, role_id=role.id, scope_type="platform", scope_id=None))
    db.commit()
    db.close()


@pytest.fixture(scope="module")
def admin(client):
    user = _register_user(client, "sem_admin")
    _make_admin(user["user_id"])
    return user


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "sem_teacher")


# ── Service-layer unit tests ──────────────────────────────────────────────────


class TestSemesterService:
    def test_create_semester_inactive(self, school_id):
        db = TestingSessionLocal()
        data = SemesterCreateData(
            school_id=school_id,
            name="113上學期",
            start_date=date(2024, 9, 1),
            end_date=date(2025, 1, 31),
            grace_days=7,
            is_active=False,
        )
        sem = create_semester(data, db)
        db.close()
        assert sem.id is not None
        assert sem.is_active is False
        assert sem.name == "113上學期"

    def test_create_semester_active_deactivates_siblings(self, school_id):
        db = TestingSessionLocal()
        # Create first active semester
        d1 = SemesterCreateData(
            school_id=school_id,
            name="113上學期-active",
            start_date=date(2024, 9, 1),
            end_date=date(2025, 1, 31),
            is_active=True,
        )
        s1 = create_semester(d1, db)
        db.close()

        # Create second active semester — first should become inactive
        db = TestingSessionLocal()
        d2 = SemesterCreateData(
            school_id=school_id,
            name="113下學期-active",
            start_date=date(2025, 2, 1),
            end_date=date(2025, 6, 30),
            is_active=True,
        )
        s2 = create_semester(d2, db)
        db.close()

        db = TestingSessionLocal()
        refreshed_s1 = db.query(Semester).filter(Semester.id == s1.id).first()
        db.close()
        assert refreshed_s1.is_active is False
        assert s2.is_active is True

    def test_activate_semester_propagates_expires_at(self, school_id):
        """Activating a semester should set expires_at on ClassroomText rows."""
        from app.models.user import User
        from app.auth.password import hash_password
        db = TestingSessionLocal()

        # Create a minimal user to satisfy teacher_id FK
        teacher = User(
            email=f"propagate_teacher_{uuid.uuid4().hex[:6]}@test.com",
            password_hash=hash_password("pass1234"),
            name="Propagate Teacher",
            is_active=True,
            email_verified=True,
        )
        db.add(teacher)
        db.flush()

        # Create a classroom in the school
        classroom = Classroom(school_id=school_id, teacher_id=teacher.id, name="Test Propagate Class", grade=5)
        db.add(classroom)
        db.flush()

        # Assign a text without expires_at
        ct = ClassroomText(classroom_id=classroom.id, text_id="prop-1")
        db.add(ct)
        db.flush()

        # Create an inactive semester
        sem = Semester(
            school_id=school_id,
            name="113下學期-propagate",
            start_date=date(2025, 2, 1),
            end_date=date(2025, 6, 30),
            grace_days=7,
            is_active=False,
        )
        db.add(sem)
        db.commit()
        db.refresh(sem)
        sem_id = sem.id
        ct_id = ct.id
        db.close()

        # Activate it
        db = TestingSessionLocal()
        activated = activate_semester(sem_id, db)
        db.close()

        # Check expires_at was set
        db = TestingSessionLocal()
        ct_row = db.query(ClassroomText).filter(ClassroomText.id == ct_id).first()
        db.close()

        expected_expire = date(2025, 6, 30) + timedelta(days=7)  # end_date + grace_days
        assert ct_row.expires_at is not None
        assert ct_row.expires_at.date() == expected_expire
        # Expires at the END of that day in Taiwan (16:00 UTC), not 08:00 Taiwan.
        exp = ct_row.expires_at if ct_row.expires_at.tzinfo else ct_row.expires_at.replace(tzinfo=timezone.utc)
        assert exp.astimezone(timezone.utc).hour == 16

    def test_activate_does_not_overwrite_existing_expires_at(self, school_id):
        """ClassroomText rows that already have expires_at should not be changed."""
        from app.models.user import User
        from app.auth.password import hash_password
        db = TestingSessionLocal()

        teacher = User(
            email=f"nooverwrite_teacher_{uuid.uuid4().hex[:6]}@test.com",
            password_hash=hash_password("pass1234"),
            name="No Overwrite Teacher",
            is_active=True,
            email_verified=True,
        )
        db.add(teacher)
        db.flush()

        classroom = Classroom(school_id=school_id, teacher_id=teacher.id, name="Test No-Overwrite Class", grade=4)
        db.add(classroom)
        db.flush()

        original_expiry = datetime(2025, 3, 1, tzinfo=timezone.utc)
        ct = ClassroomText(classroom_id=classroom.id, text_id="no-overwrite-1", expires_at=original_expiry)
        db.add(ct)
        db.flush()

        sem = Semester(
            school_id=school_id,
            name="113下學期-nooverwrite",
            start_date=date(2025, 2, 1),
            end_date=date(2025, 6, 30),
            grace_days=7,
            is_active=False,
        )
        db.add(sem)
        db.commit()
        db.refresh(sem)
        sem_id = sem.id
        ct_id = ct.id
        db.close()

        db = TestingSessionLocal()
        activate_semester(sem_id, db)
        db.close()

        db = TestingSessionLocal()
        ct_row = db.query(ClassroomText).filter(ClassroomText.id == ct_id).first()
        db.close()
        # Should remain unchanged
        assert ct_row.expires_at.date() == original_expiry.date()

    def test_list_semesters_newest_first(self, school_id):
        db = TestingSessionLocal()
        sems = list_semesters(school_id, db)
        db.close()
        # At least the ones we created above
        assert len(sems) >= 1
        # Verify ordering: start_date descending
        dates = [s.start_date for s in sems]
        assert dates == sorted(dates, reverse=True)

    def test_get_active_semester(self, school_id):
        db = TestingSessionLocal()
        active = get_active_semester(school_id, db)
        db.close()
        # There should be at most one active semester
        if active is not None:
            assert active.is_active is True

    def test_expires_at_date_property(self):
        sem = Semester(
            start_date=date(2025, 2, 1),
            end_date=date(2025, 6, 30),
            grace_days=7,
            is_active=False,
        )
        expected = date(2025, 7, 7)
        assert sem.expires_at_date == expected

    def test_expires_at_date_zero_grace(self):
        sem = Semester(
            start_date=date(2025, 2, 1),
            end_date=date(2025, 6, 30),
            grace_days=0,
            is_active=False,
        )
        assert sem.expires_at_date == date(2025, 6, 30)


# ── HTTP API tests ─────────────────────────────────────────────────────────────


def _future_date_str(days_from_today: int) -> str:
    """find_01DygBxNaTFMHa8cgm2yhHRm recommendation 2, 2026-11-06: the
    route now rejects an end_date already in the past, so fixtures that
    need a VALID (acceptable) semester can no longer use calendar-literal
    dates that eventually rot into the past as real time passes -- several
    of this file's "2025-09-01"/"2026-01-31" literals did exactly that.
    Tests that deliberately want an invalid/past date keep using literals;
    only the ones asserting success (or asserting 403 for a reason OTHER
    than the date) switch to this."""
    return (date.today() + timedelta(days=days_from_today)).isoformat()


class TestSemesterAPI:
    def test_list_semesters_returns_200(self, client, admin, school_id):
        resp = client.get(
            f"/api/schools/{school_id}/semesters",
            headers=auth_header(admin["token"]),
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_list_semesters_requires_auth(self, client, school_id):
        resp = client.get(f"/api/schools/{school_id}/semesters")
        assert resp.status_code == 401

    def test_create_semester_as_admin(self, client, admin, school_id):
        resp = client.post(
            f"/api/schools/{school_id}/semesters",
            json={
                "name": "114上學期",
                "start_date": _future_date_str(1),
                "end_date": _future_date_str(150),
                "grace_days": 7,
                "is_active": False,
            },
            headers=auth_header(admin["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "114上學期"
        assert data["is_active"] is False
        assert "expires_at_date" in data

    def test_create_semester_returns_correct_expires_at_date(self, client, admin, school_id):
        end_date = date.today() + timedelta(days=150)
        resp = client.post(
            f"/api/schools/{school_id}/semesters",
            json={
                "name": "114上學期-expiry-check",
                "start_date": _future_date_str(1),
                "end_date": end_date.isoformat(),
                "grace_days": 7,
                "is_active": False,
            },
            headers=auth_header(admin["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["expires_at_date"] == (end_date + timedelta(days=7)).isoformat()

    def test_create_semester_teacher_forbidden(self, client, teacher, school_id):
        """Renamed in intent, not in name, 2026-11-06: `teacher` here is a
        plain registered account with NO relationship to `school_id`
        whatsoever (see the fixture — _register_user grants no school
        role at all). This still correctly 403s under the tightened
        find_01DygBxNaTFMHa8cgm2yhHRm authz (no relationship at all is a
        fortiori not a verified management one), but it does NOT cover the
        actual vulnerability the finding describes — see
        TestSemesterManagementAuthzTightened below for a caller who
        self-activates INTO the school (which used to pass the old
        is_school_member check and must now still 403)."""
        resp = client.post(
            f"/api/schools/{school_id}/semesters",
            json={
                "name": "Forbidden Semester",
                "start_date": _future_date_str(1),
                "end_date": _future_date_str(150),
            },
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 403

    def test_create_semester_invalid_dates(self, client, admin, school_id):
        resp = client.post(
            f"/api/schools/{school_id}/semesters",
            json={
                "name": "Bad Dates",
                "start_date": "2026-01-31",
                "end_date": "2025-09-01",  # end before start
            },
            headers=auth_header(admin["token"]),
        )
        assert resp.status_code == 422

    def test_create_semester_empty_name_rejected(self, client, admin, school_id):
        resp = client.post(
            f"/api/schools/{school_id}/semesters",
            json={
                "name": "   ",
                "start_date": "2025-09-01",
                "end_date": "2026-01-31",
            },
            headers=auth_header(admin["token"]),
        )
        assert resp.status_code == 422

    def test_create_active_semester_deactivates_sibling(self, client, admin, school2_id):
        # Create first semester (active)
        r1 = client.post(
            f"/api/schools/{school2_id}/semesters",
            json={
                "name": "First Active",
                "start_date": _future_date_str(1),
                "end_date": _future_date_str(150),
                "is_active": True,
            },
            headers=auth_header(admin["token"]),
        )
        assert r1.status_code == 201
        s1_id = r1.json()["id"]

        # Create second semester (active) — should deactivate first
        r2 = client.post(
            f"/api/schools/{school2_id}/semesters",
            json={
                "name": "Second Active",
                "start_date": _future_date_str(151),
                "end_date": _future_date_str(300),
                "is_active": True,
            },
            headers=auth_header(admin["token"]),
        )
        assert r2.status_code == 201

        # Check first is now inactive
        db = TestingSessionLocal()
        s1 = db.query(Semester).filter(Semester.id == s1_id).first()
        db.close()
        assert s1.is_active is False

    def test_get_active_semester_returns_active(self, client, admin, school2_id):
        resp = client.get(
            f"/api/schools/{school2_id}/semesters/active",
            headers=auth_header(admin["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        if data is not None:
            assert data["is_active"] is True

    def test_activate_endpoint(self, client, admin, school_id):
        # Create an inactive semester to activate
        r = client.post(
            f"/api/schools/{school_id}/semesters",
            json={
                "name": "Activate Me",
                "start_date": "2027-09-01",
                "end_date": "2028-01-31",
                "is_active": False,
            },
            headers=auth_header(admin["token"]),
        )
        assert r.status_code == 201
        sem_id = r.json()["id"]

        activate_resp = client.post(
            f"/api/schools/{school_id}/semesters/{sem_id}/activate",
            headers=auth_header(admin["token"]),
        )
        assert activate_resp.status_code == 200
        assert activate_resp.json()["is_active"] is True

    def test_activate_wrong_school_returns_404(self, client, admin, school_id, school2_id):
        # Create semester on school2
        r = client.post(
            f"/api/schools/{school2_id}/semesters",
            json={
                "name": "Wrong School Semester",
                "start_date": "2027-09-01",
                "end_date": "2028-01-31",
                "is_active": False,
            },
            headers=auth_header(admin["token"]),
        )
        assert r.status_code == 201
        sem_id = r.json()["id"]

        # Try to activate via school_id (wrong school)
        resp = client.post(
            f"/api/schools/{school_id}/semesters/{sem_id}/activate",
            headers=auth_header(admin["token"]),
        )
        assert resp.status_code == 404

    def test_update_semester(self, client, admin, school_id):
        r = client.post(
            f"/api/schools/{school_id}/semesters",
            json={
                "name": "Update Me",
                "start_date": "2028-09-01",
                "end_date": "2029-01-31",
                "is_active": False,
            },
            headers=auth_header(admin["token"]),
        )
        assert r.status_code == 201
        sem_id = r.json()["id"]

        patch = client.patch(
            f"/api/schools/{school_id}/semesters/{sem_id}",
            json={"name": "Updated Name", "grace_days": 14},
            headers=auth_header(admin["token"]),
        )
        assert patch.status_code == 200
        assert patch.json()["name"] == "Updated Name"
        assert patch.json()["grace_days"] == 14

    def test_update_semester_bad_dates_rejected(self, client, admin, school_id):
        r = client.post(
            f"/api/schools/{school_id}/semesters",
            json={
                "name": "Date Validation",
                "start_date": "2029-09-01",
                "end_date": "2030-01-31",
                "is_active": False,
            },
            headers=auth_header(admin["token"]),
        )
        assert r.status_code == 201
        sem_id = r.json()["id"]

        patch = client.patch(
            f"/api/schools/{school_id}/semesters/{sem_id}",
            json={"end_date": "2029-08-01"},  # before start_date
            headers=auth_header(admin["token"]),
        )
        assert patch.status_code == 422

    def test_list_semesters_ordered_newest_first(self, client, admin, school_id):
        resp = client.get(
            f"/api/schools/{school_id}/semesters",
            headers=auth_header(admin["token"]),
        )
        assert resp.status_code == 200
        items = resp.json()
        if len(items) >= 2:
            dates = [i["start_date"] for i in items]
            assert dates == sorted(dates, reverse=True)

    def test_school_not_found_returns_404(self, client, admin):
        resp = client.get(
            "/api/schools/99999/semesters",
            headers=auth_header(admin["token"]),
        )
        assert resp.status_code == 404


class TestSemesterManagementAuthzTightened:
    """find_01DygBxNaTFMHa8cgm2yhHRm (medium, CWE-863), 2026-11-06.

    The actual attack: _can_manage_semester used to be bare
    is_school_member, and self-serve activation makes school membership a
    trivial, zero-friction action. A caller who self-activates AS TEACHER
    into a school used to pass that check and could create/activate a
    semester with a past end_date, mass-expiring every OTHER teacher's
    classroom texts there. test_create_semester_teacher_forbidden above
    doesn't cover this — that caller has NO relationship to the school at
    all, which was never the exploitable case.
    """

    def _register_and_login(self, client, suffix: str) -> dict:
        return _register_user(client, suffix)

    def test_self_activated_teacher_cannot_manage_a_real_schools_semester(self, client, school_id):
        """`school_id` fixture is a real (non-self-activated) school with no
        admin_user_id set -- exactly the "institutional school, no verified
        management relationship" case the finding's recommendation names.

        Grants the school-scoped teacher role directly via the DB (ACTIVE)
        rather than through POST /users/me/activate-teacher: that endpoint
        now has its OWN, separately-shipped defense (#3889/#3890) that
        grants an INACTIVE role when self-activating into a genuinely
        pre-existing school pending admin confirmation -- which would
        incidentally also make this test 403 (is_school_member already
        filters on is_active) without ever exercising THIS fix
        (_can_manage_semester) at all. Testing the authz check in
        isolation needs the role to actually be active, as it would be for
        a caller the #3889 gate legitimately approved, or a membership
        granted before that gate existed.
        """
        attacker = self._register_and_login(client, "sem_attacker")
        db = TestingSessionLocal()
        teacher_role = db.query(Role).filter(Role.name == "teacher").first()
        db.add(UserRole(
            user_id=attacker["user_id"],
            role_id=teacher_role.id,
            scope_type="school",
            scope_id=str(school_id),
            is_active=True,
        ))
        db.commit()
        db.close()

        resp = client.post(
            f"/api/schools/{school_id}/semesters",
            json={
                "name": "Attacker Semester",
                "start_date": _future_date_str(1),
                "end_date": _future_date_str(150),
                "is_active": True,
            },
            headers=auth_header(attacker["token"]),
        )
        assert resp.status_code == 403, resp.text

    def test_school_admin_user_id_holder_can_manage_the_semester(self, client):
        """Positive control: the fix criteria says a verified management
        relationship (school.admin_user_id == caller) must still work --
        this isn't a blanket lockout, system_admin-only despite appearances
        in the other tests (those just never set admin_user_id)."""
        designated_admin = self._register_and_login(client, "sem_designated_admin")
        db = TestingSessionLocal()
        school = School(name=f"Admin-Owned School {uuid.uuid4().hex[:8]}", admin_user_id=designated_admin["user_id"])
        db.add(school)
        db.commit()
        db.refresh(school)
        real_school_id = school.id
        db.close()

        resp = client.post(
            f"/api/schools/{real_school_id}/semesters",
            json={
                "name": "Legit Semester",
                "start_date": _future_date_str(1),
                "end_date": _future_date_str(150),
            },
            headers=auth_header(designated_admin["token"]),
        )
        assert resp.status_code == 201, resp.text

    def test_create_semester_with_past_end_date_rejected(self, client, admin, school_id):
        resp = client.post(
            f"/api/schools/{school_id}/semesters",
            json={
                "name": "Already Expired",
                "start_date": (date.today() - timedelta(days=200)).isoformat(),
                "end_date": (date.today() - timedelta(days=1)).isoformat(),
                "is_active": True,
            },
            headers=auth_header(admin["token"]),
        )
        assert resp.status_code == 422, resp.text

    def test_activate_semester_with_past_end_date_rejected(self, client, admin, school_id):
        # Create it inactive first with a valid future date...
        create_resp = client.post(
            f"/api/schools/{school_id}/semesters",
            json={
                "name": "Will Be Backdated",
                "start_date": _future_date_str(1),
                "end_date": _future_date_str(10),
                "is_active": False,
            },
            headers=auth_header(admin["token"]),
        )
        assert create_resp.status_code == 201
        semester_id = create_resp.json()["id"]

        # ...then backdate it directly via the DB (simulating drift / a
        # previously-valid semester whose end_date has since passed) and
        # confirm /activate refuses it rather than mass-expiring on activation.
        db = TestingSessionLocal()
        semester = db.query(Semester).filter(Semester.id == semester_id).first()
        semester.end_date = date.today() - timedelta(days=1)
        db.commit()
        db.close()

        activate_resp = client.post(
            f"/api/schools/{school_id}/semesters/{semester_id}/activate",
            headers=auth_header(admin["token"]),
        )
        assert activate_resp.status_code == 422, activate_resp.text
