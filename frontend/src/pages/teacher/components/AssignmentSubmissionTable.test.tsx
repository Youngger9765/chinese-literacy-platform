import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AssignmentSubmissionTable from './AssignmentSubmissionTable';
import type { SubmissionResponse, StudentAttemptGroup } from '../../../services/assignmentApi';
import * as assignmentApi from '../../../services/assignmentApi';

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 'test-token' }) }));
vi.mock('../../../services/assignmentApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/assignmentApi')>()),
  markSubmissionComplete: vi.fn(),
}));

// AnswerRecordLink (Issue #3682) renders a react-router <Link>.
const render = (ui: React.ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const gradeForm = {
  gradingId: null,
  gradeInput: {},
  feedbackInput: {},
  savingId: null,
  setGradeInput: vi.fn(),
  setFeedbackInput: vi.fn(),
  onGradeClick: vi.fn(),
  onSaveGrade: vi.fn(),
  onCancelGrade: vi.fn(),
};

function makeSubmission(overrides: Partial<SubmissionResponse>): SubmissionResponse {
  return {
    id: 1,
    assignment_id: 1,
    student_id: 1,
    student_name: '王小明',
    status: 'pending',
    submitted_at: null,
    score: null,
    reading_accuracy: null,
    reading_cpm: null,
    reading_error_chars: [],
    teacher_feedback: null,
    session_id: null,
    required_step_count: 0,
    completed_step_count: 0,
    missing_step_ids: [],
    marked_complete_by_teacher: false,
    ...overrides,
  };
}

describe('AssignmentSubmissionTable (#3682)', () => {
  // The bug: a student who is stuck in_progress had every column — score,
  // reading data, feedback, grade, audio — render as a dash, with no way to
  // see anything they've actually answered so far.
  it('an in_progress submission with a session gets a link to its answer record', () => {
    const submissions = [
      makeSubmission({ id: 10, student_id: 2, student_name: '林雨萱', status: 'in_progress', session_id: 999 }),
    ];
    render(
      <AssignmentSubmissionTable
        submissions={submissions}
        groups={[]}
        useGrouped={false}
        gradeForm={gradeForm}
        assignmentId={1}
        onSubmissionUpdated={vi.fn()}
      />,
    );

    const links = screen.getAllByRole('link', { name: '作答紀錄' });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/teacher/students/2/sessions/999/report');
    }
  });

  it('a submission with no session yet (never started) shows no answer-record link', () => {
    const submissions = [
      makeSubmission({ id: 11, student_id: 3, student_name: '陳大文', status: 'pending', session_id: null }),
    ];
    render(
      <AssignmentSubmissionTable
        submissions={submissions}
        groups={[]}
        useGrouped={false}
        gradeForm={gradeForm}
        assignmentId={1}
        onSubmissionUpdated={vi.fn()}
      />,
    );

    expect(screen.getAllByText('陳大文').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: '作答紀錄' })).not.toBeInTheDocument();
  });

  it('a submitted (completed) row still carries its answer-record link alongside the audio button', () => {
    const submissions = [
      makeSubmission({
        id: 12, student_id: 4, student_name: '李小美', status: 'submitted', score: 90, session_id: 500,
      }),
    ];
    render(
      <AssignmentSubmissionTable
        submissions={submissions}
        groups={[]}
        useGrouped={false}
        gradeForm={gradeForm}
        assignmentId={1}
        onSubmissionUpdated={vi.fn()}
      />,
    );

    const links = screen.getAllByRole('link', { name: '作答紀錄' });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/teacher/students/4/sessions/500/report');
    }
  });

  it('adding the 作答紀錄 column keeps the header count, the row cell count, and the expanded-metrics colSpan in sync', async () => {
    // reading_accuracy non-null so the 朗讀數據 expand button renders — this
    // exercises the colSpan path the header-column count must still match.
    const submissions = [makeSubmission({
      id: 13, student_id: 5, status: 'in_progress', session_id: 600, reading_accuracy: 80,
    })];
    render(
      <AssignmentSubmissionTable
        submissions={submissions}
        groups={[]}
        useGrouped={false}
        gradeForm={gradeForm}
        assignmentId={1}
        onSubmissionUpdated={vi.fn()}
      />,
    );
    const table = screen.getByRole('table');
    const headerRow = within(table).getAllByRole('row')[0];
    const headerCells = within(headerRow).getAllByRole('columnheader');
    expect(within(headerRow).getByText('作答紀錄')).toBeInTheDocument();

    const dataRow = within(table).getAllByRole('row')[1];
    const dataCells = within(dataRow).getAllByRole('cell');
    expect(dataCells).toHaveLength(headerCells.length);

    await userEvent.click(within(table).getByRole('button', { name: '查看' }));
    const metricsRow = within(table).getAllByRole('row')[2];
    const metricsCell = within(metricsRow).getByRole('cell');
    expect(metricsCell).toHaveAttribute('colspan', String(headerCells.length));
  });
});

