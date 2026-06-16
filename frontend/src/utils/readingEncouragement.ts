/**
 * Live Tutor paragraph summary headline — must match displayed accuracy, no overclaim.
 */

const ENCOURAGE_TIERS: Array<{ min: number; color: string; msgs: string[] }> = [
  { min: 0.95, color: 'text-emerald-600', msgs: ['讀得很準！', '讀得超棒！', '太厲害了！', '表現非常好！'] },
  { min: 0.80, color: 'text-green-600', msgs: ['讀得很好！', '棒棒！繼續加油！', '很不錯喔！', '表現很棒！'] },
  { min: 0.65, color: 'text-green-600', msgs: ['讀得不錯！', '很好喔，再練一下更好！', '進步很多了！'] },
  { min: 0.50, color: 'text-amber-600', msgs: ['有進步喔！再試一次會更好！', '很努力！繼續加油！', '你做得到的！'] },
  { min: 0, color: 'text-amber-600', msgs: ['沒關係，我們再試一次！', '慢慢來，不著急！', '多練幾次就會了！'] },
];

/** Only shown when rounded accuracy is 100% — matches the stat line. */
const PERFECT_MSGS = ['完美！太流暢了！', '好厲害，一字不差！', '全都唸對了，太厲害！'];

const ABSOLUTE_CLAIM_RE = /一字不差|完美|全都唸對了/;

export function getEncouragement(matchRate: number): { text: string; color: string } {
  const percent = Math.round(matchRate * 100);
  const pickIdx = Math.floor(matchRate * 1000);

  if (percent >= 100) {
    return {
      text: PERFECT_MSGS[pickIdx % PERFECT_MSGS.length],
      color: ENCOURAGE_TIERS[0].color,
    };
  }

  const tier =
    ENCOURAGE_TIERS.find((t) => matchRate >= t.min) ??
    ENCOURAGE_TIERS[ENCOURAGE_TIERS.length - 1];
  return { text: tier.msgs[pickIdx % tier.msgs.length], color: tier.color };
}

/** @internal test helper */
export function encouragementContainsAbsoluteClaim(matchRate: number): boolean {
  return ABSOLUTE_CLAIM_RE.test(getEncouragement(matchRate).text);
}
