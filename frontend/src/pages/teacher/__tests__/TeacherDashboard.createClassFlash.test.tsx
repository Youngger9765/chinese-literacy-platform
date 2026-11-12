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

describe('TeacherDashboard — create classroom flash (issue #3420)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(classroomApi.listMyClassrooms).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(classroomApi.listJunyiImportableClasses).mockResolvedValue({
      linked: false,
      classes: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not show the empty state after creating the first classroom', async () => {
    const createdClassroom = {
      id: 42,
      name: '五年甲班',
      grade: 5,
      student_count: 0,
      school_id: 1,
      teacher_id: 1,
      is_active: true,
      created_at: '2026-10-01T00:00:00Z',
      pk_human: false,
      league: false,
      live_quiz: false,
    };
    vi.mocked(classroomApi.createClassroom).mockResolvedValue(createdClassroom);
    const onSelectClassroom = vi.fn();

    render(
      <MemoryRouter initialEntries={['/teacher']}>
        <TeacherDashboard onSelectClassroom={onSelectClassroom} />
      </MemoryRouter>
    );

    const openButtons = await screen.findAllByRole('button', { name: '建立班級' });
    fireEvent.click(openButtons[0]);
    await screen.findByText('建立新班級');
    fireEvent.change(screen.getByPlaceholderText('例：五年甲班'), {
      target: { value: '五年甲班' },
    });
    fireEvent.click(screen.getByRole('button', { name: '確定建立班級' }));

    await waitFor(() => {
      expect(onSelectClassroom).toHaveBeenCalledWith(42, createdClassroom, undefined);
    });

    expect(screen.queryByText('尚未建立班級')).not.toBeInTheDocument();
  });
});
