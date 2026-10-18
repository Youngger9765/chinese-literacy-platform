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
    completed: true, summary: '做了 2 個記號',
    details: [{ kind: 'marks', marks: [
      { type: 'unknown', text: '喝采', paragraphIndex: 0 },
      { type: 'important', text: '球后', paragraphIndex: 1 },
    ] }],
  },
  { stepId: 'vocab-review', baseId: 'vocab-review', label: '語詞複習', icon: 'search', completed: false, summary: null, details: [] },
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
});
