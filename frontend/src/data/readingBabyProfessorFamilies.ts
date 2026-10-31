/**
 * readingBabyProfessorFamilies.ts — 教授課程地圖家族分組（#3780 reading-babies
 * phase 2，PRD 2026-10-31 §3「系列：依陳淑麗教授課程地圖的 12 家族（取代 AI
 * 分的 11 家族）」）。
 *
 * ⚠️ 已知落差（2026-10-31 建此檔時發現，寫進交付回報，不假裝沒看到）：
 * `docs/design/reading-babies/lesson-indicators.json` 的 `professor_node`
 * 欄位逐課取 `primary:true` 節點後，實際數出 **14** 個不同家族代碼
 * （F01-F14），另有 2 課（L0095/L0106）完全沒有 `professor_node`。PRD 寫
 * 的「12 家族」跟資料本身對不上——本檔忠實呈現資料裡的 15 組（14 個教授
 * 家族 + 1 個 AI00 兜底桶），不是硬湊成 12 組。
 *
 * #3780 第三階段起，後端 `lesson_indicators.json` 的 `ability_family` 已改成
 * 同一套教授家族（`backend/scripts/build_reading_baby_lesson_indicators.py`
 * `_professor_family`），API 直接回教授家族。這份檔案現在只負責「家族顯示
 * 順序」與「家族中文名」對照；179 課逐課前後端一致由
 * `backend/tests/test_reading_baby_professor_family.py` 鎖住。
 *
 * 產生方式：ad-hoc python 腳本讀
 * docs/design/reading-babies/lesson-indicators.json 的 professor_node，見
 * readingBabyProfessorFamilies.json 的 `_meta.generated_by`。
 */
import raw from './readingBabyProfessorFamilies.json';

interface RawFamilyFile {
  families: Record<string, string>;
  family_order: string[];
  lessons: Record<string, { family: string; family_name: string; source: string }>;
}

const DATA = raw as unknown as RawFamilyFile;

export interface ProfessorFamily {
  family: string;
  familyName: string;
  /** 'professor_node'（教授課程地圖直接給的）或 'ability_family_fallback'
   *  （沒有教授節點，暫時落入 AI00 桶）。 */
  source: 'professor_node' | 'ability_family_fallback';
}

/** 顯示順序（F01→F14，最後是 AI00 兜底桶）。 */
export const PROFESSOR_FAMILY_ORDER: string[] = DATA.family_order;

/** 家族代碼 -> 中文名稱。 */
export const PROFESSOR_FAMILY_NAMES: Record<string, string> = DATA.families;

/** 查某一課屬於哪個教授家族；不在 179 課對照裡回傳 null。 */
export function professorFamilyFor(lessonUid: string): ProfessorFamily | null {
  const entry = DATA.lessons[lessonUid];
  if (!entry) return null;
  return {
    family: entry.family,
    familyName: entry.family_name,
    source: entry.source as ProfessorFamily['source'],
  };
}
