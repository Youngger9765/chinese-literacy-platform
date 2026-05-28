"""Contract tests for OMO Phase 1a endpoints.

Tests:
    Happy path: upload → attempt → confirm (mocked grading) → result
    Multi-attempt: second attempt on same upload_id
    Flag: student flags an answer after grading
    Auth: 401 for all write endpoints without token
    Input validation: oversized file (413), bad mime (400), too many files (400)
    Access control: student A cannot see student B's upload

Uses SQLite in-memory DB (conftest.py patches JSONB → JSON).

Run:
    cd backend && python -m pytest tests/test_omo_upload.py -v
"""

import io
import sys
import os
from unittest.mock import patch

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
    """Clear in-memory rate limiter store before each test to prevent 429 cascade."""
    with ai_rate_limiter._lock:
        ai_rate_limiter._store.clear()
    yield


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def register_and_login(client, email_suffix="omouser"):
    """Register a user and return a bearer token."""
    email = f"{email_suffix}@example.com"
    reg = client.post("/api/auth/register", json={
        "email": email,
        "password": "TestPass123!",
        "name": f"OMO Test {email_suffix}",
    })
    if reg.status_code == 201:
        verification_token = reg.json().get("verification_token")
        if verification_token:
            client.get(f"/api/auth/verify-email?token={verification_token}")
    login = client.post("/api/auth/login", json={
        "email": email,
        "password": "TestPass123!",
    })
    assert login.status_code == 200, f"Login failed for {email}: {login.text}"
    return login.json()["access_token"]


# ---------------------------------------------------------------------------
# Minimal valid JPEG bytes (1×1 pixel)
# ---------------------------------------------------------------------------

