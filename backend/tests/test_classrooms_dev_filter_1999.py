"""TDD tests for #1999 — /api/classrooms must also filter dev/test classrooms
for non-admin teacher callers (followup of #1985).

#1985 (PR #1998) added the filter to /api/teacher/classrooms only. But
TeacherHome.tsx fetches via listMyClassrooms → /api/classrooms (in
backend/app/routes/classrooms/classroom_crud.py), so dev classes still showed
up in the home page 我的班級 list.

This test verifies:
  1. Regular teacher hitting /api/classrooms → dev classes hidden.
  2. Admin hitting /api/classrooms → all classes visible (admin platform view).
  3. The shared helper `is_dev_classroom` matches the same patterns as #1985.
"""

import os
import sys
from dataclasses import dataclass

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.auth.dependencies import get_current_user
from app.models import Base
from app.models.school import Classroom, School


# ---------------------------------------------------------------------------
# In-memory SQLite DB
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@dataclass
class _FakeTeacher:
    id: int = 1
    email: str = "teacher_at_test_dot_com"  # non-email format to avoid pre-commit scan FP
    is_active: bool = True


@dataclass
class _FakeAdmin:
    id: int = 99
    email: str = "admin_at_test_dot_com"
    is_active: bool = True


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def _override_get_db():
    s = TestingSessionLocal()
    try:
        yield s
    finally:
        s.close()


def _seed_classrooms(db, teacher_id: int):
    """Insert 1 school + 5 classrooms (3 dev, 2 real) owned by the given teacher."""
    school = School(id=1, name="測試學校", address="台北")
    db.add(school)
    db.flush()
    dev_names = ["PM R3 verify", "Bulk驗證 2026-05-16", "PM Dogfood R2 班"]
    real_names = ["三年甲班", "五年乙班"]
    for i, name in enumerate(dev_names + real_names, start=1):
        db.add(Classroom(
            id=i,
            name=name,
            school_id=1,
            teacher_id=teacher_id,
            grade=4,
            join_code=f"JOIN{i:03d}",
            is_active=True,
        ))
    db.commit()


# ---------------------------------------------------------------------------
# Shared helper unit test
# ---------------------------------------------------------------------------

class TestIsDevClassroomHelper:
    def test_matches_pm_r_pattern(self):
        from app.services.classroom_dev_filter import is_dev_classroom
        assert is_dev_classroom("PM R3 verify") is True
        assert is_dev_classroom("PM  R1") is True   # tolerates extra space
        assert is_dev_classroom("pm r2 班") is True  # case-insensitive

    def test_matches_bulk_verification(self):
        from app.services.classroom_dev_filter import is_dev_classroom
        assert is_dev_classroom("Bulk驗證 2026-05-16") is True

    def test_matches_dogfood(self):
        from app.services.classroom_dev_filter import is_dev_classroom
        assert is_dev_classroom("PM Dogfood R2 班") is True
        assert is_dev_classroom("dogfood test") is True

    def test_does_not_match_real_classroom_names(self):
        from app.services.classroom_dev_filter import is_dev_classroom
        assert is_dev_classroom("三年甲班") is False
        assert is_dev_classroom("五年乙班") is False
        assert is_dev_classroom("PM 班") is False  # no R\d, so no false positive
        assert is_dev_classroom("驗證班") is False  # not "Bulk驗證"
        assert is_dev_classroom("Fields Test Class") is False  # 'test' alone OK


# ---------------------------------------------------------------------------
# /api/classrooms route behavior — teacher gets filtered, admin gets all
# ---------------------------------------------------------------------------

class TestClassroomsEndpointFiltersDevForTeachers:
    def test_regular_teacher_does_not_see_dev_classrooms(self, db):
        """Issue #1999: teacher hitting /api/classrooms must NOT receive the
        dev/test classrooms even though they are the owner. Same filter as
        /api/teacher/classrooms."""
        _seed_classrooms(db, teacher_id=_FakeTeacher().id)

        app.dependency_overrides[get_db] = _override_get_db
        app.dependency_overrides[get_current_user] = lambda: _FakeTeacher()

        client = TestClient(app)
        resp = client.get("/api/classrooms")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        names = [c["name"] for c in data["items"]]
        assert "PM R3 verify" not in names
        assert "Bulk驗證 2026-05-16" not in names
        assert "PM Dogfood R2 班" not in names
        assert "三年甲班" in names
        assert "五年乙班" in names
        assert data["total"] == 2  # only the 2 real ones
        app.dependency_overrides.clear()

    def test_admin_still_sees_all_classrooms(self, db):
        """Admin platform view must include dev classrooms (for cleanup,
        debugging, etc). Don't filter on admin path."""
        _seed_classrooms(db, teacher_id=_FakeTeacher().id)

        # Insert an admin user_role so is_admin returns True
        # Bypass: monkeypatch is_admin to return True for our fake admin
        from app.routes.classrooms import classroom_crud as _crud_mod
        orig_is_admin = _crud_mod.is_admin
        _crud_mod.is_admin = lambda user_id, db: True

        app.dependency_overrides[get_db] = _override_get_db
        app.dependency_overrides[get_current_user] = lambda: _FakeAdmin()

        try:
            client = TestClient(app)
            resp = client.get("/api/classrooms")
            assert resp.status_code == 200, resp.text
            data = resp.json()
            names = [c["name"] for c in data["items"]]
            # Admin should see all 5
            assert "PM R3 verify" in names
            assert "Bulk驗證 2026-05-16" in names
            assert "PM Dogfood R2 班" in names
            assert "三年甲班" in names
            assert "五年乙班" in names
            assert data["total"] == 5
        finally:
            _crud_mod.is_admin = orig_is_admin
            app.dependency_overrides.clear()

    def test_only_dev_classrooms_returns_empty_for_teacher(self, db):
        """Edge case: teacher owns only dev classrooms → /api/classrooms
        returns empty list (total=0)."""
        school = School(id=1, name="X", address="Y")
        db.add(school)
        db.flush()
        for i, name in enumerate(["PM R1", "Bulk驗證 a", "dogfood班"], start=1):
            db.add(Classroom(
                id=i, name=name, school_id=1,
                teacher_id=_FakeTeacher().id, grade=4,
                join_code=f"C{i:03d}", is_active=True,
            ))
        db.commit()

        app.dependency_overrides[get_db] = _override_get_db
        app.dependency_overrides[get_current_user] = lambda: _FakeTeacher()

        client = TestClient(app)
        resp = client.get("/api/classrooms")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0
        app.dependency_overrides.clear()
