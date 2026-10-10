import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TodayOverviewTab, { buildAssignmentProgress, countPending } from './TodayOverviewTab';
import * as api from '../../../services/teacherApi';

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('../LiveMonitorTab', () => ({
  default: ({ classroomId }: { classroomId: number }) => <div>LiveMonitor:{classroomId}</div>,
}));

const now = new Date('2026-10-09T10:00:00');
const matrix: api.AssignmentMatrixResponse = {
  students: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }],
  assignments: [
    { id: 1, title: '未來', due_date: '2026-10-16T00:00:00' },
    { id: 2, title: '逾期', due_date: '2026-09-28T00:00:00' },
    { id: 3, title: '今天', due_date: '2026-10-09T23:00:00' },
    { id: 4, title: '無期限', due_date: null },
  ],
  cells: [
    { student_id: 1, assignment_id: 2, state: 'completed', score: 90, current_step: null },
    { student_id: 2, assignment_id: 2, state: 'not_started', score: null, current_step: null },
    { student_id: 3, assignment_id: 2, state: 'not_assigned', score: null, current_step: null },
    { student_id: 1, assignment_id: 3, state: 'in_progress', score: null, current_step: null },
    { student_id: 2, assignment_id: 3, state: 'completed', score: 70, current_step: null },
    { student_id: 3, assignment_id: 3, state: 'not_started', score: null, current_step: null },
  ],
};

describe('今日總覽 helpers (#3367)', () => {
  it('orders overdue, due today, upcoming, then no due date', () => {
    expect(buildAssignmentProgress(matrix, now).map((r) => r.title)).toEqual(['逾期', '今天', '未來', '無期限']);
  });

  it('counts only students still owing overdue / due-today work, ignoring not-assigned', () => {
    const rows = buildAssignmentProgress(matrix, now);
    expect(rows[0]).toMatchObject({ submitted: 1, assigned: 2 });
    expect(countPending(rows)).toBe(1 + 2);
  });
});

describe('TodayOverviewTab (#3367)', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getAssignmentMatrix').mockResolvedValue(matrix);
    vi.spyOn(api, 'getAtRiskStudents').mockResolvedValue([]);
    vi.spyOn(api, 'getClassroomLiveMonitor').mockResolvedValue({
      classroom_id: 9, generated_at: '', tracked_exercise_types: [], students: [],
    });
  });

  it('keeps 課堂即時 reachable as a card that opens the live view (#3025)', async () => {
    render(<TodayOverviewTab classroomId={9} onOpenAssignment={vi.fn()} onOpenAtRisk={vi.fn()} />);
    expect(screen.queryByText('LiveMonitor:9')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByText(/課堂即時・點開看詳情/));
    expect(screen.getByText('LiveMonitor:9')).toBeInTheDocument();
  });

  it('查看 opens that assignment', async () => {
    const onOpen = vi.fn();
    render(<TodayOverviewTab classroomId={9} onOpenAssignment={onOpen} onOpenAtRisk={vi.fn()} />);
    const buttons = await screen.findAllByRole('button', { name: '查看' });
    await userEvent.click(buttons[0]);
    expect(onOpen).toHaveBeenCalledWith(2);
  });
});
