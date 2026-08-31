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

function renderDetail(classroomId = 42) {
  return render(<ClassroomDetail classroomId={classroomId} onBack={vi.fn()} />);
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
    await waitFor(() => {
      expect(screen.getAllByText('ABC123')[0]).toBeInTheDocument();
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

describe('ClassroomDetail (refactor characterization) — tab switching', () => {
  it('renders progress tab by default', async () => {
    renderDetail();
    await waitFor(() => {
      expect(screen.getByTestId('student-progress-tab')).toBeInTheDocument();
    });
  });

  it('switches to 課文管理 tab on click', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => screen.getByText('課文管理'));

    await user.click(screen.getByRole('button', { name: '課文管理' }));
    expect(screen.getByTestId('text-management-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('student-progress-tab')).toBeNull();
  });

  it('switches to 學生名單 tab on click', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => screen.getByText('學生名單'));

    await user.click(screen.getByRole('button', { name: '學生名單' }));
    expect(screen.getByTestId('student-list-tab')).toBeInTheDocument();
  });

  it('switches to 學習分析 tab on click', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => screen.getByText('學習分析'));

    await user.click(screen.getByRole('button', { name: '學習分析' }));
    expect(screen.getByTestId('classroom-analytics')).toBeInTheDocument();
  });

  it('switches to 協同教師 tab on click', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => screen.getByText('協同教師'));

    await user.click(screen.getByRole('button', { name: '協同教師' }));
    expect(screen.getByTestId('co-teaching-tab')).toBeInTheDocument();
  });

  it('renders all 8 tab labels', async () => {
    renderDetail();
    await waitFor(() => screen.getByText('學生進度'));

    const tabLabels = ['學生進度', '學生名單', '課文管理', '學習分析', '跨課文分析', '早期介入', '錯字熱力圖', '協同教師'];
    for (const label of tabLabels) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });
});

describe('ClassroomDetail (refactor characterization) — join code copy', () => {
  it('clicking 複製代碼 copies join code to clipboard', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => screen.getAllByText('ABC123')[0]);

    await user.click(screen.getByRole('button', { name: /複製代碼/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABC123');
  });

  it('shows "已複製" feedback after copy', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => screen.getAllByText('ABC123')[0]);

    await user.click(screen.getByRole('button', { name: /複製代碼/i }));
    await waitFor(() => {
      expect(screen.getByText('已複製')).toBeInTheDocument();
    });
  });

  it('shows confirm dialog before regenerating code', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => screen.getAllByText('ABC123')[0]);

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
    await waitFor(() => screen.getAllByText('ABC123')[0]);

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

describe('ClassroomDetail (refactor characterization) — student roster via StudentListTab', () => {
  it('passes classroom prop to StudentListTab', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => screen.getByText('學生名單'));

    await user.click(screen.getByRole('button', { name: '學生名單' }));
    const listTab = screen.getByTestId('student-list-tab');
    expect(listTab).toBeInTheDocument();
    // ClassroomHeaderCard passes classroom name down
    expect(listTab.getAttribute('data-classroom')).toBe('三年甲班');
  });
});
