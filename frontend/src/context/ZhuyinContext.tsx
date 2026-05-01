/**
 * ZhuyinContext -- global zhuyin (bopomofo) 3-state segmented-control.
 *
 * THREE display states:
 *   'none'      -- no ruby annotation
 *   'difficult' -- ruby only on vocabulary words (v1: lesson YAML vocabulary field)
 *   'all'       -- ruby on all characters
 *
 * Internally, zhuyinMode is 'none' | 'all' for the processor gate, and
 * vocabOnly (boolean) selects between 'difficult' and 'all' when mode='all'.
 * The combined triState is the canonical 3-way value exposed to the UI.
 *
 * Backward-compat helpers:
 *   zhuyinActive  -- true when triState is 'all' AND processor is ready
 *   isZhuyinAny   -- true when triState is 'difficult' OR 'all' AND ready
 *   isZhuyinAll   -- alias of zhuyinActive
 *   isZhuyinNone  -- true when triState is 'none'
 *   zhuyinEnabled -- true when triState !== 'none' (legacy boolean compat)
 *
 * processLinesSelective(lines, vocabWords):
 *   - triState='none'      -> null
 *   - triState='all'       -> fully-processed ruby lines
 *   - triState='difficult' -> ruby only on vocab-word substrings
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { PolyphonicProcessor, buildZhuyinString } from '../components/zhuyin/polyphonicProcessor';

export type ZhuyinMode = 'none' | 'difficult' | 'all';

const STORAGE_KEY = 'zhuyin_mode_v2';
const LEGACY_KEY  = 'zhuyin_enabled';

const MODE_CYCLE: ZhuyinMode[] = ['none', 'difficult', 'all'];

function readStoredMode(): ZhuyinMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'none' || raw === 'difficult' || raw === 'all') return raw;
    // Migrate from old boolean key
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === 'false') return 'none';
    return 'all';
  } catch {
    return 'all';
  }
}

interface ZhuyinContextValue {
  /** 3-state mode: 'none' | 'difficult' | 'all' */
  zhuyinMode: ZhuyinMode;
  zhuyinReady: boolean;
  /** true when mode='all' AND processor ready */
  zhuyinActive: boolean;
  /** true when mode='difficult' OR 'all' AND processor ready */
  isZhuyinAny: boolean;
  isZhuyinAll: boolean;
  isZhuyinNone: boolean;
  /** @deprecated -- true when mode !== 'none' */
  zhuyinEnabled: boolean;
  setZhuyinMode: (mode: ZhuyinMode) => void;
  /** @deprecated -- use setZhuyinMode */
  setZhuyinEnabled: (enabled: boolean) => void;
  /** Cycle: none -> difficult -> all -> none */
  toggleZhuyin: () => void;
  processZhuyin: (text: string) => string;
  processLines: (lines: string[]) => string[] | null;
  /** 3-state selective processing: respects 'none'/'difficult'/'all' modes */
  processLinesSelective: (lines: string[], vocabWords: string[]) => string[] | null;
}

const ZhuyinContext = createContext<ZhuyinContextValue>({
  zhuyinMode: 'all',
  zhuyinReady: false,
  zhuyinActive: false,
  isZhuyinAny: false,
  isZhuyinAll: false,
  isZhuyinNone: false,
  zhuyinEnabled: true,
  setZhuyinMode: () => {},
  setZhuyinEnabled: () => {},
  toggleZhuyin: () => {},
  processZhuyin: (t) => t,
  processLines: () => null,
  processLinesSelective: () => null,
});

