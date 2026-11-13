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
    completed: true, status: 'this', previousAt: null, summary: '做了 2 個記號',
    details: [{ kind: 'marks', marks: [
      { type: 'unknown', text: '喝采', paragraphIndex: 0 },
      { type: 'important', text: '球后', paragraphIndex: 1 },
    ] }],
  },
  { stepId: 'vocab-review', baseId: 'vocab-review', label: '語詞複習', icon: 'search', completed: false, status: 'none', previousAt: null, summary: null, details: [] },
];

describe('StepReportCards', () => {
  it('shows progress and a green check only on completed cards', () => {
    render(<StepReportCards storyTitle="贏得喝采的輸家" cards={cards} />);
    expect(screen.getByText('這次完成 1 / 2 關')).toBeInTheDocument();
    expect(screen.getAllByLabelText('這次完成')).toHaveLength(1);
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

  // ── #4028：上次完成的關卡不能跟這次的混在一起 ──────────────────────────────
  const withPrevious: StepReportCard[] = [
    cards[0],
    {
      stepId: 'comprehension', baseId: 'comprehension', label: '閱讀理解', icon: 'quiz',
      completed: false, status: 'previous', previousAt: '2026-11-10T03:00:00Z', summary: '答對 3/4 題',
      details: [{ kind: 'stats', items: [{ label: '第一次就答對', value: '3 / 4 題' }] }],
    },
    cards[1],
  ];

  it('does not count a step done last time as done this time (#4028)', () => {
    render(<StepReportCards cards={withPrevious} />);
    expect(screen.getByText('這次完成 1 / 3 關')).toBeInTheDocument();
    expect(screen.getAllByLabelText('這次完成')).toHaveLength(1);
    expect(screen.getAllByLabelText('上次完成')).toHaveLength(1);
    expect(screen.getByText('上次完成 · 11/10')).toBeInTheDocument();
    expect(screen.getByTestId('step-report-previous-note')).toHaveTextContent('另有 1 關是上次完成的');
  });

  it('labels last time\'s score as last time\'s and offers a redo (#4028)', () => {
    const go = vi.fn();
    render(<StepReportCards cards={withPrevious} onGoToStep={go} />);
    fireEvent.click(screen.getByRole('button', { name: /閱讀理解/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/上次完成（11\/10），這次還沒做/)).toBeInTheDocument();
    expect(within(dialog).getByText('以下是上次的成績。')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '再做一次' }));
    expect(go).toHaveBeenCalledWith('comprehension');
  });

  it('says so when showing the most recent attempt instead of this one (#4028)', () => {
    render(<StepReportCards cards={cards} previousAttempt={{ at: '2026-11-13T06:05:00Z' }} />);
    expect(screen.getByText('最近一次的學習成果（11/13 14:05）')).toBeInTheDocument();
    expect(screen.getByText('那次完成 1 / 2 關')).toBeInTheDocument();
    expect(screen.getByTestId('step-report-previous-attempt')).toBeInTheDocument();
    // 標題說「那次」，卡片就不能說「這次」
    expect(screen.queryByLabelText('這次完成')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('已完成')).toHaveLength(1);
  });
});
