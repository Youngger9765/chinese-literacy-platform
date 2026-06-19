import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { validateStrategyAnswer } from '../../../services/learningApi';
import BlockSequenceRenderer from '../BlockSequenceRenderer';
import type { SpotlightV2 } from '../../../types';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));
vi.mock('../../../services/learningApi', () => ({
  validateStrategyAnswer: vi.fn(),
}));
vi.mock('../../reading-steps/GraphicTextImageStrip', () => ({
  FigureCard: ({ alt }: { alt: string }) => <div data-testid="figure-card">{alt}</div>,
  buildImageSrc: (f: string) => f,
}));

const FIXTURE: SpotlightV2 = {
  lesson: 'G6-L22',
  strategy_name: '摘要策略-問題.解決.結果結構',
  strategy_type: 'summary_pse',
  blocks: [
    { type: 'guide', text: '好故事，大家都愛看。為什麼？' },
    { type: 'passage', paragraphs: ['烏鴉又渴又累。'], source: 'supplementary' },
    {
      type: 'single',
      prompt: '❶主角是誰？',
      options: ['烏鴉', '麻雀'],
      answer: '烏鴉',
    },
  ],
};

describe('BlockSequenceRenderer', () => {
  it('renders guide teaching context (not MCQ-only)', () => {
    render(<BlockSequenceRenderer spotlight={FIXTURE} />);
    expect(screen.getByText(/好故事，大家都愛看/)).toBeInTheDocument();
  });

  it('renders inline passage without requiring full lesson text', () => {
    render(<BlockSequenceRenderer spotlight={FIXTURE} />);
    expect(screen.getByText(/烏鴉又渴又累/)).toBeInTheDocument();
    expect(screen.getByText('閱讀文本')).toBeInTheDocument();
  });

  it('renders single-choice prompt', () => {
    render(<BlockSequenceRenderer spotlight={FIXTURE} />);
    expect(screen.getByText(/❶主角是誰/)).toBeInTheDocument();
    expect(screen.getByText(/A\. 烏鴉/)).toBeInTheDocument();
  });

  it('shows strategy name in header', () => {
    render(<BlockSequenceRenderer spotlight={FIXTURE} />);
    expect(screen.getByText('摘要策略-問題.解決.結果結構')).toBeInTheDocument();
  });
});


vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));
vi.mock('../../../services/learningApi', () => ({
  validateStrategyAnswer: vi.fn(),
}));

import { fireEvent, waitFor } from '@testing-library/react';
import { validateStrategyAnswer } from '../../../services/learningApi';
import { beforeEach } from 'vitest';

const FREE_TEXT_FIXTURE: SpotlightV2 = {
  lesson: 'G6-L23',
  strategy_name: '摘要策略',
  strategy_type: 'summary_pse',
  blocks: [
    { type: 'guide', text: '找問題練習' },
    {
      type: 'free_text',
      prompt: '❶找重點句：哪一句描述最嚴重的不好的事？',
    },
  ],
};

describe('BlockSequenceRenderer — free_text AI grading (#2192)', () => {
  beforeEach(() => {
    vi.mocked(validateStrategyAnswer).mockReset();
  });

  it('calls validateStrategyAnswer and shows encouraging feedback', async () => {
    vi.mocked(validateStrategyAnswer).mockResolvedValue({
      is_correct: true,
      feedback: '你有抓到重點句的方向！',
      suggestion: '',
    });
    render(<BlockSequenceRenderer spotlight={FREE_TEXT_FIXTURE} story={{ id: '1077', title: '毒鳥', content: ['課文'], level: 6, thumbnail: '', category: 'Daily', filename: '' }} />);

    fireEvent.change(screen.getByPlaceholderText(/寫下你的答案/), {
      target: { value: '發現超過3000隻野鳥屍體' },
    });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    await waitFor(() => {
      expect(screen.getByText(/你有抓到重點句的方向/)).toBeInTheDocument();
    });
    expect(validateStrategyAnswer).toHaveBeenCalledWith(
      'test-token',
      expect.objectContaining({
        question: expect.stringContaining('找重點句'),
        studentAnswer: '發現超過3000隻野鳥屍體',
        strategyName: '摘要策略',
        storyTitle: '毒鳥',
      }),
    );
  });

  it('shows suggestion when AI marks answer as off-track', async () => {
    vi.mocked(validateStrategyAnswer).mockResolvedValue({
      is_correct: false,
      feedback: '方向對了，再想想看～',
      suggestion: '回到第一段找最嚴重的不好的事',
    });
    render(<BlockSequenceRenderer spotlight={FREE_TEXT_FIXTURE} />);

    fireEvent.change(screen.getByPlaceholderText(/寫下你的答案/), {
      target: { value: '不知道' },
    });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    expect(await screen.findByText(/方向對了/)).toBeInTheDocument();
    expect(screen.getByText('回到第一段找最嚴重的不好的事')).toBeInTheDocument();
  });

  it('falls back to 已記錄 when grading throws', async () => {
    vi.mocked(validateStrategyAnswer).mockRejectedValue(new Error('network'));
    render(<BlockSequenceRenderer spotlight={FREE_TEXT_FIXTURE} />);

    fireEvent.change(screen.getByPlaceholderText(/寫下你的答案/), {
      target: { value: '測試' },
    });
    fireEvent.click(screen.getByRole('button', { name: '送出' }));

    await waitFor(() => {
      expect(screen.getByText(/已記錄你的答案/)).toBeInTheDocument();
    });
  });
});
