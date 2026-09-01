/**
 * Bopomofo (注音符號) constants and types.
 * Ported from learning-to-read-chinese/lib/constants/bopomos.dart
 * and lib/data/models/bopomo_spelling_model.dart
 */

// Tone marks
export const TONES = ['ˊ', 'ˇ', 'ˋ', '˙'] as const;

// Initials (聲母)
export const INITIALS = [
  'ㄅ', 'ㄆ', 'ㄇ', 'ㄈ',
  'ㄉ', 'ㄊ', 'ㄋ', 'ㄌ',
  'ㄍ', 'ㄎ', 'ㄏ',
  'ㄐ', 'ㄑ', 'ㄒ',
  'ㄓ', 'ㄔ', 'ㄕ', 'ㄖ',
  'ㄗ', 'ㄘ', 'ㄙ',
] as const;

// Prenuclear glides (介母)
export const PRENUCLEAR = ['ㄧ', 'ㄨ', 'ㄩ'] as const;

// Finals (韻母)
export const FINALS = [
  'ㄚ', 'ㄛ', 'ㄜ', 'ㄝ',
  'ㄞ', 'ㄟ', 'ㄠ', 'ㄡ',
  'ㄢ', 'ㄣ', 'ㄤ', 'ㄥ',
  'ㄦ',
] as const;

// Tone mark → integer mapping
export const TONE_TO_INT: Record<string, number> = {
  '': 1,
  'ˊ': 2,
  'ˇ': 3,
  'ˋ': 4,
  '˙': 5,
};

// Style set → PUA Unicode mapping (used by BpmfIansui font)
export const SS_MAPPING: Record<string, string> = {
  ss01: 'E01E1',
  ss02: 'E01E2',
  ss03: 'E01E3',
  ss04: 'E01E4',
  ss05: 'E01E5',
};

// Sentinel markers used by processLinesSelective('difficult') to delimit which
// character run should get the zhuyin-rendering font applied (#3022).
//
// Root cause of #3022: fontForZhuyin() was applied at the CONTAINER level, so
// BpmfZihiSerif/BpmfIansui (an IVS font that renders bopomofo for *every*
// character it draws, using the default reading absent an SS_MAPPING selector)
// annotated the whole subtree -- interface text included -- regardless of
// which characters processLinesSelective() actually selected. These markers
// let the renderer wrap ONLY the selected runs in the zhuyin font, leaving
// everything else (including plain passage text and UI chrome) in the base
// serif font.
//
// Deliberately placed inside the same Variation Selectors Supplement block as
// SS_MAPPING (U+E0100-U+E01EF) so every existing consumer that already treats
// that whole block as zero-width/combining (stripPUASelectors, countRawChars,
// splitZhuyinChars) absorbs them for free -- they never inflate a raw-char
// count or become their own visual/TTS-highlight unit. Chosen far from the
// ss01-ss05 cluster (E01E1-E01E5) to avoid any confusion with real tone
// variants.
export const DIFFICULT_SPAN_START = '\u{E01EA}';
export const DIFFICULT_SPAN_END = '\u{E01EB}';

/** Result of processing a single character */
export interface ProcessedChar {
  char: string;
  /** "0000" = default tone, "ss01"–"ss05" = variant */
  styleSet: string;
}

/** Bopomofo spelling decomposition */
export interface BopomoSpelling {
  initial: string;
  prenuclear: string;
  finals: string;
  tone: number;
}

/** Polyphonic character entry from poyin_db.json */
export interface PolyphonicEntry {
  s: number;        // number of variants (= len(v))
  /** Index into v[] that maps to the font's default pronunciation ('0000', no selector).
   *  Defaults to 0 when absent.  Set to 1 for characters whose font default is v[1]
   *  (e.g. 行 → háng, 著 → zhù). */
  d?: number;
  v?: string[];     // variation patterns
  f?: boolean;      // special flag
}

/** Top-level structure of poyin_db.json */
export interface PolyphonicData {
  data: Record<string, PolyphonicEntry>;
}
