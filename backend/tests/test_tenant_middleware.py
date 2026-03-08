"""
Tests for tenant middleware and dependency system.

TDD Red Phase: These tests define the expected behavior of the
multi-tenant access control system before implementation.

Test coverage:
- TenantMiddleware enriches request.state with org context
- require_org_member blocks cross-org access
- require_org_admin enforces org admin level
- require_classroom_access allows owner, blocks strangers
- get_tenant_filter returns correct SQLAlchemy filter
- system_admin bypasses all tenant checks
"""
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User, UserRole, Role
from app.models.school import Classroom, ClassroomStudent, School
from app.models.organization import Organization


# ── Fixtures ────────────────────────────────────────────────────────────────


def _make_role(name: str, scope_level: str = "platform") -> Role:
    role = MagicMock(spec=Role)
    role.id = hash(name) % 1000
    role.name = name
    role.scope_level = scope_level
    role.is_active = True
    return role


def _make_user_role(
    user_id: int,
    role: Role,
    scope_type: str = "platform",
    scope_id: str | None = None,
    is_active: bool = True,
) -> UserRole:
    ur = MagicMock(spec=UserRole)
    ur.user_id = user_id
    ur.role = role
    ur.role_id = role.id
    ur.scope_type = scope_type
    ur.scope_id = scope_id
    ur.is_active = is_active
    return ur


def _make_user(
    user_id: int = 1,
    name: str = "Test User",
    user_roles: list | None = None,
) -> User:
    user = MagicMock(spec=User)
    user.id = user_id
    user.name = name
    user.is_active = True
    user.user_roles = user_roles or []
    return user


def _make_org(org_id: str = "org-abc") -> Organization:
    org = MagicMock(spec=Organization)
    org.id = org_id
    org.name = "Test Org"
    org.is_active = True
    return org


def _make_classroom(
    classroom_id: int = 1,
    teacher_id: int = 10,
    school_id: int = 5,
) -> Classroom:
    classroom = MagicMock(spec=Classroom)
    classroom.id = classroom_id
    classroom.teacher_id = teacher_id
    classroom.school_id = school_id
    classroom.name = "Test Classroom"
    classroom.is_active = True
    return classroom


# ── TenantMiddleware Tests ───────────────────────────────────────────────────


class TestTenantMiddleware:
    """Test that TenantMiddleware enriches request.state correctly."""

    def test_middleware_sets_organization_id_from_user_role(self):
        """Middleware extracts org_id from user's org-scoped role."""
        from app.middleware.tenant import _extract_org_context

        org_role = _make_role("org_admin")
        ur = _make_user_role(1, org_role, scope_type="organization", scope_id="org-xyz")
        user = _make_user(user_id=1, user_roles=[ur])

        ctx = _extract_org_context(user)

        assert ctx["organization_id"] == "org-xyz"
        assert ctx["user_role"] == "org_admin"

    def test_middleware_sets_system_admin_role(self):
        """Middleware identifies system_admin users correctly."""
        from app.middleware.tenant import _extract_org_context

        sys_role = _make_role("system_admin")
        ur = _make_user_role(1, sys_role, scope_type="platform")
        user = _make_user(user_id=1, user_roles=[ur])

        ctx = _extract_org_context(user)

        assert ctx["user_role"] == "system_admin"
        assert ctx["organization_id"] is None  # system_admin has no specific org

    def test_middleware_returns_none_for_unauthenticated(self):
        """Middleware returns empty context when user is None."""
        from app.middleware.tenant import _extract_org_context

        ctx = _extract_org_context(None)

        assert ctx["organization_id"] is None
        assert ctx["user_role"] is None

    def test_middleware_uses_first_active_org_role(self):
        """When user has multiple org roles, uses the first active one."""
        from app.middleware.tenant import _extract_org_context

        org_role = _make_role("teacher")
        ur1 = _make_user_role(1, org_role, scope_type="organization", scope_id="org-first")
        ur2 = _make_user_role(1, org_role, scope_type="organization", scope_id="org-second")
        user = _make_user(user_id=1, user_roles=[ur1, ur2])

        ctx = _extract_org_context(user)

        assert ctx["organization_id"] == "org-first"

    def test_middleware_ignores_inactive_roles(self):
        """Inactive UserRole entries are ignored."""
        from app.middleware.tenant import _extract_org_context

        org_role = _make_role("teacher")
        ur_inactive = _make_user_role(
            1, org_role, scope_type="organization", scope_id="org-inactive", is_active=False
        )
        user = _make_user(user_id=1, user_roles=[ur_inactive])

        ctx = _extract_org_context(user)

        assert ctx["organization_id"] is None


# ── require_org_member Tests ─────────────────────────────────────────────────


