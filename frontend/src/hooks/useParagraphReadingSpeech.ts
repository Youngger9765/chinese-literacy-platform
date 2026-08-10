// Web Speech removed (Issue #2266) — Gemini STT is the sole speech engine.

import React, { useState, useRef } from 'react';
import { DiffToken } from '../types';
import {
  type LocalEvalResult,
} from '../utils/localEval';
import { cancelTts } from '../services/ttsApi';

/**
 * Stub replacement for the former Web Speech API session used by ParagraphReading.
 *
 * All Web Speech / SpeechRecognition code has been removed (Issue #2266).
 * Gemini STT (via paragraphRecorder + transcribeReading) is the sole speech engine.
 *
 * The interface is kept identical so ParagraphReading.tsx requires no changes.
 */
export interface UseParagraphReadingSpeechOptions {
  /** BCP-47 language tag — kept for interface compatibility (unused) */
  lang?: string;
  /** Current story paragraph text (used for real-time diff overlay) */
  targetText: string;
  /** Streak ref value (read by per-sentence local eval) */
  streakRef: React.MutableRefObject<number>;
  /** Sentence targets for current paragraph (updated by caller on paragraph change) */
  sentenceTargetsRef: React.MutableRefObject<string[]>;
  /** Sentence results array (mutated by this hook on isFinal events) */
  sentenceResultsRef: React.MutableRefObject<Array<LocalEvalResult | null>>;
  /** Ref tracking index of last isFinal result consumed */
  lastFinalResultIdxRef: React.MutableRefObject<number>;
  /** Ref tracking next sentence index to evaluate */
  nextSentenceIdxRef: React.MutableRefObject<number>;
  /** Ref storing sentence start timestamp */
  sentenceStartTimeRef: React.MutableRefObject<number>;
  /** Ref for throttling diff computation */
  lastDiffTimeRef: React.MutableRefObject<number>;
  /** Utterance ref — nulled out + TTS stopped by startSession */
  utteranceRef: React.MutableRefObject<SpeechSynthesisUtterance | HTMLAudioElement | null>;
  /** rAF ref — cancelled by startSession */
  ttsRafRef: React.MutableRefObject<number | null>;
  /** Callbacks */
  onStreamingTranscript: (text: string) => void;
  onRealtimeDiffTokens: (updater: (prev: DiffToken[] | null) => DiffToken[] | null) => void;
  onSpeakingProgress: (updater: (prev: number) => number) => void;
  onLastDiffTokens: (updater: (prev: DiffToken[] | null) => DiffToken[] | null) => void;
  onMicError: (msg: string) => void;
  /** Called when TTS needs to be stopped (startSession clears TTS before starting STT) */
  onClearTts: () => void;
  /** Called when session is ready (immediately after TTS is cleared) */
  onSessionReady: () => void;
  /** Kept for interface compatibility — not used since Web Speech timer is removed. */
  onNoAudioDetected?: () => void;
  /** Kept for interface compatibility — not used. */
  noAudioTimeoutMs?: number;
}

export function useParagraphReadingSpeech({
  sentenceStartTimeRef,
  utteranceRef,
  ttsRafRef,
  onStreamingTranscript,
  onRealtimeDiffTokens,
  onSpeakingProgress,
  onMicError,
  onClearTts,
  onSessionReady,
}: UseParagraphReadingSpeechOptions) {
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);

  // Refs kept for interface compatibility (zero-valued — Web Speech removed)
  const recognitionRef = useRef<any>(null);
  const isSessionActiveRef = useRef(false);
  const currentTranscriptRef = useRef('');
  const rawSttRef = useRef('');
  const accumulatedTranscriptRef = useRef('');

  const startSession = () => {
    if (isSessionActiveRef.current) return;

    // Null out TTS callbacks before cancel() so any async onend/onerror from
    // the previous utterance cannot stomp on cursor state.
    if (utteranceRef.current) {
      const cur = utteranceRef.current;
      if (cur instanceof HTMLAudioElement) {
        cur.onended = null;
        cur.onerror = null;
        cur.pause();
      } else {
        (cur as SpeechSynthesisUtterance).onstart = null;
        (cur as SpeechSynthesisUtterance).onboundary = null;
        (cur as SpeechSynthesisUtterance).onend = null;
        (cur as SpeechSynthesisUtterance).onerror = null;
      }
      utteranceRef.current = null;
    }
    if (ttsRafRef.current !== null) {
      cancelAnimationFrame(ttsRafRef.current);
      ttsRafRef.current = null;
    }
    cancelTts();
    onClearTts();

    onMicError('');

    // Immediately activate session — no Web Speech handshake needed.
    sentenceStartTimeRef.current = Date.now();
    isSessionActiveRef.current = true;
    setIsSessionActive(true);
    onSessionReady();
    setIsPreparing(false);
  };

  /**
   * Submit the current sentence for evaluation. Recognition keeps running.
   * Returns { transcript, rawStt, durationMs } so the caller can run hybrid eval.
   * With Web Speech removed, transcript/rawStt are always '' — Gemini STT provides
   * the actual transcript via paragraphRecorder + transcribeReading.
   */
  const submitSentence = (): { transcript: string; rawStt: string; durationMs: number } => {
    const durationMs = Date.now() - sentenceStartTimeRef.current;

    currentTranscriptRef.current = '';
    rawSttRef.current = '';
    accumulatedTranscriptRef.current = '';
    onStreamingTranscript('');
    onRealtimeDiffTokens(() => null);
    sentenceStartTimeRef.current = Date.now();

    return { transcript: '', rawStt: '', durationMs };
  };

  /** Stop the entire session (for navigation / story switching / finishing). */
  const stopSession = () => {
    isSessionActiveRef.current = false;
    setIsSessionActive(false);
    setIsPreparing(false);
    recognitionRef.current = null;
    currentTranscriptRef.current = '';
    rawSttRef.current = '';
    accumulatedTranscriptRef.current = '';
    onStreamingTranscript('');
    onSpeakingProgress(() => 0);
    onRealtimeDiffTokens(() => null);
  };

  return {
    isPreparing,
    isSessionActive,
    isSessionActiveRef,
    recognitionRef,
    currentTranscriptRef,
    rawSttRef,
    accumulatedTranscriptRef,
    startSession,
    submitSentence,
    stopSession,
  };
}
