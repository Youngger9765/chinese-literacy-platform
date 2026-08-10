/**
 * useKeyPassageReadingResultPersistence — localStorage + DB history for KeyPassageReading.
 *
 * Issue #1880: Extracted from KeyPassageReading.tsx to isolate persistence concerns.
 *
 * Manages:
 *   - localStorage load (savedProgress) at init
 *   - getInitialResult priority: localStorage wins over DB initialResult prop
 *     (localStorage has diffTokens which DB may lack — Bug #1320)
 *   - localStorage persistence useEffect (result + transcript)
 *   - readingHistory fetch (for progress curve)
 *   - dedicatedHistory fetch (for ReadingMetricsCard #1505)
 */

import { useState, useRef, useEffect } from 'react';
import { DiffToken, KeyPassageReadingResult } from '../types';
import { getReadingHistory, type ReadingHistoryPoint } from '../services/learningApi';
import { getReadingHistory as getReadingHistoryDedicated, type ReadingHistoryItem } from '../services/readingHistoryApi';

export interface SavedResult {
  matchRate: number;
  feedback: string;
  diffTokens: DiffToken[];
  cpm: number;
  durationMs: number;
  errorBreakdown: { correct: number; wrong: number; missing: number; extra: number };
}

interface UseKeyPassageReadingResultPersistenceProps {
  storyId: string | number;
  token: string | null;
  userId: number | undefined;
  storageKey: string;
  /** Session-level result rehydrated from DB (Bug #1320 — fallback when localStorage is cleared). */
  initialResult?: KeyPassageReadingResult | null;
  /** Issue #2503: transcript rehydrated from DB step_data — fallback when localStorage
   *  is cleared (handleFinish removes it) so 你說的 doesn't vanish on remount. */
  initialTranscript?: string;
}

interface UseKeyPassageReadingResultPersistenceReturn {
  result: SavedResult | null;
  setResult: React.Dispatch<React.SetStateAction<SavedResult | null>>;
  streamingTranscript: string;
  setStreamingTranscript: React.Dispatch<React.SetStateAction<string>>;
  readingHistory: ReadingHistoryPoint[];
  dedicatedHistory: ReadingHistoryItem[];
  historyRefreshKey: number;
  setHistoryRefreshKey: React.Dispatch<React.SetStateAction<number>>;
}

export function useKeyPassageReadingResultPersistence({
  storyId,
  token,
  userId,
  storageKey,
  initialResult,
  initialTranscript,
}: UseKeyPassageReadingResultPersistenceProps): UseKeyPassageReadingResultPersistenceReturn {
  /* ---- Bug #1320 Bug 3: Derive initial result priority:
   *   1. localStorage (same-browser persistence, most complete — has diffTokens)
   *   2. session.fullReadingResult rehydrated from DB (cross-browser / cleared localStorage)
   *   localStorage wins because it contains diffTokens which the DB result may lack. ---- */
  const loadSaved = (): { result: SavedResult; transcript: string } | null => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  };
  const savedProgress = useRef(loadSaved());

  const getInitialResult = (): SavedResult | null => {
    if (savedProgress.current?.result) return savedProgress.current.result;
    if (initialResult) {
      return {
        matchRate: initialResult.matchRate,
        feedback: initialResult.feedback,
        diffTokens: initialResult.diffTokens ?? [],
        cpm: initialResult.cpm ?? 0,
        durationMs: initialResult.durationMs ?? 0,
        errorBreakdown: initialResult.errorBreakdown ?? { correct: 0, wrong: 0, missing: 0, extra: 0 },
      };
    }
    return null;
  };

  const [result, setResult] = useState<SavedResult | null>(getInitialResult);
  const [streamingTranscript, setStreamingTranscript] = useState(
    // Issue #2503: localStorage wins (most recent), else DB step_data transcript,
    // so 你說的 survives handleFinish's localStorage clear + remount.
    () => savedProgress.current?.transcript ?? initialTranscript ?? ''
  );
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  /* ---- localStorage persistence ---- */
  useEffect(() => {
    if (!result) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ result, transcript: streamingTranscript }));
    } catch {}
  }, [result, streamingTranscript, storageKey]);

  /* ---- Reading history for progress curve ---- */
  const [readingHistory, setReadingHistory] = useState<ReadingHistoryPoint[]>([]);
  useEffect(() => {
    if (!token || !storyId) return;
    getReadingHistory(token, String(storyId)).then(setReadingHistory).catch(() => {});
  }, [token, storyId, historyRefreshKey]);

  /* ---- Dedicated reading history for metrics card (#1505) ---- */
  const [dedicatedHistory, setDedicatedHistory] = useState<ReadingHistoryItem[]>([]);
  useEffect(() => {
    if (!token || !userId || !storyId) return;
    getReadingHistoryDedicated(userId, String(storyId), token, 'full')
      .then(res => setDedicatedHistory(res.history))
      .catch(() => {});
  }, [token, userId, storyId, historyRefreshKey]);

  return {
    result,
    setResult,
    streamingTranscript,
    setStreamingTranscript,
    readingHistory,
    dedicatedHistory,
    historyRefreshKey,
    setHistoryRefreshKey,
  };
}
