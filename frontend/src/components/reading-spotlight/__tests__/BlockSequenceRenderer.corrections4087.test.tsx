/**
 * #4087 — 閱讀聚光燈：答錯可以訂正（以前按下確認就鎖住，學生卡在「再想想看」），
 * 而且每一題的作答（題目、第一次選的、最新選的、正確答案）要跟作答一起存，成績單才列得出來。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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

const FIXTURE = {
  lesson: 'G6-L3',
  strategy_name: '解題策略',
  blocks: [
    {
      type: 'single',
      prompt: '作者最可能贊成哪一種做法？',
      options: { A: '先關閉手機通知', B: '看完通知馬上回來' },
      answer: 'A',
    },
  ],
} as unknown as SpotlightV2;

const lastChange = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls[spy.mock.calls.length - 1][0] as Record<string, unknown>;

describe('spotlight corrections and answer log (#4087)', () => {
  it('a wrong answer can be changed and confirmed again', () => {
    render(<BlockSequenceRenderer spotlight={FIXTURE} />);
    fireEvent.click(screen.getByRole('button', { name: /看完通知馬上回來/ }));
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(screen.getByText(/再想想看/)).toBeInTheDocument();
    const right = screen.getByRole('button', { name: /先關閉手機通知/ });
    expect(right).not.toBeDisabled();
    fireEvent.click(right);
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    expect(screen.getByText(/答對了/)).toBeInTheDocument();
    // 答對之後鎖住
    expect(screen.getByRole('button', { name: /看完通知馬上回來/ })).toBeDisabled();
  });

  it('a question restored as wrong (coming back to correct it) is still changeable', () => {
    render(<BlockSequenceRenderer spotlight={FIXTURE}
      initialState={{ blockState: { '0-0': 1 }, feedback: { '0-0': false }, allDone: true }} />);
    expect(screen.getByRole('button', { name: /先關閉手機通知/ })).not.toBeDisabled();
  });

  it('records the question, first pick, latest pick and right answer', () => {
    const onChange = vi.fn();
    render(<BlockSequenceRenderer spotlight={FIXTURE} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /看完通知馬上回來/ }));
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    fireEvent.click(screen.getByRole('button', { name: /先關閉手機通知/ }));
    fireEvent.click(screen.getByRole('button', { name: '確認' }));
    const log = lastChange(onChange).answerLog as Record<string, Record<string, unknown>>;
    const entry = Object.values(log)[0];
    expect(entry).toMatchObject({
      label: '作者最可能贊成哪一種做法？',
      firstAnswer: '看完通知馬上回來',
      latestAnswer: '先關閉手機通知',
      correctAnswer: '先關閉手機通知',
    });
  });
});
