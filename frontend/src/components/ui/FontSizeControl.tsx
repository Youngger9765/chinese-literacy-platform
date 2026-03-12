import { useState, useEffect } from 'react';

export type FontSizeLevel = 'small' | 'medium' | 'large';

const STORAGE_KEY = 'lingoleap-font-size';
const DEFAULT_LEVEL: FontSizeLevel = 'medium';

export const FONT_SIZE_PX: Record<FontSizeLevel, number> = {
  small: 14,
  medium: 18,
  large: 22,
};

const LEVELS: FontSizeLevel[] = ['small', 'medium', 'large'];

const LABELS: Record<FontSizeLevel, string> = {
  small: '小',
  medium: '中',
  large: '大',
};

function readStoredLevel(): FontSizeLevel {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'small' || stored === 'medium' || stored === 'large') return stored;
  } catch {
    // ignore
  }
  return DEFAULT_LEVEL;
}

interface FontSizeControlProps {
  onChange?: (level: FontSizeLevel, px: number) => void;
}

export default function FontSizeControl({ onChange }: FontSizeControlProps) {
  const [level, setLevel] = useState<FontSizeLevel>(readStoredLevel);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, level);
      // The browser's 'storage' event only fires for cross-tab writes, not same-tab.
      // Dispatch a synthetic event so useFontSize() in the same page updates immediately.
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: level }));
    } catch {
      // ignore
    }
    onChange?.(level, FONT_SIZE_PX[level]);
  }, [level, onChange]);

  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label="調整字體大小"
    >
      <span className="text-[10px] text-gray-400 select-none mr-0.5" aria-hidden="true">字</span>
      {LEVELS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLevel(l)}
          title={`字體大小：${LABELS[l]}`}
          aria-label={`字體大小：${LABELS[l]}`}
          aria-pressed={level === l}
          className={`w-6 h-6 rounded text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
            level === l
              ? 'bg-accent text-white'
              : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
          }`}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  );
}

/** Hook to read the current font size preference from localStorage. */
export function useFontSize(): { level: FontSizeLevel; px: number } {
  const [level, setLevel] = useState<FontSizeLevel>(readStoredLevel);

  useEffect(() => {
    const handler = () => setLevel(readStoredLevel());
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return { level, px: FONT_SIZE_PX[level] };
}
