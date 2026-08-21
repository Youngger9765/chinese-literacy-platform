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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import BlockSequenceRenderer from '../BlockSequenceRenderer';
import { segmentBlocks } from '../spotlightBlockLogic';
import type { SpotlightV2, SpotlightBlock } from '../../../types';

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: null, user: null }) }));
vi.mock('../../../services/learningApi', () => ({ validateStrategyAnswer: vi.fn() }));

const LESSONS = resolve(__dirname, '../../../../../backend/data/lessons');

const load = (uid: string) => {
  const p = resolve(LESSONS, uid, 'v3/spotlight.yml');
  if (!existsSync(p)) return null;
  const doc = parse(readFileSync(p, 'utf-8')) as { spotlight?: SpotlightV2 };
  return doc?.spotlight ?? null;
};

// 自動掃出所有翻新到 v3 的課。
// 原本寫死清單，用意是「新增課要有人來加一行、順手看一眼」；到了 175 課的規模，
// 那個儀式只會變成漏加。改成自動掃 + 下限斷言：課數只會增加，掉下去就是有東西被刪了。
const V3_DIR = (uid: string) => resolve(LESSONS, uid, 'v3/spotlight.yml');
const UIDS = readdirSync(LESSONS)
  .filter(n => /^L\d{4}$/.test(n) && existsSync(V3_DIR(n)))
  .sort();

// 掃到 0 課 = 路徑錯了或資料沒了，別讓空跑看起來像全過
it('至少要掃到 20 課，否則是路徑錯或資料被刪', () => {
  expect(UIDS.length).toBeGreaterThanOrEqual(20);
});

describe('真資料進 renderer', () => {
  for (const uid of UIDS) {
    it(`${uid} 的聚光燈畫得出來，而且不是空的`, () => {
      const spotlight = load(uid);
      if (!spotlight) return;                     // 還沒翻新的課略過，不算失敗
      const { container } = render(<BlockSequenceRenderer spotlight={spotlight} />);
      const text = container.textContent ?? '';
      // 有 block 卻幾乎沒字 = 畫了個空殼，跟 white screen 一樣沒用
      //
      // 分母是**第一段**的 block 數，不是全課。渲染器是漸進式揭露，一次只畫一段，
      // 學生做完才出現下一段 —— 所以拿全課 block 數當分母的話，段數越多的課門檻
      // 越高、實際該畫的比例卻越小，兩者往相反方向跑。L0070（87 block／9 passage，
      // 全庫段數最多）就是這條錯誤分母第一次露餡的地方：畫出 854 字被要求 >870。
      const blocks = ((spotlight as { blocks?: unknown[] }).blocks ?? []) as SpotlightBlock[];
      const firstSegment = segmentBlocks(blocks)[0] ?? [];
      expect(text.length, `${uid} 第一段有 ${firstSegment.length} 個 block 卻只畫出 ${text.length} 個字（全課 ${blocks.length} block）`)
        .toBeGreaterThan(firstSegment.length * 10);
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
