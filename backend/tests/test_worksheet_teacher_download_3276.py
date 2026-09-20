"""Tests for GET /api/lessons/{lesson_uid}/worksheet/{version} (#3276).

Role-gated worksheet download: any authenticated user can fetch the student
edition; only teacher-tier roles (teacher/director/principal/org_admin/
org_owner/system_admin/homeroom_teacher) can fetch the teacher edition.

TDD: written before app/routes/worksheets.py exists. Red -> Green -> Refactor.

Security-sensitive (auth/route diff) — every positive assertion here is paired
with a negative control at the SAME resource, per rules/testing-strategy.md:
"權限測試的特別陷阱... 一律用最低權限角色寫，並配一條正向對照". The lowest
privilege used here is a bare "student" role; "parent" is added as a second,
even-more-obviously-non-teacher role to prove this is an allow-list (secure
default) and not a "just exclude the word student" special case.
"""
import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.models import Base
from app.database import get_db
from app.models.user import User, Role, UserRole
from app.auth.password import hash_password
from app.auth.jwt import create_access_token
from app.services import worksheet_registry


SQLALCHEMY_TEST_DATABASE_URL = "sqlite:///:memory:"

_ROLE_NAMES = [
    "system_admin", "org_owner", "org_admin", "principal",
    "director", "teacher", "homeroom_teacher", "student", "parent",
]


