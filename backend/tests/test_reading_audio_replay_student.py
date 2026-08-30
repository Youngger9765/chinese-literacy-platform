"""Tests for student reading audio replay endpoint (Issue #2266 PR1).

Coverage:
1. Happy path: student gets signed URL for their own attempt
2. 403 when a different student tries to access
3. 404 when session_id not found
4. 404 when attempt_id not found
5. 404 when audio_gcs_path is None (audio not yet uploaded)
6. 503 when generate_audio_signed_url returns None (GCS failure)
7. Transcribe with session_id writes audio_gcs_path to DB (PR1 binding test)

KEY RULE: generate_audio_signed_url must be patched at the ROUTE MODULE import site:
    "app.routes.learning.learning_audio_replay.generate_audio_signed_url"
NOT at the service module (too late — route already holds the reference).

Run:
    cd backend
    python -m pytest tests/test_reading_audio_replay_student.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import MagicMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.session import LearningSession, ReadingAttemptHistory


# ─────────────────────────────────────────────────────────────────────────────
# In-memory SQLite DB (no FK enforcement so we can skip User scaffolding)
# Each test gets a BRAND NEW in-memory DB so there are no unique-constraint
# collisions between tests.
# ─────────────────────────────────────────────────────────────────────────────


def _make_db():
    """Create a fresh SQLite in-memory engine + session and initialise tables."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return Session()


@pytest.fixture
def db():
    """Fresh in-memory DB per test — avoids unique-constraint collisions."""
    session = _make_db()
    yield session
    session.close()


# ─────────────────────────────────────────────────────────────────────────────
# Helpers to seed data
# ─────────────────────────────────────────────────────────────────────────────

_STUDENT_ID = 42
_OTHER_STUDENT_ID = 99


