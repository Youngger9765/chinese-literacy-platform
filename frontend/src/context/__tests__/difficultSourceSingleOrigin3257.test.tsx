/**
 * 面板報的層級，必須就是真正拿去標的那一層（#3257）
 *
 * ## 為什麼需要這一支
 *
 * #3257 讓畫面說出「現在生效的是哪一層」。最便宜的做法是 UI 自己再判一次
 * （`errorChars.size > 0 ? ... : ...`）—— 那會變成同一條規則有兩份實作，而這個
 * repo 已經為「同語意兩份實作」付過很貴的代價：#3218 量到執行期選擇器與逐課表對
 * 同一段課文給不同答案，7,682 / 65,754 個破音字位置不一致。
 *
 * 所以優先序收在 `resolveDifficultSource` 一支裡，兩個消費端都叫它。這支測試鎖的是
 * **它們不會分岔** —— 用真的 provider，把「面板說的層級」跟「processLinesSelective
 * 真正標出來的字」綁在同一條斷言上。有人把優先序重新內聯成第二份實作、而順序寫得
 * 不一樣，這裡就紅。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ZhuyinProvider, useZhuyin, resolveDifficultSource } from '../ZhuyinContext';

vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react');
  const fake = {
    token: 'tok',
    user: { id: 7, name: '小朋友', role: 'student' },
    login: async () => {}, logout: () => {}, isLoading: false,
  };
  return { AuthContext: React.createContext(fake), useAuth: () => fake };
});

const LINE = '寒氣逼人的冬天，滴水穿石的石臼';
/** 本課生詞拆出來的字（第③層）—— 含早就會的「人」「水」「石」 */
const VOCAB = ['寒氣逼人', '滴水穿石'];
/** 後端算好的難字（第②層） */
const HARD = '臼逼';

/** 從標注結果撈出「真的被標了」的字（難字 span 的哨兵之間） */
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

/** @param patterns error-patterns 的回應 @param hard /zhuyin 的 hard 欄位（null = 舊後端） */
function mockFetch(patterns: unknown[], hard: string | null) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('error-patterns')) {
      return { ok: true, json: async () => ({ patterns, total: patterns.length }) } as Response;
    }
    if (u.includes('/zhuyin')) {
      const body: Record<string, unknown> = { lesson_uid: 'L0019', texts: [] };
      if (hard !== null) body.hard = hard;
      return { ok: true, json: async () => body } as Response;
    }
    return { ok: false, status: 404 } as Response;
  }));
}

async function setup(patterns: unknown[], hard: string | null) {
  mockFetch(patterns, hard);
  const { result } = renderHook(() => useZhuyin(), {
    wrapper: ({ children }) => <ZhuyinProvider>{children}</ZhuyinProvider>,
  });
  await waitFor(() => expect(result.current.zhuyinReady).toBe(true));
  await act(async () => { await result.current.loadLessonZhuyin?.('L0019'); });
  return result;
}

const ERR_PATTERNS = [
  { character: '臼', total_error_count: 3, last_error_date: '2026-08-24T06:24:23Z', is_corrected: false },
  { character: '匪', total_error_count: 1, last_error_date: '2026-08-24T06:24:23Z', is_corrected: false },
];

beforeEach(() => {
  localStorage.setItem('zhuyin_mode_v2', 'difficult');
  vi.restoreAllMocks();
});

describe('#3257 優先序只有一份實作', () => {
  it('⭐ 純函式的三層順序：錯字 > 年級 > 生詞', () => {
    const e = new Set(['A']);
    const h = new Set(['B']);
    expect(resolveDifficultSource(e, h, ['C']).source).toBe('errors');
    expect(resolveDifficultSource(new Set(), h, ['C']).source).toBe('grade');
    expect(resolveDifficultSource(new Set(), new Set(), ['C']).source).toBe('vocab');
    // 生效那一層的字也要跟著對，否則「報對層級但拿錯集合」會溜過去
    expect([...resolveDifficultSource(e, h, ['C']).chars]).toEqual(['A']);
    expect([...resolveDifficultSource(new Set(), h, ['C']).chars]).toEqual(['B']);
    expect([...resolveDifficultSource(new Set(), new Set(), ['C']).chars]).toEqual(['C']);
  });
});

