/**
 * #3799 批次 2（design.md §6.2／§7 批次 2 驗收）：劇情指派規則要在全平台
 * 179 課的真實資料上驗證，不是只測幾個手選案例——跟 `spawnPoint
 * .allLessons.test.ts` 同一個精神（那支鎖碰撞/構圖幾何，這支鎖劇情指派）。
 *
 * 這支測試鎖三件事（team-lead 2026-10-30 明確列出的驗收）：
 * ① 179 課全部有劇情（沒有漏配、沒有任何一課拿到未定義的類型）
 * ② 五種劇情的分布數字跟 design.md §6.2 的表格完全一致（修復 15／
 *    尋寶 17／偵探 71／魔王 56／比賽 20，加總 179）
 * ③ 每課的推進文字數量恰好等於該課的站數（`buildStoryProgressionLines`
 *    的輸出長度 === `buildStopsFromSequence(step_sequence)` 的輸出長度）
 *
 * 資料來源是兩份既有的真實 179 課 fixture 接起來（各自的 `_meta` 記著
 * 擷取來源與時間）：
 * - `grade`/`category`/`genre`（劇情指派規則要用的欄位）來自群島模組
 *   既有的 `all-stories.json`（2026-10-30 擷取，跟本輪在真實 preview
 *   上驗證 §6.2 分布數字時用的是同一份資料）
 * - `step_sequence`（站數要用的欄位）來自既有的
 *   `all-lessons-step-sequence.json`（2026-10-26 擷取，`spawnPoint
 *   .allLessons.test.ts` 也用它）
 * 兩份擷取時間不同，用課號（`id`）join 之前先驗證兩邊的課號集合完全
 * 一致——集合對不起來代表兩份資料的課程版本已經漂移，不能直接 join，
 * 這條檢查本身就是個回歸鎖（不是只信「兩邊都是 179 筆」這種巧合）。
 */
import { describe, expect, it } from 'vitest';
import { buildStopsFromSequence, buildStoryProgressionLines, storyTypeForLesson, type StoryType } from '../islandTemplate';
import storiesFixture from '../../../student/archipelago/core/__tests__/fixtures/all-stories.json';
import stepSequenceFixture from './fixtures/all-lessons-step-sequence.json';

interface StoryFixtureEntry {
  id: string;
  title: string;
  grade: string;
  genre: string;
  category: string;
  lessonSeq: number;
}

interface StepSequenceFixtureEntry {
  id: number;
  title: string;
  step_sequence: string[];
}

const storyRows = storiesFixture.stories as StoryFixtureEntry[];
const stepRows = stepSequenceFixture.lessons as StepSequenceFixtureEntry[];

describe('前置檢查：兩份擷取時間不同的 fixture，課號集合要完全一致才能 join', () => {
  it('兩邊都是 179 筆，而且課號集合完全相同（不是巧合都是 179 但課不一樣）', () => {
    expect(storyRows).toHaveLength(179);
    expect(stepRows).toHaveLength(179);
    const storyIds = new Set(storyRows.map((s) => Number(s.id)));
    const stepIds = new Set(stepRows.map((s) => s.id));
    expect(storyIds.size).toBe(179);
    expect(stepIds.size).toBe(179);
    const onlyInStory = [...storyIds].filter((id) => !stepIds.has(id));
    const onlyInStep = [...stepIds].filter((id) => !storyIds.has(id));
    expect(onlyInStory, '只出現在 all-stories.json、不在 step-sequence fixture 裡的課號').toEqual([]);
    expect(onlyInStep, '只出現在 step-sequence fixture、不在 all-stories.json 裡的課號').toEqual([]);
  });
});

const stepSequenceById = new Map(stepRows.map((row) => [row.id, row.step_sequence]));

interface JoinedLesson {
  id: number;
  title: string;
  grade: string;
  category: string;
  genre: string;
  stepSequence: string[];
}

const joined: JoinedLesson[] = storyRows.map((row) => {
  const id = Number(row.id);
  const stepSequence = stepSequenceById.get(id);
  if (!stepSequence) throw new Error(`join 失敗：課號 ${id} 在 step-sequence fixture 裡找不到（上面的前置檢查應該先抓到這個，不該走到這裡）`);
  return { id, title: row.title, grade: row.grade, category: row.category, genre: row.genre, stepSequence };
});

describe('① 179 課全部有劇情——沒有漏配、沒有未定義的類型', () => {
  it('每一課都得到五種類型之一，沒有 undefined/null', () => {
    const valid: ReadonlySet<StoryType> = new Set(['repair', 'boss', 'treasure', 'detective', 'competition']);
    for (const lesson of joined) {
      const storyType = storyTypeForLesson(lesson.grade, lesson.category, lesson.genre);
      expect(valid.has(storyType), `課號 ${lesson.id}（${lesson.title}）拿到不合法的劇情類型：${storyType}`).toBe(true);
    }
  });

  it('決定性：同一課重算兩次，劇情類型不會變', () => {
    for (const lesson of joined) {
      const once = storyTypeForLesson(lesson.grade, lesson.category, lesson.genre);
      const twice = storyTypeForLesson(lesson.grade, lesson.category, lesson.genre);
      expect(twice).toBe(once);
    }
  });
});

describe('② 五種劇情的分布數字跟 design.md §6.2 完全一致', () => {
  it('修復 15／尋寶 17／偵探 71／魔王 56／比賽 20，加總 179', () => {
    const counts: Record<StoryType, number> = { repair: 0, boss: 0, treasure: 0, detective: 0, competition: 0 };
    for (const lesson of joined) {
      counts[storyTypeForLesson(lesson.grade, lesson.category, lesson.genre)] += 1;
    }
    expect(counts).toEqual({ repair: 15, treasure: 17, detective: 71, boss: 56, competition: 20 });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(179);
  });
});

describe('③ 每課的推進文字數量恰好等於該課的站數', () => {
  it('全部 179 課逐一驗證——不是抽幾課，是真的每一課都跑過', () => {
    for (const lesson of joined) {
      const storyType = storyTypeForLesson(lesson.grade, lesson.category, lesson.genre);
      const stops = buildStopsFromSequence(lesson.stepSequence);
      const progression = buildStoryProgressionLines(storyType, stops);
      expect(
        progression.length,
        `課號 ${lesson.id}（${lesson.title}）：${stops.length} 站卻產生 ${progression.length} 句推進旁白`,
      ).toBe(stops.length);
    }
  });

  it('站數分布本身不是全部一樣——這條驗證確保上面那條真的測到長度會變化的情況，不是剛好每課都 N 站湊巧全過', () => {
    const stationCounts = new Set(joined.map((lesson) => buildStopsFromSequence(lesson.stepSequence).length));
    expect(stationCounts.size).toBeGreaterThan(1);
  });
});
