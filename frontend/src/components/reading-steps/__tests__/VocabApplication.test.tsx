/**
 * Tests for VocabApplication — ④ 語詞應用 step component (#668)
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import VocabApplication from '../VocabApplication';
import { Story } from '../../../types';

/* ------------------------------------------------------------------ */
/*  Fixtures                                                            */
/* ------------------------------------------------------------------ */

const baseStory: Story = {
  id: 'L01',
  title: '測試課文',
  level: '1',
  content: ['課文內容'],
  thumbnail: '',
  category: 'Fable',
  filename: 'L01.yml',
  vocabulary: [
    { word: '疑難雜症', definition: '難以解決的困難或問題。' },
    { word: '龍爭虎鬥', definition: '形容激烈競爭。' },
  ],
  fillInBlank: [
    { sentence: '他解決了所有的(　　)。', answer: 'A' },
    { sentence: '兩隊之間展開(　　)的競爭。', answer: 'B' },
  ],
  vocabBank: {
    A: '疑難雜症',
    B: '龍爭虎鬥',
    C: '一鳴驚人',
  },
};

const storyNoData: Story = {
  ...baseStory,
  fillInBlank: [],
  vocabBank: {},
};

const storyNullFields: Story = {
  ...baseStory,
  fillInBlank: undefined,
  vocabBank: undefined,
};

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe('VocabApplication', () => {
  it('renders step header', () => {
    render(<VocabApplication story={baseStory} onFinish={() => {}} />);
    expect(screen.getByText('語詞應用')).toBeTruthy();
    expect(screen.getByText('將正確的詞語代號填入空格中')).toBeTruthy();
  });

  it('renders FillInBlankExercise when story has data', () => {
    render(<VocabApplication story={baseStory} onFinish={() => {}} />);
    // Word bank entries should be visible
    expect(screen.getByText('疑難雜症')).toBeTruthy();
    expect(screen.getByText('龍爭虎鬥')).toBeTruthy();
    // Sentence content
    expect(screen.getByText(/他解決了所有的/)).toBeTruthy();
  });

  it('shows fallback UI when fillInBlank is empty array', () => {
    render(<VocabApplication story={storyNoData} onFinish={() => {}} />);
    expect(screen.getByText('本課尚無語詞應用題目')).toBeTruthy();
  });

  it('shows fallback UI when fillInBlank and vocabBank are undefined', () => {
    render(<VocabApplication story={storyNullFields} onFinish={() => {}} />);
    expect(screen.getByText('本課尚無語詞應用題目')).toBeTruthy();
  });

  it('fallback continue button calls onFinish with completionRate=1', () => {
    const onFinish = vi.fn();
    render(<VocabApplication story={storyNoData} onFinish={onFinish} />);
    fireEvent.click(screen.getByRole('button', { name: '繼續下一步' }));
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ completionRate: 1 })
    );
  });

  it('shows completion screen after exercise completes', () => {
    render(<VocabApplication story={baseStory} onFinish={() => {}} />);

    // Answer both questions
    const aButtons = screen.getAllByRole('button', { name: /^A 疑難雜症$/ });
    fireEvent.click(aButtons[0]);
    const bButtons = screen.getAllByRole('button', { name: /^B 龍爭虎鬥$/ });
    fireEvent.click(bButtons[1]);

    fireEvent.click(screen.getByRole('button', { name: '提交答案' }));
    fireEvent.click(screen.getByRole('button', { name: /繼續/ }));

    // Completion screen
    expect(screen.getByText(/語詞應用完成|全部答對/)).toBeTruthy();
  });

  it('calls onFinish with correct result from completion screen', () => {
    const onFinish = vi.fn();
    render(<VocabApplication story={baseStory} onFinish={onFinish} />);

    // Answer both correctly
    const aButtons = screen.getAllByRole('button', { name: /^A 疑難雜症$/ });
    fireEvent.click(aButtons[0]);
    const bButtons = screen.getAllByRole('button', { name: /^B 龍爭虎鬥$/ });
    fireEvent.click(bButtons[1]);

    fireEvent.click(screen.getByRole('button', { name: '提交答案' }));
    fireEvent.click(screen.getByRole('button', { name: /繼續/ }));

    // In completion screen, click the final continue button
    fireEvent.click(screen.getByRole('button', { name: /繼續下一步/ }));

    expect(onFinish).toHaveBeenCalledWith({
      score: 2,
      total: 2,
      completionRate: 1,
    });
  });

  it('passes fontSizePx as inline style', () => {
    const { container } = render(
      <VocabApplication story={baseStory} onFinish={() => {}} fontSizePx={20} />
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.fontSize).toBe('20px');
  });
});
