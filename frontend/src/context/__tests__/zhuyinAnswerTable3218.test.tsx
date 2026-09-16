/**
 * 注音改成查逐課對照表 —— 前端不再自己算（#3218）
 *
 * 接縫是 `ProcessedChar[]`：五個消費元件全部走 `ZhuyinContext`，
 * 而它內部一律是 `buildZhuyinString(process(x))`。把 process 換成查表，
 * 五個元件一行都不用改。
 *
 * ⚠️ 這支測 `toProcessed` 的三個行為，其中兩個是守衛：
 *   ① 表裡有 → 用表（不呼叫 processor）
 *   ② 表裡沒有 → 回去算（老師臨時貼的字）
 *   ③ 有代理對 → 回去算（表的槽位按碼點產，這裡的索引是 UTF-16 單位）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { ZhuyinProvider, useZhuyin } from '../ZhuyinContext';
import { PolyphonicProcessor } from '../../components/zhuyin/polyphonicProcessor';
import { SS_MAPPING } from '../../components/zhuyin/bopomoConstants';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * fetch mock 要**按 URL 分流** —— `ZhuyinProvider` 掛載時自己會去抓
 * `poyin_db.json`，整包攔掉會讓 `zhuyinReady` 永遠是 false（整支測試空轉）。
 */
function mockFetch(lessonPayload: unknown | null) {
  const poyin = JSON.parse(
    readFileSync(resolve(__dirname, '../../../public/data/poyin_db.json'), 'utf8'),
  );
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('poyin_db')) return { ok: true, json: async () => poyin } as Response;
    if (u.includes('/zhuyin')) {
      if (lessonPayload === null) return { ok: false, status: 404 } as Response;
      return { ok: true, json: async () => lessonPayload } as Response;
    }
    return { ok: false, status: 404 } as Response;
  }));
}

const LINE = '他們相反的地方';
/** 表故意給一組「跟 processor 算出來一定不同」的槽位，才分得出用了哪一邊 */
const FAKE_SS = ['ss01', 'ss01', 'ss01', 'ss01', 'ss01', 'ss01', 'ss01'];

function wrap({ children }: { children: React.ReactNode }) {
  return <ZhuyinProvider>{children}</ZhuyinProvider>;
}

beforeEach(() => {
  localStorage.setItem('zhuyin_mode_v2', 'all');
  (PolyphonicProcessor as unknown as { _instance: unknown })._instance = undefined;
  vi.restoreAllMocks();
});

/** 把槽位字串接成 IVS 之後的樣子，用來斷言「畫出來的是哪一組槽位」 */
function withSelectors(text: string, ss: string[]) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    out += text[i];
    if (ss[i] !== '0000' && ss[i] in SS_MAPPING) {
      out += String.fromCodePoint(parseInt(SS_MAPPING[ss[i]], 16));
    }
  }
  return out;
}

describe('#3218 前端查表', () => {
  it('⭐ 表裡有這一段 → 用表的槽位，不是自己算的', async () => {
    mockFetch({ lesson_uid: 'L0001', texts: [{ text: LINE, ss: FAKE_SS }] });
    const { result } = renderHook(() => useZhuyin(), { wrapper: wrap });
    await waitFor(() => expect(result.current.zhuyinReady).toBe(true));
    await act(async () => { await result.current.loadLessonZhuyin('L0001'); });

    const got = result.current.processLinesSelective([LINE], [])?.[0];
    expect(got).toBe(withSelectors(LINE, FAKE_SS));
  });

  it('表裡沒有這一段（老師臨時貼的字）→ 回去自己算', async () => {
    mockFetch({ lesson_uid: 'L0001', texts: [{ text: LINE, ss: FAKE_SS }] });
    const { result } = renderHook(() => useZhuyin(), { wrapper: wrap });
    await waitFor(() => expect(result.current.zhuyinReady).toBe(true));
    await act(async () => { await result.current.loadLessonZhuyin('L0001'); });

    const other = '老師自己打的一段字';
    const got = result.current.processLinesSelective([other], [])?.[0];
    const own = result.current.processLinesSelective([other], [])?.[0];
    expect(got).toBe(own);
    // 不是表那組（表那組每個字都會帶 ss01 選擇器）
    expect(got).not.toBe(withSelectors(other, other.split('').map(() => 'ss01')));
  });

  it('表裡的字串含代理對 → 守衛啟動，回去自己算', async () => {
    const emoji = '他們相反🎉的地方';   // 🎉 是代理對：UTF-16 長度 != 碼點數
    mockFetch({ lesson_uid: 'L0001',
      texts: [{ text: emoji, ss: ['ss01','ss01','ss01','ss01','ss01','ss01','ss01','ss01'] }] });
    const { result } = renderHook(() => useZhuyin(), { wrapper: wrap });
    await waitFor(() => expect(result.current.zhuyinReady).toBe(true));
    await act(async () => { await result.current.loadLessonZhuyin('L0001'); });

    const got = result.current.processLinesSelective([emoji], [])?.[0];
    // 槽位陣列長度(8) == 碼點數(8) 但 != UTF-16 長度(9) → 必須 fallback
    expect(got).not.toContain(String.fromCodePoint(0xE0101).repeat(2));
  });

  it('端點回 404（這課還沒產表）→ 靜靜走 fallback，不丟錯', async () => {
    mockFetch(null);
    const { result } = renderHook(() => useZhuyin(), { wrapper: wrap });
    await waitFor(() => expect(result.current.zhuyinReady).toBe(true));
    await act(async () => { await result.current.loadLessonZhuyin('L0002'); });
    expect(result.current.processLinesSelective([LINE], [])?.[0]).toBeTruthy();
  });
});

