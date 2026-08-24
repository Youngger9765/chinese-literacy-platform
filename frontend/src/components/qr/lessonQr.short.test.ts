import { describe, it, expect } from 'vitest';
import { buildLessonQrValue, QR_ENTRY_ORIGIN } from './lessonQr';

describe('QR 印的是短網址', () => {
  it('有代號就印 /q/{代號} —— 紙上不帶課號、不帶路由名', () => {
    expect(buildLessonQrValue('https://x.test', 20063, 'key-passage-reading', '9a7x4'))
      .toBe('https://x.test/q/9a7x4');
  });

  it('三篇的念順順是三個不同的短網址', () => {
    const v = ['yprak', '9a7x4', 'ajy9w']
      .map((s) => buildLessonQrValue('https://x.test', 20063, 'key-passage-reading', s));
    expect(new Set(v).size).toBe(3);
  });

  it('沒有代號（舊資料）退回長網址，而且看得出來是長的', () => {
    // 退回本身是對的（能掃的 QR 勝過沒有 QR），但不可以無聲 ——
    // 後台清單有網址欄，長網址在那裡一眼認得出來。
    expect(buildLessonQrValue('https://x.test', 7, 'full-text-annotate'))
      .toBe('https://x.test/learn/7/full-text-annotate');
  });

  it('入口網域預設是正式站，不是「按下載時剛好在哪」', () => {
    // PM 在 staging 產的那批 QR 每一張都指向測試站，就是因為傳了
    // window.location.origin。預設值必須是正式站。
    expect(QR_ENTRY_ORIGIN).toBe('https://lingoleap-prod.web.app');
  });
});
