import { describe, it, expect } from 'vitest';
import { readingBabyGrowthHintText, firstReadingBabyGrowthHint, stageEvolutionHintText } from '../readingBabyGrowthHint';
import type { ReadingBabyGrowthMessagePayload } from '../storyMode';

/**
 * 過關回島的「寶貝長大了」小提示文案（#3780 reading-babies phase 2，取代
 * v1 的 wordBabyRewardHint.ts）。game-design.md §4.1 子句「不希望學生花時間
 * 在點數升級跟點擊」——這裡只讀 quality_passed，不講分數、不講「升級」
 * 「領取」這類字眼（G6 兒童適切文案：不用成人比喻）。
 */
describe('readingBabyGrowthHintText', () => {
  it('quality_passed=true → 一句「寶貝長大了」的提示', () => {
    const event: ReadingBabyGrowthMessagePayload = { station: 'vocab-definition', ability_id: '4-Ⅱ-3', quality_passed: true };
    expect(readingBabyGrowthHintText(event)).toBe('寶貝長大了一點！');
  });

  it('quality_passed=false（沒做好，或 completion 型態只記參與）→ null，不顯示任何提示', () => {
    const event: ReadingBabyGrowthMessagePayload = { station: 'keypoints-table', ability_id: '5-Ⅱ-6', quality_passed: false };
    expect(readingBabyGrowthHintText(event)).toBeNull();
  });
});

describe('firstReadingBabyGrowthHint', () => {
  it('回傳第一個有文案的事件（跳過沒有文案的 false 事件）', () => {
    const events: ReadingBabyGrowthMessagePayload[] = [
      { station: 'lesson-intro', ability_id: '1-Ⅱ-2', quality_passed: false },
      { station: 'spotlight', ability_id: '5-Ⅱ-5', quality_passed: true },
    ];
    expect(firstReadingBabyGrowthHint(events)).toBe('寶貝長大了一點！');
  });

  it('全部都是 false 或空陣列 → null', () => {
    expect(firstReadingBabyGrowthHint([])).toBeNull();
    expect(firstReadingBabyGrowthHint([{ station: 'report', ability_id: 'x', quality_passed: false }])).toBeNull();
  });
});

/**
 * game-design.md §3.3「進化當下的回饋強度」：進化到中階＝中分級回饋，
 * 進化到進階（全部通過）＝大分級回饋，都比單次成長的「小」更強——這支是
 * 進化當下（stage 真的變了）才用的文案，跟 readingBabyGrowthHintText
 * （每次 quality_passed=true 都會講的小提示）分開，由呼叫端
 * （ReadingIslandLab）比對「這次 fetch 到的 stage」跟「上次看到的 stage」
 * 決定要不要蓋掉小提示、改講這句。
 */
describe('stageEvolutionHintText', () => {
  it('intermediate → 中階分級回饋文案', () => {
    expect(stageEvolutionHintText('intermediate')).toBe('寶貝長大成中階囉！');
  });

  it('advanced → 進階分級回饋文案（全部學會，最大聲的肯定）', () => {
    expect(stageEvolutionHintText('advanced')).toBe('太棒了！這一課你都學會了，寶貝變成最厲害的型態！');
  });

  it('basic/not_encountered → null（不是進化到中階或進階的事件，不蓋掉小提示）', () => {
    expect(stageEvolutionHintText('basic')).toBeNull();
    expect(stageEvolutionHintText('not_encountered')).toBeNull();
  });
});
