/**
 * #4162 能力診斷：矩陣圖、診斷句、資料不足、雷達的「最近 5 課平均」
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import AbilityMatrixPanel from '../AbilityMatrixPanel';
import { RadarPanel } from '../ReportCharts';
import type { LessonAbility } from '../abilityHistory';
import type { RadarPoint } from '../reportCardsModel';

const KEYS = ['vocab', 'meaning', 'structure', 'strategy', 'fluency'] as const;
const LABELS: Record<string, string> = {
  vocab: '詞語力', meaning: '文意理解', structure: '結構統整', strategy: '閱讀策略', fluency: '朗讀流暢',
};
const pts = (v: Partial<Record<(typeof KEYS)[number], number | null>>): RadarPoint[] =>
  KEYS.map((k) => {
    const value = v[k] ?? null;
    return { key: k, label: LABELS[k], value, state: value === null ? ('todo' as const) : ('scored' as const) };
  });
const lesson = (n: number, v: Parameters<typeof pts>[0]): LessonAbility => ({
  sessionId: n, storyId: `S${n}`, title: `第${n}課`, points: pts(v),
});
const full = { vocab: 90, meaning: 70, structure: 50, strategy: 85, fluency: 40 };

describe('AbilityMatrixPanel', () => {
  it('做完 3 課：5 列、每列 3 格有色，另外 3 欄灰色', () => {
    render(<AbilityMatrixPanel lessons={[1, 2, 3].map((n) => lesson(n, full))} />);
    const rows = screen.getAllByRole('row').slice(1); // 去掉表頭
    expect(rows).toHaveLength(5);
    const vocabRow = rows[0];
    const colored = within(vocabRow).getAllByRole('button');
    expect(colored).toHaveLength(3);
    expect(colored.map((b) => b.getAttribute('data-band'))).toEqual(['green', 'green', 'green']);
    expect(vocabRow.querySelectorAll('[data-band="none"]')).toHaveLength(3);
    // 顏色對應門檻：文意 70 黃、結構 50 低、朗讀 40 低
    expect(within(rows[1]).getAllByRole('button')[0].getAttribute('data-band')).toBe('yellow');
    expect(within(rows[2]).getAllByRole('button')[0].getAttribute('data-band')).toBe('low');
    expect(screen.queryByTestId('ability-need-more')).toBeNull();
  });

  it('只做 1 課：寫「再做 1 課就能比較」，不是空白', () => {
    render(<AbilityMatrixPanel lessons={[lesson(1, full)]} />);
    expect(screen.getByTestId('ability-need-more').textContent).toContain('再做 1 課就能比較');
    expect(screen.getAllByRole('row')).toHaveLength(6);
  });

  it('連續三課詞語力低於 60：診斷句點名詞語力並建議語詞複習，按鈕跳到最新一課該關', () => {
    const go = vi.fn();
    const ls = [1, 2, 3].map((n) => lesson(n, { vocab: 40, meaning: 90 }));
    render(<AbilityMatrixPanel lessons={ls} onGoToLessonStep={go} />);
    const d = screen.getByTestId('ability-diagnosis');
    expect(d.textContent).toContain('詞語力');
    expect(d.textContent).toContain('語詞複習');
    fireEvent.click(screen.getByRole('button', { name: '現在就去做' }));
    expect(go).toHaveBeenCalledWith('S3', 'vocab-review');
  });

  it('沒有連續三課偏低：不顯示診斷句', () => {
    const ok = { vocab: 90, meaning: 85, structure: 80, strategy: 85, fluency: 90 };
    render(<AbilityMatrixPanel lessons={[1, 2, 3].map((n) => lesson(n, ok))} />);
    expect(screen.queryByTestId('ability-diagnosis')).toBeNull();
  });

  it('沒做的灰格不能點', () => {
    const go = vi.fn();
    render(<AbilityMatrixPanel lessons={[lesson(1, { vocab: 90 }), lesson(2, { vocab: 90 })]} onGoToLessonStep={go} />);
    const meaningRow = screen.getAllByRole('row')[2];
    const btns = within(meaningRow).getAllByRole('button');
    expect(btns.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(btns[0]);
    expect(go).not.toHaveBeenCalled();
  });

  it('點格子跳到該課該項能力的第一關', () => {
    const go = vi.fn();
    render(<AbilityMatrixPanel lessons={[lesson(1, full), lesson(2, full)]} onGoToLessonStep={go} />);
    const row = screen.getAllByRole('row')[1];
    fireEvent.click(within(row).getAllByRole('button')[1]);
    expect(go).toHaveBeenCalledWith('S2', 'vocab-definition');
  });
});

describe('RadarPanel 最近 5 課平均', () => {
  it('有平均資料：畫圖例「虛線：最近 5 課平均」並在各項顯示平均', () => {
    const avg = pts({ vocab: 60, meaning: 60, structure: 60, strategy: 60, fluency: 60 });
    render(<RadarPanel points={pts(full)} average={avg} />);
    expect(screen.getByTestId('report-radar-legend').textContent).toContain('最近 5 課平均');
    expect(screen.getAllByText('平均 60')).toHaveLength(5);
  });
  it('沒有平均資料（只有一課或老師端）：沒有圖例，維持單課雷達', () => {
    render(<RadarPanel points={pts(full)} average={null} />);
    expect(screen.queryByTestId('report-radar-legend')).toBeNull();
    expect(screen.queryByText(/平均 \d+/)).toBeNull();
  });
});
