/**
 * ComprehensionMcqPage.test.tsx — 閱讀理解只該有選擇題（#2779）
 *
 * `story.fillInBlank`（語詞應用的填空句）已經是獨立步驟「語詞應用」
 * （`vocab-application` / `VocabApplication.tsx` → `FillInBlankExercise`）的專屬內容，
 * 完全不經過 `storyToLesson`/`LessonRenderer`。但 `ComprehensionMcqPage` 把
 * `storyToLesson(story).lesson`（同時含 multiple_choice **和** fill_in_blank 兩種
 * exercise block）整份原封不動傳給 `LessonRenderer`，於是：
 *   (a) 學生在「語詞應用」答完的 8 句，在「閱讀理解」又原封不動看到一次；
 *   (b) `LessonRenderer` 的 `allDone` 把非 custom/非 needsReview 的 exercise 全算
 *       進分母，「閱讀理解完成」被撐大成要答對 13 題，不是產品設計要的 5 題。
 *
 * fixture 是真實 lesson 20011 的 API 回應（`curl .../api/stories/20011`，未竄改），
 * 跟 #2775/#2777 分頁修復用的同一份 — 兩邊各自的 regression lock 用同一組真資料，
 * 不是巧合，是因為這兩個 bug 是同一次線上 QA 交叉發現的。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import rawStory20011 from '../../../components/lesson-content/__tests__/fixtures/story-20011-comprehension.json';
import rawStory20055 from './fixtures/story-20055-mcq-zero.json';
import type { Story } from '../../../types';

vi.mock('../../../layouts/LearningLayout', () => ({
  useLearningContext: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { useLearningContext } from '../../../layouts/LearningLayout';
import ComprehensionMcqPage from '../ComprehensionMcqPage';

// 與 `api.ts` apiDetailToStory 相同的 legacy-schema 篩選（#1559/#1563），跟
// oneAtATime.test.tsx（#2777）的轉換方式一致，兩邊用同一份 raw fixture。
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

// 正確答案文字：從 fixture 自己的 `answer`（字母）+ `options` 算出來，不是手抄一份會
// 跟來源脫鉤的字串陣列——fixture 之後若重新 curl 更新，這裡不需要跟著手動同步。
const LETTER_TO_INDEX = (letter: string) => letter.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
const CORRECT_OPTION_TEXT = story.multipleChoice!.map(
  (mcq) => mcq.options![LETTER_TO_INDEX(mcq.answer as string)],
);

const mockHandleFinishComprehension = vi.fn();
const mockSaveStepProgressPatch = vi.fn();

function setup() {
  vi.mocked(useLearningContext).mockReturnValue({
    selectedStory: story,
    handleFinishComprehension: mockHandleFinishComprehension,
    dbSessionId: 'sess-test',
    saveStepProgressPatch: mockSaveStepProgressPatch,
  } as unknown as ReturnType<typeof useLearningContext>);
  return render(<ComprehensionMcqPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('閱讀理解只該有選擇題，語詞應用的填空句不該混進來（#2779）', () => {
  it('第一題選擇題的題幹要在畫面上', () => {
    const { container } = setup();
    expect(container.textContent).toContain('請問「勢均力敵」，可以用哪個詞語替換？');
  });

  it('8 句 fill_in_blank 一句都不該出現在 DOM 裡 —— 不是分頁藏起來，是根本不該被送進這個 lesson', () => {
    const { container } = setup();
    for (const item of fillInBlank) {
      expect(container.textContent).not.toContain(item.sentence);
    }
    // 答題區的按鈕總數該剛好是 4（第一題 MCQ 的 A-D），證明不是「fill_in_blank 區塊
    // 還在,只是句子被裁掉」這種半吊子修法（那樣詞庫按鈕還是會在）。
    // ⚠️ 原本想額外檢查 vocabBank 的詞（疑難雜症/勢均力敵…）整區不該出現,但這份真實
    // fixture 裡 vocabBank 跟 MCQ 選項/題幹用字本來就有重疊（「勢均力敵」同時是
    // 第一題題幹、「喝采」同時是課文標題）,用字串比對會把合法內容當假陽性,改用
    // 結構化的按鈕數量斷言。
    const answerArea = container.querySelector('[aria-label*="作答區"]');
    expect(answerArea).toBeTruthy();
    expect(answerArea!.querySelectorAll('button[role="radio"]').length).toBe(4);
  });

  it('分頁分母是 5（只算選擇題），不是 13', () => {
    const { container } = setup();
    expect(container.textContent).toMatch(/1\s*\/\s*5/);
    expect(container.textContent).not.toMatch(/1\s*\/\s*13/);
  });

  it('答對全部 5 題選擇題後就完成 —— 不需要再回答任何 fill_in_blank', () => {
    setup();
    for (let i = 0; i < CORRECT_OPTION_TEXT.length; i++) {
      fireEvent.click(screen.getByText(CORRECT_OPTION_TEXT[i]));
      if (i < CORRECT_OPTION_TEXT.length - 1) {
        fireEvent.click(screen.getByRole('button', { name: /下一題/ }));
      }
    }
    // LessonRenderer 的 onComplete 觸發 handleMcqComplete(5, 5) → mcqDone=true → NextStepFooter 出現。
    expect(screen.getByText(/下一步|下一關/)).toBeTruthy();
  });
});

/**
 * 工頭複核（2026-08-20）獨立掃了全庫 175 課，抓到我沒查的一塊：**23 課（13%）
 * multiple_choice 是 0 題,但 fill_in_blank 有 8 題**——過濾成「只留 multiple_choice」
 * 之後,這 23 課閱讀理解的 exercise blocks 會變空集合。工頭當時的判斷是「會變空白頁」，
 * 要求「過濾後 0 題 → 誠實空狀態,不准空白頁、不准自動完成」。
 *
 * 查證後：**不是空白頁**——`hasMcq`（`selectedStory.multipleChoice` 是否非空）這個既有判準
 * 完全不受這次過濾影響，0 題時原本就會落到既有的「此課文尚未有選擇題」空狀態
 * ＋手動「跳過，下一關」按鈕（`ComprehensionMcqPage.tsx` 這段邏輯本來就在，不是這次新寫的）。
 * 但工頭要的「用其中一課真實 payload 鎖住這個行為」是對的要求，之前沒鎖——
 * 鬼打牆偵測：口頭複述「應該沒問題」不算，跟前面幾條一樣一定要真的跑一次。
 *
 * fixture 是真實 20055（`愛冒險逞強的雄性動物`）的 API 回應，工頭 23 課清單裡的其中一課。
 */
