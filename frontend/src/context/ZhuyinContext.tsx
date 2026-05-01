/**
 * ZhuyinContext -- global zhuyin (bopomofo) segmented-control state.
 *
 * zhuyinMode:
 *   'none' -- no ruby annotation (was zhuyinEnabled=false)
 *   'all'  -- ruby on all characters (was zhuyinEnabled=true)
 *
 * Visual is a 2-segment control (no zhuyin / full zhuyin).
 * A third segment for difficult-word-only mode is reserved for a future issue.
 *
 * Backward-compat helpers:
 *   zhuyinActive  -- true when mode is 'all' AND processor is ready
 *   isZhuyinAny   -- alias of zhuyinActive (components may use this)
 *   isZhuyinAll   -- alias of zhuyinActive
 *   isZhuyinNone  -- true when mode is 'none'
 *   zhuyinEnabled -- true when mode !== 'none' (legacy boolean compat)
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { PolyphonicProcessor, buildZhuyinString } from '../components/zhuyin/polyphonicProcessor';

export type ZhuyinMode = 'none' | 'all';

const STORAGE_KEY = 'zhuyin_mode';
const LEGACY_KEY  = 'zhuyin_enabled';

const MODE_CYCLE: ZhuyinMode[] = ['none', 'all'];

function readStoredMode(): ZhuyinMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'none' || raw === 'all') return raw;
    // Migrate from legacy boolean key
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === 'false') return 'none';
    return 'all'; // default: full zhuyin on
  } catch {
    return 'all';
  }
}

interface ZhuyinContextValue {
  zhuyinMode: ZhuyinMode;
  zhuyinReady: boolean;
  /** true when mode='all' AND processor ready */
  zhuyinActive: boolean;
  /** alias of zhuyinActive */
  isZhuyinAny: boolean;
  isZhuyinAll: boolean;
  isZhuyinNone: boolean;
  /** @deprecated -- use zhuyinMode; kept for backward compat */
  zhuyinEnabled: boolean;
  setZhuyinMode: (mode: ZhuyinMode) => void;
  /** @deprecated -- use setZhuyinMode */
  setZhuyinEnabled: (enabled: boolean) => void;
  /** Cycle: none -> all -> none */
  toggleZhuyin: () => void;
  processZhuyin: (text: string) => string;
  processLines: (lines: string[]) => string[] | null;
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
});

export const ZhuyinProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [zhuyinMode, setZhuyinModeRaw] = useState<ZhuyinMode>(readStoredMode);
  const [zhuyinReady, setZhuyinReady] = useState(() => PolyphonicProcessor.instance.isLoaded);

  const zhuyinActive = zhuyinReady && zhuyinMode === 'all';
  const isZhuyinAny  = zhuyinActive;
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

  // Legacy compat
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
    if (!zhuyinActive) return text;
    try {
      return buildZhuyinString(PolyphonicProcessor.instance.process(text));
    } catch {
      return text;
    }
  }, [zhuyinActive]);

  const processLines = useCallback((lines: string[]): string[] | null => {
    if (!zhuyinActive) return null;
    try {
      return lines.map((line) => buildZhuyinString(PolyphonicProcessor.instance.process(line)));
    } catch {
      return null;
    }
  }, [zhuyinActive]);

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
    }}>
      {children}
    </ZhuyinContext.Provider>
  );
};

export function useZhuyin(): ZhuyinContextValue {
  return useContext(ZhuyinContext);
}
