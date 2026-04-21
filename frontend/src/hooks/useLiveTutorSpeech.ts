import React, { useState, useRef } from 'react';
import { cleanChineseText, diffCharacters } from '../utils/textDiff';
import { DiffToken } from '../types';
import {
  localEvaluateParagraph,
  type LocalEvalResult,
} from '../utils/localEval';
import { cancelTts } from '../services/ttsApi';
import { TIER1_POOL, TIER2_POOL, TIER3_POOL, STREAK_MESSAGES } from '../utils/liveTutorPools';
import { buildRealtimeOverlay } from '../utils/liveTutorHelpers';

/**
 * Manages the Web Speech API continuous-recognition session used by LiveTutor.
 *
 * Responsibilities:
 *  - SpeechRecognition instantiation (cmn-Hant-TW, continuous, interimResults)
 *  - Auto-reconnect on browser/API timeout (seamless — accumulates transcript)
 *  - Per-sentence isFinal tracking ("分期付款" local eval)
 *  - Real-time LCS diff overlay with 400 ms throttle + highwater-mark ratchet
 *  - Speaking-progress cursor updates
 *  - Exposes startSession / submitSentence / stopSession
 */
export interface UseLiveTutorSpeechOptions {
  /** BCP-47 language tag — default "cmn-Hant-TW" */
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
  /** Called by recognition.onstart (first time only) to add "準備好了" message */
  onSessionReady: () => void;
  /** Called when no STT audio detected within noAudioTimeoutMs after session starts (#1174) */
  onNoAudioDetected?: () => void;
  /** Timeout (ms) before onNoAudioDetected fires. Default 5000. (#1174) */
  noAudioTimeoutMs?: number;
}

