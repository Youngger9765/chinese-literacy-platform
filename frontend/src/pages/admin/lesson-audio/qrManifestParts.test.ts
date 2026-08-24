/**
 * 後台 QR 清單：一課多篇要一篇一列，而且「有課文」不等於「有念順順」（#2916）。
 *
 * **沒有這條會怎樣**：
 *  - 一課一列 → G6-L22 有三篇，教材端只拿得到整課的兩個碼，另外四個永遠不存在
 *  - 用整課的 has_key_reading 判斷 → G8-L13 兩篇都沒有念順順（原稿就沒印，
 *    見 content_known_gaps.yaml），卻會發出兩個指向靜音的碼
 */
import { describe, it, expect } from 'vitest';
import { buildQrManifestRows } from './LessonAudioTable';

const base = {
  lesson_number: 20063, title: 't', grade: 6,
  grade_code: 'G6-L22', char_count: 1, has_key_reading: true,
} as never;

describe('buildQrManifestRows — 一課多篇', () => {
  it('單篇課維持一列，網址不帶 ?p=', () => {
    const rows = buildQrManifestRows(
      [{ ...(base as object), id: 20011, grade: 4, grade_code: 'G4-L1', part_rounds: null }] as never, 'https://x');
    expect(rows).toHaveLength(1);
    expect(rows[0].full_url).toBe('https://x/learn/20011/full-text-annotate');
    expect(rows[0].passage_url).toBe('https://x/learn/20011/key-passage-reading');
    expect(rows[0].lesson_no).toBe('G4-L1');
  });

  it('三篇課展開成三列，六個 QR 各自是自己那一節的代號', () => {
    const rows = buildQrManifestRows([{ ...(base as object), id: 20063, part_rounds: [
      // `slug` 是課文的；`full_slug` / `key_slug` 是那一節自己的。
      // 念順順的代號跟課文的**不同號** —— slug 是身分，不是引用（#2916）。
      { slug: 'p3kud', part: 1, has_full: true, has_key: true, full_slug: 'p3kud', key_slug: 'yprak' },
      { slug: '4uee3', part: 2, has_full: true, has_key: true, full_slug: '4uee3', key_slug: '9a7x4' },
      { slug: '7wavn', part: 3, has_full: true, has_key: true, full_slug: '7wavn', key_slug: 'ajy9w' },
    ] }] as never, 'https://x');
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.lesson_no)).toEqual(['G6-L22（篇1）', 'G6-L22（篇2）', 'G6-L22（篇3）']);
    // 短網址：紙上只有代號，沒有課號也沒有路由名（#2916）
    expect(rows[1].full_url).toBe('https://x/q/4uee3');
    expect(rows[2].passage_url).toBe('https://x/q/ajy9w');
    // 念順順不可以印成課文的碼 —— 那會讓兩個不同的 QR 掃到同一個地方
    expect(rows[2].passage_url).not.toBe(rows[2].full_url);
    const urls = rows.flatMap(r => [r.full_url, r.passage_url]);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toHaveLength(6);
  });

  it('🔴 有課文不代表有念順順：該篇 has_key=false 就不發碼', () => {
    const rows = buildQrManifestRows([{ ...(base as object), id: 20111, grade_code: 'G8-L13',
      grade: 8, has_key_reading: true, part_rounds: [
        { slug: '33uhx', part: 1, has_full: true, has_key: false },
        { slug: 'r4d9j', part: 2, has_full: true, has_key: false },
      ] }] as never, 'https://x');
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.passage_url === '')).toBe(true);
  });

  it('8–9 年級依規格不交付全文碼', () => {
    const rows = buildQrManifestRows([{ ...(base as object), id: 20144, grade_code: 'G9-L23',
      grade: 9, part_rounds: [
        { slug: 'wdnd7', part: 1, has_full: true, has_key: true,
          full_slug: 'wdnd7', key_slug: 'mca6h' },
      ] }] as never, 'https://x');
    expect(rows[0].full_url).toBe('');
    expect(rows[0].passage_url).toBe('https://x/q/mca6h');
  });
});
