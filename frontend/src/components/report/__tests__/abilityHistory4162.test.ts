/**
 * #4162 能力診斷：跨課雷達平均、矩陣、診斷句（純計算，規則產生、不用模型）
 */
import { describe, it, expect } from 'vitest';
import {
  bandOf,
  averageOfOthers,
  matrixOf,
  diagnose,
  lessonsNeeded,
  type LessonAbility,
} from '../abilityHistory';
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

describe('bandOf（與老師端熱度矩陣同一套門檻：80 以上綠、60 到 79 黃、低於 60 紅、沒做灰）', () => {
  it('邊界值', () => {
    expect(bandOf(80)).toBe('green');
    expect(bandOf(100)).toBe('green');
    expect(bandOf(79)).toBe('yellow');
    expect(bandOf(60)).toBe('yellow');
    expect(bandOf(59)).toBe('low');
    expect(bandOf(0)).toBe('low');
    expect(bandOf(null)).toBe('none');
  });
});

describe('averageOfOthers：最近 5 課平均（不含這一課）', () => {
  const cur = lesson(9, { vocab: 50 });
  it('沒有其他課回 null（畫不出平均線）', () => {
    expect(averageOfOthers(cur, [cur])).toBeNull();
  });
  it('只平均有分數的課，且最多取最近 5 課', () => {
    const others = [
      lesson(1, { vocab: 0 }), // 第 6 近，不算
      lesson(2, { vocab: 100 }), lesson(3, { vocab: 100 }), lesson(4, { vocab: 100 }),
      lesson(5, { vocab: 100 }), lesson(6, { vocab: 50, meaning: 70 }),
    ];
    const avg = averageOfOthers(cur, [...others, cur])!;
    expect(avg.find((p) => p.key === 'vocab')?.value).toBe(90);
    expect(avg.find((p) => p.key === 'meaning')?.value).toBe(70);
    expect(avg.find((p) => p.key === 'fluency')?.value).toBeNull();
  });
});

describe('matrixOf：五列、最近 6 課（舊到新）', () => {
  it('做完 3 課 → 3 欄有資料，其餘補空', () => {
    const ls = [1, 2, 3].map((n) => lesson(n, { vocab: 90, meaning: 70 }));
    const m = matrixOf(ls);
    expect(m.columns).toHaveLength(3);
    expect(m.rows).toHaveLength(5);
    expect(m.rows[0].cells.map((c) => c.band)).toEqual(['green', 'green', 'green']);
    expect(m.rows[2].cells.map((c) => c.band)).toEqual(['none', 'none', 'none']);
    expect(m.padding).toBe(3);
  });
  it('超過 6 課只留最近 6 課', () => {
    const ls = [1, 2, 3, 4, 5, 6, 7].map((n) => lesson(n, { vocab: 90 }));
    const m = matrixOf(ls);
    expect(m.columns.map((c) => c.sessionId)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(m.padding).toBe(0);
  });
});

describe('lessonsNeeded：做不到兩課時還差幾課', () => {
  it('1 課差 1、0 課差 2、2 課以上 0', () => {
    expect(lessonsNeeded(0)).toBe(2);
    expect(lessonsNeeded(1)).toBe(1);
    expect(lessonsNeeded(2)).toBe(0);
    expect(lessonsNeeded(5)).toBe(0);
  });
});

describe('diagnose：連續三課低於 60 才點名', () => {
  it('詞語力最近三課都偏低 → 點名並建議語詞複習', () => {
    const ls = [lesson(1, { vocab: 90 }), lesson(2, { vocab: 40 }), lesson(3, { vocab: 30 }), lesson(4, { vocab: 55 })];
    const d = diagnose(ls)!;
    expect(d.axisKey).toBe('vocab');
    expect(d.text).toContain('詞語力');
    expect(d.text).toContain('語詞複習');
    expect(d.suggestedStepId).toBe('vocab-review');
  });
  it('只低兩課不點名', () => {
    const ls = [lesson(1, { vocab: 90 }), lesson(2, { vocab: 40 }), lesson(3, { vocab: 30 })];
    expect(diagnose(ls)).toBeNull();
  });
  it('其中一課沒分數就不算連續', () => {
    const ls = [lesson(1, { vocab: 40 }), lesson(2, { meaning: 90 }), lesson(3, { vocab: 30 }), lesson(4, { vocab: 20 })];
    expect(diagnose(ls)).toBeNull();
  });
  it('剛好 60 不算偏低', () => {
    const ls = [1, 2, 3].map((n) => lesson(n, { vocab: 60 }));
    expect(diagnose(ls)).toBeNull();
  });
  it('多項都偏低時點名平均最低的那一項', () => {
    const ls = [1, 2, 3].map((n) => lesson(n, { vocab: 50, meaning: 20 }));
    expect(diagnose(ls)?.axisKey).toBe('meaning');
  });
  it('資料不足三課回 null', () => {
    expect(diagnose([lesson(1, { vocab: 10 }), lesson(2, { vocab: 10 })])).toBeNull();
  });
});
