import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssignmentMatrixGrid, { assignmentCounts, CellBadge, MatrixLegend } from './AssignmentMatrixGrid';
import type { AssignmentMatrixResponse } from '../../../services/teacherApi';

const data: AssignmentMatrixResponse = {
  students: [
    { id: 1, name: '王小明' },
    { id: 2, name: '林雨萱' },
    { id: 3, name: '陳柏宇' },
    { id: 4, name: '邱柏丞' },
  ],
  assignments: [{ id: 10, title: '贏得喝采的輸家', due_date: '2999-09-28T00:00:00Z' }],
  cells: [
    { student_id: 1, assignment_id: 10, state: 'completed', score: 88, current_step: null },
    { student_id: 2, assignment_id: 10, state: 'in_progress', score: null, current_step: 'comprehension' },
    { student_id: 3, assignment_id: 10, state: 'not_started', score: null, current_step: null },
    { student_id: 4, assignment_id: 10, state: 'not_assigned', score: null, current_step: null },
  ],
};

function rowOf(name: string) {
  return screen.getByRole('rowheader', { name }).closest('tr') as HTMLElement;
}

describe('AssignmentMatrixGrid (#3367)', () => {
  it('renders each of the four states distinctly', () => {
    render(<AssignmentMatrixGrid data={data} onOpenAssignment={vi.fn()} />);
    expect(within(rowOf('王小明')).getByText('88')).toBeInTheDocument();
    expect(within(rowOf('林雨萱')).getByText(/進行中/)).toBeInTheDocument();
    expect(within(rowOf('陳柏宇')).getByText('未開始')).toBeInTheDocument();
    expect(within(rowOf('邱柏丞')).getByText('未指派')).toBeInTheDocument();
  });

  it('never shows a number for a student without a score (#3359)', () => {
    render(<AssignmentMatrixGrid data={data} onOpenAssignment={vi.fn()} />);
    for (const name of ['林雨萱', '陳柏宇', '邱柏丞']) {
      expect(within(rowOf(name)).queryByText(/^\d+$/)).not.toBeInTheDocument();
    }
  });

  it('clicking an assignment title opens it', async () => {
    const onOpen = vi.fn();
    render(<AssignmentMatrixGrid data={data} onOpenAssignment={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: '贏得喝采的輸家' }));
    expect(onOpen).toHaveBeenCalledWith(10);
  });

  it('with no assignments yet, says what to do and still lists the students (Junyi parity)', () => {
    render(<AssignmentMatrixGrid data={{ ...data, assignments: [], cells: [] }} onOpenAssignment={vi.fn()} />);
    expect(screen.getByText(/按「建立作業」選一課派給學生/)).toBeInTheDocument();
    const table = screen.getByRole('table', { name: '班級作業總表' });
    for (const s of data.students) expect(within(table).getByText(s.name)).toBeInTheDocument();
  });

  it('with no students, points the teacher to 班級設定', () => {
    render(<AssignmentMatrixGrid data={{ ...data, students: [], cells: [] }} onOpenAssignment={vi.fn()} />);
    expect(screen.getByText(/先到「班級設定」新增學生/)).toBeInTheDocument();
  });

  it('past the due date, unfinished work is red 逾期未交; finished and not-assigned are not', () => {
    const past = { ...data, assignments: [{ ...data.assignments[0], due_date: '2020-01-01T00:00:00Z' }] };
    render(<AssignmentMatrixGrid data={past} onOpenAssignment={vi.fn()} />);
    expect(within(rowOf('林雨萱')).getByText(/逾期未交/)).toBeInTheDocument();
    expect(within(rowOf('陳柏宇')).getByText('逾期未交')).toBeInTheDocument();
    expect(within(rowOf('王小明')).getByText('88')).toBeInTheDocument();
    expect(within(rowOf('邱柏丞')).getByText('未指派')).toBeInTheDocument();
  });

  it('student names open that student when a handler is given', async () => {
    const onStudent = vi.fn();
    render(<AssignmentMatrixGrid data={data} onOpenAssignment={vi.fn()} onOpenStudent={onStudent} />);
    await userEvent.click(screen.getByRole('button', { name: '林雨萱' }));
    expect(onStudent).toHaveBeenCalledWith(2);
  });
});

import { distinctTitles } from './AssignmentMatrixGrid';

