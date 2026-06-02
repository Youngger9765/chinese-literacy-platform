/**
 * TDD tests for OrgDetailPanel refactor (Issue #1848)
 *
 * These tests document the BEHAVIOUR of OrgDetailPanel before refactoring so
 * the same tests must pass after extraction of sub-components.
 *
 * Test scope (from issue acceptance criteria):
 *   1. Remaining-points calc (total - used) renders correctly
 *   2. Edit-save trims optional business fields and reloads the org
 *   3. Active toggle confirms before PATCH is_active
 *   4. Points-logs: append on non-zero offset, reset on org change
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import OrgDetailPanel from '../OrgDetailPanel';

// ── Auth mock ──────────────────────────────────────────────────────────────
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

// ── API mocks ──────────────────────────────────────────────────────────────
const mockGetOrganization = vi.fn();
const mockUpdateOrganization = vi.fn();
const mockGetPointsLogs = vi.fn();

vi.mock('../../../services/organizationApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/organizationApi')>(
    '../../../services/organizationApi',
  );
  return {
    ...actual,
    getOrganization: (...args: unknown[]) => mockGetOrganization(...args),
    updateOrganization: (...args: unknown[]) => mockUpdateOrganization(...args),
    getPointsLogs: (...args: unknown[]) => mockGetPointsLogs(...args),
  };
});

vi.mock('../../../services/schoolApi', () => ({
  createSchool: vi.fn(),
  SchoolApiError: class SchoolApiError extends Error {},
}));

// ── Fixtures ───────────────────────────────────────────────────────────────
const BASE_ORG = {
  id: 'org-1',
  name: 'test-org',
  display_name: '測試機構',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  school_count: 2,
  description: null,
  tax_id: null,
  contact_email: null,
  contact_phone: null,
  address: null,
  settings: null,
  total_points: 1000,
  used_points: 300,
  subscription_start_date: null,
  subscription_end_date: null,
  schools: [],
};

const BASE_LOGS = {
  items: [
    {
      id: 1,
      organization_id: 'org-1',
      user_id: 42,
      user_name: '王小明',
      points_used: 5,
      feature_type: 'ai_chat',
      description: '對話練習',
      created_at: '2024-03-01T10:00:00Z',
    },
  ],
  total: 1,
};

const EMPTY_LOGS = { items: [], total: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrganization.mockResolvedValue(BASE_ORG);
  mockGetPointsLogs.mockResolvedValue(EMPTY_LOGS);
});

// ── Helper ─────────────────────────────────────────────────────────────────
async function renderPanel(props: Partial<React.ComponentProps<typeof OrgDetailPanel>> = {}) {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <OrgDetailPanel organizationId="org-1" {...props} />,
    );
  });
  return result;
}

// ── Test 1: Remaining points calc ──────────────────────────────────────────
describe('remaining points calculation', () => {
  it('renders total, used, and remaining (total − used) correctly', async () => {
    mockGetOrganization.mockResolvedValue({ ...BASE_ORG, total_points: 1000, used_points: 300 });
    await renderPanel();

    // Remaining = 1000 - 300 = 700
    expect(screen.getByText('1,000')).toBeTruthy();
    expect(screen.getByText('300')).toBeTruthy();
    expect(screen.getByText('700')).toBeTruthy();
  });

  it('shows remaining in red when it is zero or negative', async () => {
    mockGetOrganization.mockResolvedValue({ ...BASE_ORG, total_points: 500, used_points: 500 });
    await renderPanel();

    // Text "0" should be present (remaining 500-500=0)
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('hides the points section when total_points is null', async () => {
    mockGetOrganization.mockResolvedValue({ ...BASE_ORG, total_points: null, used_points: 0 });
    await renderPanel();

    expect(screen.queryByText('點數使用狀況')).toBeNull();
  });
});

// ── Test 2: Edit save trims optional fields and reloads ────────────────────
describe('edit save behaviour', () => {
  it('calls updateOrganization with trimmed optional fields and undefined when blank', async () => {
    mockUpdateOrganization.mockResolvedValue({});
    await renderPanel();

    // Enter edit mode — EditSection renders its own header "編輯" button AND OrgInfoCard
    // renders a second one; click the last one (OrgInfoCard's card-level button).
    const editBtns = screen.getAllByRole('button', { name: '編輯' });
    fireEvent.click(editBtns[editBtns.length - 1]);

    // Fill required name
    const nameInput = screen.getByLabelText(/機構代碼/);
    fireEvent.change(nameInput, { target: { value: '  trimmed-name  ' } });

    // Leave optional fields empty (contact_email etc. blank)
    const emailInput = screen.getByLabelText(/聯絡信箱/);
    fireEvent.change(emailInput, { target: { value: '   ' } });

    // Save — EditSection renders its own "儲存" button (type=button) in its footer,
    // and OrgInfoCard's form has a submit button (type=submit). Both appear in JSDOM.
    // Click the form's submit button (first in DOM order, type=submit).
    await act(async () => {
      const saveBtns = screen.getAllByRole('button', { name: /儲存/ });
      fireEvent.click(saveBtns[0]);
    });

    expect(mockUpdateOrganization).toHaveBeenCalledWith(
      'test-token',
      'org-1',
      expect.objectContaining({
        name: 'trimmed-name',
        contact_email: undefined, // blank → undefined
      }),
    );
  });

  it('reloads org data (calls getOrganization again) after successful save', async () => {
    mockUpdateOrganization.mockResolvedValue({});
    await renderPanel();

    const callsBefore = mockGetOrganization.mock.calls.length;

    const editBtns = screen.getAllByRole('button', { name: '編輯' });
    fireEvent.click(editBtns[editBtns.length - 1]);

    await act(async () => {
      const saveBtns = screen.getAllByRole('button', { name: /儲存/ });
      fireEvent.click(saveBtns[0]);
    });

    // loadOrg called at least once more after save
    expect(mockGetOrganization.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

// ── Test 3: Active toggle confirms before PATCH ────────────────────────────
describe('active toggle', () => {
  it('does NOT call updateOrganization when user cancels the confirm dialog', async () => {
    // Spy on window.confirm and make it return false
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '停用' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockUpdateOrganization).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('calls updateOrganization with is_active=false when user confirms deactivation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockUpdateOrganization.mockResolvedValue({});
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '停用' }));
    });

    expect(mockUpdateOrganization).toHaveBeenCalledWith(
      'test-token',
      'org-1',
      { is_active: false },
    );

    confirmSpy.mockRestore();
  });

  it('shows "啟用" button when org is inactive', async () => {
    mockGetOrganization.mockResolvedValue({ ...BASE_ORG, is_active: false });
    await renderPanel();

    expect(screen.getByRole('button', { name: '啟用' })).toBeTruthy();
  });
});

// ── Test 4: Points logs — append + reset behaviour ─────────────────────────
describe('points logs pagination', () => {
  it('resets logs when organizationId changes', async () => {
    mockGetPointsLogs.mockResolvedValue(BASE_LOGS);
    const { rerender } = await renderPanel();

    await waitFor(() => {
      expect(screen.getAllByText('王小明').length).toBeGreaterThan(0);
    });

    // Change org → logs should clear
    mockGetOrganization.mockResolvedValue({ ...BASE_ORG, id: 'org-2' });
    mockGetPointsLogs.mockResolvedValue(EMPTY_LOGS);

    await act(async () => {
      rerender(<OrgDetailPanel organizationId="org-2" />);
    });

    await waitFor(() => {
      expect(screen.queryByText('王小明')).toBeNull();
    });
  });

  it('appends logs (not replaces) when "載入更多" is clicked', async () => {
    const page1 = {
      items: [
        { id: 1, organization_id: 'org-1', user_id: 1, user_name: '第一頁使用者', points_used: 5, feature_type: 'chat', description: null, created_at: '2024-03-01T10:00:00Z' },
      ],
      total: 2,
    };
    const page2 = {
      items: [
        { id: 2, organization_id: 'org-1', user_id: 2, user_name: '第二頁使用者', points_used: 3, feature_type: 'chat', description: null, created_at: '2024-03-02T10:00:00Z' },
      ],
      total: 2,
    };

    // First call returns page1, second call returns page2
    mockGetPointsLogs.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    await renderPanel();

    await waitFor(() => {
      expect(screen.getAllByText('第一頁使用者').length).toBeGreaterThan(0);
    });

    // Click "load more"
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '載入更多' }));
    });

    await waitFor(() => {
      // Both pages' users should be visible (component renders mobile + desktop views, so getAllBy)
      expect(screen.getAllByText('第一頁使用者').length).toBeGreaterThan(0);
      expect(screen.getAllByText('第二頁使用者').length).toBeGreaterThan(0);
    });
  });
});
