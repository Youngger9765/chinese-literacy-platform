import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddStudentsPanel from './AddStudentsPanel';
import * as classroomApi from '../../../services/classroomApi';

/**
 * #3386 — when every row in a batch-create fails (e.g. all seat numbers are
 * duplicates), the panel still rendered the green "已建立 0 個帳號" success box.
 * Lock: created.length === 0 must render an error state, never the success box.
 */
describe('AddStudentsPanel — all rows fail (#3386)', () => {
  const base = {
    token: 't', classroomId: 9, classroomName: '四年甲班', joinCode: 'K3F7X2', nextSeat: 1,
    onCreated: vi.fn(), addByIdForm: <div>by-id</div>, onOpenCsv: vi.fn(),
  };

  it('does not show the green success box when created.length is 0', async () => {
    vi.spyOn(classroomApi, 'batchCreateStudents').mockResolvedValue({
      created: [],
      errors: [{ name: '重複的人', seat_number: '1', error: '座號重複' }],
    });
    render(<AddStudentsPanel {...base} />);
    await userEvent.type(screen.getByLabelText(/一行一位學生/), '1 重複的人');
    await userEvent.click(screen.getByRole('button', { name: /建立 1 個學生帳號/ }));

    expect(await screen.findByText(/座號重複|沒有建立成功|沒有學生建立成功/)).toBeInTheDocument();
    expect(screen.queryByText(/已建立 0 個帳號/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '列印帳密卡' })).not.toBeInTheDocument();
  });

  it('still shows the green success box + print button when at least one row succeeds', async () => {
    const created = [{ name: '王小明', seat_number: '2', username: 'K3F7X22', password: 'pw2', user_id: 12 }];
    vi.spyOn(classroomApi, 'batchCreateStudents').mockResolvedValue({
      created,
      errors: [{ name: '重複的人', seat_number: '1', error: '座號重複' }],
    });
    render(<AddStudentsPanel {...base} />);
    await userEvent.type(screen.getByLabelText(/一行一位學生/), '1 重複的人\n2 王小明');
    await userEvent.click(screen.getByRole('button', { name: /建立 2 個學生帳號/ }));

    expect(await screen.findByText(/已建立 1 個帳號/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '列印帳密卡' })).toBeInTheDocument();
  });
});