export const ZhuyinProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [zhuyinMode, setZhuyinModeRaw] = useState<ZhuyinMode>(readStoredMode);
  const [zhuyinReady, setZhuyinReady] = useState(() => PolyphonicProcessor.instance.isLoaded);

  const zhuyinActive = zhuyinReady && zhuyinMode === 'all';
  const isZhuyinAny  = zhuyinReady && zhuyinMode !== 'none';
  const isZhuyinAll  = zhuyinActive;
  const isZhuyinNone = zhuyinMode === 'none';
  const zhuyinEnabled = zhuyinMode !== 'none';

  // Load polyphonic data once
  useEffect(() => {
    if (PolyphonicProcessor.instance.isLoaded) {
      setZhuyinReady(true);
      return;
    }
    PolyphonicProcessor.instance.loadPolyphonicData()
      .then(() => setZhuyinReady(true))
      .catch((err) => console.error('Failed to load zhuyin data:', err));
  }, []);

  const setZhuyinMode = useCallback((mode: ZhuyinMode) => {
    setZhuyinModeRaw(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage full -- ignore
    }
  }, []);

  const setZhuyinEnabled = useCallback((enabled: boolean) => {
    setZhuyinMode(enabled ? 'all' : 'none');
  }, [setZhuyinMode]);

  const toggleZhuyin = useCallback(() => {
    setZhuyinModeRaw((prev) => {
      const idx = MODE_CYCLE.indexOf(prev);
      const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      return next;
    });
  }, []);

  const processZhuyin = useCallback((text: string): string => {
    if (!isZhuyinAny) return text;
    try {
      return buildZhuyinString(PolyphonicProcessor.instance.process(text));
    } catch {
      return text;
    }
  }, [isZhuyinAny]);

  const processLines = useCallback((lines: string[]): string[] | null => {
    if (!isZhuyinAny) return null;
    try {
      return lines.map((line) => buildZhuyinString(PolyphonicProcessor.instance.process(line)));
    } catch {
      return null;
    }
  }, [isZhuyinAny]);

  const processLinesSelective = useCallback(
    (lines: string[], vocabWords: string[]): string[] | null => {
      if (!zhuyinReady || zhuyinMode === 'none') return null;
      if (zhuyinMode === 'all') {
        try {
          return lines.map((line) =>
            buildZhuyinString(PolyphonicProcessor.instance.process(line))
          );
        } catch {
          return null;
        }
      }
      // 'difficult': ruby only on vocab word substrings
      const validWords = vocabWords.filter(Boolean);
      if (validWords.length === 0) return null;
      try {
        return lines.map((line) => {
          const matches: Array<{ start: number; end: number }> = [];
          for (const word of validWords) {
            let pos = 0;
            while (pos < line.length) {
              const idx = line.indexOf(word, pos);
              if (idx === -1) break;
              matches.push({ start: idx, end: idx + word.length });
              pos = idx + 1;
            }
          }
          if (matches.length === 0) return line;
          matches.sort((a, b) => a.start - b.start);
          const deduped: typeof matches = [];
          let cursor = 0;
          for (const m of matches) {
            if (m.start >= cursor) { deduped.push(m); cursor = m.end; }
          }
          let result = '';
          let charPos = 0;
          for (const { start, end } of deduped) {
            if (charPos < start) result += line.slice(charPos, start);
            try {
              result += buildZhuyinString(
                PolyphonicProcessor.instance.process(line.slice(start, end))
              );
            } catch {
              result += line.slice(start, end);
            }
            charPos = end;
          }
          if (charPos < line.length) result += line.slice(charPos);
          return result;
        });
      } catch {
        return null;
      }
    },
    [zhuyinReady, zhuyinMode]
  );

  return (
    <ZhuyinContext.Provider value={{
      zhuyinMode,
      zhuyinReady,
      zhuyinActive,
      isZhuyinAny,
      isZhuyinAll,
      isZhuyinNone,
      zhuyinEnabled,
      setZhuyinMode,
      setZhuyinEnabled,
      toggleZhuyin,
      processZhuyin,
      processLines,
      processLinesSelective,
    }}>
      {children}
    </ZhuyinContext.Provider>
  );
};

export function useZhuyin(): ZhuyinContextValue {
  return useContext(ZhuyinContext);
}
