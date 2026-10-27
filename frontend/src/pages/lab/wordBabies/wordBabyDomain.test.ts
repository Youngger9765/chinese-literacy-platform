import { describe, it, expect } from 'vitest';
import {
  getCatalogEntry,
  computeFeedability,
  weakenStateLabel,
  dormantTypeLabel,
  stageName,
  dietFlavorsList,
  feedShortfallLines,
  weakenStateRecoveryHint,
  babyIcon,
} from './wordBabyDomain';
import type { WordBabySummary } from '../../../services/wordBabyApi';

function makeBaby(overrides: Partial<WordBabySummary> = {}): WordBabySummary {
  return {
    baby_id: 'wb-071',
    name: '伴手禮',
    rarity: 'uncommon',
    stage_index: 1,
    stage_count: 3,
    fully_grown: false,
    dormant_type: null,
    weaken_state: 'healthy',
    fed_current_stage: 0,
    hatch_days_remaining: null,
    fed_by_flavor: null,
    ...overrides,
  };
}

describe('getCatalogEntry', () => {
  it('finds a real baby by id from the static catalog', () => {
    const entry = getCatalogEntry('wb-071');
    expect(entry).toBeDefined();
    expect(entry?.name).toBe('伴手禮');
    expect(entry?.rarity).toBe('uncommon');
  });

  it('returns undefined for an id not in the catalog', () => {
    expect(getCatalogEntry('wb-does-not-exist')).toBeUndefined();
  });
});

describe('computeFeedability', () => {
  it('can feed when wallet has a matching diet flavor and the stage is not finished', () => {
    const entry = getCatalogEntry('wb-071')!; // uncommon, stage1 cost 3, diet includes 朗讀表達
    const baby = makeBaby({ fed_current_stage: 1 });
    const result = computeFeedability(baby, entry, { 朗讀表達: 2 });
    expect(result.canFeed).toBe(true);
    expect(result.fragmentsStillNeeded).toBe(2); // 3 - 1
  });

  it('cannot feed when the wallet has none of this baby\'s diet flavors', () => {
    const entry = getCatalogEntry('wb-071')!;
    const baby = makeBaby({ fed_current_stage: 1 });
    const result = computeFeedability(baby, entry, { 文言文: 5 }); // not in wb-071's diet
    expect(result.canFeed).toBe(false);
    expect(result.fragmentsStillNeeded).toBe(2);
  });

  it('cannot feed a dormant (egg/cocoon/hibernation) baby even with fragments available', () => {
    const entry = getCatalogEntry('wb-071')!;
    const baby = makeBaby({ dormant_type: '蛋', fed_current_stage: 0 });
    const result = computeFeedability(baby, entry, { 朗讀表達: 10 });
    expect(result.canFeed).toBe(false);
  });

  it('cannot feed a fully-grown baby', () => {
    const entry = getCatalogEntry('wb-071')!;
    const baby = makeBaby({ fully_grown: true, stage_index: 3, fed_current_stage: 2 });
    const result = computeFeedability(baby, entry, { 朗讀表達: 10 });
    expect(result.canFeed).toBe(false);
    expect(result.fragmentsStillNeeded).toBe(0);
  });

  it('treats an empty wallet entry (flavor never seen) the same as zero', () => {
    const entry = getCatalogEntry('wb-071')!;
    const baby = makeBaby({ fed_current_stage: 1 });
    const result = computeFeedability(baby, entry, {});
    expect(result.canFeed).toBe(false);
  });
});

describe('computeFeedability — structured feeding (epic/legendary, review finding 2026-10-27 round 3)', () => {
  // wb-041: legendary, stage1 requires fragments_by_flavor = {文言文: 1, 語文基礎: 1}
  // (fragments_to_finish_stage: 2, a shared-pool-style total that is NOT
  // sufficient on its own to know which specific flavor still needs fragments).

  it('does NOT enable feeding when the only flavor in the wallet is already capped for this stage', () => {
    // team-lead's exact repro: 語文基礎 already fed its full quota (1/1),
    // only 文言文 (0/1) is still outstanding, but the wallet only has 語文基礎.
    // The old shared-pool-only logic summed the wallet across ALL diet
    // flavors (10 + 0 > 0) and wrongly enabled the button.
    const entry = getCatalogEntry('wb-041')!;
    expect(entry.rarity).toBe('legendary');
    const baby = makeBaby({
      baby_id: 'wb-041', stage_index: 1, fed_current_stage: 1,
      fed_by_flavor: { 語文基礎: 1 },
    });
    const result = computeFeedability(baby, entry, { 語文基礎: 10, 文言文: 0 });
    expect(result.canFeed).toBe(false);
    expect(result.fragmentsStillNeeded).toBe(1); // 2 - 1
    expect(result.outstandingFlavors).toEqual(['文言文']);
  });

  it('DOES enable feeding when the wallet has stock for the one outstanding flavor', () => {
    const entry = getCatalogEntry('wb-041')!;
    const baby = makeBaby({
      baby_id: 'wb-041', stage_index: 1, fed_current_stage: 1,
      fed_by_flavor: { 語文基礎: 1 },
    });
    const result = computeFeedability(baby, entry, { 語文基礎: 10, 文言文: 1 });
    expect(result.canFeed).toBe(true);
    expect(result.fragmentsStillNeeded).toBe(1);
  });

  it('enables feeding when neither flavor is capped and only one has stock', () => {
    // positive control requested by review: "兩種都沒滿、只有一種有貨＝可以餵"
    const entry = getCatalogEntry('wb-041')!;
    const baby = makeBaby({
      baby_id: 'wb-041', stage_index: 1, fed_current_stage: 0,
      fed_by_flavor: null,
    });
    const result = computeFeedability(baby, entry, { 文言文: 3 });
    expect(result.canFeed).toBe(true);
    expect(result.outstandingFlavors.sort()).toEqual(['文言文', '語文基礎']);
  });
});

