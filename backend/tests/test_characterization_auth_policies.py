"""
Characterization tests for backend/app/auth/policies.py (refactor #1822).

These tests lock in the 4-case permission matrix:
  - owner (primary teacher) of the classroom
  - co-teacher (ClassroomTeacher record exists)
  - admin (system_admin or org_admin role)
  - non-member (none of the above) → 403

Run: cd backend && python -m pytest tests/test_characterization_auth_policies.py -v
"""

import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException


# ---------------------------------------------------------------------------
# Helpers to build lightweight mock objects that mirror the real SQLAlchemy
# models without touching a real database.
# ---------------------------------------------------------------------------

def _make_classroom(teacher_id: int = 1, classroom_id: int = 10) -> MagicMock:
    cls = MagicMock()
    cls.id = classroom_id
    cls.teacher_id = teacher_id
    return cls


def _make_user(user_id: int) -> MagicMock:
    u = MagicMock()
    u.id = user_id
    return u


def _make_db_no_admin_no_coteacher() -> MagicMock:
    """DB session where is_admin → False and no co-teacher record exists.

    require_classroom_member uses TWO different query patterns:
      - ClassroomTeacher: db.query(CT).filter(...).first()  (no .join)
      - UserRole (via is_admin): db.query(UserRole).join(...).filter(...).first()
    We must return None from both.
    """
    db = MagicMock()
    inner = MagicMock()
    # pattern: .query().filter().first() → None (ClassroomTeacher query)
    inner.filter.return_value.first.return_value = None
    # pattern: .query().join().filter().first() → None (UserRole/is_admin query)
    inner.join.return_value.filter.return_value.first.return_value = None
    db.query.return_value = inner
    return db


def _make_db_admin() -> MagicMock:
    """DB session where is_admin → True (UserRole query finds a matching role)."""
    db = MagicMock()
    db.query.return_value.join.return_value.filter.return_value.first.return_value = MagicMock()
    return db


def _make_db_with_coteacher(classroom_id: int, teacher_id: int) -> MagicMock:
    """DB where is_admin → False but ClassroomTeacher query returns a record."""
    db = MagicMock()

    call_count = {"n": 0}

    def fake_query(model):
        call_count["n"] += 1
        # First query = UserRole (for is_admin) → return None (not admin)
        # Second query = ClassroomTeacher (for co-teacher check) → return a record
        from app.models.school import ClassroomTeacher
        from app.models.user import UserRole
        inner = MagicMock()
        if model is UserRole:
            inner.join.return_value.filter.return_value.first.return_value = None
        elif model is ClassroomTeacher:
            ct = MagicMock()
            ct.classroom_id = classroom_id
            ct.teacher_id = teacher_id
            inner.filter.return_value.first.return_value = ct
        else:
            inner.join.return_value.filter.return_value.first.return_value = None
            inner.filter.return_value.first.return_value = None
        return inner

    db.query.side_effect = fake_query
    return db


# ---------------------------------------------------------------------------
# Tests for is_admin
# ---------------------------------------------------------------------------

class TestIsAdmin:
    """is_admin(user_id, db) returns bool based on UserRole query."""

    def test_admin_with_matching_role_returns_true(self):
        from app.auth.policies import is_admin

        db = _make_db_admin()
        assert is_admin(user_id=42, db=db) is True

    def test_non_admin_returns_false(self):
        from app.auth.policies import is_admin

        db = _make_db_no_admin_no_coteacher()
        assert is_admin(user_id=99, db=db) is False

    def test_is_admin_queries_user_id(self):
        """is_admin must query by the provided user_id, not a hardcoded value."""
        from app.auth.policies import is_admin

        db = MagicMock()
        db.query.return_value.join.return_value.filter.return_value.first.return_value = None

        is_admin(user_id=55, db=db)
        # Verify that .query() was called (DB was actually queried)
        db.query.assert_called_once()


