/**
 * #3399 — 報告頁卡片 UI：完成打綠勾、點開看細節、未完成可前往。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StepReportCards from '../StepReportCards';
import type { StepReportCard } from '../reportCardsModel';

const cards: StepReportCard[] = [
  {
    stepId: 'full-text-annotate', baseId: 'full-text-annotate', label: '讀全文-做記號', icon: 'edit_note',
    completed: true, status: 'done', summary: '做了 2 個記號',
    details: [{ kind: 'marks', marks: [
      { type: 'unknown', text: '喝采', paragraphIndex: 0 },
      { type: 'important', text: '球后', paragraphIndex: 1 },
    ] }],
  },
  { stepId: 'vocab-review', baseId: 'vocab-review', label: '語詞複習', icon: 'search', completed: false, status: 'none', summary: null, details: [] },
];

describe('StepReportCards', () => {
  it('shows progress and a green check only on completed cards', () => {
    render(<StepReportCards storyTitle="贏得喝采的輸家" cards={cards} />);
    expect(screen.getByText('完成 1 / 2 關')).toBeInTheDocument();
    expect(screen.getAllByLabelText('已完成')).toHaveLength(1);
    expect(screen.getAllByLabelText('未完成')).toHaveLength(1);
  });

  it('opens details with the student marks', () => {
    render(<StepReportCards cards={cards} />);
    fireEvent.click(screen.getByRole('button', { name: /讀全文-做記號/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('喝采')).toBeInTheDocument();
    expect(within(dialog).getByText('球后')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets the student go to an unfinished step', () => {
    const go = vi.fn();
    render(<StepReportCards cards={cards} onGoToStep={go} />);
    fireEvent.click(screen.getByRole('button', { name: /語詞複習/ }));
    fireEvent.click(screen.getByRole('button', { name: '前往這一關' }));
    expect(go).toHaveBeenCalledWith('vocab-review');
  });

  // ── #4028：完成了但有錯題 → 黃色，可以回去訂正 ─────────────────────────────
  const withReview: StepReportCard[] = [
    cards[0],
    {
      stepId: 'comprehension', baseId: 'comprehension', label: '閱讀理解', icon: 'quiz',
      completed: true, status: 'review', summary: '答對 3/4 題',
      details: [{ kind: 'answers', title: '作答紀錄', rows: [
        { label: '第 1 題', correct: false, studentAnswer: 'A', correctAnswer: 'B', corrected: true },
        { label: '第 2 題', correct: false, studentAnswer: 'C', correctAnswer: 'D', corrected: false },
      ] }],
    },
    cards[1],
  ];

  it('a completed step with mistakes counts as done but is yellow (#4028)', () => {
    render(<StepReportCards cards={withReview} />);
    expect(screen.getByText('完成 2 / 3 關')).toBeInTheDocument();
    expect(screen.getAllByLabelText('已完成')).toHaveLength(1);
    expect(screen.getAllByLabelText('已完成，有錯題要訂正')).toHaveLength(1);
    expect(screen.getByTestId('step-report-review-note')).toHaveTextContent('其中 1 關有錯題');
  });

  it('the yellow card lists first-try misses with corrected / not yet, and offers to go back (#4028)', () => {
    const go = vi.fn();
    render(<StepReportCards cards={withReview} onGoToStep={go} />);
    fireEvent.click(screen.getByRole('button', { name: /閱讀理解/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('已訂正')).toBeInTheDocument();
    expect(within(dialog).getByText('還沒訂正')).toBeInTheDocument();
    expect(within(dialog).getByText('你第一次選：A')).toBeInTheDocument();
    expect(within(dialog).getByText('正確答案：B')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '回去訂正' }));
    expect(go).toHaveBeenCalledWith('comprehension');
  });

  it('a green card has no go-back button', () => {
    render(<StepReportCards cards={withReview} onGoToStep={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /讀全文-做記號/ }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /回去訂正|前往這一關/ })).toBeNull();
  });
});
