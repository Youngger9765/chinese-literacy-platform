/**
 * 難字的判定法要讓人看得到 —— 而且**說的必須跟畫面上標的一致**
 *
 * ## 起因（產品端 2026-09-18）
 *
 * > 「原來難字 = 用戶自己唸錯過的字。那或許這個判斷法可以讓人知道，
 * >   這樣產品邏輯會更容易理解。」
 *
 * 規則有兩條（她唸錯過的字 → 沒紀錄才用這課最少見的字），而**使用者不知道自己
 * 看到的是哪一條**。代價是實際發生過的：Young 帶女兒 dogfood 時看到四年級課文標
 * 「之加千同大失小手成」，以為判定壞了 —— 那其實是走到最後那層退路
 * （本課生詞拆成單字，#3247 已修）。
 *
 * ## 這一份鎖的重點不是「有沒有字」，是**一致性**
 *
 * 一段跟畫面不符的說明比不解釋更糟：孩子會照著錯的理解去練。
 * 所以核心斷言是 `difficultSource` 必須跟 `processLinesSelective` 那條
 * fallback 鏈選到的來源**同一個**。兩邊分岔就紅。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ZhuyinProvider, useZhuyin } from '../../../context/ZhuyinContext';
import { PolyphonicProcessor } from '../../zhuyin/polyphonicProcessor';
import ZhuyinToggle from '../ZhuyinToggle';

vi.mock('../../../contexts/AuthContext', async () => {
  const React = await import('react');
  const fake = {
    token: 'tok', user: { id: 7, name: '小朋友', role: 'student' },
    login: async () => {}, logout: () => {}, isLoading: false,
  };
  return { AuthContext: React.createContext(fake), useAuth: () => fake };
});

const LINE = '寒氣逼人的冬天，滴水穿石的石臼';
const VOCAB = ['寒氣逼人', '滴水穿石'];

function poyin() {
  return JSON.parse(readFileSync(resolve(__dirname, '../../../../public/data/poyin_db.json'), 'utf8'));
}

function mockFetch(opts: { errors: string[]; hard: string | null }) {
  const db = poyin();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('poyin_db')) return { ok: true, json: async () => db } as Response;
    if (u.includes('error-patterns')) {
      return {
        ok: true,
        json: async () => ({
          patterns: opts.errors.map((c) => ({
            character: c, total_error_count: 2, sessions_with_error: 1,
            last_error_date: '2026-09-14', suggested_practice: true, is_corrected: false,
          })),
          total: opts.errors.length,
        }),
      } as Response;
    }
    if (u.includes('/zhuyin')) {
      const body: Record<string, unknown> = { lesson_uid: 'L0019', texts: [] };
      if (opts.hard !== null) body.hard = opts.hard;
      return { ok: true, json: async () => body } as Response;
    }
    return { ok: false, status: 404 } as Response;
  }));
}

/** 難字模式的輸出裡，哪些字真的被標了 */
function annotatedChars(out: string | undefined): Set<string> {
  const got = new Set<string>();
  if (!out) return got;
  let inSpan = false;
  for (const ch of out) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xE01EA) { inSpan = true; continue; }
    if (cp === 0xE01EB) { inSpan = false; continue; }
    if (cp >= 0xE0100 && cp <= 0xE01EF) continue;
    if (inSpan) got.add(ch);
  }
  return got;
}

async function setup(opts: { errors: string[]; hard: string | null }) {
  mockFetch(opts);
  const { result } = renderHook(() => useZhuyin(), {
    wrapper: ({ children }) => <ZhuyinProvider>{children}</ZhuyinProvider>,
  });
  await waitFor(() => expect(result.current.zhuyinReady).toBe(true));
  await act(async () => { await result.current.loadLessonZhuyin?.('L0019'); });
  return result;
}

beforeEach(() => {
  localStorage.setItem('zhuyin_mode_v2', 'difficult');
  (PolyphonicProcessor as unknown as { _instance: unknown })._instance = undefined;
  vi.restoreAllMocks();
});

describe('難字判定法：說的要跟標的一致', () => {
  it('⭐ 有錯字紀錄 → 規則說「你唸錯過的字」，而畫面標的也真的是那些字', async () => {
    const result = await setup({ errors: ['臼', '逼'], hard: '穿石' });
    expect(result.current.difficultSource).toBe('errors');
    expect(result.current.difficultCount).toBe(2);

    const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
    expect(marked.has('臼')).toBe(true);
    expect(marked.has('穿'), '規則說是錯字，畫面卻標了這一課的難字 —— 說的跟標的不一致').toBe(false);
  });

  it('⭐ 沒有錯字紀錄 → 規則說「這一課比較少見的字」，而畫面標的也真的是那些', async () => {
    const result = await setup({ errors: [], hard: '臼逼' });
    expect(result.current.difficultSource).toBe('lesson');
    expect(result.current.difficultCount).toBe(2);

    const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
    expect(marked.has('臼')).toBe(true);
    expect(marked.has('人'), '規則說是這課的難字，畫面卻標了生詞夾帶的字').toBe(false);
  });

  it('⭐ 兩者都沒有 → 規則說「生詞拆出來的字」，而畫面標的也真的是生詞', async () => {
    const result = await setup({ errors: [], hard: null });
    expect(result.current.difficultSource).toBe('vocab');

    const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
    expect(marked.has('人'), '退回生詞時畫面要標生詞').toBe(true);
  });

  it('開關真的把那句話印出來（三種來源各有各的話）', () => {
    const cases: Array<[Parameters<typeof ZhuyinToggle>[0]['difficultSource'], RegExp]> = [
      ['errors', /唸錯過的字/],
      ['lesson', /比較少見的字/],
      ['vocab', /生詞/],
    ];
    for (const [source, re] of cases) {
      const { unmount } = render(
        <ZhuyinToggle mode="difficult" ready onModeChange={() => {}}
          difficultSource={source} difficultCount={3} />,
      );
      expect(screen.getByText(re), `${source} 沒有印出對應的說明`).toBeTruthy();
      unmount();
    }
  });

  it('正向對照：不是難字模式就不印那句話（課文畫面不要雜訊）', () => {
    for (const mode of ['none', 'all'] as const) {
      const { unmount } = render(
        <ZhuyinToggle mode={mode} ready onModeChange={() => {}}
          difficultSource="errors" difficultCount={3} />,
      );
      expect(screen.queryByText(/唸錯過的字/), `${mode} 模式不該出現難字說明`).toBeNull();
      unmount();
    }
  });
});