class TestRequireOrgMember:
    """Test org membership check dependency."""

    def test_allows_user_in_org(self):
        """User with org role in the target org passes."""
        from app.dependencies.tenant import _check_org_member

        org_role = _make_role("teacher")
        ur = _make_user_role(1, org_role, scope_type="organization", scope_id="org-abc")
        user = _make_user(user_id=1, user_roles=[ur])
        db = MagicMock(spec=Session)

        # Should not raise
        _check_org_member(user, "org-abc", db)

    def test_blocks_user_from_different_org(self):
        """User with role in a different org is denied."""
        from app.dependencies.tenant import _check_org_member

        org_role = _make_role("teacher")
        ur = _make_user_role(1, org_role, scope_type="organization", scope_id="org-other")
        user = _make_user(user_id=1, user_roles=[ur])
        db = MagicMock(spec=Session)

        with pytest.raises(HTTPException) as exc_info:
            _check_org_member(user, "org-abc", db)

        assert exc_info.value.status_code == 403

    def test_system_admin_bypasses_org_check(self):
        """system_admin is allowed regardless of org."""
        from app.dependencies.tenant import _check_org_member

        sys_role = _make_role("system_admin")
        ur = _make_user_role(1, sys_role, scope_type="platform")
        user = _make_user(user_id=1, user_roles=[ur])
        db = MagicMock(spec=Session)

        # Should not raise
        _check_org_member(user, "org-any-org", db)

    def test_user_without_any_roles_is_denied(self):
        """User with no roles at all is denied."""
        from app.dependencies.tenant import _check_org_member

        user = _make_user(user_id=1, user_roles=[])
        db = MagicMock(spec=Session)

        with pytest.raises(HTTPException) as exc_info:
            _check_org_member(user, "org-abc", db)

        assert exc_info.value.status_code == 403


# ── require_org_admin Tests ──────────────────────────────────────────────────


class TestRequireOrgAdmin:
    """Test org admin-level check dependency."""

    def test_allows_org_admin(self):
        """User with org_admin role in target org passes."""
        from app.dependencies.tenant import _check_org_admin

        role = _make_role("org_admin")
        ur = _make_user_role(1, role, scope_type="organization", scope_id="org-abc")
        user = _make_user(user_id=1, user_roles=[ur])
        db = MagicMock(spec=Session)

        _check_org_admin(user, "org-abc", db)  # should not raise

    def test_allows_org_owner(self):
        """User with org_owner role in target org passes."""
        from app.dependencies.tenant import _check_org_admin

        role = _make_role("org_owner")
        ur = _make_user_role(1, role, scope_type="organization", scope_id="org-abc")
        user = _make_user(user_id=1, user_roles=[ur])
        db = MagicMock(spec=Session)

        _check_org_admin(user, "org-abc", db)  # should not raise

    def test_blocks_regular_teacher(self):
        """Regular teacher in the org cannot do org-admin actions."""
        from app.dependencies.tenant import _check_org_admin

        role = _make_role("teacher")
        ur = _make_user_role(1, role, scope_type="organization", scope_id="org-abc")
        user = _make_user(user_id=1, user_roles=[ur])
        db = MagicMock(spec=Session)

        with pytest.raises(HTTPException) as exc_info:
            _check_org_admin(user, "org-abc", db)

        assert exc_info.value.status_code == 403

    def test_system_admin_bypasses_org_admin_check(self):
        """system_admin passes org_admin check regardless."""
        from app.dependencies.tenant import _check_org_admin

        sys_role = _make_role("system_admin")
        ur = _make_user_role(1, sys_role, scope_type="platform")
        user = _make_user(user_id=1, user_roles=[ur])
        db = MagicMock(spec=Session)

        _check_org_admin(user, "org-any", db)  # should not raise

    def test_blocks_admin_of_different_org(self):
        """org_admin of org-other cannot access org-abc."""
        from app.dependencies.tenant import _check_org_admin

        role = _make_role("org_admin")
        ur = _make_user_role(1, role, scope_type="organization", scope_id="org-other")
        user = _make_user(user_id=1, user_roles=[ur])
        db = MagicMock(spec=Session)

        with pytest.raises(HTTPException) as exc_info:
            _check_org_admin(user, "org-abc", db)

        assert exc_info.value.status_code == 403


# ── require_classroom_access Tests ──────────────────────────────────────────