@pytest.fixture(scope="module")
def db_engine():
    engine = create_engine(SQLALCHEMY_TEST_DATABASE_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def db_session(db_engine):
    SessionLocal = sessionmaker(bind=db_engine)
    session = SessionLocal()
    for name in _ROLE_NAMES:
        session.add(Role(name=name, display_name=name, scope_level="platform"))
    session.commit()
    yield session
    session.close()


def _make_token(db_session, email: str, role_name: str) -> str:
    role = db_session.query(Role).filter_by(name=role_name).first()
    user = User(email=email, password_hash=hash_password("x"), name=role_name, is_active=True)
    db_session.add(user)
    db_session.flush()
    db_session.add(UserRole(user_id=user.id, role_id=role.id, scope_type="platform", is_active=True))
    db_session.commit()
    return create_access_token(user.id)


@pytest.fixture(scope="module")
def student_token(db_session):
    return _make_token(db_session, "worksheet_student@test.com", "student")


@pytest.fixture(scope="module")
def parent_token(db_session):
    return _make_token(db_session, "worksheet_parent@test.com", "parent")


@pytest.fixture(scope="module")
def teacher_token(db_session):
    return _make_token(db_session, "worksheet_teacher@test.com", "teacher")


@pytest.fixture(scope="module")
def admin_token(db_session):
    return _make_token(db_session, "worksheet_admin@test.com", "system_admin")


@pytest.fixture(scope="module")
def client(db_session):
    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def fake_mapping(tmp_path, monkeypatch):
    """Point the registry at a throwaway mapping with one fully-uploaded lesson
    (L9001) and one lesson whose files exist in Drive but haven't been
    uploaded yet (L9002, gcs_uploaded=False for both versions) — that second
    fixture is the #2845 dead-button regression check."""
    mapping = {
        "lessons": {
            "L9001": {
                "catalog_slot": "TEST-L1",
                "teacher": {"gcs_path": "worksheets-gated/L9001-teacher.docx", "gcs_uploaded": True},
                "student": {"gcs_path": "worksheets-gated/L9001-student.docx", "gcs_uploaded": True},
            },
            "L9002": {
                "catalog_slot": "TEST-L2",
                "teacher": {"gcs_path": "worksheets-gated/L9002-teacher.docx", "gcs_uploaded": False},
                "student": {"gcs_path": "worksheets-gated/L9002-student.docx", "gcs_uploaded": False},
            },
        }
    }
    p = tmp_path / "gcs_mapping.json"
    p.write_text(json.dumps(mapping), encoding="utf-8")
    monkeypatch.setattr(worksheet_registry, "_MAPPING_PATH", p)
    worksheet_registry._clear_cache_for_tests()
    yield
    worksheet_registry._clear_cache_for_tests()


def _mock_bucket(content: bytes):
    blob = MagicMock()
    blob.download_as_bytes.return_value = content
    bucket = MagicMock()
    bucket.blob.return_value = blob
    return bucket


class TestStudentEdition:
    @patch("app.routes.worksheets._get_bucket")
    def test_any_authenticated_role_can_download_student_edition(self, mock_get_bucket, client, student_token, fake_mapping):
        mock_get_bucket.return_value = _mock_bucket(b"PKstudentdocxbytes")

        resp = client.get("/api/lessons/L9001/worksheet/student", headers=auth(student_token))

        assert resp.status_code == 200
        assert resp.content == b"PKstudentdocxbytes"
        assert resp.headers["content-type"] == (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )

    @patch("app.routes.worksheets._get_bucket")
    def test_teacher_role_can_also_download_student_edition(self, mock_get_bucket, client, teacher_token, fake_mapping):
        mock_get_bucket.return_value = _mock_bucket(b"studentbytes")

        resp = client.get("/api/lessons/L9001/worksheet/student", headers=auth(teacher_token))

        assert resp.status_code == 200

    def test_unauthenticated_request_is_401_not_200(self, client, fake_mapping):
        resp = client.get("/api/lessons/L9001/worksheet/student")
        assert resp.status_code == 401


class TestTeacherEditionRoleGate:
    """Every case here has a paired positive control in the class below or above —
    a 403 here only means something if the same resource returns 200 for a
    teacher-tier token (see TestTeacherCanDownloadTeacherEdition)."""

    @patch("app.routes.worksheets._get_bucket")
    def test_student_role_gets_403_for_teacher_edition(self, mock_get_bucket, client, student_token, fake_mapping):
        mock_get_bucket.return_value = _mock_bucket(b"should-never-be-read")

        resp = client.get("/api/lessons/L9001/worksheet/teacher", headers=auth(student_token))

        assert resp.status_code == 403
        # negative control means nothing if the handler read the file before denying
        mock_get_bucket.assert_not_called()

    @patch("app.routes.worksheets._get_bucket")
    def test_parent_role_gets_403_for_teacher_edition(self, mock_get_bucket, client, parent_token, fake_mapping):
        """Second, unambiguously-non-teacher role — proves this is an allow-list
        of teacher-tier roles, not a block-list that only excludes 'student'."""
        mock_get_bucket.return_value = _mock_bucket(b"should-never-be-read")

        resp = client.get("/api/lessons/L9001/worksheet/teacher", headers=auth(parent_token))

        assert resp.status_code == 403

    def test_unauthenticated_request_is_401_not_200(self, client, fake_mapping):
        resp = client.get("/api/lessons/L9001/worksheet/teacher")
        assert resp.status_code == 401


class TestTeacherCanDownloadTeacherEdition:
    """Positive control for the 403s above — proves the gate isn't just denying everyone."""

    @patch("app.routes.worksheets._get_bucket")
    def test_teacher_role_can_download_teacher_edition(self, mock_get_bucket, client, teacher_token, fake_mapping):
        mock_get_bucket.return_value = _mock_bucket(b"teacherbytes")

        resp = client.get("/api/lessons/L9001/worksheet/teacher", headers=auth(teacher_token))

        assert resp.status_code == 200
        assert resp.content == b"teacherbytes"

    @patch("app.routes.worksheets._get_bucket")
    def test_system_admin_can_download_teacher_edition(self, mock_get_bucket, client, admin_token, fake_mapping):
        mock_get_bucket.return_value = _mock_bucket(b"teacherbytes")

        resp = client.get("/api/lessons/L9001/worksheet/teacher", headers=auth(admin_token))

        assert resp.status_code == 200


class TestCachingHeaders:
    @patch("app.routes.worksheets._get_bucket")
    def test_response_is_not_publicly_cacheable(self, mock_get_bucket, client, teacher_token, fake_mapping):
        """Must NOT inherit assets.py's `public, max-age=31536000, immutable` —
        that would let a CDN edge serve a cached authenticated response to a
        later unauthenticated/wrong-role requester hitting the same URL."""
        mock_get_bucket.return_value = _mock_bucket(b"data")

        resp = client.get("/api/lessons/L9001/worksheet/teacher", headers=auth(teacher_token))

        cache_control = resp.headers.get("cache-control", "")
        assert "public" not in cache_control
        assert "private" in cache_control or "no-store" in cache_control


class TestNotYetUploaded:
    """#2845 regression shape: a lesson can be IN the mapping (we know Drive has
    the file) without being uploaded to GCS yet. Must 404, not attempt a GCS
    read that 404s from GCS instead (both end in 404 to the client, but this
    proves the route checks `gcs_uploaded` itself rather than always trying)."""

    @patch("app.routes.worksheets._get_bucket")
    def test_mapped_but_not_uploaded_lesson_returns_404_without_touching_gcs(self, mock_get_bucket, client, teacher_token, fake_mapping):
        resp = client.get("/api/lessons/L9002/worksheet/teacher", headers=auth(teacher_token))

        assert resp.status_code == 404
        mock_get_bucket.assert_not_called()

    def test_unknown_lesson_uid_returns_404(self, client, teacher_token, fake_mapping):
        resp = client.get("/api/lessons/L0000/worksheet/student", headers=auth(teacher_token))
        assert resp.status_code == 404

    def test_invalid_version_segment_is_rejected(self, client, teacher_token, fake_mapping):
        resp = client.get("/api/lessons/L9001/worksheet/bogus", headers=auth(teacher_token))
        assert resp.status_code in (404, 422)


class TestGcsMissRaisesA404NotA500:
    @patch("app.routes.worksheets._get_bucket")
    def test_gcs_not_found_is_translated_to_404(self, mock_get_bucket, client, teacher_token, fake_mapping):
        bucket = MagicMock()
        bucket.blob.return_value.download_as_bytes.side_effect = Exception("simulated NotFound")
        mock_get_bucket.return_value = bucket

        resp = client.get("/api/lessons/L9001/worksheet/teacher", headers=auth(teacher_token))

        assert resp.status_code == 404
