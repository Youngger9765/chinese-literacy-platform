"""Characterization tests for OMO routes split — issue #1949.

TDD Phase 1 (Red → Green): pin current behaviour for all 11 endpoints
BEFORE splitting omo.py into omo/upload.py, omo/grade.py, omo/lifecycle.py.

After split, ALL these tests must still pass (same URL paths, same
response shapes, same status codes).

Endpoints covered:
  GET    /api/omo/lessons                              → TestLessonsEndpoint
  POST   /api/omo/upload                               → TestUploadEndpoint
  POST   /api/omo/{upload_id}/attempt                  → TestAttemptEndpoint
  POST   /api/omo/{upload_id}/confirm                  → TestGradeEndpoint (grade cluster)
  GET    /api/omo/{upload_id}                          → TestGradeEndpoint
  POST   /api/omo/{upload_id}/regrade                  → TestGradeEndpoint
  PATCH  /api/omo/{upload_id}/answers/{q_id}/flag      → TestLifecycleEndpoint
  GET    /api/omo/{upload_id}/images/{attempt_id}/{n}  → TestLifecycleEndpoint
  DELETE /api/omo/{upload_id}                          → TestLifecycleEndpoint
  GET    /api/omo/{upload_id}/crops/{question_id}      → TestLifecycleEndpoint
  GET    /api/omo/by-lesson/{lesson_id}                → TestLifecycleEndpoint

Run:
    cd backend && python -m pytest tests/test_characterization_omo_1949.py -v
"""

from __future__ import annotations

import io
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from unittest.mock import patch, MagicMock

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role
from app.models.omo_upload import OmoUpload, OmoUploadAttempt
from app.auth.rate_limiter import ai_rate_limiter

# ---------------------------------------------------------------------------
# SQLite in-memory DB
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
        session.add(Role(
            name=r["name"],
            display_name=r["display_name"],
            scope_level=r["scope_level"],
        ))
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
# Helpers
# ---------------------------------------------------------------------------

_TINY_JPEG = bytes([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
    0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
    0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
    0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x02,
    0x00, 0x02, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0xFB, 0xFF,
    0xD9,
])


def _make_file(data: bytes, mime: str = "image/jpeg", name: str = "test.jpg"):
    return ("files", (name, io.BytesIO(data), mime))


def _auth(client, suffix: str) -> str:
    email = f"char1949_{suffix}@example.com"
    reg = client.post("/api/auth/register", json={
        "email": email,
        "password": "TestPass123!",
        "name": f"Char1949 {suffix}",
    })
    if reg.status_code == 201:
        vt = reg.json().get("verification_token")
        if vt:
            client.post("/api/auth/verify-email", json={"token": vt})
    login = client.post("/api/auth/login", json={"email": email, "password": "TestPass123!"})
    return login.json()["access_token"]


def _force_status(upload_id: int, status: str, extra: dict | None = None):
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
# TestLessonsEndpoint — GET /api/omo/lessons
# ---------------------------------------------------------------------------

