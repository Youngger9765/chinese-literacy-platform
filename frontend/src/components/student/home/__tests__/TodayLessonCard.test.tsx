/**
 * TDD tests for TodayLessonCard (Issue #1952)
 *
 * Covers:
 * - BookJacketHero: renders assignment title, classroom, CTA button label
 * - ClassroomFallbackHero: renders classroom name + teacher when no assignment
 * - NoClassroomWaitingScreen: shown when student not in any classroom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

// These imports will FAIL initially (RED phase) — components don't exist yet
import {
  BookJacketHero,
  ClassroomFallbackHero,
  NoClassroomWaitingScreen,
} from '../TodayLessonCard';
import type { StudentAssignmentResponse } from '../../../../services/assignmentApi';
import type { StudentEnrolledClassroom } from '../../../../services/learningApi';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockAssignmentPending: StudentAssignmentResponse = {
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

const mockAssignmentInProgress: StudentAssignmentResponse = {
  ...mockAssignmentPending,
  status: 'in_progress',
  current_step: 'paragraph-reading',
};

const mockClassroom: StudentEnrolledClassroom = {
  id: 10,
  name: '六年乙班',
  teacher_name: '林老師',
  is_active: true,
  code: 'CLS01',
};

// ---------------------------------------------------------------------------
// BookJacketHero
// ---------------------------------------------------------------------------

describe('BookJacketHero', () => {
  it('renders story title', () => {
    render(
      <BrowserRouter>
        <BookJacketHero assignment={mockAssignmentPending} onContinue={vi.fn()} />
      </BrowserRouter>,
    );
    expect(screen.getByText('春天來了')).toBeTruthy();
  });

  it('renders classroom name', () => {
    render(
      <BrowserRouter>
        <BookJacketHero assignment={mockAssignmentPending} onContinue={vi.fn()} />
      </BrowserRouter>,
    );
    expect(screen.getByText('五年甲班')).toBeTruthy();
  });

  it('shows "開始閱讀" CTA when status is pending', () => {
    render(
      <BrowserRouter>
        <BookJacketHero assignment={mockAssignmentPending} onContinue={vi.fn()} />
      </BrowserRouter>,
    );
    expect(screen.getByText('開始閱讀')).toBeTruthy();
  });

  it('shows "繼續閱讀" CTA when status is in_progress', () => {
    render(
      <BrowserRouter>
        <BookJacketHero assignment={mockAssignmentInProgress} onContinue={vi.fn()} />
      </BrowserRouter>,
    );
    expect(screen.getByText('繼續閱讀')).toBeTruthy();
  });

  it('calls onContinue when CTA is clicked', () => {
    const onContinue = vi.fn();
    render(
      <BrowserRouter>
        <BookJacketHero assignment={mockAssignmentPending} onContinue={onContinue} />
      </BrowserRouter>,
    );
    fireEvent.click(screen.getByText('開始閱讀'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('shows "上次讀到" badge when in_progress with current_step', () => {
    render(
      <BrowserRouter>
        <BookJacketHero assignment={mockAssignmentInProgress} onContinue={vi.fn()} />
      </BrowserRouter>,
    );
    expect(screen.getByText('上次讀到')).toBeTruthy();
  });

  it('does not show "上次讀到" badge when pending', () => {
    render(
      <BrowserRouter>
        <BookJacketHero assignment={mockAssignmentPending} onContinue={vi.fn()} />
      </BrowserRouter>,
    );
    expect(screen.queryByText('上次讀到')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ClassroomFallbackHero
// ---------------------------------------------------------------------------

describe('ClassroomFallbackHero', () => {
  it('renders classroom name', () => {
    render(
      <BrowserRouter>
        <ClassroomFallbackHero classroom={mockClassroom} onClick={vi.fn()} />
      </BrowserRouter>,
    );
    expect(screen.getByText('六年乙班')).toBeTruthy();
  });

  it('renders teacher name', () => {
    render(
      <BrowserRouter>
        <ClassroomFallbackHero classroom={mockClassroom} onClick={vi.fn()} />
      </BrowserRouter>,
    );
    expect(screen.getByText(/林老師/)).toBeTruthy();
  });

  it('calls onClick when button is clicked', () => {
    const onClick = vi.fn();
    render(
      <BrowserRouter>
        <ClassroomFallbackHero classroom={mockClassroom} onClick={onClick} />
      </BrowserRouter>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// NoClassroomWaitingScreen
// ---------------------------------------------------------------------------

describe('NoClassroomWaitingScreen', () => {
  it('renders greeting with firstName', () => {
    render(<NoClassroomWaitingScreen firstName="小明" />);
    expect(screen.getByText('你好，小明！')).toBeTruthy();
  });

  it('shows the waiting message', () => {
    render(<NoClassroomWaitingScreen firstName="小明" />);
    expect(screen.getByText(/你的老師還沒有把你加入班級/)).toBeTruthy();
  });
});
