import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { FormEvent } from 'react';
import { useAssignments } from '../useAssignments';
import * as api from '../../../../services/assignmentApi';

vi.mock('../../../../services/assignmentApi', async (orig) => ({
  ...(await orig<typeof import('../../../../services/assignmentApi')>()),
  getClassroomAssignments: vi.fn(),
  createAssignment: vi.fn(),
}));

vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 't' }) }));
vi.mock('../../../../services/api', () => ({ fetchStories: vi.fn().mockResolvedValue([]) }));

const ev = { preventDefault: () => {} } as unknown as FormEvent;

describe('useAssignments — 派給誰 (#3378)', () => {
  beforeEach(() => {
    vi.mocked(api.getClassroomAssignments).mockResolvedValue({ items: [] } as never);
    vi.mocked(api.createAssignment).mockReset().mockResolvedValue({} as never);
  });

  it('some students → student_ids sent; other classes → same assignment, whole class', async () => {
    const create = vi.mocked(api.createAssignment);
    const { result } = renderHook(() => useAssignments(9));
    await waitFor(() => expect(api.getClassroomAssignments).toHaveBeenCalled());
    act(() => {
      result.current.setSelectedStoryId('20011');
      result.current.setFormStudentIds([1, 2]);
      result.current.setFormExtraClassIds([10, 11]);
    });
    await act(async () => { await result.current.handleCreate(ev); });
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[0][1]).toBe(9);
    expect(create.mock.calls[0][2]).toMatchObject({ story_id: '20011', student_ids: [1, 2] });
    expect(create.mock.calls[1][1]).toBe(10);
    expect(create.mock.calls[1][2]).not.toHaveProperty('student_ids');
    expect(create.mock.calls[2][1]).toBe(11);
  });

  it('whole class sends no student_ids', async () => {
    const create = vi.mocked(api.createAssignment);
    const { result } = renderHook(() => useAssignments(9));
    act(() => { result.current.setSelectedStoryId('20011'); });
    await act(async () => { await result.current.handleCreate(ev); });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][2]).not.toHaveProperty('student_ids');
  });

  it('部分學生 with nobody ticked is refused before any request', async () => {
    const create = vi.mocked(api.createAssignment);
    const { result } = renderHook(() => useAssignments(9));
    act(() => {
      result.current.setSelectedStoryId('20011');
      result.current.setFormStudentIds([]);
    });
    await act(async () => { await result.current.handleCreate(ev); });
    expect(create).not.toHaveBeenCalled();
    expect(result.current.createError).toMatch(/至少勾選一位學生/);
  });
});
