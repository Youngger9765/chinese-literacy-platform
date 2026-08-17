/**
 * 拿**真的課文資料**餵 renderer，不是我手寫的 fixture。
 *
 * 為什麼要另外一支：手寫 fixture 只會涵蓋我想得到的形狀，而這次三個缺陷
 * （table rows 是物件、fill_table 自己帶表、figure 只有轉錄步驟）全部是
 * 「我沒想到資料會長這樣」。真資料進來就沒有這個盲點。
 *
 * 斷言的是「不 throw ＋ 該出現的內容有出現」。white screen 是這次最貴的缺陷
 * （文-L6 的聚光燈整步掛掉），而它在型別檢查與 lint 底下完全隱形。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import BlockSequenceRenderer from '../BlockSequenceRenderer';
import type { SpotlightV2 } from '../../../types';

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: null, user: null }) }));
vi.mock('../../../services/learningApi', () => ({ validateStrategyAnswer: vi.fn() }));

const LESSONS = resolve(__dirname, '../../../../../backend/data/lessons');

const load = (uid: string) => {
  const p = resolve(LESSONS, uid, 'v3/spotlight.yml');
  if (!existsSync(p)) return null;
  const doc = parse(readFileSync(p, 'utf-8')) as { spotlight?: SpotlightV2 };
  return doc?.spotlight ?? null;
};

// 已翻新到 v3 的課。清單寫死是刻意的：新增課要有人來這裡加一行，
// 順手看一眼它畫得出來 —— 自動掃目錄會讓新課靜悄悄地沒被驗過。
const UIDS = ['L0001', 'L0002', 'L0003', 'L0004', 'L0005', 'L0006',
              'L0007', 'L0008', 'L0009', 'L0010', 'L0011', 'L0012',
              'L0034', 'L0072', 'L0105', 'L0124', 'L0140', 'L0161', 'L0174'];

describe('真資料進 renderer', () => {
  for (const uid of UIDS) {
    it(`${uid} 的聚光燈畫得出來，而且不是空的`, () => {
      const spotlight = load(uid);
      if (!spotlight) return;                     // 還沒翻新的課略過，不算失敗
      const { container } = render(<BlockSequenceRenderer spotlight={spotlight} />);
      const text = container.textContent ?? '';
      // 有 block 卻幾乎沒字 = 畫了個空殼，跟 white screen 一樣沒用
      const blocks = (spotlight as { blocks?: unknown[] }).blocks ?? [];
      expect(text.length, `${uid} 有 ${blocks.length} 個 block 卻只畫出 ${text.length} 個字`)
        .toBeGreaterThan(blocks.length * 10);
    });
  }

  it('文-L6 的表格用欄名當 key，表頭與內容都要在（就是它讓整頁白屏的）', () => {
    const spotlight = load('L0161');
    if (!spotlight) return;
    render(<BlockSequenceRenderer spotlight={spotlight} />);
    expect(screen.getAllByText('指示代詞').length).toBeGreaterThan(0);
    expect(screen.getByText(/學而時習之/)).toBeTruthy();
  });

  it('L0034 的策略表住在聚光燈裡，不可以被換成「請去重點表」', () => {
    const spotlight = load('L0034');
    if (!spotlight) return;
    render(<BlockSequenceRenderer spotlight={spotlight} />);
    expect(screen.getByText(/調整周遭環境/)).toBeTruthy();
  });
});
