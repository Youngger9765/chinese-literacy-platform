import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Story, ReadingAttempt, DiffToken } from '../../../types';
import { normalizeForComparison, cleanChineseText } from '../../../utils/textDiff';
import { useZhuyin } from '../../../context/ZhuyinContext';
import FontSizeControl, { useFontSize } from '../../ui/FontSizeControl';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { READING_EXCELLENT } from '../../../utils/personaConfig';
import ParagraphProgress, { ParagraphStatus } from '../ParagraphProgress';
import { evaluateReading } from '../../../services/learningApi';
import { useAuth } from '../../../contexts/AuthContext';
import {
  localEvaluateParagraph,
  splitIntoSentences,
  getReadingPassThreshold,
  type LocalEvalResult,
} from '../../../utils/localEval';
import { cancelTts } from '../../../services/ttsApi';
import { saveReadingHistory } from '../../../services/readingHistoryApi';
import {
  TIER1_POOL,
  TIER2_POOL,
  TIER3_POOL,
  STREAK_MESSAGES,
} from '../../../utils/liveTutorPools';
import { extractPracticeChars, CHINESE_PUNCTUATION_REGEX } from '../../../utils/liveTutorHelpers';
import { scopedStepStorageKey } from '../../../services/learningStorageScope';
import { useResizablePanel } from '../../../hooks/useResizablePanel';
import { useLiveTutorSpeech } from '../../../hooks/useLiveTutorSpeech';
import { useTtsPlayback } from '../../../hooks/useTtsPlayback';
import { LineResult, ParagraphSummaryData } from './liveTutorTypes';
import ParagraphCard from './ParagraphCard';
import TutorFeedbackPanel from './TutorFeedbackPanel';

/* ------------------------------------------------------------------ */
/*  Component props                                                    */
/* ------------------------------------------------------------------ */

interface LiveTutorProps {
  story: Story;
  rightPanelWidth: number;
  onPanelWidthChange: (w: number) => void;
  onFinish: (attempt: ReadingAttempt) => void;
  onCancel: () => void;
  /** Called each time a paragraph is completed (unlocked). Receives the index of the completed paragraph. */
  onParagraphComplete?: (completedParagraphIndex: number) => void;
  /** Initial set of completed paragraph indices (for session resume). */
  initialCompletedParagraphs?: Set<number>;
}

