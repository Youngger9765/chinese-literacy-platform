import { useSyncExternalStore } from 'react'
import { DEFAULT_PREFS, loadPrefs, savePrefs, sanitizePrefs, type ReadingPrefs } from '../utils/readingPrefs'

// 所有關卡共用同一份：模組層級小 store，工具列與學習外殼各自訂閱
let current: ReadingPrefs = loadPrefs()
const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function setReadingPrefs(patch: Partial<ReadingPrefs>): void {
  current = sanitizePrefs({ ...current, ...patch })
  savePrefs(current)
  listeners.forEach((l) => l())
}

export function resetReadingPrefs(): void {
  current = { ...DEFAULT_PREFS }
  savePrefs(current)
  listeners.forEach((l) => l())
}

/** 測試用：讓模組狀態重新從 localStorage 讀 */
export function reloadReadingPrefsFromStorage(): void {
  current = loadPrefs()
  listeners.forEach((l) => l())
}

export function useReadingPrefs(): ReadingPrefs {
  return useSyncExternalStore(subscribe, () => current, () => current)
}