describe('MCQ=0 但 fill_in_blank>0 的課（23 課裡的其中一課,#2779 工頭複核）', () => {
  const story20055: Story = {
    ...(rawStory20055 as unknown as Story),
    id: String((rawStory20055 as { id: number }).id),
    lesson_code: (rawStory20055 as { grade_code: string }).grade_code,
    // 落到 hasMcq=false 分支時走的是 legacy `ComprehensionLayout`（`story.content.join(...)`），
    // 跟 apiDetailToStory 一樣把 `content` 對應到 raw 的 `paragraphs`——20011 那份 fixture
    // 沒補這個是因為它 hasMcq=true，走的是 LessonRenderer，從沒踩過這條 legacy 分支。
    content: (rawStory20055 as { paragraphs: string[] }).paragraphs,
    multipleChoice: (rawStory20055 as { multiple_choice: Story['multipleChoice'] }).multiple_choice ?? undefined,
    fillInBlank: (rawStory20055 as { fill_in_blank: Story['fillInBlank'] }).fill_in_blank,
    vocabBank: (rawStory20055 as { vocab_bank: Story['vocabBank'] }).vocab_bank,
  } as Story;

  function setupZero() {
    vi.mocked(useLearningContext).mockReturnValue({
      selectedStory: story20055,
      handleFinishComprehension: mockHandleFinishComprehension,
      dbSessionId: 'sess-test',
      saveStepProgressPatch: mockSaveStepProgressPatch,
    } as unknown as ReturnType<typeof useLearningContext>);
    return render(<ComprehensionMcqPage />);
  }

  it('fixture 真的是 MCQ=0、fill_in_blank>0（先確認不是我編錯資料）', () => {
    expect(story20055.multipleChoice ?? []).toHaveLength(0);
    expect((story20055.fillInBlank ?? []).length).toBeGreaterThan(0);
  });

  it('不是空白頁 —— 顯示誠實的「此課文尚未有選擇題」空狀態，不是 fill_in_blank 內容', () => {
    const { container } = setupZero();
    expect(container.textContent).toContain('此課文尚未有選擇題');
    // 也不能悄悄把 fill_in_blank 塞回來充數。
    for (const item of story20055.fillInBlank ?? []) {
      expect(container.textContent).not.toContain((item as { sentence: string }).sentence);
    }
  });

  it('不會自動判定完成 —— 沒有按「跳過」之前 handleFinishComprehension 不該被呼叫', () => {
    setupZero();
    expect(mockHandleFinishComprehension).not.toHaveBeenCalled();
  });

  it('學生仍可主動按「跳過，下一關」前進（既有行為，過濾後不能被弄壞）', () => {
    setupZero();
    fireEvent.click(screen.getByRole('button', { name: /跳過，下一關/ }));
    expect(mockHandleFinishComprehension).toHaveBeenCalledTimes(1);
  });
});
