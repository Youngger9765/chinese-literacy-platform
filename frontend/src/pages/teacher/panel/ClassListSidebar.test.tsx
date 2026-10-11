import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClassListSidebar from './ClassListSidebar';
import * as classroomApi from '../../../services/classroomApi';

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('../../../services/classroomApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/classroomApi')>()),
  listMyClassrooms: vi.fn(),
}));

const classrooms = [
  { id: 1, name: '四年甲班', school_id: 1, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 2 },
  { id: 2, name: '五年乙班', school_id: 1, teacher_id: 1, grade: 5, is_active: true, created_at: '', student_count: 3 },
];

describe('ClassListSidebar — desktop left class list (#3401)', () => {
  beforeEach(() => {
    vi.mocked(classroomApi.listMyClassrooms).mockResolvedValue({ items: classrooms, total: 2 } as never);
  });

  it('renders nothing while there is only one classroom (nothing to switch to)', async () => {
    vi.mocked(classroomApi.listMyClassrooms).mockResolvedValue({ items: [classrooms[0]], total: 1 } as never);
    const { container } = render(<ClassListSidebar currentId={1} onSwitch={vi.fn()} />);
    await waitFor(() => expect(classroomApi.listMyClassrooms).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('lists every classroom and marks the current one', async () => {
    render(<ClassListSidebar currentId={2} onSwitch={vi.fn()} />);
    const current = await screen.findByRole('button', { name: /五年乙班/ });
    const other = screen.getByRole('button', { name: /四年甲班/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(other).not.toHaveAttribute('aria-current');
  });

  it('calls onSwitch with the classroom id when another classroom is clicked', async () => {
    const onSwitch = vi.fn();
    render(<ClassListSidebar currentId={2} onSwitch={onSwitch} />);
    const other = await screen.findByRole('button', { name: /四年甲班/ });
    await userEvent.click(other);
    expect(onSwitch).toHaveBeenCalledWith(1);
  });
});