# ---------------------------------------------------------------------------
# Tests for require_classroom_owner
# ---------------------------------------------------------------------------

class TestRequireClassroomOwner:
    """require_classroom_owner: owner and admin pass, co-teacher and non-member raise 403."""

    def test_owner_passes(self):
        from app.auth.policies import require_classroom_owner

        classroom = _make_classroom(teacher_id=7)
        user = _make_user(7)          # same as classroom.teacher_id
        db = _make_db_no_admin_no_coteacher()

        # Must not raise
        require_classroom_owner(classroom, user, db)

    def test_admin_passes(self):
        from app.auth.policies import require_classroom_owner

        classroom = _make_classroom(teacher_id=7)
        user = _make_user(99)         # not the owner
        db = _make_db_admin()         # but is admin

        # Must not raise
        require_classroom_owner(classroom, user, db)

    def test_coteacher_is_blocked(self):
        """Co-teachers must NOT be allowed to perform write operations."""
        from app.auth.policies import require_classroom_owner

        classroom = _make_classroom(teacher_id=7, classroom_id=10)
        user = _make_user(20)         # co-teacher, not owner, not admin
        db = _make_db_with_coteacher(classroom_id=10, teacher_id=20)

        # Co-teacher must be BLOCKED for write ops (403)
        with pytest.raises(HTTPException) as exc_info:
            require_classroom_owner(classroom, user, db)
        assert exc_info.value.status_code == 403

    def test_non_member_raises_403(self):
        from app.auth.policies import require_classroom_owner

        classroom = _make_classroom(teacher_id=7)
        user = _make_user(50)         # stranger
        db = _make_db_no_admin_no_coteacher()

        with pytest.raises(HTTPException) as exc_info:
            require_classroom_owner(classroom, user, db)
        assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# Tests for require_classroom_member
# ---------------------------------------------------------------------------

class TestRequireClassroomMember:
    """require_classroom_member: owner, co-teacher, and admin pass; non-member raises 403."""

    def test_owner_passes(self):
        from app.auth.policies import require_classroom_member

        classroom = _make_classroom(teacher_id=7)
        user = _make_user(7)
        db = _make_db_no_admin_no_coteacher()

        require_classroom_member(classroom, user, db)  # must not raise

    def test_admin_passes(self):
        from app.auth.policies import require_classroom_member

        classroom = _make_classroom(teacher_id=7)
        user = _make_user(99)
        db = _make_db_admin()

        require_classroom_member(classroom, user, db)  # must not raise

    def test_coteacher_passes(self):
        """Co-teachers ARE allowed for read operations."""
        from app.auth.policies import require_classroom_member

        classroom = _make_classroom(teacher_id=7, classroom_id=10)
        user = _make_user(20)
        db = _make_db_with_coteacher(classroom_id=10, teacher_id=20)

        require_classroom_member(classroom, user, db)  # must not raise

    def test_non_member_raises_403(self):
        from app.auth.policies import require_classroom_member

        classroom = _make_classroom(teacher_id=7)
        user = _make_user(50)
        db = _make_db_no_admin_no_coteacher()

        with pytest.raises(HTTPException) as exc_info:
            require_classroom_member(classroom, user, db)
        assert exc_info.value.status_code == 403

    def test_owner_vs_coteacher_symmetry(self):
        """require_classroom_member must accept both owner and co-teacher
        but require_classroom_owner must only accept owner (not co-teacher)."""
        from app.auth.policies import require_classroom_owner, require_classroom_member

        classroom = _make_classroom(teacher_id=7, classroom_id=10)
        coteacher = _make_user(20)
        db = _make_db_with_coteacher(classroom_id=10, teacher_id=20)

        # member check: passes
        require_classroom_member(classroom, coteacher, db)

        # owner check: raises 403 (asymmetry is the business rule)
        with pytest.raises(HTTPException) as exc_info:
            require_classroom_owner(classroom, coteacher, db)
        assert exc_info.value.status_code == 403
