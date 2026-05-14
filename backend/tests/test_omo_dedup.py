"""Contract tests for OMO Phase 1b — image hash dedup + regrade endpoint.

Tests:
    Dedup: uploading same image bytes twice → 2nd returns from_cache=True
    Dedup: uploading different bytes → fresh upload (not cached)
    Dedup: same image, different students → NOT deduped (student-scoped)
    Regrade: can regrade after graded
    Regrade: 409 while grading is in progress
    Regrade: 409 when no lesson_id confirmed yet

Run:
    cd backend && python -m pytest tests/test_omo_dedup.py -v
"""

import io
import sys
import os

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
from app.auth.rate_limiter import ai_rate_limiter

# ---------------------------------------------------------------------------
# Test DB setup (SQLite in-memory)
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

def register_and_login(client, email_suffix):
    email = f"{email_suffix}@example.com"
    reg = client.post("/api/auth/register", json={
        "email": email,
        "password": "TestPass123!",
        "name": f"Dedup Test {email_suffix}",
    })
    if reg.status_code == 201:
        verification_token = reg.json().get("verification_token")
        if verification_token:
            client.get(f"/api/auth/verify-email?token={verification_token}")
    login = client.post("/api/auth/login", json={
        "email": email,
        "password": "TestPass123!",
    })
    assert login.status_code == 200, f"Login failed: {login.text}"
    return login.json()["access_token"]


# Minimal valid JPEG (1x1 pixel)
_TINY_JPEG_A = bytes(
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
    b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a"
    b"\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\x1e"
    b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00"
    b"\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00"
    b"\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b"
    b"\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04"
    b"\x04\x00\x00\x01}\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa"
    b'\x07"q\x142\x81\x91\xa1\x08#B\xb1\xc1\x15R\xd1\xf0$3br'
    b"\x82\t\n\x16\x17\x18\x19\x1a%&'()*456789:CDEFGHIJ"
    b"STUVWXYZ\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xfb\xd5\xff\xd9"
)

# Different bytes (simulates a different image)
_TINY_JPEG_B = _TINY_JPEG_A[:10] + b"\x00\x00\x00" + _TINY_JPEG_A[13:]


