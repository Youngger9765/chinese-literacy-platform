/**
 * ComprehensionMcqPage.progressPersistence.test.tsx — 閱讀理解作答中的答案要進 DB（#2839）
 *
 * 這一關的失敗形狀跟詞語理解不同，但同一個 class：
 * `LessonRenderer` 每答一題都會 emit `onExerciseChange({ answers, feedback, ... })`
 * （見 LessonRenderer.tsx 的 `useEffect(..., [answers, feedback, allDone])`），
 * 但 `ComprehensionMcqPage` 只把它接到 `absorbInto`（純計分，寫進 `firstTry` state），
 * 從來沒有轉給 `handleProgressChange` → `saveStepProgressPatch`。
 * 真正呼叫 `handleProgressChange` 的只有 `handleMcqComplete`（全部答完）跟
 * `handleNext` / `handleSkip`（離開這一步）。
 *
 * 於是 payload 內容在作答中完全不變 → `persistStepProgressState` 的
 * `prevSig === nextSig` 判定沒變化 → 不呼叫 `syncProgress` → 0 次 PUT。
 *
 * 2026-08-21 staging 實測（真瀏覽器 + network tab，session 1931）：
 *   答完第 1 題（radio checked=true、畫面前進到第 2 題）→ 等 9 秒 → 0 次 PUT，
 *   DB 的 `step_data` 連 `comprehension` 這個 key 都沒有。
 *
 * 另一半是還原：`LessonRenderer` 早就吃 `initialState.answers` / `initialState.feedback`
 * （lazy useState initializer），但這一頁從來沒傳過 —— 存了讀不回來等於沒存，
 * 所以這裡連還原一起鎖。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import rawStory20011 from '../../../components/lesson-content/__tests__/fixtures/story-20011-comprehension.json';
import type { Story } from '../../../types';

vi.mock('../../../layouts/LearningLayout', () => ({
  useLearningContext: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/learn/20011/comprehension' }),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { useLearningContext } from '../../../layouts/LearningLayout';
import ComprehensionMcqPage from '../ComprehensionMcqPage';

// 與既有 ComprehensionMcqPage.test.tsx 相同的 fixture 轉換（真實 lesson 20011 的 API 回應）。
const rawFillInBlank = (rawStory20011 as { fill_in_blank: Array<Record<string, unknown>> }).fill_in_blank;
const fillInBlank = rawFillInBlank.filter(
  (item) => item['_schema'] === 'legacy' || (typeof item['sentence'] === 'string' && !('context_before' in item)),
) as Array<{ sentence: string; answer: string }>;

const story: Story = {
  ...(rawStory20011 as unknown as Story),
  id: String((rawStory20011 as { id: number }).id),
  lesson_code: (rawStory20011 as { grade_code: string }).grade_code,
  multipleChoice: (rawStory20011 as { multiple_choice: Story['multipleChoice'] }).multiple_choice,
  fillInBlank,
  vocabBank: (rawStory20011 as { vocab_bank: Story['vocabBank'] }).vocab_bank,
} as Story;

const LETTER_TO_INDEX = (letter: string) => letter.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
const CORRECT_OPTION_TEXT = story.multipleChoice!.map(
  (mcq) => mcq.options![LETTER_TO_INDEX(mcq.answer as string)],
);

const mockSaveStepProgressPatch = vi.fn();

function setup(stepProgressData?: Record<string, unknown>) {
  vi.mocked(useLearningContext).mockReturnValue({
    selectedStory: story,
    handleFinishComprehension: vi.fn(),
    dbSessionId: 1931,
    saveStepProgressPatch: mockSaveStepProgressPatch,
    stepProgressData: stepProgressData ?? { current_step: null, steps_completed: [], step_data: {} },
  } as unknown as ReturnType<typeof useLearningContext>);
  return render(<ComprehensionMcqPage />);
}

/**
 * 重演 `persistStepProgressState` 對 step_data 的合併，得出「DB 裡最後長怎樣」。
 *
 * 合併只做**一層**（`{ ...prevStepEntry, ...patch }`，見 useStepProgressPersistence.ts
 * 的 #2530 註解）：patch 沒帶的 key 會沿用舊值，帶了的 key 則是整包換掉 ——
 * `answers` 是一個 dict，所以送一份只含 1 題的 answers 會把先前 5 題整包蓋掉。
 *
 * 不能只看「最後一次呼叫」：交卷那次 patch 只帶 `{ mcqScore, mcqTotal }`，
 * 沒有 `answers`，看最後一次會得到 0 而誤判成資料掉了（實際上舊值有被保留）。
 */
function mergedStepData(): Record<string, unknown> {
  let acc: Record<string, unknown> = {};
  for (const call of mockSaveStepProgressPatch.mock.calls) {
    const { stepData } = call[0] as { stepData?: Record<string, unknown> };
    acc = { ...acc, ...(stepData ?? {}) };
  }
  return acc;
}

/** DB 裡最後會有幾筆作答。 */
function savedAnswerCount(): number {
  if (mockSaveStepProgressPatch.mock.calls.length === 0) return -1;
  const answers = (mergedStepData().answers ?? {}) as Record<string, unknown>;
  return Object.keys(answers).length;
}