def _create_session(db, student_id: int = _STUDENT_ID) -> LearningSession:
    sess = LearningSession(
        student_id=student_id,
        story_slug="test-replay-story",
        status="in_progress",
        current_step=1,
        reading_result=None,
        # full_reading_attempts has server_default '[]'::jsonb which SQLite can't
        # apply; supply it explicitly so conftest JSON patch works correctly.
        full_reading_attempts=[],
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return sess


def _create_attempt(
    db,
    session_id: int,
    audio_gcs_path: str | None = "reading-audio/attempts/1.webm",
) -> ReadingAttemptHistory:
    attempt = ReadingAttemptHistory(
        session_id=session_id,
        attempt_no=1,
        reading_result={"score": 85},
        audio_gcs_path=audio_gcs_path,
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return attempt


# ─────────────────────────────────────────────────────────────────────────────
# App builder
# ─────────────────────────────────────────────────────────────────────────────

def _build_app(db_session, current_user_id: int = _STUDENT_ID) -> FastAPI:
    """Minimal FastAPI app with the audio replay router; DB + auth mocked."""
    from app.routes.learning.learning_audio_replay import router
    from app.auth.dependencies import get_current_user
    from app.database import get_db

    app = FastAPI()

    def _mock_user():
        user = MagicMock()
        user.id = current_user_id
        return user

    def _override_db():
        yield db_session

    app.dependency_overrides[get_current_user] = _mock_user
    app.dependency_overrides[get_db] = _override_db
    app.include_router(router, prefix="/api")
    return app


# ─────────────────────────────────────────────────────────────────────────────
# Tests: GET /api/learning/sessions/{session_id}/reading-audio/{attempt_id}
# ─────────────────────────────────────────────────────────────────────────────


class TestStudentAudioReplaySignedUrl:

    def test_happy_path_returns_signed_url(self, db):
        """Student gets signed URL for their own attempt."""
        learning_sess = _create_session(db, student_id=_STUDENT_ID)
        attempt = _create_attempt(db, session_id=learning_sess.id, audio_gcs_path="reading-audio/attempts/10.webm")

        app = _build_app(db, current_user_id=_STUDENT_ID)
        client = TestClient(app)

        with patch(
            "app.routes.learning.learning_audio_replay.generate_audio_signed_url",
            return_value="https://storage.googleapis.com/fake-signed-url?token=abc",
        ) as mock_sign:
            resp = client.get(
                f"/api/learning/sessions/{learning_sess.id}/reading-audio/{attempt.id}"
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["signed_url"] == "https://storage.googleapis.com/fake-signed-url?token=abc"
        assert body["expires_in"] == 600

        # Verify correct blob_path was passed
        mock_sign.assert_called_once_with(
            blob_path="reading-audio/attempts/10.webm",
            expiration_seconds=600,
        )

    def test_403_when_different_student_accesses_session(self, db):
        """Another student cannot access a session they don't own."""
        learning_sess = _create_session(db, student_id=_STUDENT_ID)
        attempt = _create_attempt(db, session_id=learning_sess.id)

        # Log in as a DIFFERENT student
        app = _build_app(db, current_user_id=_OTHER_STUDENT_ID)
        client = TestClient(app)

        with patch(
            "app.routes.learning.learning_audio_replay.generate_audio_signed_url",
            return_value="https://should-not-reach",
        ):
            resp = client.get(
                f"/api/learning/sessions/{learning_sess.id}/reading-audio/{attempt.id}"
            )

        assert resp.status_code == 403
        assert "Not your session" in resp.json()["detail"]

    def test_404_when_session_not_found(self, db):
        """Non-existent session_id returns 404."""
        app = _build_app(db, current_user_id=_STUDENT_ID)
        client = TestClient(app)

        with patch(
            "app.routes.learning.learning_audio_replay.generate_audio_signed_url",
        ):
            resp = client.get("/api/learning/sessions/999999/reading-audio/1")

        assert resp.status_code == 404
        assert "Session not found" in resp.json()["detail"]

    def test_404_when_attempt_not_found(self, db):
        """Attempt_id that does not exist (or belongs to another session) returns 404."""
        learning_sess = _create_session(db, student_id=_STUDENT_ID)
        # No attempt row created

        app = _build_app(db, current_user_id=_STUDENT_ID)
        client = TestClient(app)

        with patch(
            "app.routes.learning.learning_audio_replay.generate_audio_signed_url",
        ):
            resp = client.get(
                f"/api/learning/sessions/{learning_sess.id}/reading-audio/888888"
            )

        assert resp.status_code == 404
        assert "Attempt not found" in resp.json()["detail"]

    def test_404_when_audio_gcs_path_is_none(self, db):
        """Attempt exists but audio was never uploaded → 404, not 503."""
        learning_sess = _create_session(db, student_id=_STUDENT_ID)
        attempt = _create_attempt(db, session_id=learning_sess.id, audio_gcs_path=None)

        app = _build_app(db, current_user_id=_STUDENT_ID)
        client = TestClient(app)

        with patch(
            "app.routes.learning.learning_audio_replay.generate_audio_signed_url",
        ) as mock_sign:
            resp = client.get(
                f"/api/learning/sessions/{learning_sess.id}/reading-audio/{attempt.id}"
            )

        assert resp.status_code == 404
        assert "No audio recorded" in resp.json()["detail"]
        # GCS should NOT be called when path is None
        mock_sign.assert_not_called()

    def test_503_when_signed_url_generation_fails(self, db):
        """GCS signed URL failure → 503, not 500."""
        learning_sess = _create_session(db, student_id=_STUDENT_ID)
        attempt = _create_attempt(
            db, session_id=learning_sess.id, audio_gcs_path="reading-audio/attempts/99.webm"
        )

        app = _build_app(db, current_user_id=_STUDENT_ID)
        client = TestClient(app)

        with patch(
            "app.routes.learning.learning_audio_replay.generate_audio_signed_url",
            return_value=None,  # Simulate GCS failure
        ):
            resp = client.get(
                f"/api/learning/sessions/{learning_sess.id}/reading-audio/{attempt.id}"
            )

        assert resp.status_code == 503
        assert "unavailable" in resp.json()["detail"].lower()

    def test_attempt_cross_session_isolation(self, db):
        """attempt_id from a different session is treated as not found (not just any attempt)."""
        sess_a = _create_session(db, student_id=_STUDENT_ID)
        # Use a different story slug to avoid the unique(student_id, story_slug) constraint
        sess_b = LearningSession(
            student_id=_STUDENT_ID,
            story_slug="test-replay-story-b",
            status="in_progress",
            current_step=1,
            reading_result=None,
            full_reading_attempts=[],
        )
        db.add(sess_b)
        db.commit()
        db.refresh(sess_b)
        # Create attempt for session B
        attempt_b = _create_attempt(
            db, session_id=sess_b.id, audio_gcs_path="reading-audio/attempts/200.webm"
        )

        app = _build_app(db, current_user_id=_STUDENT_ID)
        client = TestClient(app)

        # Try to access sess_B's attempt through sess_A's URL
        with patch(
            "app.routes.learning.learning_audio_replay.generate_audio_signed_url",
        ):
            resp = client.get(
                f"/api/learning/sessions/{sess_a.id}/reading-audio/{attempt_b.id}"
            )

        assert resp.status_code == 404
        assert "Attempt not found" in resp.json()["detail"]


# ─────────────────────────────────────────────────────────────────────────────
# Tests: transcribe endpoint writes audio_gcs_path (PR1 binding)
# ─────────────────────────────────────────────────────────────────────────────


def _build_save_audio_app(db_session, current_user_id: int = _STUDENT_ID) -> FastAPI:
    """Minimal app for POST /reading/save-audio —— 上傳現在住這裡。

    ⚠️ 上傳在某次重構從「轉寫時順便做（BackgroundTasks）」改成
       「學生按下接受分數之後，前端明確呼叫 POST /reading/save-audio」。
       原本這裡的兩條測試還在 patch `learning_reading.upload_reading_audio_to_gcs_sync`，
       而那個模組沒有這個名字 → AttributeError，兩條都是紅的，
       **其中一條是 IDOR 安全斷言，等於從來沒有執行過**。
       而這支檔案不在 CI 具名清單裡，所以沒有人看到。
    """
    from app.routes.learning.learning_save_audio import router
    from app.auth.dependencies import get_current_user
    from app.auth.rate_limiter import ai_limit_10_per_min
    from app.database import get_db

    app = FastAPI()

    def _mock_user():
        user = MagicMock()
        user.id = current_user_id
        return user

    def _override_db():
        yield db_session

    app.dependency_overrides[get_current_user] = _mock_user
    app.dependency_overrides[ai_limit_10_per_min] = lambda: None
    app.dependency_overrides[get_db] = _override_db
    app.include_router(router, prefix="/api")
    return app


def _build_transcribe_app(db_session, current_user_id: int = _STUDENT_ID) -> FastAPI:
    """Minimal app for /reading/transcribe with all heavy deps mocked."""
    from app.routes.learning.learning_reading import router
    from app.auth.dependencies import get_current_user
    from app.auth.rate_limiter import ai_limit_10_per_min
    from app.database import get_db

    app = FastAPI()

    def _mock_user():
        user = MagicMock()
        user.id = current_user_id
        return user

    def _override_db():
        yield db_session

    app.dependency_overrides[get_current_user] = _mock_user
    app.dependency_overrides[ai_limit_10_per_min] = lambda: None
    app.dependency_overrides[get_db] = _override_db
    app.include_router(router, prefix="/api")
    return app


class TestTranscribeWithSessionIdPersistsPath:

    def test_save_audio_persists_the_path_on_the_attempt(self, db):
        """活的那條路：POST /reading/save-audio 上傳成功後把路徑寫回 attempt。"""
        learning_sess = _create_session(db, student_id=_STUDENT_ID)
        attempt = _create_attempt(db, session_id=learning_sess.id, audio_gcs_path=None)
        assert attempt.audio_gcs_path is None, "前置不成立：這筆一開始就有路徑了"

        expected_path = f"reading-audio/attempts/{attempt.id}.webm"
        app = _build_save_audio_app(db, current_user_id=_STUDENT_ID)
        client = TestClient(app)

        with patch(
            "app.routes.learning.learning_save_audio.upload_reading_audio_to_gcs_sync",
            return_value=expected_path,
        ) as mock_sync:
            resp = client.post(
                "/api/reading/save-audio",
                data={"session_id": str(learning_sess.id)},
                files={"audio": ("take.webm", b"fake-audio-bytes", "audio/webm")},
            )

        assert resp.status_code == 200, resp.text
        assert resp.json().get("ok") is True, resp.text
        assert mock_sync.called, "上傳根本沒被呼叫 —— 錄音不會落地"
        db.refresh(attempt)
        assert attempt.audio_gcs_path == expected_path, (
            f"路徑沒寫回 attempt（老師端回放靠它找檔）：{attempt.audio_gcs_path!r}"
        )

    def test_save_audio_rejects_another_users_session(self, db):
        """IDOR。⚠️ 這條在 2026-08-29 之前**從來沒有執行過** ——
        它 patch 的模組沒有那個名字，setup 就 AttributeError 了，
        而這支檔案不在 CI 清單裡，所以那個紅沒有人看到。"""
        other_sess = _create_session(db, student_id=_OTHER_STUDENT_ID)
        _create_attempt(db, session_id=other_sess.id, audio_gcs_path=None)

        app = _build_save_audio_app(db, current_user_id=_STUDENT_ID)  # 不是 owner
        client = TestClient(app)

        with patch(
            "app.routes.learning.learning_save_audio.upload_reading_audio_to_gcs_sync",
            return_value="reading-audio/attempts/999.webm",
        ) as mock_sync:
            resp = client.post(
                "/api/reading/save-audio",
                data={"session_id": str(other_sess.id)},
                files={"audio": ("take.webm", b"fake-audio-bytes", "audio/webm")},
            )

        assert not mock_sync.called, (
            "別人的 session 也上傳了 —— 這是 IDOR：任何人都能往別人的 attempt 塞音檔"
        )
        assert resp.status_code in (403, 404) or resp.json().get("ok") is False, (
            f"越權沒被擋：{resp.status_code} {resp.text}"
        )
