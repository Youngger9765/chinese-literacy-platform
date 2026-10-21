import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AssignmentSubmissionTable from './AssignmentSubmissionTable';
import type { SubmissionResponse } from '../../../services/assignmentApi';

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