function lastSavedStepData(): Record<string, unknown> {
  const calls = mockSaveStepProgressPatch.mock.calls;
  const last = calls[calls.length - 1][0] as { stepData?: Record<string, unknown> };
  return last.stepData ?? {};
}

/** 答對第 i 題（0-based），若不是最後一題就按「下一題」。 */
function answerQuestion(i: number) {
  fireEvent.click(screen.getByText(CORRECT_OPTION_TEXT[i]));
  if (i < CORRECT_OPTION_TEXT.length - 1) {
    fireEvent.click(screen.getByRole('button', { name: /下一題/ }));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('閱讀理解 — 作答中的答案要存進 DB（#2839）', () => {
  it('每答一題就要 patch 一次進度，存下的筆數要等於已作答題數', () => {
    setup();

    // 3 題就好 —— 全部 5 題答完會走 handleMcqComplete，那條路徑本來就會存，
    // 這個 lock 要守的是「還沒答完的中途」。
    for (let i = 0; i < 3; i++) {
      answerQuestion(i);
      expect(savedAnswerCount()).toBe(i + 1);
    }
  });

  it('存下的 stepData 要帶 feedback（對錯），否則重新載入只知道選了什麼、不知道對不對', () => {
    setup();
    answerQuestion(0);

    const stepData = lastSavedStepData();
    expect(stepData.feedback).toBeTruthy();
    expect(Object.keys(stepData.feedback as Record<string, unknown>)).toHaveLength(1);
  });

  it('作答中的 patch 不可標記步驟完成 —— 只是進度快照，不是交卷', () => {
    setup();
    answerQuestion(0);

    const calls = mockSaveStepProgressPatch.mock.calls;
    const last = calls[calls.length - 1][0] as { markCompleted?: boolean; stepId?: string };
    expect(last.stepId).toBe('comprehension');
    expect(last.markCompleted ?? false).toBe(false);
  });

  it('「重做錯題」中途離開，不可以把先前答對的那幾題從進度裡刷掉（code review 抓到的）', () => {
    setup();

    // 第 1 題先答錯再答對（製造一題錯題，完成卡才會有「重做錯題」）。
    const q0 = story.multipleChoice![0];
    const wrongIdx = q0.options!.findIndex((o) => o !== CORRECT_OPTION_TEXT[0]);
    fireEvent.click(screen.getByText(q0.options![wrongIdx]));
    fireEvent.click(screen.getByRole('button', { name: '再試一次' }));
    fireEvent.click(screen.getByText(CORRECT_OPTION_TEXT[0]));
    fireEvent.click(screen.getByRole('button', { name: /下一題/ }));
    for (let i = 1; i < CORRECT_OPTION_TEXT.length; i++) {
      answerQuestion(i);
    }

    const fullCount = CORRECT_OPTION_TEXT.length;
    expect(savedAnswerCount()).toBe(fullCount);

    // 完成卡 →「重做錯題」：這裡會掛一個「只含錯題」的新 LessonRenderer，
    // 它內部的 answers/feedback 從空的開始，只會累積被重做的那幾題。
    fireEvent.click(screen.getByRole('button', { name: /重做錯題/ }));
    fireEvent.click(screen.getByText(CORRECT_OPTION_TEXT[0]));

    // 若把 e.answers 原封不動 patch 上去，step_data 的 answers 會從 5 題縮成 1 題
    // （persistStepProgressState 的 merge 只做一層，answers 是整包換掉）。
    // 學生這時關掉分頁，重新載入就只剩 1 題，其餘 4 題要重答 —— 正是 #2839 本身。
    expect(savedAnswerCount()).toBe(fullCount);
  });

  it('重新掛載時要從 DB 的 step_data 還原先前的作答，不是從空白重來', () => {
    const { unmount } = setup();
    for (let i = 0; i < CORRECT_OPTION_TEXT.length; i++) answerQuestion(i);
    const saved = mergedStepData();
    expect(Object.keys((saved.answers ?? {}) as Record<string, unknown>)).toHaveLength(
      CORRECT_OPTION_TEXT.length,
    );

    unmount();
    vi.clearAllMocks();

    // 用剛剛存下的 step_data 重新掛載（模擬重新載入頁面）。
    setup({ current_step: 'comprehension', steps_completed: [], step_data: { comprehension: saved } });

    // 一下都沒點，完成卡就要直接出現。
    //
    // ⚠️ 這裡刻意斷言「畫面」而不是「存回去的 payload」：page 自己也從
    // `stepProgressData` 種了一份 answers 的累加器，所以就算 `initialState` 沒接上
    // LessonRenderer，patch 出去的筆數一樣會是對的 —— 那個斷言證明不了還原。
    // 完成卡要出現，得靠 LessonRenderer 用還原的 `feedback` 自己算出 `allDone`，
    // 只有 `initialState` 真的接上才可能發生。（這一條是 mutation 測出來的：
    // 拿掉 initialState 之後舊斷言仍然綠。）
    expect(screen.getByText('全部答對！')).toBeInTheDocument();
  });
});
