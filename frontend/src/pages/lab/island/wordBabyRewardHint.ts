/**
 * 過關回島的「這站掉了碎片／遇到寶貝」小提示文案（#3780 接島上）。
 *
 * 優先序：遇到新寶貝（caught）比碎片更值得慶祝，一行只顯示一件事——
 * team-lead 原話「顯示一行小提示」，不堆疊多條訊息。重複遭遇（duplicate）
 * 後端會折算成額外碎片（見 word_baby_service.py 的 TestEncounterCatch），
 * 同一筆 log 的 fragment_awarded 仍會是 true，所以走碎片文案即可，不需要
 * 額外跟孩子解釋「重複」這個機制。
 */
import { getCatalogEntry } from '../wordBabies/wordBabyDomain';
import type { WordBabyRewardMessagePayload } from './storyMode';

export function wordBabyRewardHintText(reward: WordBabyRewardMessagePayload): string | null {
  if (reward.encounter_result === 'caught') {
    const baby = reward.encounter_baby_id ? getCatalogEntry(reward.encounter_baby_id) : undefined;
    return baby ? `你遇到了新朋友：${baby.name}！` : '你遇到了新朋友！';
  }
  if (reward.fragment_awarded && reward.fragment_flavor) {
    return `你拾獲了一片「${reward.fragment_flavor}」碎片！`;
  }
  return null;
}

export function firstWordBabyRewardHint(rewards: WordBabyRewardMessagePayload[]): string | null {
  for (const reward of rewards) {
    const hint = wordBabyRewardHintText(reward);
    if (hint) return hint;
  }
  return null;
}
