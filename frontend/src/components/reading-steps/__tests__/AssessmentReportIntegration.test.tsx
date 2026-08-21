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
