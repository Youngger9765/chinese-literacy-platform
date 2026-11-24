/**
 * #4104 學習批閱 — 學生端成績單上的老師批閱：退回的關卡紅色（優先於綠 / 黃）、
 * 最上方列出要重做的關、卡片與點開的對話框有評語與紅筆分數、標題旁有總分。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StepReportCards, { type CardsReview } from '../StepReportCards';
import type { StepReportCard } from '../reportCardsModel';

const card = (stepId: string, label: string): StepReportCard => ({
  stepId, baseId: stepId.split('#')[0], label, icon: 'quiz', completed: true, status: 'done',
  attempts: [], chart: null, rate: null, toFix: 0, fixed: 0, unit: '題', summary: '答對 4/4 題', details: [],
});
const cards = [card('comprehension#a', '閱讀理解'), card('spotlight#b', '閱讀聚光燈')];

const review: CardsReview = {
  totalScore: 86,
  teacherName: '李老師',
  steps: {
    'comprehension#a': { returned: true, comment: '第三題再讀一次第二段', score: 60 },
    'spotlight#b': { returned: false, comment: null, score: 95 },
  },
};

describe('StepReportCards — teacher review (#4104)', () => {
  it('returned step is red with the comment; the header lists it and shows the total', () => {
    const go = vi.fn();
    render(<StepReportCards cards={cards} review={review} onGoToStep={go} />);

    const returned = screen.getByRole('button', { name: /閱讀理解：老師退回，要重做.*老師給 60 分/ });
    expect(returned).toHaveAttribute('data-returned', 'true');
    expect(within(returned).getByTestId('returned-badge')).toBeInTheDocument();
    expect(within(returned).getByText('第三題再讀一次第二段')).toBeInTheDocument();

    const done = screen.getByRole('button', { name: /閱讀聚光燈：已完成.*老師給 95 分/ });
    expect(done).not.toHaveAttribute('data-returned');

    expect(screen.getByTestId('report-total-score')).toHaveTextContent('86');
    expect(screen.getByTestId('report-total-score')).toHaveTextContent('李老師批閱');

    const note = screen.getByTestId('step-report-returned-note');
    expect(note).toHaveTextContent('老師退回 1 關');
    fireEvent.click(within(note).getByRole('button', { name: /閱讀理解 → 去重做/ }));
    expect(go).toHaveBeenCalledWith('comprehension#a');
  });

  it('the dialog of a returned step says so and offers 去重做 even though it is complete', () => {
    const go = vi.fn();
    render(<StepReportCards cards={cards} review={review} onGoToStep={go} />);
    fireEvent.click(screen.getByRole('button', { name: /閱讀理解：/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('dialog-teacher-review')).toHaveTextContent('老師退回這一關，請重做');
    expect(within(dialog).getByText('李老師：')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '去重做' }));
    expect(go).toHaveBeenCalledWith('comprehension#a');
  });

  it('without a review nothing changes; teacher tools render under each card', () => {
    render(<StepReportCards cards={cards} renderCardTools={(c) => <span>tools-{c.stepId}</span>} />);
    expect(screen.queryByTestId('report-total-score')).not.toBeInTheDocument();
    expect(screen.queryByTestId('step-report-returned-note')).not.toBeInTheDocument();
    expect(screen.getByText('tools-comprehension#a')).toBeInTheDocument();
    expect(screen.getByText('tools-spotlight#b')).toBeInTheDocument();
  });
});