describe('distinctTitles (codex screen audit #5)', () => {
  it('numbers repeats in order and leaves unique titles alone', () => {
    const m = distinctTitles([
      { id: 1, title: '贏得喝采的輸家' },
      { id: 2, title: '古詩兩首' },
      { id: 3, title: '贏得喝采的輸家' },
    ]);
    expect(m.get(1)).toBe('贏得喝采的輸家（第 1 次）');
    expect(m.get(2)).toBe('古詩兩首');
    expect(m.get(3)).toBe('贏得喝采的輸家（第 2 次）');
  });
});

// Khan Academy / Junyi show how many handed in right on each assignment; the
// teacher used to count red and green cells by eye.
describe('per-assignment counts', () => {
  it('each assignment header says 已交 N / assigned (not_assigned excluded)', () => {
    render(<AssignmentMatrixGrid data={data} onOpenAssignment={vi.fn()} />);
    expect(screen.getByText('已交 1 / 3')).toBeInTheDocument();
  });

  it('assignmentCounts splits assigned students by state, overdue replacing unfinished', () => {
    expect(assignmentCounts(data.cells, 10, false)).toEqual({
      assigned: 3, submitted: 1, inProgress: 1, notStarted: 1, overdue: 0,
    });
    expect(assignmentCounts(data.cells, 10, true)).toEqual({
      assigned: 3, submitted: 1, inProgress: 0, notStarted: 0, overdue: 2,
    });
  });
});

// Red meant two things: a low score (handed in, < 60) and 逾期未交 (not handed
// in). A teacher scanning for who has not submitted could not tell them apart.
describe('CellBadge colours — red only means 逾期未交', () => {
  const cell = (state: string, score: number | null) =>
    ({ student_id: 1, assignment_id: 10, state, score, current_step: null }) as never;
  const cls = (ui: React.ReactElement) => render(ui).container.firstElementChild!.className;

  it('a handed-in low score is not red', () => {
    expect(cls(<CellBadge cell={cell('completed', 42)} />)).not.toMatch(/red/);
  });
  it('handed in without a score reads as handed in (green), not grey like 未開始', () => {
    expect(cls(<CellBadge cell={cell('completed', null)} />)).toMatch(/green/);
  });
  it('逾期未交 is red', () => {
    expect(cls(<CellBadge cell={cell('not_started', null)} overdue />)).toMatch(/red/);
  });
});

// On 390 the student detail squeezed 「逾期未交」 to 「逾期未／交」 and 「已交」 to
// 「已／交」: every state badge must stay on one line and not shrink.
describe('CellBadge never wraps', () => {
  const cell = (state: string, score: number | null) =>
    ({ student_id: 1, assignment_id: 10, state, score, current_step: null }) as never;
  it.each([
    ['completed with score', cell('completed', 90), false],
    ['completed no score', cell('completed', null), false],
    ['in progress', cell('in_progress', null), false],
    ['not started', cell('not_started', null), false],
    ['overdue', cell('not_started', null), true],
    ['not assigned', cell('not_assigned', null), false],
  ])('%s', (_l, c, overdue) => {
    const el = render(<CellBadge cell={c} overdue={overdue as boolean} />).container.firstElementChild!;
    expect(el.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(el.className).toMatch(/\bshrink-0\b/);
  });
});

// Hans (#3448 C5/C6 manual QA): a student who joins a class AFTER a 全班
// assignment went out still receives it — 未指派 only means the teacher
// picked specific students and this one wasn't on the list. The old wording
// ("派作業時還不在班上" / "作業派出後才加入班級") implied join timing decides
// 未指派, which is wrong and misled Hans during manual QA.
describe('未指派 tooltip does not blame join timing (#3496)', () => {
  it('MatrixLegend explains 未指派 without mentioning when the student joined', () => {
    render(<MatrixLegend />);
    const badge = screen.getByText('未指派');
    const tooltip = badge.closest('[title]')!.getAttribute('title')!;
    expect(tooltip).not.toMatch(/還不在班上/);
    expect(tooltip).not.toMatch(/才加入班級/);
    expect(tooltip).toMatch(/部分學生/);
  });

  it('CellBadge (not_assigned) explains 未指派 without mentioning when the student joined', () => {
    render(<CellBadge cell={{ student_id: 1, assignment_id: 10, state: 'not_assigned', score: null, current_step: null } as never} />);
    const tooltip = screen.getByText('未指派').getAttribute('title')!;
    expect(tooltip).not.toMatch(/還不在班上/);
    expect(tooltip).not.toMatch(/才加入班級/);
    expect(tooltip).toMatch(/部分學生/);
  });
});
