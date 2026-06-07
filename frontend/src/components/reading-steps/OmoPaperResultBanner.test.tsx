/**
 * Tests for OmoPaperResultBanner (#2027 / #2089 item 3).
 * The banner reads step_data[stepId].omo from the learning context and renders
 * the paper作答 + 對錯, or nothing when this step has no paper record.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import OmoPaperResultBanner from './OmoPaperResultBanner';

const mockContext = vi.fn();
vi.mock('../../layouts/LearningLayout', () => ({
  useLearningContext: () => mockContext(),
}));

function withStepData(stepData: Record<string, unknown>) {
  mockContext.mockReturnValue({ stepProgressData: { step_data: stepData } });
}

const omoRecord = (answers: unknown[]) => ({
  graded_at: '2026-06-07T10:00:00Z',
  source: 'omo',
  answers,
});

describe('OmoPaperResultBanner', () => {
  it('renders nothing when the step has no omo record', () => {
    withStepData({ 'vocab-application': { online_answers: [1] } });
    const { container } = render(<OmoPaperResultBanner stepId="vocab-application" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when step_data is empty', () => {
    withStepData({});
    const { container } = render(<OmoPaperResultBanner stepId="comprehension" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the paper answers and correct/total summary', () => {
    withStepData({
      'vocab-application': {
        omo: omoRecord([
          { question_id: 'fb_1', student_answer: '冬天', correct_answer: '冬天', score: 1, ai_confidence: 0.9, context: '第一格' },
          { question_id: 'fb_2', student_answer: '夏', correct_answer: '秋', score: 0, ai_confidence: 0.9, context: '第二格' },
        ]),
      },
    });
    render(<OmoPaperResultBanner stepId="vocab-application" />);
    expect(screen.getByRole('region', { name: '紙本批改結果' })).toBeInTheDocument();
    expect(screen.getByText('答對 1/2')).toBeInTheDocument();
    expect(screen.getByText('冬天')).toBeInTheDocument();
    // wrong answer shows the correct one
    expect(screen.getByText('正解：秋')).toBeInTheDocument();
  });

  it('marks an unanswered question as 未作答 without showing 正解', () => {
    withStepData({
      comprehension: {
        omo: omoRecord([
          { question_id: 'mc_1', student_answer: '', correct_answer: 'B', score: 0, ai_confidence: 0, context: '第一題' },
        ]),
      },
    });
    render(<OmoPaperResultBanner stepId="comprehension" />);
    expect(screen.getByText('未作答')).toBeInTheDocument();
    expect(screen.queryByText(/正解/)).toBeNull();
  });

  it('reads the record for the requested step only', () => {
    withStepData({
      'vocab-application': { omo: omoRecord([{ question_id: 'fb_1', student_answer: 'A', correct_answer: 'A', score: 1, ai_confidence: 1, context: '' }]) },
      comprehension: { omo: omoRecord([{ question_id: 'mc_1', student_answer: 'B', correct_answer: 'B', score: 1, ai_confidence: 1, context: '' }]) },
    });
    render(<OmoPaperResultBanner stepId="comprehension" />);
    // only the comprehension record (1 answer) → 答對 1/1
    expect(screen.getByText('答對 1/1')).toBeInTheDocument();
  });
});
