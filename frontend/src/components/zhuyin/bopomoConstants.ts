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
  s: number;        // default tone index
  v?: string[];     // variation patterns
  f?: boolean;      // special flag
}

/** Top-level structure of poyin_db.json */
export interface PolyphonicData {
  data: Record<string, PolyphonicEntry>;
}
