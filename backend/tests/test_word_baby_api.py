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
        and the wallet is drawn down correctly — this also exercises that feeding
        can never make a wallet quantity negative (the service loop only ever
        decrements while quantity > 0; this proves the end-to-end behavior, not just
        the loop's internal guard in isolation)."""
        from app.models.word_baby import StudentWordBabyState, StudentFragmentWallet
        from app.services import word_baby_config as config

        baby_id = "wb-001"
        baby = config.get_baby(baby_id)
        diet_flavor = baby["diet_flavors"][0]
        stage_cost = baby["stages"][0]["fragments_to_finish_stage"]

        with TestingSessionLocal() as db:
            db.add(StudentWordBabyState(student_id=student["id"], baby_id=baby_id, stage_index=1))
            # Seed exactly one fragment short of what's needed, so feeding is
            # guaranteed to drain the wallet to zero (not go negative) and NOT
            # finish the stage — the sharpest check that the loop stops cleanly
            # when the wallet runs out, rather than needing a lucky exact match.
            seed_qty = max(stage_cost - 1, 0)
            db.add(StudentFragmentWallet(student_id=student["id"], flavor=diet_flavor, quantity=seed_qty))
            db.commit()

        resp = client.post(
            f"/api/learning/students/{student['id']}/word-babies/{baby_id}/feed",
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["baby_id"] == baby_id

        with TestingSessionLocal() as db:
            wallet = (
                db.query(StudentFragmentWallet)
                .filter_by(student_id=student["id"], flavor=diet_flavor)
                .first()
            )
            assert wallet is not None
            assert wallet.quantity == 0  # fully drained, never negative
