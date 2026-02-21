/**
 * Polyphonic character processor for zhuyinfuhao (注音符號) rendering.
 * Ported from learning-to-read-chinese/lib/views/polyphonic_processor.dart
 *
 * Resolves tone sandhi for 一 and 不, and selects correct pronunciation variants
 * for polyphonic characters based on context. Outputs ProcessedChar[] which can
 * be converted to a Unicode string for rendering with the BpmfIansui font.
 *
 * References:
 *   - jeffreyxuan/toneoz-font-zhuyin (tone sandhi logic)
 *   - ButTaiwan/bpmfvs (bopomofo processing methods)
 */

import { SS_MAPPING, ProcessedChar, PolyphonicData } from './bopomoConstants';
import { getToneForChar } from './toneData';

const CHINESE_CHAR_REGEX = /[\u4e00-\u9fa5]/;

/**
 * Singleton polyphonic processor.
 * Must call loadPolyphonicData() before using process().
 */
export class PolyphonicProcessor {
  private static _instance: PolyphonicProcessor;
  private polyphonicData: PolyphonicData | null = null;
  private _loaded = false;

  private constructor() {}

  static get instance(): PolyphonicProcessor {
    if (!PolyphonicProcessor._instance) {
      PolyphonicProcessor._instance = new PolyphonicProcessor();
    }
    return PolyphonicProcessor._instance;
  }

  get isLoaded(): boolean {
    return this._loaded;
  }

