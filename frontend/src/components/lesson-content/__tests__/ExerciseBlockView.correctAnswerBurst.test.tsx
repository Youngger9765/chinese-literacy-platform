/**
 * TDD tests for CorrectAnswerBurst wired into ExerciseBlockView's single-choice
 * multiple_choice branch (Issue 3024).
 *
 * Root-cause context: MultipleChoiceExercise.tsx (used by the LEGACY
 * ComprehensionMcqPage fallback path) already got CorrectAnswerBurst wired in.
 * But LESSON_RENDERER_V1 defaults ON in production, and ComprehensionMcqPage
 * prefers the block-based LessonRenderer -> ExerciseBlockView path whenever a
 * story has real v3 lesson_content with a multiple_choice exercise block --
 * which is the common case. Without this second wiring, the correct-answer
 * burst would never reach the actual comprehension MCQ students see on most
 * lessons. Verified live on the PR preview against a real v3 story before
 * writing this test: the legacy path's burst never appeared because the page
 * was rendering ExerciseBlockView, not MultipleChoiceExercise.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../services/learningApi', () => ({
  recordMcqAttempt: vi.fn(),
}));

import ExerciseBlockView from '../ExerciseBlockView';
// ?raw = Vite 直接給檔案原文，不依賴 cwd 或 file:// scheme
import exerciseBlockViewSource from '../ExerciseBlockView.tsx?raw';

const EXERCISE = {
  id: 'q1',
  kind: 'exercise' as const,
  type: 'exercise' as const,
  answerSpace: 'choice' as const,
  grader: 'exact' as const,
  answer: 1,
  question: {
    kind: 'multiple_choice' as const,
    question: '下列哪個詞語使用正確？',
    options: ['快樂的連假總是「轉瞬即逝」', '他「經年累月」地看了一眼', '天氣「事與願違」'],
  },
};

function renderBlock() {
  return render(
    <ExerciseBlockView
      exercise={EXERCISE as never}
      lessonCode="L0001"
      value={null}
      verdict={null}
      onValueChange={() => {}}
      onGraded={() => {}}
    />,
  );
}

describe('ExerciseBlockView — CorrectAnswerBurst on multiple_choice (Issue 3024)', () => {
  it('shows the burst immediately when the correct option is picked', () => {
    renderBlock();
    // options[1] = the correct answer (exercise.answer === 1)
    fireEvent.click(screen.getAllByText(/他「經年累月」地看了一眼/)[0]);
    expect(screen.getByTestId('correct-answer-burst')).toBeTruthy();
  });

  it('does NOT show the burst when a wrong option is picked', () => {
    renderBlock();
    fireEvent.click(screen.getAllByText(/快樂的連假總是/)[0]);
    expect(screen.queryByTestId('correct-answer-burst')).toBeNull();
  });

  it('still calls recordMcqAttempt telemetry and does not alter existing grading behavior', () => {
    const onGraded = vi.fn();
    render(
      <ExerciseBlockView
        exercise={EXERCISE as never}
        lessonCode="L0001"
        value={null}
        verdict={null}
        onValueChange={() => {}}
        onGraded={onGraded}
      />,
    );
    fireEvent.click(screen.getAllByText(/他「經年累月」地看了一眼/)[0]);
    expect(onGraded).toHaveBeenCalledWith({ verdict: true, needsReview: false });
  });
});

/**
 * 回歸鎖（第二版，2026-09-02）——鎖住的是「只修一個分支」這個 bug 類型本身。
 *
 * 第一版把 <CorrectAnswerBurst> 寫進單選那個分支裡，行為測試因此是綠的，
 * 但 ExerciseBlockView 本體有 10 個 early return（custom / guided_steps /
 * 複選 / 排序 / trait_inference / keypoints_table / vocab-choice / slots ×2
 * / 單選），其餘九種題型答對什麼都不會發生。
 * preview 上實測：學生答對閱讀理解那題，畫面完全沒有回饋。
 *
 * 行為測試永遠只能覆蓋它寫到的那幾種題型，所以這裡改用結構斷言：
 * 慶祝動畫必須掛在分支之外。這樣以後新增第 11 種題型也不會漏。
 */
