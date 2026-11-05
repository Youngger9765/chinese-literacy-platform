import { describe, it, expect } from 'vitest';
import { storyIdForLesson, lessonUidForStoryId } from './readingBabyStoryIds';

/**
 * 寶貝卡「一鍵直達」要導到該課的單課島頁 `/lab/island/{storyId}`，但
 * `/reading-babies` 系列 API 只回傳 `lesson_uid`（如 "L0001"），而
 * `/lab/island/:storyId` 路由吃的是後端內容樹的數字 storyId（如
 * "20001"）——後端沒有一支端點能反查這個對照，見
 * readingBabyStoryIds.ts 檔頭說明。這份靜態資料從設計文件抽出，並已用
 * 真實 API 抽測驗證過。
 */
describe('storyIdForLesson', () => {
  it('returns the storyId for a known lesson_uid', () => {
    expect(storyIdForLesson('L0001')).toBe('20001');
  });

  it('returns null for a lesson_uid not in the 179-lesson mapping', () => {
    expect(storyIdForLesson('NOPE')).toBeNull();
  });
});

/**
 * ReadingIslandLab 只知道自己的 `storyId`（路由參數，如 "20001"），要在
 * 「成長提示」裡判斷有沒有進化到中階/進階時得先反查 lesson_uid 才能呼叫
 * `fetchReadingBabyCard`——這支是 `storyIdForLesson` 的反向查詢。
 */
describe('lessonUidForStoryId', () => {
  it('returns the lesson_uid for a known storyId', () => {
    expect(lessonUidForStoryId('20001')).toBe('L0001');
    expect(lessonUidForStoryId('20050')).toBe('L0050');
  });

  it('returns null for a storyId not in the 179-lesson mapping', () => {
    expect(lessonUidForStoryId('99999')).toBeNull();
  });
});
