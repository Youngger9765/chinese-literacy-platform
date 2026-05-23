/**
 * Characterization tests for CrossTextAnalytics refactor — Issue #1951
 *
 * Documents existing behaviour before splitting into:
 *   - useCrossTextData (data fetching hook)
 *   - CrossTextFilterBar (view mode toggle)
 *   - CrossTextChartGrid (chart sub-components)
 *   - CrossTextAnalytics (orchestrator)
 *
 * All tests must pass both before and after the refactor (same observable behaviour).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CrossTextAnalytics from '../CrossTextAnalytics';
import * as teacherApi from '../../../services/teacherApi';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

vi.mock('../../../services/teacherApi', () => ({
  getCrossTextAnalysis: vi.fn(),
  TeacherApiError: class TeacherApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'TeacherApiError';
      this.status = status;
    }
  },
}));

// recharts uses ResizeObserver — stub it
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockStudentPattern: teacherApi.StudentCrossTextPattern = {
  student_id: 1,
  student_name: '王小明',
  total_texts_attempted: 3,
  total_sessions: 5,
  overall_avg_score: 78,
  score_trend: [
    { date: '2026-04-01', score: 70, story_slug: 'L1', title: '課文一' },
    { date: '2026-04-08', score: 78, story_slug: 'L2', title: '課文二' },
  ],
  text_performance: [
    {
      story_slug: 'L1',
      story_title: '課文一',
      attempt_count: 2,
      avg_score: 70,
      avg_accuracy: 85,
      avg_comprehension_score: 75,
    } as teacherApi.TextPerformanceSummary,
  ],
  repeated_error_chars: [{ char: '歡', story_count: 2, error_count: 4 } as teacherApi.RepeatedErrorChar],
  strong_texts: [],
  weak_texts: ['L1'],
};

const mockClassData: teacherApi.ClassroomCrossTextPattern = {
  classroom_id: 10,
  classroom_name: '三年甲班',
  total_students: 2,
  total_sessions: 10,
  text_difficulty_ranking: [
    { story_slug: 'L1', title: '課文一', avg_score: 65, attempt_count: 5 },
  ],
  class_score_trend: [
    { date: '2026-04-01', avg_score: 72 },
    { date: '2026-04-08', avg_score: 78 },
  ],
  common_error_chars: [{ char: '歡', student_count: 2, total_errors: 6 }],
  student_patterns: [mockStudentPattern],
};

const emptyData: teacherApi.ClassroomCrossTextPattern = {
  ...mockClassData,
  total_sessions: 0,
  student_patterns: [],
};

// ── Helper ────────────────────────────────────────────────────────────────────

function renderComponent(classroomId = 10) {
  return render(<CrossTextAnalytics classroomId={classroomId} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CrossTextAnalytics — loading / error / empty states', () => {
  it('shows skeleton while loading', () => {
    vi.mocked(teacherApi.getCrossTextAnalysis).mockReturnValue(new Promise(() => {}));
    renderComponent();
    // Three pulse divs rendered as skeleton
    const pulses = document.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThanOrEqual(1);
  });

  it('shows error message and retry button on API failure', async () => {
    vi.mocked(teacherApi.getCrossTextAnalysis).mockRejectedValue(new Error('network error'));
    renderComponent();
    await waitFor(() => expect(screen.getByText(/無法載入跨課文分析資料/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '重試' })).toBeInTheDocument();
  });

  it('shows empty state when total_sessions is 0', async () => {
    vi.mocked(teacherApi.getCrossTextAnalysis).mockResolvedValue(emptyData);
    renderComponent();
    await waitFor(() => expect(screen.getByText('尚無學習記錄')).toBeInTheDocument());
  });
});

describe('CrossTextAnalytics — class overview (default view)', () => {
  beforeEach(() => {
    vi.mocked(teacherApi.getCrossTextAnalysis).mockResolvedValue(mockClassData);
  });

  it('renders summary stat cards', async () => {
    renderComponent();
    await waitFor(() => expect(screen.getByText('學生人數')).toBeInTheDocument());
    expect(screen.getByText('總學習次數')).toBeInTheDocument();
    expect(screen.getByText('已練習課文數')).toBeInTheDocument();
    expect(screen.getByText('最新班級均分')).toBeInTheDocument();
  });

  it('shows class overview by default (班級總覽 button active)', async () => {
    renderComponent();
    await waitFor(() => expect(screen.getByText('班級總覽')).toBeInTheDocument());
    // The "班級總覽" button should be in active (indigo) state
    const classBtn = screen.getByRole('button', { name: '班級總覽' });
    expect(classBtn.className).toContain('bg-indigo-600');
  });

  it('renders 班級整體分數趨勢 section when trend has data', async () => {
    renderComponent();
    await waitFor(() => expect(screen.getByText('班級整體分數趨勢')).toBeInTheDocument());
  });

  it('renders 課文難易排行 section', async () => {
    renderComponent();
    await waitFor(() => expect(screen.getByText('課文難易排行')).toBeInTheDocument());
  });

  it('renders 班級常見錯字 section with char', async () => {
    renderComponent();
    await waitFor(() => expect(screen.getByText('班級常見錯字（多人共同出錯）')).toBeInTheDocument());
    expect(screen.getByText('歡')).toBeInTheDocument();
  });
});

describe('CrossTextAnalytics — view mode toggle (FilterBar behaviour)', () => {
  beforeEach(() => {
    vi.mocked(teacherApi.getCrossTextAnalysis).mockResolvedValue(mockClassData);
  });

  it('switches to individual student view on click', async () => {
    const user = userEvent.setup();
    renderComponent();
    await waitFor(() => expect(screen.getByRole('button', { name: '個別學生' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '個別學生' }));

    // Student selector list should be visible
    expect(screen.getByText('學生列表')).toBeInTheDocument();
    expect(screen.getByText('王小明')).toBeInTheDocument();
  });

  it('switches back to class view on click', async () => {
    const user = userEvent.setup();
    renderComponent();
    await waitFor(() => expect(screen.getByRole('button', { name: '個別學生' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '個別學生' }));
    await user.click(screen.getByRole('button', { name: '班級總覽' }));

    expect(screen.getByText('班級整體分數趨勢')).toBeInTheDocument();
  });

  it('auto-selects first student and shows their details', async () => {
    renderComponent();
    // Switch to student view
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole('button', { name: '個別學生' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '個別學生' }));

    // First student selected — heading visible
    await waitFor(() =>
      expect(screen.getByText('王小明 的跨課文學習模式')).toBeInTheDocument()
    );
  });
});

describe('CrossTextAnalytics — student detail panel', () => {
  beforeEach(() => {
    vi.mocked(teacherApi.getCrossTextAnalysis).mockResolvedValue(mockClassData);
  });

  it('shows student stat cards in detail panel', async () => {
    const user = userEvent.setup();
    renderComponent();
    await waitFor(() => expect(screen.getByRole('button', { name: '個別學生' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '個別學生' }));

    await waitFor(() => expect(screen.getByText('已嘗試課文')).toBeInTheDocument());
    expect(screen.getByText('學習次數')).toBeInTheDocument();
    expect(screen.getByText('平均分')).toBeInTheDocument();
    expect(screen.getByText('強項課文')).toBeInTheDocument();
  });

  it('shows 跨課文反覆錯誤字 section with char', async () => {
    const user = userEvent.setup();
    renderComponent();
    await waitFor(() => expect(screen.getByRole('button', { name: '個別學生' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '個別學生' }));

    await waitFor(() =>
      expect(screen.getByText('跨課文反覆錯誤字（出現於 2 篇以上）')).toBeInTheDocument()
    );
  });

  it('shows ScoreBadge in performance table', async () => {
    const user = userEvent.setup();
    renderComponent();
    await waitFor(() => expect(screen.getByRole('button', { name: '個別學生' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '個別學生' }));

    // text_performance has one row with avg_score 70 — ScoreBadge renders it
    await waitFor(() => expect(screen.getAllByText('70').length).toBeGreaterThanOrEqual(1));
  });
});

describe('CrossTextAnalytics — TeacherApiError handling', () => {
  it('shows the API error message from TeacherApiError', async () => {
    const { TeacherApiError } = await import('../../../services/teacherApi');
    vi.mocked(teacherApi.getCrossTextAnalysis).mockRejectedValue(
      new TeacherApiError('伺服器錯誤', 500)
    );
    renderComponent();
    await waitFor(() => expect(screen.getByText('伺服器錯誤')).toBeInTheDocument());
  });
});