describe('#3218 表到了畫面要重算（走 memo，不是直接呼叫）', () => {
  /**
   * ⭐ 這條是這支測試檔裡唯一抓得到 CRITICAL #1 的。
   *
   * 上面那些測試都是「先 `await loadLessonZhuyin()` 把表灌好，再直接呼叫
   * `processLinesSelective`」—— **完全沒經過 memo**，所以 `answers` 存在 ref 裡
   * （不進 dep 鏈）時它們照樣全綠。
   *
   * 真實的四個消費端長這樣：
   *     useMemo(() => processLinesSelective(story.content, vocabWords),
   *             [story.content, vocabWords, processLinesSelective])
   *
   * `story.content`／`vocabWords` 每課固定 → 只有 `processLinesSelective` 換身分
   * 才會重算。而它的 deps 是 `[zhuyinReady, zhuyinMode, toProcessed]` ——
   * 所以「表到了」必須讓 `toProcessed` 換身分，也就是 `answers` 必須是 state。
   *
   * 2026-09-15 對抗式複審實測的失敗形狀：poyin_db（同源靜態檔、常被快取）先載完
   * → memo 用空表算完 → 表後到 → 畫面停在 fallback 一整個 session。
   */
  it('⭐ 表 fetch 回來之後，memo 的輸出會從 fallback 變成表的答案', async () => {
    let resolveTable: (v: unknown) => void = () => {};
    const tablePromise = new Promise((r) => { resolveTable = r; });
    const poyin = JSON.parse(
      readFileSync(resolve(__dirname, '../../../public/data/poyin_db.json'), 'utf8'),
    );
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('poyin_db')) return { ok: true, json: async () => poyin } as Response;
      if (u.includes('/zhuyin')) {
        await tablePromise;   // 表比 poyin_db 晚到 —— 真實時序
        return { ok: true, json: async () => ({ texts: [{ text: LINE, ss: FAKE_SS }] }) } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }));

    // 照著真實元件的形狀包一層 memo
    const useLikeAComponent = () => {
      const { processLinesSelective, loadLessonZhuyin, zhuyinReady } = useZhuyin();
      const rendered = React.useMemo(
        () => processLinesSelective([LINE], [])?.[0],
        [processLinesSelective],
      );
      return { rendered, loadLessonZhuyin, zhuyinReady };
    };

    const { result } = renderHook(useLikeAComponent, { wrapper: wrap });
    await waitFor(() => expect(result.current.zhuyinReady).toBe(true));

    // ① 表還沒到：memo 已經算完，用的是 fallback
    const before = result.current.rendered;
    expect(before).toBeTruthy();
    expect(before).not.toBe(withSelectors(LINE, FAKE_SS));

    // ② 表到了
    await act(async () => {
      const p = result.current.loadLessonZhuyin('L0001');
      resolveTable(null);
      await p;
    });

    // ③ memo 必須重算成表的答案 —— 這條紅代表畫面永遠停在 fallback
    expect(result.current.rendered).toBe(withSelectors(LINE, FAKE_SS));
    expect(result.current.rendered).not.toBe(before);
  });
});
