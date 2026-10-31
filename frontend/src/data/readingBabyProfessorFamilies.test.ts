import { describe, it, expect } from 'vitest';
import {
  professorFamilyFor,
  PROFESSOR_FAMILY_ORDER,
  PROFESSOR_FAMILY_NAMES,
} from './readingBabyProfessorFamilies';

/**
 * 教授 12(實際 14+1)家族分組覆寫——PRD 2026-10-31 §3：「系列：依陳淑麗教授
 * 課程地圖的 12 家族（取代 AI 分的 11 家族）」。資料來源是
 * docs/design/reading-babies/lesson-indicators.json 的 professor_node 欄位，
 * 後端目前的 API 回應仍只有舊的 11 個 ability_family（A-K），所以前端要自己
 * 查這份靜態對照表決定分組，不能直接用後端回傳的 ability_family。
 */
describe('professorFamilyFor', () => {
  it('returns the professor family for a known lesson', () => {
    const fam = professorFamilyFor('L0001');
    expect(fam).not.toBeNull();
    expect(fam?.family).toBe('F08');
    expect(fam?.familyName).toBe('寫作手法');
  });

  it('falls back to the AI00 bucket for lessons without a professor node', () => {
    // L0095 (G7-L26) and L0106 (G7-L9) have an empty professor_node array in
    // the source JSON — ability-indicators.md §8 calls these out explicitly.
    const fam = professorFamilyFor('L0095');
    expect(fam?.family).toBe('AI00');
  });

  it('returns null for a lesson_uid not in the 179-lesson mapping', () => {
    expect(professorFamilyFor('NOPE')).toBeNull();
  });

  it('exposes a stable display order covering every family actually used', () => {
    expect(PROFESSOR_FAMILY_ORDER.length).toBeGreaterThanOrEqual(14);
    expect(PROFESSOR_FAMILY_ORDER).toContain('AI00');
    for (const code of PROFESSOR_FAMILY_ORDER) {
      expect(PROFESSOR_FAMILY_NAMES[code]).toBeTruthy();
    }
  });
});
