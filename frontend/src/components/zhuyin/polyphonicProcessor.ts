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

import { ProcessedChar, PolyphonicData } from './bopomoConstants';
import { matchPolyphonicPattern, isChineseCharacter } from './polyphonicPatternMatcher';
import { variantIndexToStyleSet } from './styleSetMapper';
import { getNewToneForYiBu } from './toneSandhi';
import { getToneForChar } from './toneData';
export { buildZhuyinString } from './zhuyinStringBuilder';

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
   * Retries up to MAX_RETRIES times with exponential backoff on network errors.
   * Call this once at app startup.
   */
  async loadPolyphonicData(): Promise<void> {
    if (this._loaded) return;

    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 500;

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch('/data/poyin_db.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw: Record<string, unknown> = await response.json();

        if (!('data' in raw)) {
          throw new Error('Polyphonic data is improperly formatted or missing key "data"');
        }

        this.polyphonicData = this.removeComments(raw) as unknown as PolyphonicData;
        this._loaded = true;
        return;
      } catch (e) {
        lastError = e;
        const isNetworkError = e instanceof TypeError && (e.message === 'Failed to fetch');
        const isLastAttempt = attempt === MAX_RETRIES - 1;

        if (!isNetworkError || isLastAttempt) {
          // Non-retryable error (e.g. malformed JSON, HTTP 4xx) or exhausted retries
          break;
        }

        const delayMs = BASE_DELAY_MS * 2 ** attempt;
        console.warn(
          `Failed to load polyphonic data (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delayMs}ms...`,
          e,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    console.error('Failed to load polyphonic data after all retries:', lastError);
    throw lastError;
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
      if (!isChineseCharacter(character)) {
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
        const [newSs, skipNext, newSkipPrev] = getNewToneForYiBu(
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
            const [matchIndex, skipNext, matchSkipPrev] = matchPolyphonicPattern(
              character, i, patterns, characters, skipPrevTemp, this.polyphonicData,
            );
            skipPrev = matchSkipPrev;

            // defaultVariantIdx: which v[] index is the font's '0000' default.
            // Stored as charData.d; falls back to 0 for characters where v[0]
            // is the font default (the vast majority of polyphonic chars).
            const defaultVariantIdx = charData.d ?? 0;
            const newSs = variantIndexToStyleSet(matchIndex, defaultVariantIdx);

            result.push({ char: character, styleSet: newSs });

            if (skipNext && i + 1 < length) {
              result.push({ char: nextChar, styleSet: '0000' });
              i += 1;
              continue;
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
