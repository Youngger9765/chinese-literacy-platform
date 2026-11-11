import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SeatNumberDialog from './SeatNumberDialog';
import * as classroomApi from '../../services/classroomApi';

const students = [
  { id: 1, name: '王小明', email: 'a@x.com', enrolled_at: '2026-01-01', seat_number: null },
  { id: 2, name: '林雨萱', email: 'b@x.com', enrolled_at: '2026-01-01', seat_number: null },
  { id: 3, name: '陳柏宇', email: 'c@x.com', enrolled_at: '2026-01-01', seat_number: null },
];

describe('SeatNumberDialog (#3992)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('numbers rows 1..N in the order they are shown', async () => {
    const batch = vi.spyOn(classroomApi, 'batchSetSeatNumbers').mockResolvedValue({ updated: [] });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <SeatNumberDialog
        isOpen
        token="t"
        classroomId={9}
        students={students}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('1')).toBeInTheDocument();
    expect(within(items[0]).getByText('王小明')).toBeInTheDocument();
    expect(within(items[1]).getByText('2')).toBeInTheDocument();
    expect(within(items[2]).getByText('3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '儲存座號' }));
    expect(batch).toHaveBeenCalledWith('t', 9, [
      { student_id: 1, seat_number: 1 },
      { student_id: 2, seat_number: 2 },
      { student_id: 3, seat_number: 3 },
    ]);
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('moving a row down changes the resulting seat numbers', async () => {
    const batch = vi.spyOn(classroomApi, 'batchSetSeatNumbers').mockResolvedValue({ updated: [] });
    render(
      <SeatNumberDialog
        isOpen
        token="t"
        classroomId={9}
        students={students}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    // Move 王小明 (row 1) down one position -> becomes seat 2, 林雨萱 becomes seat 1
    await userEvent.click(screen.getByRole('button', { name: '王小明 下移' }));

    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('林雨萱')).toBeInTheDocument();
    expect(within(items[0]).getByText('1')).toBeInTheDocument();
    expect(within(items[1]).getByText('王小明')).toBeInTheDocument();
    expect(within(items[1]).getByText('2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '儲存座號' }));
    expect(batch).toHaveBeenCalledWith('t', 9, [
      { student_id: 2, seat_number: 1 },
      { student_id: 1, seat_number: 2 },
      { student_id: 3, seat_number: 3 },
    ]);
  });

  it('an inserted empty seat makes the next real seat skip a number', async () => {
    const batch = vi.spyOn(classroomApi, 'batchSetSeatNumbers').mockResolvedValue({ updated: [] });
    render(
      <SeatNumberDialog
        isOpen
        token="t"
        classroomId={9}
        students={students.slice(0, 2)}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    // Insert an empty seat, then move it to the top (position 1) --
    // the two real students should become seat 2 and 3, skipping 1.
    await userEvent.click(screen.getByRole('button', { name: '＋ 插入空號' }));
    await userEvent.click(screen.getByRole('button', { name: '空號 上移' }));
    await userEvent.click(screen.getByRole('button', { name: '空號 上移' }));

    await userEvent.click(screen.getByRole('button', { name: '儲存座號' }));
    expect(batch).toHaveBeenCalledWith('t', 9, [
      { student_id: 1, seat_number: 2 },
      { student_id: 2, seat_number: 3 },
    ]);
  });

  it('removing an inserted empty seat closes the gap again', async () => {
    const batch = vi.spyOn(classroomApi, 'batchSetSeatNumbers').mockResolvedValue({ updated: [] });
    render(
      <SeatNumberDialog
        isOpen
        token="t"
        classroomId={9}
        students={students.slice(0, 2)}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '＋ 插入空號' }));
    await userEvent.click(screen.getByRole('button', { name: '移除空號' }));

    await userEvent.click(screen.getByRole('button', { name: '儲存座號' }));
    expect(batch).toHaveBeenCalledWith('t', 9, [
      { student_id: 1, seat_number: 1 },
      { student_id: 2, seat_number: 2 },
    ]);
  });

  it('shows the API error and keeps the dialog open on failure', async () => {
    vi.spyOn(classroomApi, 'batchSetSeatNumbers').mockRejectedValue(new Error('座號 [2] 在這個班級已經有人使用'));
    const onClose = vi.fn();
    render(
      <SeatNumberDialog
        isOpen
        token="t"
        classroomId={9}
        students={students}
        onClose={onClose}
        onSaved={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '儲存座號' }));
    expect(await screen.findByText('座號 [2] 在這個班級已經有人使用')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancel closes without calling the API', async () => {
    const batch = vi.spyOn(classroomApi, 'batchSetSeatNumbers');
    const onClose = vi.fn();
    render(
      <SeatNumberDialog
        isOpen
        token="t"
        classroomId={9}
        students={students}
        onClose={onClose}
        onSaved={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(batch).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when isOpen is false', () => {
    render(
      <SeatNumberDialog
        isOpen={false}
        token="t"
        classroomId={9}
        students={students}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
