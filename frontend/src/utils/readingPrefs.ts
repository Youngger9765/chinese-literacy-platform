/**
 * 閱讀偏好（#4160）：字級、字型、對齊、亮度。存在本機，所有關卡共用。
 * 純函式與儲存都放這裡，畫面只負責呼叫。
 */
export const FONT_SCALES = [0.8, 0.9, 1, 1.15, 1.3] as const
export const SIZE_LABELS = ['特小', '小', '中', '大', '特大'] as const
export type FontFamilyPref = 'default' | 'sans' | 'serif' | 'kai'
export type AlignPref = 'left' | 'center' | 'justify'
export type ThemePref = 'light' | 'warm' | 'dark'

export interface ReadingPrefs {
  sizeIndex: number
  font: FontFamilyPref
  align: AlignPref
  theme: ThemePref
}

export const DEFAULT_PREFS: ReadingPrefs = { sizeIndex: 2, font: 'default', align: 'left', theme: 'light' }
export const READING_PREFS_KEY = 'lingoleap_reading_prefs'

const FONTS: FontFamilyPref[] = ['default', 'sans', 'serif', 'kai']
const ALIGNS: AlignPref[] = ['left', 'center', 'justify']
const THEMES: ThemePref[] = ['light', 'warm', 'dark']

export function clampSize(i: number): number {
  return Math.min(FONT_SCALES.length - 1, Math.max(0, Math.round(i)))
}

/** 壞掉或缺欄位的資料逐欄退回預設，不整份丟掉 */
export function sanitizePrefs(raw: unknown): ReadingPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    sizeIndex: typeof r.sizeIndex === 'number' && Number.isFinite(r.sizeIndex) ? clampSize(r.sizeIndex) : DEFAULT_PREFS.sizeIndex,
    font: FONTS.includes(r.font as FontFamilyPref) ? (r.font as FontFamilyPref) : DEFAULT_PREFS.font,
    align: ALIGNS.includes(r.align as AlignPref) ? (r.align as AlignPref) : DEFAULT_PREFS.align,
    theme: THEMES.includes(r.theme as ThemePref) ? (r.theme as ThemePref) : DEFAULT_PREFS.theme,
  }
}

export function loadPrefs(): ReadingPrefs {
  try {
    const s = localStorage.getItem(READING_PREFS_KEY)
    return s ? sanitizePrefs(JSON.parse(s)) : { ...DEFAULT_PREFS }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(p: ReadingPrefs): void {
  try {
    localStorage.setItem(READING_PREFS_KEY, JSON.stringify(p))
  } catch {
    // 無痕或被封鎖時，本次仍有效，只是不會記住
  }
}

export function isDefaultPrefs(p: ReadingPrefs): boolean {
  return p.sizeIndex === DEFAULT_PREFS.sizeIndex && p.font === DEFAULT_PREFS.font
    && p.align === DEFAULT_PREFS.align && p.theme === DEFAULT_PREFS.theme
}
