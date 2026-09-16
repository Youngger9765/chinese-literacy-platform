/**
 * #3240 —— 難字門檻可調（錯幾次算「還不會」）。
 *
 * #3224 把難字改成「這孩子唸錯過的字」，門檻寫死 1 次。
 * 1 對「才剛開始唸」的孩子是對的，但唸久了錯字會累積 —— 那時 2 次或 3 次才是
 * 「真的還不會」。調它的人就是在裝置前面的人（同一個翻注音開關的人）。
 *
 * ⛔ 不做成老師端的班級設定：那要 DB 欄位 + 後台介面，而這是「當下看得舒服」的偏好，
 *    不是教學決定 —— 做成班級設定反而讓家長在家裡調不動。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { ZhuyinProvider, useZhuyin, THRESHOLD_MIN, THRESHOLD_MAX } from '../ZhuyinContext';

vi.mock('../../contexts/AuthContext', async () => {
  const R = await import('react');
  const fake = { token: 'tok', user: { id: 7, name: '小朋友', role: 'student' } };
  return { AuthContext: R.createContext(fake), useAuth: () => fake };
});

const wrap = ({ children }: { children: React.ReactNode }) => (
  <ZhuyinProvider>{children}</ZhuyinProvider>
);

describe('#3240 難字門檻', () => {
  let calls: string[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      calls.push(String(u));
      return { ok: true, json: async () => ({ patterns: [] }) };
    }) as never);
  });
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it('⭐ 預設是 1（#3224 的值，不可以無聲漂掉）', () => {
    const { result } = renderHook(() => useZhuyin(), { wrapper: wrap });
    expect(result.current.difficultThreshold).toBe(1);
  });

  it('⭐ 改門檻會用新值重新去拿錯字', async () => {
    const { result } = renderHook(() => useZhuyin(), { wrapper: wrap });
    await waitFor(() => expect(calls.some((u) => u.includes('min_errors=1'))).toBe(true));
    act(() => result.current.setDifficultThreshold(3));
    await waitFor(() => expect(calls.some((u) => u.includes('min_errors=3'))).toBe(true));
  });

  it('⭐ 存得住（重新掛載還在）', () => {
    const a = renderHook(() => useZhuyin(), { wrapper: wrap });
    act(() => a.result.current.setDifficultThreshold(4));
    a.unmount();
    const b = renderHook(() => useZhuyin(), { wrapper: wrap });
    expect(b.result.current.difficultThreshold).toBe(4);
  });

  it('⛔ 夾在範圍內（越界不會送出奇怪的 min_errors）', () => {
    const { result } = renderHook(() => useZhuyin(), { wrapper: wrap });
    act(() => result.current.setDifficultThreshold(999));
    expect(result.current.difficultThreshold).toBe(THRESHOLD_MAX);
    act(() => result.current.setDifficultThreshold(-5));
    expect(result.current.difficultThreshold).toBe(THRESHOLD_MIN);
    act(() => result.current.setDifficultThreshold(2.7));
    expect(result.current.difficultThreshold).toBe(3);   // 四捨五入，不是 NaN
  });

  it('⛔ localStorage 有垃圾時回預設，不是 NaN', () => {
    localStorage.setItem('zhuyin_difficult_threshold_v1', '不是數字');
    const { result } = renderHook(() => useZhuyin(), { wrapper: wrap });
    expect(result.current.difficultThreshold).toBe(1);
  });

  it('⛔ 正向對照：這個 fetch spy 真的抓到了呼叫（否則上面那條是假的）', async () => {
    renderHook(() => useZhuyin(), { wrapper: wrap });
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.some((u) => u.includes('error-patterns'))).toBe(true);
  });
});
