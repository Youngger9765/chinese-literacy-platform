"""Regression lock for testset owner list truncation (#2524).

`GET /api/testset/recordings` had a hard-coded `_LIST_CAP = 500` passed to
`list_blobs(max_results=...)`. GCS returns objects in lexicographic name order,
so once `test-dataset/` held >500 blobs (each recording = 2~3 blobs), contributors
whose name sorted late (high-codepoint CJK like 陳/睿) were silently dropped from
the owner dashboard even though the audio was still in GCS.

These tests lock the fix:
  1. `_LIST_CAP` is a practically-unlimited value (won't truncate real data).
  2. the endpoint passes that high cap to `list_blobs` (no low ceiling sneaks back).
  3. the endpoint returns ALL metas the bucket yields — no app-side `[:500]` slice.

Run: cd backend && python -m pytest tests/test_testset_list_cap.py -v
"""
from __future__ import annotations

import json
import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, User, UserRole
from app.auth.dependencies import get_current_user
from app.routes import testset

engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)


@event.listens_for(engine, "connect")
def _pragma(conn, _):
    cur = conn.cursor(); cur.execute("PRAGMA foreign_keys=ON"); cur.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _fresh_user(uid: int, uname: str) -> User:
    return User(id=uid, username=uname, name=uname, email=f"{uname}@x.com", password_hash="x")


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    for rd in [
        {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    ]:
        if not db.query(Role).filter(Role.name == rd["name"]).first():
            db.add(Role(**rd))
    db.commit()
    db.add(_fresh_user(1, "admin_u"))
    db.commit()
    sa = db.query(Role).filter(Role.name == "system_admin").first()
    db.add(UserRole(user_id=1, role_id=sa.id, scope_type="platform", scope_id=None))
    db.commit()
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def _wire_db():
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = lambda: _fresh_user(1, "admin_u")
    yield
    app.dependency_overrides.clear()


class _FakeBlob:
    """Minimal blob stub exposing the two attrs testset list touches."""

    def __init__(self, name: str, text: str):
        self.name = name
        self._text = text

    def download_as_text(self) -> str:
        return self._text


def _meta_blob(i: int) -> _FakeBlob:
    """One .json meta blob for recording #i (lexical order == numeric order here)."""
    path = f"test-dataset/contrib_{i:04d}/1/correct-{i:04d}.json"
    audio_path = f"test-dataset/contrib_{i:04d}/1/correct-{i:04d}.webm"
    meta = {
        "contributor_name": f"contrib_{i:04d}",
        "lesson_id": "1",
        "version": "correct",
        "audio_path": audio_path,
        "created_at": f"2026-07-13T00:00:{i % 60:02d}Z",
    }
    return _FakeBlob(path, json.dumps(meta, ensure_ascii=False))


def _bucket_with(n: int) -> MagicMock:
    """Bucket whose list_blobs yields n meta blobs, ignoring max_results (like GCS
    would once the cap is above the object count)."""
    b = MagicMock()
    b.list_blobs.return_value = iter([_meta_blob(i) for i in range(n)])
    return b


def test_list_cap_is_practically_unlimited():
    """The cap must be high enough that real datasets never truncate (#2524)."""
    assert testset._LIST_CAP >= 100_000


def test_recordings_returns_all_beyond_old_500_cap():
    """600 recordings (> old 500 cap) must ALL come back — no truncation, no slice."""
    N = 600
    bucket = _bucket_with(N)
    with patch("app.routes.testset._get_gcs_bucket", return_value=bucket), patch(
        "app.routes.testset.generate_audio_signed_url", return_value="http://signed"
    ):
        with TestClient(app, raise_server_exceptions=False) as c:
            r = c.get("/api/testset/recordings")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["count"] == N, f"expected all {N} recordings, got {body['count']}"
    # And the high cap was actually handed to GCS (locks the fix, not just the constant)
    _, kwargs = bucket.list_blobs.call_args
    assert kwargs.get("max_results", 0) >= 100_000
