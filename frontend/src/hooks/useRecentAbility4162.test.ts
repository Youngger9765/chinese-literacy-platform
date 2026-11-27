/**
 * #4162 useRecentAbility：同一課只留最新一次、失敗的課略過、結果由舊到新
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const sessions = vi.hoisted(() => ({ items: [] as { id: number; story_slug: string }[] }));
const progressOf = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock('../services/learning/session', () => ({
  fetchLearningSessions: vi.fn(async () => ({ items: sessions.items, total: sessions.items.length })),
  loadStepProgress: (...a: unknown[]) => progressOf.fn(...a),
}));
vi.mock('../services/api', () => ({
  fetchStory: vi.fn(async (slug: string) => ({ title: `課${slug}`, stepSequence: undefined })),
  storyForStep: () => undefined,
}));

import { useRecentAbility } from './useRecentAbility';

// 理解關答對 4/5 = 80 分的進度
const progress = (rate: number) => ({
  step_progress: {
    steps_completed: ['comprehension'],
    step_data: { comprehension: { completed: true, attempts: [{ id: 'a1', kind: 'first', correct: rate, total: 100, at: '2026-11-20T00:00:00Z' }] } },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useRecentAbility', () => {
  it('沒有 token 不抓資料，維持 null', () => {
    const { result } = renderHook(() => useRecentAbility(null));
    expect(result.current).toBeNull();
  });

  it('同一課多次作答只算最新一次；結果由舊到新；沒分數與讀取失敗的課略過', async () => {
    // 新到舊：A(最新 s5)、B(s4)、A(舊 s3，同課不算)、C(s2 讀取失敗)、D(s1 沒分數)
    sessions.items = [
      { id: 5, story_slug: 'A' }, { id: 4, story_slug: 'B' }, { id: 3, story_slug: 'A' },
      { id: 2, story_slug: 'C' }, { id: 1, story_slug: 'D' },
    ];
    progressOf.fn.mockImplementation(async (_t: string, id: number) => {
      if (id === 5) return progress(90);
      if (id === 4) return progress(60);
      if (id === 2) throw new Error('boom');
      return { step_progress: null };
    });
    const { result } = renderHook(() => useRecentAbility('tok'));
    await waitFor(() => expect(result.current).not.toBeNull());
    const ls = result.current!;
    expect(ls.map((l) => l.storyId)).toEqual(['B', 'A']); // 舊到新
    expect(ls.map((l) => l.sessionId)).toEqual([4, 5]);
    expect(ls[1].points.find((p) => p.key === 'meaning')?.value).toBe(90);
    // 同一課舊的那次（s3）不會被讀
    expect(progressOf.fn.mock.calls.map((c) => c[1])).not.toContain(3);
  });

  it('前面幾課都沒有分數時，繼續往回找，湊得到有分數的課', async () => {
    // 新到舊：七個沒分數（超過第一批的 6 個），最舊的兩個有分數
    sessions.items = [
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: 100 + n, story_slug: `N${n}` })),
      { id: 9, story_slug: 'OLD1' }, { id: 8, story_slug: 'OLD2' },
    ];
    progressOf.fn.mockImplementation(async (_t: string, id: number) =>
      id === 9 ? progress(70) : id === 8 ? progress(80) : { step_progress: null });
    const { result } = renderHook(() => useRecentAbility('tok'));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.map((l) => l.storyId)).toEqual(['OLD2', 'OLD1']);
  });

  it('只向後端要已完成的紀錄（進行中的不能蓋掉先前做完的成績）', async () => {
    sessions.items = [];
    const api = await import('../services/learning/session');
    renderHook(() => useRecentAbility('tok'));
    await waitFor(() => expect(api.fetchLearningSessions).toHaveBeenCalled());
    expect(vi.mocked(api.fetchLearningSessions).mock.calls[0][1]).toMatchObject({ status: 'completed' });
  });

  it('列表抓失敗：回空陣列，不擋報告頁', async () => {
    const api = await import('../services/learning/session');
    vi.mocked(api.fetchLearningSessions).mockRejectedValueOnce(new Error('x'));
    const { result } = renderHook(() => useRecentAbility('tok'));
    await waitFor(() => expect(result.current).toEqual([]));
  });
});
