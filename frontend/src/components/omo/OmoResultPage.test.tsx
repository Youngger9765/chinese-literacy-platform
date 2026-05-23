/**
 * OmoResultPage — TDD tests for issue #1921 three UX gaps:
 *   Gap 1: all-blank answers → show "not a worksheet" banner + re-upload CTA
 *   Gap 2: candidates[] array → render chip list + "not this lesson?" expander
 *   Gap 3: "批改有誤?" → expand reasoning text + ai_confidence per answer
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OmoResultPage from './OmoResultPage';
import type { OmoAnswerItem, OmoCandidate } from '../../services/omoApi';

// Mock API calls — OmoResultPage does not call APIs directly in render, but
// flagOmoAnswer and getOmoCropSignedUrl are imported so we mock to prevent
// any accidental network calls.
vi.mock('../../services/omoApi', () => ({
  flagOmoAnswer: vi.fn(),
  getOmoCropSignedUrl: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TOKEN = 'test-token';
const UPLOAD_ID = 212;

const blankAnswer = (qid: string): OmoAnswerItem => ({
  question_id: qid,
  student_answer: '',
  correct_answer: '根據',
  score: 0,
  ai_confidence: 0,
  reasoning: '作答區空白，沒有看到學生手寫的任何字跡',
});

const normalAnswer = (qid: string): OmoAnswerItem => ({
  question_id: qid,
  student_answer: '根據',
  correct_answer: '根據',
  score: 1,
  ai_confidence: 0.95,
  reasoning: '完全符合標準答案',
});

const CANDIDATE_A: OmoCandidate = {
  lesson_id: 3,
  grade_code: 'G6-L03',
  title: '古典詩詞欣賞',
  confidence: 0.95,
  reasoning: '標題完全符合',
};

const CANDIDATE_B: OmoCandidate = {
  lesson_id: 11,
  grade_code: 'G6-11',
  title: '海洋的故事',
  confidence: 0.9,
  reasoning: '標題部分符合，但課號不同',
};

// ---------------------------------------------------------------------------
// Gap 1: All-blank detection
// ---------------------------------------------------------------------------

describe('Gap 1 — all-blank worksheet detection', () => {
  it('renders the "不是學習單" banner when every answer is blank/空白', () => {
    const allBlankAnswers = ['fb_1', 'fb_2', 'fb_3'].map(blankAnswer);

    render(
      <OmoResultPage
        uploadId={UPLOAD_ID}
        token={TOKEN}
        answers={allBlankAnswers}
        overallScore={0}
        onRetry={vi.fn()}
        candidates={[]}
      />,
    );

    // Banner text must be visible
    expect(
      screen.getByText(/這張看起來不是填寫過的學習單/i),
    ).toBeTruthy();
  });

  it('renders "重新上傳" CTA button when all answers are blank', () => {
    const allBlankAnswers = ['fb_1', 'fb_2'].map(blankAnswer);
    const onRetry = vi.fn();

    render(
      <OmoResultPage
        uploadId={UPLOAD_ID}
        token={TOKEN}
        answers={allBlankAnswers}
        overallScore={0}
        onRetry={onRetry}
        candidates={[]}
      />,
    );

    const ctaButton = screen.getByRole('button', { name: /重新上傳/i });
    expect(ctaButton).toBeTruthy();

    fireEvent.click(ctaButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does NOT render the all-blank banner when at least one answer is non-blank', () => {
    const mixedAnswers = [blankAnswer('fb_1'), normalAnswer('fb_2')];

    render(
      <OmoResultPage
        uploadId={UPLOAD_ID}
        token={TOKEN}
        answers={mixedAnswers}
        overallScore={0.5}
        onRetry={vi.fn()}
        candidates={[]}
      />,
    );

    expect(screen.queryByText(/這張看起來不是填寫過的學習單/i)).toBeNull();
  });

  it('does NOT render the all-blank banner when an answer has non-空白 reasoning', () => {
    // Blank student_answer but reasoning says something different (human override)
    const weirdAnswer: OmoAnswerItem = {
      question_id: 'fb_1',
      student_answer: '',
      correct_answer: '根據',
      score: 0,
      ai_confidence: 0.3,
      reasoning: '字跡潦草，無法辨識',
    };

    render(
      <OmoResultPage
        uploadId={UPLOAD_ID}
        token={TOKEN}
        answers={[weirdAnswer]}
        overallScore={0}
        onRetry={vi.fn()}
        candidates={[]}
      />,
    );

    // This answer is blank but reasoning doesn't say 空白 → not "all blank" case
    expect(screen.queryByText(/這張看起來不是填寫過的學習單/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gap 2: Multi-candidate chip list
// ---------------------------------------------------------------------------

describe('Gap 2 — multi-candidate identifier chip list', () => {
  it('shows primary candidate chip with grade_code and title', () => {
    render(
      <OmoResultPage
        uploadId={UPLOAD_ID}
        token={TOKEN}
        answers={[normalAnswer('fb_1')]}
        overallScore={1}
        onRetry={vi.fn()}
        candidates={[CANDIDATE_A, CANDIDATE_B]}
      />,
    );

    // Primary candidate title visible
    expect(screen.getByText(/古典詩詞欣賞/i)).toBeTruthy();
  });

  it('shows confidence percentage for primary candidate', () => {
    render(
      <OmoResultPage
        uploadId={UPLOAD_ID}
        token={TOKEN}
        answers={[normalAnswer('fb_1')]}
        overallScore={1}
        onRetry={vi.fn()}
        candidates={[CANDIDATE_A, CANDIDATE_B]}
      />,
    );

    // 0.95 → 95% — candidate chip shows "信心 95%" (distinct from confidence bar label)
    expect(screen.getByText(/信心 95%/i)).toBeTruthy();
  });

  it('shows "不是這課？" expander button when there are multiple candidates', () => {
    render(
      <OmoResultPage
        uploadId={UPLOAD_ID}
        token={TOKEN}
        answers={[normalAnswer('fb_1')]}
        overallScore={1}
        onRetry={vi.fn()}
        candidates={[CANDIDATE_A, CANDIDATE_B]}
      />,
    );

    expect(screen.getByRole('button', { name: /不是這課/i })).toBeTruthy();
  });

  it('reveals secondary candidate after clicking "不是這課？"', () => {
    render(
      <OmoResultPage
        uploadId={UPLOAD_ID}
        token={TOKEN}
        answers={[normalAnswer('fb_1')]}
        overallScore={1}
        onRetry={vi.fn()}
        candidates={[CANDIDATE_A, CANDIDATE_B]}
      />,
    );

    // Initially secondary candidate is hidden
    expect(screen.queryByText(/海洋的故事/i)).toBeNull();

    // Click expander
    fireEvent.click(screen.getByRole('button', { name: /不是這課/i }));

    // Now secondary candidate should be visible
    expect(screen.getByText(/海洋的故事/i)).toBeTruthy();
  });

  it('does NOT render candidate section when candidates array is empty', () => {
    render(
      <OmoResultPage
        uploadId={UPLOAD_ID}
        token={TOKEN}
        answers={[normalAnswer('fb_1')]}
        overallScore={1}
        onRetry={vi.fn()}
        candidates={[]}
      />,
    );

    expect(screen.queryByText(/不是這課/i)).toBeNull();
  });

  it('does NOT render "不是這課？" expander when only one candidate', () => {
    render(
      <OmoResultPage
        uploadId={UPLOAD_ID}
        token={TOKEN}
        answers={[normalAnswer('fb_1')]}
        overallScore={1}
        onRetry={vi.fn()}
        candidates={[CANDIDATE_A]}
      />,
    );

    expect(screen.queryByRole('button', { name: /不是這課/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gap 3: Reasoning expansion on "批改有誤？"
// ---------------------------------------------------------------------------

describe('Gap 3 — reasoning expansion in AnswerCard', () => {
  it('reasoning text is NOT visible before clicking "批改有誤？"', () => {
    const answer = normalAnswer('fb_1');

    render(
      <OmoResultPage
        uploadId={UPLOAD_ID}
        token={TOKEN}
        answers={[answer]}
        overallScore={1}
        onRetry={vi.fn()}
        candidates={[]}
      />,
    );

    // reasoning should not be visible in the answer detail area initially
    // (it shows inline truncated via line-clamp — check that the dedicated
    // expansion panel is absent)
    expect(screen.queryByRole('region', { name: /AI 批改依據/i })).toBeNull();
  });

  it('clicking "批改有誤？" expands the reasoning panel', () => {
    const answer: OmoAnswerItem = {
      question_id: 'fb_1',
      student_answer: '根據',
      correct_answer: '根據',
      score: 1,
      ai_confidence: 0.92,
      reasoning: '完全符合標準答案，字跡清晰',
    };

    render(
      <OmoResultPage
        uploadId={UPLOAD_ID}
        token={TOKEN}
        answers={[answer]}
        overallScore={1}
        onRetry={vi.fn()}
        candidates={[]}
      />,
    );

    const flagBtn = screen.getByRole('button', { name: /批改有誤/i });
    fireEvent.click(flagBtn);

    // Reasoning panel should now be visible
    const panel = screen.getByRole('region', { name: /AI 批改依據/i });
    expect(panel).toBeTruthy();
    // Panel contains the reasoning text (there may be 2 occurrences: truncated header + panel)
    expect(panel.textContent).toContain('完全符合標準答案，字跡清晰');
  });

  it('shows ai_confidence percentage in the expanded reasoning panel', () => {
    const answer: OmoAnswerItem = {
      question_id: 'fb_1',
      student_answer: '根據',
      correct_answer: '根據',
      score: 1,
      ai_confidence: 0.92,
      reasoning: '完全符合',
    };

    render(
      <OmoResultPage
        uploadId={UPLOAD_ID}
        token={TOKEN}
        answers={[answer]}
        overallScore={1}
        onRetry={vi.fn()}
        candidates={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /批改有誤/i }));

    // 0.92 → 92% — the panel shows "AI 信心度：92%" (distinct text from the confidence bar "AI 92%")
    const panel = screen.getByRole('region', { name: /AI 批改依據/i });
    expect(panel.textContent).toContain('92%');
  });

  it('clicking "批改有誤？" again collapses the reasoning panel (toggle)', () => {
    const answer: OmoAnswerItem = {
      question_id: 'fb_1',
      student_answer: '根據',
      correct_answer: '根據',
      score: 1,
      ai_confidence: 0.88,
      reasoning: '字跡清晰可辨識',
    };

    render(
      <OmoResultPage
        uploadId={UPLOAD_ID}
        token={TOKEN}
        answers={[answer]}
        overallScore={1}
        onRetry={vi.fn()}
        candidates={[]}
      />,
    );

    const flagBtn = screen.getByRole('button', { name: /批改有誤/i });

    // First click: expand
    fireEvent.click(flagBtn);
    expect(screen.getByRole('region', { name: /AI 批改依據/i })).toBeTruthy();

    // Second click: collapse
    fireEvent.click(flagBtn);
    expect(screen.queryByRole('region', { name: /AI 批改依據/i })).toBeNull();
  });
});
