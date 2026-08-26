/**
 * Tests for VocabApplication — ④ 語詞應用 step component (#668)
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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
    // 標題被拆進多個節點，用整段文字比對
    expect(document.body.textContent?.replace(/\s+/g, ''), '看不到步驟標題').toContain('語詞應用');
    // 說明文案改了（不再提「代號」，因為選項已不顯示 A/B/C）
    expect(document.body.textContent?.replace(/\s+/g, ''), '沒有作答說明')
      .toMatch(/選出最適合填進空格的語詞|怎麼玩/);
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
    fireEvent.click(screen.getByRole('button', { name: '下一關' }));
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ completionRate: 1 })
    );
  });

  it('shows completion screen after exercise completes', async () => {
    render(<VocabApplication story={baseStory} onFinish={() => {}} />);

    // Answer both questions
    const aButtons = screen.getAllByRole('button', { name: '疑難雜症' });
    fireEvent.click(aButtons[0]);
    // 答對後會停 1200ms 讓學生看到自己填的詞才前進（#2933）
    const bButtons = [await screen.findByRole('button', { name: '龍爭虎鬥' }, { timeout: 3000 })];
    fireEvent.click(bButtons[0]);

    // 兩題都答對後直接進完成畫面 —— 現在沒有「提交答案」這一步（#2933）
    await waitFor(
      () => expect(document.body.textContent ?? '').toMatch(/全部答對|下一關/),
      { timeout: 3000 },
    );
  });

  it('calls onFinish with correct result from completion screen', async () => {
    const onFinish = vi.fn();
    // ⚠️ 前一條測試跑完後，共用的 baseStory 會被改動到（題目陣列被消耗），
    //    於是這一條拿到空題庫、畫面只剩段落。用乾淨副本隔離。
    // ⚠️ 進度存在 localStorage（#709），跨測試會殘留 ——
    //    前一條把這課做完了，這一條 render 出來直接是完成畫面，
    //    於是「找不到選項」看起來像元件壞了。清掉才測得到真流程。
    cleanup();
    localStorage.clear();
    const freshStory = {
      ...baseStory,
      fillInBlank: (baseStory.fillInBlank ?? []).map((q) => ({ ...q })),
      vocabBank: { ...(baseStory.vocabBank ?? {}) },
    };
    render(<VocabApplication story={freshStory} onFinish={onFinish} />);

    // Answer both correctly
    const aButtons = screen.getAllByRole('button', { name: '疑難雜症' });
    fireEvent.click(aButtons[0]);
    // 答對後會停 1200ms 讓學生看到自己填的詞才前進（#2933）
    const bButtons = [await screen.findByRole('button', { name: '龍爭虎鬥' }, { timeout: 3000 })];
    fireEvent.click(bButtons[0]);

    // 兩題都答對後直接進完成畫面（沒有「提交答案」那一步了）
    await waitFor(
      () => expect(screen.getByRole('button', { name: /下一關/ })).toBeTruthy(),
      { timeout: 3000 },
    );
    fireEvent.click(screen.getByRole('button', { name: /下一關/ }));

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
