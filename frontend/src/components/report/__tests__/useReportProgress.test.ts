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
});
