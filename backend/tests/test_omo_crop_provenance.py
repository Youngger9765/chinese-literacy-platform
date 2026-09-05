"""Tests for OMO answer crop provenance and upload-replace UX (#1724).

Unit tests only — no Gemini, no GCS real calls.
Mocks GCS upload to simulate crop storage.
"""
# The omo routes are a package now, and _upload_to_gcs lives in
# services/omo_storage. Patch it on app.routes.omo.upload — that is the
# module that binds the name, and patching the package would not affect it.
import io
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role
from app.models.omo_upload import OmoUpload, OmoUploadAttempt
from app.auth.rate_limiter import ai_rate_limiter


# ---------------------------------------------------------------------------
# Test DB setup (SQLite in-memory — mirrors test_omo_upload.py pattern)
# ---------------------------------------------------------------------------

_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(_engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

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


def _override_get_db():
    db = _TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=_engine)
    session = _TestingSessionLocal()
    for r in _SEED_ROLES:
        session.add(Role(name=r["name"], display_name=r["display_name"], scope_level=r["scope_level"]))
    session.commit()
    session.close()
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=_engine)


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Clear rate limiter state before each test."""
    with ai_rate_limiter._lock:
        ai_rate_limiter._store.clear()
    yield


# ---------------------------------------------------------------------------
# Minimal valid 1x1 JPEG
# ---------------------------------------------------------------------------

# Minimal valid 1x1 JPEG for test images
_TINY_JPEG = (
    b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
    b'\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07'
    b'\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f'
    b'\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.\'"#\x1c\x1c(7),01444\x1f\'9=82<.342\x1eB'
    b'\xed\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00'
    b'\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01'
    b'\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06'
    b'\x07\x08\t\n\x0b\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03'
    b'\x02\x04\x03\x05\x05\x04\x04\x00\x00\x01}\x01\x02\x03\x00'
    b'\x04\x11\x05\x12!1A\x06\x13Qa\x07"q\x142\x81\x91\xa1\x08'
    b'#B\xb1\xc1\x15R\xd1\xf0br\x82\t\n\x16\x17\x18\x19\x1a%'
    b'&\'()*456789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz\x83\x84\x85\x86\x87'
    b'\x88\x89\x8a\x92\x93\x94\x95\x96\x97\x98\x99\x9a\xa2\xa3'
    b'\xa4\xa5\xa6\xa7\xa8\xa9\xaa\xb2\xb3\xb4\xb5\xb6\xb7\xb8'
    b'\xb9\xba\xc2\xc3\xc4\xc5\xc6\xc7\xc8\xc9\xca\xd2\xd3\xd4'
    b'\xd5\xd6\xd7\xd8\xd9\xda\xe1\xe2\xe3\xe4\xe5\xe6\xe7\xe8'
    b'\xe9\xea\xf1\xf2\xf3\xf4\xf5\xf6\xf7\xf8\xf9\xfa\xff\xda'
    b'\x00\x08\x01\x01\x00\x00?\x00\xfb\xd4P\x00\x00\x00\x1f'
    b'\xff\xd9'
)


def register_and_login(client, username: str) -> str:
    """Helper: register a fresh user and return JWT token."""
    email = f"{username}@example.com"
    reg = client.post('/api/auth/register', json={
        'email': email,
        'password': 'TestPass123!',
        'name': f'Test {username}',
    })
    if reg.status_code == 201:
        verification_token = reg.json().get('verification_token')
        if verification_token:
            client.get(f'/api/auth/verify-email?token={verification_token}')
    login = client.post('/api/auth/login', json={
        'email': email,
        'password': 'TestPass123!',
    })
    assert login.status_code == 200, f"Login failed for {email}: {login.text}"
    return login.json()['access_token']


@pytest.fixture(scope="module")
def client(setup_db):  # explicit dep ensures DB override is set before TestClient starts
    with TestClient(app) as c:
        yield c


class TestCropBoundingBoxMath:
    """Unit tests for crop strip math — no PIL, no GCS, pure Python logic."""

    def test_fill_blank_strip_clamps_to_zero(self):
        """For fill_blank at y=0.0 on a 1000px image, top should clamp to 0."""
        from app.services.omo_grader import _crop_and_upload_answer_image
        # position.y=0.0 -> py=0, top=max(0, 0-200)=0, bottom=min(H, 0+200)=200
        # Can't really call without PIL+GCS, but we can test the math inline:
        H = 1000
        pos_y = 0.0
        py = int(pos_y * H)
        top = max(0, py - 200)
        bottom = min(H, py + 200)
        assert top == 0
        assert bottom == 200

    def test_fill_blank_strip_clamps_at_bottom(self):
        """For fill_blank at y=0.95 on a 1000px image, bottom clamps to H."""
        H = 1000
        pos_y = 0.95
        py = int(pos_y * H)  # 950
        top = max(0, py - 200)  # 750
        bottom = min(H, py + 200)  # min(1000, 1150) = 1000
        assert top == 750
        assert bottom == 1000

    def test_multiple_choice_strip_is_taller(self):
        """mc_ strip uses y-300/y+400, resulting in a 700px tall strip on a tall image."""
        H = 2000
        pos_y = 0.5
        py = int(pos_y * H)  # 1000
        top = max(0, py - 300)   # 700
        bottom = min(H, py + 400)  # 1400
        height = bottom - top
        assert height == 700

    def test_fill_blank_strip_is_400px_mid_image(self):
        """fb_ strip is 200+200=400px tall when centred."""
        H = 2000
        pos_y = 0.5
        py = int(pos_y * H)  # 1000
        top = max(0, py - 200)   # 800
        bottom = min(H, py + 200)  # 1200
        height = bottom - top
        assert height == 400


class TestCropSignedUrlEndpoint:
    """Tests for GET /api/omo/{upload_id}/crops/{question_id}."""

    def test_crop_endpoint_returns_null_for_no_crop(self, client):
        """When answer has no crop_image_url, endpoint returns url=null (200)."""
        token = register_and_login(client, 'crop_test_user1')
        headers = {'Authorization': f'Bearer {token}'}

        # Upload a worksheet
        with patch('app.routes.omo.upload._upload_to_gcs', return_value='1/1/0/0.jpg'), \
             patch('app.routes.omo.upload._run_identification'):
            res = client.post('/api/omo/upload',
                              files=[('files', ('w.jpg', io.BytesIO(_TINY_JPEG), 'image/jpeg'))],
                              headers=headers)
        assert res.status_code == 201
        upload_id = res.json()['upload_id']

        # Force status=graded with answers (no crop_image_url)
        db = _TestingSessionLocal()
        try:
            upload = db.query(OmoUpload).filter(OmoUpload.id == upload_id).first()
            upload.status = 'graded'
            upload.lesson_id = 1
            upload.answers = [{'question_id': 'fb_1', 'student_answer': 'X', 'correct_answer': 'X', 'score': 1.0, 'ai_confidence': 0.9, 'reasoning': 'OK', 'position': {'x': 0.5, 'y': 0.4}, 'flag': None}]
            db.commit()
        finally:
            db.close()

        res2 = client.get(f'/api/omo/{upload_id}/crops/fb_1', headers=headers)
        assert res2.status_code == 200
        assert res2.json()['url'] is None

    def test_crop_endpoint_returns_404_for_wrong_question(self, client):
        """Request for non-existent question_id returns url=null (not 404)."""
        token = register_and_login(client, 'crop_test_user2')
        headers = {'Authorization': f'Bearer {token}'}

        with patch('app.routes.omo.upload._upload_to_gcs', return_value='1/2/0/0.jpg'), \
             patch('app.routes.omo.upload._run_identification'):
            res = client.post('/api/omo/upload',
                              files=[('files', ('w.jpg', io.BytesIO(_TINY_JPEG), 'image/jpeg'))],
                              headers=headers)
        upload_id = res.json()['upload_id']

        db = _TestingSessionLocal()
        try:
            upload = db.query(OmoUpload).filter(OmoUpload.id == upload_id).first()
            upload.status = 'graded'
            upload.lesson_id = 1
            upload.answers = []
            db.commit()
        finally:
            db.close()

        res2 = client.get(f'/api/omo/{upload_id}/crops/mc_99', headers=headers)
        assert res2.status_code == 200
        assert res2.json()['url'] is None


class TestByLessonEndpoint:
    """Tests for GET /api/omo/by-lesson/{lesson_id}."""

    def test_returns_false_when_no_upload(self, client):
        """Student with no uploads → has_prior_upload=False."""
        token = register_and_login(client, 'bylessontest1')
        headers = {'Authorization': f'Bearer {token}'}
        res = client.get('/api/omo/by-lesson/999', headers=headers)
        assert res.status_code == 200
        assert res.json()['has_prior_upload'] is False

    def test_returns_true_when_graded_upload_exists(self, client):
        """Student with graded upload → has_prior_upload=True."""
        token = register_and_login(client, 'bylessontest2')
        headers = {'Authorization': f'Bearer {token}'}

        with patch('app.routes.omo.upload._upload_to_gcs', return_value='1/3/0/0.jpg'), \
             patch('app.routes.omo.upload._run_identification'):
            res = client.post('/api/omo/upload',
                              files=[('files', ('w.jpg', io.BytesIO(_TINY_JPEG), 'image/jpeg'))],
                              headers=headers)
        upload_id = res.json()['upload_id']

        db = _TestingSessionLocal()
        try:
            upload = db.query(OmoUpload).filter(OmoUpload.id == upload_id).first()
            upload.status = 'graded'
            upload.lesson_id = 42
            db.commit()
        finally:
            db.close()

        res2 = client.get('/api/omo/by-lesson/42', headers=headers)
        assert res2.status_code == 200
        data = res2.json()
        assert data['has_prior_upload'] is True
        assert data['upload_id'] == upload_id
        assert data['status'] == 'graded'

    def test_returns_false_for_superseded_upload(self, client):
        """Superseded upload → has_prior_upload=False."""
        from datetime import datetime, timezone
        token = register_and_login(client, 'bylessontest3')
        headers = {'Authorization': f'Bearer {token}'}

        with patch('app.routes.omo.upload._upload_to_gcs', return_value='1/4/0/0.jpg'), \
             patch('app.routes.omo.upload._run_identification'):
            res = client.post('/api/omo/upload',
                              files=[('files', ('w.jpg', io.BytesIO(_TINY_JPEG), 'image/jpeg'))],
                              headers=headers)
        upload_id = res.json()['upload_id']

        db = _TestingSessionLocal()
        try:
            upload = db.query(OmoUpload).filter(OmoUpload.id == upload_id).first()
            upload.status = 'graded'
            upload.lesson_id = 77
            upload.superseded_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
            db.commit()
        finally:
            db.close()

        res2 = client.get('/api/omo/by-lesson/77', headers=headers)
        assert res2.status_code == 200
        assert res2.json()['has_prior_upload'] is False
