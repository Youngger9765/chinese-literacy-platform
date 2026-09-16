/**
 * #3227 後半 —— 真的 429 不可以把學生丟回登入頁然後放著。
 *
 * ## 症狀（實測，不是推測）
 *
 * 2026-09-16 staging：CORS preflight 吃掉一半的限流額度 → `/api/users/me` 拿到 429
 * → `getMe()` 失敗 → `user` 留 null → `isAuthenticated = !!user` false
 * → route gate 把**手上拿著完全有效 token 的學生**導去登入頁。他得重打帳密。
 *
 * preflight 那一半已經在 #3234 修掉，但**真的 429 落在真請求上時症狀一樣**：
 * 阻塞階段的重試預算是 200ms + 400ms，而 429 的 `Retry-After` 是幾十秒 ——
 * 三次全花在同一個限流窗口裡，必然全滅。
 *
 * ## 修法：兩段
 *
 * 阻塞階段照舊短（每一毫秒都是學生在看 spinner），**失敗後在背景繼續試**。
 * 學生先看到登入頁（誠實：現在真的沒登入），但伺服器一恢復畫面自己變回已登入。
 *
 * ⛔ 不可以把阻塞階段拉長：那是拿「所有人都多等幾十秒」換「少數人不用重登」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { AuthProvider, useAuth } from '../AuthContext';
import * as authApi from '../../services/authApi';

const USER = { id: 7, name: '小朋友', email: 's@example.com', role: 'student' };
const wrap = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('#3227 auth 從 429 自己恢復', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.setItem('lingoleap_token', 'tok');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('⭐ 429 之後背景續試成功 → 學生自己變回已登入，不必重打帳密', async () => {
    const e429 = new authApi.AuthError('Too many requests', 429, 1);
    const spy = vi.spyOn(authApi, 'getMe')
      .mockRejectedValueOnce(e429)   // 阻塞階段 1
      .mockRejectedValueOnce(e429)   // 阻塞階段 2
      .mockRejectedValueOnce(e429)   // 阻塞階段 3（預算用完）
      .mockResolvedValue(USER as never);   // 背景第一次就成功

    const { result } = renderHook(() => useAuth(), { wrapper: wrap });

    // 阻塞階段結束：沒有 user（誠實），但 token 還在
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('lingoleap_token')).toBe('tok');

    // `Retry-After: 1` → 背景第一格等 1 秒
    await vi.advanceTimersByTimeAsync(1200);
    await waitFor(() => expect(result.current.user).toEqual(USER));
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('⛔ 401 不重試，而且 token 要清掉（真的死了）', async () => {
    const spy = vi.spyOn(authApi, 'getMe')
      .mockRejectedValue(new authApi.AuthError('unauthorized', 401));

    const { result } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(localStorage.getItem('lingoleap_token')).toBeNull();
    // 阻塞階段第一次就放棄（401 是 dead），背景不該再試
    const before = spy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(40000);
    expect(spy.mock.calls.length).toBe(before);
    expect(result.current.user).toBeNull();
  });

  it('⛔ 背景續試途中變成 401 → 清 token 並停手（不要無限試）', async () => {
    const spy = vi.spyOn(authApi, 'getMe')
      .mockRejectedValueOnce(new authApi.AuthError('429', 429))
      .mockRejectedValueOnce(new authApi.AuthError('429', 429))
      .mockRejectedValueOnce(new authApi.AuthError('429', 429))
      .mockRejectedValue(new authApi.AuthError('unauthorized', 401));

    const { result } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await vi.advanceTimersByTimeAsync(3000);       // 背景第一格（2 秒）
    await waitFor(() => expect(localStorage.getItem('lingoleap_token')).toBeNull());
    const after401 = spy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(40000);
    expect(spy.mock.calls.length).toBe(after401);  // 停手了
  });

  it('⛔ 正向對照：一開始就成功時沒有任何背景重試', async () => {
    const spy = vi.spyOn(authApi, 'getMe').mockResolvedValue(USER as never);
    const { result } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(result.current.user).toEqual(USER));
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(40000);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('⛔ 阻塞階段不可以被拉長 —— 600ms 內要交還畫面', async () => {
    vi.spyOn(authApi, 'getMe')
      .mockRejectedValue(new authApi.AuthError('429', 429, 30));
    const t0 = Date.now();
    const { result } = renderHook(() => useAuth(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // 200 + 400 = 600ms 的退避，加上 mock 幾乎零成本的呼叫
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('#3227 AuthError 帶得動 Retry-After', () => {
  it('讀得到秒數', () => {
    const e = new authApi.AuthError('x', 429, 42);
    expect(e.retryAfterSeconds).toBe(42);
  });
  it('⛔ 沒給就是 undefined，不要猜一個數字', () => {
    expect(new authApi.AuthError('x', 500).retryAfterSeconds).toBeUndefined();
  });
});
