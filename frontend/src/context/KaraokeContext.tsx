/**
 * KaraokeContext -- global karaoke (KTV-style char highlight) toggle state.
 *
 * Controls whether TTS playback shows a scrolling char-by-char highlight
 * effect (the "KTV" or "karaoke" follow-along animation).
 *
 * Manages:
 *   - karaokeEnabled  -- user preference (persisted in localStorage)
 *   - toggleKaraoke   -- flip the preference
 *   - setKaraokeEnabled -- explicit setter
 *
 * Pattern mirrors ZhuyinContext so the two toggles behave consistently.
 * Default: OFF (false) — following 5/1 expert review feedback.
 *
 * Components that drive the highlight (ParagraphCard, KeyPassageReading) gate
 * the split-span render on `karaokeEnabled`. When off, plain text is shown
 * and the TTS audio plays normally without visual animation.
 */

import React, { createContext, useContext, useState, useCallback } from 'react';

const STORAGE_KEY = 'karaoke_enabled';

function readStoredPreference(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Explicit 'true' opt-in; everything else (null / 'false') → off
    return raw === 'true';
  } catch {
    return false; // default off
  }
}

interface KaraokeContextValue {
  karaokeEnabled: boolean;
  setKaraokeEnabled: (enabled: boolean) => void;
  toggleKaraoke: () => void;
}

const KaraokeContext = createContext<KaraokeContextValue>({
  karaokeEnabled: false,
  setKaraokeEnabled: () => {},
  toggleKaraoke: () => {},
});

export const KaraokeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [karaokeEnabled, setKaraokeEnabledRaw] = useState(readStoredPreference);

  const setKaraokeEnabled = useCallback((enabled: boolean) => {
    setKaraokeEnabledRaw(enabled);
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // Storage full -- ignore
    }
  }, []);

  const toggleKaraoke = useCallback(() => {
    setKaraokeEnabledRaw((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  }, []);

  return (
    <KaraokeContext.Provider value={{ karaokeEnabled, setKaraokeEnabled, toggleKaraoke }}>
      {children}
    </KaraokeContext.Provider>
  );
};

export function useKaraoke(): KaraokeContextValue {
  return useContext(KaraokeContext);
}
