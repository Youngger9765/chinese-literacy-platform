import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFS, READING_PREFS_KEY, clampSize, isDefaultPrefs, loadPrefs, sanitizePrefs, savePrefs,
} from '../readingPrefs'

describe('readingPrefs（#4160）', () => {
  beforeEach(() => localStorage.clear())

  it('預設：第三檔、現行字型、靠左、淺色', () => {
    expect(loadPrefs()).toEqual({ sizeIndex: 2, font: 'default', align: 'left', theme: 'light' })
  })
  it('存了之後重新讀還在（明體＋深色）', () => {
    savePrefs({ ...DEFAULT_PREFS, font: 'serif', theme: 'dark' })
    const p = loadPrefs()
    expect(p.font).toBe('serif')
    expect(p.theme).toBe('dark')
  })
  it('字級夾在五檔之內', () => {
    expect(clampSize(-3)).toBe(0)
    expect(clampSize(99)).toBe(4)
  })
  it('壞資料逐欄退回預設', () => {
    localStorage.setItem(READING_PREFS_KEY, JSON.stringify({ sizeIndex: 'x', font: 'comic', align: 'center', theme: 7 }))
    expect(loadPrefs()).toEqual({ ...DEFAULT_PREFS, align: 'center' })
    localStorage.setItem(READING_PREFS_KEY, '{not json')
    expect(loadPrefs()).toEqual(DEFAULT_PREFS)
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS)
  })
  it('isDefaultPrefs 能分出有沒有改過', () => {
    expect(isDefaultPrefs(DEFAULT_PREFS)).toBe(true)
    expect(isDefaultPrefs({ ...DEFAULT_PREFS, sizeIndex: 3 })).toBe(false)
  })
})

import { FONT_SCALES as SCALES_4160 } from '../readingPrefs'
describe('字級倍率（#4160 審查）', () => {
  it('五檔倍率各不相同且預設那檔是 1', () => {
    expect(new Set(SCALES_4160).size).toBe(5)
    expect(SCALES_4160[2]).toBe(1)
    expect([...SCALES_4160]).toEqual([...SCALES_4160].sort((a, b) => a - b))
  })
})
