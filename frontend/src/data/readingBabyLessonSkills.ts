/**
 * readingBabyLessonSkills.ts — 寶貝卡的靜態課綱 metadata（#3780 reading-babies
 * phase 2，PRD §4「寶貝卡」：主要能力 + 課綱代碼 + 技能清單）。
 *
 * ⚠️ 後端欄位待補：`/reading-babies/{lesson_uid}` 目前只回傳聚合後的
 * assessable_total/assessable_passed（schemas/reading_baby.py
 * `LessonGrowthResponse`），沒有主要指標代碼或逐技能清單。這份檔案是前端
 * 這一側暫時從 `docs/design/reading-babies/lesson-indicators.json` 抽出的
 * 靜態資料，不隨學生進度變動——若未來 API 直接回傳這些欄位，這個檔案可以
 * 整個刪除。
 */
import raw from './readingBabyLessonSkills.json';

export interface LessonSkill {
  skill: string | null;
  indicator: string | null;
  station: string | null;
}

export interface LessonSkillsData {
  primaryIndicatorCode: string | null;
  primaryIndicatorText: string | null;
  skills: LessonSkill[];
}

interface RawLessonSkillsFile {
  lessons: Record<string, {
    primary_indicator_code: string | null;
    primary_indicator_text: string | null;
    skills: Array<{ skill: string | null; indicator: string | null; station: string | null }>;
  }>;
}

const DATA = raw as unknown as RawLessonSkillsFile;

export function lessonSkillsFor(lessonUid: string): LessonSkillsData | null {
  const entry = DATA.lessons[lessonUid];
  if (!entry) return null;
  return {
    primaryIndicatorCode: entry.primary_indicator_code,
    primaryIndicatorText: entry.primary_indicator_text,
    skills: entry.skills.map((s) => ({ skill: s.skill, indicator: s.indicator, station: s.station })),
  };
}
