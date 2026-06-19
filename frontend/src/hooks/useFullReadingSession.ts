/**
 * useFullReadingSession — STT/recording lifecycle for FullReading.
 *
 * Issue #1880: Extracted from FullReading.tsx to isolate STT complexity.
 * Issue #2266: Web Speech removed — Gemini STT is the sole speech engine.
 *
 * Manages:
 *   - audioRecorder (for Gemini transcription + student playback review)
 *   - isPreparing / isSessionActive states
 *   - micError state
 *   - submitReading: double-click guard (#1632), analyzeFluency, saveReadingHistory
 *   - onResultReady callback: parent receives (result, cleanedTranscript) to update UI
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { cleanChineseText } from '../utils/textDiff';
import { analyzeFluency } from '../utils/fluencyAnalyzer';
import { DiffToken } from '../types';
import { useAudioRecorder } from './useAudioRecorder';
import { cancelTts } from '../services/ttsApi';
import { saveReadingHistory } from '../services/readingHistoryApi';
import { transcribeReading } from '../services/learning/session';

export interface SavedResult {
  matchRate: number;
  feedback: string;
  diffTokens: DiffToken[];
  cpm: number;
  durationMs: number;
  errorBreakdown: { correct: number; wrong: number; missing: number; extra: number };
}

interface UseFullReadingSessionProps {
  fullText: string;
  token: string | null;
  storyId: string | number;
  /** DB LearningSession integer id — passed to /reading/transcribe so the backend can bind
   *  the uploaded audio blob to the correct ReadingAttemptHistory row (Issue #2266). */
  dbSessionId?: number | null;
  stopTtsAll: () => void;
  onResultReady: (result: SavedResult, transcript: string) => void;
}

interface UseFullReadingSessionReturn {
  isSessionActive: boolean;
  isPreparing: boolean;
  /** True while Gemini audio transcription is in progress (after stop, before result). */
  isTranscribing: boolean;
  streamingTranscript: string;
  setStreamingTranscript: (v: string) => void;
  micError: string;
  /**
   * Stub — always null since Web Speech fallback is removed (Issue #2266).
   * Kept for interface compatibility with FullReading.tsx.
   */
  fallbackReason: string | null;
  /** Stub — no-op since fallbackReason is always null. */
  clearFallbackReason: () => void;
  startSession: () => void;
  stopSession: () => void;
  /** P1#1: async — awaits stopAndGetBlob() before Gemini transcription. */
  submitReading: () => Promise<void>;
  audioRecorder: ReturnType<typeof useAudioRecorder>;
}

export function useFullReadingSession({
  fullText,
  token,
  storyId,
  dbSessionId,
  stopTtsAll,
  onResultReady,
}: UseFullReadingSessionProps): UseFullReadingSessionReturn {
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [streamingTranscript, setStreamingTranscript] = useState('');
  const [micError, setMicError] = useState('');

  // fallbackReason stub — always null since Web Speech fallback is removed (Issue #2266).
  const fallbackReason: string | null = null;
  const clearFallbackReason = useCallback(() => {}, []);

  const isSessionActiveRef = useRef(false);
  const startTimeRef       = useRef<number>(0);

  const audioRecorder = useAudioRecorder(120);

  /* ---- Cleanup on unmount ---- */
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(s => s.getTracks().forEach(t => t.stop()))
      .catch(() => {});
    return () => {
      isSessionActiveRef.current = false;
      cancelTts();
    };
  }, []);

  /* ---- Session start ---- */
  const startSession = useCallback(() => {
    if (isSessionActiveRef.current) return;
    stopTtsAll();
    setMicError('');

    // Immediately activate — no Web Speech handshake needed.
    startTimeRef.current = Date.now();
    isSessionActiveRef.current = true;
    setIsSessionActive(true);
    setIsPreparing(false);
    setStreamingTranscript('');

    audioRecorder.startRecording().catch(() => {});
  }, [stopTtsAll, audioRecorder]);

  const stopSession = useCallback(() => {
    isSessionActiveRef.current = false;
    setIsSessionActive(false);
    setIsPreparing(false);
    setStreamingTranscript('');
    // NOTE: audioRecorder.stopRecording() is intentionally NOT called here.
    // submitReading() calls stopAndGetBlob() which triggers stop + awaits onstop,
    // so it gets the final blob. stopSession() is also called from handleRetry
    // (no submit) — in that case clearRecording() handles cleanup.
  }, []);

  /* ---- Submit & evaluate ---- */
  const submitReading = useCallback(async () => {
    /* #1632 double-click guard: isSessionActiveRef is flipped synchronously. */
    if (!isSessionActiveRef.current) return;
    const durationMs = Date.now() - startTimeRef.current;
    stopSession();

    /* P1#2: stop recorder FIRST (before any early-return) so the mic is always
     * released and the final audio chunk is captured.
     * stopAndGetBlob() awaits onstop asynchronously (P1#1 fix). */
    const audioBlob = await audioRecorder.stopAndGetBlob();

    /* Early return when no audio blob — Gemini cannot transcribe without audio. */
    if (!audioBlob) {
      setMicError('未偵測到語音，請重試。');
      return;
    }

    /* --- Gemini audio transcription (Issue #2131 / #2156 / #2266) ---
     * NOTE: Real audio E2E requires a microphone — cannot be tested headless.
     *       The transcribeReading() wrapper is unit-tested with mocks (vitest). */

    const _evaluate = (finalTranscript: string) => {
      const fluency = analyzeFluency({
        spoken: cleanChineseText(finalTranscript),
        target: fullText,
        durationMs,
      });
      const newResult: SavedResult = {
        matchRate: fluency.accuracy,
        feedback: fluency.feedback,
        diffTokens: fluency.diffTokens,
        cpm: fluency.cpm,
        durationMs: fluency.durationMs,
        errorBreakdown: fluency.errorBreakdown,
      };
      onResultReady(newResult, cleanChineseText(finalTranscript));
      const durationSec = fluency.durationMs / 1000;
      if (token && durationSec > 0) {
        saveReadingHistory(
          {
            lesson_id: String(storyId),
            reading_type: 'full',
            cpm: fluency.cpm || 0,
            accuracy: Math.round((fluency.accuracy || 0) * 100),
            duration_seconds: durationSec,
          },
          token,
        ).catch((err) => console.error('Failed to save reading history:', err));
      }
    };

    if (token) {
      // I1: audio blob available → try Gemini.
      setIsTranscribing(true);
      transcribeReading(audioBlob, fullText, durationMs, token, dbSessionId ?? undefined)
        .then((result) => {
          setIsTranscribing(false);
          if (result.method === 'gemini' && result.transcript) {
            // Gemini success (I1): Gemini transcript is the sole scoring source.
            _evaluate(result.transcript);
          } else {
            // Gemini failed — cannot fall back to Web Speech (removed, Issue #2266).
            setMicError('辨識失敗，請重錄一次');
          }
        })
        .catch(() => {
          setIsTranscribing(false);
          setMicError('辨識失敗，請重錄一次');
        });
    } else {
      // No token — cannot reach Gemini.
      setMicError('未偵測到語音，請重試。');
    }
  }, [fullText, stopSession, token, storyId, onResultReady, audioRecorder.stopAndGetBlob]);

  return {
    isSessionActive,
    isPreparing,
    isTranscribing,
    streamingTranscript,
    setStreamingTranscript,
    micError,
    fallbackReason,
    clearFallbackReason,
    startSession,
    stopSession,
    submitReading,
    audioRecorder,
  };
}