describe('weakenStateLabel — no death language, uses the hiding metaphor', () => {
  it('healthy', () => {
    expect(weakenStateLabel('healthy')).not.toMatch(/死|掛|消失/);
  });

  it('weak uses "躲起來了" per team-lead wording', () => {
    expect(weakenStateLabel('weak')).toContain('躲起來');
    expect(weakenStateLabel('weak')).not.toMatch(/死|掛|消失/);
  });

  it('deep_sleep also avoids death language', () => {
    expect(weakenStateLabel('deep_sleep')).not.toMatch(/死|掛|消失/);
  });
});

describe('dormantTypeLabel', () => {
  it('maps each dormancy type to a friendly phrase, no death language', () => {
    for (const type of ['蛋', '繭', '冬眠']) {
      const label = dormantTypeLabel(type);
      expect(label).not.toMatch(/死|掛|消失/);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('stageName', () => {
  it('resolves the current stage name from the catalog', () => {
    const entry = getCatalogEntry('wb-071')!;
    expect(stageName(entry, 1)).toBe(entry.stages[0].stage_name);
  });
});

describe('dietFlavorsList — team-lead feedback 2026-10-27 round 2: small tags, not a joined sentence', () => {
  it('returns each diet flavor as a separate item (for rendering as its own tag)', () => {
    const entry = getCatalogEntry('wb-071')!; // diet: 朗讀表達, 書寫紀錄
    const list = dietFlavorsList(entry);
    expect(list).toEqual(['朗讀表達', '書寫紀錄']);
  });
});

describe('feedShortfallLines — team-lead feedback 2026-10-27 round 2: two short lines, no flavor repeat', () => {
  it('splits into a count line and an action line, both short (grade-4 reading level)', () => {
    // diet: 朗讀表達, 書寫紀錄 — shared pool, both still outstanding
    const { countLine, actionLine } = feedShortfallLines(1, ['朗讀表達', '書寫紀錄']);
    expect(countLine).toContain('1');
    expect(countLine).toContain('片');
    expect(actionLine).toMatch(/讀課文|朗讀|寫筆記/); // some action hint
    // the flavor name must NOT be repeated here — it's already visible via
    // the 愛吃 tags and the highlighted wallet cells (team-lead: "不必再列一次")
    expect(countLine).not.toContain('朗讀表達');
    expect(actionLine).not.toContain('朗讀表達');
  });

  it('round 3: for structured feeding, the action hint follows the OUTSTANDING flavor only', () => {
    // wb-041 scenario: 語文基礎 already capped, only 文言文 is outstanding —
    // the action hint must point at 文言文's hint (讀文言文課文), not 語文基礎's.
    const { actionLine } = feedShortfallLines(1, ['文言文']);
    expect(actionLine).toMatch(/文言文/);
    expect(actionLine).not.toMatch(/生字|語詞/); // that's 語文基礎's hint, must not appear
  });
});

describe('weakenStateRecoveryHint — team-lead feedback 2026-10-27 #3: say what to do about it', () => {
  it('healthy needs no recovery hint', () => {
    expect(weakenStateRecoveryHint('healthy')).toBeNull();
  });

  it('weak explains how to bring it back, accurately (feeding OR any lesson resets the clock)', () => {
    const hint = weakenStateRecoveryHint('weak');
    expect(hint).not.toBeNull();
    expect(hint).not.toMatch(/死|掛|消失/);
    // design.md §8: completing ANY lesson resets ALL pets' clocks, feeding
    // resets just this one — the hint must not claim feeding is the only way
    expect(hint).toMatch(/讀.*課|課文/);
  });

  it('deep_sleep also explains how to bring it back', () => {
    const hint = weakenStateRecoveryHint('deep_sleep');
    expect(hint).not.toBeNull();
    expect(hint).not.toMatch(/死|掛|消失/);
  });
});

describe('babyIcon — team-lead feedback 2026-10-27 #4: a large icon on the card itself', () => {
  function makeBaby(overrides: Partial<WordBabySummary> = {}): WordBabySummary {
    return {
      baby_id: 'wb-071', name: '伴手禮', rarity: 'uncommon', stage_index: 1, stage_count: 3,
      fully_grown: false, dormant_type: null, weaken_state: 'healthy', fed_current_stage: 0,
      hatch_days_remaining: null, ...overrides,
    };
  }

  it('gives a distinct icon per dormant type', () => {
    const egg = babyIcon(makeBaby({ dormant_type: '蛋' }));
    const cocoon = babyIcon(makeBaby({ dormant_type: '繭' }));
    const hibernate = babyIcon(makeBaby({ dormant_type: '冬眠' }));
    expect(new Set([egg, cocoon, hibernate]).size).toBe(3); // all different
  });

  it('gives a distinct icon for weak/deep_sleep vs healthy active growth', () => {
    expect(babyIcon(makeBaby({ weaken_state: 'healthy' }))).not.toBe(
      babyIcon(makeBaby({ weaken_state: 'weak' })),
    );
  });

  it('gives a distinct icon for fully grown', () => {
    expect(babyIcon(makeBaby({ fully_grown: true }))).not.toBe(babyIcon(makeBaby({})));
  });
});