const LiveTutor: React.FC<LiveTutorProps> = ({
  story,
  rightPanelWidth,
  onPanelWidthChange,
  onFinish,
  onCancel,
  onParagraphComplete,
  initialCompletedParagraphs,
}) => {
  const storageKey = scopedStepStorageKey('liveTutor_progress_', story.id);
  const { token } = useAuth();
  const isMobile = useIsMobile();
  const { px: fontSizePx } = useFontSize();
  const [currentLineIndex, setCurrentLineIndex] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) { const p = JSON.parse(raw); return p.currentLineIndex ?? 0; }
    } catch {}
    return 0;
  });
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [micError, setMicError] = useState('');
  const [streamingUserInput, setStreamingUserInput] = useState('');
  // No-audio-detected banner: shown when user started recording but
  // no audio detected within 5 seconds.
  const [noAudioDetected, setNoAudioDetected] = useState(false);

  // ── localStorage persistence for reading progress ──────────────────────────
  const loadSavedProgress = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as {
        lineResults: LineResult[];
        paragraphSummaries: Record<number, ParagraphSummaryData>;
        completedParagraphs: number[];
        currentLineIndex: number;
      };
    } catch { return null; }
  };
  const savedProgress = useRef(loadSavedProgress());

  const [lineResults, setLineResults] = useState<LineResult[]>(
    savedProgress.current?.lineResults ?? []
  );
  const [streak, setStreak] = useState(0);
  const { zhuyinActive, processZhuyin } = useZhuyin();
  const [isAwaitingGemini, setIsAwaitingGemini] = useState(false);
  const [lastDiffTokens, setLastDiffTokens] = useState<DiffToken[] | null>(null);
  const [showRecorder, setShowRecorder] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [speakingProgress, setSpeakingProgress] = useState(0);
  const [realtimeDiffTokens, setRealtimeDiffTokens] = useState<DiffToken[] | null>(null);
  const [paragraphSummaries, setParagraphSummaries] = useState<Record<number, ParagraphSummaryData>>(
    savedProgress.current?.paragraphSummaries ?? {}
  );
  const paragraphSummary = paragraphSummaries[currentLineIndex] ?? null;

  // Hybrid eval: per-sentence (分期付款) tracking
  const geminiGenRef = useRef(0);
  const geminiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentenceTargetsRef = useRef<string[]>([]);
  const sentenceResultsRef = useRef<Array<LocalEvalResult | null>>([]);
  const nextSentenceIdxRef = useRef(0);
  const lastFinalResultIdxRef = useRef(-1);
  const streakRef = useRef(0);

  // Progressive unlock state
  const [completedParagraphs, setCompletedParagraphs] = useState<Set<number>>(
    savedProgress.current?.completedParagraphs
      ? new Set(savedProgress.current.completedParagraphs)
      : initialCompletedParagraphs ?? new Set<number>()
  );
  const [celebratingIndex, setCelebratingIndex] = useState<number | null>(null);

  const isAdvancingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const evaluateAndRespondRef = useRef<any>(null);

  const sentenceStartTimeRef = useRef(0);
  const lastDiffTimeRef = useRef(0);

  // Sentence-level retry state (#1076)
  const [retrySentenceInfo, setRetrySentenceInfo] = useState<{
    paragraphIdx: number;
    sentenceIdx: number;
    target: string;
    originalTargets: string[];
    originalResults: Array<LocalEvalResult | null>;
  } | null>(null);
  const retrySentenceInfoRef = useRef(retrySentenceInfo);
  retrySentenceInfoRef.current = retrySentenceInfo;
  const handleSentenceRetryEvalRef = useRef<(transcript: string, durationMs: number) => Promise<void>>(
    async () => { throw new Error('handleSentenceRetryEval called before initialization'); }
  );

  /* ---- TTS playback hook ---- */
  const {
    isTtsSpeaking,
    isTtsPaused,
    setIsTtsSpeaking,
    setIsTtsPaused,
    utteranceRef,
    ttsRafRef,
    speakText,
    pauseTts,
    resumeTts,
    stopTts,
  } = useTtsPlayback(
    (pos) => setSpeakingProgress(pos),
    () => setRealtimeDiffTokens(null),
  );

  /** Use Cloud TTS Neural2 to read the current paragraph aloud. */
  const speakCurrentParagraph = useCallback(() => {
    const text = story.content[currentLineIndex];
    if (!text) return;
    speakText(text);
  }, [story.content, currentLineIndex, speakText]);

  /* ---- Resizable right panel ---- */
  const { onDividerMouseDown, onDividerTouchStart } = useResizablePanel(
    rightPanelWidth,
    onPanelWidthChange,
  );

  // During sentence retry, narrow STT target to just the one sentence (#1076)
  const sttTargetText = retrySentenceInfo
    ? retrySentenceInfo.target
    : (story.content[currentLineIndex] || '');

  /* ---- STT hook ---- */
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
    onStreamingTranscript: setStreamingUserInput,
    onRealtimeDiffTokens: setRealtimeDiffTokens as any,
    onSpeakingProgress: setSpeakingProgress as any,
    onLastDiffTokens: setLastDiffTokens as any,
    onMicError: setMicError,
    onClearTts: () => { setIsTtsSpeaking(false); setIsTtsPaused(false); },
    onSessionReady: () => {
      // session ready callback (kept for compat with hook)
    },
    onNoAudioDetected: () => setNoAudioDetected(true),
  });

  const startSession = () => {
    setNoAudioDetected(false);
    stt.startSession();
  };
  const stopSession = stt.stopSession;

  /* ---- scroll helpers ---- */
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [streamingUserInput]);

  // Skip the first auto-scroll on mount — on mobile the centered block
  // position pushes the card header (第 N/M 段 + sub-progress) above
  // the fold. Only scroll when the user actually navigates paragraphs.
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

  /* ---- pre-warm mic permission on mount ---- */
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => stream.getTracks().forEach(t => t.stop()))
      .catch(() => {});
  }, []);

  /** Pre-process each story line through the polyphonic processor for zhuyin rendering */
  const zhuyinLines = useMemo(() => {
    if (!zhuyinActive) return null;
    return story.content.map((line) => processZhuyin(line));
  }, [story.content, zhuyinActive, processZhuyin]);

  /** Compute completed/current/locked status for each paragraph. */
  const lineStatuses = useMemo<ParagraphStatus[]>(() => {
    return story.content.map((_, idx) => {
      if (completedParagraphs.has(idx)) return 'completed';
      if (idx === currentLineIndex) return 'current';
      return 'locked';
    });
  }, [story.content, completedParagraphs, currentLineIndex]);

  /** Highest paragraph index that is unlocked (either completed or currently active). */
  const maxUnlockedIndex = useMemo(() => {
    let max = currentLineIndex;
    for (const idx of completedParagraphs) {
      if (idx > max) max = idx;
    }
    return max;
  }, [completedParagraphs, currentLineIndex]);

  // ── Save progress to localStorage whenever key state changes ──────────────
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        lineResults,
        paragraphSummaries: Object.fromEntries(
          (Object.entries(paragraphSummaries) as Array<[string, ParagraphSummaryData]>).map(([k, v]) => [
            k,
            { ...v, geminiPending: false },
          ])
        ),
        completedParagraphs: Array.from(completedParagraphs),
        currentLineIndex,
      }));
    } catch {}
  }, [lineResults, paragraphSummaries, completedParagraphs, currentLineIndex, storageKey]);

  /* ---- keep streakRef in sync ---- */
  useEffect(() => { streakRef.current = streak; }, [streak]);

  /* ---- init sentence targets when paragraph changes ---- */
  useEffect(() => {
    const targets = splitIntoSentences(story.content[currentLineIndex] || '');
    sentenceTargetsRef.current = targets;
    sentenceResultsRef.current = new Array(targets.length).fill(null);
    nextSentenceIdxRef.current = 0;
    lastFinalResultIdxRef.current = -1;
    setLastDiffTokens(null);
    setSpeakingProgress(0);
    setRealtimeDiffTokens(null);
  }, [currentLineIndex, story.content]);

  /* ---- cleanup on unmount ---- */
  useEffect(() => {
    return () => {
      stt.isSessionActiveRef.current = false;
      if (stt.recognitionRef.current) {
        try { stt.recognitionRef.current.abort(); } catch (_) {}
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
  }, []);

  /* ================================================================ */
  /*  Core: evaluate the student's reading and respond                */
  /* ================================================================ */

  /* ---- Helper: save paragraph reading to history (#909) ---- */
  const saveParagraphReading = useCallback((lineIdx: number, result: LineResult) => {
    if (!token) return;
    const durationSec = result.durationMs / 1000;
    if (durationSec <= 0) return;
    saveReadingHistory(
      {
        lesson_id: String(story.id),
        paragraph_index: lineIdx,
        reading_type: 'paragraph',
        cpm: result.cpm,
        accuracy: Math.round(result.matchRate * 100),
        duration_seconds: durationSec,
      },
      token,
    ).catch((err) => console.error('Failed to save paragraph reading history:', err));
  }, [token, story.id]);

  /* ---- Helper: advance or finish after a successful paragraph ---- */
  const advanceParagraph = useCallback((lineIdx: number, allLineResults: LineResult[]) => {
    const currentResult = allLineResults.find(r => r.lineIndex === lineIdx);
    if (currentResult) saveParagraphReading(lineIdx, currentResult);

    const isLastLine = lineIdx >= story.content.length - 1;
    if (!isLastLine) {
      if (isAdvancingRef.current) return;
      isAdvancingRef.current = true;
      setIsAdvancing(true);
      stopSession();

      const nextIdx = lineIdx + 1;
      setCompletedParagraphs(prev => { const s = new Set(prev); s.add(lineIdx); return s; });
      onParagraphComplete?.(lineIdx);
      setCelebratingIndex(nextIdx);
      setTimeout(() => setCelebratingIndex(null), 2000);

      setTimeout(() => {
        setRetryCount(0);
        setCurrentLineIndex(nextIdx);
        isAdvancingRef.current = false;
        setIsAdvancing(false);
      }, 1500);
    } else {
      stopSession();
      setCompletedParagraphs(prev => { const s = new Set(prev); s.add(lineIdx); return s; });
      onParagraphComplete?.(lineIdx);

      setTimeout(() => {
        const avgMatchRate = allLineResults.reduce((s, r) => s + r.matchRate, 0) / allLineResults.length;
        const totalCorrectChars = allLineResults.reduce(
          (s, r) => s + r.diffTokens.filter(t => t.type === 'correct' || t.type === 'forgiven').length, 0
        );
        const totalDurationSec = allLineResults.reduce((s, r) => s + r.durationMs, 0) / 1000;
        const overallCpm = totalDurationSec > 0 ? Math.round((totalCorrectChars / totalDurationSec) * 60) : 0;
        onFinish({
          storyId: story.id, accuracy: Math.round(avgMatchRate * 100), fluency: overallCpm,
          cpm: overallCpm, mispronouncedWords: extractPracticeChars(allLineResults, story.content),
          transcription: allLineResults.map(r => r.transcript).join(' '), timestamp: Date.now(),
          lineBreakdown: allLineResults.map(r => ({
            lineIndex: r.lineIndex, matchRate: r.matchRate, cpm: r.cpm,
            transcript: r.transcript, diffTokens: r.diffTokens,
          })),
        });
      }, 2000);
    }
  }, [story, onFinish, onParagraphComplete, saveParagraphReading]);

  /* ---- Hybrid evaluation: local first, Gemini only on FAIL ---- */
  const evaluateAndRespond = useCallback(async (rawTranscript: string, rawStt: string, durationMs: number, lineIdx: number) => {
    const targetText = story.content[lineIdx] || '';
    const cleaned = cleanChineseText(rawTranscript);

    // 整段漏讀：no speech detected → show summary with retry prompt instead of silently returning
    if (!cleaned) {
      stopSession();
      const normalizedTarget = normalizeForComparison(targetText);
      const targetLen = normalizedTarget.length;
      const emptyDiffTokens: DiffToken[] = Array.from(normalizedTarget).map(ch => ({
        char: ch, type: 'missing' as const,
      }));
      setParagraphSummaries(prev => ({
        ...prev,
        [lineIdx]: {
          feedback: '好像沒有偵測到聲音，請再試一次吧！',
          matchRate: 0,
          wrongCount: 0,
          missingCount: targetLen,
          tier: 3 as const,
          geminiPending: false,
        },
      }));
      setLastDiffTokens(emptyDiffTokens);
      setStreamingUserInput('');
      return;
    }

    // ── Phase 1: local eval (instant, <1ms) ─────────────────────────────────
    const sentResults = sentenceResultsRef.current.filter(Boolean) as LocalEvalResult[];

    let localTier: 1 | 2 | 3;
    let localDiffTokens: DiffToken[];
    let localFeedback: string;
    let localMatchRate: number;
    let localCpm: number;

    const totalSentences = sentenceTargetsRef.current.length;
    if (sentResults.length > 0 && sentResults.length >= Math.ceil(totalSentences / 2)) {
      const allDiff = sentResults.flatMap(r => r.diffTokens);
      const correctAndForgiven = allDiff.filter(t => t.type === 'correct' || t.type === 'forgiven').length;
      const totalTarget = normalizeForComparison(targetText).length || 1;
      localMatchRate = correctAndForgiven / totalTarget;
      const threshold = getReadingPassThreshold(totalTarget);
      localTier = localMatchRate >= READING_EXCELLENT ? 1 : localMatchRate >= threshold ? 2 : 3;
      localDiffTokens = allDiff;
      localFeedback = sentResults[sentResults.length - 1].feedback;
      localCpm = Math.round(sentResults.reduce((s, r) => s + r.cpm, 0) / sentResults.length);
    } else {
      const localResult = localEvaluateParagraph(
        cleaned, targetText, durationMs,
        { tier1: TIER1_POOL, tier2: TIER2_POOL, tier3: TIER3_POOL, streakMsgs: STREAK_MESSAGES },
        streak,
      );
      localTier = localResult.tier;
      localDiffTokens = localResult.diffTokens;
      localFeedback = localResult.feedback;
      localMatchRate = localResult.matchRate;
      localCpm = localResult.cpm;
    }

    // Show local diff immediately
    setLastDiffTokens(localDiffTokens);

    if (import.meta.env.DEV) {
      console.group('%c[Evaluation] Hybrid', 'color: cyan; font-weight: bold');
      console.log('Line:', lineIdx, '/', story.content.length - 1);
      console.log('Target:', targetText, '| STT:', rawStt);
      console.log('Local tier:', localTier, '| match:', (localMatchRate * 100).toFixed(1) + '%', '| cpm:', localCpm);
      console.log('Sentence results:', sentResults.length, '/ total sentences:', sentenceTargetsRef.current.length);
      console.groupEnd();
    }

    // ── Retry cap: auto-advance after 2 failed attempts ──────────────────────
    if (localTier === 3 && retryCount >= 2) {
      stopSession();
      const capFeedback = '你已經很努力了！我們先繼續下一段，之後再回來練習。';
      setStreamingUserInput('');
      setRetryCount(0);
      const capResult: LineResult = { lineIndex: lineIdx, matchRate: localMatchRate, cpm: localCpm, durationMs, transcript: cleaned, diffTokens: localDiffTokens };
      const allResults = [...lineResults, capResult];
      setLineResults(allResults);
      advanceParagraph(lineIdx, allResults);
      return;
    }

    // ── Phase 2: Show paragraph summary, call Gemini for feedback ─────────────
    const localResult: LineResult = { lineIndex: lineIdx, matchRate: localMatchRate, cpm: localCpm, durationMs, transcript: cleaned, diffTokens: localDiffTokens };
    const allResults = [...lineResults, localResult];
    setLineResults(allResults);
    setStreamingUserInput('');

    const wrongCount = localDiffTokens.filter(t => t.type === 'wrong').length;
    const missingCount = localDiffTokens.filter(t => t.type === 'missing').length;

    stopSession();

    // Fill in null sentence results: evaluate each unevaluated sentence against
    // the full transcript so skipped sentences are properly detected (#1096).
    const filledSentenceResults = sentenceResultsRef.current.map((result, si) => {
      if (result !== null) return result;
      const sentTarget = sentenceTargetsRef.current[si];
      if (!sentTarget) return null;
      return localEvaluateParagraph(
        cleaned, sentTarget, durationMs,
        { tier1: TIER1_POOL, tier2: TIER2_POOL, tier3: TIER3_POOL, streakMsgs: STREAK_MESSAGES },
        streak,
      );
    });

    const summaryData: ParagraphSummaryData = {
      feedback: localTier <= 2 ? (localFeedback || '唸得不錯！') : (localFeedback || '再試一次，加油！'),
      matchRate: localMatchRate,
      wrongCount,
      missingCount,
      tier: localTier,
      geminiPending: true,
      sentenceResults: [...filledSentenceResults],
      sentenceTargets: [...sentenceTargetsRef.current],
    };
    setParagraphSummaries(prev => ({ ...prev, [lineIdx]: summaryData }));

    if (localTier <= 2) {
      setStreak(prev => prev + 1);
      setRetryCount(0);
    } else {
      setRetryCount(prev => prev + 1);
    }

    // Async Gemini: get AI feedback to update the summary
    const gen = ++geminiGenRef.current;
    if (geminiTimeoutRef.current !== null) { clearTimeout(geminiTimeoutRef.current); geminiTimeoutRef.current = null; }

    void (async () => {
      let localTimeout: ReturnType<typeof setTimeout> | null = null;
      try {
        const gemini = await Promise.race([
          evaluateReading(cleaned, targetText, durationMs, token ?? undefined),
          new Promise<never>((_, reject) => {
            localTimeout = setTimeout(() => reject(new Error('gemini_timeout')), 8000);
            geminiTimeoutRef.current = localTimeout;
          }),
        ]);
        if (localTimeout !== null) clearTimeout(localTimeout);
        if (geminiTimeoutRef.current === localTimeout) geminiTimeoutRef.current = null;
        if (geminiGenRef.current !== gen) return;

        const geminiWrong = (gemini.diff_tokens || []).filter((t: DiffToken) => t.type === 'wrong').length;
        const geminiMissing = (gemini.diff_tokens || []).filter((t: DiffToken) => t.type === 'missing').length;
        setParagraphSummaries(prev => ({ ...prev, [lineIdx]: {
          feedback: gemini.feedback || (gemini.tier <= 2 ? '唸得不錯！' : '再試一次，加油！'),
          matchRate: gemini.adjusted_match_rate,
          wrongCount: geminiWrong,
          missingCount: geminiMissing,
          tier: gemini.tier,
          geminiPending: false,
          sentenceResults: prev[lineIdx]?.sentenceResults,
          sentenceTargets: prev[lineIdx]?.sentenceTargets,
        }}));
        setLastDiffTokens(gemini.diff_tokens);

        if (gemini.tier <= 2 && localTier > 2) {
          setStreak(prev => prev + 1);
          setRetryCount(0);
          const geminiResult: LineResult = {
            lineIndex: lineIdx,
            matchRate: gemini.adjusted_match_rate,
            cpm: Math.round(gemini.cpm ?? localCpm),
            durationMs, transcript: cleaned, diffTokens: gemini.diff_tokens,
          };
          setLineResults(prev => [...prev.slice(0, -1), geminiResult]);
        }
      } catch (err: unknown) {
        if (localTimeout !== null) clearTimeout(localTimeout);
        if (geminiTimeoutRef.current === localTimeout) geminiTimeoutRef.current = null;
        if (geminiGenRef.current !== gen) return;
        setParagraphSummaries(prev => {
          const existing = prev[lineIdx];
          return existing ? { ...prev, [lineIdx]: { ...existing, geminiPending: false } } : prev;
        });
        const msg = err instanceof Error ? err.message : '';
        if (msg !== 'gemini_timeout') {
          console.warn('[LiveTutor] Gemini eval failed, local result stands:', err);
        }
      }
    })();
  }, [story, streak, lineResults, onFinish, onParagraphComplete, retryCount, token, advanceParagraph]);

  // Sync refs so async callbacks (onend) always see latest values
  evaluateAndRespondRef.current = evaluateAndRespond;

  /* ---- submitSentence wrapper ---- */
  const submitSentence = useCallback(async () => {
    const { transcript, rawStt, durationMs } = stt.submitSentence();
    if (retrySentenceInfoRef.current) {
      // Sentence retry mode: evaluate only this sentence (#1076)
      await handleSentenceRetryEvalRef.current(transcript, durationMs);
    } else if (transcript) {
      await evaluateAndRespondRef.current(transcript, rawStt, durationMs, currentLineIndex);
    }
  }, [currentLineIndex]);

  /* ================================================================ */
  /*  Finish / manual nav                                             */
  /* ================================================================ */

  const handleFinish = () => {
    stopSession();
    try { localStorage.removeItem(storageKey); } catch {}
    const avgMatchRate =
      lineResults.length > 0
        ? lineResults.reduce((s, r) => s + r.matchRate, 0) / lineResults.length : 0;
    const totalCorrectChars = lineResults.reduce(
      (s, r) => s + r.diffTokens.filter(t => t.type === 'correct' || t.type === 'forgiven').length, 0
    );
    const totalDurationSec = lineResults.reduce((s, r) => s + r.durationMs, 0) / 1000;
    const overallCpm = totalDurationSec > 0 ? Math.round((totalCorrectChars / totalDurationSec) * 60) : 0;
    onFinish({
      storyId: story.id, accuracy: Math.round(avgMatchRate * 100), fluency: overallCpm,
      cpm: overallCpm, mispronouncedWords: extractPracticeChars(lineResults, story.content),
      transcription: lineResults.map(r => r.transcript).join(' '), timestamp: Date.now(),
      lineBreakdown: lineResults.map(r => ({
        lineIndex: r.lineIndex, matchRate: r.matchRate, cpm: r.cpm,
        transcript: r.transcript, diffTokens: r.diffTokens,
      })),
    });
  };

  /* ---- handleSelectParagraph: stop session + navigate ---- */
  const handleSelectParagraph = useCallback((idx: number) => {
    stopSession();
    setRetryCount(0);
    setCurrentLineIndex(idx);
  }, [stopSession]);

  /* ---- handleTtsToggle: speak a non-current paragraph ---- */
  const handleTtsToggle = useCallback((idx: number) => {
    if (idx === currentLineIndex) {
      speakCurrentParagraph();
    } else {
      const text = story.content[idx];
      if (text) {
        cancelTts();
        setIsTtsSpeaking(true);
        import('../../../services/ttsApi').then(({ speakText: sp }) => {
          sp(text).finally(() => { setIsTtsSpeaking(false); setIsTtsPaused(false); });
        });
      }
    }
  }, [currentLineIndex, speakCurrentParagraph, story.content, setIsTtsSpeaking, setIsTtsPaused]);

  /* ---- handleRetryParagraph: clear summary + restart ---- */
  const handleRetryParagraph = useCallback((idx: number) => {
    if (idx !== currentLineIndex) {
      stopSession();
      setRetryCount(0);
      setCurrentLineIndex(idx);
    }
    setParagraphSummaries(prev => { const next = { ...prev }; delete next[idx]; return next; });
    setRealtimeDiffTokens(null);
    setLastDiffTokens(null);
    // Reset sentence tracking for fresh attempt (#1076)
    const targets = splitIntoSentences(story.content[idx] || '');
    sentenceTargetsRef.current = targets;
    sentenceResultsRef.current = new Array(targets.length).fill(null);
    nextSentenceIdxRef.current = 0;
    lastFinalResultIdxRef.current = -1;
    // Clear any active sentence retry (#1076)
    retrySentenceInfoRef.current = null;
    setRetrySentenceInfo(null);
    if (idx === currentLineIndex) { startSession(); }
    else { setTimeout(() => startSession(), 100); }
  }, [currentLineIndex, story.content, stopSession, startSession]);

  /* ---- handleRetrySentence: enter single-sentence retry mode (#1076) ---- */
  const handleRetrySentence = useCallback((paragraphIdx: number, sentenceIdx: number) => {
    if (paragraphIdx !== currentLineIndex) {
      console.warn('[LiveTutor] handleRetrySentence: paragraphIdx mismatch', { paragraphIdx, currentLineIndex });
      return;
    }
    stopSession();

    const sentences = splitIntoSentences(story.content[paragraphIdx] || '');
    const target = sentences[sentenceIdx];
    // Don't retry single-char sentences (issue 661: 單獨一個字不用重練)
    if (!target || target.replace(CHINESE_PUNCTUATION_REGEX, '').length <= 1) {
      console.warn('[LiveTutor] handleRetrySentence: skipping invalid/single-char sentence', { sentenceIdx, target });
      return;
    }

    const info = {
      paragraphIdx,
      sentenceIdx,
      target,
      originalTargets: [...sentenceTargetsRef.current],
      originalResults: [...sentenceResultsRef.current],
    };
    retrySentenceInfoRef.current = info;
    setRetrySentenceInfo(info);

    // Override sentence refs to just this one sentence
    sentenceTargetsRef.current = [target];
    sentenceResultsRef.current = [null];
    nextSentenceIdxRef.current = 0;
    lastFinalResultIdxRef.current = -1;
    setLastDiffTokens(null);
    setRealtimeDiffTokens(null);

    setTimeout(() => startSession(), 100);
  }, [currentLineIndex, story.content, stopSession, startSession]);

  /* ---- handleSentenceRetryEval: evaluate single-sentence retry result (#1076) ---- */
  const handleSentenceRetryEval = useCallback(async (transcript: string, durationMs: number) => {
    const info = retrySentenceInfoRef.current;
    if (!info) return;

    stopSession();
    const cleaned = cleanChineseText(transcript);

    // No speech detected — stay in retry mode instead of silently exiting
    if (!cleaned) {
      setTimeout(() => startSession(), 100);
      return;
    }

    // Restore original sentence refs
    sentenceTargetsRef.current = info.originalTargets;
    const newResults = [...info.originalResults];

    const localResult = localEvaluateParagraph(
      cleaned, info.target, durationMs,
      { tier1: TIER1_POOL, tier2: TIER2_POOL, tier3: TIER3_POOL, streakMsgs: STREAK_MESSAGES },
      streakRef.current,
    );
    newResults[info.sentenceIdx] = localResult;
    setLastDiffTokens(localResult.diffTokens);
    setRealtimeDiffTokens(null);

    sentenceResultsRef.current = newResults;
    nextSentenceIdxRef.current = info.originalTargets.length;
    retrySentenceInfoRef.current = null;
    setRetrySentenceInfo(null);

    // Weighted delta: only adjust the retried sentence's contribution
    const paragraphTarget = story.content[info.paragraphIdx] || '';
    const paragraphLen = normalizeForComparison(paragraphTarget).length || 1;
    const sentenceLen = normalizeForComparison(info.target).length;
    const sentenceWeight = sentenceLen / paragraphLen;

    const sentenceMatchRateFromResult = info.originalResults[info.sentenceIdx]?.matchRate;
    const newSentenceMatchRate = localResult?.matchRate;

    const oldWrong = info.originalResults[info.sentenceIdx]?.diffTokens.filter(t => t.type === 'wrong').length ?? 0;
    const oldMissing = info.originalResults[info.sentenceIdx]?.diffTokens.filter(t => t.type === 'missing').length ?? 0;
    const newWrong = localResult?.diffTokens.filter(t => t.type === 'wrong').length ?? oldWrong;
    const newMissing = localResult?.diffTokens.filter(t => t.type === 'missing').length ?? oldMissing;

    setParagraphSummaries(prev => {
      const existing = prev[info.paragraphIdx];
      if (!existing) return prev;
      const oldSentenceMatchRate = sentenceMatchRateFromResult ?? existing.matchRate;
      const effectiveNewRate = newSentenceMatchRate ?? oldSentenceMatchRate;
      const newMatchRate = Math.max(0, Math.min(1,
        existing.matchRate
        - (oldSentenceMatchRate * sentenceWeight)
        + (effectiveNewRate * sentenceWeight),
      ));
      const threshold = getReadingPassThreshold(paragraphLen);
      const newTier = (newMatchRate >= READING_EXCELLENT ? 1 : newMatchRate >= threshold ? 2 : 3) as 1 | 2 | 3;
      return {
        ...prev,
        [info.paragraphIdx]: {
          ...existing,
          matchRate: newMatchRate,
          wrongCount: Math.max(0, existing.wrongCount - oldWrong + newWrong),
          missingCount: Math.max(0, existing.missingCount - oldMissing + newMissing),
          tier: newTier,
          sentenceResults: newResults,
          geminiPending: false,
        },
      };
    });

    setLineResults(prev => {
      let idx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].lineIndex === info.paragraphIdx) { idx = i; break; }
      }
      if (idx === -1) return prev;
      const updated = [...prev];
      const oldSentenceMatchRate = sentenceMatchRateFromResult ?? updated[idx].matchRate;
      const effectiveNewRate = newSentenceMatchRate ?? oldSentenceMatchRate;
      const newMatchRate = Math.max(0, Math.min(1,
        updated[idx].matchRate
        - (oldSentenceMatchRate * sentenceWeight)
        + (effectiveNewRate * sentenceWeight),
      ));
      updated[idx] = { ...updated[idx], matchRate: newMatchRate };
      return updated;
    });
  }, [story.content, stopSession, startSession]);
  handleSentenceRetryEvalRef.current = handleSentenceRetryEval;

  /* ================================================================ */
  /*  JSX                                                             */
  /* ================================================================ */

  // Compute diff tokens for the right panel (current paragraph only, shown after eval)
  const rightPanelDiffTokens: DiffToken[] | null = (() => {
    if (lastDiffTokens && lastDiffTokens.length > 0) return lastDiffTokens;
    for (let i = lineResults.length - 1; i >= 0; i--) {
      if (lineResults[i].lineIndex === currentLineIndex && lineResults[i].diffTokens?.length > 0) {
        return lineResults[i].diffTokens;
      }
    }
    return null;
  })();

  // Feedback panel visibility toggle
  const [showFeedback, setShowFeedback] = React.useState(false);

  return (
    <div
      className="flex flex-col flex-1 h-full bg-surface overflow-hidden relative"
      style={{
        fontFamily: zhuyinActive
          ? "'BpmfZihiSans', 'Noto Sans TC', sans-serif"
          : undefined,
      }}
    >
      {/* ── Single-column centered layout ─────────────────────────────── */}
      <div className="flex-1 overflow-y-auto pb-48 custom-scrollbar">
        <div className="max-w-4xl mx-auto px-6 md:px-16 pt-4">
          {/* Single paragraph card — only show the current paragraph */}
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
              zhuyinActive={zhuyinActive}
              isSessionActive={stt.isSessionActive}
              isPreparing={stt.isPreparing}
              isTtsSpeaking={isTtsSpeaking}
              speakingProgress={speakingProgress}
              utteranceRef={utteranceRef}
              ttsRafRef={ttsRafRef}
              streamingUserInput={streamingUserInput}
              lastDiffTokens={lastDiffTokens}
              isAwaitingGemini={isAwaitingGemini}
              retryCount={retryCount}
              paragraphSummary={paragraphSummaries[currentLineIndex] ?? null}
              completedParagraphs={completedParagraphs}
              storyLength={story.content.length}
              lineResults={lineResults}
              allStatuses={lineStatuses}
              onSelectParagraph={handleSelectParagraph}
              onTtsToggle={handleTtsToggle}
              onStartSession={startSession}
              onStopSession={stopSession}
              onSubmitSentence={submitSentence}
              onRetryParagraph={handleRetryParagraph}
              onRetrySentence={handleRetrySentence}
              retrySentenceIdx={retrySentenceInfo?.paragraphIdx === currentLineIndex ? retrySentenceInfo.sentenceIdx : undefined}
              onAdvanceParagraph={advanceParagraph}
              setIsTtsSpeaking={setIsTtsSpeaking}
              setIsTtsPaused={setIsTtsPaused}
              storyContent={story.content}
            />
          </div>

          {/* Stats grid — CPM + Accuracy placeholders */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
            <div className="bg-surface-container-low p-6 rounded-3xl flex items-center gap-5">
              <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-2xl text-emerald-700">speed</span>
              </div>
              <div>
                <div className="font-headline text-on-surface-variant font-bold text-xs uppercase tracking-wider">語速 Reading Speed</div>
                <div className="text-lg font-headline font-bold text-on-surface-variant mt-0.5">開發中</div>
              </div>
            </div>
            <div className="bg-surface-container-low p-6 rounded-3xl flex items-center gap-5">
              <div className="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-2xl text-accent">verified</span>
              </div>
              <div>
                <div className="font-headline text-on-surface-variant font-bold text-xs uppercase tracking-wider">準確度 Accuracy</div>
                <div className="text-lg font-headline font-bold text-on-surface-variant mt-0.5">開發中</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mic error */}
      {micError && (
        <div className="absolute bottom-52 left-1/2 -translate-x-1/2 px-5 py-2 bg-tertiary-container/20 rounded-full z-20">
          <span className="text-sm text-tertiary">{micError}</span>
        </div>
      )}

      {/* No-audio-detected banner */}
      {noAudioDetected && stt.isSessionActive && (
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
              onClick={() => {
                stopSession();
                startSession();
              }}
              className="px-3 py-1 rounded-full text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 transition-all shrink-0"
            >
              重新開始
            </button>
          </div>
        </div>
      )}

      {/* ── Fixed bottom CTA ──────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
           style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
        <div className="max-w-md mx-auto pointer-events-auto flex flex-col items-center gap-3">

          {/* Final report — all paragraphs done */}
          {completedParagraphs.size === story.content.length ? (
            <button
              onClick={handleFinish}
              className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
              style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
            >
              <span>觀看總結報告</span>
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          ) : stt.isSessionActive ? (
            /* Recording active — submit button */
            <button
              onClick={submitSentence}
              disabled={isAwaitingGemini || (!streamingUserInput && !lastDiffTokens)}
              className={`w-full h-14 rounded-full font-headline font-bold text-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${
                isAwaitingGemini || (!streamingUserInput && !lastDiffTokens)
                  ? 'bg-surface-container-high text-on-surface-variant cursor-not-allowed'
                  : 'text-white shadow-[0_12px_48px_rgba(0,105,71,0.3)]'
              }`}
              style={(!isAwaitingGemini && (streamingUserInput || lastDiffTokens)) ? { background: 'linear-gradient(135deg, #006947, #34d399)' } : undefined}
            >
              <span className="material-symbols-outlined text-xl">check</span>
              完成
            </button>
          ) : stt.isPreparing ? (
            <button disabled className="w-full h-14 rounded-full font-headline font-bold text-lg bg-surface-container-high text-on-surface-variant cursor-wait flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-on-surface-variant border-t-transparent rounded-full animate-spin" />
              準備中...
            </button>
          ) : isTtsSpeaking ? (
            /* TTS playing — pause/stop */
            <div className="w-full flex gap-3">
              <button
                onClick={isTtsPaused ? resumeTts : pauseTts}
                className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-accent/10 text-accent hover:bg-accent/15 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {isTtsPaused ? 'play_arrow' : 'pause'}
                </span>
                {isTtsPaused ? '繼續' : '暫停'}
              </button>
              <button
                onClick={stopTts}
                className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>stop</span>
                停止
              </button>
            </div>
          ) : paragraphSummary && !isAdvancing ? (
            /* After evaluation — feedback toggle + retry/next */
            <>
              <button
                type="button"
                onClick={() => setShowFeedback(!showFeedback)}
                className="px-4 py-2 rounded-full bg-surface-container-lowest shadow-sm text-sm font-medium text-on-surface-variant hover:bg-surface-container-low transition-all"
              >
                {showFeedback ? '隱藏回饋' : '查看朗讀回饋'}
              </button>
            </>
          ) : !isAdvancing ? (
            /* Idle — AI朗讀 + 開始朗讀 side by side */
            <div className="w-full flex gap-3">
              <button
                onClick={() => speakCurrentParagraph()}
                className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>volume_up</span>
                AI 朗讀
              </button>
              <button
                onClick={startSession}
                className="flex-1 h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-3 animate-pulse"
                style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
              >
                <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>mic</span>
                {retryCount > 0 ? '再試一次' : '開始朗讀'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Feedback panel as slide-up drawer ──────────────────────── */}
      {showFeedback && (
        <>
          <div className="fixed inset-0 bg-black/20 z-30" onClick={() => setShowFeedback(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface-container-lowest rounded-t-3xl shadow-editorial max-h-[60vh] overflow-y-auto animate-slide-up">
            <div className="sticky top-0 bg-surface-container-lowest px-6 py-4 flex items-center justify-between rounded-t-3xl">
              <span className="font-headline font-bold text-on-surface">朗讀回饋</span>
              <button onClick={() => setShowFeedback(false)} className="w-10 h-10 rounded-full hover:bg-surface-container-high flex items-center justify-center transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="px-6 pb-8">
              <TutorFeedbackPanel
                width={9999}
                isMobile={true}
                scrollRef={scrollRef as React.RefObject<HTMLDivElement>}
                isSessionActive={stt.isSessionActive}
                isPreparing={stt.isPreparing}
                streamingUserInput={streamingUserInput}
                rightPanelDiffTokens={rightPanelDiffTokens}
                paragraphSummary={paragraphSummary}
                currentLineIndex={currentLineIndex}
                totalLines={story.content.length}
                completedCount={completedParagraphs.size}
                retryCount={retryCount}
                micError={micError}
              />
            </div>
          </div>
        </>
      )}

      {/* Background decoration */}
      <div className="fixed -bottom-16 -right-16 w-64 h-64 bg-tertiary/5 rounded-full blur-[100px] pointer-events-none -z-10" />
      <div className="fixed top-1/4 -left-32 w-80 h-80 bg-accent/5 rounded-full blur-[100px] pointer-events-none -z-10" />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #b0ada6; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #797770; }
      `}</style>
    </div>
  );
};

export default LiveTutor;
