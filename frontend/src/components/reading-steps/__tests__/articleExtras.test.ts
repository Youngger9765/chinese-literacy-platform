/**
 * 課文正文的表格與出處行要真的變成畫面上的東西（#3277）。
 *
 * 修之前：13 份 yml 帶著這五種欄位，後端與前端**各 0 處引用**。
 * L0035 的 `source_line` 從 #2736 就在檔案裡，一直沒人看到。
 */
import { describe, it, expect } from 'vitest';
import { articleTables } from '../articleExtras';
import type { Story } from '../../../types';

const base = { id: 1, title: 't', content: [] } as unknown as Story;

describe('課文正文的表格轉成 TableDisplay 吃的形狀', () => {
  it('以欄名為 key 的 rows（多模態抽取寫這種）', () => {
    const s = { ...base, inlineTable: {
      label: '股利對照表',
      columns: ['股東', '投資金額'],
      rows: [{ 股東: '瑪莉', 投資金額: '1000元' }, { 股東: '達安', 投資金額: '5000元' }],
    } } as unknown as Story;
    const [t] = articleTables(s);
    expect(t.title).toBe('股利對照表');
    expect(t.headers).toEqual(['股東', '投資金額']);
    expect(t.rows.map((r) => r.cells)).toEqual([['瑪莉', '1000元'], ['達安', '5000元']]);
  });

  it('陣列的陣列 rows —— 直接對 row.map 會炸的那一種', () => {
    const s = { ...base, inlineTable: {
      label: '查證資料來源',
      columns: ['查證問題', '來源'],
      rows: [['Q1虎襲真的可能發生嗎？', '〈虎〉，維基百科']],
    } } as unknown as Story;
    const [t] = articleTables(s);
    expect(t.rows[0].cells).toEqual(['Q1虎襲真的可能發生嗎？', '〈虎〉，維基百科']);
  });

  it('一格裡有多個值時換行排，不吐 [object Object]', () => {
    const s = { ...base, inlineTable: { columns: ['例句'], rows: [{ 例句: ['學而時習之', '此物最相思'] }] } } as unknown as Story;
    expect(articleTables(s)[0].rows[0].cells[0]).toBe('學而時習之\n此物最相思');
  });

  it('四種欄位照原稿順序都收進來，空的不產生空表', () => {
    const s = { ...base,
      inlineTables: [{ columns: ['a'], rows: [['1']] }, { columns: ['b'], rows: [['2']] }],
      comparisonTable: { columns: ['c'], rows: [['3']] },
      summaryTable: { columns: ['d'], rows: [] },      // 沒有列 → 不該產生表
    } as unknown as Story;
    expect(articleTables(s).map((t) => t.id)).toEqual(['inline-tables-0', 'inline-tables-1', 'comparison-table']);
  });

  it('什麼都沒有時回空陣列（不是 undefined，呼叫端會 .length）', () => {
    expect(articleTables(base)).toEqual([]);
  });
});