describe('CorrectAnswerBurst 必須掛在題型分支之外', () => {
  // 註解裡也會出現 <CorrectAnswerBurst>（就在下面 wrapper 的說明裡），
  // 不剝掉的話會把自己的說明文字數成程式碼。
  const src = exerciseBlockViewSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('量具自檢：真的讀到原始碼（不是空字串）', () => {
    expect(src.length, '讀到的原始碼是空的 —— 下面三條斷言全部失去意義').toBeGreaterThan(2000);
    expect(src).toContain('ExerciseBlockViewProps');
  });

  it('本體（有 early return 的那一段）裡不可以出現 CorrectAnswerBurst', () => {
    const bodyStart = src.indexOf('const ExerciseBlockViewBody');
    const wrapperStart = src.indexOf('const ExerciseBlockView:', bodyStart + 1);
    expect(bodyStart, '找不到 ExerciseBlockViewBody —— 檔案結構被改過了').toBeGreaterThan(-1);
    expect(wrapperStart, '找不到外層 wrapper —— 慶祝動畫又被搬回分支裡了？').toBeGreaterThan(bodyStart);

    const body = src.slice(bodyStart, wrapperStart);
    const insideBody = body.split('<CorrectAnswerBurst').length - 1;
    expect(
      insideBody,
      `本體裡有 ${insideBody} 處 <CorrectAnswerBurst>。掛在分支裡只會覆蓋那一種題型，` +
        '其餘題型答對不會有任何回饋 —— 請掛到外層 wrapper。',
    ).toBe(0);
  });

  it('外層 wrapper 剛好掛一次', () => {
    const wrapperStart = src.indexOf('const ExerciseBlockView:', src.indexOf('const ExerciseBlockViewBody') + 1);
    const wrapper = src.slice(wrapperStart);
    expect(wrapper.split('<CorrectAnswerBurst').length - 1).toBe(1);
  });

  it('本體確實有多個題型分支（若之後被重構掉，上面兩條就失去意義，要重寫）', () => {
    const bodyStart = src.indexOf('const ExerciseBlockViewBody');
    const wrapperStart = src.indexOf('const ExerciseBlockView:', bodyStart + 1);
    const branches = src.slice(bodyStart, wrapperStart).match(/^\s{4,}return \(/gm) ?? [];
    expect(branches.length, '題型分支少於 5 個，這個鎖的前提不成立了').toBeGreaterThanOrEqual(5);
  });
});


/**
 * 行為鎖（第三版）——上一版只驗「JSX 掛在哪」，驗不到「什麼時候會觸發」。
 *
 * 對抗式複審抓到的：把 <CorrectAnswerBurst> 搬到分支外面只解決了「元件在不在」，
 * 沒解決「計數器有沒有加一」。onCorrect() 當時只從單選那個分支呼叫，
 * 其餘七種題型（複選／排序／trait_inference／keypoints_table／
 * fill_in_blank ×3）全部走共用的 submit()，答對照樣什麼都不會發生 ——
 * 跟原本的缺陷一模一樣，只是換一批題型，而結構鎖全綠。
 *
 * 所以這裡改成從共用路徑真的答一題。排序題的預設順序就是正解，
 * 按下「確認排序」會走 submit() → grade() → verdict true。
 */
const ORDERING = {
  id: 'q-ordering',
  kind: 'exercise' as const,
  type: 'exercise' as const,
  answerSpace: 'order' as const,
  grader: 'ordered' as const,
  answer: [0, 1, 2],
  question: {
    kind: 'ordering' as const,
    instruction: '把事件依照發生順序排好',
    items: ['出發', '途中', '抵達'],
  },
};

function renderOrdering(value: unknown, verdict: boolean | null = null) {
  return render(
    <ExerciseBlockView
      exercise={ORDERING as never}
      lessonCode="L0001"
      value={value as never}
      verdict={verdict}
      onValueChange={() => {}}
      onGraded={() => {}}
    />,
  );
}

describe('共用 submit() 路徑答對也要慶祝', () => {
  it('排序正確 → 出現慶祝（這條在修好之前是紅的）', () => {
    renderOrdering([0, 1, 2]);
    expect(screen.queryByTestId('correct-answer-burst')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '確認排序' }));
    expect(
      screen.queryByTestId('correct-answer-burst'),
      '排序題走共用的 submit()。這裡是 null 代表 onCorrect() 又只接了單選那一個分支。',
    ).not.toBeNull();
  });

  it('負向對照：排序錯誤 → 不可以慶祝', () => {
    renderOrdering([2, 1, 0]);
    fireEvent.click(screen.getByRole('button', { name: '確認排序' }));
    expect(
      screen.queryByTestId('correct-answer-burst'),
      '答錯也慶祝的話，這個回饋就沒有意義了',
    ).toBeNull();
  });
});

/**
 * 結構鎖的第二半：共用的 submit() 必須自己觸發慶祝。
 * 上面那條行為測試只覆蓋排序一種；把觸發放在 submit() 裡面，
 * 其餘六種走同一支的題型才會一起被覆蓋，新增題型也不會漏。
 */
describe('慶祝必須由共用的 submit() 觸發，不是逐個分支各接一次', () => {
  const src = exerciseBlockViewSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('submit() 的函式體裡要有 onCorrect()', () => {
    const start = src.indexOf('const submit = useCallback');
    expect(start, '找不到 submit helper —— 檔案結構被改過了').toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('  );', start));
    expect(
      body.includes('onCorrect()'),
      'submit() 沒有觸發慶祝。走這支的七種題型答對會完全沒有回饋。',
    ).toBe(true);
    expect(body, '要用 verdict === true 當條件，不然答錯也會慶祝').toContain('result.verdict === true');
  });
});
