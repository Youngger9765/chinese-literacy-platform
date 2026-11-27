/**
 * Integration test for the refactored StudentHome orchestrator (Issue #1952)
 *
 * Mocks API calls and verifies the full page renders the correct sub-components.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router-dom';

// Mock API modules
vi.mock('../../../../services/learningApi', () => ({
  fetchMyEnrolledClassrooms: vi.fn(),
}));
vi.mock('../../../../services/gamificationApi', () => ({
  fetchGamificationSummary: vi.fn(),
}));
vi.mock('../../../../services/assignmentApi', () => ({
  getMyAssignments: vi.fn(),
}));
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: '小明', role: 'student' },
    token: 'mock-token',
  }),
}));

// Stub heavy sub-components that are not under test here
const dashboardData = vi.hoisted(() => ({
  value: { completed_story_slugs: ['a', 'b'], week_sessions: 3 } as Record<string, unknown> | null,
}));
vi.mock('../../../../components/student/StudentProgressDashboard', async () => {
  const React = await import('react');
  return {
    default: ({ onDashboardLoaded }: { onDashboardLoaded?: (s: string[], d?: unknown) => void }) => {
      React.useEffect(() => {
        if (dashboardData.value) {
          onDashboardLoaded?.(dashboardData.value.completed_story_slugs as string[], dashboardData.value);
        }
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return <div data-testid="progress-dashboard" />;
    },
  };
});
vi.mock('../../../../services/api', async (orig) => ({
  ...(await orig<typeof import('../../../../services/api')>()),
  fetchStory: vi.fn(async () => ({ title: '十秒的背後' })),
}));
vi.mock('../../../../components/student/RecommendedStories', () => ({
  default: () => <div data-testid="recommended-stories" />,
}));
vi.mock('../../../../components/SessionResumePrompt', () => ({
  default: () => null,
}));
vi.mock('../../../../components/gamification/RecentBadgesStrip', () => ({
  default: () => null,
}));
vi.mock('../../../../components/student/QuickPracticeStrip', () => ({
  default: () => <div data-testid="quick-practice-strip" />,
}));

import {
  fetchMyEnrolledClassrooms,
  type StudentEnrolledClassroom,
} from '../../../../services/learningApi';
import { fetchGamificationSummary } from '../../../../services/gamificationApi';
import { getMyAssignments } from '../../../../services/assignmentApi';
import StudentHome from '../../../../pages/student/StudentHome';

const mockClassroom = {
  id: 10,
  name: '五年甲班',
  teacher_name: '陳老師',
  is_active: false, // not active — won't trigger auto-redirect
  code: 'CLS01',
};

const mockAssignment = {
  assignment_id: 1,
  story_id: 'L1',
  text_id: null,
  story_slug: 'l1',
  story_title: '春天來了',
  title: null,
  description: null,
  assignment_type: 'reading',
  due_date: null,
  classroom_name: '五年甲班',
  status: 'pending',
  session_id: null,
  current_step: null,
  steps_completed: [],
  submitted_at: null,
  score: null,
  teacher_feedback: null,
  attempt_number: 1,
  session_mode: 'normal',
  skip_completed_steps: false,
  skipped_steps: [],
  target_cpm: null,
  target_accuracy: null,
  difficulty_label: null,
  effective_cpm: 150,
  effective_accuracy: 90,
};

const mockGamification = {
  student_id: 1,
  total_xp: 100,
  stories_completed: 2,
  level_info: {
    level: 2,
    title: 'Reader',
    current_level_xp: 0,
    next_level_xp: 100,
    total_xp: 100,
    progress_percent: 0,
  },
  streak: { current: 3, longest: 5, last_activity_date: '2026-05-22' },
  badges: [],
  all_badges: [],
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  dashboardData.value = { completed_story_slugs: ['a', 'b'], week_sessions: 3 };
});

describe('StudentHome integration', () => {
  it('renders greeting with student name', async () => {
    vi.mocked(fetchMyEnrolledClassrooms).mockResolvedValue({ classrooms: [mockClassroom] });
    vi.mocked(fetchGamificationSummary).mockResolvedValue(mockGamification);
    vi.mocked(getMyAssignments).mockResolvedValue([mockAssignment]);

    render(
      <MemoryRouter>
        <StudentHome />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('你好，小明！')).toBeTruthy();
    });
  });

  it('renders today assignment title when assignment exists', async () => {
    vi.mocked(fetchMyEnrolledClassrooms).mockResolvedValue({ classrooms: [mockClassroom] });
    vi.mocked(fetchGamificationSummary).mockResolvedValue(mockGamification);
    vi.mocked(getMyAssignments).mockResolvedValue([mockAssignment]);

    render(
      <MemoryRouter>
        <StudentHome />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('春天來了')).toBeTruthy();
    });
  });

  it('renders QuickPracticeStrip', async () => {
    vi.mocked(fetchMyEnrolledClassrooms).mockResolvedValue({ classrooms: [mockClassroom] });
    vi.mocked(fetchGamificationSummary).mockResolvedValue(mockGamification);
    vi.mocked(getMyAssignments).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <StudentHome />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('quick-practice-strip')).toBeTruthy();
    });
  });

  it('shows NoClassroomWaitingScreen when no classrooms', async () => {
    vi.mocked(fetchMyEnrolledClassrooms).mockResolvedValue({ classrooms: [] });
    vi.mocked(fetchGamificationSummary).mockResolvedValue(mockGamification);
    vi.mocked(getMyAssignments).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <StudentHome />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/你的老師還沒有把你加入班級/)).toBeTruthy();
    });
  });

  it('renders 班級作業 tile', async () => {
    vi.mocked(fetchMyEnrolledClassrooms).mockResolvedValue({ classrooms: [mockClassroom] });
    vi.mocked(fetchGamificationSummary).mockResolvedValue(mockGamification);
    vi.mocked(getMyAssignments).mockResolvedValue([mockAssignment]);

    render(
      <MemoryRouter>
        <StudentHome />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('班級作業')).toBeTruthy();
    });
  });

  it('renders XP pill when gamification is loaded', async () => {
    vi.mocked(fetchMyEnrolledClassrooms).mockResolvedValue({ classrooms: [mockClassroom] });
    vi.mocked(fetchGamificationSummary).mockResolvedValue(mockGamification);
    vi.mocked(getMyAssignments).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <StudentHome />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Lv.2')).toBeTruthy();
    });
  });

  it('只有一個進行中的班級也留在首頁，不再自動跳去課文庫（#4159）', async () => {
    vi.mocked(fetchMyEnrolledClassrooms).mockResolvedValue({ classrooms: [{ ...mockClassroom, is_active: true }] });
    vi.mocked(fetchGamificationSummary).mockResolvedValue(mockGamification);
    vi.mocked(getMyAssignments).mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={['/student']}>
        <LocationProbe />
        <StudentHome />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('你好，小明！')).toBeTruthy());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByTestId('location').textContent).toBe('/student');
  });

  it('招呼語下一行：已完成 N 課、這週讀了 M 次', async () => {
    vi.mocked(fetchMyEnrolledClassrooms).mockResolvedValue({ classrooms: [mockClassroom] });
    vi.mocked(fetchGamificationSummary).mockResolvedValue(mockGamification);
    vi.mocked(getMyAssignments).mockResolvedValue([]);
    render(<MemoryRouter><StudentHome /></MemoryRouter>);
    expect(await screen.findByText(/已完成 2 課/)).toBeTruthy();
    expect(screen.getByText(/這週讀了 3 次/)).toBeTruthy();
  });

  it('資料還沒回來時，招呼語維持原本那句，不顯示 0 課', async () => {
    dashboardData.value = null;
    vi.mocked(fetchMyEnrolledClassrooms).mockResolvedValue({ classrooms: [mockClassroom] });
    vi.mocked(fetchGamificationSummary).mockResolvedValue(mockGamification);
    vi.mocked(getMyAssignments).mockResolvedValue([]);
    render(<MemoryRouter><StudentHome /></MemoryRouter>);
    await screen.findByText('你好，小明！');
    expect(screen.queryByText(/已完成 0 課/)).toBeNull();
    expect(screen.getByText('今天想探索什麼故事呢？')).toBeTruthy();
  });

  it('有進行中的課：首屏「接著做」卡顯示課名與第 N 關，一鍵進入；不再同時顯示作業大卡', async () => {
    const { resolveActiveSteps } = await import('../../../../config/stepConfig');
    const act3 = resolveActiveSteps()[2];
    localStorage.setItem('lingoleap-active-session-1', JSON.stringify({
      sessionId: 1, storyId: '20011', currentStep: act3.dbStepNumber, timestamp: Date.now() - 1000,
    }));
    vi.mocked(fetchMyEnrolledClassrooms).mockResolvedValue({ classrooms: [mockClassroom] });
    vi.mocked(fetchGamificationSummary).mockResolvedValue(mockGamification);
    vi.mocked(getMyAssignments).mockResolvedValue([mockAssignment]);
    render(
      <MemoryRouter initialEntries={['/student']}>
        <LocationProbe />
        <StudentHome />
      </MemoryRouter>,
    );
    const card = await screen.findByTestId('continue-card');
    expect(card.textContent).toContain('十秒的背後');
    expect(card.textContent).toContain('第 3 關');
    expect(screen.queryByText('春天來了')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /接著做/ }));
    expect(screen.getByTestId('location').textContent).toBe(`/learn/20011/${act3.id}`);
  });

  it('進行中的紀錄已過期：不顯示接著做，改顯示老師指派的下一課', async () => {
    localStorage.setItem('lingoleap-active-session-1', JSON.stringify({
      sessionId: 1, storyId: '20011', currentStep: (await import('../../../../config/stepConfig')).resolveActiveSteps()[2].dbStepNumber,
      timestamp: Date.now() - 9 * 24 * 3600 * 1000,
    }));
    vi.mocked(fetchMyEnrolledClassrooms).mockResolvedValue({ classrooms: [mockClassroom] });
    vi.mocked(fetchGamificationSummary).mockResolvedValue(mockGamification);
    vi.mocked(getMyAssignments).mockResolvedValue([mockAssignment]);
    render(<MemoryRouter><StudentHome /></MemoryRouter>);
    expect(await screen.findByText('春天來了')).toBeTruthy();
    expect(screen.queryByTestId('continue-card')).toBeNull();
  });

  it('關數依這一課自己的關卡順序算，不是全站預設', async () => {
    const { resolveActiveSteps, DEFAULT_STEP_SEQUENCE } = await import('../../../../config/stepConfig');
    const seq = DEFAULT_STEP_SEQUENCE.slice(0, 6);
    const step = resolveActiveSteps(seq)[1];
    localStorage.setItem('lingoleap-active-session-1', JSON.stringify({
      sessionId: 1, storyId: '20011', currentStep: step.dbStepNumber, timestamp: Date.now() - 1000,
    }));
    const api = await import('../../../../services/api');
    vi.mocked(api.fetchStory).mockResolvedValueOnce({ title: '短課', stepSequence: seq } as never);
    vi.mocked(fetchMyEnrolledClassrooms).mockResolvedValue({ classrooms: [mockClassroom] });
    vi.mocked(fetchGamificationSummary).mockResolvedValue(mockGamification);
    vi.mocked(getMyAssignments).mockResolvedValue([]);
    render(<MemoryRouter><StudentHome /></MemoryRouter>);
    const card = await screen.findByTestId('continue-card');
    expect(card.textContent).toContain(`共 ${resolveActiveSteps(seq).length} 關`);
    expect(card.textContent).not.toContain(`共 ${resolveActiveSteps().length} 關`);
  });

  it('進行中的課剛好是未完成作業：顯示作業卡（走作業流程），不顯示接著做', async () => {
    const { resolveActiveSteps } = await import('../../../../config/stepConfig');
    localStorage.setItem('lingoleap-active-session-1', JSON.stringify({
      sessionId: 1, storyId: 'L1', currentStep: resolveActiveSteps()[2].dbStepNumber, timestamp: Date.now() - 1000,
    }));
    vi.mocked(fetchMyEnrolledClassrooms).mockResolvedValue({ classrooms: [mockClassroom] });
    vi.mocked(fetchGamificationSummary).mockResolvedValue(mockGamification);
    vi.mocked(getMyAssignments).mockResolvedValue([mockAssignment]);
    render(<MemoryRouter><StudentHome /></MemoryRouter>);
    expect(await screen.findByText('春天來了')).toBeTruthy();
    expect(screen.queryByTestId('continue-card')).toBeNull();
  });

  it('老師自傳課文的作業（只有 text_id、story_id 為空）也算作業流程，不顯示接著做', async () => {
    const { resolveActiveSteps } = await import('../../../../config/stepConfig');
    localStorage.setItem('lingoleap-active-session-1', JSON.stringify({
      sessionId: 1, storyId: '9', currentStep: resolveActiveSteps()[2].dbStepNumber, timestamp: Date.now() - 1000,
    }));
    vi.mocked(fetchMyEnrolledClassrooms).mockResolvedValue({ classrooms: [mockClassroom] });
    vi.mocked(fetchGamificationSummary).mockResolvedValue(mockGamification);
    vi.mocked(getMyAssignments).mockResolvedValue([{ ...mockAssignment, story_id: null, text_id: 9 } as never]);
    render(<MemoryRouter><StudentHome /></MemoryRouter>);
    expect((await screen.findAllByText('春天來了')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('continue-card')).toBeNull();
  });

  it('完全沒有紀錄也沒有作業：顯示「選一課開始」，點了去課文庫（帶班級）', async () => {
    vi.mocked(fetchMyEnrolledClassrooms).mockResolvedValue({ classrooms: [mockClassroom] });
    vi.mocked(fetchGamificationSummary).mockResolvedValue(mockGamification);
    vi.mocked(getMyAssignments).mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={['/student']}>
        <LocationProbe />
        <StudentHome />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /選一課開始/ }));
    expect(screen.getByTestId('location').textContent).toBe('/library?classroom=10');
    expect(screen.queryByTestId('continue-card')).toBeNull();
  });
});
