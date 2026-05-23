/**
 * TDD snapshot + behaviour tests for AdminTreeSidebar refactor (Issue #1950)
 *
 * Coverage:
 *   1. Snapshot: tree renders with mock org/school data
 *   2. Expand org → triggers school load + renders school nodes
 *   3. Expand school → triggers classroom load + renders classroom nodes
 *   4. Collapse org → hides school nodes
 *   5. Node selection propagates to onSelectNode callback
 *   6. Collapsed sidebar shows icon-only mode
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AdminTreeSidebar from '../AdminTreeSidebar';
import type { TreeNodeSelection } from '../AdminTreeSidebar';

// ── Auth mock ──────────────────────────────────────────────────────────────
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

// ── API mocks ──────────────────────────────────────────────────────────────
const mockListOrganizations = vi.fn();
const mockGetOrganization = vi.fn();
const mockListSchoolClassrooms = vi.fn();

vi.mock('../../../services/organizationApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/organizationApi')>(
    '../../../services/organizationApi',
  );
  return {
    ...actual,
    listOrganizations: (...args: unknown[]) => mockListOrganizations(...args),
    getOrganization: (...args: unknown[]) => mockGetOrganization(...args),
  };
});

vi.mock('../../../services/schoolApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/schoolApi')>(
    '../../../services/schoolApi',
  );
  return {
    ...actual,
    listSchoolClassrooms: (...args: unknown[]) => mockListSchoolClassrooms(...args),
  };
});

// ── Fixtures ───────────────────────────────────────────────────────────────
const MOCK_ORG = {
  id: 'org-abc',
  name: 'test-org',
  display_name: '測試機構',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  school_count: 1,
  description: null,
  tax_id: null,
  contact_email: null,
  contact_phone: null,
  address: null,
  settings: null,
  total_points: 1000,
  used_points: 200,
  subscription_start_date: null,
  subscription_end_date: null,
  schools: [],
};

const MOCK_ORG_WITH_SCHOOL = {
  ...MOCK_ORG,
  schools: [
    {
      id: 101,
      name: 'test-school',
      display_name: '測試學校',
      is_active: true,
      org_id: 'org-abc',
    },
  ],
};

const MOCK_CLASSROOMS = [
  {
    id: 201,
    name: '三年甲班',
    school_id: 101,
    is_active: true,
  },
  {
    id: 202,
    name: '三年乙班',
    school_id: 101,
    is_active: true,
  },
];

// ── Helper ─────────────────────────────────────────────────────────────────
function renderSidebar(props: Partial<React.ComponentProps<typeof AdminTreeSidebar>> = {}) {
  const onSelectNode = vi.fn();
  const result = render(
    <AdminTreeSidebar
      selectedNode={null}
      onSelectNode={onSelectNode}
      {...props}
    />,
  );
  return { ...result, onSelectNode };
}

// ── Setup ──────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  mockListOrganizations.mockResolvedValue({ items: [MOCK_ORG], total: 1 });
  mockGetOrganization.mockResolvedValue(MOCK_ORG_WITH_SCHOOL);
  mockListSchoolClassrooms.mockResolvedValue(MOCK_CLASSROOMS);
});

// ── Test 1: Snapshot — tree renders with org data ──────────────────────────
describe('snapshot: tree renders with org data', () => {
  it('renders org name in the sidebar after loading', async () => {
    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText('測試機構')).toBeTruthy();
    });
  });

  it('shows "管理架構" header', async () => {
    renderSidebar();
    expect(screen.getByText('管理架構')).toBeTruthy();
  });

  it('shows management links at the bottom (課文管理, 角色管理, 使用者管理)', async () => {
    renderSidebar();
    expect(screen.getByText('課文管理')).toBeTruthy();
    expect(screen.getByText('角色管理')).toBeTruthy();
    expect(screen.getByText('使用者管理')).toBeTruthy();
  });
});

// ── Test 2: Expand org → school nodes appear ──────────────────────────────
describe('expand/collapse: org expansion loads and shows schools', () => {
  it('shows school node after clicking expand chevron on org', async () => {
    renderSidebar();

    // Wait for orgs to load
    await waitFor(() => {
      expect(screen.getByText('測試機構')).toBeTruthy();
    });

    // Find and click the chevron button (aria-label 展開)
    const expandBtn = screen.getByLabelText('展開');
    await act(async () => {
      fireEvent.click(expandBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('測試學校')).toBeTruthy();
    });

    // API should have been called
    expect(mockGetOrganization).toHaveBeenCalledWith('test-token', 'org-abc');
  });

  it('hides school nodes after collapsing an expanded org', async () => {
    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText('測試機構')).toBeTruthy();
    });

    // Expand
    const expandBtn = screen.getByLabelText('展開');
    await act(async () => {
      fireEvent.click(expandBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('測試學校')).toBeTruthy();
    });

    // Collapse
    const collapseBtn = screen.getByLabelText('收合');
    await act(async () => {
      fireEvent.click(collapseBtn);
    });

    await waitFor(() => {
      expect(screen.queryByText('測試學校')).toBeNull();
    });
  });
});

// ── Test 3: Expand school → classroom nodes appear ────────────────────────
describe('expand/collapse: school expansion loads and shows classrooms', () => {
  it('shows classroom nodes after expanding a school', async () => {
    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText('測試機構')).toBeTruthy();
    });

    // Expand org first
    const orgExpandBtn = screen.getByLabelText('展開');
    await act(async () => {
      fireEvent.click(orgExpandBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('測試學校')).toBeTruthy();
    });

    // Now expand the school
    const schoolExpandBtn = screen.getByLabelText('展開');
    await act(async () => {
      fireEvent.click(schoolExpandBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('三年甲班')).toBeTruthy();
      expect(screen.getByText('三年乙班')).toBeTruthy();
    });

    expect(mockListSchoolClassrooms).toHaveBeenCalledWith('test-token', 101);
  });
});

// ── Test 4: Selection propagation ─────────────────────────────────────────
describe('selection: clicking nodes calls onSelectNode', () => {
  it('calls onSelectNode with org type when org button is clicked', async () => {
    const { onSelectNode } = renderSidebar();

    await waitFor(() => {
      expect(screen.getByText('測試機構')).toBeTruthy();
    });

    // The org name is inside a button — click it
    fireEvent.click(screen.getByText('測試機構'));

    expect(onSelectNode).toHaveBeenCalledWith({ type: 'org', id: 'org-abc' });
  });

  it('calls onSelectNode with stories type when 課文管理 is clicked', async () => {
    const { onSelectNode } = renderSidebar();

    fireEvent.click(screen.getByText('課文管理'));

    expect(onSelectNode).toHaveBeenCalledWith({ type: 'stories', id: 'stories' });
  });

  it('calls onSelectNode with roles type when 角色管理 is clicked', async () => {
    const { onSelectNode } = renderSidebar();

    fireEvent.click(screen.getByText('角色管理'));

    expect(onSelectNode).toHaveBeenCalledWith({ type: 'roles', id: 'roles' });
  });

  it('calls onSelectNode with users type when 使用者管理 is clicked', async () => {
    const { onSelectNode } = renderSidebar();

    fireEvent.click(screen.getByText('使用者管理'));

    expect(onSelectNode).toHaveBeenCalledWith({ type: 'users', id: 'users' });
  });

  it('highlights selected org node when selectedNode matches', async () => {
    const selectedNode: TreeNodeSelection = { type: 'org', id: 'org-abc' };
    renderSidebar({ selectedNode });

    await waitFor(() => {
      expect(screen.getByText('測試機構')).toBeTruthy();
    });

    // The org row should have selected styling (bg-blue-50 text-blue-700)
    const orgText = screen.getByText('測試機構');
    // The parent row div has the selected class — check text is in the tree
    expect(orgText.className).toMatch(/font-semibold/);
  });

  it('calls onSelectNode with classroom type after expanding to classroom and clicking', async () => {
    const { onSelectNode } = renderSidebar();

    await waitFor(() => {
      expect(screen.getByText('測試機構')).toBeTruthy();
    });

    // Expand org
    const orgExpandBtn = screen.getByLabelText('展開');
    await act(async () => {
      fireEvent.click(orgExpandBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('測試學校')).toBeTruthy();
    });

    // Expand school
    const schoolExpandBtn = screen.getByLabelText('展開');
    await act(async () => {
      fireEvent.click(schoolExpandBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('三年甲班')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('三年甲班'));
    expect(onSelectNode).toHaveBeenCalledWith({ type: 'classroom', id: 201 });
  });
});

// ── Test 5: Collapsed sidebar icon-only mode ──────────────────────────────
describe('collapsed sidebar: icon-only mode', () => {
  it('switches to icon-only mode when collapse button is clicked', async () => {
    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText('測試機構')).toBeTruthy();
    });

    // Click the 收合側邊欄 button
    fireEvent.click(screen.getByTitle('收合側邊欄'));

    // In icon mode, text labels should not be visible
    expect(screen.queryByText('管理架構')).toBeNull();
    expect(screen.queryByText('測試機構')).toBeNull();

    // But expand button should appear
    expect(screen.getByTitle('展開側邊欄')).toBeTruthy();
  });

  it('restores full sidebar when expand icon is clicked from collapsed mode', async () => {
    renderSidebar();

    await waitFor(() => {
      expect(screen.getByText('測試機構')).toBeTruthy();
    });

    // Collapse
    fireEvent.click(screen.getByTitle('收合側邊欄'));
    expect(screen.queryByText('管理架構')).toBeNull();

    // Expand again
    fireEvent.click(screen.getByTitle('展開側邊欄'));

    await waitFor(() => {
      expect(screen.getByText('管理架構')).toBeTruthy();
    });
  });
});

// ── Test 6: refreshTrigger causes org reload ──────────────────────────────
describe('refreshTrigger prop', () => {
  it('reloads orgs when refreshTrigger increments', async () => {
    const { rerender } = renderSidebar({ refreshTrigger: 0 });

    await waitFor(() => {
      expect(screen.getByText('測試機構')).toBeTruthy();
    });

    const callsBefore = mockListOrganizations.mock.calls.length;

    // Trigger refresh
    await act(async () => {
      rerender(
        <AdminTreeSidebar
          selectedNode={null}
          onSelectNode={vi.fn()}
          refreshTrigger={1}
        />,
      );
    });

    await waitFor(() => {
      expect(mockListOrganizations.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
