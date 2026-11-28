/**
 * #4161 AI 派發：從推薦清單挑 2 課、「再派一組」換下一組
 */
import { describe, it, expect } from 'vitest';
import { pickPair, type DispatchRec } from '../pickPair';

const rec = (n: number): DispatchRec => ({
  story_slug: `S${n}`, title: `課${n}`, grade: 4, genre: '記敘文', difficulty_match_score: 100 - n, reason: `理由${n}`,
});
const recs = [1, 2, 3, 4, 5, 6].map(rec);

describe('pickPair', () => {
  it('第一次取分數最高的兩課（沿用推薦清單的順序）', () => {
    expect(pickPair(recs, []).map((r) => r.story_slug)).toEqual(['S1', 'S2']);
  });
  it('再派一組：排除已顯示過的，給下兩課', () => {
    expect(pickPair(recs, ['S1', 'S2']).map((r) => r.story_slug)).toEqual(['S3', 'S4']);
    expect(pickPair(recs, ['S1', 'S2', 'S3', 'S4']).map((r) => r.story_slug)).toEqual(['S5', 'S6']);
  });
  it('排除剛做完的這一課', () => {
    expect(pickPair(recs, [], 'S1').map((r) => r.story_slug)).toEqual(['S2', 'S3']);
  });
  it('剩不到兩課：回剩下的；全排除光回空陣列', () => {
    expect(pickPair(recs, ['S1', 'S2', 'S3', 'S4', 'S5']).map((r) => r.story_slug)).toEqual(['S6']);
    expect(pickPair(recs, recs.map((r) => r.story_slug))).toEqual([]);
  });
  it('每張卡都有一句推薦理由（沒有理由時補預設句）', () => {
    const noReason = { ...rec(1), reason: '' };
    expect(pickPair([noReason], [])[0].reason.length).toBeGreaterThan(0);
  });
});
