/**
 * 掛真的元件，斷言學生**在畫面上**看到那五種欄位（#3277）。
 *
 * ⚠️ 為什麼一定要這一條：同批的另一個測試是 `render(<TableDisplay …>)` ——
 *    那只證明「轉接器 + 表格元件」對，把 `FullTextAnnotate` 裡的渲染區塊
 *    整個刪掉它照樣綠。而這個缺陷的全部內容就是「資料在、沒人畫」，
 *    所以鎖必須打在真的渲染端上。
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Story, MultipleChoiceItem } from '../../../types';

// ⚠️ 只給這兩個元件真的會讀的欄位。抄 smoke test 那份完整的 auth mock 會帶進
//    `loginPassword` / `mustChangePassword`，而 pre-commit 的 SecretSanitizer 會把
//    「password 後面跟著一個值」判成 SQL PASSWORD／GENERIC SECRET（偽陽性，但那是
//    我自己引進的偽陽性，砍掉比加例外乾淨）。
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, token: null, isAuthenticated: false, isLoading: false }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({ zhuyinMode: 'none', zhuyinReady: true, zhuyinActive: false,
    isZhuyinAny: false, isZhuyinAll: false, isZhuyinNone: true, zhuyinEnabled: false,
    setZhuyinMode: vi.fn(), setZhuyinEnabled: vi.fn(), toggleZhuyin: vi.fn(),
    processZhuyin: (t: string) => t, processLines: () => null, processLinesSelective: () => null }),
  ZhuyinProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../context/KaraokeContext', () => ({
  useKaraoke: () => ({ karaokeEnabled: false, setKaraokeEnabled: vi.fn(), toggleKaraoke: vi.fn() }),
  KaraokeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'k' }),
  useParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  NavLink: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import FullTextAnnotate from '../FullTextAnnotate';
import MultipleChoiceExercise from '../MultipleChoiceExercise';

const STORY: Story = {
  id: '1', title: '測試課文', level: '1',
  content: ['這是第一段。'], paragraphs: ['這是第一段。'],
  thumbnail: '', category: 'Fable', filename: 't.yml', grade: '4', charCount: 10,
  // L0151 的形狀
  sourceLine: '本課選自天下文化出版的《在意識的繁花裡漫步》',
  // L0156 的形狀（rows 是陣列的陣列）
  inlineTable: {
    label: '查證資料來源',
    columns: ['查證問題', '來源'],
    rows: [['Q1虎襲真的可能發生嗎？', '〈虎〉，維基百科']],
  },
} as unknown as Story;

describe('#3277 課文頁真的把出處行與表格畫出來', () => {
  it('出處行出現在畫面上', () => {
    render(<FullTextAnnotate story={STORY} onFinish={vi.fn()} />);
    expect(screen.getByTestId('reading-annotation-source-line').textContent)
      .toContain('在意識的繁花裡漫步');
  });

  it('課文正文的表格出現在畫面上（標題與格子都要有）', () => {
    render(<FullTextAnnotate story={STORY} onFinish={vi.fn()} />);
    expect(screen.getByTestId('reading-annotation-article-tables')).toBeTruthy();
    expect(screen.getByText('查證資料來源')).toBeTruthy();
    expect(screen.getByText('〈虎〉，維基百科')).toBeTruthy();
  });

  it('沒有這些欄位的課，兩個區塊都不出現', () => {
    const plain = { ...STORY, sourceLine: undefined, inlineTable: undefined } as unknown as Story;
    render(<FullTextAnnotate story={plain} onFinish={vi.fn()} />);
    expect(screen.queryByTestId('reading-annotation-source-line')).toBeNull();
    expect(screen.queryByTestId('reading-annotation-article-tables')).toBeNull();
  });
});

describe('#3277 選擇題真的把題目附的表畫出來', () => {
  const withTable: MultipleChoiceItem = {
    question: '臺灣學生的閱讀能力，和參與國比較，趨勢如何？',
    options: ['越來越好', '越來越差'],
    answer: 'A',
    explanation: null,
    material_table: {
      title: '臺灣歷年 PISA 閱讀排名',
      columns: ['項目', '2015', '2022'],
      rows: [['閱讀排名', '23', '5']],
      source_line: '資料來源：臺灣PISA國家研究中心',
    },
  };

  it('表、格子、出處行都在畫面上（少了它，題目在問看不到的東西）', () => {
    render(<MultipleChoiceExercise questions={[withTable]} onComplete={vi.fn()} lessonId="1" />);
    expect(screen.getByTestId('mcq-material-table')).toBeTruthy();
    expect(screen.getByText('閱讀排名')).toBeTruthy();
    expect(screen.getByText('資料來源：臺灣PISA國家研究中心')).toBeTruthy();
  });

  it('沒附表的題目不會多出一個空表', () => {
    render(<MultipleChoiceExercise
      questions={[{ ...withTable, material_table: null }]}
      onComplete={vi.fn()} lessonId="1" />);
    expect(screen.queryByTestId('mcq-material-table')).toBeNull();
  });
});
