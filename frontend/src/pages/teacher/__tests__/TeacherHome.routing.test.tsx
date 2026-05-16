/**
 * Issue #1545 — TeacherHome routing tests
 *
 * Verifies that the 查看報告 quick-action card navigates to /teacher
 * with state { intent: 'reports' } so TeacherDashboard can show the
 * "選擇班級以查看報告" banner.
 *
 * Regression guard: 管理班級 and 建立作業 must navigate to /teacher
 * WITHOUT the reports intent flag.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    // useLocation is NOT mocked here — we use MemoryRouter initialEntries to control it
  };
});

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: '李老師' },
    token: 'test-token',
  }),
}));

vi.mock('../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeSchoolId: null,
    hasMultipleSchools: false,
    teacherSchoolIds: [],
    studentSchoolIds: [],
    activeView: 'teacher',
    setActiveView: vi.fn(),
    setActiveSchoolId: vi.fn(),
    availableViews: ['teacher'],
  }),
}));

vi.mock('../../../services/classroomApi', () => ({
  listMyClassrooms: vi.fn().mockResolvedValue({
    items: [
      { id: 1, name: '三年甲班', grade: 3, student_count: 20, school_id: 1, teacher_id: 1, is_active: true, created_at: '2026-01-01T00:00:00Z' },
      { id: 2, name: '五年乙班', grade: 5, student_count: 25, school_id: 1, teacher_id: 1, is_active: true, created_at: '2026-01-02T00:00:00Z' },
    ],
    total: 2,
  }),
}));

import TeacherHome from '../TeacherHome';

// ── Helper ───────────────────────────────────────────────────────────────────

function renderTeacherHome() {
  return render(
    <MemoryRouter initialEntries={['/teacher-home']}>
      <TeacherHome />
    </MemoryRouter>
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TeacherHome — 查看報告 routing (issue #1545)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the 查看報告 quick-action card', async () => {
    renderTeacherHome();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /查看報告/i })).toBeInTheDocument();
    });
  });

  it('navigates to /teacher with intent:"reports" when 查看報告 is clicked', async () => {
    renderTeacherHome();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /查看報告/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /查看報告/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/teacher', { state: { intent: 'reports' } });
  });

  it('navigates to /teacher WITHOUT intent state when 管理班級 is clicked', async () => {
    renderTeacherHome();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /管理班級/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /管理班級/i }));

    // Should navigate to /teacher but NOT with intent:'reports'
    expect(mockNavigate).toHaveBeenCalledWith('/teacher');
    expect(mockNavigate).not.toHaveBeenCalledWith('/teacher', { state: { intent: 'reports' } });
  });

  it('classroom list items navigate to /teacher/classroom/:id', async () => {
    renderTeacherHome();

    // Wait for classrooms to load
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /前往 三年甲班/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /前往 三年甲班/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/teacher/classroom/1');
  });
});

describe('TeacherDashboard — reports banner (issue #1545)', () => {
  it('renders reports-intent banner when location.state.intent is "reports"', async () => {
    const { default: TeacherDashboard } = await import('../TeacherDashboard');
    const mockOnSelectClassroom = vi.fn();

    // Use MemoryRouter with initial state containing intent:'reports'
    const { container } = render(
      <MemoryRouter
        initialEntries={[{ pathname: '/teacher', state: { intent: 'reports' } }]}
      >
        <TeacherDashboard onSelectClassroom={mockOnSelectClassroom} />
      </MemoryRouter>
    );

    await waitFor(() => {
      // Banner should appear with text indicating report-selection mode
      const banner = container.querySelector('[data-testid="reports-intent-banner"]');
      expect(banner).toBeInTheDocument();
      expect(banner?.textContent).toMatch(/選擇班級以查看報告/);
    });
  });

  it('does NOT render reports-intent banner when navigating without intent state', async () => {
    const { default: TeacherDashboard } = await import('../TeacherDashboard');
    const mockOnSelectClassroom = vi.fn();

    const { container } = render(
      <MemoryRouter initialEntries={[{ pathname: '/teacher', state: null }]}>
        <TeacherDashboard onSelectClassroom={mockOnSelectClassroom} />
      </MemoryRouter>
    );

    await waitFor(() => {
      const banner = container.querySelector('[data-testid="reports-intent-banner"]');
      expect(banner).not.toBeInTheDocument();
    });
  });
});
