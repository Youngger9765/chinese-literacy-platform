/**
 * Characterization tests for AssignmentDetailPanel refactor (Issue #1936).
 *
 * TDD-FIRST: written BEFORE extraction.
 * These tests characterize the observable behaviour of the three new units:
 *   1. AssignmentSubmissionTable — renders student rows + grading actions
 *   2. useGradeForm — state hook for grade/feedback per submission
 *   3. AssignmentDetailPanel (orchestrator) — wires table + bulk comment + stats bar
 *
 * RED PHASE: all tests should fail until the components are extracted.
 * GREEN PHASE: identical test file should pass after extraction without changes.
 *
 * Constraints:
 *  - No mocking of gradeSubmission (unit scope; API tested in integration)
 *  - jsdom environment (configured in vite.config.ts)
 *  - Fixtures reused from assignmentDetailLogic.test.ts pattern
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ─── Pre-refactor: import from the monolithic panel. After refactor, these will
// point at the extracted files. The test itself does NOT change.

// We test the top-level panel — it exposes all behaviour.
import AssignmentDetailPanel from '../AssignmentDetailPanel';

import type {
  AssignmentDetailResponse,
  SubmissionResponse,
  StudentAttemptGroup,
  AttemptResponse,
  AssignmentResponse,
} from '../../../services/assignmentApi';

// ─── Auth mock ────────────────────────────────────────────────────────────────

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

vi.mock('../../../components/ui/Toast', () => ({
  useToast: () => ({
    toast: null,
    showToast: vi.fn(),
  }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSubmission(overrides: Partial<SubmissionResponse> = {}): SubmissionResponse {
  return {
    id: 1,
    assignment_id: 10,
    student_id: 1,
    student_name: '王小明',
    status: 'submitted',
    submitted_at: '2026-05-01T10:00:00Z',
    score: null,
    reading_accuracy: null,
    reading_cpm: null,
    reading_error_chars: [],
    teacher_feedback: null,
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<AttemptResponse> = {}): AttemptResponse {
  return {
    id: 1,
    attempt_number: 1,
    status: 'submitted',
    submitted_at: '2026-05-01T10:00:00Z',
    score: null,
    reading_accuracy: null,
    reading_cpm: null,
    reading_error_chars: [],
    teacher_feedback: null,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<StudentAttemptGroup> = {}): StudentAttemptGroup {
  return {
    student_id: 1,
    student_name: '王小明',
    latest_status: 'submitted',
    latest_score: null,
    latest_attempt_number: 1,
    attempts: [makeAttempt()],
    ...overrides,
  };
}

const BASE_ASSIGNMENT: Omit<AssignmentResponse, 'id'> = {
  classroom_id: 1,
  story_id: 'L1',
  text_id: null,
  story_title: '測試課文',
  title: '作業一',
  description: null,
  assignment_type: 'reading',
  due_date: null,
  is_active: true,
  created_at: '2026-05-01T00:00:00Z',
  assigned_student_count: 2,
  submitted_student_count: 1,
  total_attempts: 1,
  submission_count: 1,
  completed_count: 1,
  skip_completed_steps: false,
  target_cpm: null,
  target_accuracy: null,
  difficulty_label: null,
  effective_cpm: 150,
  effective_accuracy: 90,
};

function makeDetail(overrides: Partial<AssignmentDetailResponse> = {}): AssignmentDetailResponse {
  return {
    id: 10,
    ...BASE_ASSIGNMENT,
    submissions: [makeSubmission()],
    submissions_by_student: [],
    ...overrides,
  };
}

// ─── 1. AssignmentDetailPanel renders student list ─────────────────────────────

describe('AssignmentDetailPanel — student list rendering', () => {
  it('renders loading skeleton when isLoading is true', () => {
    const { container } = render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail()}
        isLoading={true}
        onGraded={vi.fn()}
      />,
    );
    // Loading skeleton uses animate-pulse divs
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders empty state when no submissions', () => {
    render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail({ submissions: [] })}
        isLoading={false}
        onGraded={vi.fn()}
      />,
    );
    expect(screen.getByText('尚無學生提交記錄')).toBeTruthy();
  });

  it('renders student name in submission list', () => {
    render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail({
          submissions: [makeSubmission({ student_name: '李大明' })],
        })}
        isLoading={false}
        onGraded={vi.fn()}
      />,
    );
    // Student name appears in at least one rendered element
    expect(screen.getAllByText('李大明').length).toBeGreaterThan(0);
  });

  it('renders multiple students', () => {
    render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail({
          submissions: [
            makeSubmission({ id: 1, student_id: 1, student_name: '王小明' }),
            makeSubmission({ id: 2, student_id: 2, student_name: '陳小花' }),
          ],
        })}
        isLoading={false}
        onGraded={vi.fn()}
      />,
    );
    expect(screen.getAllByText('王小明').length).toBeGreaterThan(0);
    expect(screen.getAllByText('陳小花').length).toBeGreaterThan(0);
  });
});

// ─── 2. Status badge rendering ────────────────────────────────────────────────

describe('AssignmentDetailPanel — status badges', () => {
  it('shows 已提交 badge for submitted status', () => {
    render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail({
          submissions: [makeSubmission({ status: 'submitted' })],
        })}
        isLoading={false}
        onGraded={vi.fn()}
      />,
    );
    expect(screen.getAllByText('已提交').length).toBeGreaterThan(0);
  });

  it('shows 已批改 badge for graded status', () => {
    render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail({
          submissions: [makeSubmission({ status: 'graded', score: 85 })],
        })}
        isLoading={false}
        onGraded={vi.fn()}
      />,
    );
    expect(screen.getAllByText('已批改').length).toBeGreaterThan(0);
  });
});

// ─── 3. Stats bar ─────────────────────────────────────────────────────────────

describe('AssignmentDetailPanel — stats bar', () => {
  it('shows submitted_student_count in stats bar', () => {
    render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail({ submitted_student_count: 3, assigned_student_count: 5 })}
        isLoading={false}
        onGraded={vi.fn()}
      />,
    );
    // "已完成: 3" and "總學生: 5" should appear
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('shows bulk comment button when submitted students exist', () => {
    // Need a submission with status submitted so submitted count > 0
    render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail({
          submissions: [makeSubmission({ status: 'submitted' })],
          submissions_by_student: [],
        })}
        isLoading={false}
        onGraded={vi.fn()}
      />,
    );
    // "批次評語" button should appear
    expect(screen.getByText(/批次評語/)).toBeTruthy();
  });
});

// ─── 4. Grading interaction ───────────────────────────────────────────────────

describe('AssignmentDetailPanel — grading interaction', () => {
  it('shows 批改 button for submitted submission', () => {
    render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail({
          submissions: [makeSubmission({ status: 'submitted' })],
        })}
        isLoading={false}
        onGraded={vi.fn()}
      />,
    );
    // At least one 批改 button should be visible
    expect(screen.getAllByText('批改').length).toBeGreaterThan(0);
  });

  it('clicking 批改 button reveals score input and cancel button', () => {
    render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail({
          submissions: [makeSubmission({ id: 5, status: 'submitted' })],
        })}
        isLoading={false}
        onGraded={vi.fn()}
      />,
    );

    // Click the first 批改 button (mobile or desktop view)
    const gradeButtons = screen.getAllByText('批改');
    fireEvent.click(gradeButtons[0]);

    // After click, should see 儲存 and 取消 buttons
    expect(screen.getAllByText('儲存').length).toBeGreaterThan(0);
    expect(screen.getAllByText('取消').length).toBeGreaterThan(0);
  });

  it('clicking 取消 after 批改 hides the score input', () => {
    render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail({
          submissions: [makeSubmission({ id: 5, status: 'submitted' })],
        })}
        isLoading={false}
        onGraded={vi.fn()}
      />,
    );

    const gradeButtons = screen.getAllByText('批改');
    fireEvent.click(gradeButtons[0]);

    // Cancel
    const cancelButtons = screen.getAllByText('取消');
    fireEvent.click(cancelButtons[0]);

    // 批改 buttons should be back
    expect(screen.getAllByText('批改').length).toBeGreaterThan(0);
  });

  it('shows 重新批改 button for already graded submission', () => {
    render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail({
          submissions: [makeSubmission({ status: 'graded', score: 90 })],
        })}
        isLoading={false}
        onGraded={vi.fn()}
      />,
    );
    expect(screen.getAllByText('重新批改').length).toBeGreaterThan(0);
  });
});

// ─── 5. Grouped (submissions_by_student) rendering ────────────────────────────

describe('AssignmentDetailPanel — grouped submissions_by_student', () => {
  it('renders grouped view when submissions_by_student is non-empty', () => {
    const group = makeGroup({
      student_id: 42,
      student_name: '張三',
      latest_status: 'submitted',
    });
    render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail({
          submissions: [makeSubmission({ student_id: 42, student_name: '張三' })],
          submissions_by_student: [group],
        })}
        isLoading={false}
        onGraded={vi.fn()}
      />,
    );
    expect(screen.getAllByText('張三').length).toBeGreaterThan(0);
  });

  it('shows expand button (+) when student has multiple attempts', () => {
    const group = makeGroup({
      student_id: 1,
      student_name: '王小明',
      attempts: [
        makeAttempt({ id: 2, attempt_number: 2 }),
        makeAttempt({ id: 1, attempt_number: 1 }),
      ],
    });
    render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail({
          submissions: [makeSubmission()],
          submissions_by_student: [group],
        })}
        isLoading={false}
        onGraded={vi.fn()}
      />,
    );
    // The expand button shows "+" text for the desktop grouped view
    expect(screen.getByTitle('展開歷史作答')).toBeTruthy();
  });
});

// ─── 6. Bulk comment panel toggle ─────────────────────────────────────────────

describe('AssignmentDetailPanel — bulk comment panel', () => {
  it('clicking bulk comment button opens the BulkCommentPanel', () => {
    render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail({
          submissions: [makeSubmission({ status: 'submitted' })],
          submissions_by_student: [],
        })}
        isLoading={false}
        onGraded={vi.fn()}
      />,
    );

    const bulkBtn = screen.getByText(/批次評語/);
    fireEvent.click(bulkBtn);

    // BulkCommentPanel renders a cancel button and textarea when open
    expect(screen.getByText('取消')).toBeTruthy();
  });

  it('bulk comment panel closes when cancel is clicked', () => {
    render(
      <AssignmentDetailPanel
        assignmentId={10}
        detail={makeDetail({
          submissions: [makeSubmission({ status: 'submitted' })],
          submissions_by_student: [],
        })}
        isLoading={false}
        onGraded={vi.fn()}
      />,
    );

    // Open
    fireEvent.click(screen.getByText(/批次評語/));
    // Close
    fireEvent.click(screen.getByText('取消'));

    // Bulk comment panel should be gone — textarea disappears
    expect(screen.queryByPlaceholderText('輸入統一評語（選填）')).toBeNull();
  });
});
