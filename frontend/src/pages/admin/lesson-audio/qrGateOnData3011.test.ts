/**
 * 全文 QR 的閘門看「有沒有課文」，不看年級（#3011）。
 *
 * 明珠老師 2026-08-31 回報體育生品格 11 課掃不到全文 QR。真因是
 * `deliversFullText()` 只放行 grade 4–7，而那批課的 grade 是 `品格教育`
 * ——一個字串，`Number.parseInt` 回 NaN，於是整批被擋掉。8/9 年級同理。
 *
 * 那道年級閘門原本的理由寫在 code 註解裡：「8–9 年級沒預產音檔，
 * 掃了會指向 demo-reading/{id}/whole.mp3 這個永遠不會產生的檔」。
 * 那個理由**已經不成立**：
 *
 *   - `build_demo_reading.py`（`plan_demo_audio` 的家）已在 6894dda73 刪除
 *   - 前端沒有任何地方抓預產 mp3（grep `demo-reading` 只剩註解與測試字串）
 *   - QR 指向 `/learn/{id}/{step}`，訪客頁跟登入頁走**同一條**即時 TTS
 *
 * 所以那是「要批次產哪些檔」的技術限制，不是產品規則。Owner 2026-08-31：
 * 「只要有課文就可以生成」。
 *
 * ⛔ 這條鎖不是把斷言放寬。空碼的情況仍然要空 —— 只是判準從「幾年級」
 *    換成「這一節到底有沒有東西可以唸」。沒有課文 / 沒有代號一樣不出碼。
 */
import { describe, it, expect } from 'vitest';

import { buildQrManifestRows } from './LessonAudioTable';

const lesson = (over: Record<string, unknown>) => ({
  id: 1, lesson_number: 1, title: 't', grade: 5, grade_code: 'G5-L01',
  char_count: 100, has_key_reading: true, part_rounds: null, ...over,
});

describe('#3011 全文 QR 看資料不看年級', () => {
  it('非數字年級（品格教育）有課文就出全文碼', () => {
    const rows = buildQrManifestRows([lesson({
      id: 20167, grade: '品格教育', grade_code: '體-L1',
      part_rounds: [{ slug: 'a1', part: null, has_full: true, has_key: true, full_slug: 'a1', key_slug: 'k1' }],
    })] as never, 'https://x.test');

    expect(rows[0].full_url).toBe('https://x.test/q/a1');
    expect(rows[0].passage_url).toBe('https://x.test/q/k1');
  });

  it('8/9 年級有課文一樣出全文碼', () => {
    const rows = buildQrManifestRows([
      lesson({ id: 2, grade: 8, grade_code: 'G8-L4',
        part_rounds: [{ slug: 'b1', part: null, has_full: true, has_key: true, full_slug: 'b1', key_slug: 'k2' }] }),
      lesson({ id: 3, grade: 9, grade_code: 'G9-L1',
        part_rounds: [{ slug: 'c1', part: null, has_full: true, has_key: false, full_slug: 'c1', key_slug: null }] }),
    ] as never, 'https://x.test');

    expect(rows[0].full_url).toBe('https://x.test/q/b1');
    expect(rows[1].full_url).toBe('https://x.test/q/c1');
  });

  // ⭐ 負向對照。少了這兩條，上面兩條可以靠「一律出碼」通過 ——
  //    那才是真的放寬，而且會把碼印在指向空頁面的紙上。
  it('沒有課文就不出全文碼（即使年級在原本放行的範圍）', () => {
    const rows = buildQrManifestRows([lesson({
      grade: 5,
      part_rounds: [{ slug: 'd1', part: null, has_full: false, has_key: true, full_slug: 'd1', key_slug: 'k3' }],
    })] as never, 'https://x.test');

    expect(rows[0].full_url).toBe('');
    expect(rows[0].passage_url).toBe('https://x.test/q/k3');
  });

  it('沒有代號就不出碼（紙上不印長網址）', () => {
    const rows = buildQrManifestRows([lesson({
      grade: 5,
      part_rounds: [{ slug: 'e1', part: null, has_full: true, has_key: true, full_slug: null, key_slug: null }],
    })] as never, 'https://x.test');

    // full_slug 沒有時退回課文的 slug（`r?.full_slug ?? r?.slug`）——這是既有行為
    expect(rows[0].full_url).toBe('https://x.test/q/e1');
    // 念順順沒有自己的代號就不出碼：共用課文的碼會指到讀全文那一節
    expect(rows[0].passage_url).toBe('');
  });
});
