"""
TDD tests for Issue #1985 — teacher classroom list must NOT show dev/test classrooms
by default. Uses name-pattern approach (b): no DB migration required.

Pattern: case-insensitive match on:
  PM R\\d | Bulk驗證 | dogfood | staging | \\btest\\b
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.auth.dependencies import get_current_user
from app.models import Base
from app.models.school import School, Classroom


# ---------------------------------------------------------------------------
# In-memory SQLite DB
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Fake teacher user injected via get_current_user override (avoids JWT + Role table complexity)
@dataclass
class _FakeTeacher:
    id: int = 1
    email: str = "faketeacher_at_test_dot_com"
    is_active: bool = True

_FAKE_TEACHER = _FakeTeacher()


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


@pytest.fixture
def client(db):
    def override_get_db():
        try:
            yield db
        finally:
            pass

    def override_get_current_user():
        return _FAKE_TEACHER

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _seed_teacher_and_school(db):
    """Seed a School and reference the fake teacher ID (no real User row needed for query)."""
    school = School(name="Test School")
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


def _make_classroom(db, school, name):
    c = Classroom(
        name=name,
        school_id=school.id,
        teacher_id=_FAKE_TEACHER.id,
        is_active=True,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


# ---------------------------------------------------------------------------
# Tests — RED phase (these fail before the fix)
# ---------------------------------------------------------------------------

DEV_NAMES = [
    "PM R3 verify",
    "PM Dogfood R2 班",
    "Bulk驗證 2026-05-16",
    "dogfood test",
    "PM R1 測試",
    "PM R2 班",
]

REAL_NAMES = [
    "三年甲班",
    "五年乙班",
    "六年級國語",
]


def test_dev_classrooms_excluded_from_teacher_list(client, db):
    """Teacher /teacher/classrooms should NOT return dev/test named classrooms."""
    school = _seed_teacher_and_school(db)

    # Create mix of real + dev classrooms
    for name in DEV_NAMES + REAL_NAMES:
        _make_classroom(db, school, name)

    resp = client.get("/api/teacher/classrooms")
    assert resp.status_code == 200, resp.text
    returned_names = {c["name"] for c in resp.json()}

    # All real classrooms must appear
    for name in REAL_NAMES:
        assert name in returned_names, f"Real classroom '{name}' should be visible"

    # No dev classroom should appear
    for name in DEV_NAMES:
        assert name not in returned_names, f"Dev classroom '{name}' should be hidden"


def test_only_dev_classrooms_returns_empty(client, db):
    """If teacher owns only dev-named classrooms, list returns empty."""
    school = _seed_teacher_and_school(db)

    for name in DEV_NAMES:
        _make_classroom(db, school, name)

    resp = client.get("/api/teacher/classrooms")
    assert resp.status_code == 200
    assert resp.json() == []


def test_real_classroom_not_falsely_filtered(client, db):
    """Ensure no false positives: 'PM 班' without R\\d stays visible."""
    school = _seed_teacher_and_school(db)

    edge_cases = [
        "PM 班",          # 'PM' alone — no R\d — should NOT be filtered
        "驗證班",          # '驗證' alone (not 'Bulk驗證') — should NOT be filtered
        "三年甲班",
        "Fields Test Class",  # 'test' in name — should NOT be filtered (too broad)
    ]
    for name in edge_cases:
        _make_classroom(db, school, name)

    resp = client.get("/api/teacher/classrooms")
    assert resp.status_code == 200
    returned_names = {c["name"] for c in resp.json()}
    for name in edge_cases:
        assert name in returned_names, f"'{name}' should NOT be filtered"
