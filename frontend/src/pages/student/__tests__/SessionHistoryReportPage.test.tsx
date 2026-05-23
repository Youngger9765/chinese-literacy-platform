/**
 * Characterization tests for SessionHistoryReportPage refactor — Issue #1958
 *
 * Scope:
 *  - SessionHistoryHeader: renders lesson title, date, score badge
 *  - ReportSectionAccordion: expand / collapse behaviour
 *  - Section sub-components (ReadingRecord, FullReadingRecord, ComprehensionRecord, VocabRecord)
 *  - StepRecordsView: renders empty state when no step records
 *
 * TDD: these tests are written BEFORE the extracted components exist (RED phase).
 * They will pass once the refactor is complete (GREEN phase).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  useParams: () => ({ sessionId: '42' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 1, role: 'student' } }),
}));

vi.mock('../../../services/api', () => ({
  fetchStory: vi.fn().mockResolvedValue({
    id: 'story-1',
    title: '春天來了',
    slug: 'spring',
    content: '',
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
}));

vi.mock('../../../components/reading-steps/AssessmentReport', () => ({
  default: () => <div data-testid="assessment-report">AssessmentReport</div>,
}));

vi.mock('../../../components/ui/PageLoader', () => ({
  default: () => <div data-testid="page-loader">Loading…</div>,
}));

vi.mock('../../../components/ui/DiffDisplay', () => ({
  default: () => <div data-testid="diff-display">DiffDisplay</div>,
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import SessionHistoryReportPage from '../SessionHistoryReportPage';
import { ReportSectionAccordion } from '../SessionHistoryReportPage';
import { ReadingRecord } from '../SessionHistoryReportPage';
import { FullReadingRecord } from '../SessionHistoryReportPage';
import { VocabRecord } from '../SessionHistoryReportPage';
import { ComprehensionRecord } from '../SessionHistoryReportPage';

// ─── ReportSectionAccordion ────────────────────────────────────────────────────

describe('ReportSectionAccordion', () => {
  it('renders the section title', () => {
    render(
      <ReportSectionAccordion title="逐段朗讀">
        <p>content</p>
      </ReportSectionAccordion>,
    );
    expect(screen.getByText('逐段朗讀')).toBeInTheDocument();
  });

  it('is expanded by default', () => {
    render(
      <ReportSectionAccordion title="Test Section">
        <p data-testid="inner">Hello</p>
      </ReportSectionAccordion>,
    );
    expect(screen.getByTestId('inner')).toBeVisible();
  });

  it('collapses when header is clicked', () => {
    render(
      <ReportSectionAccordion title="Test Section">
        <p data-testid="inner">Hello</p>
      </ReportSectionAccordion>,
    );
    const header = screen.getByRole('button', { name: /test section/i });
    fireEvent.click(header);
    // After collapse children should not be visible (hidden via CSS or unmounted)
    expect(screen.queryByTestId('inner')).not.toBeInTheDocument();
  });

  it('re-expands when header is clicked again', () => {
    render(
      <ReportSectionAccordion title="Test Section">
        <p data-testid="inner">Hello</p>
      </ReportSectionAccordion>,
    );
    const header = screen.getByRole('button', { name: /test section/i });
    fireEvent.click(header); // collapse
    fireEvent.click(header); // expand
    expect(screen.getByTestId('inner')).toBeVisible();
  });
});

// ─── ReadingRecord ─────────────────────────────────────────────────────────────

describe('ReadingRecord', () => {
  it('shows mispronounced words', () => {
    const raw = { mispronounced_words: ['春', '天'], transcription: '' };
    render(<ReadingRecord raw={raw as Record<string, unknown>} />);
    expect(screen.getByText('春')).toBeInTheDocument();
    expect(screen.getByText('天')).toBeInTheDocument();
  });

  it('shows "沒有念錯的字詞" when none', () => {
    const raw = { mispronounced_words: [], transcription: '' };
    render(<ReadingRecord raw={raw as Record<string, unknown>} />);
    expect(screen.getByText('沒有念錯的字詞')).toBeInTheDocument();
  });

  it('shows transcription text', () => {
    const raw = { mispronounced_words: [], transcription: '春天來了' };
    render(<ReadingRecord raw={raw as Record<string, unknown>} />);
    expect(screen.getByText('春天來了')).toBeInTheDocument();
  });
});

// ─── FullReadingRecord ─────────────────────────────────────────────────────────

describe('FullReadingRecord', () => {
  it('shows AI feedback', () => {
    const raw = { feedback: '朗讀很流暢！', diff_tokens: [] };
    render(<FullReadingRecord raw={raw as Record<string, unknown>} />);
    expect(screen.getByText('朗讀很流暢！')).toBeInTheDocument();
  });

  it('shows DiffDisplay when diff_tokens present', () => {
    const raw = {
      feedback: '',
      diff_tokens: [{ text: '春', type: 'match' }],
    };
    render(<FullReadingRecord raw={raw as Record<string, unknown>} />);
    expect(screen.getByTestId('diff-display')).toBeInTheDocument();
  });
});

// ─── VocabRecord ───────────────────────────────────────────────────────────────

describe('VocabRecord', () => {
  it('shows practiced words', () => {
    const raw = { practiced_words: ['蝴蝶', '花朵'], total_words: 10 };
    render(<VocabRecord raw={raw as Record<string, unknown>} />);
    expect(screen.getByText('蝴蝶')).toBeInTheDocument();
    expect(screen.getByText('花朵')).toBeInTheDocument();
  });

  it('shows progress fraction', () => {
    const raw = { practiced_words: ['蝴蝶'], total_words: 5 };
    render(<VocabRecord raw={raw as Record<string, unknown>} />);
    expect(screen.getByText(/1 \/ 5 個生字/)).toBeInTheDocument();
  });
});

// ─── ComprehensionRecord ───────────────────────────────────────────────────────

describe('ComprehensionRecord', () => {
  it('shows "沒有對話紀錄" when turns is empty', () => {
    render(
      <ComprehensionRecord
        raw={null}
        turns={[]}
        scores={null}
      />,
    );
    expect(screen.getByText('沒有對話紀錄')).toBeInTheDocument();
  });

  it('renders student turn with 答對 indicator', () => {
    const turns = [
      { id: 1, role: 'student', text: '春天', is_correct: true },
    ];
    render(
      <ComprehensionRecord
        raw={null}
        turns={turns as any}
        scores={null}
      />,
    );
    expect(screen.getByText('春天')).toBeInTheDocument();
    expect(screen.getByText(/✓ 答對/)).toBeInTheDocument();
  });

  it('renders AI overall feedback when present', () => {
    const scores = {
      comprehension_score: 80,
      literal_score: 90,
      inferential_score: 70,
      evaluative_score: 80,
      feedback: { literal: '', inferential: '', evaluative: '', overall: '整體表現不錯' },
    };
    render(
      <ComprehensionRecord
        raw={null}
        turns={[]}
        scores={scores}
      />,
    );
    expect(screen.getByText('整體表現不錯')).toBeInTheDocument();
  });
});
