/**
 * #3399 — 報告頁資料：記號不在 #2889 的 carry-forward 裡，目前 session 沒有記號
 * 時要往回找這一課最近一次有記號的 session。
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const loadAnnotations = vi.fn();
const loadStepProgress = vi.fn();
vi.mock('../../../services/learning/annotationApi', () => ({ loadAnnotations: (id: number) => loadAnnotations(id) }));
vi.mock('../../../services/learningApi', () => ({ loadStepProgress: (t: string, id: number) => loadStepProgress(t, id) }));

import { useReportProgress } from '../useReportProgress';

const mark = { id: 1, paragraph_index: 0, char_start: 0, char_end: 2, annotation_type: 'unknown' as const };

afterEach(() => {
  vi.unstubAllGlobals();
  loadAnnotations.mockReset();
  loadStepProgress.mockReset();
});

describe('useReportProgress', () => {
  it('uses the current session when it has marks', async () => {
    loadStepProgress.mockResolvedValue({ step_progress: { steps_completed: ['x'], step_data: {} } });
    loadAnnotations.mockResolvedValue([mark]);
    const { result } = renderHook(() => useReportProgress(10, 'tok', '20011', null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.annotations).toEqual([mark]);
    expect(result.current.progress?.steps_completed).toEqual(['x']);
  });

  it('carries marks forward from the latest earlier session of this lesson', async () => {
    loadStepProgress.mockResolvedValue({ step_progress: { steps_completed: [], step_data: {} } });
    loadAnnotations.mockImplementation(async (id: number) => (id === 7 ? [mark] : []));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ id: 10 }, { id: 9 }, { id: 7 }] }) })));
    const { result } = renderHook(() => useReportProgress(10, 'tok', '20011', null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.annotations).toEqual([mark]);
    expect(loadAnnotations).toHaveBeenCalledWith(9);
  });

  // #3749 — SessionHistoryReportPage looks at one SPECIFIC past session chosen
  // from a list. Carry-forward was designed for the live in-flow ReportPage,
  // where a refresh silently starts a new backend session for the SAME
  // attempt (#2889) — there, "no marks on this session yet, borrow the most
  // recent sibling's" is correct. A historical page has no such relationship:
  // "most recent sibling of this story" can be a LATER, unrelated attempt the
  // student made after the one being viewed. Without carryForwardMarks=false,
  // that later attempt's marks would render as if they belonged to the old one.
  it('does not search sibling sessions when carryForwardMarks is false', async () => {
    loadStepProgress.mockResolvedValue({ step_progress: { steps_completed: [], step_data: {} } });
    loadAnnotations.mockImplementation(async (id: number) => (id === 7 ? [mark] : []));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() => useReportProgress(10, 'tok', '20011', null, false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.annotations).toEqual([]);
    expect(loadAnnotations).toHaveBeenCalledWith(10);
    expect(loadAnnotations).not.toHaveBeenCalledWith(7);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── #4028 ──────────────────────────────────────────────────────────────────
  const carriedEmpty = {
    steps_completed: ['comprehension', 'report'],
    session_steps_completed: ['report'],
    step_data: {},
    __meta: { carried_from: { session_id: 9, at: '2026-11-13T06:05:00Z', steps_completed: ['comprehension'] } },
  };
  const previous = { steps_completed: ['comprehension'], step_data: { comprehension: { mcqScore: 3, mcqTotal: 4 } } };

  it('shows the carried-from attempt when nothing has been done in this session yet (#4028)', async () => {
    loadStepProgress.mockImplementation(async (_t: string, id: number) => ({
      step_progress: id === 10 ? carriedEmpty : previous,
    }));
    loadAnnotations.mockImplementation(async (id: number) => (id === 9 ? [mark] : []));
    const { result } = renderHook(() => useReportProgress(10, 'tok', '20011', null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.viewingPrevious).toEqual({ sessionId: 9, at: '2026-11-13T06:05:00Z' });
    expect(result.current.progress).toEqual(previous);
    expect(result.current.annotations).toEqual([mark]);
  });

  it('stays on this session once something was done in it (#4028)', async () => {
    const started = { ...carriedEmpty, steps_completed: ['comprehension', 'spotlight'], session_steps_completed: ['spotlight'] };
    loadStepProgress.mockResolvedValue({ step_progress: started });
    loadAnnotations.mockResolvedValue([mark]);
    const { result } = renderHook(() => useReportProgress(10, 'tok', '20011', null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.viewingPrevious).toBeNull();
    expect(result.current.progress).toEqual(started);
    expect(loadStepProgress).toHaveBeenCalledTimes(1);
  });

  it('the history page never swaps to another attempt (#4028)', async () => {
    loadStepProgress.mockResolvedValue({ step_progress: carriedEmpty });
    loadAnnotations.mockResolvedValue([]);
    const { result } = renderHook(() => useReportProgress(10, 'tok', '20011', null, false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.viewingPrevious).toBeNull();
    expect(loadStepProgress).toHaveBeenCalledTimes(1);
  });

  it('falls back to this session if the previous attempt cannot be loaded (#4028)', async () => {
    loadStepProgress.mockImplementation(async (_t: string, id: number) => {
      if (id === 10) return { step_progress: carriedEmpty };
      throw new Error('403');
    });
    loadAnnotations.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })));
    const { result } = renderHook(() => useReportProgress(10, 'tok', '20011', null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.viewingPrevious).toBeNull();
    expect(result.current.progress).toEqual(carriedEmpty);
  });
});
