import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAssignments } from '../useAssignments';
import * as api from '../../../../services/assignmentApi';
import type {
  AssignmentResponse,
  AssignmentDetailResponse,
  SubmissionResponse,
  AttemptResponse,
  StudentAttemptGroup,
} from '../../../../services/assignmentApi';

vi.mock('../../../../services/assignmentApi', async (orig) => ({
  ...(await orig<typeof import('../../../../services/assignmentApi')>()),
  getClassroomAssignments: vi.fn(),
  getAssignmentDetail: vi.fn(),
}));

vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('../../../../services/api', () => ({ fetchStories: vi.fn().mockResolvedValue([]) }));

function makeAttempt(overrides: Partial<AttemptResponse> = {}): AttemptResponse {
  return {
    id: 1,
    attempt_number: 1,
    status: 'in_progress',
    submitted_at: null,
    score: null,
    reading_accuracy: null,
    reading_cpm: null,
    reading_error_chars: [],
    teacher_feedback: null,
    session_id: 100,
    required_step_count: 8,
    completed_step_count: 3,
    missing_step_ids: ['spotlight'],
    marked_complete_by_teacher: false,
    ...overrides,
  };
}

function makeSubmission(overrides: Partial<SubmissionResponse> = {}): SubmissionResponse {
  return {
    id: 1,
    assignment_id: 10,
    student_id: 1,
    student_name: '王小明',
    status: 'in_progress',
    submitted_at: null,
    score: null,
    reading_accuracy: null,
    reading_cpm: null,
    reading_error_chars: [],
    teacher_feedback: null,
    session_id: 100,
    required_step_count: 8,
    completed_step_count: 3,
    missing_step_ids: ['spotlight'],
    marked_complete_by_teacher: false,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<StudentAttemptGroup> = {}): StudentAttemptGroup {
  return {
    student_id: 1,
    student_name: '王小明',
    latest_status: 'in_progress',
    latest_score: null,
    latest_attempt_number: 1,
    attempts: [makeAttempt()],
    ...overrides,
  };
}

const existingAssignment = {
  id: 10,
  is_active: true,
  due_date: null,
  completed_count: 0,
} as unknown as AssignmentResponse;

function makeDetail(overrides: Partial<AssignmentDetailResponse> = {}): AssignmentDetailResponse {
  return {
    id: 10,
    classroom_id: 1,
    teacher_id: 1,
    story_id: 'L1',
    text_id: null,
    story_title: 'x',
    title: null,
    description: null,
    assignment_type: 'reading',
    due_date: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    assigned_student_count: 1,
    submitted_student_count: 0,
    total_attempts: 1,
    submission_count: 1,
    completed_count: 0,
    target_cpm: null,
    target_accuracy: null,
    difficulty_label: null,
    effective_cpm: 150,
    effective_accuracy: 90,
    skip_completed_steps: false,
    submissions: [makeSubmission()],
    submissions_by_student: [makeGroup()],
    ...overrides,
  } as AssignmentDetailResponse;
}

describe('useAssignments handleGraded patches submissions_by_student too', () => {
  beforeEach(() => {
    vi.mocked(api.getClassroomAssignments).mockReset();
    vi.mocked(api.getAssignmentDetail).mockReset();
  });

  it('after an update, the grouped attempt (desktop table source) reflects the new status/score -- not just the flat submissions array', async () => {
    vi.mocked(api.getClassroomAssignments).mockResolvedValue({ items: [existingAssignment] } as never);
    vi.mocked(api.getAssignmentDetail).mockResolvedValue(makeDetail() as never);

    const { result } = renderHook(() => useAssignments(9));
    await waitFor(() => expect(result.current.assignments).toHaveLength(1));

    await act(async () => {
      await result.current.handleExpand(10);
    });
    await waitFor(() => expect(result.current.expandedDetail).not.toBeNull());

    const updated = makeSubmission({
      status: 'submitted',
      submitted_at: '2026-10-23T00:00:00Z',
      completed_step_count: 8,
      missing_step_ids: [],
      marked_complete_by_teacher: true,
    });

    act(() => {
      result.current.handleGraded(updated);
    });

    const group = result.current.expandedDetail!.submissions_by_student[0];
    expect(group.attempts[0].status).toBe('submitted');
    expect(group.attempts[0].marked_complete_by_teacher).toBe(true);
    expect(group.latest_status).toBe('submitted');

    const flat = result.current.expandedDetail!.submissions[0];
    expect(flat.status).toBe('submitted');
  });

  it('does not touch a group belonging to a different student', async () => {
    vi.mocked(api.getClassroomAssignments).mockResolvedValue({ items: [existingAssignment] } as never);
    vi.mocked(api.getAssignmentDetail).mockResolvedValue(
      makeDetail({
        submissions: [makeSubmission({ id: 1 }), makeSubmission({ id: 2, student_id: 2, student_name: '林雨萱' })],
        submissions_by_student: [
          makeGroup({ student_id: 1 }),
          makeGroup({ student_id: 2, student_name: '林雨萱', attempts: [makeAttempt({ id: 2 })] }),
        ],
      }) as never,
    );

    const { result } = renderHook(() => useAssignments(9));
    await waitFor(() => expect(result.current.assignments).toHaveLength(1));
    await act(async () => {
      await result.current.handleExpand(10);
    });
    await waitFor(() => expect(result.current.expandedDetail).not.toBeNull());

    act(() => {
      result.current.handleGraded(makeSubmission({ id: 1, status: 'submitted' }));
    });

    const untouchedGroup = result.current.expandedDetail!.submissions_by_student.find(
      (g) => g.student_id === 2,
    )!;
    expect(untouchedGroup.attempts[0].status).toBe('in_progress');
  });
});