  /**
   * Load polyphonic data from the JSON file.
   * Call this once at app startup.
   */
  async loadPolyphonicData(): Promise<void> {
    if (this._loaded) return;
    try {
      const response = await fetch('/data/poyin_db.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw: Record<string, unknown> = await response.json();

      if (!('data' in raw)) {
        throw new Error('Polyphonic data is improperly formatted or missing key "data"');
      }

      this.polyphonicData = this.removeComments(raw) as unknown as PolyphonicData;
      this._loaded = true;
    } catch (e) {
      console.error('Failed to load polyphonic data:', e);
      throw e;
    }
  }

  /** Recursively strip _comment keys from the data */
  private removeComments(data: Record<string, unknown>): Record<string, unknown> {
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === '_comment') continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        filtered[key] = this.removeComments(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        filtered[key] = value.map((item) =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? this.removeComments(item as Record<string, unknown>)
            : item
        );
      } else {
        filtered[key] = value;
      }
    }
    return filtered;
  }

  // ---------------------------------------------------------------------------
  //  Tone sandhi for 一 and 不
  // ---------------------------------------------------------------------------

  /**
   * 以下處理一、不的方法是基於 jeffreyxuan 的原始碼
   * https://github.com/jeffreyxuan/toneoz-font-zhuyin/blob/main/src/js/ybtone.js
   * 同時也請參考教育部國語辭典說明：https://dict.concised.moe.edu.tw/page.jsp?ID=55
   *
   * Returns [newSs, skipNext, skipPrev]
   */
  private getNewToneForYiBu(
    prevChar: string | null,
    currentChar: string,
    nextChar: string | null,
    prevTone: number | null,
    nextTone: number | null,
    skipPrev: boolean,
  ): [string, boolean, boolean] {
    const prevCharSet1 = new Set([
      '第', '説', '说', '唯', '惟', '统', '統', '独', '獨', '劃', '划', '萬', '專', '某',
      '十', '九', '八', '七', '六', '五', '四', '三', '二', '一', '〇', '零',
    ]);

    const nextCharSet1 = new Set([
      '是', '日', '月', '的', '或', '物', '片', '系',
      '十', '九', '八', '七', '六', '五', '四', '三', '二', '一', '〇', '零', '百', '千', '萬',
      '元', '則', '節', '台', '同', '名', '回', '堂', '層', '幅', '幢', '年', '息', '成', '排',
      '提', '搏', '擊', '擲', '旁', '時', '枚', '格', '條', '樓', '流', '環', '篇', '級', '群',
      '言', '連', '門', '間',
      '天', '經', '方', '對', '次', '家', '鳴', '命', '份', '件', '尊', '聲', '歲', '副', '本', '批',
    ]);

    // specialYiCases: nextChar → [newSs, skipNext, skipPrev]
    const specialYiCases: Record<string, [string, boolean, boolean]> = {
      '個': ['0000', false, false],
      '个': ['0000', false, false],
      '會': ['0000', false, false],
      '切': ['0000', false, false],
      '不': ['0000', true, true],
    };

    const specialBuCases: Record<string, [string, boolean, boolean]> = {
      '禁': ['0000', false, false],
      '菲': ['0000', false, false],
      '勝': ['0000', false, false],
      '著': ['0000', false, false],
      '了': ['0000', false, false],
      '好': ['0000', false, false],
      '假': ['0000', false, false],
      '當': ['ss01', false, false],
    };

    if (currentChar === '一') {
      if (!skipPrev && (prevChar == null || prevCharSet1.has(prevChar))) {
        return ['0000', false, true];
      } else if (nextChar != null && nextChar in specialYiCases) {
        return specialYiCases[nextChar]!;
      } else if (nextChar == null || nextChar === '' || nextCharSet1.has(nextChar)) {
        return ['0000', true, true];
      } else if (prevChar === nextChar ||
          ['看', '聽', '寫', '用', '說', '動', '搖', '問'].includes(nextChar ?? '')) {
        return ['0000', true, true];
      } else if (nextTone != null && (nextTone === 1 || nextTone === 2 || nextTone === 3)) {
        return ['ss02', true, true]; // Fourth tone
      } else if (nextTone != null && nextTone === 4) {
        return ['ss01', true, true]; // Second tone
      } else {
        return ['0000', false, true];
      }
    } else if (currentChar === '不') {
      if (nextChar != null && nextChar in specialBuCases) {
        return specialBuCases[nextChar]!;
      }
      if (nextTone != null && (nextTone === 1 || nextTone === 2 || nextTone === 3 || nextTone === 5)) {
        return ['0000', false, true]; // Remain 四聲
      } else if (nextTone != null && nextTone === 4) {
        return ['ss01', true, true]; // Change to second tone
      } else {
        return ['0000', false, true];
      }
    }

    return ['0000', false, false]; // Default case
  }

  // ---------------------------------------------------------------------------
  //  Pattern matching for polyphonic characters
  // ---------------------------------------------------------------------------

  /** Special set of three-char phrases ending with 地 that should read de5 */
  private static readonly PHRASES_ENDS_WITH_DI = new Set([
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
  private match(
    character: string,
    index: number,
    patterns: string[],
    text: string[],
    skipPrev: boolean = false,
  ): [number, boolean, boolean] {
    let defaultIndex = -1;
    const prev2Char = index > 1 ? text[index - 2] : '';
    const prevChar = index > 0 ? text[index - 1] : '';
    const threeCharPhrase = prev2Char + prevChar + character;
    const nextChar = index + 1 < text.length ? text[index + 1] : '';
    const isFirstChar = prevChar === '' || !this.isChineseCharacter(prevChar);
    const isLastChar = nextChar === '' || !this.isChineseCharacter(nextChar);
    const isStandalone = text.length === 1 || (isFirstChar && isLastChar);
    let skipNext = false;

    if (isStandalone) {
      return [0, false, true];
    }

    // Special handle for '地' with 'de5' sound
    if (character === '地') {
      if (PolyphonicProcessor.PHRASES_ENDS_WITH_DI.has(threeCharPhrase)) {
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

          if (this.matchPattern(pattern, pos, start, end, text, character)) {
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

          if (this.matchPattern(pattern, pos, start, end, text, character)) {
            if (this.isPolyphonicChar(nextChar)) {
              skipNext = false;
              skipPrev = false;
            } else {
              skipPrev = true;
              skipNext = pattern.startsWith('*') && pos === 0;
            }
            if (this.isPolyphonicChar(nextChar)) {
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

    return [defaultIndex !== -1 ? defaultIndex : 0, false, false];
  }

  /** Check if a character is in the polyphonic data */
  private isPolyphonicChar(character: string): boolean {
    if (!this.polyphonicData) return false;
    if (!this.isChineseCharacter(character)) return false;
    return character in this.polyphonicData.data;
  }

  /** Match a pattern against text around the character position */
  private matchPattern(
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
  private isChineseCharacter(char: string): boolean {
    return CHINESE_CHAR_REGEX.test(char);
  }

  // ---------------------------------------------------------------------------
  //  Main processing
  // ---------------------------------------------------------------------------

  /** Special double character map: pair → style set */
  private static readonly SPECIAL_DOUBLE_CHARACTERS: Record<string, string> = {
    '一一': 'ss00',
    '仆仆': 'ss01',
    '便便': 'ss01',
    '剌剌': 'ss01',
    '厭厭': 'ss01',
    '呀呀': 'ss01',
    '呱呱': 'ss00',
    '咯咯': 'ss01',
    '啞啞': 'ss01',
    '啦啦': 'ss01',
    '喔喔': 'ss00',
    '嗑嗑': 'ss01',
    '嚇嚇': 'ss01',
    '好好': 'ss00',
    '從從': 'ss03',
    '怔怔': 'ss01',
    '悶悶': 'ss01',
    '擔擔': 'ss01',
    '數數': 'ss01',
    '施施': 'ss01',
    '晃晃': 'ss01',
    '朴朴': 'ss02',
    '棲棲': 'ss01',
    '殷殷': 'ss01',
    '比比': 'ss01',
    '泄泄': 'ss01',
    '洩洩': 'ss01',
    '湛湛': 'ss00',
    '湯湯': 'ss01',
    '濕濕': 'ss02',
    '濟濟': 'ss01',
    '濺濺': 'ss01',
    '父父': 'ss02',
    '種種': 'ss00',
    '答答': 'ss01',
    '粥粥': 'ss02',
    '累累': 'ss01',
    '繆繆': 'ss02',
    '脈脈': 'ss01',
    '菲菲': 'ss00',
    '蔚蔚': 'ss01',
    '藉藉': 'ss01',
    '虎虎': 'ss01',
    '處處': 'ss01',
    '蛇蛇': 'ss01',
    '行行': 'ss00',
    '褶褶': 'ss01',
    '逮逮': 'ss00',
    '那那': 'ss01',
    '重重': 'ss01',
    '銻銻': 'ss02',
    '鰓鰓': 'ss01',
    '個個': 'ss00',
    '个个': 'ss00',
    '大大': 'ss00',
    '方方': 'ss00',
    '喏喏': 'ss00',
  };

  /** Common phrases with 多 that should not trigger polyphonic matching for next char */
  private static readonly DUO_COMMON_PHRASES = [
    '許多', '很多', '大多', '眾多', '太多', '極多', '何多', '沒多', '甚多', '更多', '幾多',
  ];

  /**
   * Process a text string and return an array of ProcessedChar.
   * Each ProcessedChar contains the character and its style set.
   *
   * This is the main entry point — the TypeScript equivalent of the Dart process() method.
   * Unlike the Dart version, this is synchronous because tone lookups use an in-memory map.
   */
  process(text: string): ProcessedChar[] {
    if (!this.polyphonicData) {
      throw new Error('Polyphonic data not loaded. Call loadPolyphonicData() first.');
    }

    const result: ProcessedChar[] = [];
    const characters = text.split('');
    const length = characters.length;
    let skipPrev = false;

    for (let i = 0; i < length; i++) {
      const character = characters[i];
      const nextChar = i + 1 < length ? characters[i + 1] : '';
      const next2Char = i + 2 < length ? characters[i + 2] : '';
      const next3Char = i + 3 < length ? characters[i + 3] : '';
      const prevChar = i > 0 ? characters[i - 1] : '';

      const skipPrevTemp = skipPrev;
      skipPrev = false;

      // Non-Chinese character: pass through with default style
      if (!CHINESE_CHAR_REGEX.test(character)) {
        result.push({ char: character, styleSet: '0000' });
        skipPrev = true;
        continue;
      }

      // ── Handle 一 and 不 ──────────────────────────────────────────────

      if (character === '一' || character === '不') {
        // Special multi-character phrases for 一
        if (character === '一') {
          if (nextChar === '部') {
            result.push({ char: character, styleSet: '0000' }); // 一 default
            result.push({ char: nextChar, styleSet: '0000' });  // 部 default
            if (next2Char === '分') {
              result.push({ char: next2Char, styleSet: 'ss01' }); // 分 四聲
              i += 2;
            } else {
              i += 1;
            }
            continue;
          } else if (nextChar === '會') {
            result.push({ char: character, styleSet: '0000' }); // 一 default
            result.push({ char: nextChar, styleSet: 'ss02' });  // 會 三聲
            if (next2Char === '兒') {
              result.push({ char: next2Char, styleSet: 'ss01' }); // 兒 輕聲
              i += 2;
            } else {
              i += 1;
            }
            continue;
          }
        }

        // Special multi-character phrases for 不
        if (character === '不') {
          if (nextChar === '得' && next2Char === '不') {
            result.push({ char: character, styleSet: '0000' }); // 不 default
            result.push({ char: nextChar, styleSet: '0000' });  // 得 default
            result.push({ char: next2Char, styleSet: '0000' }); // 不 default
            i += 2;
            skipPrev = true;
            continue;
          } else if (nextChar === '一' && next2Char === '定') {
            result.push({ char: character, styleSet: '0000' }); // 不 default
            result.push({ char: nextChar, styleSet: 'ss01' });  // 一 二聲
            result.push({ char: next2Char, styleSet: '0000' }); // 定 default
            i += 2;
            skipPrev = true;
            continue;
          }
        }

        // General tone sandhi for 一 and 不
        const prevTone = i > 0 ? getToneForChar(prevChar) : 0;
        const nextTone = i + 1 < length ? getToneForChar(nextChar) : 0;
        const [newSs, skipNext, newSkipPrev] = this.getNewToneForYiBu(
          prevChar || null,
          character,
          nextChar || null,
          prevTone,
          nextTone,
          skipPrevTemp,
        );

        result.push({ char: character, styleSet: newSs });
        skipPrev = newSkipPrev;

        if (skipNext && i + 1 < length) {
          result.push({ char: nextChar, styleSet: '0000' });
          i += 1;
          continue;
        }

      } else {
        // ── Handle other polyphonic characters ──────────────────────────

        const charData = this.polyphonicData.data[character];

        if (charData) {
          const pair = character + nextChar;
          let setNextBpmf = 0;
          let next2CharStyleSet = '';
          let next3CharStyleSet = '';

          // Check for special double characters
          if (pair in PolyphonicProcessor.SPECIAL_DOUBLE_CHARACTERS) {
            const nextPair = next2Char + next3Char;
            let styleSet = PolyphonicProcessor.SPECIAL_DOUBLE_CHARACTERS[pair];

            // Context-dependent overrides for special pairs
            if (pair === '重重' && next2Char === '的') {
              styleSet = 'ss00';
              setNextBpmf = 1;
            } else if (pair === '行行') {
              if (nextPair === '出狀') {
                styleSet = 'ss01';
                setNextBpmf = 2;
              } else if (nextPair === '重行') {
                styleSet = 'ss00';
                setNextBpmf = 2;
                next2CharStyleSet = 'ss01';
              } else if (nextPair === '如也') {
                styleSet = 'ss03';
                setNextBpmf = 2;
              }
            } else if (pair === '呱呱' && (nextPair === '墜地' || nextPair === '墮地' || nextPair === '而泣')) {
              styleSet = 'ss01';
              setNextBpmf = 2;
            } else if (pair === '晃晃') {
              if (['白', '明', '亮', '精', '油'].includes(prevChar)) {
                styleSet = 'ss01';
              } else {
                styleSet = 'ss00';
              }
              setNextBpmf = 0;
            }

            // Push both characters of the double pair
            if (styleSet === 'ss00') {
              result.push({ char: character, styleSet: '0000' });
              result.push({ char: nextChar, styleSet: '0000' });
            } else {
              result.push({ char: character, styleSet });
              result.push({ char: nextChar, styleSet });
            }
            i += 1;
            skipPrev = true;

            // Fast-process subsequent characters
            if (setNextBpmf === 1) {
              result.push({ char: next2Char, styleSet: '0000' });
              i += 1;
            } else if (setNextBpmf === 2) {
              result.push({ char: next2Char, styleSet: next2CharStyleSet || '0000' });
              result.push({ char: next3Char, styleSet: next3CharStyleSet || '0000' });
              i += 2;
            }
            continue;
          }

          // Regular polyphonic character: use pattern matching
          const variations = charData.v;
          if (variations && variations.length > 0) {
            const patterns = variations.map(String);
            const [matchIndex, skipNext, matchSkipPrev] = this.match(
              character, i, patterns, characters, skipPrevTemp,
            );
            skipPrev = matchSkipPrev;

            if (matchIndex !== 0 || skipNext) {
              const newSs = matchIndex !== 0 ? `ss0${matchIndex}` : '';
              if (newSs) {
                result.push({ char: character, styleSet: newSs });
              } else {
                result.push({ char: character, styleSet: '0000' });
              }
              if (skipNext && i + 1 < length) {
                result.push({ char: nextChar, styleSet: '0000' });
                i += 1;
                continue;
              }
            } else {
              result.push({ char: character, styleSet: '0000' });
            }
          } else {
            result.push({ char: character, styleSet: '0000' });
          }
        } else {
          // Not a polyphonic character
          result.push({ char: character, styleSet: '0000' });
          const phrase = prevChar + character;
          if (PolyphonicProcessor.DUO_COMMON_PHRASES.includes(phrase)) {
            skipPrev = true;
          } else {
            skipPrev = false;
          }
        }
      }
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
//  Utility functions
// ---------------------------------------------------------------------------

/**
 * Convert ProcessedChar[] to a Unicode string suitable for BpmfIansui font rendering.
 * Characters with non-default style sets get a PUA variant selector appended.
 */
export function buildZhuyinString(processed: ProcessedChar[]): string {
  let result = '';
  for (const { char, styleSet } of processed) {
    result += char;
    if (styleSet !== '0000' && styleSet in SS_MAPPING) {
      result += String.fromCodePoint(parseInt(SS_MAPPING[styleSet], 16));
    }
  }
  return result;
}
