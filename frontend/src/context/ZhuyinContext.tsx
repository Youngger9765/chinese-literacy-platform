/**
 * ZhuyinContext -- global zhuyin (bopomofo) toggle state.
 *
 * Manages:
 *   - zhuyinEnabled  -- user preference (persisted in localStorage)
 *   - zhuyinReady    -- true once PolyphonicProcessor data is loaded
 *   - zhuyinActive   -- enabled AND ready (convenience derived value)
 *   - processZhuyin  -- helper: text -> zhuyin string (passthrough when inactive)
 *
 * Provided at the App level so every step component shares a single toggle.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { PolyphonicProcessor, buildZhuyinString } from '../components/zhuyin/polyphonicProcessor';

const STORAGE_KEY = 'zhuyin_enabled';

function readStoredPreference(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'false') return false;
    return true; // default on
  } catch {
    return true;
  }
}

interface ZhuyinContextValue {
  zhuyinEnabled: boolean;
  zhuyinReady: boolean;
  zhuyinActive: boolean;
  setZhuyinEnabled: (enabled: boolean) => void;
  toggleZhuyin: () => void;
  processZhuyin: (text: string) => string;
  processLines: (lines: string[]) => string[] | null;
}

const ZhuyinContext = createContext<ZhuyinContextValue>({
  zhuyinEnabled: true,
  zhuyinReady: false,
  zhuyinActive: false,
  setZhuyinEnabled: () => {},
  toggleZhuyin: () => {},
  processZhuyin: (t) => t,
  processLines: () => null,
});

export const ZhuyinProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [zhuyinEnabled, setZhuyinEnabledRaw] = useState(readStoredPreference);
  const [zhuyinReady, setZhuyinReady] = useState(() => PolyphonicProcessor.instance.isLoaded);

  const zhuyinActive = zhuyinReady && zhuyinEnabled;

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

  const setZhuyinEnabled = useCallback((enabled: boolean) => {
    setZhuyinEnabledRaw(enabled);
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // Storage full -- ignore
    }
  }, []);

  const toggleZhuyin = useCallback(() => {
    setZhuyinEnabledRaw((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  const processZhuyin = useCallback((text: string): string => {
    if (!(zhuyinReady && zhuyinEnabled)) return text;
    try {
      return buildZhuyinString(PolyphonicProcessor.instance.process(text));
    } catch {
      return text;
    }
  }, [zhuyinReady, zhuyinEnabled]);

  const processLines = useCallback((lines: string[]): string[] | null => {
    if (!(zhuyinReady && zhuyinEnabled)) return null;
    try {
      return lines.map((line) => buildZhuyinString(PolyphonicProcessor.instance.process(line)));
    } catch {
      return null;
    }
  }, [zhuyinReady, zhuyinEnabled]);

  return (
    <ZhuyinContext.Provider value={{
      zhuyinEnabled,
      zhuyinReady,
      zhuyinActive,
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