def _force_upload_status(upload_id: int, status: str, extra: dict = None):
    from app.models.omo_upload import OmoUpload
    db = TestingSessionLocal()
    try:
        upload = db.query(OmoUpload).filter(OmoUpload.id == upload_id).first()
        if upload:
            upload.status = status
            if extra:
                for k, v in extra.items():
                    setattr(upload, k, v)
            db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestOmoDedup:
    def test_same_image_bytes_returns_from_cache(self, client):
        """Uploading identical image bytes twice → 2nd response has from_cache=True."""
        token = register_and_login(client, "dedup_same_img")
        headers = {"Authorization": f"Bearer {token}"}

        # First upload
        resp1 = client.post(
            "/api/omo/upload",
            files=[("files", ("ws.jpg", io.BytesIO(_TINY_JPEG_A), "image/jpeg"))],
            headers=headers,
        )
        assert resp1.status_code == 201, f"First upload failed: {resp1.text}"
        data1 = resp1.json()
        assert data1["from_cache"] is False
        upload_id_1 = data1["upload_id"]

        # Second upload with same bytes
        resp2 = client.post(
            "/api/omo/upload",
            files=[("files", ("ws_copy.jpg", io.BytesIO(_TINY_JPEG_A), "image/jpeg"))],
            headers=headers,
        )
        assert resp2.status_code == 201, f"Second upload failed: {resp2.text}"
        data2 = resp2.json()
        assert data2["from_cache"] is True, f"Expected from_cache=True, got: {data2}"
        assert data2["upload_id"] == upload_id_1, "Dedup should return same upload_id"

    def test_same_image_already_graded_returns_already_graded(self, client):
        """If the cached upload is graded, already_graded=True in response."""
        token = register_and_login(client, "dedup_graded")
        headers = {"Authorization": f"Bearer {token}"}

        # Upload
        resp1 = client.post(
            "/api/omo/upload",
            files=[("files", ("ws.jpg", io.BytesIO(_TINY_JPEG_A + b"graded_marker"), "image/jpeg"))],
            headers=headers,
        )
        assert resp1.status_code == 201
        upload_id = resp1.json()["upload_id"]

        # Force to graded
        _force_upload_status(upload_id, "graded", {
            "answers": [],
            "overall_score": 1.0,
            "lesson_id": 1,
        })

        # Upload same bytes again
        resp2 = client.post(
            "/api/omo/upload",
            files=[("files", ("ws_copy.jpg", io.BytesIO(_TINY_JPEG_A + b"graded_marker"), "image/jpeg"))],
            headers=headers,
        )
        assert resp2.status_code == 201
        data2 = resp2.json()
        assert data2["from_cache"] is True
        assert data2["already_graded"] is True

    def test_different_image_bytes_not_cached(self, client):
        """Different image bytes → new upload, from_cache=False."""
        token = register_and_login(client, "dedup_diff")
        headers = {"Authorization": f"Bearer {token}"}

        resp1 = client.post(
            "/api/omo/upload",
            files=[("files", ("ws_a.jpg", io.BytesIO(_TINY_JPEG_A + b"unique_a"), "image/jpeg"))],
            headers=headers,
        )
        assert resp1.status_code == 201
        upload_id_1 = resp1.json()["upload_id"]

        resp2 = client.post(
            "/api/omo/upload",
            files=[("files", ("ws_b.jpg", io.BytesIO(_TINY_JPEG_B + b"unique_b"), "image/jpeg"))],
            headers=headers,
        )
        assert resp2.status_code == 201
        data2 = resp2.json()
        assert data2["from_cache"] is False
        assert data2["upload_id"] != upload_id_1

    def test_same_image_different_students_not_cached(self, client):
        """Student A's image hash does NOT cause a cache hit for Student B."""
        token_a = register_and_login(client, "dedup_student_a")
        token_b = register_and_login(client, "dedup_student_b")

        unique_bytes = _TINY_JPEG_A + b"student_scope_test"

        resp_a = client.post(
            "/api/omo/upload",
            files=[("files", ("ws.jpg", io.BytesIO(unique_bytes), "image/jpeg"))],
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert resp_a.status_code == 201
        assert resp_a.json()["from_cache"] is False

        # Student B uploads same bytes — should NOT hit Student A's cache
        resp_b = client.post(
            "/api/omo/upload",
            files=[("files", ("ws.jpg", io.BytesIO(unique_bytes), "image/jpeg"))],
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert resp_b.status_code == 201
        data_b = resp_b.json()
        assert data_b["from_cache"] is False, "Different students should never share cache"


class TestOmoRegrade:
    def test_regrade_after_graded(self, client):
        """Can trigger regrade when status=graded."""
        token = register_and_login(client, "regrade_ok")
        headers = {"Authorization": f"Bearer {token}"}

        resp = client.post(
            "/api/omo/upload",
            files=[("files", ("ws.jpg", io.BytesIO(_TINY_JPEG_A + b"regrade_test"), "image/jpeg"))],
            headers=headers,
        )
        assert resp.status_code == 201
        upload_id = resp.json()["upload_id"]

        _force_upload_status(upload_id, "graded", {
            "lesson_id": 1,
            "answers": [],
            "overall_score": 0.8,
        })

        regrade_resp = client.post(
            f"/api/omo/{upload_id}/regrade",
            headers=headers,
        )
        assert regrade_resp.status_code == 200, f"Expected 200, got {regrade_resp.status_code}: {regrade_resp.text}"
        data = regrade_resp.json()
        assert data["status"] == "grading"

        # Poll — should be grading
        poll_resp = client.get(f"/api/omo/{upload_id}", headers=headers)
        assert poll_resp.status_code == 200
        assert poll_resp.json()["status"] == "grading"

    def test_regrade_while_grading_returns_409(self, client):
        """Regrade endpoint returns 409 if upload is already grading."""
        token = register_and_login(client, "regrade_409")
        headers = {"Authorization": f"Bearer {token}"}

        resp = client.post(
            "/api/omo/upload",
            files=[("files", ("ws.jpg", io.BytesIO(_TINY_JPEG_A + b"regrade_409"), "image/jpeg"))],
            headers=headers,
        )
        assert resp.status_code == 201
        upload_id = resp.json()["upload_id"]
        _force_upload_status(upload_id, "grading", {"lesson_id": 1})

        regrade_resp = client.post(
            f"/api/omo/{upload_id}/regrade",
            headers=headers,
        )
        assert regrade_resp.status_code == 409

    def test_regrade_without_lesson_id_returns_409(self, client):
        """Regrade when no lesson confirmed yet → 409."""
        token = register_and_login(client, "regrade_nolesson")
        headers = {"Authorization": f"Bearer {token}"}

        resp = client.post(
            "/api/omo/upload",
            files=[("files", ("ws.jpg", io.BytesIO(_TINY_JPEG_A + b"nolesson"), "image/jpeg"))],
            headers=headers,
        )
        assert resp.status_code == 201
        upload_id = resp.json()["upload_id"]
        # Upload is still "identifying" with no lesson_id

        regrade_resp = client.post(
            f"/api/omo/{upload_id}/regrade",
            headers=headers,
        )
        assert regrade_resp.status_code == 409

    def test_regrade_other_student_returns_404(self, client):
        """Student B cannot regrade Student A's upload."""
        token_a = register_and_login(client, "regrade_acl_a")
        token_b = register_and_login(client, "regrade_acl_b")

        resp = client.post(
            "/api/omo/upload",
            files=[("files", ("ws.jpg", io.BytesIO(_TINY_JPEG_A + b"acl_regrade"), "image/jpeg"))],
            headers={"Authorization": f"Bearer {token_a}"},
        )
        upload_id = resp.json()["upload_id"]
        _force_upload_status(upload_id, "graded", {"lesson_id": 1})

        regrade_resp = client.post(
            f"/api/omo/{upload_id}/regrade",
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert regrade_resp.status_code == 404
