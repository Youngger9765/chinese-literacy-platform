import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StudentsPanel, { summarizeStudents } from './StudentsPanel';
import * as api from '../../../services/teacherApi';

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));

const matrix: api.AssignmentMatrixResponse = {
  students: [{ id: 1, name: '王小明' }, { id: 2, name: '林雨萱' }],
  assignments: [{ id: 10, title: '甲', due_date: null }, { id: 11, title: '乙', due_date: null }],
  cells: [
    { student_id: 1, assignment_id: 10, state: 'completed', score: 80, current_step: null },
    { student_id: 1, assignment_id: 11, state: 'completed', score: 91, current_step: null },
    { student_id: 2, assignment_id: 10, state: 'in_progress', score: null, current_step: null },
    { student_id: 2, assignment_id: 11, state: 'not_assigned', score: null, current_step: null },
  ],
};

describe('學生分頁 (#3376)', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getAssignmentMatrix').mockResolvedValue(matrix);
    vi.spyOn(api, 'getStudentAssignments').mockResolvedValue({
      student_id: 1,
      student_name: '王小明',
      rows: [{
        assignment_id: 10, title: '甲', due_date: null, state: 'completed', score: 80, current_step: null,
        reading_accuracy: 96, comprehension: null, vocab: 80, error_chars: ['喝', '采'],
      }],
    });
  });

  it('summarizes submitted / assigned and the average, ignoring not-assigned', () => {
    expect(summarizeStudents(matrix)).toEqual([
      { id: 1, name: '王小明', submitted: 2, assigned: 2, average: 86 },
      { id: 2, name: '林雨萱', submitted: 0, assigned: 1, average: null },
    ]);
  });

  it('clicking a name asks to open that student', async () => {
    const onSelect = vi.fn();
    render(<StudentsPanel classroomId={9} selectedStudentId={null} onSelectStudent={onSelect} />);
    await userEvent.click(await screen.findByRole('button', { name: '王小明' }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('one student shows the characters they misread and dashes for missing parts', async () => {
    render(<StudentsPanel classroomId={9} selectedStudentId={1} onSelectStudent={vi.fn()} />);
    // shown in the phone cards and the desktop table (CSS picks one)
    expect((await screen.findAllByText('喝采')).length).toBeGreaterThan(0);
    const row = screen.getByRole('row', { name: /甲/ });
    expect(row).toHaveTextContent('96');
    expect(row).toHaveTextContent('—');
  });
});
