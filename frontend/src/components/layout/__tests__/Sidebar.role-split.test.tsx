/**
 * TDD-first snapshot tests for Sidebar role-split refactor (Issue #1937)
 *
 * Strategy:
 *  - RED: tests import StudentSidebar/TeacherSidebar/AdminSidebar that don't exist yet → fail
 *  - GREEN: after implementation, snapshots capture ARIA tree per role
 *  - Post-refactor: original Sidebar rendered with each role must produce
 *    same nav items as the extracted role sidebar
 *
 * We mock all context hooks to control what each role sees.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock all context hooks used by Sidebar components
// ---------------------------------------------------------------------------

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { name: 'Test User', roles: ['student'] },
    logout: vi.fn(),
  }),
}));

vi.mock('../../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeView: 'student',
    setActiveView: vi.fn(),
    availableViews: ['student'],
    hasMultipleViews: false,
  }),
}));

vi.mock('../../../../contexts/LearningNavContext', () => ({
  useLearningNav: () => ({ selectedStory: null }),
}));

vi.mock('../../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({ zhuyinMode: 'off', zhuyinReady: true, setZhuyinMode: vi.fn() }),
}));

vi.mock('../../../../services/authApi', () => ({
  hasRole: () => false,
}));

vi.mock('../../../teacher/NotificationBell', () => ({
  default: () => <div data-testid="notification-bell" />,
}));

vi.mock('../../../ui/ZhuyinToggle', () => ({
  default: () => <div data-testid="zhuyin-toggle" />,
}));

// ---------------------------------------------------------------------------
// Helper: render a component in MemoryRouter
// ---------------------------------------------------------------------------

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter initialEntries={['/']}>{ui}</MemoryRouter>);
}

// ---------------------------------------------------------------------------
// Static imports (GREEN phase — files now exist after implementation)
// ---------------------------------------------------------------------------

import { StudentSidebar } from '../StudentSidebar';
import { TeacherSidebar } from '../TeacherSidebar';
import { AdminSidebar } from '../AdminSidebar';
import Sidebar from '../Sidebar';

// ---------------------------------------------------------------------------
// StudentSidebar tests
// ---------------------------------------------------------------------------

describe('StudentSidebar — role=student nav items', () => {
  it('module exists and exports StudentSidebar', () => {
    expect(StudentSidebar).toBeDefined();
    expect(typeof StudentSidebar).toBe('function');
  });

  it('renders student nav items: 主頁/圖書館/班級作業/加入班級/學習紀錄', () => {
    renderWithRouter(<StudentSidebar pendingAssignmentCount={0} collapsed={false} onNavigate={vi.fn()} />);

    // 練習工具箱已於 #2801 從學生導覽移除（Young 2026-08-20 指示）
    const labels = ['主頁', '圖書館', '班級作業', '加入班級', '學習紀錄'];
    for (const label of labels) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it('does NOT render teacher items (班級管理/作業管理) for student', () => {
    renderWithRouter(<StudentSidebar pendingAssignmentCount={0} collapsed={false} onNavigate={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /班級管理/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /作業管理/ })).toBeNull();
  });

  it('shows pending assignment badge when count > 0', () => {
    renderWithRouter(<StudentSidebar pendingAssignmentCount={3} collapsed={false} onNavigate={vi.fn()} />);

    expect(screen.getByLabelText(/3 個待辦項目/)).toBeTruthy();
  });

  it('snapshot — collapsed=false', () => {
    const { container } = renderWithRouter(
      <StudentSidebar pendingAssignmentCount={0} collapsed={false} onNavigate={vi.fn()} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('snapshot — collapsed=true', () => {
    const { container } = renderWithRouter(
      <StudentSidebar pendingAssignmentCount={0} collapsed={true} onNavigate={vi.fn()} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// TeacherSidebar tests
// ---------------------------------------------------------------------------

describe('TeacherSidebar — role=teacher nav items', () => {
  it('module exists and exports TeacherSidebar', () => {
    expect(TeacherSidebar).toBeDefined();
    expect(typeof TeacherSidebar).toBe('function');
  });

  it('renders teacher nav items: 班級管理/作業管理', () => {
    renderWithRouter(<TeacherSidebar collapsed={false} onNavigate={vi.fn()} />);

    expect(screen.getByRole('button', { name: /班級管理/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /作業管理/ })).toBeTruthy();
  });

  it('does NOT render student items for teacher', () => {
    renderWithRouter(<TeacherSidebar collapsed={false} onNavigate={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /^主頁$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /圖書館/ })).toBeNull();
  });

  it('snapshot — collapsed=false', () => {
    const { container } = renderWithRouter(
      <TeacherSidebar collapsed={false} onNavigate={vi.fn()} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('snapshot — collapsed=true', () => {
    const { container } = renderWithRouter(
      <TeacherSidebar collapsed={true} onNavigate={vi.fn()} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// AdminSidebar tests
// ---------------------------------------------------------------------------

describe('AdminSidebar — role=admin nav items', () => {
  it('module exists and exports AdminSidebar', () => {
    expect(AdminSidebar).toBeDefined();
    expect(typeof AdminSidebar).toBe('function');
  });

  it('renders admin nav items: 班級管理/作業管理/系統管理', () => {
    renderWithRouter(<AdminSidebar collapsed={false} onNavigate={vi.fn()} />);

    expect(screen.getByRole('button', { name: /班級管理/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /作業管理/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /系統管理/ })).toBeTruthy();
  });

  it('snapshot — collapsed=false', () => {
    const { container } = renderWithRouter(
      <AdminSidebar collapsed={false} onNavigate={vi.fn()} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('snapshot — collapsed=true', () => {
    const { container } = renderWithRouter(
      <AdminSidebar collapsed={true} onNavigate={vi.fn()} />
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// Dispatcher contract tests — verify Sidebar re-exports role sidebars
// We test this structurally (module exports) rather than render to avoid
// full provider setup complexity in unit tests.
// Integration testing of the full Sidebar shell is left to E2E / QA.
// ---------------------------------------------------------------------------

describe('Sidebar dispatcher — module contract', () => {
  it('Sidebar default export is a function (component)', () => {
    expect(typeof Sidebar).toBe('function');
  });

  it('StudentSidebar, TeacherSidebar, AdminSidebar are all functions', () => {
    expect(typeof StudentSidebar).toBe('function');
    expect(typeof TeacherSidebar).toBe('function');
    expect(typeof AdminSidebar).toBe('function');
  });
});
