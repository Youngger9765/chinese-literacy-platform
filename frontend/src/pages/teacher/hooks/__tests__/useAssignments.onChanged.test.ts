import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { FormEvent } from 'react';
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

const ev = { preventDefault: () => {} } as unknown as FormEvent;

const existingAssignment = { id: 42, is_active: true, due_date: null } as unknown as AssignmentResponse;

describe('useAssignments — onChanged notifies the matrix to refetch (#3385)', () => {
  beforeEach(() => {
    vi.mocked(api.getClassroomAssignments).mockResolvedValue({ items: [existingAssignment] } as never);
    vi.mocked(api.createAssignment).mockReset().mockResolvedValue({} as never);
    vi.mocked(api.deleteAssignment).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(api.updateAssignment).mockReset().mockResolvedValue(existingAssignment as never);
  });

  it('calls onChanged after a successful create', async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() => useAssignments(9, onChanged));
    await waitFor(() => expect(api.getClassroomAssignments).toHaveBeenCalled());
    act(() => { result.current.setSelectedStoryId('20011'); });
    await act(async () => { await result.current.handleCreate(ev); });
    expect(onChanged).toHaveBeenCalled();
  });

  it('does NOT call onChanged when create fails (no new column, nothing to refetch)', async () => {
    vi.mocked(api.createAssignment).mockRejectedValue(new Error('boom'));
    const onChanged = vi.fn();
    const { result } = renderHook(() => useAssignments(9, onChanged));
    await waitFor(() => expect(api.getClassroomAssignments).toHaveBeenCalled());
    act(() => { result.current.setSelectedStoryId('20011'); });
    await act(async () => { await result.current.handleCreate(ev); });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('calls onChanged after a successful delete', async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() => useAssignments(9, onChanged));
    await waitFor(() => expect(result.current.assignments).toHaveLength(1));
    await act(async () => { await result.current.handleDelete(existingAssignment); });
    expect(onChanged).toHaveBeenCalled();
  });

  it('calls onChanged after a successful edit (handleSaveEdit)', async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() => useAssignments(9, onChanged));
    await waitFor(() => expect(result.current.assignments).toHaveLength(1));
    act(() => { result.current.handleOpenEdit(existingAssignment); });
    await act(async () => { await result.current.handleSaveEdit(existingAssignment.id); });
    expect(onChanged).toHaveBeenCalled();
  });

  it('calls onChanged after toggling active/inactive', async () => {
    const onChanged = vi.fn();
    const { result } = renderHook(() => useAssignments(9, onChanged));
    await waitFor(() => expect(result.current.assignments).toHaveLength(1));
    await act(async () => { await result.current.handleToggleActive(existingAssignment); });
    expect(onChanged).toHaveBeenCalled();
  });

  it('is optional — omitting onChanged does not throw', async () => {
    const { result } = renderHook(() => useAssignments(9));
    await waitFor(() => expect(result.current.assignments).toHaveLength(1));
    await expect(result.current.handleDelete(existingAssignment)).resolves.not.toThrow();
  });
});