class TestLessonsEndpoint:
    """GET /api/omo/lessons returns a list of lesson summaries."""

    def test_lessons_requires_auth(self, client):
        resp = client.get("/api/omo/lessons")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    def test_lessons_returns_list(self, client):
        token = _auth(client, "lessons_list")
        resp = client.get(
            "/api/omo/lessons",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list), "Expected list response"

    def test_lessons_items_have_required_fields(self, client):
        token = _auth(client, "lessons_fields")
        resp = client.get(
            "/api/omo/lessons",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        if data:
            item = data[0]
            assert "lesson_id" in item
            assert "grade_code" in item
            assert "title" in item


# ---------------------------------------------------------------------------
# TestUploadEndpoint — POST /api/omo/upload + POST /api/omo/{id}/attempt
# ---------------------------------------------------------------------------

class TestUploadEndpoint:
    """POST /api/omo/upload behaviour pins for route split."""

    @pytest.fixture(autouse=True)
    def _patch_deps(self):
        with patch("app.routes.omo.upload._upload_to_gcs", return_value="gs://bucket/path.jpg"), \
             patch("app.routes.omo.upload._run_identification"):
            yield

    def test_upload_requires_auth(self, client):
        resp = client.post(
            "/api/omo/upload",
            files=[_make_file(_TINY_JPEG)],
        )
        assert resp.status_code == 401

    def test_upload_returns_201_with_upload_id(self, client):
        token = _auth(client, "upload_201")
        resp = client.post(
            "/api/omo/upload",
            files=[_make_file(_TINY_JPEG + b"up201")],
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "upload_id" in data
        assert data["status"] == "identifying"
        assert data["from_cache"] is False

    def test_upload_response_shape(self, client):
        """Response must have all required OmoUploadResponse fields."""
        token = _auth(client, "upload_shape")
        resp = client.post(
            "/api/omo/upload",
            files=[_make_file(_TINY_JPEG + b"shape_test")],
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201
        data = resp.json()
        required_fields = {"upload_id", "status", "candidates", "answers", "from_cache", "already_graded"}
        missing = required_fields - set(data.keys())
        assert not missing, f"Missing response fields: {missing}"

    def test_upload_dedup_returns_from_cache(self, client):
        """Second identical upload returns from_cache=True."""
        token = _auth(client, "upload_dedup_1949")
        headers = {"Authorization": f"Bearer {token}"}
        unique = _TINY_JPEG + b"dedup_1949_upload"

        resp1 = client.post("/api/omo/upload", files=[_make_file(unique)], headers=headers)
        assert resp1.status_code == 201

        resp2 = client.post("/api/omo/upload", files=[_make_file(unique)], headers=headers)
        assert resp2.status_code == 201
        assert resp2.json()["from_cache"] is True


class TestAttemptEndpoint:
    """POST /api/omo/{upload_id}/attempt behaviour."""

    @pytest.fixture(autouse=True)
    def _patch_deps(self):
        with patch("app.routes.omo.upload._upload_to_gcs", return_value="gs://bucket/path.jpg"), \
             patch("app.routes.omo.upload._run_identification"):
            yield

    def _create_upload(self, client, suffix: str) -> tuple[str, int]:
        token = _auth(client, suffix)
        headers = {"Authorization": f"Bearer {token}"}
        resp = client.post(
            "/api/omo/upload",
            files=[_make_file(_TINY_JPEG + suffix.encode())],
            headers=headers,
        )
        assert resp.status_code == 201
        return token, resp.json()["upload_id"]

    def test_attempt_returns_201(self, client):
        token, upload_id = self._create_upload(client, "attempt_201")
        resp = client.post(
            f"/api/omo/{upload_id}/attempt",
            files=[_make_file(_TINY_JPEG + b"attempt2")],
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["upload_id"] == upload_id
        assert data["status"] == "identifying"
        assert "attempt_id" in data
        assert "attempt_idx" in data

    def test_attempt_404_for_wrong_user(self, client):
        _, upload_id = self._create_upload(client, "attempt_wrong_own")
        token2 = _auth(client, "attempt_other_user")
        resp = client.post(
            f"/api/omo/{upload_id}/attempt",
            files=[_make_file(_TINY_JPEG + b"other")],
            headers={"Authorization": f"Bearer {token2}"},
        )
        assert resp.status_code == 404

    def test_attempt_requires_auth(self, client):
        _, upload_id = self._create_upload(client, "attempt_noauth")
        resp = client.post(
            f"/api/omo/{upload_id}/attempt",
            files=[_make_file(_TINY_JPEG)],
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# TestGradeEndpoint — confirm + status poll + regrade
# ---------------------------------------------------------------------------

class TestGradeEndpoint:
    """Grade cluster: confirm, status poll, regrade."""

    @pytest.fixture(autouse=True)
    def _patch_deps(self):
        with patch("app.routes.omo.upload._upload_to_gcs", return_value="gs://bucket/path.jpg"), \
             patch("app.routes.omo.upload._run_identification"), \
             patch("app.routes.omo.grade._run_grading"):
            yield

    def _create_identified_upload(self, client, suffix: str, lesson_id: int = 1) -> tuple[str, int]:
        token = _auth(client, suffix)
        headers = {"Authorization": f"Bearer {token}"}
        resp = client.post(
            "/api/omo/upload",
            files=[_make_file(_TINY_JPEG + suffix.encode())],
            headers=headers,
        )
        assert resp.status_code == 201
        upload_id = resp.json()["upload_id"]
        candidates = [{"lesson_id": lesson_id, "grade_code": "G5-L1", "title": "T",
                       "confidence": 0.9, "reasoning": "r"}]
        _force_status(upload_id, "identified", {"identification": candidates})
        return token, upload_id

    def test_confirm_returns_200_with_grading_status(self, client):
        token, upload_id = self._create_identified_upload(client, "confirm_200")
        resp = client.post(
            f"/api/omo/{upload_id}/confirm",
            json={"confirmed_lesson_id": 1},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "grading"
        assert data["upload_id"] == upload_id
        assert "lesson_id" in data

    def test_confirm_requires_auth(self, client):
        resp = client.post("/api/omo/999/confirm", json={"confirmed_lesson_id": 1})
        assert resp.status_code == 401

    def test_confirm_nonexistent_upload_returns_404(self, client):
        token = _auth(client, "confirm_404")
        resp = client.post(
            "/api/omo/99999/confirm",
            json={"confirmed_lesson_id": 1},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    def test_get_upload_status_returns_200(self, client):
        token, upload_id = self._create_identified_upload(client, "poll_200")
        resp = client.get(
            f"/api/omo/{upload_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["upload_id"] == upload_id
        assert "status" in data

    def test_get_upload_status_requires_auth(self, client):
        resp = client.get("/api/omo/999")
        assert resp.status_code == 401

    def test_get_upload_status_404_wrong_user(self, client):
        token1, upload_id = self._create_identified_upload(client, "poll_404_owner")
        token2 = _auth(client, "poll_404_other")
        resp = client.get(
            f"/api/omo/{upload_id}",
            headers={"Authorization": f"Bearer {token2}"},
        )
        assert resp.status_code == 404

    def test_regrade_from_graded_returns_grading(self, client):
        token, upload_id = self._create_identified_upload(client, "regrade_graded")
        _force_status(upload_id, "graded", {"lesson_id": 1, "answers": []})
        resp = client.post(
            f"/api/omo/{upload_id}/regrade",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "grading"

    def test_regrade_while_grading_returns_409(self, client):
        token, upload_id = self._create_identified_upload(client, "regrade_409")
        _force_status(upload_id, "grading", {"lesson_id": 1})
        resp = client.post(
            f"/api/omo/{upload_id}/regrade",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 409

    def test_regrade_requires_auth(self, client):
        resp = client.post("/api/omo/999/regrade")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# TestLifecycleEndpoint — flag, signed-url, delete, crop, by-lesson
# ---------------------------------------------------------------------------

class TestLifecycleEndpoint:
    """Lifecycle cluster: flag + image signed URL + delete + crop + by-lesson."""

    @pytest.fixture(autouse=True)
    def _patch_deps(self):
        with patch("app.routes.omo.upload._upload_to_gcs", return_value="gs://bucket/path.jpg"), \
             patch("app.routes.omo.upload._run_identification"), \
             patch("app.routes.omo.grade._run_grading"), \
             patch("app.routes.omo.lifecycle._get_signed_url", return_value="https://signed-url.example"):
            yield

    def _create_graded_upload(self, client, suffix: str) -> tuple[str, int, int]:
        """Returns (token, upload_id, attempt_id)."""
        token = _auth(client, suffix)
        headers = {"Authorization": f"Bearer {token}"}
        resp = client.post(
            "/api/omo/upload",
            files=[_make_file(_TINY_JPEG + suffix.encode())],
            headers=headers,
        )
        assert resp.status_code == 201
        upload_id = resp.json()["upload_id"]

        db = TestingSessionLocal()
        try:
            attempt = db.query(OmoUploadAttempt).filter(
                OmoUploadAttempt.omo_upload_id == upload_id
            ).first()
            attempt_id = attempt.id if attempt else 0
        finally:
            db.close()

        answers = [{"question_id": "mc_1", "answer": "A", "correct": True, "reasoning": "r"}]
        _force_status(upload_id, "graded", {
            "lesson_id": 1, "answers": answers,
        })
        return token, upload_id, attempt_id

    def test_flag_answer_returns_200(self, client):
        token, upload_id, _ = self._create_graded_upload(client, "flag_200")
        resp = client.patch(
            f"/api/omo/{upload_id}/answers/mc_1/flag",
            json={"reason": "wrong answer"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["flagged"] is True
        assert data["upload_id"] == upload_id
        assert data["question_id"] == "mc_1"

    def test_flag_requires_graded_status(self, client):
        token = _auth(client, "flag_409")
        headers = {"Authorization": f"Bearer {token}"}
        resp = client.post(
            "/api/omo/upload",
            files=[_make_file(_TINY_JPEG + b"flag_409")],
            headers=headers,
        )
        assert resp.status_code == 201
        upload_id = resp.json()["upload_id"]
        resp = client.patch(
            f"/api/omo/{upload_id}/answers/mc_1/flag",
            json={},
            headers=headers,
        )
        assert resp.status_code == 409

    def test_flag_requires_auth(self, client):
        resp = client.patch("/api/omo/999/answers/mc_1/flag", json={})
        assert resp.status_code == 401

    def test_image_signed_url_returns_url(self, client):
        token, upload_id, attempt_id = self._create_graded_upload(client, "img_url")
        resp = client.get(
            f"/api/omo/{upload_id}/images/{attempt_id}/0",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "url" in data
        assert "expires_in_seconds" in data
        assert data["expires_in_seconds"] == 3600

    def test_image_signed_url_requires_auth(self, client):
        resp = client.get("/api/omo/1/images/1/0")
        assert resp.status_code == 401

    def test_image_signed_url_404_wrong_user(self, client):
        token1, upload_id, attempt_id = self._create_graded_upload(client, "img_url_404")
        token2 = _auth(client, "img_url_other")
        resp = client.get(
            f"/api/omo/{upload_id}/images/{attempt_id}/0",
            headers={"Authorization": f"Bearer {token2}"},
        )
        assert resp.status_code == 404

    def test_delete_upload_returns_204(self, client):
        token, upload_id, _ = self._create_graded_upload(client, "delete_204")
        with patch("google.cloud.storage.Client"):
            resp = client.delete(
                f"/api/omo/{upload_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
        assert resp.status_code == 204

    def test_delete_requires_auth(self, client):
        resp = client.delete("/api/omo/999")
        assert resp.status_code == 401

    def test_delete_removes_record(self, client):
        token, upload_id, _ = self._create_graded_upload(client, "delete_then_404")
        headers = {"Authorization": f"Bearer {token}"}
        with patch("google.cloud.storage.Client"):
            client.delete(f"/api/omo/{upload_id}", headers=headers)
        resp = client.get(f"/api/omo/{upload_id}", headers=headers)
        assert resp.status_code == 404

    def test_crop_signed_url_no_crop_returns_null_url(self, client):
        token, upload_id, _ = self._create_graded_upload(client, "crop_null")
        resp = client.get(
            f"/api/omo/{upload_id}/crops/mc_1",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "url" in data
        assert data["url"] is None

    def test_crop_signed_url_with_crop_returns_url(self, client):
        token = _auth(client, "crop_with_url")
        headers = {"Authorization": f"Bearer {token}"}
        resp = client.post(
            "/api/omo/upload",
            files=[_make_file(_TINY_JPEG + b"crop_url")],
            headers=headers,
        )
        assert resp.status_code == 201
        upload_id = resp.json()["upload_id"]
        answers = [{"question_id": "mc_2", "answer": "B", "correct": True, "reasoning": "r",
                    "crop_image_url": "gs://lingoleap-omo-uploads/crops/1/mc_2.jpg"}]
        _force_status(upload_id, "graded", {"lesson_id": 1, "answers": answers})
        resp = client.get(
            f"/api/omo/{upload_id}/crops/mc_2",
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["url"] is not None

    def test_crop_requires_auth(self, client):
        resp = client.get("/api/omo/1/crops/mc_1")
        assert resp.status_code == 401

    def test_by_lesson_no_upload_returns_false(self, client):
        token = _auth(client, "by_lesson_false")
        resp = client.get(
            "/api/omo/by-lesson/99999",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_prior_upload"] is False

    def test_by_lesson_requires_auth(self, client):
        resp = client.get("/api/omo/by-lesson/1")
        assert resp.status_code == 401

    def test_by_lesson_with_graded_upload_returns_true(self, client):
        token, upload_id, _ = self._create_graded_upload(client, "by_lesson_true")
        db = TestingSessionLocal()
        try:
            upload = db.query(OmoUpload).filter(OmoUpload.id == upload_id).first()
            upload.lesson_id = 12345
            upload.superseded_at = None
            db.commit()
        finally:
            db.close()
        resp = client.get(
            "/api/omo/by-lesson/12345",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_prior_upload"] is True
        assert data["upload_id"] == upload_id


# ---------------------------------------------------------------------------
# Route registration test — all URL paths must be registered after split
# ---------------------------------------------------------------------------

class TestRouteRegistration:
    """All OMO URL patterns must be present in the FastAPI app after split."""

    def test_all_omo_routes_registered(self):
        registered_paths = {route.path for route in app.routes}
        expected = {
            "/api/omo/lessons",
            "/api/omo/upload",
            "/api/omo/{upload_id}/attempt",
            "/api/omo/{upload_id}/confirm",
            "/api/omo/{upload_id}",
            "/api/omo/{upload_id}/regrade",
            "/api/omo/{upload_id}/answers/{question_id}/flag",
            "/api/omo/{upload_id}/images/{attempt_id}/{n}",
            "/api/omo/{upload_id}/crops/{question_id}",
            "/api/omo/by-lesson/{lesson_id}",
        }
        missing = expected - registered_paths
        assert not missing, f"Missing route paths after split: {missing}"
