import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as classroomApi from '../../../services/classroomApi';

vi.mock('../../../services/classroomApi', async () => {
  const actual = await vi.importActual<typeof classroomApi>('../../../services/classroomApi');
  return {
    ...actual,
    listMyClassrooms: vi.fn(),
    createClassroom: vi.fn(),
    listJunyiImportableClasses: vi.fn(),
    importJunyiClasses: vi.fn(),
    batchCreateStudents: vi.fn(),
  };
});

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'QA 老師' },
    token: 'test-token',
  }),
}));

vi.mock('../../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeSchoolId: 1,
    hasMultipleSchools: false,
    teacherSchoolIds: [],
    studentSchoolIds: [],
    activeView: 'teacher',
    setActiveView: vi.fn(),
    setActiveSchoolId: vi.fn(),
    availableViews: ['teacher'],
  }),
}));


import TeacherDashboard from '../TeacherDashboard';

// Junyi-parity: the 建立班級 dialog asks how students join, and with
// 「幫學生建立帳號」 one submit creates the class AND the accounts. The passwords
// are returned only once, so the result must travel to the class page.
describe('TeacherDashboard — create class and student accounts in one step', () => {
  const created = {
    id: 42, name: '五年甲班', grade: 5, student_count: 0,
    school_id: 1, teacher_id: 1, is_active: true, created_at: '2026-10-01T00:00:00Z',
    pk_human: false, league: false, live_quiz: false,
  };
  const batch = { created: [{ name: '王小明', seat_number: '1', username: 'abc1', password: 'pw-shown-once', user_id: 7 }], errors: [], warnings: [] };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(classroomApi.listMyClassrooms).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(classroomApi.listJunyiImportableClasses).mockResolvedValue({ linked: false, classes: [] });
    vi.mocked(classroomApi.createClassroom).mockResolvedValue(created);
    vi.mocked(classroomApi.batchCreateStudents).mockResolvedValue(batch as never);
  });
  afterEach(() => vi.restoreAllMocks());

  const open = async () => {
    const onSelectClassroom = vi.fn();
    render(
      <MemoryRouter initialEntries={['/teacher']}>
        <TeacherDashboard onSelectClassroom={onSelectClassroom} />
      </MemoryRouter>,
    );
    fireEvent.click((await screen.findAllByRole('button', { name: '建立班級' }))[0]);
    await screen.findByRole('dialog', { name: '建立新班級' });
    fireEvent.change(screen.getByPlaceholderText('例：五年甲班'), { target: { value: '五年甲班' } });
    return onSelectClassroom;
  };

  it('a pasted roster creates the accounts and hands the result to the class page', async () => {
    const onSelectClassroom = await open();
    fireEvent.change(screen.getByLabelText('幫學生建立帳號與密碼'), { target: { value: '1 王小明' } });
    fireEvent.click(screen.getByRole('button', { name: '建立班級和 1 個學生帳號' }));
    await waitFor(() => expect(onSelectClassroom).toHaveBeenCalledWith(42, created, batch));
    expect(classroomApi.batchCreateStudents).toHaveBeenCalledWith('test-token', 42, [{ name: '王小明', seat_number: '1' }]);
  });

  it('「學生已有帳號」 creates only the class', async () => {
    const onSelectClassroom = await open();
    fireEvent.click(screen.getByRole('radio', { name: /學生已有帳號/ }));
    fireEvent.click(screen.getByRole('button', { name: '確定建立班級' }));
    await waitFor(() => expect(onSelectClassroom).toHaveBeenCalledWith(42, created, undefined));
    expect(classroomApi.batchCreateStudents).not.toHaveBeenCalled();
  });
});
