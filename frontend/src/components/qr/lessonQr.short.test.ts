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

  it('沒有代號就不出網址 —— 回空字串，不是悄悄印長網址', () => {
    // owner 2026-08-25：「每一個 QR code 都是一組 QR slug url」。
    // 舊版在這裡退回 `/learn/{id}/{step}`，而退回是無聲的：
    // QR 掃得開、頁面也對，只是把課號跟路由名印在紙上 ——
    // 那正是這一層要消除的東西。空字串讓呼叫端看得見缺代號。
    expect(buildLessonQrValue('https://x.test', 7, 'full-text-annotate')).toBe('');
    expect(buildLessonQrValue('https://x.test', 7, 'key-passage-reading', null)).toBe('');
  });

  it('入口網域預設是正式站，不是「按下載時剛好在哪」', () => {
    // PM 在 staging 產的那批 QR 每一張都指向測試站，就是因為傳了
    // window.location.origin。預設值必須是正式站。
    expect(QR_ENTRY_ORIGIN).toBe('https://lingoleap-prod.web.app');
  });
});
