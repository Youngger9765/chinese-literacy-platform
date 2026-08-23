/**
 * VocabApplication.progressPersistence.test.tsx — 語詞應用作答中的答案要進得了 DB（#2848）
 *
 * 為什麼會漏掉：`FillInBlankExercise` 每答一題只寫 localStorage
 * （`vocab_app_progress_<story>`），從不通知 parent。`VocabApplication` 送進 DB 的
 * patch 只有兩種：`phase === 'done'` 的最終成績，以及 beforeunload 時的
 * `{ phase:'exercise', partialAt }` 心跳 —— 那個心跳裡一題答案都沒有。
 * 於是換裝置／清快取整關重來。
 *
 * 2026-08-21 staging 實測（真瀏覽器 + network tab，session 1937，課文 20011）：
 *   答 1 題（畫面 1/8 → 2/8）→ 等 12 秒 → 0 次 PUT，
 *   `GET /api/learning/sessions/1937/progress` 回 `step_progress: null`。
 *   同一個 session 的 keypoints-table 填一格 → 2 次 PUT 200 且
 *   `step_data['keypoints-table'].answers` 有值 → 傳輸層是好的，缺陷在元件層。
 *
 * 斷言一律用「答 N 題就要存回 N 筆」的數量形式。「有一筆就算過」連「只回報第一題」
 * 都能矇混過去。
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import VocabApplication from '../VocabApplication';
import type { Story } from '../../../types';

const story = {
  id: 'L2848',
  title: '進度保存回歸測試',
  vocabulary: [
    { word: '疑難雜症', definition: '難以解決的困難或問題。' },
    { word: '龍爭虎鬥', definition: '形容激烈競爭。' },
    { word: '一鳴驚人', definition: '一下子表現得很好。' },
  ],
  fillInBlank: [
    { sentence: '他解決了所有的(　　)。', answer: 'A' },
    { sentence: '兩隊之間展開(　　)的競爭。', answer: 'B' },
    { sentence: '他這次考試(　　)。', answer: 'C' },
  ],
  vocabBank: { A: '疑難雜症', B: '龍爭虎鬥', C: '一鳴驚人' },
} as unknown as Story;

/** 答對後停留 1200ms 才換下一題。 */
const ADVANCE_MS = 1200;

/** 首次進來會有導覽罩，不關掉點不到語詞庫。 */
function dismissCoachIfPresent() {
  const btn = screen.queryByRole('button', { name: '我知道了' });
  if (btn) fireEvent.click(btn);
}

/** 點語詞庫裡代號為 `code` 的那顆按鈕（正解就會判定答對並前進）。 */
function answerWith(code: 'A' | 'B' | 'C') {
  const word = { A: '疑難雜症', B: '龍爭虎鬥', C: '一鳴驚人' }[code];
  const btn = screen
    .getAllByRole('button')
    .find((b) => b.textContent?.trim() === word);
  if (!btn) throw new Error(`語詞庫裡找不到「${word}」— 測試沒真的答到題`);
  fireEvent.click(btn);
  act(() => {
    vi.advanceTimersByTime(ADVANCE_MS + 50);
  });
}

/**
 * 從最後一次進度 patch 取出「已作答」的題數。
 *
 * 看 `exercise.firstTryResults` —— 每答一題（答對，或第一次答錯）就多一筆，
 * 這是作答中唯一會變、也是唯一足以還原「答到哪、對幾題」的內容。
 * ⚠️ 不可以只看 patch 有沒有被呼叫：`beforeunload` 心跳本來就會送
 * `{phase, partialAt}`，那個 patch 一題答案都沒有，卻會讓「有呼叫就算過」的斷言變綠。
 */
function answeredFromLastPatch(spy: ReturnType<typeof vi.fn>): number {
  for (let i = spy.mock.calls.length - 1; i >= 0; i--) {
    const opts = spy.mock.calls[i][0] as { stepData?: Record<string, unknown> };
    const ex = opts?.stepData?.exercise as { firstTryResults?: unknown[] } | undefined;
    if (ex && Array.isArray(ex.firstTryResults)) return ex.firstTryResults.length;
  }
  return -1;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('語詞應用 — 作答中的答案要進得了 DB（#2848）', () => {
  it('每答一題就回報一次，回報的筆數等於已作答題數（不是等做完才存）', () => {
    vi.useFakeTimers();
    try {
      const patch = vi.fn();
      render(<VocabApplication story={story} onFinish={vi.fn()} saveStepProgressPatch={patch} />);
      dismissCoachIfPresent();

      answerWith('A');
      expect(answeredFromLastPatch(patch)).toBe(1);

      answerWith('B');
      expect(answeredFromLastPatch(patch)).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('作答中的 patch 不可標記完成 —— 沒做完就標完成，報告頁會把整步算成已完成', () => {
    vi.useFakeTimers();
    try {
      const patch = vi.fn();
      render(<VocabApplication story={story} onFinish={vi.fn()} saveStepProgressPatch={patch} />);
      dismissCoachIfPresent();
      answerWith('A');

      const midCalls = patch.mock.calls
        .map((c) => c[0] as { stepData?: Record<string, unknown>; markCompleted?: boolean })
        .filter((o) => o?.stepData?.exercise);
      expect(midCalls.length).toBeGreaterThan(0);
      expect(midCalls.every((o) => o.markCompleted !== true)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('重新掛載時要從 DB 的快照接著答，不是從第 1 題重來（存了讀不回來等於沒存）', () => {
    vi.useFakeTimers();
    try {
      const patch = vi.fn();
      const { unmount } = render(
        <VocabApplication story={story} onFinish={vi.fn()} saveStepProgressPatch={patch} />,
      );
      dismissCoachIfPresent();
      answerWith('A');
      answerWith('B');

      const saved = patch.mock.calls
        .map((c) => (c[0] as { stepData?: Record<string, unknown> })?.stepData)
        .filter((sd) => sd && sd.exercise)
        .pop() as Record<string, unknown>;
      expect(saved).toBeTruthy();

      unmount();
      localStorage.clear(); // 只走 DB 那條路，證明還原不是靠 localStorage 撐著

      render(
        <VocabApplication
          story={story}
          onFinish={vi.fn()}
          saveStepProgressPatch={vi.fn()}
          initialProgress={saved}
        />,
      );
      dismissCoachIfPresent();

      // 答過的兩題不該再出現；畫面應該停在第 3 題。
      expect(screen.queryByText(/他解決了所有的/)).toBeNull();
      expect(screen.queryByText(/兩隊之間展開/)).toBeNull();
      expect(screen.getByText(/他這次考試/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
