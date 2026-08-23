/**
 * AssessmentComprehensionSectionMcqFallback.test.tsx (#2835)
 *
 * Root cause: AssessmentComprehensionSection only ever looked at
 * comprehensionScores (populated ONLY when the student went through the old
 * Socratic-dialogue comprehension flow). The live flow's 閱讀理解 step is now
 * MCQ-only (ComprehensionMcqPage) and produces comprehensionResult
 * (understoodCount/requiredCount) — which never generates dialogue turns, so
 * comprehensionScores stays null forever and the section always showed
 * "尚未完成課文理解對話" even after the student finished 閱讀理解.
 *
 * TDD-first: the `comprehensionResult` prop does not exist on this component
 * yet — these tests must fail until it's wired in.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { AssessmentComprehensionSection } from '../AssessmentComprehensionSection';
import type { ComprehensionResult } from '../../../types';

const MCQ_RESULT: ComprehensionResult = {
  understoodCount: 4,
  requiredCount: 5,
  isComplete: true,
  conversationLength: 0,
};

describe('AssessmentComprehensionSection — MCQ fallback (#2835)', () => {
  it('shows the "尚未完成" placeholder when neither comprehensionScores nor comprehensionResult exist', () => {
    render(
      <AssessmentComprehensionSection
        comprehensionScores={null}
        comprehensionScoresLoading={false}
        comprehensionResult={null}
        hideScores={false}
      />,
    );
    expect(screen.getByText('尚未完成課文理解對話')).toBeTruthy();
  });

  it('shows an MCQ score card (not the dialogue placeholder) when comprehensionResult exists but comprehensionScores does not', () => {
    render(
      <AssessmentComprehensionSection
        comprehensionScores={null}
        comprehensionScoresLoading={false}
        comprehensionResult={MCQ_RESULT}
        hideScores={false}
      />,
    );
    expect(screen.queryByText('尚未完成課文理解對話')).toBeNull();
    expect(screen.getByText('4/5')).toBeTruthy();
    expect(screen.getByText('閱讀理解測驗')).toBeTruthy();
  });

  it('hides the raw numeric score in student view (hideScores=true) for the MCQ fallback card', () => {
    render(
      <AssessmentComprehensionSection
        comprehensionScores={null}
        comprehensionScoresLoading={false}
        comprehensionResult={MCQ_RESULT}
        hideScores={true}
      />,
    );
    // "4/5" (the raw count) must not leak into student view
    expect(screen.queryByText('4/5')).toBeNull();
  });

  it('still prefers the 3-level comprehensionScores card when both exist (dialogue path unchanged)', () => {
    render(
      <AssessmentComprehensionSection
        comprehensionScores={{
          comprehension_score: 75,
          literal_score: 80,
          inferential_score: 70,
          evaluative_score: 75,
          feedback: null,
        }}
        comprehensionScoresLoading={false}
        comprehensionResult={MCQ_RESULT}
        hideScores={false}
      />,
    );
    // The 3-level card renders literal/inferential/evaluative labels — the
    // MCQ fallback card does not. Presence of this label proves the
    // 3-level card won, not the MCQ fallback.
    expect(screen.getByText('字面理解')).toBeTruthy();
  });

  it('still shows the loading state when comprehensionScoresLoading=true, even if comprehensionResult exists', () => {
    render(
      <AssessmentComprehensionSection
        comprehensionScores={null}
        comprehensionScoresLoading={true}
        comprehensionResult={MCQ_RESULT}
        hideScores={false}
      />,
    );
    expect(screen.queryByText('尚未完成課文理解對話')).toBeNull();
  });
});