describe('AssignmentSubmissionTable — missing-steps view + teacher mark-complete override (#3723)', () => {
  beforeEach(() => {
    vi.mocked(assignmentApi.markSubmissionComplete).mockReset();
  });

  it('an in_progress submission shows which required steps are still missing', () => {
    const submissions = [
      makeSubmission({
        id: 20, student_id: 6, student_name: '張小華', status: 'in_progress', session_id: 700,
        required_step_count: 8, completed_step_count: 5,
        missing_step_ids: ['spotlight', 'vocab-review', 'knowledge-station'],
      }),
    ];
    render(
      <AssignmentSubmissionTable
        submissions={submissions}
        groups={[]}
        useGrouped={false}
        gradeForm={gradeForm}
        assignmentId={1}
        onSubmissionUpdated={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/完成 5\/8 關/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/閱讀聚光燈、語詞複習、知識補給站/).length).toBeGreaterThan(0);
  });

  it('a pending submission with no steps done yet still shows the full missing list', () => {
    const submissions = [
      makeSubmission({
        id: 21, student_id: 7, student_name: '林小雨', status: 'pending', session_id: null,
        required_step_count: 8, completed_step_count: 0,
        missing_step_ids: ['full-text-annotate', 'key-passage-reading'],
      }),
    ];
    render(
      <AssignmentSubmissionTable
        submissions={submissions}
        groups={[]}
        useGrouped={false}
        gradeForm={gradeForm}
        assignmentId={1}
        onSubmissionUpdated={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/完成 0\/8 關/).length).toBeGreaterThan(0);
  });

  it('a completed submission shows no missing-steps line and no mark-complete button', () => {
    const submissions = [
      makeSubmission({
        id: 22, student_id: 8, student_name: '王大明', status: 'submitted', score: 90, session_id: 800,
        required_step_count: 8, completed_step_count: 8, missing_step_ids: [],
      }),
    ];
    render(
      <AssignmentSubmissionTable
        submissions={submissions}
        groups={[]}
        useGrouped={false}
        gradeForm={gradeForm}
        assignmentId={1}
        onSubmissionUpdated={vi.fn()}
      />,
    );

    expect(screen.queryByText(/完成 \d+\/\d+ 關/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '標記完成' })).not.toBeInTheDocument();
  });

  it('clicking 標記完成 asks for confirmation before calling the API', async () => {
    const submissions = [
      makeSubmission({
        id: 23, student_id: 9, student_name: '陳小芬', status: 'in_progress', session_id: 900,
        required_step_count: 8, completed_step_count: 3, missing_step_ids: ['spotlight'],
      }),
    ];
    render(
      <AssignmentSubmissionTable
        submissions={submissions}
        groups={[]}
        useGrouped={false}
        gradeForm={gradeForm}
        assignmentId={1}
        onSubmissionUpdated={vi.fn()}
      />,
    );

    await userEvent.click(screen.getAllByRole('button', { name: '標記完成' })[0]);
    expect(screen.getAllByText(/確定/).length).toBeGreaterThan(0);
    expect(assignmentApi.markSubmissionComplete).not.toHaveBeenCalled();
  });

  it('confirming calls markSubmissionComplete and reports the updated submission back up', async () => {
    const updated: SubmissionResponse = makeSubmission({
      id: 24, student_id: 10, student_name: '黃小安', status: 'submitted', session_id: 1000,
      required_step_count: 8, completed_step_count: 8, missing_step_ids: [],
      marked_complete_by_teacher: true,
    });
    vi.mocked(assignmentApi.markSubmissionComplete).mockResolvedValue(updated);
    const onSubmissionUpdated = vi.fn();

    const submissions = [
      makeSubmission({
        id: 24, student_id: 10, student_name: '黃小安', status: 'in_progress', session_id: 1000,
        required_step_count: 8, completed_step_count: 3, missing_step_ids: ['spotlight'],
      }),
    ];
    render(
      <AssignmentSubmissionTable
        submissions={submissions}
        groups={[]}
        useGrouped={false}
        gradeForm={gradeForm}
        assignmentId={1}
        onSubmissionUpdated={onSubmissionUpdated}
      />,
    );

    await userEvent.click(screen.getAllByRole('button', { name: '標記完成' })[0]);
    await userEvent.click(screen.getByRole('button', { name: '確定標記' }));

    await waitFor(() => expect(onSubmissionUpdated).toHaveBeenCalledWith(updated));
    expect(assignmentApi.markSubmissionComplete).toHaveBeenCalledWith('test-token', 1, 24);
  });

  it('a submission a teacher already force-completed shows the 老師標記 badge', () => {
    const submissions = [
      makeSubmission({
        id: 25, student_id: 11, student_name: '劉小傑', status: 'submitted', session_id: 1100,
        required_step_count: 8, completed_step_count: 8, missing_step_ids: [],
        marked_complete_by_teacher: true,
      }),
    ];
    render(
      <AssignmentSubmissionTable
        submissions={submissions}
        groups={[]}
        useGrouped={false}
        gradeForm={gradeForm}
        assignmentId={1}
        onSubmissionUpdated={vi.fn()}
      />,
    );

    expect(screen.getAllByText('老師標記').length).toBeGreaterThan(0);
  });
});

describe('AssignmentSubmissionTable — desktop grouped table shows missing steps (#3723)', () => {
  it('the grouped (default desktop) table renders the missing-steps line and the mark-complete action', () => {
    const latest = makeSubmission({
      id: 31, student_id: 9, student_name: '林小安', status: 'in_progress', session_id: 801,
      required_step_count: 8, completed_step_count: 3,
      missing_step_ids: ['spotlight', 'vocab-review'],
    });
    const groups = [{
      student_id: 9, student_name: '林小安', latest_status: 'in_progress', latest_score: null,
      latest_attempt_number: 1, attempts: [{ ...latest, attempt_number: 1 }],
    }] as unknown as StudentAttemptGroup[];
    render(
      <AssignmentSubmissionTable
        submissions={[latest]}
        groups={groups}
        useGrouped={true}
        gradeForm={gradeForm}
        assignmentId={1}
        onSubmissionUpdated={vi.fn()}
      />,
    );
    // Scope to the desktop <table>; the phone cards render the line too and
    // used to hide that the table itself never did.
    const table = screen.getByRole('table');
    expect(within(table).getByText(/完成 3\/8 關/)).toBeTruthy();
    expect(within(table).getByRole('button', { name: '標記完成' })).toBeTruthy();
  });
});
