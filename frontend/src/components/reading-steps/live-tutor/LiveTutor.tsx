import React, { useState, useEffect, useRef, useCallback, useMemo, useReducer } from 'react';
import { Story, ReadingAttempt } from '../../../types';
import { useZhuyin } from '../../../context/ZhuyinContext';
import { useFontSize } from '../../ui/FontSizeControl';
import { cancelTts } from '../../../services/ttsApi';
import { scopedStepStorageKey, isToolboxMode } from '../../../services/learningStorageScope';
import { useLiveTutorSpeech } from '../../../hooks/useLiveTutorSpeech';
import { useTtsPlayback } from '../../../hooks/useTtsPlayback';
import { useAudioRecorder } from '../../../hooks/useAudioRecorder';
import { transcribeReading } from '../../../services/learning/session';
import { useAuth } from '../../../contexts/AuthContext';
import { splitIntoSentences } from '../../../utils/localEval';
import { normalizePunctuationToChinese } from '../../../utils/textDiff';
import ToolboxCompletionActions from '../../tools/ToolboxCompletionActions';
import ReadingMetricsCard from '../full-reading/ReadingMetricsCard';
import { fontForZhuyin } from '../../../constants/fonts';
import ParagraphCard from './ParagraphCard';
import { useLiveTutorProgress } from './hooks/useLiveTutorProgress';
import {
  useParagraphEvaluation,
  evalReducer,
  initialEvalState,
} from './hooks/useParagraphEvaluation';
import { useSentenceRetry } from './hooks/useSentenceRetry';
import LiveTutorControls from './LiveTutorControls';
import type { LocalEvalResult } from '../../../utils/localEval';
import type { RetrySentenceInfo } from './hooks/useSentenceRetry';

/* ------------------------------------------------------------------ */
/*  Small sub-components                                               */
/* ------------------------------------------------------------------ */

