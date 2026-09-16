/**
 * #3237 —— 執行期不准再有第二套讀音來源。
 *
 * ## 為什麼
 *
 * 注音以前是執行期算的：前端一套選擇器（`polyphonicProcessor.ts`）、後端疊出另一套。
 * 兩邊對同一段課文會給不同答案 —— #3218 量到全庫 **7,682 / 65,754 個破音字位置（11.7%）**
 * 不一致。#3218 把答案固化成逐課表，#3230 把覆蓋率做到 100%（45,606 個字串）。
 *
 * 但 `toProcessed()` 的 fallback 還在跑那套選擇器 —— 也就是第二套來源還活著，
 * 只是被推到「表裡沒有的字」那條窄路上。⛔ 留著它就是留著舊架構的活口。
 *
 * 現在表 miss 時給**字型預設讀音**（`0000` 就是字型的預設槽）—— 那是**查表**不是選擇。
 *
 * ⚠️ `polyphonicProcessor.ts` 這個檔還留著（`buildZhuyinString` 住在裡面、
 * 產表的 oracle 要 import 它）。它從執行期路徑變成產表工具 —— 那正是它該在的位置。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { ZhuyinProvider, useZhuyin, unpackSlots } from '../ZhuyinContext';
import { PolyphonicProcessor } from '../../components/zhuyin/polyphonicProcessor';

vi.mock('../../contexts/AuthContext', async () => {
  const R = await import('react');
  return { AuthContext: R.createContext(null), useAuth: () => null };
});

const wrap = ({ children }: { children: React.ReactNode }) => (
  <ZhuyinProvider>{children}</ZhuyinProvider>
);

describe('#3237 執行期沒有第二套讀音來源', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.setItem('zhuyin_mode_v2', 'all');
    spy = vi.spyOn(PolyphonicProcessor.instance, 'process');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })) as never);
  });
  afterEach(() => {
    spy.mockRestore();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('⭐ 表裡沒有的字 → 不呼叫執行期選擇器', () => {
    const { result } = renderHook(() => useZhuyin(), { wrapper: wrap });
    const out = result.current.processZhuyin('老師臨時貼的一段字');
    expect(out).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it('⛔ 正向對照：仍然吐得出東西（不是整段空白）', () => {
    const { result } = renderHook(() => useZhuyin(), { wrapper: wrap });
    const text = '老師臨時貼的一段字';
    const out = result.current.processZhuyin(text);
    // 去掉變體選擇器之後要還原成原文 —— 證明它有處理、不是回空字串
    const stripped = out.replace(/[\uDB40][\uDD00-\uDDEF]/g, '');
    expect(stripped).toBe(text);
  });

  it('⛔ 正向對照：這個 spy 抓得到真的呼叫（否則上面那條是假的）', () => {
    // 直接叫一次 —— spy 必須記錄到，證明它掛對了位置。
    // ⚠️ 要 mock 掉實作：真的 `process()` 在資料沒載入時會 throw
    //    （而那個 throw 本身就是「執行期沒載 poyin_db」的額外證據，見下一條）。
    spy.mockReturnValue([]);
    PolyphonicProcessor.instance.process('測試');
    expect(spy).toHaveBeenCalled();
  });

  it('⭐ Provider 從來沒有載入 poyin_db（188 KB 不再進使用者的網路）', () => {
    const loadSpy = vi.spyOn(PolyphonicProcessor.instance, 'loadPolyphonicData');
    renderHook(() => useZhuyin(), { wrapper: wrap });
    expect(loadSpy).not.toHaveBeenCalled();
    loadSpy.mockRestore();
  });

  it('⭐ 執行期選擇器連資料都沒有 —— 叫它會 throw（第二套來源真的斷線了）', () => {
    spy.mockRestore();   // 用真的實作
    expect(() => PolyphonicProcessor.instance.process('測試')).toThrow(/not loaded/i);
  });

  it('zhuyinReady 不再等 poyin_db 載入（執行期不需要它）', () => {
    const { result } = renderHook(() => useZhuyin(), { wrapper: wrap });
    expect(result.current.zhuyinReady).toBe(true);
  });

  it('unpackSlots 的編碼與後端同語意', () => {
    expect(unpackSlots('.1.2')).toEqual(['0000', 'ss01', '0000', 'ss02']);
    expect(unpackSlots('')).toEqual([]);
  });
});
