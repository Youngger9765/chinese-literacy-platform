import { describe, it, expect } from 'vitest';
import { lessonSkillsFor } from './readingBabyLessonSkills';

/**
 * 寶貝卡要顯示「這一課的主要能力（課綱代碼放小字）」與「技能列表」
 * （PRD 2026-10-31-reading-babies-prd.md §4 寶貝卡）。後端
 * `/reading-babies/{lesson_uid}` 目前只回傳聚合後的
 * assessable_total/assessable_passed，沒有逐技能清單或主要指標代碼——
 * 這份靜態資料從 docs/design/reading-babies/lesson-indicators.json 抽出
 * 來補這個缺口（見檔頭 `_meta.note`，後端欄位待補）。
 */
describe('lessonSkillsFor', () => {
  it('returns the primary indicator and skill list for a known lesson', () => {
    const data = lessonSkillsFor('L0001');
    expect(data).not.toBeNull();
    expect(data?.primaryIndicatorCode).toBe('5-Ⅱ-5');
    expect(data?.skills.length).toBeGreaterThan(0);
    expect(data?.skills[0]).toMatchObject({ skill: expect.any(String), indicator: expect.any(String), station: expect.any(String) });
  });

  it('returns null for a lesson_uid not in the 179-lesson mapping', () => {
    expect(lessonSkillsFor('NOPE')).toBeNull();
  });
});
