/**
 * AssessmentReportIntegration.test.tsx (#2835)
 *
 * End-to-end render tests reproducing the exact case owner report:
 * "學生做完整課，報告頁只看到 [3] 逐句分析對比，[5] 練習建議空白，
 *  [6] 課文理解力評估卡在『尚未完成課文理解對話』，已完成 3/6 環節也對不上
 *  10 顆步驟圓點".
 *
 * These simulate a REAL modern-flow session: reading via key-passage-reading
 * (fullReadingResult, not the disabled paragraph-reading), comprehension via
 * the MCQ step (comprehensionResult, no dialogue), plus several practice
 * steps completed (vocab-definition / vocab-application / keypoints-table).
 *
 * TDD-first: several of these assertions fail against the pre-fix component.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import AssessmentReport from '../AssessmentReport';
import { resolveActiveSteps } from '../../../config/stepConfig';
import type { LearningSession, Story } from '../../../types';
import type { StepProgressData } from '../../../services/learningApi';

vi.mock('../../../services/learningApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/learningApi')>(
    '../../../services/learningApi',
  );
  return {
    ...actual,
    getReadingHistory: vi.fn().mockResolvedValue([]),
  };
});

const REALISTIC_SESSION: LearningSession = {
  storyId: '77',
  startedAt: Date.now(),
  introCompleted: true,
  readingAttempt: null, // paragraph-reading is disabled in the live flow
  comprehensionResult: {
    // Produced by ComprehensionMcqPage — NOT dialogue-based
    understoodCount: 4,
    requiredCount: 5,
    isComplete: true,
    conversationLength: 0,
  },
  vocabResult: null,
  dictationResult: null,
  fullReadingResult: {
    matchRate: 0.92,
    feedback: '讀得很好！',
    cpm: 145,
    diffTokens: [{ char: '聲', type: 'wrong', expected: '生' }],
  },
  vocabDefinitionMatchCompleted: true,
  vocabApplicationCompleted: true,
  knowledgeStationCompleted: false,
  completedSteps: [
    'lesson-intro',
    'full-text-annotate',
    'key-passage-reading',
    'vocab-definition',
    'vocab-application',
    'keypoints-table',
    'comprehension',
  ],
};

const REALISTIC_STORY: Story = {
  id: '77',
  title: '測試課文',
  level: '4',
  content: ['第一段', '第二段'],
  thumbnail: '',
  category: 'Fable',
  filename: 'test.docx',
};

const REALISTIC_STEP_PROGRESS: StepProgressData = {
  current_step: 'comprehension',
  steps_completed: REALISTIC_SESSION.completedSteps ?? [],
  step_data: {
    'vocab-definition': { completed: true, result: { matchedCount: 7, totalCount: 8 } },
    'vocab-application': { score: 6, total: 8, completionRate: 0.75 },
    'keypoints-table': { completed: true },
  },
};

describe('AssessmentReport — realistic modern-flow session (#2835)', () => {
  it('does NOT show the empty 練習建議 placeholder when only fullReadingResult exists', () => {
    render(
      <AssessmentReport
        session={REALISTIC_SESSION}
        story={REALISTIC_STORY}
        onRetry={vi.fn()}
        stepProgressData={REALISTIC_STEP_PROGRESS}
      />,
    );
    expect(screen.queryByText('完成朗讀練習後會產生建議')).toBeNull();
  });

  it('does NOT show "尚未完成課文理解對話" when comprehensionResult (MCQ) exists', () => {
    render(
      <AssessmentReport
        session={REALISTIC_SESSION}
        story={REALISTIC_STORY}
        onRetry={vi.fn()}
        stepProgressData={REALISTIC_STEP_PROGRESS}
      />,
    );
    expect(screen.queryByText('尚未完成課文理解對話')).toBeNull();
  });

  it('renders the practice steps summary with the real vocab-definition score', () => {
    render(
      <AssessmentReport
        session={REALISTIC_SESSION}
        story={REALISTIC_STORY}
        onRetry={vi.fn()}
        stepProgressData={REALISTIC_STEP_PROGRESS}
      />,
    );
    expect(screen.getByText('詞語理解')).toBeTruthy();
    expect(screen.getByText('答對 7/8 題')).toBeTruthy();
    expect(screen.getByText('語詞應用')).toBeTruthy();
    expect(screen.getByText('答對 6/8 題')).toBeTruthy();
    expect(screen.getByText('文章重點表')).toBeTruthy();
  });

  it('shows the not-yet-completed practice step (knowledge-station) distinctly from completed ones', () => {
    render(
      <AssessmentReport
        session={REALISTIC_SESSION}
        story={REALISTIC_STORY}
        onRetry={vi.fn()}
        stepProgressData={REALISTIC_STEP_PROGRESS}
      />,
    );
    const knowledgeStationLabel = screen.getByText('知識補給站');
    const card = knowledgeStationLabel.closest('div');
    expect(card?.textContent).toContain('尚未完成');
  });

  it('分母就是真實啟用關卡數 —— 不是任何寫死的常數', () => {
    // Young 回報的原話是「已完成 3 / 6 環節？？？？？？ 明明就一堆環節啊」。
    // 症狀在**分母**，所以斷言必須打在分母的「值」上。
    //
    // 原本這裡只有一條負向斷言 not.toMatch(/\/\s*6\s*環節/)，它同時綁死了
    // 數字「6」跟舊措辭「環節」。把 totalActiveSteps 改回寫死的 6 之後，
    // 新分支印的是「/ 6 關卡」—— 不含「環節」，那條負向斷言照樣綠。
    // 實測：把 Young 抱怨的那個 bug 原樣裝回去，本 PR 全部 69 條測試不會紅。
    //
    // 所以改成正向、數量式的斷言：分母 === resolveActiveSteps 算出來的關卡數
    // （跟 StepperNav 那排圓點同源）。任何寫死的常數都會讓它紅。
    const { container } = render(
      <AssessmentReport
        session={REALISTIC_SESSION}
        story={REALISTIC_STORY}
        onRetry={vi.fn()}
        stepProgressData={REALISTIC_STEP_PROGRESS}
      />,
    );

    const expectedTotal = resolveActiveSteps(REALISTIC_STORY.stepSequence)
      .map((step) => step.id)
      .filter((id) => id !== 'report').length;

    // 掃描前提：算不出關卡數的話，下面的斷言會變成恆綠
    expect(expectedTotal).toBeGreaterThan(6);

    const matched = container.textContent?.match(/已完成\s*(\d+)\s*\/\s*(\d+)\s*關卡/);
    expect(matched).toBeTruthy();
    expect(Number(matched![2])).toBe(expectedTotal);
  });

  it('does NOT render a fixed "/ 6" denominator in the progress indicator', () => {
    const { container } = render(
      <AssessmentReport
        session={REALISTIC_SESSION}
        story={REALISTIC_STORY}
        onRetry={vi.fn()}
        stepProgressData={REALISTIC_STEP_PROGRESS}
      />,
    );
    expect(container.textContent).not.toMatch(/\/\s*6\s*環節/);
  });
});

describe('AssessmentReport — teacher/history views without completedSteps data (#2835 no-regression)', () => {
  // Teacher (TeacherSessionReportPage) and student history (SessionHistoryReportPage)
  // build LearningSession from a different backend response that never sets
  // completedSteps. Without the hasStepCompletionData guard, a FULLY completed
  // historical session would wrongly show "已完成 0 / N 關卡" and every practice
  // step as "尚未完成" — this must not happen.
  const HISTORY_SESSION: LearningSession = {
    storyId: '77',
    startedAt: Date.now(),
    introCompleted: true,
    readingAttempt: null,
    comprehensionResult: {
      understoodCount: 4,
      requiredCount: 5,
      isComplete: true,
      conversationLength: 0,
    },
    vocabResult: null,
    dictationResult: null,
    fullReadingResult: {
      matchRate: 0.92,
      feedback: '讀得很好！',
      cpm: 145,
      diffTokens: [],
    },
    // completedSteps deliberately omitted — mirrors buildLearningSession()/buildSession()
  };

  it('does not render the new practice-steps summary section when completedSteps is absent', () => {
    render(<AssessmentReport session={HISTORY_SESSION} story={REALISTIC_STORY} onRetry={vi.fn()} readOnly />);
    expect(screen.queryByText('練習關卡總覽')).toBeNull();
    expect(screen.queryByText('詞語理解')).toBeNull();
  });

  it('does not show a false "已完成 0" progress indicator when completedSteps is absent', () => {
    const { container } = render(
      <AssessmentReport session={HISTORY_SESSION} story={REALISTIC_STORY} onRetry={vi.fn()} readOnly />,
    );
    expect(container.textContent).not.toMatch(/已完成\s*0\s*\/\s*\d+\s*關卡/);
  });
});
