import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddStudentsPanel, { parseRoster } from './AddStudentsPanel';
import * as classroomApi from '../../../services/classroomApi';
import * as cards from './credentialCards';

describe('parseRoster (#3378)', () => {
  it('names only: seats continue from the next free seat', () => {
    expect(parseRoster('王小明\n林雨萱', 5)).toEqual([
      { name: '王小明', seat_number: '5' },
      { name: '林雨萱', seat_number: '6' },
    ]);
  });
  it('「座號 姓名」 keeps the seat the teacher typed', () => {
    expect(parseRoster('3 陳柏宇\n7,李佳蓉\n吳冠廷')).toEqual([
      { name: '陳柏宇', seat_number: '3' },
      { name: '李佳蓉', seat_number: '7' },
      { name: '吳冠廷', seat_number: '8' },
    ]);
  });
  it('a single number means a head count (均一: 輸入學生人數)', () => {
    const r = parseRoster('3');
    expect(r.map((x) => x.seat_number)).toEqual(['1', '2', '3']);
    expect(r[0].name).toBe('1 號');
  });
  it('blank lines are ignored', () => {
    expect(parseRoster('\n  \n')).toEqual([]);
  });
});

describe('AddStudentsPanel (#3378)', () => {
  const base = {
    token: 't', classroomId: 9, classroomName: '四年甲班', joinCode: 'K3F7X2', nextSeat: 1,
    onCreated: vi.fn(), addByIdForm: <div>by-id</div>, onOpenCsv: vi.fn(),
  };

  it('creates the pasted students and offers printable cards', async () => {
    const created = [{ name: '王小明', seat_number: '1', username: 'K3F7X21', password: 'pw1', user_id: 11 }];
    const batch = vi.spyOn(classroomApi, 'batchCreateStudents').mockResolvedValue({ created, errors: [] });
    const open = vi.spyOn(cards, 'openCredentialCards').mockImplementation(() => {});
    const onCreated = vi.fn();
    render(<AddStudentsPanel {...base} onCreated={onCreated} />);
    await userEvent.type(screen.getByLabelText(/一行一位學生/), '王小明');
    await userEvent.click(screen.getByRole('button', { name: '建立 1 個學生帳號' }));
    expect(batch).toHaveBeenCalledWith('t', 9, [{ name: '王小明', seat_number: '1' }]);
    expect(onCreated).toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: '列印帳密卡' }));
    expect(open).toHaveBeenCalledWith('四年甲班', created);
  });

  it('已經有帳號 shows the class code and the add-by-id form', async () => {
    render(<AddStudentsPanel {...base} />);
    await userEvent.click(screen.getByRole('tab', { name: '已經有帳號' }));
    expect(screen.getByText('K3F7X2')).toBeInTheDocument();
    expect(screen.getByText('by-id')).toBeInTheDocument();
  });
});

describe('credentialCardsHtml (#3378)', () => {
  it('one card per student, with HTML escaped', () => {
    const html = cards.credentialCardsHtml('四<甲>', [
      { name: '<b>x</b>', seat_number: '1', username: 'u1', password: 'p1' },
      { name: '林雨萱', seat_number: '2', username: 'u2', password: 'p2' },
    ], 'https://x/login');
    expect(html.match(/class="card"/g)).toHaveLength(2);
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('u2');
  });
});