export function useLiveTutorSpeech({
  lang = 'cmn-Hant-TW',
  targetText,
  streakRef,
  sentenceTargetsRef,
  sentenceResultsRef,
  lastFinalResultIdxRef,
  nextSentenceIdxRef,
  sentenceStartTimeRef,
  lastDiffTimeRef,
  utteranceRef,
  ttsRafRef,
  onStreamingTranscript,
  onRealtimeDiffTokens,
  onSpeakingProgress,
  onLastDiffTokens,
  onMicError,
  onClearTts,
  onSessionReady,
  onNoAudioDetected,
  noAudioTimeoutMs = 5000,
}: UseLiveTutorSpeechOptions) {
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);

  const recognitionRef = useRef<any>(null);
  const isSessionActiveRef = useRef(false);
  const currentTranscriptRef = useRef('');
  const rawSttRef = useRef('');
  const accumulatedTranscriptRef = useRef('');
  // Reconnect error tracking — stop after repeated failures
  const consecutiveErrorsRef = useRef(0);
  const MAX_CONSECUTIVE_ERRORS = 3;
  // Mirror of targetText for use inside async recognition callbacks
  const targetTextRef = useRef(targetText);
  targetTextRef.current = targetText;

  // No-audio-detected timer (#1174): fires onNoAudioDetected if no STT result
  // arrives within noAudioTimeoutMs after session starts.
  const noAudioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearNoAudioTimer = () => {
    if (noAudioTimerRef.current !== null) {
      clearTimeout(noAudioTimerRef.current);
      noAudioTimerRef.current = null;
    }
  };

  const startSession = () => {
    if (isSessionActiveRef.current) return;

    // Null out TTS callbacks before cancel() so any async onend/onerror from
    // the previous utterance cannot stomp on the STT cursor position.
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

    setIsPreparing(true);
    onMicError('');

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      onMicError('您的瀏覽器不支援語音辨識，請使用 Chrome 瀏覽器。');
      setIsPreparing(false);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.continuous = true;       // KEEP listening — never cut off on pauses
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsPreparing(false);
      if (!isSessionActiveRef.current) {
        // First start — set accurate sentence timer & show "ready" signal
        sentenceStartTimeRef.current = Date.now();
        isSessionActiveRef.current = true;
        setIsSessionActive(true);
        onSessionReady();
      }
      // Successful start doesn't reset error counter — only actual speech results do

      // Start no-audio-detected timer (#1174)
      if (onNoAudioDetected) {
        clearNoAudioTimer();
        noAudioTimerRef.current = setTimeout(() => {
          if (isSessionActiveRef.current && !currentTranscriptRef.current) {
            onNoAudioDetected();
          }
        }, noAudioTimeoutMs);
      }
    };

    recognition.onresult = (event: any) => {
      // Got actual speech — reset error counter and clear no-audio timer (#1174)
      consecutiveErrorsRef.current = 0;
      clearNoAudioTimer();
      // Build transcript from this recognition session's results
      let sessionTranscript = '';
      for (let i = 0; i < event.results.length; i++) {
        sessionTranscript += event.results[i][0].transcript;
      }
      // Combine with transcript accumulated from previous sessions (auto-reconnects)
      const fullTranscript = accumulatedTranscriptRef.current + sessionTranscript;
      rawSttRef.current = fullTranscript;
      currentTranscriptRef.current = fullTranscript;
      onStreamingTranscript(cleanChineseText(fullTranscript));

      // Real-time LCS diff overlay: compare full transcript against target
      // Throttle: only recompute on isFinal events OR if 400ms has elapsed since last diff.
      const isFinalEvent =
        event.results.length > 0 && event.results[event.results.length - 1].isFinal;
      const now = Date.now();
      let overlayTokens: ReturnType<typeof buildRealtimeOverlay> | null = null;
      if (isFinalEvent || now - lastDiffTimeRef.current >= 400) {
        lastDiffTimeRef.current = now;
        const rawDiff = diffCharacters(fullTranscript, targetTextRef.current, { useHomophone: true });
        overlayTokens = buildRealtimeOverlay(rawDiff.tokens);
      }

      // Highwater mark: once a char is correct/wrong/forgiven, never revert to unread.
      if (overlayTokens !== null) {
        const committedTokens = overlayTokens;
        onRealtimeDiffTokens(prev => {
          if (!prev) return committedTokens;
          return committedTokens.map((t, i) => {
            const old = prev[i];
            if (!old) return t;
            if (old.type !== 'unread' && t.type === 'unread') return old;
            return t;
          });
        });
        const readChars = committedTokens.filter(t => t.type !== 'unread').length;
        onSpeakingProgress(prev => Math.max(prev, readChars));
      }

      // ── 分期付款: per-sentence local eval on isFinal events ────────────────
      for (let i = lastFinalResultIdxRef.current + 1; i < event.results.length; i++) {
        if (!event.results[i].isFinal) break;
        lastFinalResultIdxRef.current = i;
        const sentIdx = nextSentenceIdxRef.current;
        const sentTargets = sentenceTargetsRef.current;
        if (sentIdx >= sentTargets.length) continue;

        const chunk = event.results[i][0].transcript;
        const sentTarget = sentTargets[sentIdx];
        const elapsed = Math.max(Date.now() - sentenceStartTimeRef.current, 500);
        const localResult = localEvaluateParagraph(
          chunk, sentTarget, elapsed,
          { tier1: TIER1_POOL, tier2: TIER2_POOL, tier3: TIER3_POOL, streakMsgs: STREAK_MESSAGES },
          streakRef.current,
        );
        sentenceResultsRef.current[sentIdx] = localResult;
        nextSentenceIdxRef.current = sentIdx + 1;
        onLastDiffTokens(prev =>
          prev ? [...prev, ...localResult.diffTokens] : localResult.diffTokens
        );
      }
    };

    recognition.onerror = (event: any) => {
      console.warn('[STT] onerror:', event.error, '| sessionActive:', isSessionActiveRef.current);
      if (event.error === 'not-allowed') {
        onMicError('請允許麥克風權限後再試一次。');
        isSessionActiveRef.current = false;
        setIsSessionActive(false);
        setIsPreparing(false);
      } else if (event.error === 'audio-capture') {
        onMicError('找不到麥克風，請確認麥克風已連接後再試一次。');
        isSessionActiveRef.current = false;
        setIsSessionActive(false);
        setIsPreparing(false);
      } else if (event.error === 'network') {
        consecutiveErrorsRef.current += 1;
        if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
          console.error('[STT] Too many network errors, stopping session');
          onMicError('語音辨識連線失敗，請檢查網路後再試一次。');
          isSessionActiveRef.current = false;
          setIsSessionActive(false);
          setIsPreparing(false);
        }
      }
      // Other errors (no-speech, aborted) → onend will handle reconnect
    };

    recognition.onend = () => {
      console.log('[STT] onend | sessionActive:', isSessionActiveRef.current, '| accumulated:', accumulatedTranscriptRef.current.slice(-20));
      if (isSessionActiveRef.current) {
        // Browser/API timed out — seamlessly reconnect.
        accumulatedTranscriptRef.current = currentTranscriptRef.current;
        lastFinalResultIdxRef.current = -1;
        setTimeout(() => {
          if (!isSessionActiveRef.current) return;
          console.log('[STT] reconnecting… accumulated now:', accumulatedTranscriptRef.current.slice(-20));
          try {
            recognition.start();
            console.log('[STT] reconnect start() OK');
          } catch (err) {
            console.error('[STT] reconnect start() FAILED — cursor will freeze!', err);
          }
        }, 150);
      } else {
        // Session fully ended
        setIsSessionActive(false);
        setIsPreparing(false);
        recognitionRef.current = null;
      }
    };

    recognitionRef.current = recognition;
    currentTranscriptRef.current = '';
    rawSttRef.current = '';
    accumulatedTranscriptRef.current = '';
    consecutiveErrorsRef.current = 0;
    onStreamingTranscript('');
    onSpeakingProgress(() => 0);
    onRealtimeDiffTokens(() => null);

    recognition.start();
  };

  /**
   * Submit the current sentence for evaluation. Recognition keeps running.
   * Returns { transcript, rawStt, durationMs } so the caller can run hybrid eval.
   */
  const submitSentence = (): { transcript: string; rawStt: string; durationMs: number } => {
    const transcript = currentTranscriptRef.current;
    const rawStt = rawSttRef.current;
    const durationMs = Date.now() - sentenceStartTimeRef.current;

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (_) {}
      currentTranscriptRef.current = '';
      rawSttRef.current = '';
      accumulatedTranscriptRef.current = '';
      onStreamingTranscript('');
      onLastDiffTokens(() => null);
      sentenceStartTimeRef.current = Date.now();
      clearNoAudioTimer();
      if (isSessionActiveRef.current) {
        try { recognitionRef.current.start(); } catch (_) {}
      }
    }

    return { transcript, rawStt, durationMs };
  };

  /** Stop the entire session (for navigation / story switching / finishing). */
  const stopSession = () => {
    isSessionActiveRef.current = false;
    setIsSessionActive(false);
    setIsPreparing(false);
    clearNoAudioTimer();
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (_) {}
      recognitionRef.current = null;
    }
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
