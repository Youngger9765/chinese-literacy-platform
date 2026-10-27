/**
 * wordBabyDomain.ts — pure, DOM-free logic for the word-baby /lab page
 * (#3780). Kept separate from WordBabiesLab.tsx so the kid-facing wording
 * and feedability rules can be unit-tested without rendering anything.
 *
 * Content data source: docs/design/word-babies/babies.json, copied verbatim
 * into ../../../data/wordBabiesCatalog.json (team-lead 2026-10-27: "美術先
 * 用既有 docs/design/word-babies 的資料", no new art this round).
 */
import catalogData from '../../../data/wordBabiesCatalog.json';
import type { WordBabySummary } from '../../../services/wordBabyApi';

export interface CatalogStage {
  stage_index: number;
  stage_name: string;
  fragments_to_finish_stage: number;
  is_final_stage: boolean;
  dormancy_after_this_stage: { type: string; hatch_days: number } | null;
  fragments_by_flavor?: Record<string, number>;
}

export interface CatalogBaby {
  id: string;
  name: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  rarity_zh: string;
  diet_flavors: string[];
  stage_count: number;
  stages: CatalogStage[];
}

const CATALOG: CatalogBaby[] = (catalogData as { babies: CatalogBaby[] }).babies;

/** All 5 flavor families (design.md §4) — the wallet card always shows all
 * 5 with a 0 default, even if the backend has never created a row for one
 * (an untouched flavor is simply absent from the API's `wallet` dict). */
export const FLAVOR_FAMILIES = ['語文基礎', '閱讀理解', '朗讀表達', '書寫紀錄', '文言文'] as const;

export function getCatalogEntry(babyId: string): CatalogBaby | undefined {
  return CATALOG.find((b) => b.id === babyId);
}

export function allCatalogEntries(): CatalogBaby[] {
  return CATALOG;
}

export function stageName(entry: CatalogBaby, stageIndex: number): string {
  return entry.stages[stageIndex - 1]?.stage_name ?? `第 ${stageIndex} 階段`;
}

export interface FeedabilityResult {
  /** Whether the feed button should be enabled right now. */
  canFeed: boolean;
  /** How many more fragments this stage needs in total (0 if already done). */
  fragmentsStillNeeded: number;
  /** Which diet flavors would actually make progress right now. For
   * shared-pool rarities (common/uncommon/rare) this is just every diet
   * flavor — any of them works. For structured feeding (epic/legendary,
   * `fragments_by_flavor`) this narrows to the flavors NOT yet capped off
   * for this stage — see the review finding below. */
  outstandingFlavors: string[];
}

/**
 * Whether a baby can be fed right now, and how many fragments its current
 * stage still needs — used to render the "還差 N 片" message and to
 * enable/disable the feed button (team-lead: "碎片不夠時不能按，並說還差
 * 幾片").
 *
 * **Structured feeding (review finding, 2026-10-27 round 3)**: epic/
 * legendary species (12 of them, wb-041..wb-052) don't share one pool — each
 * diet flavor has its OWN quota for the current stage
 * (`stage.fragments_by_flavor`). A naive "sum the wallet across all diet
 * flavors" check is wrong here: if one flavor is already fully fed but the
 * OTHER isn't, and the wallet only has fragments of the already-satisfied
 * flavor, the button must stay disabled — feeding would be a genuine no-op
 * server-side (feed_baby() only tops up outstanding flavors), and a kid
 * pressing an enabled-looking button that does nothing is worse than a
 * disabled one. `baby.fed_by_flavor` (per-flavor progress, only present for
 * structured-feeding species) is what makes this distinction possible.
 *
 * For the shared-pool case, the button is disabled only when the wallet has
 * NONE of this baby's diet flavors (quantity 0 for all of them) — if it has
 * SOME but not enough, the real feed call still makes partial progress
 * (feed_baby() is greedy and stops cleanly when the wallet runs dry), so
 * that's a legitimate click, not an error state.
 */
export function computeFeedability(
  baby: WordBabySummary,
  entry: CatalogBaby,
  wallet: Record<string, number>,
): FeedabilityResult {
  if (baby.fully_grown || baby.dormant_type !== null) {
    return { canFeed: false, fragmentsStillNeeded: 0, outstandingFlavors: [] };
  }
  const stage = entry.stages[baby.stage_index - 1];
  const fragmentsStillNeeded = Math.max(stage.fragments_to_finish_stage - baby.fed_current_stage, 0);

  if (stage.fragments_by_flavor) {
    const fedByFlavor = baby.fed_by_flavor ?? {};
    const outstandingFlavors = Object.entries(stage.fragments_by_flavor)
      .filter(([flavor, required]) => (fedByFlavor[flavor] ?? 0) < required)
      .map(([flavor]) => flavor);
    const canFeed = outstandingFlavors.some((flavor) => (wallet[flavor] ?? 0) > 0);
    return { canFeed, fragmentsStillNeeded, outstandingFlavors };
  }

  const outstandingFlavors = entry.diet_flavors;
  const availableInWallet = outstandingFlavors.reduce(
    (sum, flavor) => sum + (wallet[flavor] ?? 0),
    0,
  );
  return {
    canFeed: fragmentsStillNeeded > 0 && availableInWallet > 0,
    fragmentsStillNeeded,
    outstandingFlavors,
  };
}

