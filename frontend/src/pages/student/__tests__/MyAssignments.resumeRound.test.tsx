/**
 * TDD test for #3682 fix C (part 2) — "班級作業→繼續" must carry the round
 * query param (`?p=`) for a multi-passage lesson.
 *
 * Production evidence (scratchpad/teacher-audit/recheck-prod.log, case (b)):
 *   落地網址 /learn/20017/comprehension        ← missing ?p=
 *   必做 id=comprehension#pjhxh；伺服器 done 含它：false
 *
 * getResumeStepPath() builds the resume URL from `a.current_step`. Even once
 * current_step is correctly stored WITH its round (fix C part 1), this test
 * locks the OTHER half: getResumeStepPath's own stepIdSet membership check
 * (`stepIdSet.has(a.current_step)`) was built from the GLOBAL bare-id-only
 * ACTIVE_STEPS list, so a composite id like 'comprehension#pjhxh' would
 * NEVER match it and the function would silently fall back to
 * defaultStepPath (step 1) instead of preserving the round — a different,
 * equally bad regression (resuming sends the student back to the start).
 *
 * Must be RED on the parent commit, GREEN after.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { StudentAssignmentResponse } from '../../../services/assignmentApi';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateSpy,
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't', user: { id: 1, name: '丙' } }) }));

const IN_PROGRESS_MULTI_PASSAGE_ASSIGNMENT = vi.hoisted(
  (): StudentAssignmentResponse => ({
    assignment_id: 69,
    story_id: '20017',
    text_id: 20017,
    story_slug: null,
    story_title: '測試課文',
    title: null,
    description: null,
    assignment_type: 'reading',
    due_date: null,
    classroom_name: '測試班',
    status: 'in_progress',
    session_id: 555,
    // The REAL production shape once fix C part 1 lands: current_step carries
    // its round slug, exactly like steps_completed entries already do.
    current_step: 'comprehension#pjhxh',
    steps_completed: ['full-text-annotate#qeqwt', 'key-passage-reading#h6xnk'],
    submitted_at: null,
    score: null,
    teacher_feedback: null,
    attempt_number: 1,
    session_mode: 'assignment',
    skip_completed_steps: false,
    skipped_steps: [],
    target_cpm: null,
    target_accuracy: null,
    difficulty_label: null,
    effective_cpm: 100,
    effective_accuracy: 90,
  }),
);

vi.mock('../../../services/assignmentApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/assignmentApi')>()),
  getMyAssignments: vi.fn().mockResolvedValue([IN_PROGRESS_MULTI_PASSAGE_ASSIGNMENT]),
  startAssignment: vi.fn(),
}));
vi.mock('../../../services/learningApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/learningApi')>()),
  fetchMyEnrolledClassrooms: vi.fn().mockResolvedValue({ classrooms: [], total: 0 }),
}));

import MyAssignments from '../MyAssignments';

describe('MyAssignments — 繼續 preserves the round query param (#3682 fix C)', () => {
  it('navigates to a URL with ?p=<round>, not a bare step path that drops the round', async () => {
    render(
      <MemoryRouter>
        <MyAssignments />
      </MemoryRouter>,
    );
    const resumeBtn = await screen.findByRole('button', { name: '繼續' });
    await userEvent.click(resumeBtn);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const destination = navigateSpy.mock.calls[0][0] as string;
    expect(destination).toBe('/learn/20017/comprehension?p=pjhxh');
  });

  it('falls back to the default step when the stored round slug has an unexpected shape', async () => {
    const { getMyAssignments } = await import('../../../services/assignmentApi');
    vi.mocked(getMyAssignments).mockResolvedValueOnce([
      { ...IN_PROGRESS_MULTI_PASSAGE_ASSIGNMENT, current_step: 'comprehension#../../admin?x=1' },
    ]);
    navigateSpy.mockClear();
    render(
      <MemoryRouter>
        <MyAssignments />
      </MemoryRouter>,
    );
    const resumeBtn = await screen.findByRole('button', { name: '繼續' });
    await userEvent.click(resumeBtn);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const destination = navigateSpy.mock.calls[0][0] as string;
    expect(destination).not.toContain('admin');
    expect(destination).not.toContain('comprehension');
  });
});
