/**
 * Characterization tests for ClassroomDetail refactor — Issue #1943
 *
 * These tests document existing behaviour before the split into:
 *   - ClassroomHeaderCard
 *   - ClassroomTabs
 *   - ClassroomStudentRoster (wired via StudentListTab)
 *   - ClassroomDetail (orchestrator)
 *
 * All tests must pass both before and after the refactor (same observable behaviour).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import ClassroomDetail from '../ClassroomDetail';
import * as classroomApi from '../../../services/classroomApi';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 1, role: 'teacher' } }),
}));

vi.mock('../../../services/classroomApi', () => ({
  getClassroomDetail: vi.fn(),
  updateClassroom: vi.fn(),
  addStudent: vi.fn(),
  removeStudent: vi.fn(),
  exportClassroomReport: vi.fn(),
  regenerateClassroomCode: vi.fn(),
  deleteClassroom: vi.fn(),
  ClassroomApiError: class ClassroomApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ClassroomApiError';
      this.status = status;
    }
  },
}));

vi.mock('../StudentProgressTab', () => ({ default: () => <div data-testid="student-progress-tab" /> }));
vi.mock('../TextManagementTab', () => ({ default: () => <div data-testid="text-management-tab" /> }));
vi.mock('../StudentListTab', () => ({ default: (props: { classroom: { name: string } }) => <div data-testid="student-list-tab" data-classroom={props.classroom?.name} /> }));
vi.mock('../ClassroomAnalytics', () => ({ default: () => <div data-testid="classroom-analytics" /> }));
vi.mock('../CrossTextAnalytics', () => ({ default: () => <div data-testid="cross-text-analytics" /> }));
vi.mock('../../components/teacher/AtRiskStudents', () => ({ default: () => <div data-testid="at-risk-students" /> }));
vi.mock('../ErrorHeatmapTab', () => ({ default: () => <div data-testid="error-heatmap-tab" /> }));
vi.mock('../CoTeachingTab', () => ({ default: () => <div data-testid="co-teaching-tab" /> }));
vi.mock('../panel/TodayOverviewTab', () => ({
  default: ({ onOpenAssignment }: { onOpenAssignment: (id: number) => void }) => (
    <div data-testid="today-overview-tab"><button onClick={() => onOpenAssignment(7)}>查看矩陣</button></div>
  ),
}));
vi.mock('../panel/AssignmentsPanel', () => ({ default: () => <div data-testid="assignments-panel" /> }));
vi.mock('../panel/ClassSwitcher', () => ({ default: () => null }));
vi.mock('../panel/StudentsPanel', () => ({ default: () => <div data-testid="students-panel" /> }));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_CLASSROOM = {
  id: 42,
  name: '三年甲班',
  school_id: 1,
  teacher_id: 1,
  grade: 3,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  student_count: 5,
  students: [],
  join_code: 'ABC123',
  school_name: '測試國小',
};

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.search}</div>;
}

function renderDetail(classroomId = 42, url = `/teacher/classroom/${classroomId}`) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ClassroomDetail classroomId={classroomId} onBack={vi.fn()} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(classroomApi.getClassroomDetail).mockResolvedValue(MOCK_CLASSROOM);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ClassroomDetail (refactor characterization) — render with mock data', () => {
  it('renders classroom name after loading', async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('三年甲班')).toBeInTheDocument();
    });
  });

  it('renders grade badge', async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText('3 年級')).toBeInTheDocument();
    });
  });

  it('renders student count', async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText(/5 位學生/)).toBeInTheDocument();
    });
  });

  it('renders 返回班級列表 back button', async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText(/返回班級列表/)).toBeInTheDocument();
    });
  });

  it('renders join code prominently', async () => {
    renderDetail();
    // getAllByText, not getByText: since #3081 the code appears twice on this
    // page -- once in the header and once inside the QR button, which shows it
    // in large type for students whose tablet cannot scan. Both are the code
    // being displayed prominently, which is what this test is about. Asserting
    // on a single match made a legitimate second display look like a failure.
    await waitFor(() => {
      expect(screen.getAllByText('ABC123').length).toBeGreaterThan(0);
    });
  });

  it('shows loading skeleton while fetching', () => {
    vi.mocked(classroomApi.getClassroomDetail).mockReturnValue(new Promise(() => {})); // never resolves
    renderDetail();
    // Should show animated pulse skeleton, not classroom name
    expect(screen.queryByText('三年甲班')).toBeNull();
  });

  it('shows error state when fetch fails with no classroom loaded', async () => {
    vi.mocked(classroomApi.getClassroomDetail).mockRejectedValue(new Error('Network error'));
    renderDetail();
    await waitFor(() => {
      expect(screen.getByText(/無法載入班級資料/)).toBeInTheDocument();
    });
  });
});

describe('ClassroomDetail — Junyi three-tab layout (#3384)', () => {
  it('opens on 班級設定 by default', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole('tab', { name: '班級設定' })).toHaveAttribute('aria-selected', 'true'));
  });

  it('switching to 指派任務 writes ?tab= so a refresh or class switch keeps it', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => screen.getByRole('tab', { name: '指派任務' }));
    await user.click(screen.getByRole('tab', { name: '指派任務' }));
    expect(screen.getByTestId('assignments-panel')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toContain('tab=assignments');
  });

  it('an old ?tab=progress link lands on the aggregated 班級數據 view', async () => {
    renderDetail(42, '/teacher/classroom/42?tab=progress');
    await waitFor(() => expect(screen.getByTestId('today-overview-tab')).toBeInTheDocument());
  });

  it('學習分析 in 班級數據 shows analytics and cross-text views together', async () => {
    const user = userEvent.setup();
    renderDetail(42, '/teacher/classroom/42?tab=analytics');
    await user.click(await screen.findByRole('button', { name: '學習分析' }));
    expect(screen.getByTestId('classroom-analytics')).toBeInTheDocument();
    expect(screen.getByTestId('cross-text-analytics')).toBeInTheDocument();
  });

  it('協同教師 is reachable under 班級設定', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByTestId('co-teaching-tab')).toBeInTheDocument());
  });

  it('查看矩陣 on 今日總覽 lands on 指派任務 with that assignment open (#3376 audit)', async () => {
    const user = userEvent.setup();
    renderDetail(42, '/teacher/classroom/42?tab=data');
    await user.click(await screen.findByRole('button', { name: '查看矩陣' }));
    const search = screen.getByTestId('location').textContent ?? '';
    expect(search).toContain('tab=assignments');
    expect(search).toContain('assignment=7');
  });

  it('學生總表 shows the student panel while keeping 班級數據 selected', async () => {
    const user = userEvent.setup();
    renderDetail(42, '/teacher/classroom/42?tab=data');
    await user.click(await screen.findByRole('button', { name: '學生總表' }));
    expect(screen.getByTestId('students-panel')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toContain('tab=data');
  });
});

describe('ClassroomDetail (refactor characterization) — join code copy', () => {
  it('clicking 複製代碼 copies join code to clipboard', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => expect(screen.getAllByText('ABC123').length).toBeGreaterThan(0));
      // The header became an accordion (#1943 follow-up): the code panel, and
      // with it the copy and regenerate buttons, only render once the 加入代碼
      // toggle is opened. This characterization test was written when they were
      // always on screen.
      await user.click(screen.getByRole('button', { name: /加入代碼/i }));

    await user.click(screen.getByRole('button', { name: /複製代碼/i }));
    // Read the clipboard rather than spying on writeText: userEvent.setup()
    // installs its own navigator.clipboard stub, which replaces the vi.fn()
    // from beforeEach, so the spy is never the one the component calls. Asking
    // what actually ended up on the clipboard is both closer to what the
    // teacher cares about and immune to that swap.
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe('ABC123');
    });
  });

  it('shows "已複製" feedback after copy', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => expect(screen.getAllByText('ABC123').length).toBeGreaterThan(0));
      // The header became an accordion (#1943 follow-up): the code panel, and
      // with it the copy and regenerate buttons, only render once the 加入代碼
      // toggle is opened. This characterization test was written when they were
      // always on screen.
      await user.click(screen.getByRole('button', { name: /加入代碼/i }));

    await user.click(screen.getByRole('button', { name: /複製代碼/i }));
    await waitFor(() => {
      expect(screen.getByText('已複製')).toBeInTheDocument();
    });
  });

  it('shows confirm dialog before regenerating code', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => expect(screen.getAllByText('ABC123').length).toBeGreaterThan(0));
      // The header became an accordion (#1943 follow-up): the code panel, and
      // with it the copy and regenerate buttons, only render once the 加入代碼
      // toggle is opened. This characterization test was written when they were
      // always on screen.
      await user.click(screen.getByRole('button', { name: /加入代碼/i }));

    await user.click(screen.getByRole('button', { name: /重生代碼/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(classroomApi.regenerateClassroomCode).not.toHaveBeenCalled();
  });

  it('confirming dialog calls regenerateClassroomCode', async () => {
    vi.mocked(classroomApi.regenerateClassroomCode).mockResolvedValue({ join_code: 'XYZ789' });
    vi.mocked(classroomApi.getClassroomDetail)
      .mockResolvedValueOnce(MOCK_CLASSROOM)
      .mockResolvedValueOnce({ ...MOCK_CLASSROOM, join_code: 'XYZ789' });

    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => expect(screen.getAllByText('ABC123').length).toBeGreaterThan(0));
      // The header became an accordion (#1943 follow-up): the code panel, and
      // with it the copy and regenerate buttons, only render once the 加入代碼
      // toggle is opened. This characterization test was written when they were
      // always on screen.
      await user.click(screen.getByRole('button', { name: /加入代碼/i }));

    await user.click(screen.getByRole('button', { name: /重生代碼/i }));
    await user.click(screen.getByRole('button', { name: /確定/i }));

    await waitFor(() => {
      expect(classroomApi.regenerateClassroomCode).toHaveBeenCalledWith('test-token', 42);
    });
    await waitFor(() => {
      expect(screen.getByText('XYZ789')).toBeInTheDocument();
    });
  });
});

describe('ClassroomDetail — student roster in the class header (#3367, collapsed #3376, #3378)', () => {
  it('a class with students starts collapsed, and expands without switching tabs', async () => {
    vi.mocked(classroomApi.getClassroomDetail).mockResolvedValue({
      ...MOCK_CLASSROOM,
      students: [{ id: 5, name: '小明', email: 'a@b.c', enrolled_at: '2026-01-01T00:00:00Z' }],
    } as never);
    const user = userEvent.setup();
    renderDetail();
    const toggle = await screen.findByRole('button', { name: /學生名單（/ });
    expect(screen.queryByTestId('student-list-tab')).toBeNull();
    await user.click(toggle);
    expect(screen.getByTestId('student-list-tab').getAttribute('data-classroom')).toBe('三年甲班');
  });

  it('an empty class opens straight on adding students (均一-style first step)', async () => {
    renderDetail();
    expect(await screen.findByTestId('student-list-tab')).toBeInTheDocument();
  });
});