class TestRequireClassroomAccess:
    """Test classroom-level access check dependency."""

    def test_allows_classroom_teacher(self):
        """The classroom's own teacher passes."""
        from app.dependencies.tenant import _check_classroom_access

        user = _make_user(user_id=10)
        classroom = _make_classroom(classroom_id=1, teacher_id=10)
        db = MagicMock(spec=Session)
        db.query.return_value.filter.return_value.first.return_value = classroom

        _check_classroom_access(user, 1, db)  # should not raise

    def test_blocks_other_teacher(self):
        """A teacher who does not own the classroom is denied."""
        from app.dependencies.tenant import _check_classroom_access

        user = _make_user(user_id=99, user_roles=[])
        classroom = _make_classroom(classroom_id=1, teacher_id=10)
        db = MagicMock(spec=Session)
        db.query.return_value.filter.return_value.first.return_value = classroom

        with pytest.raises(HTTPException) as exc_info:
            _check_classroom_access(user, 1, db)

        assert exc_info.value.status_code == 403

    def test_system_admin_bypasses_classroom_check(self):
        """system_admin can access any classroom."""
        from app.dependencies.tenant import _check_classroom_access

        sys_role = _make_role("system_admin")
        ur = _make_user_role(1, sys_role, scope_type="platform")
        user = _make_user(user_id=1, user_roles=[ur])
        classroom = _make_classroom(classroom_id=1, teacher_id=99)
        db = MagicMock(spec=Session)
        db.query.return_value.filter.return_value.first.return_value = classroom

        _check_classroom_access(user, 1, db)  # should not raise

    def test_raises_404_for_nonexistent_classroom(self):
        """Nonexistent classroom returns 404, not 403."""
        from app.dependencies.tenant import _check_classroom_access

        user = _make_user(user_id=1)
        db = MagicMock(spec=Session)
        db.query.return_value.filter.return_value.first.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            _check_classroom_access(user, 999, db)

        assert exc_info.value.status_code == 404

    def test_org_admin_with_same_org_can_access(self):
        """org_admin in the same organization can access classrooms within it."""
        from app.dependencies.tenant import _check_classroom_access

        org_admin_role = _make_role("org_admin")
        ur = _make_user_role(1, org_admin_role, scope_type="organization", scope_id="org-abc")
        user = _make_user(user_id=1, user_roles=[ur])

        # School belongs to same org
        school = MagicMock(spec=School)
        school.id = 5
        school.organization_id = "org-abc"

        classroom = _make_classroom(classroom_id=1, teacher_id=99, school_id=5)
        db = MagicMock(spec=Session)

        # First query for classroom, second for school
        query_mock = MagicMock()
        filter_mock = MagicMock()
        filter_mock.first.side_effect = [classroom, school]
        query_mock.filter.return_value = filter_mock
        db.query.return_value = query_mock

        _check_classroom_access(user, 1, db)  # should not raise


# ── get_tenant_filter Tests ──────────────────────────────────────────────────


class TestGetTenantFilter:
    """Test SQLAlchemy filter factory for tenant isolation."""

    def test_system_admin_gets_no_filter(self):
        """system_admin returns None (no filter — sees all)."""
        from app.dependencies.tenant import get_tenant_filter

        sys_role = _make_role("system_admin")
        ur = _make_user_role(1, sys_role, scope_type="platform")
        user = _make_user(user_id=1, user_roles=[ur])

        result = get_tenant_filter(Organization, user)

        assert result is None

    def test_org_user_gets_org_filter(self):
        """Regular user gets a filter restricting to their org."""
        from app.dependencies.tenant import get_tenant_filter

        org_role = _make_role("org_admin")
        ur = _make_user_role(1, org_role, scope_type="organization", scope_id="org-abc")
        user = _make_user(user_id=1, user_roles=[ur])

        result = get_tenant_filter(Organization, user)

        # Should return a SQLAlchemy BinaryExpression
        assert result is not None

    def test_user_with_no_org_gets_empty_filter(self):
        """User with no org scoped roles gets an impossible filter (no access)."""
        from app.dependencies.tenant import get_tenant_filter

        user = _make_user(user_id=1, user_roles=[])

        result = get_tenant_filter(Organization, user)

        # Filter should exist but restrict to empty set
        assert result is not None


# ── Integration: is_system_admin helper ─────────────────────────────────────


class TestIsSystemAdmin:
    """Test helper function for system_admin detection."""

    def test_detects_system_admin(self):
        """is_system_admin returns True for a system_admin user."""
        from app.dependencies.tenant import is_system_admin

        sys_role = _make_role("system_admin")
        ur = _make_user_role(1, sys_role, scope_type="platform")
        user = _make_user(user_id=1, user_roles=[ur])

        assert is_system_admin(user) is True

    def test_rejects_non_admin(self):
        """is_system_admin returns False for regular users."""
        from app.dependencies.tenant import is_system_admin

        teacher_role = _make_role("teacher")
        ur = _make_user_role(1, teacher_role, scope_type="organization", scope_id="org-abc")
        user = _make_user(user_id=1, user_roles=[ur])

        assert is_system_admin(user) is False

    def test_rejects_inactive_system_admin_role(self):
        """Inactive system_admin role does NOT grant bypass."""
        from app.dependencies.tenant import is_system_admin

        sys_role = _make_role("system_admin")
        ur = _make_user_role(1, sys_role, scope_type="platform", is_active=False)
        user = _make_user(user_id=1, user_roles=[ur])

        assert is_system_admin(user) is False

    def test_user_with_no_roles_is_not_admin(self):
        """User with no roles at all is not system_admin."""
        from app.dependencies.tenant import is_system_admin

        user = _make_user(user_id=1, user_roles=[])

        assert is_system_admin(user) is False
