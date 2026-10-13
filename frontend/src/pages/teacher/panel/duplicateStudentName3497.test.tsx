/**
 * #3497 (Hans B5) — a class can hold two students with the same name, and the
 * assignment grid showed both as 「陳柏宇」 with no way to tell them apart.
 * Creating one is still allowed; the teacher is warned, and the grid adds the
 * login account after a name that appears twice.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddStudentsPanel, { duplicateNames } from './AddStudentsPanel';
import AssignmentMatrixGrid from './AssignmentMatrixGrid';

const base = {
  token: 't', classroomId: 9, classroomName: '四年甲班', joinCode: 'SRJDV', nextSeat: 6,
  onCreated: vi.fn(), addByIdForm: <div>by-id</div>, onOpenCsv: vi.fn(),
};

describe('#3497 duplicate student names', () => {
  it('finds repeats against the class and within the pasted roster', () => {
    const parsed = [{ name: '陳柏宇', seat_number: '6' }, { name: '吳冠廷', seat_number: '7' }, { name: '吳冠廷', seat_number: '8' }];
    expect(duplicateNames(parsed, ['王小明', '陳柏宇'])).toEqual(['陳柏宇', '吳冠廷']);
    expect(duplicateNames(parsed.slice(0, 1), ['王小明'])).toEqual([]);
  });

  it('warns before creating a same-name student but still allows it', async () => {
    render(<AddStudentsPanel {...base} existingNames={['王小明', '陳柏宇']} />);
    await userEvent.type(screen.getByLabelText(/一行一位學生/), '陳柏宇');
    expect(screen.getByRole('status').textContent).toContain('陳柏宇');
    expect(screen.getByRole('button', { name: /建立 1 個學生帳號/ })).toBeEnabled();
  });

  it('no warning for a new name', async () => {
    render(<AddStudentsPanel {...base} existingNames={['王小明', '陳柏宇']} />);
    await userEvent.type(screen.getByLabelText(/一行一位學生/), '林雨萱');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('the grid adds the account after a repeated name only', () => {
    const data = {
      students: [
        { id: 1, name: '陳柏宇', account: 'srjdv53' },
        { id: 2, name: '王小明', account: 'srjdv51' },
        { id: 3, name: '陳柏宇', account: 'srjdv56' },
      ],
      assignments: [{ id: 10, title: '作業', story_id: 's', due_date: null, is_active: true }],
      cells: [],
    } as never;
    render(<AssignmentMatrixGrid data={data} onOpenAssignment={vi.fn()} />);
    const rows = screen.getAllByRole('rowheader').map((r) => r.textContent);
    expect(rows).toEqual(['陳柏宇（srjdv53）', '王小明', '陳柏宇（srjdv56）']);
  });
});
