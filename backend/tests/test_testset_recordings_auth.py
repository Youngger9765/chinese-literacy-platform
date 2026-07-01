"""Auth regression lock for GET /api/testset/recordings (#2437).

recordings was re-gated from public to require_role("system_admin", "org_admin")
(Young chose the tightest bar — testset recordings are platform-level data +
signed playback URLs = privacy sensitive). This locks the three access states:
  - no auth             -> 401
  - logged-in non-admin -> 403
  - system_admin        -> 200 (GCS mocked)

Run: cd backend && python -m pytest tests/test_testset_recordings_auth.py -v
"""
from __future__ import annotations

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
    """A transient (never session-bound) User — safe to return from the
    get_current_user override without triggering a detached-instance refresh.
    require_role only reads .id, then queries UserRole by that id."""
    return User(id=uid, username=uname, name=uname, email=f"{uname}@x.com", password_hash="x")


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    for rd in [
        {"name": "student", "display_name": "Student", "scope_level": "school"},
        {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
        {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    ]:
        if not db.query(Role).filter(Role.name == rd["name"]).first():
            db.add(Role(**rd))
    db.commit()
    # persist user rows (FK target for UserRole)
    db.add_all([_fresh_user(1, "admin_u"), _fresh_user(2, "pleb_u")])
    db.commit()
    sa = db.query(Role).filter(Role.name == "system_admin").first()
    st = db.query(Role).filter(Role.name == "student").first()
    db.add(UserRole(user_id=1, role_id=sa.id, scope_type="platform", scope_id=None))
    db.add(UserRole(user_id=2, role_id=st.id, scope_type="school", scope_id="1"))
    db.commit()
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def _wire_db():
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.clear()


def _bucket():
    b = MagicMock()
    b.list_blobs.return_value = iter([])
    return b


def test_no_auth_returns_401():
    """No token → require_role's get_current_user raises 401."""
    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/api/testset/recordings?lesson_id=1&version=correct")
    assert r.status_code == 401, r.text


def test_non_admin_returns_403():
    """Logged-in student (no admin role) → 403."""
    app.dependency_overrides[get_current_user] = lambda: _fresh_user(2, "pleb_u")
    try:
        with TestClient(app, raise_server_exceptions=False) as c:
            r = c.get("/api/testset/recordings?lesson_id=1&version=correct")
        assert r.status_code == 403, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_system_admin_returns_200():
    """system_admin → 200 (GCS mocked)."""
    app.dependency_overrides[get_current_user] = lambda: _fresh_user(1, "admin_u")
    try:
        with patch("app.routes.testset._get_gcs_bucket", return_value=_bucket()):
            with TestClient(app, raise_server_exceptions=False) as c:
                r = c.get("/api/testset/recordings?lesson_id=1&version=correct")
        assert r.status_code == 200, r.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)
