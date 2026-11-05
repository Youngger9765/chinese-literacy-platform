/**
 * readingBabyStoryIds.ts — lesson_uid → 單課島 storyId 對照（#3780
 * reading-babies phase 2「一鍵直達」）。
 *
 * 見 readingBabyStoryIds.json 的 `_meta.note`：後端沒有端點能用
 * `lesson_uid` 反查 `storyId`，這份靜態對照從設計文件抽出，已用真實 API
 * 抽測兩筆驗證（L0001→20001、L0050→20050）。
 */
import raw from './readingBabyStoryIds.json';

interface RawStoryIdFile {
  story_id_by_lesson_uid: Record<string, string>;
}

const DATA = raw as unknown as RawStoryIdFile;

export function storyIdForLesson(lessonUid: string): string | null {
  return DATA.story_id_by_lesson_uid[lessonUid] ?? null;
}

/** 反向查詢（storyId → lesson_uid）——建成一次性快取，不是每次呼叫都重新
 *  掃整個 179 筆對照表。ReadingIslandLab 只知道路由上的 storyId，要查
 *  `fetchReadingBabyCard` 得先換成 lesson_uid（見 game-design.md §3.3 進化
 *  分級回饋）。 */
let reverseCache: Record<string, string> | null = null;

export function lessonUidForStoryId(storyId: string): string | null {
  if (!reverseCache) {
    reverseCache = {};
    for (const [lessonUid, sid] of Object.entries(DATA.story_id_by_lesson_uid)) {
      reverseCache[sid] = lessonUid;
    }
  }
  return reverseCache[storyId] ?? null;
}
