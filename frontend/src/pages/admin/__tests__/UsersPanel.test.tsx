/**
 * UsersPanel tests (Issue #1852)
 * TDD-first: tests written against current code, verified to pass, then survive refactor.
 *
 * Acceptance criteria:
 * 1. debounced search resets page to 0 + calls listUsers with offset 0
 * 2. expanding user loads role details once (not on every re-render)
 * 3. revoke role confirms then reloads role details + parent list
 * 4. assign role maps scope level → correct scope type/id requirement
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

vi.mock('../../../services/userApi', () => ({
  listUsers: vi.fn(),
  UserApiError: class UserApiError extends Error {
    status: number;
    constructor(msg: string, status: number) { super(msg); this.status = status; }
  },
}));

vi.mock('../../../services/roleApi', () => ({
  listRoles: vi.fn(),
  assignRole: vi.fn(),
  revokeRole: vi.fn(),
  getUserRoles: vi.fn(),
  RoleApiError: class RoleApiError extends Error {
    status: number;
    constructor(msg: string, status: number) { super(msg); this.status = status; }
  },
}));

vi.mock('../../../services/organizationApi', () => ({
  listOrganizations: vi.fn(),
}));

vi.mock('../../../services/schoolApi', () => ({
  listSchools: vi.fn(),
}));

vi.mock('../../../components/icons', () => ({
  PlusIcon: () => <span data-testid="plus-icon">+</span>,
  UsersIcon: () => <span data-testid="users-icon">users</span>,
}));

import UsersPanel from '../UsersPanel';
import { listUsers } from '../../../services/userApi';
import { getUserRoles, revokeRole, assignRole, listRoles } from '../../../services/roleApi';
import { listOrganizations } from '../../../services/organizationApi';
import { listSchools } from '../../../services/schoolApi';

const mockListUsers = vi.mocked(listUsers);
const mockGetUserRoles = vi.mocked(getUserRoles);
const mockRevokeRole = vi.mocked(revokeRole);
const mockAssignRole = vi.mocked(assignRole);
const mockListRoles = vi.mocked(listRoles);
const mockListOrganizations = vi.mocked(listOrganizations);
const mockListSchools = vi.mocked(listSchools);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_USER = {
  id: 42,
  name: '王小明',
  email: 'test-user@example.com',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  roles: [{ role_name: 'teacher', scope_type: 'school', scope_id: '1' }],
};

const MOCK_USERS_RESPONSE = { items: [MOCK_USER], total: 1 };

const MOCK_ROLE_DETAIL = {
  id: 100,
  user_id: 42,
  role_id: 3,
  role_name: 'teacher',
  role_display_name: '教師',
  scope_type: 'school',
  scope_id: '1',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
};

const MOCK_ROLES = [
  { id: 1, name: 'system_admin', display_name: '系統管理員', scope_level: 'global' },
  { id: 2, name: 'org_admin', display_name: '機構管理員', scope_level: 'organization' },
  { id: 3, name: 'teacher', display_name: '教師', scope_level: 'school' },
];

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockListUsers.mockResolvedValue(MOCK_USERS_RESPONSE);
  mockGetUserRoles.mockResolvedValue([MOCK_ROLE_DETAIL]);
  mockRevokeRole.mockResolvedValue(undefined as never);
  mockAssignRole.mockResolvedValue(MOCK_ROLE_DETAIL);
  mockListRoles.mockResolvedValue(MOCK_ROLES);
  mockListOrganizations.mockResolvedValue({ items: [{ id: 10, name: 'test-org', display_name: '測試機構' }], total: 1 } as never);
  mockListSchools.mockResolvedValue({ items: [{ id: 20, name: 'test-school', display_name: '測試學校' }], total: 1 } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── Helper: render and wait for user list ─────────────────────────────────────

async function renderAndWaitForUsers() {
  render(<UsersPanel />);
  await waitFor(() => expect(screen.getByText('王小明')).toBeInTheDocument());
}

// ── Test 1: Debounced search ──────────────────────────────────────────────────

describe('debounced search', () => {
  it('does not call listUsers immediately on keystroke (debounce in effect)', async () => {
    // Use fake timers for this test to control debounce
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      render(<UsersPanel />);

      // Wait for initial load (timers still run because shouldAdvanceTime:true)
      await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByText('王小明')).toBeInTheDocument());

      const callsBefore = mockListUsers.mock.calls.length;
      const searchInput = screen.getByPlaceholderText('搜尋使用者姓名或 Email...');

      // Type — debounce timer starts
      act(() => {
        fireEvent.change(searchInput, { target: { value: '王' } });
      });

      // Should NOT have fired another call yet (within debounce window)
      expect(mockListUsers).toHaveBeenCalledTimes(callsBefore);

      // Advance past debounce
      await act(async () => {
        vi.advanceTimersByTime(400);
      });

      // Now it should have fired
      await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(callsBefore + 1));

      expect(mockListUsers).toHaveBeenLastCalledWith('test-token', {
        limit: 20,
        offset: 0,
        search: '王',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls listUsers with offset=0 regardless of current page (page reset)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      // Give enough users to show pagination (total > 20)
      mockListUsers.mockResolvedValue({
        items: [MOCK_USER],
        total: 25, // triggers pagination
      });

      render(<UsersPanel />);
      await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByText('王小明')).toBeInTheDocument());

      // Go to page 2
      const nextBtn = screen.getByRole('button', { name: '下一頁' });
      await act(async () => { fireEvent.click(nextBtn); });
      await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(2));

      // Page 2 uses offset=20
      expect(mockListUsers).toHaveBeenLastCalledWith('test-token', {
        limit: 20, offset: 20, search: undefined,
      });

      // Now type search → should reset page to 0
      const searchInput = screen.getByPlaceholderText('搜尋使用者姓名或 Email...');
      act(() => { fireEvent.change(searchInput, { target: { value: '王' } }); });

      await act(async () => { vi.advanceTimersByTime(400); });

      await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(3));

      // Must use offset=0 (page reset)
      expect(mockListUsers).toHaveBeenLastCalledWith('test-token', {
        limit: 20,
        offset: 0,
        search: '王',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Test 2: Expanding user loads role details once ────────────────────────────

describe('expanding user row', () => {
  it('calls getUserRoles exactly once when expanded — not before and not again on idle', async () => {
    await renderAndWaitForUsers();

    // Not called before expand
    expect(mockGetUserRoles).not.toHaveBeenCalled();

    // Expand the user row
    const manageBtn = screen.getByRole('button', { name: '管理角色' });
    await act(async () => { fireEvent.click(manageBtn); });

    await waitFor(() => {
      expect(mockGetUserRoles).toHaveBeenCalledTimes(1);
      expect(mockGetUserRoles).toHaveBeenCalledWith('test-token', 42);
    });

    // Panel shows the "目前角色" section heading
    await waitFor(() => expect(screen.getByText('目前角色')).toBeInTheDocument());

    // No extra calls from mere presence in DOM
    expect(mockGetUserRoles).toHaveBeenCalledTimes(1);
  });

  it('does NOT call getUserRoles when user row is collapsed', async () => {
    await renderAndWaitForUsers();

    const manageBtn = screen.getByRole('button', { name: '管理角色' });

    // Expand
    await act(async () => { fireEvent.click(manageBtn); });
    await waitFor(() => expect(mockGetUserRoles).toHaveBeenCalledTimes(1));

    // Collapse — click again
    const collapseBtn = screen.getByRole('button', { name: '收合' });
    await act(async () => { fireEvent.click(collapseBtn); });

    // Still exactly 1 call
    expect(mockGetUserRoles).toHaveBeenCalledTimes(1);
  });
});

// ── Test 3: Revoke confirms then reloads both lists ───────────────────────────

describe('revoke role', () => {
  it('shows confirm step before calling revokeRole', async () => {
    await renderAndWaitForUsers();

    // Expand
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '管理角色' })); });
    await waitFor(() => expect(screen.getByText('目前角色')).toBeInTheDocument());
    // Wait for role details to load in expanded panel
    await waitFor(() => expect(screen.getByRole('button', { name: '撤銷 教師' })).toBeInTheDocument());

    // Click revoke icon
    const revokeBtn = screen.getByRole('button', { name: '撤銷 教師' });
    await act(async () => { fireEvent.click(revokeBtn); });

    // Confirm button appears
    expect(screen.getByText('確認撤銷')).toBeInTheDocument();

    // revokeRole NOT yet called
    expect(mockRevokeRole).not.toHaveBeenCalled();
  });

  it('reloads role details AND parent user list after confirmed revoke', async () => {
    await renderAndWaitForUsers();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '管理角色' })); });
    await waitFor(() => expect(screen.getByText('目前角色')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: '撤銷 教師' })).toBeInTheDocument());

    const listCallsBefore = mockListUsers.mock.calls.length;
    const roleCallsBefore = mockGetUserRoles.mock.calls.length;

    // Open confirm
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '撤銷 教師' }));
    });

    // Confirm revoke
    const confirmBtn = await screen.findByText('確認撤銷');
    await act(async () => { fireEvent.click(confirmBtn); });

    // revokeRole called with the assignment id
    await waitFor(() => {
      expect(mockRevokeRole).toHaveBeenCalledWith('test-token', 100);
    });

    // getUserRoles reloaded after revoke
    await waitFor(() => {
      expect(mockGetUserRoles.mock.calls.length).toBeGreaterThan(roleCallsBefore);
    });

    // listUsers reloaded (parent list refresh)
    await waitFor(() => {
      expect(mockListUsers.mock.calls.length).toBeGreaterThan(listCallsBefore);
    });
  });
});

// ── Test 4: Assign role scope type/id mapping ─────────────────────────────────

describe('assign role scope mapping', () => {
  async function openAssignForm() {
    await renderAndWaitForUsers();

    // Expand user
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '管理角色' })); });
    await waitFor(() => expect(screen.getByText('目前角色')).toBeInTheDocument());

    // Open assign form
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /指派角色/ })); });
    await waitFor(() => expect(screen.getByLabelText('角色')).toBeInTheDocument());
  }

  it('global scope_level → scope_type=platform, no scope picker, no scope_id in call', async () => {
    await openAssignForm();

    act(() => { fireEvent.change(screen.getByLabelText('角色'), { target: { value: 'system_admin' } }); });

    // No scope pickers
    await waitFor(() => expect(screen.getByText(/全域角色/)).toBeInTheDocument());
    expect(screen.queryByLabelText('機構')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('學校')).not.toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '指派' })); });

    await waitFor(() => {
      expect(mockAssignRole).toHaveBeenCalledWith('test-token', {
        user_id: 42,
        role_name: 'system_admin',
        scope_type: 'platform',
        scope_id: undefined,
      });
    });
  });

  it('organization scope_level → shows org picker, passes scope_type=organization + selected org id', async () => {
    await openAssignForm();

    act(() => { fireEvent.change(screen.getByLabelText('角色'), { target: { value: 'org_admin' } }); });

    await waitFor(() => expect(screen.getByLabelText('機構')).toBeInTheDocument());
    expect(screen.queryByLabelText('學校')).not.toBeInTheDocument();

    act(() => { fireEvent.change(screen.getByLabelText('機構'), { target: { value: '10' } }); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '指派' })); });

    await waitFor(() => {
      expect(mockAssignRole).toHaveBeenCalledWith('test-token', {
        user_id: 42,
        role_name: 'org_admin',
        scope_type: 'organization',
        scope_id: '10',
      });
    });
  });

  it('school scope_level → shows school picker, passes scope_type=school + selected school id', async () => {
    await openAssignForm();

    act(() => { fireEvent.change(screen.getByLabelText('角色'), { target: { value: 'teacher' } }); });

    await waitFor(() => expect(screen.getByLabelText('學校')).toBeInTheDocument());
    expect(screen.queryByLabelText('機構')).not.toBeInTheDocument();

    act(() => { fireEvent.change(screen.getByLabelText('學校'), { target: { value: '20' } }); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '指派' })); });

    await waitFor(() => {
      expect(mockAssignRole).toHaveBeenCalledWith('test-token', {
        user_id: 42,
        role_name: 'teacher',
        scope_type: 'school',
        scope_id: '20',
      });
    });
  });

  it('organization scope requires scope_id — blocks submit and shows error if org not selected', async () => {
    await openAssignForm();

    act(() => { fireEvent.change(screen.getByLabelText('角色'), { target: { value: 'org_admin' } }); });
    await waitFor(() => expect(screen.getByLabelText('機構')).toBeInTheDocument());

    // Submit without selecting org
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '指派' })); });

    expect(mockAssignRole).not.toHaveBeenCalled();
    expect(screen.getByText('請選擇範圍')).toBeInTheDocument();
  });
});
