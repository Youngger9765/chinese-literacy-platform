/**
 * 過關回島的「寶貝長大了」小提示文案（#3780 reading-babies phase 2，取代
 * v1 的 wordBabyRewardHint.ts）。
 *
 * game-design.md §3.3：單次 `quality_passed` 成長點數入帳屬於「小」分級回饋
 * （1 個通道：這裡只管文案，動畫/音效由渲染端負責）。一行只顯示一件事，
 * 跟 v1「遇到新寶貝 > 碎片」的優先序精神一致——但閱讀寶貝沒有「遇見」跟
 * 「碎片」兩種事件（遇見是進站自動發生、不是一個會送出 event 的動作），
 * 所以這裡只有一種文案，不需要優先序表。
 *
 * 不用「升級／領取／加分」這類字眼（G6 兒童適切文案：不用成人比喻；
 * game-design.md §0.1「不希望學生花時間在點數升級跟點擊」——文案也不該
 * 暗示這是一個操作型的里程碑）。
 */
import type { ReadingBabyGrowthMessagePayload } from './storyMode';

export function readingBabyGrowthHintText(event: ReadingBabyGrowthMessagePayload): string | null {
  if (!event.quality_passed) return null;
  return '寶貝長大了一點！';
}

export function firstReadingBabyGrowthHint(events: ReadingBabyGrowthMessagePayload[]): string | null {
  for (const event of events) {
    const hint = readingBabyGrowthHintText(event);
    if (hint) return hint;
  }
  return null;
}

/**
 * game-design.md §3.3「進化當下的回饋強度」：進化到中階＝中分級回饋，
 * 進階（全部通過）＝大分級回饋——比單次成長的「小」更強。呼叫端
 * （ReadingIslandLab）比對這次讀到的 stage 跟上次看到的 stage，真的
 * 「跨過門檻」才叫這支蓋掉小提示，不是每次 quality_passed 都講這句。
 */
export type ReadingBabyStage = 'not_encountered' | 'basic' | 'intermediate' | 'advanced';

export function stageEvolutionHintText(stage: ReadingBabyStage): string | null {
  if (stage === 'intermediate') return '寶貝長大成中階囉！';
  if (stage === 'advanced') return '太棒了！這一課你都學會了，寶貝變成最厲害的型態！';
  return null;
}
