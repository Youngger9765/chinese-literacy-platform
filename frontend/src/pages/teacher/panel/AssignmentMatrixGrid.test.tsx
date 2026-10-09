import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssignmentMatrixGrid from './AssignmentMatrixGrid';
import type { AssignmentMatrixResponse } from '../../../services/teacherApi';

const data: AssignmentMatrixResponse = {
  students: [
    { id: 1, name: '王小明' },
    { id: 2, name: '林雨萱' },
    { id: 3, name: '陳柏宇' },
    { id: 4, name: '邱柏丞' },
  ],
  assignments: [{ id: 10, title: '贏得喝采的輸家', due_date: '2026-09-28T00:00:00Z' }],
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

  it('says so when the class has no assignments', () => {
    render(<AssignmentMatrixGrid data={{ ...data, assignments: [], cells: [] }} onOpenAssignment={vi.fn()} />);
    expect(screen.getByText('這個班級還沒有指派作業')).toBeInTheDocument();
  });
});
