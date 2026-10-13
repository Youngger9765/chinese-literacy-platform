/**
 * #3517 — the teacher sees who is linked to a student and can cut a parent off.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  generateParentInviteCode: vi.fn(),
  listStudentParentLinks: vi.fn(),
  revokeStudentParentLink: vi.fn(),
}));
vi.mock('../../../services/parentApi', () => api);
vi.mock('../../../services/classroomApi', async () => {
  const actual = await vi.importActual<object>('../../../services/classroomApi');
  return { ...actual };
});

import { LinkedParentsButton } from '../StudentListTab';

describe('#3517 LinkedParentsButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    api.listStudentParentLinks.mockResolvedValue([
      { link_id: 11, parent_name: '王媽媽', parent_email: 'mom@example.com', linked_at: '2026-10-14T00:00:00Z' },
    ]);
    api.revokeStudentParentLink.mockResolvedValue(undefined);
  });

  it('lists the linked parent and revoking removes them after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<LinkedParentsButton token="t" studentId={7} studentName="小孩甲" />);
    await userEvent.click(screen.getByRole('button', { name: '已連結家長' }));
    expect(await screen.findByText('王媽媽')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '取消連結' }));
    expect(api.revokeStudentParentLink).toHaveBeenCalledWith('t', 7, 11);
    expect(screen.queryByText('王媽媽')).toBeNull();
    expect(screen.getByText('還沒有家長連結')).toBeTruthy();
  });

  it('cancelling the confirmation keeps the link', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<LinkedParentsButton token="t" studentId={7} studentName="小孩甲" />);
    await userEvent.click(screen.getByRole('button', { name: '已連結家長' }));
    await screen.findByText('王媽媽');
    await userEvent.click(screen.getByRole('button', { name: '取消連結' }));
    expect(api.revokeStudentParentLink).not.toHaveBeenCalled();
    expect(screen.getByText('王媽媽')).toBeTruthy();
  });
});
