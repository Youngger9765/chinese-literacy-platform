/**
 * VocabDefinitionMatch.progressPersistence.test.tsx — 作答中的答案必須進得了進度 payload（#2839）
 *
 * 為什麼會漏掉：`MultipleChoiceMode` 把每一題的作答放在 `answersRef`（useRef），
 * 只有在 11 題全部答完時才 `onAllDone(answersRef.current)` 回報一次。ref 不觸發
 * render、也不通知 parent，所以作答中 parent 的 `mcAnswers` 恆為 `[]`，
 * `buildProgressPayload()` 每次算出來的內容完全相同 →
 * `persistStepProgressState` 的 `prevSig === nextSig` 判定「沒變化」直接 return →
 * `syncProgress` 從來沒被呼叫 → PUT 從來沒發出去。
 *
 * 2026-08-21 staging 實測（真瀏覽器 + network tab，session 1931）：
 *   答對 3 題（畫面 1/11 → 4/11）→ 等 12 秒 → 0 次 PUT，
 *   DB `step_data['vocab-definition'].mcAnswers` 仍是 []，
 *   localStorage `vocabDef_progress_20011` 也是 `"mcAnswers":[]`。
 *   同一個 session 的 keypoints-table 填一格就送出 1 次 PUT 且 DB 有值 →
 *   傳輸層（debounce / dedup / dbSessionId）是好的，缺陷在元件層。
 *
 * 這裡斷言的是「答完 N 題，回報出去的 payload 就要有 N 筆」——用數量斷言，不是
 * 「有一筆就算過」。只驗一筆的話，把回報寫死成「只回報第一題」也會綠。
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Story } from '../../../types';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, token: null, isAuthenticated: false }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    zhuyinMode: 'none',
    zhuyinActive: false,
    zhuyinReady: true,
    processZhuyin: (t: string) => t,
    processLines: () => null,
    processLinesSelective: () => null,
    setZhuyinMode: vi.fn(),
    toggleZhuyin: vi.fn(),
  }),
  ZhuyinProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/learn/2839/vocab-definition', search: '', hash: '', state: null, key: 'k' }),
  useParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  NavLink: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import VocabDefinitionMatch from '../VocabDefinitionMatch';
import type { AnswerRecord } from '../vocabDefinitionMatchLogic';

// 三個語詞就夠證明「答 N 題 → 回報 N 筆」，而且答不完（不會誤觸 onAllDone
// 那條本來就會回報的路徑）—— 這個 lock 要守的正是「還沒答完的中途」。
const VOCAB = [
  { word: '龍爭虎鬥', definition: '形容像巨龍和猛虎般地相互爭鬥，難分高低。' },
  { word: '捶胸頓足', definition: '捶打胸膛，以腳跺地。形容極為悲憤或悔恨。' },
  { word: '摸不著頭緒', definition: '搞不清楚狀況的樣子。' },
  { word: '勢均力敵', definition: '雙方力量相當，不分上下。' },
];

const story = {
  id: '2839',
  title: '進度保存回歸測試',
  vocabulary: VOCAB,
} as unknown as Story;

/** MCQ 答對後有 1200ms 的鼓勵停留才換下一題（CORRECT_ADVANCE_DELAY_MS）。 */
const CORRECT_ADVANCE_DELAY_MS = 1200;

/**
 * 從最後一次 onProgressChange 的 payload 取出「已作答」的筆數。
 *
 * 看的是 `mcProgress`（作答中）而不是 `mcAnswers`（該模式的最終結果）：`mcDone`
 * 就是用 `mcAnswers.length > 0` 判的，中途答案若寫進 `mcAnswers`，學生答完第 1 題
 * 整個作答畫面就會被「選擇題 已完成」的結算畫面換掉。兩個欄位分開是刻意的。
 *
 * 陣列長度不等於作答數 —— 題目一開始就被預先填滿了未作答的空記錄，所以一律
 * 用 `answeredWordIdx !== null` 過濾。
 */
