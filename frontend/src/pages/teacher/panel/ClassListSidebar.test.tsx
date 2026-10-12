import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import ClassListSidebar from './ClassListSidebar';
import * as classroomApi from '../../../services/classroomApi';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateSpy,
}));
const render = (ui: React.ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('../../../services/classroomApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/classroomApi')>()),
  listMyClassrooms: vi.fn(),
}));

const classrooms = [
  { id: 1, name: '四年甲班', school_id: 1, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 2 },
  { id: 2, name: '五年乙班', school_id: 1, teacher_id: 1, grade: 5, is_active: true, created_at: '', student_count: 3 },
];

const classroomsWithInactive = [
  classrooms[0],
  { id: 3, name: '已停用六年丙班', school_id: 1, teacher_id: 1, grade: 6, is_active: false, created_at: '', student_count: 1 },
];

describe('ClassListSidebar — desktop left class list (#3401)', () => {
  beforeEach(() => {
    vi.mocked(classroomApi.listMyClassrooms).mockResolvedValue({ items: classrooms, total: 2 } as never);
  });

  it('still shows the column with one classroom: 建立班級 + the class (Junyi parity)', async () => {
    vi.mocked(classroomApi.listMyClassrooms).mockResolvedValue({ items: [classrooms[0]], total: 1 } as never);
    render(<ClassListSidebar currentId={1} onSwitch={vi.fn()} />);
    expect(await screen.findByRole('button', { name: /四年甲班/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /建立班級/ })).toBeInTheDocument();
  });

  it('建立班級 goes to the class list with the create form open', async () => {
    render(<ClassListSidebar currentId={1} onSwitch={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /建立班級/ }));
    expect(navigateSpy).toHaveBeenCalledWith('/teacher', { state: { intent: 'create' } });
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

  it('keeps inactive classrooms collapsed until the 已停用 toggle is opened', async () => {
    vi.mocked(classroomApi.listMyClassrooms).mockResolvedValue({
      items: classroomsWithInactive,
      total: 2,
    } as never);
    const user = userEvent.setup();

    render(<ClassListSidebar currentId={1} onSwitch={vi.fn()} />);

    expect(await screen.findByRole('button', { name: /四年甲班/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /已停用六年丙班/ })).not.toBeInTheDocument();

    const inactiveToggle = screen.getByRole('button', { name: /已停用/ });
    expect(inactiveToggle).toBeVisible();

    await user.click(inactiveToggle);

    expect(screen.getByRole('button', { name: /已停用六年丙班/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /四年甲班/ })).toBeVisible();
  });
});
