"""API-level tests for the word-baby routes (#3780):

    GET  /api/learning/students/{student_id}/word-babies         — my pets
    POST /api/learning/students/{student_id}/word-babies/{id}/feed — feed

Auth boundary (team-lead instruction):
- Feeding is a write — student-only (not even teacher/parent).
- Query is a read — uses the existing verify_student_access (student, their
  teacher, or linked parent).
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
    email = f"wb3780_{unique}@example.com"
    password = "SecurePass3780!"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "name": f"WB3780 {unique}"},
    )
    assert resp.status_code == 201, resp.text
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json()["access_token"]
    me = client.get("/api/users/me", headers=auth_header(token))
    assert me.status_code == 200, me.text
    return {"id": me.json()["id"], "token": token}


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def student(client):
    return _register_and_login(client, "student")


@pytest.fixture(scope="module")
def other_student(client):
    return _register_and_login(client, "other")


class TestGetMyPets:
    def test_student_can_read_own_pets(self, client, student):
        resp = client.get(
            f"/api/learning/students/{student['id']}/word-babies",
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["babies_owned_count"] == 0
        assert body["babies_total_species"] == 100

    def test_other_student_cannot_read_someone_elses_pets(self, client, student, other_student):
        resp = client.get(
            f"/api/learning/students/{student['id']}/word-babies",
            headers=auth_header(other_student["token"]),
        )
        assert resp.status_code == 403

    def test_unauthenticated_request_rejected(self, client, student):
        resp = client.get(f"/api/learning/students/{student['id']}/word-babies")
        assert resp.status_code in (401, 403)


class TestFeedBaby:
    def test_feeding_a_baby_you_dont_own_is_404(self, client, student):
        resp = client.post(
            f"/api/learning/students/{student['id']}/word-babies/wb-001/feed",
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 404

    def test_other_student_cannot_feed_your_baby(self, client, student, other_student):
        """Write boundary is stricter than read: even if somehow targeting another
        student's id, only the student themself may feed (team-lead: 學生只能動自己的寶貝)."""
        resp = client.post(
            f"/api/learning/students/{student['id']}/word-babies/wb-001/feed",
            headers=auth_header(other_student["token"]),
        )
        assert resp.status_code == 403

    def test_feeding_an_unknown_baby_id_is_404_not_500(self, client, student):
        """authz review follow-up: a baby_id that isn't even a real species
        (never owned by anyone) must still be a clean 4xx, not crash."""
        resp = client.post(
            f"/api/learning/students/{student['id']}/word-babies/wb-does-not-exist-9999/feed",
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 404

    def test_feeding_your_own_owned_baby_succeeds_and_consumes_wallet(self, client, student):
        """Positive control: student feeding a baby they genuinely own succeeds (200),
        and the wallet is actually drawn down by feeding (not just coincidentally
        unchanged).

        2026-10-26 reviewer finding: the first version of this test picked wb-001
        (common rarity), whose stage-1 cost is 1 fragment — `seed_qty = cost - 1`
        evaluated to 0, so the test seeded an EMPTY wallet, fed nothing, and
        asserted "wallet.quantity == 0", which was true before AND after the
        decrement loop ever ran. The assertion never exercised the subtraction at
        all. Fixed by picking an uncommon-rarity baby whose stage-1 cost is 3 (>=2,
        so seeding cost-1 is a real nonzero amount), and asserting fed_current_stage
        advanced by exactly the seeded amount — not just "wallet is some value",
        which a no-op would also satisfy if the seed had coincidentally been 0.
        """
        from app.models.word_baby import StudentWordBabyState, StudentFragmentWallet
        from app.services import word_baby_config as config

        baby_id = "wb-071"  # uncommon, stage 1 cost = 3 (non-structured, shared pool)
        baby = config.get_baby(baby_id)
        assert baby["rarity"] == "uncommon"
        diet_flavor = baby["diet_flavors"][0]
        stage_cost = baby["stages"][0]["fragments_to_finish_stage"]
        assert stage_cost >= 2, "test needs a baby whose stage-1 cost is at least 2"

        with TestingSessionLocal() as db:
            db.add(StudentWordBabyState(student_id=student["id"], baby_id=baby_id, stage_index=1))
            # Seed exactly one fragment short of what's needed, so feeding is
            # guaranteed to drain the wallet to zero (not go negative) and NOT
            # finish the stage — the sharpest check that the loop stops cleanly
            # when the wallet runs out, rather than needing a lucky exact match.
            seed_qty = stage_cost - 1
            db.add(StudentFragmentWallet(student_id=student["id"], flavor=diet_flavor, quantity=seed_qty))
            db.commit()

        resp = client.post(
            f"/api/learning/students/{student['id']}/word-babies/{baby_id}/feed",
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["baby_id"] == baby_id
        assert body["fed_current_stage"] == seed_qty  # consumed exactly what was seeded
        assert body["stage_index"] == 1  # stage not finished — one short on purpose

        with TestingSessionLocal() as db:
            wallet = (
                db.query(StudentFragmentWallet)
                .filter_by(student_id=student["id"], flavor=diet_flavor)
                .first()
            )
            assert wallet is not None
            assert wallet.quantity == 0  # fully drained, not left over, not negative

    def test_feeding_with_an_empty_wallet_never_goes_negative(self, client, student):
        """Wallet has strictly less than the stage needs (1 fragment against a cost
        of 2) — feeding must consume only what exists and stop, not borrow against
        a negative balance.

        Uses a DIFFERENT baby_id (wb-053, rare) with a DIFFERENT first diet flavor
        (書寫紀錄) than the previous test (wb-071, 朗讀表達) — `student` is a
        module-scoped fixture shared across every test in this class, so reusing
        the same baby_id/flavor pair here would hit the (student_id, baby_id) and
        (student_id, flavor) unique constraints from the row the previous test
        already committed.
        """
        from app.models.word_baby import StudentWordBabyState, StudentFragmentWallet
        from app.services import word_baby_config as config

        baby_id = "wb-053"
        baby = config.get_baby(baby_id)
        assert baby["rarity"] == "rare"
        diet_flavor = baby["diet_flavors"][0]
        assert baby["stages"][0]["fragments_to_finish_stage"] >= 2

        with TestingSessionLocal() as db:
            db.add(StudentWordBabyState(student_id=student["id"], baby_id=baby_id, stage_index=1))
            db.add(StudentFragmentWallet(student_id=student["id"], flavor=diet_flavor, quantity=1))
            db.commit()

        resp = client.post(
            f"/api/learning/students/{student['id']}/word-babies/{baby_id}/feed",
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["fed_current_stage"] == 1

        with TestingSessionLocal() as db:
            wallet = (
                db.query(StudentFragmentWallet)
                .filter_by(student_id=student["id"], flavor=diet_flavor)
                .first()
            )
            assert wallet is not None
            assert wallet.quantity == 0  # not negative, not left untouched


class TestMyPetsReadOnlyForTeacherAndParent:
    """Security review finding (2026-10-27): the "read my pets" endpoint
    unconditionally persisted lazy-evaluated hatch-completion (and
    weaken-state) changes to the DB regardless of who was reading — student,
    teacher, or parent all go through `verify_student_access`, so a
    teacher's or parent's GET of a student's pets could silently flip a
    dormant baby into "hatched" in the DB before the student themself ever
    looked at it. Fix: only a read BY THE STUDENT THEMSELF may persist the
    state transition; teacher/parent reads must compute correct live display
    values WITHOUT writing anything.
    """

    def _seed_dormant_baby_ready_to_hatch(self, student_id: int) -> None:
        from datetime import datetime, timedelta, timezone

        from app.models.word_baby import StudentWordBabyState

        with TestingSessionLocal() as db:
            db.add(
                StudentWordBabyState(
                    student_id=student_id,
                    baby_id="wb-001",
                    stage_index=1,
                    dormant_type="繭",
                    dormant_started_at=datetime.now(timezone.utc) - timedelta(days=1),
                    # Deliberately way past wb-001 stage-1's 3-day hatch
                    # requirement — guarantees a sync would hatch it
                    # regardless of exactly how much extra credit this
                    # particular read's elapsed-time window contributes.
                    hatch_progress_days=999,
                    last_cared_at=datetime.now(timezone.utc) - timedelta(hours=1),
                )
            )
            db.commit()

    def _seed_teacher_of(self, client, student_id: int) -> dict:
        from app.models.school import Classroom, ClassroomStudent, School

        teacher = _register_and_login(client, f"teacher_{uuid.uuid4().hex[:8]}")
        with TestingSessionLocal() as db:
            school = School(name="WB3780 Test School")
            db.add(school)
            db.flush()
            classroom = Classroom(name="WB3780 Test Class", grade=4, teacher_id=teacher["id"], school_id=school.id)
            db.add(classroom)
            db.flush()
            db.add(ClassroomStudent(student_id=student_id, classroom_id=classroom.id))
            db.commit()
        return teacher

    def test_teacher_read_leaves_the_dormant_baby_unhatched_in_the_db(self, client):
        from app.models.word_baby import StudentWordBabyState

        pet_owner = _register_and_login(client, f"petowner_t_{uuid.uuid4().hex[:8]}")
        teacher = self._seed_teacher_of(client, pet_owner["id"])
        self._seed_dormant_baby_ready_to_hatch(pet_owner["id"])

        resp = client.get(
            f"/api/learning/students/{pet_owner['id']}/word-babies",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text
        # The RESPONSE must still show the correct live (would-be-hatched)
        # value for display purposes...
        body = resp.json()
        hatched_baby = next(b for b in body["babies"] if b["baby_id"] == "wb-001")
        assert hatched_baby["dormant_type"] is None
        assert hatched_baby["stage_index"] == 2

        # ...but the DB row itself must be untouched — nothing was persisted
        # just because a teacher looked at it.
        with TestingSessionLocal() as db:
            row = (
                db.query(StudentWordBabyState)
                .filter_by(student_id=pet_owner["id"], baby_id="wb-001")
                .first()
            )
            assert row.dormant_type == "繭", "teacher's read must not persist the hatch"
            assert row.stage_index == 1, "teacher's read must not persist the stage advance"
            assert row.hatch_progress_days == 999, "teacher's read must not persist anything"

    def test_student_read_of_their_own_pets_does_persist_the_hatch(self, client):
        from app.models.word_baby import StudentWordBabyState

        pet_owner = _register_and_login(client, f"petowner_s_{uuid.uuid4().hex[:8]}")
        self._seed_dormant_baby_ready_to_hatch(pet_owner["id"])

        resp = client.get(
            f"/api/learning/students/{pet_owner['id']}/word-babies",
            headers=auth_header(pet_owner["token"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        hatched_baby = next(b for b in body["babies"] if b["baby_id"] == "wb-001")
        assert hatched_baby["dormant_type"] is None
        assert hatched_baby["stage_index"] == 2

        with TestingSessionLocal() as db:
            row = (
                db.query(StudentWordBabyState)
                .filter_by(student_id=pet_owner["id"], baby_id="wb-001")
                .first()
            )
            assert row.dormant_type is None, "the student's own read must persist the hatch"
            assert row.stage_index == 2, "the student's own read must persist the stage advance"
