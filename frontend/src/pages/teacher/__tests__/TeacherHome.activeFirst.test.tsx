import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as classroomApi from '../../../services/classroomApi';

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't', user: { name: '李老師' } }) }));
vi.mock('../../../services/classroomApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/classroomApi')>()),
  listMyClassrooms: vi.fn(),
}));

import TeacherHome from '../TeacherHome';

const base = { school_id: 1, teacher_id: 1, grade: null, created_at: '', student_count: 1 };

// 老師首頁「我的班級」 opened on two 已停用 classes with nothing saying so.
describe('TeacherHome — my classes list', () => {
  it('lists active classes first and marks inactive ones', async () => {
    vi.mocked(classroomApi.listMyClassrooms).mockResolvedValue({
      items: [
        { ...base, id: 1, name: '停用班', is_active: false },
        { ...base, id: 2, name: '使用中班', is_active: true },
      ],
      total: 2,
    } as never);
    render(
      <MemoryRouter>
        <TeacherHome />
      </MemoryRouter>,
    );
    const list = await screen.findByRole('list', { name: '班級列表' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('使用中班');
    expect(items[1]).toHaveTextContent('停用班');
    expect(items[1]).toHaveTextContent('已停用');
    expect(items[0]).not.toHaveTextContent('已停用');
  });
});