describe('#3257 面板說的層級 == 真正標出來的字', () => {
  it('⭐ 有錯字紀錄：報 errors，標的就是那些錯字', async () => {
    const result = await setup(ERR_PATTERNS, HARD);
    await waitFor(() => expect(result.current.difficultExplain.source).toBe('errors'));

    const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
    expect(marked.has('臼'), '錯字要標').toBe(true);
    // 負向對照：另兩層的字不可以混進來
    expect(marked.has('逼'), '逼 只在年級層 —— 錯字層生效時不該標').toBe(false);
    expect(marked.has('人'), '人 只在生詞層').toBe(false);
    // 面板列的字 == 真正標的字
    expect(result.current.difficultExplain.chars.sort()).toEqual(['匪', '臼'].sort());
  });

  it('⭐ 沒有錯字紀錄：報 grade，標的就是後端的 hard', async () => {
    const result = await setup([], HARD);
    await waitFor(() => expect(result.current.difficultExplain.source).toBe('grade'));

    const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
    expect(marked.has('臼')).toBe(true);
    expect(marked.has('逼')).toBe(true);
    expect(marked.has('人'), '生詞夾帶的字不該出現').toBe(false);
    expect(result.current.difficultExplain.chars).toEqual(['臼', '逼']);
  });

  it('⭐ 舊後端沒回 hard：報 vocab，標的就是生詞拆出來的字', async () => {
    const result = await setup([], null);
    await waitFor(() => expect(result.current.difficultExplain.source).toBe('vocab'));

    const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
    expect(marked.has('人'), '這一層就是會標早就會的字 —— 那正是要講清楚的事').toBe(true);
    // provider 沒有生詞清單，所以面板不列字（誠實降級，不是 bug）
    expect(result.current.difficultExplain.chars).toEqual([]);
    expect(result.current.difficultExplain.lessonLoaded, '表載到了，只是沒有 hard').toBe(true);
  });

  it('還沒載任何課：lessonLoaded=false —— 面板才分得出「舊後端」跟「還沒進課文」', async () => {
    mockFetch([], HARD);
    const { result } = renderHook(() => useZhuyin(), {
      wrapper: ({ children }) => <ZhuyinProvider>{children}</ZhuyinProvider>,
    });
    await waitFor(() => expect(result.current.zhuyinReady).toBe(true));
    expect(result.current.difficultExplain.lessonLoaded).toBe(false);
  });
});

describe('#3257 端點本來就有的次數與日期要留下來', () => {
  it('⭐ 逐字帶 count 與 lastDate，並按錯的次數排序', async () => {
    const result = await setup(ERR_PATTERNS, HARD);
    await waitFor(() => expect(result.current.difficultExplain.errors.length).toBe(2));

    const errs = result.current.difficultExplain.errors;
    expect(errs[0], '錯最多次的排前面').toMatchObject({ char: '臼', count: 3 });
    expect(errs[1]).toMatchObject({ char: '匪', count: 1 });
    expect(errs[0].lastDate, 'last_error_date 不可以被丟掉').toContain('2026-08-24');
  });

  it('已訂正的字不進清單（維持 #3224 的行為）', async () => {
    const result = await setup(
      [...ERR_PATTERNS, { character: '筋', total_error_count: 9, is_corrected: true, last_error_date: null }],
      HARD,
    );
    await waitFor(() => expect(result.current.difficultExplain.source).toBe('errors'));
    expect(result.current.difficultExplain.chars).not.toContain('筋');
    // 正向對照：沒訂正的還在（否則「全部過濾掉」也會綠）
    expect(result.current.difficultExplain.chars).toContain('臼');
  });

  it('舊後端沒有 count/date 欄位 → 降級成「有這個字但 0 次」，不是整筆丟掉', async () => {
    const result = await setup([{ character: '臼', is_corrected: false }], HARD);
    await waitFor(() => expect(result.current.difficultExplain.source).toBe('errors'));
    expect(result.current.difficultExplain.errors[0]).toMatchObject({ char: '臼', count: 0, lastDate: null });
  });
});

describe('#3257 memo 身分要穩 —— 否則整頁課文每次 render 都重跑注音', () => {
  it('⭐ 無關的 re-render 不可以換掉 processLinesSelective 的身分', async () => {
    // ⛔ 這裡一定要用 `rerender()` 去逼一次真的 re-render。
    //
    //    第一版寫的是 `setDifficultThreshold(1)`（本來就是 1）——那條**驗不到任何
    //    東西**：setState 設成同值時 React 直接 bail out 不重跑 render，所以不管有
    //    沒有 memo 身分都不會變。實測把 `useMemo` 整個拿掉，那一版 9 個測試照樣全綠。
    //
    //    `rerender()` 會真的重跑 Provider，而且不碰 `errorDetails`／`zhuyinMode`
    //    （那兩個換身分是合理的），所以它分得出「memo 在不在」。
    mockFetch(ERR_PATTERNS, HARD);
    const { result, rerender } = renderHook(() => useZhuyin(), {
      wrapper: ({ children }) => <ZhuyinProvider>{children}</ZhuyinProvider>,
    });
    await waitFor(() => expect(result.current.difficultExplain.source).toBe('errors'));

    const before = result.current.processLinesSelective;
    rerender();
    expect(
      result.current.processLinesSelective,
      'errorChars 每次 render 現做一個新 Set 的話這裡會換身分 —— 那代表四個消費端的 memo 每次 render 都重跑整頁注音',
    ).toBe(before);
  });
});
