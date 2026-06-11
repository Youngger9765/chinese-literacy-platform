/**
 * useFullReadingSession — STT/recording lifecycle for FullReading.
 *
 * Issue #1880: Extracted from FullReading.tsx to isolate STT complexity.
 *
 * Manages:
 *   - SpeechRecognition lifecycle (start/stop/restart on onend)
 *   - audioRecorder (for student playback review)
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
   * Fallback alert state (I4 — must alert, never silent).
   * Set when Gemini transcription fails so FullReading can show a banner.
   * Values: 'timeout' | 'safety' | 'decode' | 'empty' | 'error' | null
   */
  fallbackReason: string | null;
  /** Clear fallback alert (e.g. on retry). */
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
  stopTtsAll,
  onResultReady,
}: UseFullReadingSessionProps): UseFullReadingSessionReturn {
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [streamingTranscript, setStreamingTranscript] = useState('');
  const [micError, setMicError] = useState('');
  /** I4: fallback alert reason — non-null when Gemini failed and UI must warn user */
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const clearFallbackReason = useCallback(() => setFallbackReason(null), []);

  const isSessionActiveRef       = useRef(false);
  const recognitionRef           = useRef<any>(null);
  const currentTranscriptRef     = useRef('');
  const accumulatedTranscriptRef = useRef('');
  const startTimeRef             = useRef<number>(0);

  const audioRecorder = useAudioRecorder(120);

  /* ---- Cleanup on unmount ---- */
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(s => s.getTracks().forEach(t => t.stop()))
      .catch(() => {});
    return () => {
      isSessionActiveRef.current = false;
      if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch (_) {} }
      cancelTts();
    };
  }, []);

  /* ---- STT ---- */
  const startSession = useCallback(() => {
    if (isSessionActiveRef.current) return;
    stopTtsAll();
    setIsPreparing(true);
    setMicError('');

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicError('您的瀏覽器不支援語音辨識，請使用 Chrome 瀏覽器。');
      setIsPreparing(false); return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'cmn-Hant-TW';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsPreparing(false);
      if (!isSessionActiveRef.current) {
        startTimeRef.current = Date.now();
        isSessionActiveRef.current = true;
        setIsSessionActive(true);
      }
    };

    recognition.onresult = (event: any) => {
      let sessionTranscript = '';
      for (let i = 0; i < event.results.length; i++) sessionTranscript += event.results[i][0].transcript;
      const full = accumulatedTranscriptRef.current + sessionTranscript;
      currentTranscriptRef.current = full;
      // Keep raw cleaned transcript in state — display enhancement happens in FullReading.tsx (Issue #2147)
      setStreamingTranscript(cleanChineseText(full));
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        setMicError('請允許麥克風權限後再試一次。');
        isSessionActiveRef.current = false; setIsSessionActive(false); setIsPreparing(false);
      } else if (event.error === 'audio-capture') {
        setMicError('找不到麥克風，請確認麥克風已連接後再試一次。');
        isSessionActiveRef.current = false; setIsSessionActive(false); setIsPreparing(false);
      }
    };

    recognition.onend = () => {
      if (isSessionActiveRef.current) {
        accumulatedTranscriptRef.current = currentTranscriptRef.current;
        try { recognition.start(); } catch (_) {}
      } else {
        setIsSessionActive(false); setIsPreparing(false); recognitionRef.current = null;
      }
    };

    recognitionRef.current = recognition;
    currentTranscriptRef.current = '';
    accumulatedTranscriptRef.current = '';
    setStreamingTranscript('');
    recognition.start();
    audioRecorder.startRecording().catch(() => {});
  }, [stopTtsAll, audioRecorder]);

  const stopSession = useCallback(() => {
    isSessionActiveRef.current = false;
    setIsSessionActive(false); setIsPreparing(false);
    if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch (_) {} recognitionRef.current = null; }
    currentTranscriptRef.current = '';
    accumulatedTranscriptRef.current = '';
    setStreamingTranscript('');
    // NOTE: audioRecorder.stopRecording() is intentionally NOT called here.
    // submitReading() calls stopAndGetBlob() which triggers stop + awaits onstop,
    // so it gets the final blob.  stopSession() is also called from handleRetry
    // (no submit) — in that case clearRecording() handles cleanup.
  }, []);

  /* ---- Submit & evaluate ---- */
  const submitReading = useCallback(async () => {
    /* #1632 double-click guard: isSessionActiveRef is flipped synchronously. */
    if (!isSessionActiveRef.current) return;
    const webSpeechTranscript = currentTranscriptRef.current;
    const durationMs = Date.now() - startTimeRef.current;
    stopSession();

    /* P1#2: stop recorder FIRST (before any early-return) so the mic is always
     * released and the final audio chunk is captured.  Even if Web Speech is empty,
     * Gemini may succeed (I1 — audio primary).
     * stopAndGetBlob() awaits onstop asynchronously (P1#1 fix). */
    const audioBlob = await audioRecorder.stopAndGetBlob();

    /* Early return ONLY when both sources are silent — otherwise Gemini gets a chance. */
    if (!webSpeechTranscript.trim() && !audioBlob) {
      setMicError('未偵測到語音，請再試一次。');
      return;
    }

    /* --- Gemini audio transcription (Issue #2131 / #2156) ---
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

    if (audioBlob && token) {
      // I1: audio blob available → try Gemini regardless of Web Speech content.
      setIsTranscribing(true);
      transcribeReading(audioBlob, fullText, durationMs, token)
        .then((result) => {
          setIsTranscribing(false);
          if (result.method === 'gemini' && result.transcript) {
            // Gemini success (I1): Gemini transcript is the sole scoring source.
            clearFallbackReason();
            _evaluate(result.transcript);
          } else {
            // I4: Gemini fallback — must alert, score with Web Speech (non-empty) or bail.
            setFallbackReason(result.reason ?? 'error');
            if (webSpeechTranscript.trim()) {
              _evaluate(webSpeechTranscript);
            } else {
              // Both sources empty — show mic error instead of scoring 0%.
              setMicError('未偵測到語音，請再試一次。');
            }
          }
        })
        .catch(() => {
          setIsTranscribing(false);
          setFallbackReason('error');
          if (webSpeechTranscript.trim()) {
            _evaluate(webSpeechTranscript);
          } else {
            setMicError('未偵測到語音，請再試一次。');
          }
        });
    } else {
      // I4: No audio blob or no token — cannot reach Gemini.  Alert + Web Speech fallback.
      setFallbackReason('no_audio');
      // webSpeechTranscript is non-empty here (ensured by early-return above).
      _evaluate(webSpeechTranscript);
    }
  }, [fullText, stopSession, token, storyId, onResultReady, audioRecorder.stopAndGetBlob, clearFallbackReason]);

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
