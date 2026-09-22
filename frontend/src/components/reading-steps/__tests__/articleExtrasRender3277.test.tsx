/**
 * 出處行與正文表格要真的出現在畫面上（#3277）。
 *
 * 轉接器的單元測試只證明形狀對；它證明不了「有被 render」——
 * 而這個缺陷的全部內容就是「資料在、畫面沒有」。所以這一條打在 DOM 上。
 *
 * ⚠️ 先前的形狀是：yml 有 → 逐字門綠 → 忠實度證明綠 → 服務端沒宣告 →
 *    前端沒接 → 學生看不到，而且沒有任何紅燈。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { articleTables } from '../articleExtras';
import TableDisplay from '../TableDisplay';
import type { Story } from '../../../types';

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: null, user: null }) }));

const story = {
  id: 1, title: 't', content: ['第一段'],
  sourceLine: '本課選自天下文化出版的《在意識的繁花裡漫步》',
  inlineTable: {
    label: '查證資料來源',
    columns: ['查證問題→查什麼資料', '來源'],
    rows: [['Q1虎襲真的可能發生嗎？→虎的數量', '〈虎〉，維基百科']],
  },
} as unknown as Story;

describe('#3277 課文正文的額外內容會 render', () => {
  it('表格轉出來之後，TableDisplay 真的把標題與格子畫出來', () => {
    const tables = articleTables(story);
    expect(tables).toHaveLength(1);
    render(<TableDisplay tables={tables} layout="stacked" />);
    expect(screen.getByText('查證資料來源')).toBeTruthy();
    expect(screen.getByText('〈虎〉，維基百科')).toBeTruthy();
    expect(screen.getByText('查證問題→查什麼資料')).toBeTruthy();
  });

  it('沒有這些欄位的課，不會多畫出一個空表', () => {
    const plain = { id: 2, title: 't', content: ['x'] } as unknown as Story;
    expect(articleTables(plain)).toHaveLength(0);
  });
});