function answeredCountFromLastCall(spy: ReturnType<typeof vi.fn>): number {
  if (spy.mock.calls.length === 0) return -1;
  const payload = spy.mock.calls[spy.mock.calls.length - 1][0] as Record<string, unknown>;
  const mc = (payload.mcProgress ?? []) as AnswerRecord[];
  return mc.filter((a) => a.answeredWordIdx !== null).length;
}

function dismissCoachIfPresent() {
  const btn = screen.queryByRole('button', { name: '我知道了' });
  if (btn) fireEvent.click(btn);
}

/** 讀畫面上目前那一題的定義，點對應的正確語詞。 */
function answerCurrentQuestionCorrectly() {
  const item = VOCAB.find((v) => screen.queryByText(v.definition) !== null);
  if (!item) throw new Error('找不到目前題目的定義文字 — 測試沒真的答到題');
  fireEvent.click(screen.getByRole('button', { name: item.word }));
  act(() => {
    vi.advanceTimersByTime(CORRECT_ADVANCE_DELAY_MS + 50);
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('詞語理解 — 作答中的答案要進得了進度 payload（#2839）', () => {
  it('每答一題就要回報一次，且回報的筆數要等於已作答題數（不是等 11 題全答完才回報一次）', () => {
    vi.useFakeTimers();
    try {
      const onProgressChange = vi.fn();
      render(
        <VocabDefinitionMatch
          story={story}
          onFinish={vi.fn()}
          onProgressChange={onProgressChange}
        />,
      );
      dismissCoachIfPresent();

      // mount 當下會回報一次初始 payload（0 筆）—— 那次是好的，不是這個 bug。
      expect(answeredCountFromLastCall(onProgressChange)).toBe(0);

      // 逐題作答，每答完一題就斷言回報出去的筆數 == 已作答題數。
      // 4 個語詞只答 3 題 → 全程都在「還沒答完」的狀態。
      for (let answered = 1; answered <= 3; answered++) {
        answerCurrentQuestionCorrectly();
        expect(answeredCountFromLastCall(onProgressChange)).toBe(answered);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('作答中寫進 localStorage 的快照也要有答案（DB 與 L1 快取是同一個 payload，一起壞一起好）', () => {
    vi.useFakeTimers();
    try {
      render(<VocabDefinitionMatch story={story} onFinish={vi.fn()} onProgressChange={vi.fn()} />);
      dismissCoachIfPresent();

      answerCurrentQuestionCorrectly();
      answerCurrentQuestionCorrectly();

      const key = Object.keys(localStorage).find((k) => k.startsWith('vocabDef_progress_'));
      expect(key).toBeTruthy();
      const saved = JSON.parse(localStorage.getItem(key!) as string) as { mcProgress?: AnswerRecord[] };
      const answered = (saved.mcProgress ?? []).filter((a) => a.answeredWordIdx !== null);
      expect(answered).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('重新掛載時要從先前存下的進度接著答，不是從第 1 題重來', () => {
    vi.useFakeTimers();
    try {
      const onProgressChange = vi.fn();
      const { unmount } = render(
        <VocabDefinitionMatch story={story} onFinish={vi.fn()} onProgressChange={onProgressChange} />,
      );
      dismissCoachIfPresent();
      answerCurrentQuestionCorrectly();
      answerCurrentQuestionCorrectly();

      const savedPayload = onProgressChange.mock.calls[
        onProgressChange.mock.calls.length - 1
      ][0] as Record<string, unknown>;
      unmount();
      localStorage.clear(); // 只走 DB 那條路，證明還原不是靠 localStorage 撐著

      render(
        <VocabDefinitionMatch
          story={story}
          onFinish={vi.fn()}
          initialProgress={savedPayload}
          onProgressChange={vi.fn()}
        />,
      );
      dismissCoachIfPresent();

      // 答過的兩題不該再出現；畫面應該停在第 3 題。
      expect(screen.queryByText(VOCAB[0].definition)).toBeNull();
      expect(screen.queryByText(VOCAB[1].definition)).toBeNull();
      expect(screen.getByText(VOCAB[2].definition)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
