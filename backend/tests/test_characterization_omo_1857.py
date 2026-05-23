"""Characterization tests for OMO routes — issue #1857 split guard.

TDD Phase 1 (Red → Green): write tests that pin current behaviour BEFORE
any refactor.  After extraction into omo_upload_validator.py,
omo_upload_service.py, omo_state_service.py these tests MUST still pass.

Four behaviour clusters:
  A. Upload input-validation (empty / oversized / bad-MIME / too-many files)
     — all must reject BEFORE any GCS work.
  B. Dedup: duplicate image scoped per student returns cached flags.
  C. Confirm: maps synthetic lesson_id → Story.id via grade_code.
  D. Regrade: rejects grading/no-lesson states; queues for graded/error/identified.

Run:
    cd backend && python -m pytest tests/test_characterization_omo_1857.py -v
"""

from __future__ import annotations

import io
import sys
import os
import hashlib

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
# SQLite in-memory DB (same pattern as other omo tests)
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
# Minimal valid JPEG (2x2 pixels) — small enough for all size tests
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


# ---------------------------------------------------------------------------
# Helper: register + login → token
# ---------------------------------------------------------------------------

def _auth(client, suffix: str) -> str:
    email = f"char1857_{suffix}@example.com"
    reg = client.post("/api/auth/register", json={
        "email": email,
        "password": "TestPass123!",
        "name": f"Char1857 {suffix}",
    })
    if reg.status_code == 201:
        vt = reg.json().get("verification_token")
        if vt:
            client.post("/api/auth/verify-email", json={"token": vt})
    login = client.post("/api/auth/login", json={"email": email, "password": "TestPass123!"})
    return login.json()["access_token"]


# ---------------------------------------------------------------------------
# Helper: force upload to a specific status via direct DB write
# ---------------------------------------------------------------------------

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
# Cluster A: Upload input validation
# ---------------------------------------------------------------------------

class TestUploadInputValidation:
    """These 400/413 responses MUST come back before any GCS interaction.

    All tests patch _upload_to_gcs so that if any validation is bypassed
    the patch call count will remain 0 — that is the tautology check.
    """

    @pytest.fixture(autouse=True)
    def _patch_gcs(self):
        """Patch GCS upload so we can assert it was never called on rejection."""
        with patch("app.routes.omo.upload._upload_to_gcs") as mock_gcs:
            self._gcs_mock = mock_gcs
            yield

    def _get_headers(self, client):
        token = _auth(client, "upload_val_" + str(id(self)))
        return {"Authorization": f"Bearer {token}"}

    def test_empty_files_list_returns_400(self, client):
        """Uploading zero files → 400 before GCS."""
        headers = self._get_headers(client)
        # TestClient multipart with empty list — send no file parts
        resp = client.post(
            "/api/omo/upload",
            headers=headers,
            # Omitting files entirely simulates no-file upload; FastAPI 422
            # for missing required field also demonstrates pre-GCS rejection
        )
        # Either 400 (our check) or 422 (FastAPI required field) — both pre-GCS
        assert resp.status_code in (400, 422), f"Expected 400/422, got {resp.status_code}"
        assert self._gcs_mock.call_count == 0, "GCS must not be called when no files supplied"

    def test_oversized_file_returns_413(self, client):
        """File > 10MB → 413 before GCS."""
        headers = self._get_headers(client)
        big_data = b"x" * (10 * 1024 * 1024 + 1)  # 10MB + 1 byte
        resp = client.post(
            "/api/omo/upload",
            files=[_make_file(big_data)],
            headers=headers,
        )
        assert resp.status_code == 413, f"Expected 413, got {resp.status_code}: {resp.text}"
        assert self._gcs_mock.call_count == 0, "GCS must not be called for oversized file"

    def test_bad_mime_type_returns_400(self, client):
        """Non-image MIME → 400 before GCS."""
        headers = self._get_headers(client)
        resp = client.post(
            "/api/omo/upload",
            files=[_make_file(b"<html></html>", mime="text/html", name="evil.html")],
            headers=headers,
        )
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
        assert self._gcs_mock.call_count == 0, "GCS must not be called for invalid MIME"

    def test_too_many_files_returns_400(self, client):
        """More than 20 files → 400 before GCS."""
        headers = self._get_headers(client)
        files = [_make_file(_TINY_JPEG + bytes([i]), name=f"img{i}.jpg") for i in range(21)]
        resp = client.post(
            "/api/omo/upload",
            files=files,
            headers=headers,
        )
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
        assert self._gcs_mock.call_count == 0, "GCS must not be called when too many files"

    def test_empty_file_bytes_returns_400(self, client):
        """Zero-byte file content → 400 before GCS."""
        headers = self._get_headers(client)
        resp = client.post(
            "/api/omo/upload",
            files=[_make_file(b"")],
            headers=headers,
        )
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
        assert self._gcs_mock.call_count == 0, "GCS must not be called for empty file bytes"


