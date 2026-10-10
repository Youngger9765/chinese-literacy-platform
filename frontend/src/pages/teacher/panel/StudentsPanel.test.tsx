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

  it('opened from one assignment shows only that assignment, with a way back to it', async () => {
    vi.mocked(api.getStudentAssignments).mockResolvedValue({
      student_id: 1, student_name: '王小明',
      rows: [
        { assignment_id: 10, title: '甲', due_date: null, state: 'completed', score: 80, current_step: null, reading_accuracy: 96, comprehension: null, vocab: null, error_chars: [] },
        { assignment_id: 11, title: '乙', due_date: null, state: 'completed', score: 70, current_step: null, reading_accuracy: 90, comprehension: null, vocab: null, error_chars: [] },
      ],
    });
    const { StudentDetail } = await import('./StudentsPanel');
    render(<StudentDetail classroomId={9} studentId={1} onlyAssignmentId={11} backLabel="← 回「乙」" onBack={vi.fn()} />);
    expect(await screen.findByRole('button', { name: '← 回「乙」' })).toBeInTheDocument();
    expect(screen.queryAllByText('甲')).toHaveLength(0);
    expect(screen.getAllByText('乙').length).toBeGreaterThan(0);
  });

  it('when no part was recorded anywhere, says so instead of columns of dashes', async () => {
    vi.mocked(api.getStudentAssignments).mockResolvedValue({
      student_id: 1, student_name: '王小明',
      rows: [{ assignment_id: 10, title: '甲', due_date: null, state: 'completed', score: null, current_step: null, reading_accuracy: null, comprehension: null, vocab: null, error_chars: [] }],
    });
    const { StudentDetail } = await import('./StudentsPanel');
    render(<StudentDetail classroomId={9} studentId={1} onBack={vi.fn()} />);
    expect(await screen.findByText(/沒有記錄到朗讀、理解、生字的分項成績/)).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '朗讀' })).not.toBeInTheDocument();
  });
});
