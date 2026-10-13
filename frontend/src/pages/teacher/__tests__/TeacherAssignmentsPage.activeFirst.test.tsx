import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as classroomApi from '../../../services/classroomApi';

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('../AssignmentTab', () => ({
  default: ({ classroomId }: { classroomId: number }) => <div data-testid="assignment-tab" data-id={classroomId} />,
}));
vi.mock('../../../services/classroomApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/classroomApi')>()),
  listMyClassrooms: vi.fn(),
}));

import TeacherAssignmentsPage from '../TeacherAssignmentsPage';

const base = { school_id: 1, teacher_id: 1, grade: null, created_at: '', student_count: 1 };

// 作業管理 used to open on whatever class the API listed first — in practice an
// 已停用 one. A teacher opening it means a class they still teach.
describe('TeacherAssignmentsPage — opens on an active class', () => {
  it('skips inactive classes when picking the default, and marks them in the list', async () => {
    vi.mocked(classroomApi.listMyClassrooms).mockResolvedValue({
      items: [
        { ...base, id: 1, name: '停用班', is_active: false },
        { ...base, id: 2, name: '使用中班', is_active: true },
      ],
      total: 2,
    } as never);
    render(
      <MemoryRouter initialEntries={['/teacher/assignments']}>
        <TeacherAssignmentsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('assignment-tab')).toHaveAttribute('data-id', '2'));
    expect(screen.getByRole('option', { name: /停用班（已停用）/ })).toBeInTheDocument();
  });
});
