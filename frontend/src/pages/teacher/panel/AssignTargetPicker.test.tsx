import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AssignTargetPicker from './AssignTargetPicker';
import * as classroomApi from '../../../services/classroomApi';

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));

describe('AssignTargetPicker (#3378)', () => {
  beforeEach(() => {
    vi.spyOn(classroomApi, 'getClassroomDetail').mockResolvedValue({
      id: 9, name: '四甲', school_id: 1, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 2,
      students: [
        { id: 1, name: '王小明', email: '', enrolled_at: '' },
        { id: 2, name: '林雨萱', email: '', enrolled_at: '' },
      ],
    } as never);
    vi.spyOn(classroomApi, 'listMyClassrooms').mockResolvedValue({
      items: [
        { id: 9, name: '四甲', school_id: 1, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 2 },
        { id: 10, name: '四乙', school_id: 1, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 3 },
      ],
      total: 2,
    });
  });

  it('部分學生 then ticking a student reports their id', async () => {
    const onStudentIds = vi.fn();
    const { rerender } = render(
      <AssignTargetPicker classroomId={9} studentIds={null} onStudentIds={onStudentIds} extraClassIds={[]} onExtraClassIds={vi.fn()} />,
    );
    await userEvent.click(screen.getByLabelText('部分學生'));
    expect(onStudentIds).toHaveBeenLastCalledWith([]);
    rerender(<AssignTargetPicker classroomId={9} studentIds={[]} onStudentIds={onStudentIds} extraClassIds={[]} onExtraClassIds={vi.fn()} />);
    await userEvent.click(await screen.findByLabelText('林雨萱'));
    expect(onStudentIds).toHaveBeenLastCalledWith([2]);
  });

  it('lists only the teacher’s other classes for 同時派給其他班', async () => {
    const onExtra = vi.fn();
    render(<AssignTargetPicker classroomId={9} studentIds={null} onStudentIds={vi.fn()} extraClassIds={[]} onExtraClassIds={onExtra} />);
    await userEvent.click(await screen.findByLabelText('四乙'));
    expect(onExtra).toHaveBeenCalledWith([10]);
    expect(screen.queryByLabelText('四甲')).not.toBeInTheDocument();
  });
});