# ---------------------------------------------------------------------------
# Cluster B: Dedup — per-student, returns cached flags
# ---------------------------------------------------------------------------

class TestUploadDedup:
    """SHA-256 dedup must be scoped per student."""

    @pytest.fixture(autouse=True)
    def _patch_gcs_and_bg(self):
        with patch("app.routes.omo.upload._upload_to_gcs", return_value="gs://bucket/path.jpg"), \
             patch("app.routes.omo.upload._run_identification"):
            yield

    def test_duplicate_upload_same_student_returns_from_cache(self, client):
        """Same image bytes uploaded twice by same student → 2nd has from_cache=True."""
        token = _auth(client, "dedup_same_student")
        headers = {"Authorization": f"Bearer {token}"}
        unique_bytes = _TINY_JPEG + b"dedup_same_1857"

        resp1 = client.post(
            "/api/omo/upload",
            files=[_make_file(unique_bytes)],
            headers=headers,
        )
        assert resp1.status_code == 201

        resp2 = client.post(
            "/api/omo/upload",
            files=[_make_file(unique_bytes)],
            headers=headers,
        )
        assert resp2.status_code == 201
        data2 = resp2.json()
        assert data2["from_cache"] is True, "Second identical upload must return from_cache=True"

    def test_duplicate_upload_returns_already_graded_flag(self, client):
        """When the cached upload is graded, already_graded must be True."""
        token = _auth(client, "dedup_graded_flag")
        headers = {"Authorization": f"Bearer {token}"}
        unique_bytes = _TINY_JPEG + b"dedup_graded_1857"

        resp1 = client.post(
            "/api/omo/upload",
            files=[_make_file(unique_bytes)],
            headers=headers,
        )
        assert resp1.status_code == 201
        upload_id = resp1.json()["upload_id"]
        _force_status(upload_id, "graded", {"lesson_id": 1, "answers": []})

        resp2 = client.post(
            "/api/omo/upload",
            files=[_make_file(unique_bytes)],
            headers=headers,
        )
        assert resp2.status_code == 201
        data2 = resp2.json()
        assert data2["from_cache"] is True
        assert data2["already_graded"] is True, "already_graded must be True when cached upload is graded"

    def test_duplicate_upload_different_students_not_cached(self, client):
        """Same image bytes, different students → NOT deduped (student-scoped)."""
        token_a = _auth(client, "dedup_cross_a_1857")
        token_b = _auth(client, "dedup_cross_b_1857")
        unique_bytes = _TINY_JPEG + b"dedup_cross_1857"

        resp_a = client.post(
            "/api/omo/upload",
            files=[_make_file(unique_bytes)],
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert resp_a.status_code == 201

        resp_b = client.post(
            "/api/omo/upload",
            files=[_make_file(unique_bytes)],
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert resp_b.status_code == 201
        data_b = resp_b.json()
        assert data_b["from_cache"] is False, "Different students must never share dedup cache"

    def test_different_bytes_no_cache(self, client):
        """Different image bytes → fresh upload, from_cache=False."""
        token = _auth(client, "dedup_different")
        headers = {"Authorization": f"Bearer {token}"}

        resp1 = client.post(
            "/api/omo/upload",
            files=[_make_file(_TINY_JPEG + b"unique_a")],
            headers=headers,
        )
        assert resp1.status_code == 201

        resp2 = client.post(
            "/api/omo/upload",
            files=[_make_file(_TINY_JPEG + b"unique_b")],
            headers=headers,
        )
        assert resp2.status_code == 201
        data2 = resp2.json()
        assert data2["from_cache"] is False, "Different bytes must not be cached"


# ---------------------------------------------------------------------------
# Cluster C: Confirm — synthetic lesson_id → Story.id via grade_code
# ---------------------------------------------------------------------------

class TestConfirmLessonIdMapping:
    """Confirm must translate synthetic lesson_id → real Story.id through grade_code.

    The identifier returns a synthetic lesson_id (YAML display_order integer).
    Confirm reads upload.identification candidates, finds the grade_code for the
    confirmed_lesson_id, then calls get_lesson_by_code(grade_code) to resolve
    the canonical Story.id used by _run_grading.
    """

    @pytest.fixture(autouse=True)
    def _patch_gcs_and_jobs(self):
        with patch("app.routes.omo.upload._upload_to_gcs", return_value="gs://bucket/path.jpg"), \
             patch("app.routes.omo.upload._run_identification"), \
             patch("app.routes.omo.grade._run_grading"):
            yield

    def _make_upload_with_identification(self, client, suffix: str, candidates: list) -> tuple[str, int]:
        """Create an upload and force it to identified state with given candidates."""
        token = _auth(client, suffix)
        headers = {"Authorization": f"Bearer {token}"}
        unique_bytes = _TINY_JPEG + suffix.encode()

        resp = client.post(
            "/api/omo/upload",
            files=[_make_file(unique_bytes)],
            headers=headers,
        )
        assert resp.status_code == 201
        upload_id = resp.json()["upload_id"]

        # Force to identified with synthetic candidates
        _force_status(upload_id, "identified", {"identification": candidates})
        return token, upload_id

    def test_confirm_with_no_grade_code_match_uses_confirmed_id_as_is(self, client):
        """When no grade_code in candidates, lesson_id passes through unchanged."""
        candidates = [{"lesson_id": 99, "grade_code": "", "title": "Test", "confidence": 0.9, "reasoning": "test"}]
        token, upload_id = self._make_upload_with_identification(client, "confirm_no_gc", candidates)
        headers = {"Authorization": f"Bearer {token}"}

        with patch("app.services.lesson_loader.get_lesson_by_code", return_value=None):
            resp = client.post(
                f"/api/omo/{upload_id}/confirm",
                json={"confirmed_lesson_id": 99},
                headers=headers,
            )
        assert resp.status_code == 200
        data = resp.json()
        # No mapping possible → lesson_id stays 99
        assert data["lesson_id"] == 99

    def test_confirm_maps_synthetic_id_to_story_id_via_grade_code(self, client):
        """Synthetic lesson_id 42 maps to Story.id 7 when grade_code resolves."""
        grade_code = "G5-L25"
        candidates = [
            {"lesson_id": 42, "grade_code": grade_code, "title": "Test Lesson",
             "confidence": 0.95, "reasoning": "test"},
        ]
        token, upload_id = self._make_upload_with_identification(client, "confirm_mapping", candidates)
        headers = {"Authorization": f"Bearer {token}"}

        # Simulate get_lesson_by_code returning a story with id=7
        fake_story = {"id": 7, "title": "Test Lesson", "grade_code": grade_code}
        with patch("app.services.lesson_loader.get_lesson_by_code", return_value=fake_story):
            resp = client.post(
                f"/api/omo/{upload_id}/confirm",
                json={"confirmed_lesson_id": 42},
                headers=headers,
            )
        assert resp.status_code == 200
        data = resp.json()
        # Must use Story.id=7, not synthetic 42
        assert data["lesson_id"] == 7, f"Expected Story.id=7, got {data['lesson_id']}"

    def test_confirm_rejects_grading_status(self, client):
        """Confirm while status=grading → 409."""
        candidates = [{"lesson_id": 1, "grade_code": "G5-L1", "title": "T", "confidence": 0.9, "reasoning": "r"}]
        token, upload_id = self._make_upload_with_identification(client, "confirm_grading_409", candidates)
        _force_status(upload_id, "grading")
        headers = {"Authorization": f"Bearer {token}"}

        resp = client.post(
            f"/api/omo/{upload_id}/confirm",
            json={"confirmed_lesson_id": 1},
            headers=headers,
        )
        assert resp.status_code == 409

    def test_confirm_rejects_graded_status(self, client):
        """Confirm while status=graded → 409 (use /regrade instead)."""
        candidates = [{"lesson_id": 1, "grade_code": "G5-L1", "title": "T", "confidence": 0.9, "reasoning": "r"}]
        token, upload_id = self._make_upload_with_identification(client, "confirm_graded_409", candidates)
        _force_status(upload_id, "graded", {"lesson_id": 1, "answers": []})
        headers = {"Authorization": f"Bearer {token}"}

        resp = client.post(
            f"/api/omo/{upload_id}/confirm",
            json={"confirmed_lesson_id": 1},
            headers=headers,
        )
        assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Cluster D: Regrade state machine
# ---------------------------------------------------------------------------

class TestRegradeStateMachine:
    """Regrade must only be allowed from graded/error/identified states."""

    @pytest.fixture(autouse=True)
    def _patch_gcs_and_jobs(self):
        with patch("app.routes.omo.upload._upload_to_gcs", return_value="gs://bucket/path.jpg"), \
             patch("app.routes.omo.upload._run_identification"), \
             patch("app.routes.omo.grade._run_grading"):
            yield

    def _make_upload(self, client, suffix: str) -> tuple[str, int]:
        token = _auth(client, suffix)
        headers = {"Authorization": f"Bearer {token}"}
        resp = client.post(
            "/api/omo/upload",
            files=[_make_file(_TINY_JPEG + suffix.encode())],
            headers=headers,
        )
        assert resp.status_code == 201
        return token, resp.json()["upload_id"]

    def test_regrade_from_graded_returns_200_and_grading(self, client):
        """Regrade from graded → 200, status=grading."""
        token, upload_id = self._make_upload(client, "rg_graded")
        _force_status(upload_id, "graded", {"lesson_id": 1, "answers": []})
        headers = {"Authorization": f"Bearer {token}"}

        resp = client.post(f"/api/omo/{upload_id}/regrade", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "grading"

    def test_regrade_from_error_returns_200_and_grading(self, client):
        """Regrade from error state → 200, status=grading (retry after failed grading)."""
        token, upload_id = self._make_upload(client, "rg_error")
        _force_status(upload_id, "error", {"lesson_id": 1})
        headers = {"Authorization": f"Bearer {token}"}

        resp = client.post(f"/api/omo/{upload_id}/regrade", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "grading"

    def test_regrade_from_identified_returns_200_and_grading(self, client):
        """Regrade from identified state → 200 (lesson already confirmed)."""
        token, upload_id = self._make_upload(client, "rg_identified")
        _force_status(upload_id, "identified", {"lesson_id": 1})
        headers = {"Authorization": f"Bearer {token}"}

        resp = client.post(f"/api/omo/{upload_id}/regrade", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "grading"

    def test_regrade_while_grading_returns_409(self, client):
        """Regrade while still grading → 409 (prevents double-grading)."""
        token, upload_id = self._make_upload(client, "rg_grading_409")
        _force_status(upload_id, "grading", {"lesson_id": 1})
        headers = {"Authorization": f"Bearer {token}"}

        resp = client.post(f"/api/omo/{upload_id}/regrade", headers=headers)
        assert resp.status_code == 409

    def test_regrade_without_lesson_id_returns_409(self, client):
        """Regrade when no lesson_id → 409 (must confirm first)."""
        token, upload_id = self._make_upload(client, "rg_no_lesson")
        # Upload is still identifying with no lesson_id
        headers = {"Authorization": f"Bearer {token}"}

        resp = client.post(f"/api/omo/{upload_id}/regrade", headers=headers)
        assert resp.status_code == 409

    def test_regrade_from_identifying_returns_409(self, client):
        """Regrade while identifying → 409 (not an allowed regrade state)."""
        token, upload_id = self._make_upload(client, "rg_identifying_409")
        # Upload starts as "identifying" — no lesson_id
        headers = {"Authorization": f"Bearer {token}"}

        resp = client.post(f"/api/omo/{upload_id}/regrade", headers=headers)
        assert resp.status_code == 409

    def test_regrade_queues_grading_job(self, client):
        """After regrade, polling GET shows status=grading (job was queued)."""
        token, upload_id = self._make_upload(client, "rg_poll_grading")
        _force_status(upload_id, "graded", {"lesson_id": 5, "answers": []})
        headers = {"Authorization": f"Bearer {token}"}

        client.post(f"/api/omo/{upload_id}/regrade", headers=headers)
        poll = client.get(f"/api/omo/{upload_id}", headers=headers)
        assert poll.status_code == 200
        assert poll.json()["status"] == "grading"
