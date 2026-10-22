import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { StudentAssignmentResponse } from '../../../services/assignmentApi';

/**
 * Regression tests for Issue #3697 (originally reported as #3682).
 *
 * Production symptom: a student who had actually finished 8 of their
 * assignment's steps saw "學習關卡進度 0/11" or "1/11" on their assignment
 * card. Root cause: the card computed its progress count against the
 * GLOBAL default step list (`ACTIVE_STEPS` = resolveActiveSteps() with no
 * step_sequence) for every assignment, regardless of which lesson it
 * actually used. A multi-part lesson's own step_sequence uses round-keyed
 * ids for repeated steps (`key-passage-reading#4uee3`, #2916/#2930) that
 * have no match in that global list, so most of `steps_completed` never
 * counted, AND the denominator (11) included two cover steps
 * ('lesson-intro', 'report') that can never be marked complete.
 *
 * This fixture reproduces the exact "1/11" shape: a 3-required-step custom
 * sequence where one of them is round-keyed, 2 of the 3 actually done.
 * Before the fix this card would show "1/11" (only the one plain-id step
 * matched the 11-item global list; the round-keyed one and the smaller
 * correct denominator were both wrong). After the fix it must show "2/3".
 */

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateSpy,
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 't', user: { id: 7, name: '丙' } }),
}));

// vi.mock(...) below is hoisted above this file's top-level const
// declarations, so the fixture it references must be created inside
// vi.hoisted (same pattern as useStepProgressPersistence.autoSubmitFlag.test.ts).
const { multiPartAssignment } = vi.hoisted(() => ({
  multiPartAssignment: {
    assignment_id: 501,
    story_id: '9001',
    text_id: null,
    story_slug: '9001',
    story_title: '一課多篇測試課',
    title: null,
    description: null,
    assignment_type: 'reading',
    due_date: null,
    classroom_name: '三年甲班',
    status: 'in_progress',
    session_id: 4242,
    current_step: 'comprehension',
    // Custom per-lesson sequence (#1374 mechanism) with a round-keyed step —
    // the exact shape _step_sequence_for() produces for a multi-part lesson.
    step_sequence: ['lesson-intro', 'full-text-annotate', 'key-passage-reading#4uee3', 'comprehension', 'report'],
    steps_completed: ['full-text-annotate', 'key-passage-reading#4uee3'],
    submitted_at: null,
    score: null,
    teacher_feedback: null,
    target_cpm: null,
    target_accuracy: null,
    difficulty_label: null,
    effective_cpm: 120,
    effective_accuracy: 90,
    attempt_number: 1,
    session_mode: 'assignment',
    skip_completed_steps: false,
    skipped_steps: [],
  } satisfies StudentAssignmentResponse,
}));

vi.mock('../../../services/assignmentApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/assignmentApi')>()),
  getMyAssignments: vi.fn().mockResolvedValue([multiPartAssignment]),
  startAssignment: vi.fn(),
}));
vi.mock('../../../services/learningApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/learningApi')>()),
  fetchMyEnrolledClassrooms: vi.fn().mockResolvedValue({ classrooms: [], total: 0 }),
}));

import MyAssignments from '../MyAssignments';

describe('MyAssignments — progress count for a multi-part lesson (#3697)', () => {
  it('shows 2/3 (matches the required-step list), not 1/11 (the global-default-list bug)', async () => {
    render(
      <MemoryRouter>
        <MyAssignments />
      </MemoryRouter>,
    );

    const progressText = await screen.findByText(
      (_content, element) => element?.tagName.toLowerCase() === 'p' && element.textContent === '2/3',
    );
    expect(progressText).toBeInTheDocument();

    // The old bug's exact shape must not appear anywhere on the card.
    expect(screen.queryByText('1/11')).not.toBeInTheDocument();
    expect(screen.queryByText('0/11')).not.toBeInTheDocument();
  });
});
