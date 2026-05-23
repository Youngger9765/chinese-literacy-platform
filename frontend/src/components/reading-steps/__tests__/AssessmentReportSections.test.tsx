/**
 * Characterization tests for AssessmentReport section components (#1945).
 *
 * TDD-first: these tests MUST fail until the section components are extracted.
 *
 * Covers:
 *   1. Section wrapper — render, collapse toggle, disabled state
 *   2. IntelligentAnalysisSection (環節二) — transcription, stats cards, empty state
 *   3. ErrorWordListSection (環節四) — wrongTokens, missingChars, TTS button, empty state
 *   4. PracticeRecommendationSection (環節五) — suggestions list, empty state
 *
 * Note: Sections 1 (AssessmentReadingSummary), 3 (AssessmentDiffSection),
 * and 6 (AssessmentComprehensionSection) are already extracted in #1845.
 * This test file covers the three sections remaining inline after #1845.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import AssessmentSectionWrapper from '../AssessmentSectionWrapper';
import IntelligentAnalysisSection from '../IntelligentAnalysisSection';
import ErrorWordListSection from '../ErrorWordListSection';
import PracticeRecommendationSection from '../PracticeRecommendationSection';

/* ------------------------------------------------------------------ */
/*  Mocks                                                               */
/* ------------------------------------------------------------------ */

// Mock TTS so speakText calls don't throw
vi.mock('../../../services/ttsApi', () => ({
  speakText: vi.fn().mockResolvedValue(undefined),
}));

/* ------------------------------------------------------------------ */
/*  Fixtures                                                            */
/* ------------------------------------------------------------------ */

const WRONG_TOKENS = [
  { char: '好', expected: '壞' },
  { char: '天', expected: '地' },
];

const MISSING_CHARS = ['風', '雨', '雷'];

const SEGMENT_STATS = {
  correct: 5,
  wrong: 2,
  missing: 1,
  total: 8,
};

const SUGGESTIONS = [
  { icon: '🔊', title: '聽正確發音', desc: '點擊上方錯字詞旁的喇叭按鈕，反覆聆聽正確讀法。' },
  { icon: '🔄', title: '反覆練習錯誤詞語', desc: '把讀錯的字詞抄寫三遍，邊寫邊唸出聲音。' },
];

/* ------------------------------------------------------------------ */
/*  1. AssessmentSectionWrapper                                         */
/* ------------------------------------------------------------------ */

describe('AssessmentSectionWrapper', () => {
  it('renders the section number and title', () => {
    render(
      <AssessmentSectionWrapper number={2} title="錄音內容與智能分析">
        <div>content</div>
      </AssessmentSectionWrapper>,
    );
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('錄音內容與智能分析')).toBeTruthy();
  });

  it('renders children when defaultOpen=true', () => {
    render(
      <AssessmentSectionWrapper number={1} title="Test" defaultOpen={true}>
        <div data-testid="child-content">Hello</div>
      </AssessmentSectionWrapper>,
    );
    expect(screen.getByTestId('child-content')).toBeTruthy();
  });

  it('hides children when defaultOpen=false', () => {
    render(
      <AssessmentSectionWrapper number={1} title="Test" defaultOpen={false}>
        <div data-testid="child-content">Hello</div>
      </AssessmentSectionWrapper>,
    );
    expect(screen.queryByTestId('child-content')).toBeNull();
  });

  it('toggles open/closed when header is clicked', () => {
    render(
      <AssessmentSectionWrapper number={1} title="Toggleable" defaultOpen={true}>
        <div data-testid="child-content">Hello</div>
      </AssessmentSectionWrapper>,
    );
    // Initially open
    expect(screen.getByTestId('child-content')).toBeTruthy();
    // Click header to close
    fireEvent.click(screen.getByText('Toggleable'));
    expect(screen.queryByTestId('child-content')).toBeNull();
    // Click header to open again
    fireEvent.click(screen.getByText('Toggleable'));
    expect(screen.getByTestId('child-content')).toBeTruthy();
  });

  it('does NOT toggle when disabled=true', () => {
    render(
      <AssessmentSectionWrapper number={1} title="Disabled" disabled={true} defaultOpen={true}>
        <div data-testid="child-content">Hello</div>
      </AssessmentSectionWrapper>,
    );
    // Clicking should not toggle
    fireEvent.click(screen.getByText('Disabled'));
    // Still open (disabled cannot collapse)
    expect(screen.getByTestId('child-content')).toBeTruthy();
  });

  it('applies disabled styling when disabled=true', () => {
    const { container } = render(
      <AssessmentSectionWrapper number={1} title="Disabled" disabled={true}>
        <div>x</div>
      </AssessmentSectionWrapper>,
    );
    // The outer div should have dashed border class
    expect(container.innerHTML).toContain('border-dashed');
  });
});

