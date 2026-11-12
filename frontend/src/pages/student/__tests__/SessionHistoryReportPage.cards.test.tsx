/**
 * #3749 — /sessions/:sessionId/report 必須顯示跟學習流程結束時（ReportPage.tsx）
 * 同一套「關卡完成卡片」格式，不是舊版 AssessmentReport（朗讀六環節診斷）。
 *
 * 這條鎖驗的是「渲染出來的是哪個元件」，不是子元件本身的行為（那些已經在
 * reportCardsModel.test.ts / StepReportCards.test.tsx / useReportProgress.test.ts 鎖住）。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useParams: () => ({ sessionId: '42' }),
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 1, role: 'student' } }),
}));

vi.mock('../../../services/api', () => ({
  fetchStory: vi.fn().mockResolvedValue({
    id: '20011',
    title: '春天來了',
    slug: 'spring',
    content: ['春天來了，花開了。'],
    stepSequence: ['lesson-intro', 'full-text-annotate', 'vocab-review', 'report'],
  }),
}));

vi.mock('../../../services/learningApi', () => ({
  fetchSessionReport: vi.fn().mockResolvedValue({
    id: 42,
    story_slug: 'spring',
    started_at: '2026-05-01T08:00:00Z',
    current_step: 3,
    overall_score: 85,
    reading_result: null,
    comprehension_result: null,
    vocab_result: null,
    full_reading_result: null,
    teacher_reviewed_at: null,
    teacher_comment: null,
    comprehension_score: null,
    comprehension_feedback: null,
    literal_score: null,
    inferential_score: null,
    evaluative_score: null,
  }),
  fetchDialogueHistory: vi.fn().mockResolvedValue({ turns: [] }),
  loadStepProgress: vi.fn().mockResolvedValue({
    step_progress: {
      current_step: 'report',
      steps_completed: ['lesson-intro', 'full-text-annotate', 'vocab-review'],
      step_data: { 'vocab-review': { foundWords: ['春天', '花朵'] } },
    },
  }),
}));

vi.mock('../../../services/learning/annotationApi', () => ({
  loadAnnotations: vi.fn().mockResolvedValue([
    { id: 1, paragraph_index: 0, char_start: 0, char_end: 2, annotation_type: 'important' },
  ]),
}));

// 舊格式的代表元件 —— 這條鎖同時斷言它完全沒有被 import/渲染。
vi.mock('../../../components/reading-steps/AssessmentReport', () => ({
  default: () => <div data-testid="assessment-report">舊版 AssessmentReport</div>,
}));

vi.mock('../../../components/ui/PageLoader', () => ({
  default: () => <div data-testid="page-loader">Loading…</div>,
}));

import SessionHistoryReportPage from '../SessionHistoryReportPage';

describe('SessionHistoryReportPage — 學習報告分頁 (#3749)', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('渲染新版關卡卡片（StepReportCards），不是舊版 AssessmentReport', async () => {
    render(<SessionHistoryReportPage />);

    await waitFor(() => expect(screen.getByTestId('step-report-cards')).toBeInTheDocument());
    expect(screen.queryByTestId('assessment-report')).not.toBeInTheDocument();

    // 完成的三關（lesson-intro 因後面有進度而算完成、full-text-annotate、
    // vocab-review）都在，報告步本身不應該出現在卡片清單
    expect(screen.getByText('完成 3 / 3 關')).toBeInTheDocument();
  });

  it('跟學習流程結束時一樣能點卡片看細節（例如語詞複習找到的詞）', async () => {
    render(<SessionHistoryReportPage />);
    await waitFor(() => expect(screen.getByTestId('step-report-cards')).toBeInTheDocument());

    screen.getByRole('button', { name: /語詞複習/ }).click();
    await waitFor(() => expect(screen.getByText('春天')).toBeInTheDocument());
    expect(screen.getByText('花朵')).toBeInTheDocument();
  });
});
