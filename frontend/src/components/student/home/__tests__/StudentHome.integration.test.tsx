/**
 * Integration test for the refactored StudentHome orchestrator (Issue #1952)
 *
 * Mocks API calls and verifies the full page renders the correct sub-components.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';

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
vi.mock('../../../../components/student/StudentProgressDashboard', () => ({
  default: () => <div data-testid="progress-dashboard" />,
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

import { fetchMyEnrolledClassrooms } from '../../../../services/learningApi';
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

beforeEach(() => {
  vi.clearAllMocks();
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
});
