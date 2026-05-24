"""Tests for #1975 — GET /api/omo/history endpoint.

Covers:
- Empty result for a fresh user
- Returns user's own uploads, newest first
- Excludes superseded uploads
- Excludes pending / identifying / error statuses
- Pagination (limit + offset, total stays stable)
- User isolation (student A doesn't see student B's history)
- Auth required (401 without token)
- Lesson title resolution: confirmed lesson_id → lesson_loader meta
- Lesson title fallback: identification[0] when lesson_id is NULL (identified state)

Uses the same SQLite in-memory infrastructure as test_omo_upload.py.
"""

import sys
import os
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.rate_limiter import ai_rate_limiter
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.omo_upload import OmoUpload, OmoUploadAttempt
from app.models.user import Role


# ---------------------------------------------------------------------------
# Test DB setup (SQLite in-memory) — mirrors test_omo_upload.py
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

_SEED_ROLES = [
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
    for r in _SEED_ROLES:
        session.add(Role(name=r["name"], display_name=r["display_name"], scope_level=r["scope_level"]))
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


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    with ai_rate_limiter._lock:
        ai_rate_limiter._store.clear()
    yield


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def _register_user(client, suffix: str) -> tuple[int, str]:
    """Register + login a fresh student. Returns (user_id, bearer_token)."""
    email = f"history_{suffix}@example.com"
    reg = client.post("/api/auth/register", json={
        "email": email,
        "password": "TestPass123!",
        "name": f"History Test {suffix}",
    })
    assert reg.status_code == 201, reg.text
    verification_token = reg.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")

    login = client.post("/api/auth/login", json={
        "email": email,
        "password": "TestPass123!",
    })
    assert login.status_code == 200, login.text
    # Need user_id for direct DB seeding
    from app.models.user import User
    db = TestingSessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        assert user is not None
        return user.id, login.json()["access_token"]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Direct DB seed helper — bypass file upload + background tasks
# ---------------------------------------------------------------------------

def _seed_upload(
    student_id: int,
    *,
    status: str = "graded",
    lesson_id: int | None = 1,
    identification: list | None = None,
    answers: list | None = None,
    overall_score: float | None = 0.85,
    superseded_at: datetime | None = None,
    created_at: datetime | None = None,
    image_paths: list[str] | None = None,
) -> int:
    """Insert one OmoUpload directly into the DB. Returns the new upload_id."""
    db = TestingSessionLocal()
    try:
        upload = OmoUpload(
            student_id=student_id,
            lesson_id=lesson_id,
            identification=identification,
            answers=answers or [],
            progress={},  # required (NOT NULL) — match create_upload_record
            overall_score=overall_score,
            status=status,
            superseded_at=superseded_at,
        )
        db.add(upload)
        db.flush()  # get the id

        if created_at is not None:
            upload.created_at = created_at

        if image_paths:
            attempt = OmoUploadAttempt(
                omo_upload_id=upload.id,
                attempt_idx=0,
                image_paths=image_paths,
                is_active=True,
            )
            db.add(attempt)

        db.commit()
        return upload.id
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestOmoHistoryEndpoint:
    def test_empty_history_returns_zero_total(self, client):
        _user_id, token = _register_user(client, "empty")
        resp = client.get("/api/omo/history", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["total"] == 0
        assert data["items"] == []
        assert data["limit"] == 20
        assert data["offset"] == 0

    def test_unauthorized_returns_401(self, client):
        resp = client.get("/api/omo/history")
        assert resp.status_code == 401, resp.text

    def test_returns_user_own_uploads_newest_first(self, client):
        user_id, token = _register_user(client, "newest")
        now = datetime.now(timezone.utc)
        old_id = _seed_upload(user_id, created_at=now - timedelta(days=2))
        mid_id = _seed_upload(user_id, created_at=now - timedelta(days=1))
        new_id = _seed_upload(user_id, created_at=now)

        resp = client.get("/api/omo/history", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        ids = [it["upload_id"] for it in resp.json()["items"]]
        assert ids == [new_id, mid_id, old_id], f"Expected newest first, got {ids}"

    def test_excludes_superseded_uploads(self, client):
        user_id, token = _register_user(client, "superseded")
        kept_id = _seed_upload(user_id)
        _seed_upload(
            user_id,
            superseded_at=datetime.now(timezone.utc),
        )
        resp = client.get("/api/omo/history", headers={"Authorization": f"Bearer {token}"})
        ids = [it["upload_id"] for it in resp.json()["items"]]
        assert ids == [kept_id], f"Superseded upload must not appear: {ids}"

    @pytest.mark.parametrize("excluded_status", ["pending", "identifying", "error"])
    def test_excludes_non_visible_statuses(self, client, excluded_status):
        user_id, token = _register_user(client, f"excl_{excluded_status}")
        included_id = _seed_upload(user_id, status="graded")
        _seed_upload(user_id, status=excluded_status)

        resp = client.get("/api/omo/history", headers={"Authorization": f"Bearer {token}"})
        ids = [it["upload_id"] for it in resp.json()["items"]]
        assert ids == [included_id], (
            f"Status {excluded_status!r} should be filtered out; got {ids}"
        )

    @pytest.mark.parametrize("included_status", ["identified", "grading", "graded"])
    def test_includes_visible_statuses(self, client, included_status):
        user_id, token = _register_user(client, f"incl_{included_status}")
        included_id = _seed_upload(user_id, status=included_status)

        resp = client.get("/api/omo/history", headers={"Authorization": f"Bearer {token}"})
        ids = [it["upload_id"] for it in resp.json()["items"]]
        assert ids == [included_id]

    def test_pagination_limit_and_offset(self, client):
        user_id, token = _register_user(client, "page")
        now = datetime.now(timezone.utc)
        # Seed 5 uploads with deterministic timestamps
        ids = [
            _seed_upload(user_id, created_at=now - timedelta(hours=i))
            for i in range(5)
        ]
        # IDs above are oldest-last in time; newest-first should be ids[0], ids[1], ...

        # First page: 2 items
        resp1 = client.get(
            "/api/omo/history?limit=2&offset=0",
            headers={"Authorization": f"Bearer {token}"},
        )
        data1 = resp1.json()
        assert data1["total"] == 5
        assert data1["limit"] == 2
        assert data1["offset"] == 0
        assert [it["upload_id"] for it in data1["items"]] == ids[:2]

        # Second page
        resp2 = client.get(
            "/api/omo/history?limit=2&offset=2",
            headers={"Authorization": f"Bearer {token}"},
        )
        data2 = resp2.json()
        assert data2["total"] == 5
        assert data2["offset"] == 2
        assert [it["upload_id"] for it in data2["items"]] == ids[2:4]

        # Last page (single item)
        resp3 = client.get(
            "/api/omo/history?limit=2&offset=4",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert [it["upload_id"] for it in resp3.json()["items"]] == [ids[4]]

    def test_pagination_rejects_invalid_params(self, client):
        _user_id, token = _register_user(client, "badpage")
        headers = {"Authorization": f"Bearer {token}"}

        # limit > 50 → 422
        resp = client.get("/api/omo/history?limit=999", headers=headers)
        assert resp.status_code == 422

        # offset < 0 → 422
        resp = client.get("/api/omo/history?offset=-1", headers=headers)
        assert resp.status_code == 422

    def test_user_isolation(self, client):
        a_id, a_token = _register_user(client, "isolation_a")
        b_id, b_token = _register_user(client, "isolation_b")
        a_upload = _seed_upload(a_id)
        b_upload = _seed_upload(b_id)

        resp_a = client.get("/api/omo/history", headers={"Authorization": f"Bearer {a_token}"})
        ids_a = [it["upload_id"] for it in resp_a.json()["items"]]
        assert ids_a == [a_upload], "Student A must see only their uploads"
        assert b_upload not in ids_a

        resp_b = client.get("/api/omo/history", headers={"Authorization": f"Bearer {b_token}"})
        ids_b = [it["upload_id"] for it in resp_b.json()["items"]]
        assert ids_b == [b_upload]
        assert a_upload not in ids_b

    def test_answers_count_reflects_answers_array_length(self, client):
        user_id, token = _register_user(client, "count")
        # 3-answer upload
        _seed_upload(
            user_id,
            answers=[
                {"question_id": "fb_1", "student_answer": "A", "score": 1.0},
                {"question_id": "fb_2", "student_answer": "B", "score": 0.0},
                {"question_id": "mc_1", "student_answer": "C", "score": 1.0},
            ],
        )
        resp = client.get("/api/omo/history", headers={"Authorization": f"Bearer {token}"})
        items = resp.json()["items"]
        assert len(items) == 1
        assert items[0]["answers_count"] == 3

    def test_lesson_title_falls_back_to_identification_when_lesson_id_null(self, client):
        """For status='identified' rows the student hasn't confirmed yet,
        lesson_id may be NULL; we should fall back to the top AI candidate."""
        user_id, token = _register_user(client, "fallback")
        _seed_upload(
            user_id,
            status="identified",
            lesson_id=None,
            identification=[
                {
                    "lesson_id": 42,
                    "title": "G5-L25 候選課文",
                    "grade_code": "G5-L25",
                    "confidence": 0.92,
                    "reasoning": "...",
                }
            ],
        )
        resp = client.get("/api/omo/history", headers={"Authorization": f"Bearer {token}"})
        items = resp.json()["items"]
        assert len(items) == 1
        assert items[0]["lesson_title"] == "G5-L25 候選課文"
        assert items[0]["grade_code"] == "G5-L25"
        assert items[0]["lesson_id"] == 42
