/**
 * #4081 — 重點朗讀的結果以資料庫為準，瀏覽器快取只在 DB 沒有時才用。
 *
 * 以前快取優先（理由是「DB 的結果可能缺 diffTokens」，現在 step_data 已經存完整
 * 結果）：這台裝置上的舊朗讀會蓋過 DB 裡較新的那一次，接著被存回去。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyPassageReadingResultPersistence } from '../useKeyPassageReadingResultPersistence';

const KEY = 'fullReading_progress_test4081';
const older = { matchRate: 0.5, feedback: '舊的', diffTokens: [], cpm: 90, durationMs: 60000,
  errorBreakdown: { correct: 5, wrong: 5, missing: 0, extra: 0 } };
const newer = { matchRate: 0.95, feedback: '新的', cpm: 150, durationMs: 40000,
  errorBreakdown: { correct: 19, wrong: 1, missing: 0, extra: 0 } };

afterEach(() => localStorage.clear());

const run = (initialResult: typeof newer | null, initialTranscript?: string) =>
  renderHook(() =>
    useKeyPassageReadingResultPersistence({
      storyId: 20011, token: null, userId: undefined, storageKey: KEY, initialResult, initialTranscript,
    }),
  ).result;

describe('key-passage result: DB first (#4081)', () => {
  it('the DB result wins over an older copy cached on this device', () => {
    localStorage.setItem(KEY, JSON.stringify({ result: older, transcript: '舊的逐字稿' }));
    const r = run(newer, '新的逐字稿');
    expect(r.current.result?.cpm).toBe(150);
    expect(r.current.streamingTranscript).toBe('新的逐字稿');
  });

  it('the cached copy is still used when the DB has nothing yet (offline / not saved yet)', () => {
    localStorage.setItem(KEY, JSON.stringify({ result: older, transcript: '舊的逐字稿' }));
    const r = run(null);
    expect(r.current.result?.cpm).toBe(90);
    expect(r.current.streamingTranscript).toBe('舊的逐字稿');
  });
});
