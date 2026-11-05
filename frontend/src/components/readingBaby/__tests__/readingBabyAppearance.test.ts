/**
 * #3780 第三階段：寶貝造型公式（game-design.md §1.3）
 * 劇情類型 × 年級色系 × 招牌小物，不手畫 179 張。
 */
import { describe, expect, it } from 'vitest';
import inputs from '../../../data/readingBabyAppearanceInputs.json';
import { storyTypeForLesson } from '../../../pages/lab/island/islandTemplate';
import { appearanceFor, appearanceSignature, GRADE_GROUPS } from '../readingBabyAppearance';

const ALL_UIDS = Object.keys((inputs as { lessons: Record<string, unknown> }).lessons).sort();

describe('appearanceFor', () => {
  it('covers all 179 lessons', () => {
    expect(ALL_UIDS).toHaveLength(179);
    const missing = ALL_UIDS.filter((uid) => appearanceFor(uid) === null);
    expect(missing).toEqual([]);
  });

  it('uses the island story-type rule, not a second copy of it', () => {
    const raw = (inputs as { lessons: Record<string, { grade: string; category: string; genre: string }> }).lessons;
    const wrong = ALL_UIDS.filter((uid) => {
      const r = raw[uid];
      return appearanceFor(uid)!.storyType !== storyTypeForLesson(r.grade, r.category, r.genre);
    });
    expect(wrong).toEqual([]);
  });

  it('L0001 is a grade-4 baby whose accessory comes from its professor family (F08)', () => {
    const a = appearanceFor('L0001')!;
    expect(a.gradeGroup).toBe('4');
    expect(a.family).toBe('F08');
    expect(a.accessory.family).toBe('F08');
  });

  it('is deterministic (same lesson -> same look every call)', () => {
    for (const uid of ALL_UIDS) {
      expect(appearanceSignature(appearanceFor(uid)!)).toBe(appearanceSignature(appearanceFor(uid)!));
    }
  });

  it('no two of the 179 babies look exactly the same', () => {
    const sigs = ALL_UIDS.map((uid) => appearanceSignature(appearanceFor(uid)!));
    expect(new Set(sigs).size).toBe(179);
  });

  it('every grade group has its own palette', () => {
    const groups = new Set(ALL_UIDS.map((uid) => appearanceFor(uid)!.gradeGroup));
    for (const g of groups) expect(GRADE_GROUPS[g]).toBeTruthy();
    const bodies = new Set(Object.values(GRADE_GROUPS).map((p) => p.body));
    expect(bodies.size).toBe(Object.keys(GRADE_GROUPS).length);
  });

  it('returns null for a lesson outside the 179', () => {
    expect(appearanceFor('NOPE')).toBeNull();
  });
});
