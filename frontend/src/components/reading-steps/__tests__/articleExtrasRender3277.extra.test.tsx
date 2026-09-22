/**
 * 另外兩個不在課文層的出處／表格（#3277）。
 *
 * 前 12 課的五種欄位住在 `full_text_annotate` 底下，所以接到課文層就對了。
 * 這兩課不是，而我第一版的探針**剛好六個都挑到 full_text_annotate 那幾課**：
 *
 *   L0096  出處行在**聚光燈那段文章**底下 → 提到課文層會印在錯的地方
 *   L0150  出處行在**選擇題附的那張表**底下 → 而整張表本來根本沒送出去
 *
 * ⚠️ L0150 的形狀比「少一行出處」嚴重：第 4 題問的是那張 PISA 排名表，
 *    表沒送 = 學生被要求讀一張看不到的表。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TableDisplay from '../TableDisplay';
import { tableFrom, tableSourceLine } from '../articleExtras';

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: null, user: null }) }));

// L0150 第 4 題附的那張表，照 yml 的真形狀（rows 是陣列的陣列）
const pisa = {
  title: '臺灣歷年 PISA 閱讀排名',
  columns: ['項目', '2015', '2018', '2022'],
  rows: [['閱讀排名', '23', '17', '5'], ['參與國家數', '72', '79', '81']],
  source_line: '資料來源：臺灣PISA國家研究中心',
  carrier_note: '這張表整張在文字層（不是圖），照常受逐字門檢查。',
};

describe('#3277 選擇題附的表', () => {
  it('轉得出表，而且畫得出格子（少了它，題目在問看不到的東西）', () => {
    const t = tableFrom(pisa, 'mcq-3-table', '表');
    expect(t).not.toBeNull();
    expect(t!.headers).toEqual(['項目', '2015', '2018', '2022']);
    render(<TableDisplay tables={[t!]} layout="stacked" />);
    expect(screen.getByText('參與國家數')).toBeTruthy();
    expect(screen.getByText('81')).toBeTruthy();
  });

  it('表自己的出處行取得到，而且不會被當成一欄塞進表格裡', () => {
    expect(tableSourceLine(pisa)).toBe('資料來源：臺灣PISA國家研究中心');
    const t = tableFrom(pisa, 'x', '表')!;
    expect(t.headers).not.toContain('資料來源：臺灣PISA國家研究中心');
    expect(JSON.stringify(t.rows)).not.toContain('臺灣PISA國家研究中心');
  });

  it('沒有表的題目不會憑空生出一張空表', () => {
    expect(tableFrom(undefined, 'x', '表')).toBeNull();
    expect(tableFrom({ columns: ['a'], rows: [] }, 'x', '表')).toBeNull();
    expect(tableSourceLine(undefined)).toBeUndefined();
  });
});
