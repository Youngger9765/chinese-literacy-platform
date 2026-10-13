import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useAssignments } from '../useAssignments';
import * as api from '../../../../services/assignmentApi';
import type { AssignmentResponse } from '../../../../services/assignmentApi';

vi.mock('../../../../services/assignmentApi', async (orig) => ({
  ...(await orig<typeof import('../../../../services/assignmentApi')>()),
  getClassroomAssignments: vi.fn(),
  createAssignment: vi.fn(),
  deleteAssignment: vi.fn(),
  updateAssignment: vi.fn(),
}));

vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('../../../../services/api', () => ({ fetchStories: vi.fn().mockResolvedValue([]) }));


// 作業管理's 進行中 / 已逾期 / 已停用 tabs had no tests, and they now share the
// "a due date lasts the whole day in Taiwan" rule (#3380): an assignment due
// today must stay 進行中 all day, not jump to 已逾期 at 8 a.m.
const a = (id: number, is_active: boolean, due_date: string | null) =>
  ({ id, is_active, due_date }) as unknown as AssignmentResponse;
// Fixed clock: 2026-10-13 12:00 Taiwan. The old bug only shows after 08:00,
// so a test using the real clock would miss it when run early in the morning.
const NOW = new Date('2026-10-13T12:00:00+08:00');

describe('useAssignments — status tabs and counts', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.mocked(api.getClassroomAssignments).mockResolvedValue({
      items: [
        a(1, true, null),                              // 進行中, no due date
        a(2, true, '2026-10-13T00:00:00Z'),         // due today -> still 進行中
        a(3, true, '2026-10-11T00:00:00Z'),        // two days ago -> 已逾期
        a(4, false, '2026-10-11T00:00:00Z'),       // 已停用 wins over overdue
      ],
    } as never);
  });

  afterEach(() => vi.useRealTimers());

  it('counts each tab once, due-today stays active, inactive is not also overdue', async () => {
    const { result } = renderHook(() => useAssignments(9));
    await waitFor(() => expect(result.current.tabCounts.all).toBe(4));
    expect(result.current.tabCounts).toEqual({ all: 4, active: 2, overdue: 1, inactive: 1 });
  });

  it('each tab lists exactly the assignments it counts', async () => {
    const { result } = renderHook(() => useAssignments(9));
    await waitFor(() => expect(result.current.tabCounts.all).toBe(4));
    const ids = () => result.current.filteredAssignments.map((x) => x.id);
    act(() => result.current.setStatusFilter('active'));
    expect(ids()).toEqual([1, 2]);
    act(() => result.current.setStatusFilter('overdue'));
    expect(ids()).toEqual([3]);
    act(() => result.current.setStatusFilter('inactive'));
    expect(ids()).toEqual([4]);
    act(() => result.current.setStatusFilter('all'));
    expect(ids()).toEqual([1, 2, 3, 4]);
  });
});
