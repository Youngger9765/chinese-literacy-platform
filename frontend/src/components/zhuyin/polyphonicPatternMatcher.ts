import type { PolyphonicData } from './bopomoConstants';

const CHINESE_CHAR_REGEX = /[\u4e00-\u9fa5]/;

/** Special set of three-char phrases ending with 地 that should read de5 */
const PHRASES_ENDS_WITH_DI = new Set([
  '一十地', '大方地', '大聲地', '小心地', '小聲地', '不休地', '不安地',
  '不倦地', '不停地', '不堪地', '不絕地', '不諱地', '不斷地', '亢奮地',
  '仔細地', '叨叨地', '可憐地', '巧妙地', '平整地', '正當地', '正經地',
  '生氣地', '生動地', '示弱地', '交替地', '吁吁地', '合適地', '吐吐地',
  '如實地', '安靜地', '忙碌地', '成功地', '有味地', '有效地', '自主地',
  '自由地', '自在地', '自信地', '自然地', '下氣地', '低聲地', '克難地',
  '冷漠地', '吾吾地', '均勻地', '完整地', '忘我地', '快速地', '快樂地',
  '抖擻地', '決然地', '牢固地', '狂暴地', '狂熱地', '甫定地', '迅速地',
  '屈膝地', '周到地', '呱呱地', '和藹地', '坦率地', '委婉地', '怯步地',
  '所能地', '易舉地', '虎嚥地', '采烈地', '勇敢地', '思索地', '急速地',
  '筍般地', '耐心地', '重複地', '飛快地', '容易地', '恣意地', '悄悄地',
  '特別地', '特定地', '真實地', '秘密地', '虔誠地', '究柢地', '高興地',
  '乾脆地', '停蹄地', '偷偷地', '堅定地', '堅強地', '堅毅地', '專注地',
  '康康地', '強烈地', '得意地', '悠悠地', '悠揚地', '悠閒地', '情願地',
  '授權地', '敏感地', '敏銳地', '淡寫地', '深刻地', '深深地', '清楚地',
  '甜甜地', '細心地', '許可地', '尊敬地', '悲傷地', '惺忪地', '愉快地',
  '無私地', '無償地', '猶豫地', '痛苦地', '絮絮地', '間斷地', '意外地',
  '意料地', '準確地', '溫柔地', '煞氣地', '痴痴地', '經意地', '詳細地',
  '誠意地', '誠懇地', '嘆氣地', '慢慢地', '慣性地', '漂亮地', '漸漸地',
  '瘋狂地', '盡力地', '盡瘁地', '緊緊地', '輕盈地', '輕微地', '輕輕地',
  '輕聲地', '遠遠地', '嘩啦地', '熟慮地', '熟練地', '熱心地', '熱情地',
  '範圍地', '緩慢地', '緩緩地', '踏實地', '整齊地', '激動地', '興奮地',
  '諱言地', '錯誤地', '隨意地', '靜靜地', '靦腆地', '默默地', '優雅地',
  '翼翼地', '闊步地', '禮貌地', '簡單地', '謹慎地', '穩固地', '穩穩地',
  '嚴厲地', '歡快地', '驕傲地', '驚恐地', '靈活地', '究底地', '大大地',
]);

/**
 * Match polyphonic patterns for a character.
 * Returns [matchIndex, skipNext, skipPrev]
 */
export function matchPolyphonicPattern(
  character: string,
  index: number,
  patterns: string[],
  text: string[],
  skipPrev: boolean,
  polyphonicData: PolyphonicData,
): [number, boolean, boolean] {
  let defaultIndex = -1;
  const prev2Char = index > 1 ? text[index - 2] : '';
  const prevChar = index > 0 ? text[index - 1] : '';
  const threeCharPhrase = prev2Char + prevChar + character;
  const nextChar = index + 1 < text.length ? text[index + 1] : '';
  const isFirstChar = prevChar === '' || !isChineseCharacter(prevChar);
  const isLastChar = nextChar === '' || !isChineseCharacter(nextChar);
  const isStandalone = text.length === 1 || (isFirstChar && isLastChar);
  let skipNext = false;

  if (isStandalone) {
    return [0, false, true];
  }

  // Special handle for '地' with 'de5' sound
  if (character === '地') {
    if (PHRASES_ENDS_WITH_DI.has(threeCharPhrase)) {
      return [1, false, true]; // de5
    } else {
      return [0, false, true]; // di4
    }
  }

  // Special handle for '著' (著作權)
  if (character === '著') {
    const secondLine = patterns.length > 1 ? patterns[1] : '';
    if (index >= 0 && index + 2 < text.length) {
      const prefix = character + text[index + 1] + text[index + 2];
      if (prefix === '著作權') {
        return [patterns.indexOf(secondLine), false, false];
      }
    }
  }

  // First pass: Checking all patterns for "any+*" or "any+*+any"
  if (!isFirstChar && !skipPrev) {
    for (let j = 0; j < patterns.length; j++) {
      const combinedPattern = patterns[j];
      const subPatterns = combinedPattern.split('/');

      for (const pattern of subPatterns) {
        if (pattern === '') {
          defaultIndex = j;
          continue;
        }
        if (pattern.startsWith('*')) continue; // Skip patterns starting with '*' in first pass
        const pos = pattern.indexOf('*');
        if (pos === -1) continue;

        const start = index - pos;
        const end = index - pos + pattern.length;
        if (start < 0 || end > text.length) continue;

        if (matchPattern(pattern, pos, start, end, text, character)) {
          return [j, false, true];
        }
      }
    }
  }

  // Second pass: Checking patterns for "*+any"
  if (!isLastChar) {
    for (let j = 0; j < patterns.length; j++) {
      const combinedPattern = patterns[j];
      const subPatterns = combinedPattern.split('/');

      for (const pattern of subPatterns) {
        if (pattern === '') {
          defaultIndex = j;
          continue;
        }
        if (!pattern.startsWith('*')) continue; // Only patterns starting with '*' in second pass
        const pos = pattern.indexOf('*');
        if (pos === -1) continue;

        const start = index - pos;
        const end = index - pos + pattern.length;
        if (start < 0 || end > text.length) continue;

        if (matchPattern(pattern, pos, start, end, text, character)) {
          if (isPolyphonicChar(nextChar, polyphonicData)) {
            skipNext = false;
            skipPrev = false;
          } else {
            skipPrev = true;
            skipNext = pattern.startsWith('*') && pos === 0;
          }
          if (isPolyphonicChar(nextChar, polyphonicData)) {
            skipNext = false;
            skipPrev = false;
          } else {
            skipPrev = true;
            skipNext = pattern.startsWith('*') && pos === 0;
          }
          return [j, skipNext, skipPrev];
        }
      }
    }
  }

  return [defaultIndex, false, false];
}

/** Check if a character is in the polyphonic data */
function isPolyphonicChar(character: string, polyphonicData: PolyphonicData): boolean {
  if (!isChineseCharacter(character)) return false;
  return character in polyphonicData.data;
}

/** Match a pattern against text around the character position */
function matchPattern(
  pattern: string,
  _pos: number,
  start: number,
  end: number,
  text: string[],
  character: string,
): boolean {
  let tmp = '';
  for (let z = start; z < end; z++) {
    tmp += text[z];
  }
  return tmp === pattern.replaceAll('*', character);
}

/** Check if a single character is a CJK unified ideograph */
export function isChineseCharacter(char: string): boolean {
  return CHINESE_CHAR_REGEX.test(char);
}
