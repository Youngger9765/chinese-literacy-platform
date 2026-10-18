"""Story Structure Lab is system_admin-only — both the index and the per-lesson detail.

The guard is router-level (`dependencies=[require_role("system_admin")]`), so it is easy
to believe the detail route only checks login. These tests run the real route with the
lowest roles that can log in (teacher, student) and a positive control (system_admin).
"""

import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.user import Role, User, UserRole

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def make_client():
    Base.metadata.create_all(bind=engine)
    db = Session()
    roles = {n: Role(name=n, display_name=n, scope_level="platform") for n in ("system_admin", "teacher", "student")}
    db.add_all(roles.values())
    db.commit()

    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    def build(role_name: str) -> TestClient:
        u = User(email=f"{uuid.uuid4().hex}@example.com", password_hash="x", name=role_name)
        db.add(u)
        db.commit()
        db.add(UserRole(user_id=u.id, role_id=roles[role_name].id, scope_type="platform", is_active=True))
        db.commit()
        db.refresh(u)
        app.dependency_overrides[get_db] = _get_db
        app.dependency_overrides[get_current_user] = lambda: u
        return TestClient(app)

    yield build
    app.dependency_overrides.clear()
    db.close()
    Base.metadata.drop_all(bind=engine)


@pytest.mark.parametrize("role", ["teacher", "student"])
@pytest.mark.parametrize("path", ["/api/admin/story-structure-lab", "/api/admin/story-structure-lab/20011"])
def test_non_admin_is_forbidden(make_client, role, path):
    assert make_client(role).get(path).status_code == 403


def test_system_admin_reaches_the_detail_route(make_client):
    # Positive control: the 403s above must come from the role check, not from a
    # route that never resolves. Admin gets past the guard (200 or 404 for the id).
    assert make_client("system_admin").get("/api/admin/story-structure-lab/20011").status_code in (200, 404)
