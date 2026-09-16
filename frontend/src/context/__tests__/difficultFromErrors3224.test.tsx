/**
 * 難字改成「這個孩子唸錯過的字」，不是「本課生詞拆成的單字」（#3224）
 *
 * ## 家長實測回報（2026-09-16）
 *
 * 三段鷹架：全注音 → 只留難字 → 全無。第二段要的是**收斂到孩子的卡點**。
 * 但原本的難字集合是 `buildDifficultCharSet(story.vocabulary)` ——
 * 取本課生詞拆成單字，全文每次出現都標。於是：
 *
 *   「人」來自「寒氣逼人」· 「水」「石」來自「滴水穿石」→ 早就會了卻每次都標
 *   「臼」「匪」「筋」不在生詞清單裡 → 一個都不標
 *
 * 它不是判錯難度，是**沒有在判難度**：生詞是課程的屬性，難字是讀者的屬性。
 *
 * ## 改法
 *
 * 平台已經在收正確的那份資料（`character_errors`，每次朗讀落地一次），
 * 所以是接線不是建表：`ZhuyinProvider` 自己去拿 `error-patterns`（`min_errors=1`），
 * 有資料就用她的錯字，沒有（第一次唸這一課／新學生）退回生詞清單。
 *
 * ⛔ 刻意**不新增元件要 import 的 export** —— 有 10 個測試檔用 `vi.mock` 工廠
 *    只回 `useZhuyin`，多一個 export 會把它們全炸掉（#3218 踩過一次）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ZhuyinProvider, useZhuyin } from '../ZhuyinContext';
import { PolyphonicProcessor } from '../../components/zhuyin/polyphonicProcessor';

// auth 用 vi.mock 工廠（repo 慣例）。⚠️ 也要給 `AuthContext` 本體 ——
// `ZhuyinProvider` 讀的是 context 不是 `useAuth()`（後者沒 Provider 會 throw，
// 而有 12 個測試檔 render 真的 ZhuyinProvider 卻沒包 auth）。
// ⛔ 工廠會被 hoist 到檔案最上面，所以裡面不可以引用頂層變數。
vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react');
  const fake = {
    token: 'tok',
    user: { id: 7, name: '小朋友', role: 'student' },
    login: async () => {},
    logout: () => {},
    isLoading: false,
  };
  return { AuthContext: React.createContext(fake), useAuth: () => fake };
});

const LINE = '寒氣逼人的冬天，滴水穿石的石臼';
/** 本課生詞拆出來的字（原本的難字來源）—— 含「人」「水」「石」 */
const VOCAB = ['寒氣逼人', '滴水穿石'];
/** 她實際唸錯過的字 —— 「臼」在生詞裡沒有 */
const HER_ERRORS = ['臼', '逼'];

function poyin() {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../../../public/data/poyin_db.json'), 'utf8'),
  );
}

/** fetch 要按 URL 分流 —— provider 掛載時自己會抓 poyin_db，整包攔掉會讓它永遠 not ready */
function mockFetch(errorChars: string[] | null) {
  const db = poyin();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('poyin_db')) return { ok: true, json: async () => db } as Response;
    if (u.includes('error-patterns')) {
      if (errorChars === null) return { ok: false, status: 500 } as Response;
      return {
        ok: true,
        json: async () => ({
          patterns: errorChars.map((c) => ({
            character: c, total_error_count: 1, sessions_with_error: 1,
            last_error_date: null, suggested_practice: true, is_corrected: false,
          })),
          total: errorChars.length,
        }),
      } as Response;
    }
    if (u.includes('/zhuyin')) return { ok: false, status: 404 } as Response;
    return { ok: false, status: 404 } as Response;
  }));
}

function wrapWithAuth(children: React.ReactNode) {
  return <ZhuyinProvider>{children}</ZhuyinProvider>;
}

/** 難字模式的輸出裡，哪些字真的被標了（帶 DIFFICULT_SPAN 標記的） */
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

beforeEach(() => {
  localStorage.setItem('zhuyin_mode_v2', 'difficult');
  (PolyphonicProcessor as unknown as { _instance: unknown })._instance = undefined;
  vi.restoreAllMocks();
});

describe('#3224 難字來源', () => {
  it('⭐ 有錯字紀錄 → 標她唸錯的字，不是生詞拆出來的字', async () => {
    mockFetch(HER_ERRORS);
    const { result } = renderHook(() => useZhuyin(), {
      wrapper: ({ children }) => wrapWithAuth(children),
    });
    await waitFor(() => expect(result.current.zhuyinReady).toBe(true));
    await waitFor(() => {
      const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
      expect(marked.has('臼')).toBe(true);
    });

    const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
    expect(marked.has('臼'), '臼 是她唸錯過的，必須標').toBe(true);
    expect(marked.has('逼'), '逼 是她唸錯過的，必須標').toBe(true);
    expect(marked.has('人'), '人 只是被「寒氣逼人」夾帶進來，她會，不該標').toBe(false);
    expect(marked.has('水'), '水 同上').toBe(false);
  });

  it('沒有錯字紀錄（第一次唸這課）→ 退回生詞清單，不是整片空白', async () => {
    mockFetch([]);
    const { result } = renderHook(() => useZhuyin(), {
      wrapper: ({ children }) => wrapWithAuth(children),
    });
    await waitFor(() => expect(result.current.zhuyinReady).toBe(true));
    const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
    expect(marked.has('人'), '沒有錯字資料時要退回生詞，否則第二段會完全沒東西').toBe(true);
    expect(marked.has('臼'), '臼 不在生詞裡，退回模式下不該標').toBe(false);
  });

  it('端點掛掉 → fail-open 退回生詞清單，不是整個不標', async () => {
    mockFetch(null);
    const { result } = renderHook(() => useZhuyin(), {
      wrapper: ({ children }) => wrapWithAuth(children),
    });
    await waitFor(() => expect(result.current.zhuyinReady).toBe(true));
    const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
    expect(marked.has('人')).toBe(true);
  });

  it('正向對照：量具沒壞 —— 難字模式真的只標選到的字', async () => {
    mockFetch(HER_ERRORS);
    const { result } = renderHook(() => useZhuyin(), {
      wrapper: ({ children }) => wrapWithAuth(children),
    });
    await waitFor(() => expect(result.current.zhuyinReady).toBe(true));
    const marked = annotatedChars(result.current.processLinesSelective([LINE], VOCAB)?.[0]);
    // 少了這條，「全部都標」也會讓上面三條綠
    expect(marked.has('的'), '的 不在任何集合裡，不該標').toBe(false);
    expect(marked.has('冬'), '冬 同上').toBe(false);
  });
});
