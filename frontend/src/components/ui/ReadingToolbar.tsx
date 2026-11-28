import { useEffect, useRef, useState } from 'react'
import { resetReadingPrefs, setReadingPrefs, useReadingPrefs } from '../../hooks/useReadingPrefs'
import {
  FONT_SCALES, SIZE_LABELS, clampSize, isDefaultPrefs,
  type AlignPref, type FontFamilyPref, type ThemePref,
} from '../../utils/readingPrefs'

const FONTS: Array<[FontFamilyPref, string]> = [['default', '預設'], ['sans', '黑體'], ['serif', '明體'], ['kai', '楷體']]
const ALIGNS: Array<[AlignPref, string]> = [['left', '靠左'], ['center', '置中'], ['justify', '左右對齊']]
const THEMES: Array<[ThemePref, string]> = [['light', '淺色'], ['warm', '護眼'], ['dark', '深色']]

function Seg<T extends string>({ label, value, options, onPick }: {
  label: string; value: T; options: Array<[T, string]>; onPick: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="mb-3">
      <p className="text-xs font-bold text-on-surface-variant mb-1">{label}</p>
      <div className="flex gap-1">
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onPick(v)}
            className={`flex-1 h-9 rounded-full text-xs font-bold whitespace-nowrap px-2 ${
              value === v ? 'bg-accent text-white' : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 右上角「Aa」：字級、字型、對齊、亮度，偏好記在本機（#4160） */
export default function ReadingToolbar() {
  const prefs = useReadingPrefs()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const last = FONT_SCALES.length - 1
  return (
    <div ref={ref} className="relative" data-testid="reading-toolbar">
      <button
        type="button"
        aria-label="閱讀設定"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="h-8 sm:h-9 px-2.5 sm:px-3 rounded-full bg-surface-container-high font-headline font-bold text-xs sm:text-sm text-on-surface-variant hover:bg-surface-container-highest focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent"
      >
        Aa
      </button>
      {open && (
        <div role="dialog" aria-label="閱讀設定" className="absolute right-0 top-full mt-2 z-40 w-72 rounded-2xl bg-surface-container-lowest shadow-editorial p-4">
          <div role="group" aria-label="字級" className="mb-3">
            <p className="text-xs font-bold text-on-surface-variant mb-1">字級</p>
            <div className="flex items-center gap-2">
              <button
                type="button" aria-label="字級縮小" disabled={prefs.sizeIndex <= 0}
                onClick={() => setReadingPrefs({ sizeIndex: clampSize(prefs.sizeIndex - 1) })}
                className="h-9 w-12 rounded-full bg-surface-container-high font-bold text-sm disabled:opacity-30"
              >A−</button>
              <span data-testid="reading-size-label" aria-live="polite" className="flex-1 text-center text-sm font-bold text-on-surface">
                {SIZE_LABELS[prefs.sizeIndex]}
              </span>
              <button
                type="button" aria-label="字級放大" disabled={prefs.sizeIndex >= last}
                onClick={() => setReadingPrefs({ sizeIndex: clampSize(prefs.sizeIndex + 1) })}
                className="h-9 w-12 rounded-full bg-surface-container-high font-bold text-sm disabled:opacity-30"
              >A＋</button>
            </div>
          </div>
          <Seg label="字型" value={prefs.font} options={FONTS} onPick={(font) => setReadingPrefs({ font })} />
          <Seg label="課文對齊" value={prefs.align} options={ALIGNS} onPick={(align) => setReadingPrefs({ align })} />
          <Seg label="亮度" value={prefs.theme} options={THEMES} onPick={(theme) => setReadingPrefs({ theme })} />
          <button
            type="button" onClick={resetReadingPrefs} disabled={isDefaultPrefs(prefs)}
            className="w-full h-9 rounded-full border border-outline-variant text-xs font-bold text-on-surface-variant disabled:opacity-40"
          >恢復預設</button>
        </div>
      )}
    </div>
  )
}
