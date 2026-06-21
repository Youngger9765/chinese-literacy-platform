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
import { transcribeReading, saveReadingAudio } from '../services/learning/session';

/**
 * Issue #2321 — Silence gate constants.
 *
 * SILENT_PEAK_THRESHOLD: peak volume (0-1) below which we consider the recording
 * silent.  The AnalyserNode returns average byte frequency; 0.05 corresponds to
 * ~6.4/128 — well below conversational speech (~0.15-0.4) but above true silence.
 * Conservative: a very soft whisper may still exceed this threshold, which is
 * intentional — we prefer the occasional STT hallucination over blocking a
 * real-but-quiet reader.
 *
 * SILENT_MIN_DURATION_MS: minimum recording duration below which we skip STT.
 * 1 500 ms is comfortably longer than an accidental tap but shorter than even
 * a single Chinese syllable at slow reading speed (~300-400 ms).
 */
const SILENT_PEAK_THRESHOLD = 0.05;   // gate: peak volume must exceed this
const SILENT_MIN_DURATION_MS = 1500;  // gate: recording must be at least 1.5 s

/**
 * Issue #2321 — Hallucination sanity gate for FullReading scoring.
 *
 * The backend's transcription-layer and scoring-layer guards catch hallucinations
 * server-side (and return method='fallback' or 0 score).  This client-side guard
 * is an extra layer of defence: if somehow a hallucinated transcript escapes both
 * backend gates, we detect it here before calling analyzeFluency.
 *
 * Same logic as backend _is_hallucination_prefix:
 *   1. Normalised transcript length < 35 % of normalised target length
 *   2. ≥ 90 % of transcript chars match target opening chars
 *
 * If both hold → treat the same as no-speech (show retry error, do not score).
 */
const HALLUCINATION_LENGTH_RATIO = 0.35;   // transcript < 35% of target → suspect
const HALLUCINATION_PREFIX_MATCH = 0.90;   // ≥ 90% of chars match target prefix

function normaliseForHallucinationCheck(text: string): string {
  // Strip CJK punctuation and whitespace — mirrors backend _strip_cjk_punctuation.
  // Intentionally not the same as normalizeForComparison (scoring) to keep the
  // two functions independent and avoid accidental coupling.
  return text.replace(/[\s　、-〿＀-￯‘-‟…。，！？；：、─—…「」『』（）]/gu, '');
}

function isHallucinationTranscript(transcript: string, target: string): boolean {
  const tNorm = normaliseForHallucinationCheck(transcript);
  const tgtNorm = normaliseForHallucinationCheck(target);
  const tLen = tNorm.length;
  const tgtLen = tgtNorm.length;
  if (tgtLen === 0 || tLen === 0) return false;
  // Condition 1: suspiciously short
  if (tLen >= HALLUCINATION_LENGTH_RATIO * tgtLen) return false;
  // Condition 2: near-exact prefix match
  const prefix = tgtNorm.slice(0, tLen);
  let matches = 0;
  for (let i = 0; i < tLen; i++) {
    if (tNorm[i] === prefix[i]) matches++;
  }
  return matches / tLen >= HALLUCINATION_PREFIX_MATCH;
}

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

    /* Issue #2321 — Silence gate (Gate 1, frontend):
     * If the recording was too short OR entirely silent, skip STT to prevent
     * Gemini from hallucinating the lesson text back when given a blank audio.
     * Uses peakVolume tracked by useAudioRecorder's AnalyserNode loop.
     * Reuses the existing micError path — no new UI component needed. */
    const peakVolume = audioRecorder.getPeakVolume();
    const isSilentByVolume = peakVolume < SILENT_PEAK_THRESHOLD;
    const isTooShort = durationMs < SILENT_MIN_DURATION_MS;
    if (isSilentByVolume || isTooShort) {
      setMicError('未偵測到語音，請重試。');
      return;
    }

    /* --- Gemini audio transcription (Issue #2131 / #2156 / #2266) ---
     * NOTE: Real audio E2E requires a microphone — cannot be tested headless.
     *       The transcribeReading() wrapper is unit-tested with mocks (vitest). */

    const _evaluate = (finalTranscript: string, capturedAudioBlob: Blob) => {
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

      // Issue #2297: upload audio AFTER score is returned to UI (deferred upload).
      // Fail-safe: .catch() ensures upload failure never affects score display.
      if (token && dbSessionId != null) {
        saveReadingAudio(capturedAudioBlob, dbSessionId, undefined, token)
          .catch((err) => console.warn('[FullReading] saveReadingAudio error:', err));
      }

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
      // Issue #2297: no longer pass session_id to transcribeReading — upload is
      // deferred to saveReadingAudio called inside _evaluate after score is ready.
      transcribeReading(audioBlob, fullText, durationMs, token)
        .then((result) => {
          setIsTranscribing(false);
          if (result.method === 'gemini' && result.transcript) {
            // Issue #2321 — Hallucination guard (client-side defence layer 3).
            // Backend already has two guards (transcription + scoring layer).
            // This client-side check catches any hallucinated transcripts that
            // escaped both backend gates — treating them as no-speech.
            if (isHallucinationTranscript(result.transcript, fullText)) {
              setIsTranscribing(false);
              setMicError('未偵測到語音，請重試。');
              return;
            }
            // Gemini success (I1): Gemini transcript is the sole scoring source.
            _evaluate(result.transcript, audioBlob);
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
  }, [fullText, stopSession, token, storyId, dbSessionId, onResultReady, audioRecorder.stopAndGetBlob, audioRecorder.getPeakVolume]);

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