/**
 * Kid-friendly (national-elementary-school grade 4 reading level) label for
 * the weaken_state enum. Team-lead 2026-10-27: "虛弱狀態用「躲起來了」表達
 * 不用死亡字眼" — and design.md §0 carries a hard platform-wide rule: no
 * "死亡/掛掉" words or imagery anywhere in this system.
 */
export function weakenStateLabel(state: WordBabySummary['weaken_state']): string {
  switch (state) {
    case 'healthy':
      return '精神很好';
    case 'weak':
      return '躲起來了，好像有點累';
    case 'deep_sleep':
      return '躲得好深，好久沒看到你了';
    default:
      return '精神很好';
  }
}

/** Short badge text for the weaken_state — used where space is tight. */
export function weakenStateBadge(state: WordBabySummary['weaken_state']): string | null {
  switch (state) {
    case 'weak':
      return '躲起來了';
    case 'deep_sleep':
      return '躲得很深';
    default:
      return null; // healthy — no badge needed, card already looks normal
  }
}

/** Kid-friendly label for a dormancy type (蛋/繭/冬眠). */
export function dormantTypeLabel(type: string): string {
  switch (type) {
    case '蛋':
      return '變成一顆蛋，正在孵化中';
    case '繭':
      return '結成了繭，正在長大';
    case '冬眠':
      return '正在冬眠，慢慢長大';
    default:
      return '正在休息，慢慢長大';
  }
}

/** Short "為什麼要讀課文" hint per flavor family — used in the feed
 * shortfall message so a kid knows WHAT TO GO DO, not just a bare number
 * (team-lead 2026-10-27 feedback #2: "不要只有灰掉的按鈕"). */
function flavorActionHint(flavor: string): string {
  switch (flavor) {
    case '語文基礎':
      return '多讀生字、語詞';
    case '閱讀理解':
      return '多做閱讀理解題目';
    case '朗讀表達':
      return '多朗讀課文';
    case '書寫紀錄':
      return '多寫課文筆記';
    case '文言文':
      return '多讀文言文課文';
    default:
      return '多讀課文';
  }
}

/** Which flavors this baby's diet includes, as a plain list — rendered as
 * individual small tags on the card (team-lead 2026-10-27 round 2: "每種
 * 口味用小標籤", not one joined sentence). Shown regardless of current
 * wallet state (team-lead round 1: "沒說寶貝吃哪種碎片"). */
export function dietFlavorsList(entry: CatalogBaby): string[] {
  return entry.diet_flavors;
}

/**
 * Two short lines for the feed-shortfall hint — a count line and an action
 * line (team-lead 2026-10-27 round 2: "對四年級太長，拆成兩行短句"). The
 * flavor name is deliberately NOT repeated here — it's already visible via
 * the 愛吃 tags and the highlighted wallet cells, so naming it a third time
 * just made the sentence long without adding information.
 */
export function feedShortfallLines(
  fragmentsStillNeeded: number,
  outstandingFlavors: string[],
): { countLine: string; actionLine: string } {
  // review finding 2026-10-27 round 3: the hint must follow the OUTSTANDING
  // flavors (computeFeedability's `outstandingFlavors`), not the full diet —
  // for structured feeding, a flavor that's already capped off for this
  // stage shouldn't still be suggested as "go get more of this".
  const hintsText = [...new Set(outstandingFlavors.map(flavorActionHint))].join('、');
  return {
    countLine: `還差 ${fragmentsStillNeeded} 片碎片`,
    actionLine: `${hintsText}就有機會拿到`,
  };
}

/**
 * Explains what to do about a weakened/deep-sleep pet (team-lead 2026-10-27
 * feedback #3: "沒說怎麼辦"). Per design.md §8, the care clock resets when
 * EITHER (a) the student completes any station on the platform — not just
 * feeding this specific baby — or (b) they feed this baby directly. The
 * hint names reading a lesson as the primary action (always available, not
 * gated on having fragments for this specific baby) and mentions feeding as
 * an alternative — do not claim feeding is the only way, that's not the
 * real rule.
 */
export function weakenStateRecoveryHint(state: WordBabySummary['weaken_state']): string | null {
  switch (state) {
    case 'weak':
      return '好久沒看到你了。只要去讀一課課文，或是餵牠一次，牠就會出來囉！';
    case 'deep_sleep':
      return '躲好久了，牠有點想你。去讀一課課文，或是餵牠一次，牠就會出來！';
    default:
      return null; // healthy — nothing to recover from
  }
}

/** A large, card-level icon (team-lead 2026-10-27 feedback #4: "卡片上看
 * 不到寶貝本人" — the emoji previously only lived in the small dex cell). */
export function babyIcon(baby: WordBabySummary): string {
  if (baby.dormant_type === '蛋') return '🥚';
  if (baby.dormant_type === '繭') return '🐛';
  if (baby.dormant_type === '冬眠') return '💤';
  if (baby.fully_grown) return '⭐';
  if (baby.weaken_state === 'weak' || baby.weaken_state === 'deep_sleep') return '🙈';
  return '🐣';
}