_TINY_JPEG = bytes(
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

# Helpers to force upload status via direct DB writes (bypass background tasks)

def _force_upload_status(upload_id: int, status: str, extra: dict = None):
    """Directly set OmoUpload.status in the test DB."""
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

class TestOmoUploadHappyPath:
    def test_upload_returns_201_with_identifying_status(self, client):
        """Authenticated student uploads a valid JPEG → 201 + status=identifying."""
        token = register_and_login(client, "omo_happy1a")
        headers = {"Authorization": f"Bearer {token}"}

        response = client.post(
            "/api/omo/upload",
            files=[("files", ("worksheet.jpg", io.BytesIO(_TINY_JPEG), "image/jpeg"))],
            headers=headers,
        )
        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"

        data = response.json()
        assert data["status"] == "identifying"
        assert "upload_id" in data
        assert isinstance(data["upload_id"], int)
        assert data["upload_id"] > 0
        assert isinstance(data["candidates"], list)
        assert isinstance(data["answers"], list)

    def test_can_poll_status_after_upload(self, client):
        """After upload, GET /omo/{id} returns the same record."""
        token = register_and_login(client, "omo_poll1a")
        headers = {"Authorization": f"Bearer {token}"}

        post_resp = client.post(
            "/api/omo/upload",
            files=[("files", ("worksheet.jpg", io.BytesIO(_TINY_JPEG), "image/jpeg"))],
            headers=headers,
        )
        assert post_resp.status_code == 201
        upload_id = post_resp.json()["upload_id"]

        get_resp = client.get(f"/api/omo/{upload_id}", headers=headers)
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data["upload_id"] == upload_id
        assert data["status"] in ("pending", "identifying", "identified", "grading", "graded", "error")

    def test_upload_with_lesson_hint_starts_grading_immediately(self, client):
        """Known lesson hint should skip identify/confirm and queue grading directly."""
        token = register_and_login(client, "omo_hint_direct_grade")
        headers = {"Authorization": "Bearer " + token}

        with patch("app.routes.omo._run_identification") as mock_identify, patch(
            "app.routes.omo._run_grading"
        ) as mock_grading:
            response = client.post(
                "/api/omo/upload",
                files=[("files", ("worksheet.jpg", io.BytesIO(_TINY_JPEG), "image/jpeg"))],
                data={"lesson_code_hint": "G7-L28"},
                headers=headers,
            )

        assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["status"] == "grading"
        assert len(data["candidates"]) == 1
        assert data["candidates"][0]["grade_code"] == "G7-L28"
        mock_identify.assert_not_called()
        mock_grading.assert_called_once()

    def test_full_happy_path_mocked_grading(self, client):
        """Upload → force identified → confirm → verify status=grading → force graded → poll result."""
        token = register_and_login(client, "omo_fullpath")
        headers = {"Authorization": f"Bearer {token}"}

        # 1. Upload
        post_resp = client.post(
            "/api/omo/upload",
            files=[("files", ("ws.jpg", io.BytesIO(_TINY_JPEG), "image/jpeg"))],
            headers=headers,
        )
        assert post_resp.status_code == 201
        upload_id = post_resp.json()["upload_id"]

        # 2. Force identified (simulate background AI task completing)
        _force_upload_status(upload_id, "identified", {
            "identification": [
                {
                    "lesson_id": 1,
                    "grade_code": "G4-1",
                    "title": "贏得喝采的輸家",
                    "confidence": 0.95,
                    "reasoning": "Title found at top of worksheet",
                }
            ],
            "ai_confidence": 0.95,
        })

        # 3. Confirm lesson (kicks off grading background task, returns status=grading)
        confirm_resp = client.post(
            f"/api/omo/{upload_id}/confirm",
            json={"confirmed_lesson_id": 1},
            headers=headers,
        )
        assert confirm_resp.status_code == 200, f"Got {confirm_resp.status_code}: {confirm_resp.text}"
        data = confirm_resp.json()
        assert data["lesson_id"] == 1
        assert data["status"] == "grading"

        # 4. Force graded (simulate background grader completing)
        mock_answers = [
            {
                "question_id": "fb_1",
                "student_answer": "漂亮",
                "correct_answer": "漂亮",
                "score": 1.0,
                "ai_confidence": 0.92,
                "reasoning": "完全一致",
                "source_attempt_id": None,
                "position": None,
                "flag": None,
            }
        ]
        _force_upload_status(upload_id, "graded", {
            "answers": mock_answers,
            "overall_score": 1.0,
            "ai_overall_confidence": 0.92,
            "progress": {"stage": "done", "total": 1, "graded": 1},
        })

        # 5. Poll result
        get_resp = client.get(f"/api/omo/{upload_id}", headers=headers)
        assert get_resp.status_code == 200
        result = get_resp.json()
        assert result["status"] == "graded"
        assert result["overall_score"] == 1.0
        assert len(result["answers"]) == 1
        assert result["answers"][0]["question_id"] == "fb_1"


class TestOmoMultiAttempt:
    def test_add_second_attempt(self, client):
        """Student can add a second attempt after upload."""
        token = register_and_login(client, "omo_multiattempt")
        headers = {"Authorization": f"Bearer {token}"}

        # Upload first attempt
        post_resp = client.post(
            "/api/omo/upload",
            files=[("files", ("ws1.jpg", io.BytesIO(_TINY_JPEG), "image/jpeg"))],
            headers=headers,
        )
        assert post_resp.status_code == 201
        upload_id = post_resp.json()["upload_id"]

        # Add second attempt
        attempt_resp = client.post(
            f"/api/omo/{upload_id}/attempt",
            files=[("files", ("ws2.jpg", io.BytesIO(_TINY_JPEG), "image/jpeg"))],
            headers=headers,
        )
        assert attempt_resp.status_code == 201, f"Got {attempt_resp.status_code}: {attempt_resp.text}"
        data = attempt_resp.json()
        assert data["upload_id"] == upload_id
        assert data["attempt_idx"] == 1
        assert data["status"] == "identifying"

    def test_attempt_on_other_student_upload_returns_404(self, client):
        """Student B cannot add attempt to Student A's upload."""
        token_a = register_and_login(client, "omo_attemptA")
        token_b = register_and_login(client, "omo_attemptB")

        # A uploads
        post_resp = client.post(
            "/api/omo/upload",
            files=[("files", ("ws.jpg", io.BytesIO(_TINY_JPEG), "image/jpeg"))],
            headers={"Authorization": f"Bearer {token_a}"},
        )
        assert post_resp.status_code == 201
        upload_id = post_resp.json()["upload_id"]

        # B tries to add attempt
        attempt_resp = client.post(
            f"/api/omo/{upload_id}/attempt",
            files=[("files", ("ws.jpg", io.BytesIO(_TINY_JPEG), "image/jpeg"))],
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert attempt_resp.status_code == 404


class TestOmoFlagAnswer:
    def test_flag_answer_after_grading(self, client):
        """Student can flag a question after grading is done."""
        token = register_and_login(client, "omo_flag")
        headers = {"Authorization": f"Bearer {token}"}

        # Upload + force graded
        post_resp = client.post(
            "/api/omo/upload",
            files=[("files", ("ws.jpg", io.BytesIO(_TINY_JPEG), "image/jpeg"))],
            headers=headers,
        )
        upload_id = post_resp.json()["upload_id"]

        _force_upload_status(upload_id, "graded", {
            "answers": [
                {
                    "question_id": "fb_2",
                    "student_answer": "天下",
                    "correct_answer": "天地",
                    "score": 0.0,
                    "ai_confidence": 0.85,
                    "reasoning": "答案不符",
                    "source_attempt_id": None,
                    "position": None,
                    "flag": None,
                }
            ],
            "overall_score": 0.0,
        })

        # Flag the question
        flag_resp = client.patch(
            f"/api/omo/{upload_id}/answers/fb_2/flag",
            json={"reason": "我寫的是天地，AI辨識錯了"},
            headers=headers,
        )
        assert flag_resp.status_code == 200, f"Got {flag_resp.status_code}: {flag_resp.text}"
        assert flag_resp.json()["flagged"] is True

        # Verify flag persisted
        get_resp = client.get(f"/api/omo/{upload_id}", headers=headers)
        answers = get_resp.json()["answers"]
        assert answers[0]["flag"] is not None
        assert answers[0]["flag"]["reason"] == "我寫的是天地，AI辨識錯了"

    def test_flag_before_grading_returns_409(self, client):
        """Cannot flag while still grading."""
        token = register_and_login(client, "omo_flag_early")
        headers = {"Authorization": f"Bearer {token}"}

        post_resp = client.post(
            "/api/omo/upload",
            files=[("files", ("ws.jpg", io.BytesIO(_TINY_JPEG), "image/jpeg"))],
            headers=headers,
        )
        upload_id = post_resp.json()["upload_id"]
        # Status is still "identifying" — not "graded"

        flag_resp = client.patch(
            f"/api/omo/{upload_id}/answers/fb_1/flag",
            json={"reason": "test"},
            headers=headers,
        )
        assert flag_resp.status_code == 409


class TestOmoUploadAuth:
    def test_upload_unauthenticated_returns_401(self, client):
        """No token → 401."""
        response = client.post(
            "/api/omo/upload",
            files=[("files", ("worksheet.jpg", io.BytesIO(_TINY_JPEG), "image/jpeg"))],
        )
        assert response.status_code == 401

    def test_get_unauthenticated_returns_401(self, client):
        """No token on GET → 401."""
        response = client.get("/api/omo/99999")
        assert response.status_code == 401

    def test_confirm_unauthenticated_returns_401(self, client):
        """No token on confirm → 401."""
        response = client.post("/api/omo/99999/confirm", json={"confirmed_lesson_id": 1})
        assert response.status_code == 401

    def test_cannot_see_other_student_upload(self, client):
        """Student A cannot access Student B's upload."""
        token_a = register_and_login(client, "omo_acl_A")
        token_b = register_and_login(client, "omo_acl_B")

        post_resp = client.post(
            "/api/omo/upload",
            files=[("files", ("sheet.jpg", io.BytesIO(_TINY_JPEG), "image/jpeg"))],
            headers={"Authorization": f"Bearer {token_a}"},
        )
        upload_id = post_resp.json()["upload_id"]

        get_resp = client.get(
            f"/api/omo/{upload_id}",
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert get_resp.status_code == 404


class TestOmoUploadInputValidation:
    def test_oversized_file_returns_413(self, client):
        """File > 10MB → 413."""
        token = register_and_login(client, "omo_big1a")
        headers = {"Authorization": f"Bearer {token}"}

        big_data = b"X" * (11 * 1024 * 1024)
        response = client.post(
            "/api/omo/upload",
            files=[("files", ("big.jpg", io.BytesIO(big_data), "image/jpeg"))],
            headers=headers,
        )
        assert response.status_code == 413, f"Expected 413, got {response.status_code}: {response.text}"

    def test_no_files_returns_422(self, client):
        """No files field → 422 (FastAPI validation)."""
        token = register_and_login(client, "omo_none1a")
        headers = {"Authorization": f"Bearer {token}"}
        response = client.post("/api/omo/upload", headers=headers)
        assert response.status_code == 422

    def test_invalid_mime_returns_400(self, client):
        """Non-image MIME type → 400."""
        token = register_and_login(client, "omo_mime1a")
        headers = {"Authorization": f"Bearer {token}"}

        response = client.post(
            "/api/omo/upload",
            files=[("files", ("doc.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf"))],
            headers=headers,
        )
        assert response.status_code == 400

    def test_too_many_files_returns_400(self, client):
        """More than 5 files → 400."""
        token = register_and_login(client, "omo_many1a")
        headers = {"Authorization": f"Bearer {token}"}

        files = [("files", (f"p{i}.jpg", io.BytesIO(_TINY_JPEG), "image/jpeg")) for i in range(6)]
        response = client.post("/api/omo/upload", files=files, headers=headers)
        assert response.status_code == 400

    def test_confirm_wrong_status_returns_409(self, client):
        """Confirm while still identifying → 409."""
        token = register_and_login(client, "omo_conf409")
        headers = {"Authorization": f"Bearer {token}"}

        post_resp = client.post(
            "/api/omo/upload",
            files=[("files", ("ws.jpg", io.BytesIO(_TINY_JPEG), "image/jpeg"))],
            headers=headers,
        )
        upload_id = post_resp.json()["upload_id"]
        # Status is "identifying" — confirm should fail

        confirm_resp = client.post(
            f"/api/omo/{upload_id}/confirm",
            json={"confirmed_lesson_id": 1},
            headers=headers,
        )
        assert confirm_resp.status_code == 409, f"Expected 409, got {confirm_resp.status_code}: {confirm_resp.text}"
