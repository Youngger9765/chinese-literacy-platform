/**
 * #3780 P0-1：iPad 用螢幕寬度判斷「是不是手機」會被誤判成桌機（820px 寬
 * 套到 `md:` 斷點）。這支測試鎖的是「依輸入方式判斷，不是螢幕寬度」——
 * 刻意用一個「螢幕很寬但是觸控輸入」的組合（模擬 iPad 橫向）跟「螢幕很窄
 * 但是滑鼠」的組合（模擬縮小視窗的桌機瀏覽器）互相對照，確認判斷依據真
 * 的是輸入方式而不是尺寸。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCoarsePointerDevice, isFinePointerDevice } from '../inputMode';

function stubPointer({ coarse, maxTouchPoints, fine = false }: { coarse: boolean; maxTouchPoints: number; fine?: boolean }) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query === '(pointer: coarse)' ? coarse : query === '(any-pointer: fine)' ? fine : false,
  })));
  vi.stubGlobal('navigator', { maxTouchPoints });
}

describe('isCoarsePointerDevice', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('寬螢幕（模擬 iPad 橫向 1180px）+ 觸控輸入 → true，不是依螢幕寬度判斷', () => {
    stubPointer({ coarse: true, maxTouchPoints: 5 });
    expect(isCoarsePointerDevice()).toBe(true);
  });

  it('matchMedia 判定是觸控但 maxTouchPoints 讀到 0（部分觸控筆裝置）→ true，必須真的靠 matchMedia 這條線判斷，不能只靠 maxTouchPoints 蒙對', () => {
    stubPointer({ coarse: true, maxTouchPoints: 0 });
    expect(isCoarsePointerDevice()).toBe(true);
  });

  it('窄螢幕 + 滑鼠（例如縮小視窗的桌機瀏覽器）→ false，不會被窄螢幕誤判成觸控', () => {
    stubPointer({ coarse: false, maxTouchPoints: 0 });
    expect(isCoarsePointerDevice()).toBe(false);
  });

  it('matchMedia 判斷不到但 maxTouchPoints > 0（部分瀏覽器對 pointer:coarse 支援度不一致）→ true', () => {
    stubPointer({ coarse: false, maxTouchPoints: 1 });
    expect(isCoarsePointerDevice()).toBe(true);
  });

  it('matchMedia 丟例外時不崩潰，改看 maxTouchPoints', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => { throw new Error('boom'); }));
    vi.stubGlobal('navigator', { maxTouchPoints: 2 });
    expect(() => isCoarsePointerDevice()).not.toThrow();
    expect(isCoarsePointerDevice()).toBe(true);
  });
});

/**
 * #3780 P0-1 退件：觸控 Chromebook 這種混合裝置——`maxTouchPoints > 0`
 * 讓 `isCoarsePointerDevice()` 判斷成觸控（合理，確實有觸控螢幕），但它
 * 同時也接了滑鼠／觸控板。`isFinePointerDevice()` 用 `(any-pointer: fine)`
 * 獨立回答「這台裝置上有沒有精準輸入」，兩個函式的結果不是互斥的——
 * 混合裝置應該兩個都回 true。
 */
describe('isFinePointerDevice', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('純觸控裝置（iPad，沒有滑鼠/觸控板）→ false', () => {
    stubPointer({ coarse: true, maxTouchPoints: 5, fine: false });
    expect(isFinePointerDevice()).toBe(false);
  });

  it('純滑鼠鍵盤裝置（桌機）→ true', () => {
    stubPointer({ coarse: false, maxTouchPoints: 0, fine: true });
    expect(isFinePointerDevice()).toBe(true);
  });

  it('混合裝置（觸控 Chromebook，螢幕觸控 + 接了觸控板）→ true，跟 isCoarsePointerDevice 同時成立，不是互斥', () => {
    stubPointer({ coarse: true, maxTouchPoints: 5, fine: true });
    expect(isCoarsePointerDevice()).toBe(true);
    expect(isFinePointerDevice()).toBe(true);
  });

  it('matchMedia 丟例外時不崩潰，回 false（不像 isCoarsePointerDevice 有 maxTouchPoints 當備援——沒有對應的「精準輸入點數」訊號可以退回去查）', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => { throw new Error('boom'); }));
    vi.stubGlobal('navigator', { maxTouchPoints: 0 });
    expect(() => isFinePointerDevice()).not.toThrow();
    expect(isFinePointerDevice()).toBe(false);
  });
});
