import { describe, it, expect } from 'vitest';
import { resolveActiveSteps } from '../stepConfig';
import { buildQrManifestRows } from '../../pages/admin/lesson-audio/LessonAudioTable';

/**
 * 重複模組要在**前台**也明確切分（#2916）—— 後端那一半在
 * `backend/specs/test_repeated_modules_split_spec.py`。
 *
 * 兩邊要一起看：後端拆了而前端把它們收斂回一步，症狀跟兩邊都沒拆一模一樣
 * （學生做完第 1 篇就沒有第 2、3 篇，而畫面上有內容、走得完、不報錯）。
 *
 * 2026-08-25 全庫實測：有重複模組的就這五課。
 */
const LESSONS = {
  'G5-L17': { steps: 18, full: 2, key: 2 },
  'G6-L22': { steps: 21, full: 3, key: 3 },
  'G8-L13': { steps: 8, full: 2, key: 0 },
  'G9-L16': { steps: 10, full: 2, key: 0 },
  'G9-L23': { steps: 17, full: 3, key: 0 },
} as const;

/** 後端實際回的 step_sequence（2026-08-25 從 staging 取，未經修剪）。 */
const SEQ: Record<keyof typeof LESSONS, string[]> = {
  'G5-L17': ['lesson-intro','full-text-annotate#fqwda','key-passage-reading#tfewt','vocab-definition#vycpf','vocab-application#r9jxj','keypoints-table#n3q4d','comprehension#7cfa6','full-text-annotate#n3qxn','key-passage-reading#d9d7p','vocab-definition#d3aqn','vocab-application#r49ht','keypoints-table#huac7','comprehension#6je7j','comprehension#xvud3','spotlight#mw3dn','vocab-review#vfd96','knowledge-station#9npfp','report'],
  'G6-L22': ['lesson-intro','full-text-annotate#p3kud','key-passage-reading#yprak','vocab-definition#mc9mf','vocab-application#4fq9w','keypoints-table#dydnq','full-text-annotate#4uee3','key-passage-reading#9a7x4','vocab-definition#3944x','vocab-application#3q3cd','keypoints-table#6xvh6','full-text-annotate#7wavn','key-passage-reading#ajy9w','vocab-definition#arpnw','vocab-application#6x4t9','keypoints-table#6pyvc','spotlight#fpctd','comprehension#9a3ve','vocab-review#9ahm4','knowledge-station#xf7e3','report'],
  'G8-L13': ['lesson-intro','full-text-annotate#33uhx','spotlight#jj4jh','full-text-annotate#r4d9j','spotlight#qedhr','knowledge-station#amhwp','comprehension#6tr3f','report'],
  'G9-L16': ['lesson-intro','full-text-annotate#ut67x','full-text-annotate#ppwdu','vocab-definition#afkuc','vocab-application#v7xu3','keypoints-table#66etm','comprehension#m7fne','vocab-review#fu7fr','knowledge-station#6333n','report'],
  'G9-L23': ['lesson-intro','full-text-annotate#a1','vocab-definition#b1','keypoints-table#c1','comprehension#d1','full-text-annotate#a2','vocab-definition#b2','keypoints-table#c2','comprehension#d2','full-text-annotate#a3','vocab-definition#b3','keypoints-table#c3','comprehension#d3','spotlight#e1','vocab-review#f1','knowledge-station#g1','report'],
};

describe('前台：重複模組各自是一個步驟', () => {
  it.each(Object.keys(LESSONS) as (keyof typeof LESSONS)[])(
    '%s 的步驟數與各模組份數都對得上後端',
    (code) => {
      const steps = resolveActiveSteps(SEQ[code]);
      const want = LESSONS[code];
      expect(steps).toHaveLength(want.steps);
      const count = (base: string) =>
        steps.filter((s) => (s.baseId ?? s.id).split('#')[0] === base).length;
      expect(count('full-text-annotate')).toBe(want.full);
      expect(count('key-passage-reading')).toBe(want.key);
      // ⛔ 每一步的 id 互不相同 —— 收斂成一步的話畫面只會出現一個入口
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    },
  );

  it('每一步都帶得出自己屬於哪一篇（roundSlug）', () => {
    const steps = resolveActiveSteps(SEQ['G6-L22']);
    const withRound = steps.filter((s) => s.roundSlug);
    expect(withRound).toHaveLength(19);
    expect(new Set(withRound.map((s) => s.roundSlug)).size).toBe(19);
  });
});

describe('後台：一篇一列，每篇自己的碼', () => {
  it('G6-L22 三篇 → 三列六碼，互不相同', () => {
    const rows = buildQrManifestRows([{
      id: 20063, title: '物以稀為貴', grade: 6, grade_code: 'G6-L22', lesson_number: 22,
      char_count: 100, has_key_reading: true,
      part_rounds: [
        { slug: 'p3kud', part: 1, has_full: true, has_key: true, full_slug: 'p3kud', key_slug: 'yprak' },
        { slug: '4uee3', part: 2, has_full: true, has_key: true, full_slug: '4uee3', key_slug: '9a7x4' },
        { slug: '7wavn', part: 3, has_full: true, has_key: true, full_slug: '7wavn', key_slug: 'ajy9w' },
      ],
    }] as never, 'https://x');
    expect(rows).toHaveLength(3);
    const codes = rows.flatMap((r) => [r.full_url, r.passage_url]).filter(Boolean);
    expect(codes).toHaveLength(6);
    expect(new Set(codes).size).toBe(6);
    // 每一列的兩個碼要屬於同一篇
    expect(rows[1].full_url).toBe('https://x/q/4uee3');
    expect(rows[1].passage_url).toBe('https://x/q/9a7x4');
    // ⛔ 篇 1 的碼不可以外洩到別列 —— 那正是 2026-08-25 staging 上的樣子
    expect(rows[1].full_url).not.toContain('p3kud');
    expect(rows[2].full_url).not.toContain('p3kud');
  });
});