/* ------------------------------------------------------------------ */
/*  2. IntelligentAnalysisSection (環節二)                              */
/* ------------------------------------------------------------------ */

describe('IntelligentAnalysisSection', () => {
  it('renders transcription text when provided', () => {
    render(
      <IntelligentAnalysisSection
        transcription="今天天氣很好"
        lineBreakdown={[]}
        segmentStats={SEGMENT_STATS}
        hideScores={false}
        hasReadingData={true}
      />,
    );
    expect(screen.getByText('今天天氣很好')).toBeTruthy();
  });

  it('does not render transcription block when empty', () => {
    render(
      <IntelligentAnalysisSection
        transcription="  "
        lineBreakdown={[]}
        segmentStats={SEGMENT_STATS}
        hideScores={false}
        hasReadingData={true}
      />,
    );
    expect(screen.queryByText('語音轉文字')).toBeNull();
  });

  it('renders 4 stat cards (correct/wrong/missing/total) when hideScores=false and lineBreakdown present', () => {
    render(
      <IntelligentAnalysisSection
        transcription=""
        lineBreakdown={[{ lineIndex: 0, matchRate: 1, cpm: 100, transcript: 'a', diffTokens: [] }]}
        segmentStats={SEGMENT_STATS}
        hideScores={false}
        hasReadingData={true}
      />,
    );
    expect(screen.getByText('正確')).toBeTruthy();
    expect(screen.getByText('讀錯')).toBeTruthy();
    expect(screen.getByText('遺漏')).toBeTruthy();
    expect(screen.getByText('總計')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy(); // correct count
    expect(screen.getByText('2')).toBeTruthy(); // wrong count
  });

  it('hides stat cards when hideScores=true (student view)', () => {
    render(
      <IntelligentAnalysisSection
        transcription=""
        lineBreakdown={[{ lineIndex: 0, matchRate: 1, cpm: 100, transcript: 'a', diffTokens: [] }]}
        segmentStats={SEGMENT_STATS}
        hideScores={true}
        hasReadingData={true}
      />,
    );
    expect(screen.queryByText('正確')).toBeNull();
    expect(screen.queryByText('讀錯')).toBeNull();
  });

  it('shows empty state when no reading data', () => {
    render(
      <IntelligentAnalysisSection
        transcription=""
        lineBreakdown={[]}
        segmentStats={{ correct: 0, wrong: 0, missing: 0, total: 0 }}
        hideScores={false}
        hasReadingData={false}
      />,
    );
    expect(screen.getByText('尚未完成朗讀練習')).toBeTruthy();
  });

  it('shows fallback message when no transcription and no lineBreakdown', () => {
    render(
      <IntelligentAnalysisSection
        transcription=""
        lineBreakdown={[]}
        segmentStats={{ correct: 0, wrong: 0, missing: 0, total: 0 }}
        hideScores={false}
        hasReadingData={true}
      />,
    );
    expect(screen.getByText(/語音辨識資料不足/)).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  3. ErrorWordListSection (環節四)                                    */
/* ------------------------------------------------------------------ */

describe('ErrorWordListSection', () => {
  it('renders wrong tokens list', () => {
    render(
      <ErrorWordListSection
        wrongTokens={WRONG_TOKENS}
        missingChars={[]}
        onGoToVocab={undefined}
        hasReadingAttempt={true}
      />,
    );
    expect(screen.getByText('好')).toBeTruthy();
    expect(screen.getByText('壞')).toBeTruthy();
    expect(screen.getByText('天')).toBeTruthy();
    expect(screen.getByText('地')).toBeTruthy();
  });

  it('renders missing chars as buttons', () => {
    render(
      <ErrorWordListSection
        wrongTokens={[]}
        missingChars={MISSING_CHARS}
        onGoToVocab={undefined}
        hasReadingAttempt={true}
      />,
    );
    expect(screen.getByText('風')).toBeTruthy();
    expect(screen.getByText('雨')).toBeTruthy();
    expect(screen.getByText('雷')).toBeTruthy();
  });

  it('shows count label for wrong tokens', () => {
    render(
      <ErrorWordListSection
        wrongTokens={WRONG_TOKENS}
        missingChars={[]}
        onGoToVocab={undefined}
        hasReadingAttempt={true}
      />,
    );
    expect(screen.getByText(/共 2 個/)).toBeTruthy();
  });

  it('shows TTS speak button for each wrong token', () => {
    render(
      <ErrorWordListSection
        wrongTokens={WRONG_TOKENS}
        missingChars={[]}
        onGoToVocab={undefined}
        hasReadingAttempt={true}
      />,
    );
    // Each token has a "聽發音" button
    const speakBtns = screen.getAllByTitle('聽發音');
    expect(speakBtns).toHaveLength(2);
  });

  it('shows "去生字練習" button when onGoToVocab is provided', () => {
    const mockGo = vi.fn();
    render(
      <ErrorWordListSection
        wrongTokens={WRONG_TOKENS}
        missingChars={[]}
        onGoToVocab={mockGo}
        hasReadingAttempt={true}
      />,
    );
    const btn = screen.getByText('去生字練習');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(mockGo).toHaveBeenCalledOnce();
  });

  it('does NOT show "去生字練習" when onGoToVocab is undefined', () => {
    render(
      <ErrorWordListSection
        wrongTokens={WRONG_TOKENS}
        missingChars={[]}
        onGoToVocab={undefined}
        hasReadingAttempt={true}
      />,
    );
    expect(screen.queryByText('去生字練習')).toBeNull();
  });

  it('shows success message when no errors and hasReadingAttempt=true', () => {
    render(
      <ErrorWordListSection
        wrongTokens={[]}
        missingChars={[]}
        onGoToVocab={undefined}
        hasReadingAttempt={true}
      />,
    );
    expect(screen.getByText(/恭喜！沒有讀錯的字詞/)).toBeTruthy();
  });

  it('shows "尚無朗讀資料" when no reading attempt', () => {
    render(
      <ErrorWordListSection
        wrongTokens={[]}
        missingChars={[]}
        onGoToVocab={undefined}
        hasReadingAttempt={false}
      />,
    );
    expect(screen.getByText(/尚無朗讀資料/)).toBeTruthy();
  });

  it('truncates missing chars to 20 and shows overflow count', () => {
    const manyChars = Array.from({ length: 25 }, (_, i) => `字${i}`);
    render(
      <ErrorWordListSection
        wrongTokens={[]}
        missingChars={manyChars}
        onGoToVocab={undefined}
        hasReadingAttempt={true}
      />,
    );
    expect(screen.getByText(/還有 5 個/)).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/*  4. PracticeRecommendationSection (環節五)                           */
/* ------------------------------------------------------------------ */

describe('PracticeRecommendationSection', () => {
  it('renders all suggestion cards', () => {
    render(<PracticeRecommendationSection suggestions={SUGGESTIONS} hasReadingAttempt={true} />);
    expect(screen.getByText('聽正確發音')).toBeTruthy();
    expect(screen.getByText('反覆練習錯誤詞語')).toBeTruthy();
    expect(screen.getByText('點擊上方錯字詞旁的喇叭按鈕，反覆聆聽正確讀法。')).toBeTruthy();
  });

  it('renders suggestion icons', () => {
    render(<PracticeRecommendationSection suggestions={SUGGESTIONS} hasReadingAttempt={true} />);
    expect(screen.getByText('🔊')).toBeTruthy();
    expect(screen.getByText('🔄')).toBeTruthy();
  });

  it('shows empty state message when no suggestions and no reading attempt', () => {
    render(<PracticeRecommendationSection suggestions={[]} hasReadingAttempt={false} />);
    expect(screen.getByText('完成朗讀練習後會產生建議')).toBeTruthy();
  });

  it('shows empty state message when suggestions is empty but hasReadingAttempt=true', () => {
    render(<PracticeRecommendationSection suggestions={[]} hasReadingAttempt={true} />);
    expect(screen.getByText('完成朗讀練習後會產生建議')).toBeTruthy();
  });

  it('renders an empty list gracefully (no crash)', () => {
    const { container } = render(
      <PracticeRecommendationSection suggestions={[]} hasReadingAttempt={false} />,
    );
    expect(container).toBeTruthy();
  });
});