const NoAudioBanner: React.FC<{ onRestart: () => void }> = ({ onRestart }) => (
  <div className="absolute bottom-44 left-1/2 -translate-x-1/2 z-20 w-[min(92%,520px)]">
    <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-300 shadow-md">
      <span className="material-symbols-outlined text-amber-600 shrink-0">mic_off</span>
      <div className="flex-1">
        <p className="text-sm font-bold text-amber-800">好像沒有偵測到聲音</p>
        <p className="text-xs text-amber-700 mt-0.5">
          請確認麥克風權限已開啟、音量足夠，或點擊下方「重新開始」再試一次。
        </p>
      </div>
      <button
        onClick={onRestart}
        className="px-3 py-1 rounded-full text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 transition-all shrink-0"
      >
        重新開始
      </button>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Component props                                                    */
/* ------------------------------------------------------------------ */

interface LiveTutorProps {
  story: Story;
  rightPanelWidth: number;
  onPanelWidthChange: (w: number) => void;
  onFinish: (attempt: ReadingAttempt) => void;
  onCancel: () => void;
  /** Called each time a paragraph is completed (unlocked). */
  onParagraphComplete?: (completedParagraphIndex: number) => void;
  /** Initial set of completed paragraph indices (for session resume). */
  initialCompletedParagraphs?: Set<number>;
  /** Rehydrate from previously saved step_progress.step_data['tutor'] (Issue #1549). */
  initialProgress?: TutorStepData;
  /** Persist incremental progress to LearningSession.step_progress (Issue #1549). */
  onProgressChange?: (stepData: TutorStepData, immediate?: boolean) => void;
}

const LiveTutor: React.FC<LiveTutorProps> = ({
  story,
  rightPanelWidth: _rightPanelWidth,
  onPanelWidthChange: _onPanelWidthChange,
  onFinish,
  onCancel: _onCancel,
  onParagraphComplete,
  initialCompletedParagraphs,
  initialProgress,
  onProgressChange,
}) => {
  const { px: fontSizePx } = useFontSize();
  const { isZhuyinAny, processLinesSelective } = useZhuyin();
  const { token } = useAuth();
  const storageKey = scopedStepStorageKey('liveTutor_progress_', story.id);

  // ── Per-paragraph Gemini audio recorder (Issue #2156 — I1 / I4) ──────────
  // Records while the student reads each paragraph; stops on paragraph submit
  // so we can send the blob to /reading/transcribe for high-quality Gemini STT.
  const paragraphRecorder = useAudioRecorder(120);
  /** I4: fallback alert per paragraph — set when Gemini audio transcription fails */
  const [paragraphFallbackReason, setParagraphFallbackReason] = useState<string | null>(null);
  const clearParagraphFallback = useCallback(() => setParagraphFallbackReason(null), []);

  // ── P1: double-submit race guard (Issue #2156 Round 4) ───────────────────
  // confirmEvaluate is async (Gemini API). Lock prevents duplicate scoring.
  const isSubmittingSentenceRef = useRef(false);
  const [isSubmittingSentence, setIsSubmittingSentence] = useState(false);

  /** After 完成: paused recording awaiting 評估 or 重錄. */
  const [recordingPendingReview, setRecordingPendingReview] = useState(false);
  const pendingRecordingRef = useRef<{
    transcript: string;
    rawStt: string;
    durationMs: number;
    audioBlob: Blob | null;
  } | null>(null);
  const isFinishingRecordingRef = useRef(false);

  // ── Evaluation state machine ─────────────────────────────────────────────
  const [evalState, dispatch] = useReducer(evalReducer, initialEvalState);

  // ── Progress hook (paragraph/line navigation + lineResults) ─────────────
  const progress = useLiveTutorProgress(
    story,
    onFinish,
    onParagraphComplete,
    initialCompletedParagraphs,
  );

  const {
    currentLineIndex,
    setCurrentLineIndex,
    lineResults,
    setLineResults,
    completedParagraphs,
    paragraphSummaries,
    setParagraphSummaries,
    isAdvancing,
    celebratingIndex,
    toolboxComplete,
    lineStatuses,
    overallMetrics,
    advanceParagraph,
    handleSelectParagraph,
    handleFinish,
    resetForRetry,
  } = progress;

  // ── Sentence-level tracking refs (shared between hooks) ──────────────────
  const sentenceTargetsRef = useRef<string[]>([]);
  const sentenceResultsRef = useRef<Array<LocalEvalResult | null>>([]);
  const nextSentenceIdxRef = useRef(0);
  const lastFinalResultIdxRef = useRef(-1);
  const sentenceStartTimeRef = useRef(0);
  const lastDiffTimeRef = useRef(0);
  const streakRef = useRef(0);

  // ── TTS playback hook ────────────────────────────────────────────────────
  const {
    isTtsSpeaking,
    isTtsPaused,
    isTtsLoading,
    ttsError,
    setIsTtsSpeaking,
    setIsTtsPaused,
    utteranceRef,
    ttsRafRef,
    speakText,
    pauseTts,
    resumeTts,
    stopTts,
  } = useTtsPlayback(
    (_pos) => {},
    () => dispatch({ type: 'SET_REALTIME_DIFF', tokens: null }),
  );

  const speakCurrentParagraph = useCallback(() => {
    const text = story.content[currentLineIndex];
    if (!text) return;
    speakText(text, Number(story.id), currentLineIndex);
  }, [story.content, story.id, currentLineIndex, speakText]);

  // ── Retry sentence ref (needed by STT hook before useSentenceRetry called) ──
  const retrySentenceInfoRef = useRef<RetrySentenceInfo | null>(null);

  const sttTargetText = retrySentenceInfoRef.current
    ? retrySentenceInfoRef.current.target
    : story.content[currentLineIndex] || '';

  // ── UI state ─────────────────────────────────────────────────────────────
  const [noAudioDetected, setNoAudioDetected] = useState(false);
  const [hasDetectedAudio, setHasDetectedAudio] = useState(false);
  const [micError, setMicError] = useState('');

  // ── STT hook ─────────────────────────────────────────────────────────────
  const stt = useLiveTutorSpeech({
    targetText: sttTargetText,
    streakRef,
    sentenceTargetsRef,
    sentenceResultsRef,
    lastFinalResultIdxRef,
    nextSentenceIdxRef,
    sentenceStartTimeRef,
    lastDiffTimeRef,
    utteranceRef,
    ttsRafRef,
    onStreamingTranscript: (v) => dispatch({ type: 'SET_STREAMING', value: v }),
    onRealtimeDiffTokens: (_updater) => {
      // We use the reducer — ignore the updater pattern, just clear realtime diff
      dispatch({ type: 'SET_REALTIME_DIFF', tokens: null });
    },
    onSpeakingProgress: (_updater) => {},
    onLastDiffTokens: (_updater) => {
      // lastDiffTokens is set by evaluateAndRespond via dispatch; no-op here
    },
    onMicError: setMicError,
    onClearTts: () => {
      setIsTtsSpeaking(false);
      setIsTtsPaused(false);
    },
    onSessionReady: () => {},
    // No-audio banner uses AnalyserNode volume (paragraphRecorder), not Web Speech.
  });

  // AnalyserNode volume: clear "no audio" banner as soon as the mic picks up sound.
  const VOLUME_THRESHOLD = 0.06;
  const VOLUME_SUSTAIN_MS = 150;
  const NO_AUDIO_TIMEOUT_MS = 4000;
  const hasHeardAudioRef = useRef(false);
  const volumeAboveSinceRef = useRef<number | null>(null);
  const noAudioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearNoAudioTimer = useCallback(() => {
    if (noAudioTimerRef.current !== null) {
      clearTimeout(noAudioTimerRef.current);
      noAudioTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (paragraphRecorder.status !== 'recording') {
      clearNoAudioTimer();
      return;
    }
    clearNoAudioTimer();
    noAudioTimerRef.current = setTimeout(() => {
      if (!hasHeardAudioRef.current) {
        setNoAudioDetected(true);
      }
      noAudioTimerRef.current = null;
    }, NO_AUDIO_TIMEOUT_MS);
    return clearNoAudioTimer;
  }, [paragraphRecorder.status, clearNoAudioTimer]);

  useEffect(() => {
    if (paragraphRecorder.status !== 'recording') {
      volumeAboveSinceRef.current = null;
      return;
    }
    if (paragraphRecorder.volumeLevel < VOLUME_THRESHOLD) {
      volumeAboveSinceRef.current = null;
      return;
    }
    const now = Date.now();
    if (volumeAboveSinceRef.current === null) {
      volumeAboveSinceRef.current = now;
      return;
    }
    if (now - volumeAboveSinceRef.current < VOLUME_SUSTAIN_MS) return;
    hasHeardAudioRef.current = true;
    setHasDetectedAudio(true);
    setNoAudioDetected(false);
    clearNoAudioTimer();
  }, [paragraphRecorder.volumeLevel, paragraphRecorder.status, clearNoAudioTimer]);

  const startSession = useCallback(() => {
    setNoAudioDetected(false);
    setHasDetectedAudio(false);
    hasHeardAudioRef.current = false;
    volumeAboveSinceRef.current = null;
    clearNoAudioTimer();
    clearParagraphFallback();
    void (async () => {
      const recorderError = await paragraphRecorder.startRecording();
      if (recorderError) {
        setMicError(recorderError);
      }
      stt.startSession();
    })();
  }, [stt, paragraphRecorder, clearParagraphFallback, clearNoAudioTimer]);

  const stopSessionRaw = stt.stopSession;

  const clearPendingRecording = useCallback(() => {
    pendingRecordingRef.current = null;
    setRecordingPendingReview(false);
  }, []);

  const stopSession = useCallback(() => {
    clearPendingRecording();
    stopSessionRaw();
  }, [clearPendingRecording, stopSessionRaw]);

  // ── Paragraph evaluation hook ────────────────────────────────────────────
  const { evaluateAndRespond, geminiGenRef, geminiTimeoutRef } = useParagraphEvaluation({
    story,
    evalState,
    dispatch,
    sentenceTargetsRef,
    sentenceResultsRef,
    streakRef,
    lineResults,
    setLineResults,
    setParagraphSummaries,
    advanceParagraph: (lineIdx, allResults, _stop) =>
      advanceParagraph(lineIdx, allResults, stopSession),
    stopSession,
  });

  // ── Sentence retry hook ──────────────────────────────────────────────────
  const sentenceRetry = useSentenceRetry({
    storyContent: story.content,
    currentLineIndex,
    sentenceTargetsRef,
    sentenceResultsRef,
    nextSentenceIdxRef,
    lastFinalResultIdxRef,
    streakRef,
    dispatch,
    setParagraphSummaries,
    setLineResults,
    stopSession,
    startSession,
  });

  // Sync retry ref for STT hook
  retrySentenceInfoRef.current = sentenceRetry.retrySentenceInfoRef.current;

  // ── Recording finish → 評估 / 重錄 ─────────────────────────────────────
  const evaluateAndRespondRef = useRef(evaluateAndRespond);
  evaluateAndRespondRef.current = evaluateAndRespond;
  const handleSentenceRetryEvalRef = useRef(sentenceRetry.handleSentenceRetryEval);
  handleSentenceRetryEvalRef.current = sentenceRetry.handleSentenceRetryEval;

  const finishRecording = useCallback(async () => {
    if (isFinishingRecordingRef.current || recordingPendingReview || isSubmittingSentenceRef.current) {
      return;
    }
    if (!stt.isSessionActive && paragraphRecorder.status !== 'recording') {
      return;
    }

    isFinishingRecordingRef.current = true;
    try {
      const { transcript, rawStt, durationMs } = stt.submitSentence();
      stopSessionRaw();
      clearNoAudioTimer();
      setNoAudioDetected(false);
      const audioBlob = await paragraphRecorder.stopAndGetBlob();
      pendingRecordingRef.current = { transcript, rawStt, durationMs, audioBlob };
      setRecordingPendingReview(true);
    } finally {
      isFinishingRecordingRef.current = false;
    }
  }, [
    stt,
    paragraphRecorder,
    recordingPendingReview,
    stopSessionRaw,
    clearNoAudioTimer,
  ]);

  const confirmRerecord = useCallback(() => {
    clearPendingRecording();
    paragraphRecorder.clearRecording();
    clearParagraphFallback();
    setHasDetectedAudio(false);
    hasHeardAudioRef.current = false;
    volumeAboveSinceRef.current = null;
    startSession();
  }, [clearPendingRecording, paragraphRecorder, clearParagraphFallback, startSession]);

  const confirmEvaluate = useCallback(async () => {
    const pending = pendingRecordingRef.current;
    if (!pending || isSubmittingSentenceRef.current) return;

    isSubmittingSentenceRef.current = true;
    setIsSubmittingSentence(true);
    setRecordingPendingReview(false);

    try {
      const { transcript, rawStt, durationMs, audioBlob } = pending;
      pendingRecordingRef.current = null;

      if (sentenceRetry.retrySentenceInfoRef.current) {
        if (!audioBlob) {
          setParagraphFallbackReason('no_audio');
        }
        await handleSentenceRetryEvalRef.current(transcript, durationMs);
      } else if (audioBlob || transcript) {
        let finalTranscript = transcript;
        let transcriptSource: 'gemini' | 'webspeech' = 'webspeech';

        if (audioBlob && token) {
          const targetText = story.content[currentLineIndex] || '';
          try {
            const result = await transcribeReading(audioBlob, targetText, durationMs, token);
            if (result.method === 'gemini' && result.transcript) {
              clearParagraphFallback();
              finalTranscript = result.transcript;
              transcriptSource = 'gemini';
            } else {
              setParagraphFallbackReason(result.reason ?? 'error');
            }
          } catch {
            setParagraphFallbackReason('error');
          }
        } else {
          setParagraphFallbackReason(audioBlob ? 'no_token' : 'no_audio');
        }

        if (finalTranscript.trim()) {
          const normalizedTranscript = normalizePunctuationToChinese(finalTranscript);
          await evaluateAndRespondRef.current(
            normalizedTranscript,
            rawStt,
            durationMs,
            currentLineIndex,
            transcriptSource,
          );
        }
      }
    } finally {
      isSubmittingSentenceRef.current = false;
      setIsSubmittingSentence(false);
    }
  }, [
    sentenceRetry.retrySentenceInfoRef,
    currentLineIndex,
    token,
    story.content,
    clearParagraphFallback,
    setParagraphFallbackReason,
  ]);

  // ── handleRetryParagraph ─────────────────────────────────────────────────
  const handleRetryParagraph = useCallback(
    (idx: number) => {
      clearPendingRecording();
      if (idx !== currentLineIndex) {
        stopSession();
        setCurrentLineIndex(idx);
      }
      // Reset paragraph recorder and fallback state on retry
      paragraphRecorder.clearRecording();
      clearParagraphFallback();
      setParagraphSummaries((prev) => {
        const next = { ...prev };
        delete next[idx];
        return next;
      });
      dispatch({ type: 'CLEAR_FOR_PARAGRAPH' });
      const targets = splitIntoSentences(story.content[idx] || '');
      sentenceTargetsRef.current = targets;
      sentenceResultsRef.current = new Array(targets.length).fill(null);
      nextSentenceIdxRef.current = 0;
      lastFinalResultIdxRef.current = -1;
      sentenceRetry.clearRetrySentence();
      if (idx === currentLineIndex) {
        startSession();
      } else {
        setTimeout(() => startSession(), 100);
      }
    },
    [
      currentLineIndex,
      story.content,
      stopSession,
      startSession,
      setParagraphSummaries,
      sentenceRetry,
      dispatch,
      paragraphRecorder,
      clearParagraphFallback,
      clearPendingRecording,
    ],
  );

  // ── handleTtsToggle ──────────────────────────────────────────────────────
  const handleTtsToggle = useCallback(
    (idx: number) => {
      if (idx === currentLineIndex) {
        speakCurrentParagraph();
      } else {
        const text = story.content[idx];
        if (text) {
          cancelTts();
          setIsTtsSpeaking(true);
          import('../../../services/ttsApi').then(({ speakText: sp }) => {
            sp(text).finally(() => {
              setIsTtsSpeaking(false);
              setIsTtsPaused(false);
            });
          });
        }
      }
    },
    [currentLineIndex, speakCurrentParagraph, story.content, setIsTtsSpeaking, setIsTtsPaused],
  );

  // ── Vocab words + zhuyin ─────────────────────────────────────────────────
  const vocabWords = useMemo(
    () => (story.vocabulary ?? []).map((v) => v.word).filter(Boolean),
    [story.vocabulary],
  );

  const zhuyinLines = useMemo(
    () => processLinesSelective(story.content, vocabWords),
    [story.content, vocabWords, processLinesSelective],
  );

  // ── streak ref sync ──────────────────────────────────────────────────────
  useEffect(() => {
    streakRef.current = evalState.streak;
  }, [evalState.streak]);

  // ── Init sentence targets when paragraph changes ─────────────────────────
  useEffect(() => {
    const targets = splitIntoSentences(story.content[currentLineIndex] || '');
    sentenceTargetsRef.current = targets;
    sentenceResultsRef.current = new Array(targets.length).fill(null);
    nextSentenceIdxRef.current = 0;
    lastFinalResultIdxRef.current = -1;
    dispatch({ type: 'CLEAR_FOR_PARAGRAPH' });
    // Reset paragraph recorder + fallback when paragraph changes (I4: stale alerts must not persist)
    paragraphRecorder.clearRecording();
    clearParagraphFallback();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLineIndex, story.content]);
  // Note: paragraphRecorder and clearParagraphFallback intentionally excluded
  // from deps — they are stable (refs + stable callbacks) and including them
  // would re-run this effect unnecessarily.

  // ── Persist progress to localStorage ────────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          lineResults,
          paragraphSummaries: Object.fromEntries(
            (
              Object.entries(paragraphSummaries) as Array<
                [string, import('./liveTutorTypes').ParagraphSummaryData]
              >
            ).map(([k, v]) => [k, { ...v, geminiPending: false }]),
          ),
          completedParagraphs: Array.from(completedParagraphs),
          currentLineIndex,
        }),
      );
    } catch {}
  }, [lineResults, paragraphSummaries, completedParagraphs, currentLineIndex, storageKey]);

  // ── Pre-warm mic ─────────────────────────────────────────────────────────
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => stream.getTracks().forEach((t) => t.stop()))
      .catch(() => {});
  }, []);

  // ── Scroll helpers ───────────────────────────────────────────────────────
  const activeLineRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);

  useEffect(() => {
    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true;
      return;
    }
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [currentLineIndex]);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stt.isSessionActiveRef.current = false;
      if (stt.recognitionRef.current) {
        try {
          stt.recognitionRef.current.abort();
        } catch (_) {}
      }
      if (ttsRafRef.current !== null) {
        cancelAnimationFrame(ttsRafRef.current);
        ttsRafRef.current = null;
      }
      cancelTts();
      if (geminiTimeoutRef.current !== null) {
        clearTimeout(geminiTimeoutRef.current);
        geminiTimeoutRef.current = null;
      }
      geminiGenRef.current++;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const paragraphSummary = paragraphSummaries[currentLineIndex] ?? null;

  /* ================================================================ */
  /*  JSX                                                             */
  /* ================================================================ */

  return (
    <div
      className="flex flex-col flex-1 h-full bg-surface overflow-hidden relative"
      style={{ fontFamily: fontForZhuyin(isZhuyinAny) }}
    >
      {/* ── Single-column centered layout ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto pb-48" style={{ scrollbarWidth: 'thin' }}>
        <div className="max-w-4xl mx-auto px-6 md:px-16 pt-4">
          <div className="mt-4" ref={activeLineRef}>
            <ParagraphCard
              idx={currentLineIndex}
              line={story.content[currentLineIndex]}
              status={lineStatuses[currentLineIndex]}
              isCelebrating={celebratingIndex === currentLineIndex}
              currentLineIndex={currentLineIndex}
              isAdvancing={isAdvancing}
              fontSizePx={fontSizePx}
              zhuyinLine={zhuyinLines ? zhuyinLines[currentLineIndex] : null}
              zhuyinActive={isZhuyinAny}
              isSessionActive={stt.isSessionActive}
              isPreparing={stt.isPreparing}
              isTtsSpeaking={isTtsSpeaking}
              isTtsLoading={isTtsLoading}
              speakingProgress={0}
              utteranceRef={utteranceRef}
              ttsRafRef={ttsRafRef}
              streamingUserInput={evalState.streamingUserInput}
              lastDiffTokens={evalState.lastDiffTokens}
              isAwaitingGemini={evalState.isAwaitingGemini}
              retryCount={evalState.retryCount}
              paragraphSummary={paragraphSummary}
              completedParagraphs={completedParagraphs}
              storyLength={story.content.length}
              lineResults={lineResults}
              allStatuses={lineStatuses}
              onSelectParagraph={(idx) => handleSelectParagraph(idx, stopSession)}
              onTtsToggle={handleTtsToggle}
              onStartSession={startSession}
              onStopSession={stopSession}
              onSubmitSentence={finishRecording}
              onRetryParagraph={handleRetryParagraph}
              onRetrySentence={sentenceRetry.handleRetrySentence}
              retrySentenceIdx={
                sentenceRetry.retrySentenceInfo?.paragraphIdx === currentLineIndex
                  ? sentenceRetry.retrySentenceInfo.sentenceIdx
                  : undefined
              }
              onAdvanceParagraph={(lineIdx, allResults) =>
                advanceParagraph(lineIdx, allResults, stopSession)
              }
              setIsTtsSpeaking={setIsTtsSpeaking}
              setIsTtsPaused={setIsTtsPaused}
              storyContent={story.content}
            />
          </div>

          {/* Overall metrics once all paragraphs done (non-toolbox) */}
          {!isToolboxMode() &&
            completedParagraphs.size === story.content.length &&
            overallMetrics && (
              <div className="mt-4">
                <ReadingMetricsCard
                  accuracy={overallMetrics.accuracy}
                  cpm={overallMetrics.cpm}
                />
              </div>
            )}
        </div>
      </div>

      {/* Mic error */}
      {micError && (
        <div className="absolute bottom-52 left-1/2 -translate-x-1/2 px-5 py-2 bg-tertiary-container/20 rounded-full z-20">
          <span className="text-sm text-tertiary">{micError}</span>
        </div>
      )}

      {/* No-audio-detected banner */}
      {noAudioDetected && paragraphRecorder.status === 'recording' && (
        <NoAudioBanner onRestart={() => {
          // P1 Round 4: stop the old paragraph recorder BEFORE starting a new session.
          // The previous onRestart only called stopSession() (STT) + startSession(), which
          // would call paragraphRecorder.startRecording() on top of a still-active recorder,
          // leaking the old MediaStream and causing a permission / resource conflict.
          // clearRecording() stops the recorder, cancels any pending stopAndGetBlob promise,
          // and releases the mic track so startRecording() can acquire a fresh stream.
          paragraphRecorder.clearRecording();
          stopSession();
          startSession();
        }} />
      )}

      {/* I4 (Issue #2156): Per-paragraph Gemini fallback alert — must not be silent.
          Shown when audio transcription fails so student knows the score is from
          Web Speech only (lower quality) and can retry for a better result. */}
      {paragraphFallbackReason && (
        <div className="absolute bottom-44 left-1/2 -translate-x-1/2 z-20 w-[min(92%,520px)]">
          <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-300 shadow-md">
            <span className="material-symbols-outlined text-amber-600 shrink-0">warning</span>
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-800">高品質辨識暫時失敗，這是粗略結果</p>
              <p className="text-xs text-amber-700 mt-0.5">
                AI 音訊分析未能完成（{paragraphFallbackReason}），評分依瀏覽器語音辨識，準確度較低。建議重試此段。
              </p>
            </div>
            <button
              onClick={clearParagraphFallback}
              className="text-amber-600 hover:text-amber-800 transition-colors shrink-0"
              aria-label="關閉提示"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Fixed bottom controls ─────────────────────────────────────── */}
      <LiveTutorControls
        isSessionActive={stt.isSessionActive}
        isPreparing={stt.isPreparing}
        isTtsLoading={isTtsLoading}
        isTtsSpeaking={isTtsSpeaking}
        isTtsPaused={isTtsPaused}
        isAdvancing={isAdvancing}
        isAwaitingGemini={evalState.isAwaitingGemini}
        isSubmittingSentence={isSubmittingSentence}
        recordingPendingReview={recordingPendingReview}
        hasDetectedAudio={hasDetectedAudio}
        volumeLevel={paragraphRecorder.volumeLevel}
        lastDiffTokens={evalState.lastDiffTokens}
        retryCount={evalState.retryCount}
        ttsError={ttsError}
        completedCount={completedParagraphs.size}
        totalLines={story.content.length}
        onStartSession={startSession}
        onFinishRecording={finishRecording}
        onConfirmEvaluate={confirmEvaluate}
        onConfirmRerecord={confirmRerecord}
        onSpeakCurrentParagraph={speakCurrentParagraph}
        onPauseResumeTts={isTtsPaused ? resumeTts : pauseTts}
        onStopTts={stopTts}
        onFinish={() => handleFinish(stopSession)}
      />

      {/* Background decoration */}
      <div className="fixed -bottom-16 -right-16 w-64 h-64 bg-tertiary/5 rounded-full blur-[100px] pointer-events-none -z-10" />
      <div className="fixed top-1/4 -left-32 w-80 h-80 bg-accent/5 rounded-full blur-[100px] pointer-events-none -z-10" />

      {/* #1462 Toolbox completion overlay */}
      {toolboxComplete && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-surface rounded-3xl shadow-editorial p-8 max-w-md w-full text-center space-y-4">
            <h2 className="text-2xl font-headline font-bold text-on-surface">朗讀練習完成！</h2>
            {overallMetrics && (
              <ReadingMetricsCard
                accuracy={overallMetrics.accuracy}
                cpm={overallMetrics.cpm}
              />
            )}
            <p className="text-sm text-on-surface-variant">
              想再練一次，或回到工具箱選別的工具？
            </p>
            <ToolboxCompletionActions onRetry={resetForRetry} />
          </div>
        </div>
      )}

    </div>
  );
};

export default LiveTutor;
