/**
 * #4157 —— 一關都沒做時，報告頁只放一張引導卡，不放九張灰卡；
 * 有進度後才展開卡片，未完成的卡片旁有「去做」。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StepReportCards from '../StepReportCards';
import type { StepReportCard } from '../reportCardsModel';

const mk = (stepId: string, label: string, completed: boolean): StepReportCard => ({
  stepId, baseId: stepId, label, icon: 'edit_note',
  completed, status: completed ? 'done' : 'none', attempts: [], chart: null, rate: null,
  toFix: 0, fixed: 0, unit: '題', summary: completed ? '做完了' : null, details: [],
});

const none = [mk('lesson-intro', '課程簡介', false), mk('vocab-review', '語詞複習', false)];
const some = [mk('lesson-intro', '課程簡介', true), mk('vocab-review', '語詞複習', false)];

describe('#4157 報告頁沒有任何進度', () => {
  it('⭐ 只看到引導卡與「開始第 1 關」，沒有關卡灰卡', () => {
    const go = vi.fn();
    render(<StepReportCards storyTitle="贏得喝采的輸家" cards={none} onGoToStep={go} />);
    expect(screen.getByTestId('report-not-started')).toBeInTheDocument();
    expect(screen.getByText('還沒開始，從第 1 關出發')).toBeInTheDocument();
    expect(screen.queryAllByLabelText('未完成')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /語詞複習/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '開始第 1 關' }));
    expect(go).toHaveBeenCalledWith('lesson-intro');
  });

  it('⛔ 沒有 onGoToStep（老師端看學生）時不出現「開始」按鈕', () => {
    render(<StepReportCards cards={none} />);
    expect(screen.getByTestId('report-not-started')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '開始第 1 關' })).toBeNull();
  });

  it('⛔ 有一關完成就展開卡片，且未完成的卡片旁有「去做」', () => {
    const go = vi.fn();
    render(<StepReportCards cards={some} onGoToStep={go} />);
    expect(screen.queryByTestId('report-not-started')).toBeNull();
    expect(screen.getByRole('button', { name: /課程簡介/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '去做：語詞複習' }));
    expect(go).toHaveBeenCalledWith('vocab-review');
  });

  it('⛔ 做過題目但還沒按完成，不能說「還沒開始」', () => {
    const partial = [
      { ...mk('lesson-intro', '課程簡介', false), attempts: [{ label: '第 1 次', rate: 50 }] as unknown as StepReportCard['attempts'] },
      mk('vocab-review', '語詞複習', false),
    ];
    render(<StepReportCards cards={partial} onGoToStep={() => {}} />);
    expect(screen.queryByTestId('report-not-started')).toBeNull();
  });
});
