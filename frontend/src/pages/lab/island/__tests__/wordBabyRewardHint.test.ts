/**
 * 過關回島的「這站掉了碎片／遇到寶貝」小提示文案（#3780 接島上）。
 *
 * 優先序：遇到新寶貝（caught）比碎片更值得慶祝，一行只顯示一件事——
 * team-lead 原話「顯示一行小提示」，不堆疊多條訊息。重複遭遇（duplicate）
 * 後端會折算成額外碎片（見 word_baby_service.py 的 TestEncounterCatch），
 * 同一筆 log 的 fragment_awarded 仍會是 true，所以走碎片文案即可，不需要
 * 額外跟孩子解釋「重複」這個機制。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../wordBabies/wordBabyDomain', () => ({
  getCatalogEntry: (id: string) => {
    if (id === 'wb-003') return { id: 'wb-003', name: '咕嚕龍' };
    return undefined;
  },
}));

import { wordBabyRewardHintText, firstWordBabyRewardHint } from '../wordBabyRewardHint';
import type { WordBabyRewardMessagePayload } from '../storyMode';

const noneReward: WordBabyRewardMessagePayload = {
  id: 11, station: 'x', fragment_awarded: false, fragment_flavor: null, encounter_result: 'none', encounter_baby_id: null,
};

describe('wordBabyRewardHintText', () => {
  it('caught a new baby → names it, takes priority over a fragment drop', () => {
    const r: WordBabyRewardMessagePayload = {
      id: 12, station: 'x', fragment_awarded: true, fragment_flavor: '語文基礎', encounter_result: 'caught', encounter_baby_id: 'wb-003',
    };
    expect(wordBabyRewardHintText(r)).toBe('你遇到了新朋友：咕嚕龍！');
  });

  it('fragment dropped, no encounter → names the flavor', () => {
    const r: WordBabyRewardMessagePayload = {
      id: 13, station: 'x', fragment_awarded: true, fragment_flavor: '朗讀表達', encounter_result: 'none', encounter_baby_id: null,
    };
    expect(wordBabyRewardHintText(r)).toBe('你拾獲了一片「朗讀表達」碎片！');
  });

  it('nothing awarded → null, no hint to show', () => {
    expect(wordBabyRewardHintText(noneReward)).toBeNull();
  });

  it('caught but the catalog entry is somehow missing → falls back to a generic name, does not crash', () => {
    const r: WordBabyRewardMessagePayload = {
      id: 14, station: 'x', fragment_awarded: false, fragment_flavor: null, encounter_result: 'caught', encounter_baby_id: 'wb-999-unknown',
    };
    expect(wordBabyRewardHintText(r)).toBe('你遇到了新朋友！');
  });
});

describe('firstWordBabyRewardHint', () => {
  it('returns the first station with something worth announcing', () => {
    const rewards = [noneReward, { id: 5, station: 'y', fragment_awarded: true, fragment_flavor: '書寫紀錄', encounter_result: 'none' as const, encounter_baby_id: null }];
    expect(firstWordBabyRewardHint(rewards)).toBe('你拾獲了一片「書寫紀錄」碎片！');
  });

  it('empty list → null', () => {
    expect(firstWordBabyRewardHint([])).toBeNull();
  });

  it('all-nothing list → null', () => {
    expect(firstWordBabyRewardHint([noneReward, noneReward])).toBeNull();
  });
});
