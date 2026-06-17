import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import BlockSequenceRenderer from '../BlockSequenceRenderer';
import type { SpotlightV2 } from '../../../types';

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
