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
  const [isAnalyzing, setIsAnalyzing] = useState(false); // legacy — kept for status bar compat
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

  // Sentence-level retry state
  const [retrySentenceInfo, setRetrySentenceInfo] = useState<{
    paragraphIdx: number;
    sentenceIdx: number;
    target: string;
    originalTargets: string[];
    originalResults: Array<LocalEvalResult | null>;
  } | null>(null);
  const retrySentenceInfoRef = useRef(retrySentenceInfo);
  retrySentenceInfoRef.current = retrySentenceInfo;
  const handleSentenceRetryEvalRef = useRef<(transcript: string, durationMs: number) => Promise<void>>(async () => {});

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

  /* ---- STT hook ---- */
  // During sentence retry, narrow the realtime diff overlay to just the one sentence
  const sttTargetText = retrySentenceInfo
    ? retrySentenceInfo.target
    : (story.content[currentLineIndex] || '');

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
  });

  const startSession = stt.startSession;
  const stopSession = stt.stopSession;

  /* ---- scroll helpers ---- */
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [streamingUserInput]);

  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    if (!cleaned) return;

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

    const summaryData: ParagraphSummaryData = {
      feedback: localTier <= 2 ? (localFeedback || '唸得不錯！') : (localFeedback || '再試一次，加油！'),
      matchRate: localMatchRate,
      wrongCount,
      missingCount,
      tier: localTier,
      geminiPending: true,
      sentenceResults: [...sentenceResultsRef.current],
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
          // Preserve sentence-level data from local eval
          sentenceResults: prev[lineIdx]?.sentenceResults,
          sentenceTargets: prev[lineIdx]?.sentenceTargets,
          feedback: gemini.feedback || (gemini.tier <= 2 ? '唸得不錯！' : '再試一次，加油！'),
          matchRate: gemini.adjusted_match_rate,
          wrongCount: geminiWrong,
          missingCount: geminiMissing,
          tier: gemini.tier,
          geminiPending: false,
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
      // Sentence retry mode: evaluate only this sentence
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
    // Reset sentence tracking for fresh attempt
    const targets = splitIntoSentences(story.content[idx] || '');
    sentenceTargetsRef.current = targets;
    sentenceResultsRef.current = new Array(targets.length).fill(null);
    nextSentenceIdxRef.current = 0;
    lastFinalResultIdxRef.current = -1;
    // Clear any active sentence retry
    retrySentenceInfoRef.current = null;
    setRetrySentenceInfo(null);
    if (idx === currentLineIndex) { startSession(); }
    else { setTimeout(() => startSession(), 100); }
  }, [currentLineIndex, story.content, stopSession, startSession]);

  /* ---- handleRetrySentence: enter single-sentence retry mode ---- */
  const handleRetrySentence = useCallback((paragraphIdx: number, sentenceIdx: number) => {
    if (paragraphIdx !== currentLineIndex) return;
    stopSession();

    const sentences = splitIntoSentences(story.content[paragraphIdx] || '');
    const target = sentences[sentenceIdx];
    // Don't retry single-char sentences (issue 661: 單獨一個字不用重練)
    if (!target || target.replace(CHINESE_PUNCTUATION_REGEX, '').length <= 1) return;

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

  /* ---- handleSentenceRetryEval: evaluate single-sentence retry result ---- */
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
      streak,
    );
    newResults[info.sentenceIdx] = localResult;
    // Show the retried sentence's diff in the right panel
    setLastDiffTokens(localResult.diffTokens);
    setRealtimeDiffTokens(null);

    sentenceResultsRef.current = newResults;
    nextSentenceIdxRef.current = info.originalTargets.length;
    retrySentenceInfoRef.current = null;
    setRetrySentenceInfo(null);

    // ── Weighted delta: only adjust the retried sentence's contribution ──────
    // This preserves accuracy for sentences not individually tracked by STT,
    // fixing the "28% after 100% retry" bug caused by dividing partial
    // sentence diffTokens by the full paragraph length.
    const paragraphTarget = story.content[info.paragraphIdx] || '';
    const paragraphLen = normalizeForComparison(paragraphTarget).length || 1;
    const sentenceLen = normalizeForComparison(info.target).length;
    const sentenceWeight = sentenceLen / paragraphLen;

    // The sentence's previous individual match rate (null if STT didn't capture it separately).
    // When null, we fall back to the paragraph's current matchRate inside each state updater —
    // this avoids the double-counting that occurs when defaulting to 0 (the paragraph's existing
    // matchRate already includes this sentence's contribution from the full-paragraph eval).
    const sentenceMatchRateFromResult = info.originalResults[info.sentenceIdx]?.matchRate;
    const newSentenceMatchRate = localResult?.matchRate;

    const oldWrong = info.originalResults[info.sentenceIdx]?.diffTokens.filter(t => t.type === 'wrong').length ?? 0;
    const oldMissing = info.originalResults[info.sentenceIdx]?.diffTokens.filter(t => t.type === 'missing').length ?? 0;
    const newWrong = localResult?.diffTokens.filter(t => t.type === 'wrong').length ?? oldWrong;
    const newMissing = localResult?.diffTokens.filter(t => t.type === 'missing').length ?? oldMissing;

    setParagraphSummaries(prev => {
      const existing = prev[info.paragraphIdx];
      if (!existing) return prev;
      // If sentence wasn't individually tracked, assume it matched at the paragraph average rate
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

    // Update the most recent lineResult matchRate with the same delta
    setLineResults(prev => {
      let idx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].lineIndex === info.paragraphIdx) { idx = i; break; }
      }
      if (idx === -1) return prev;
      const updated = [...prev];
      // If sentence wasn't individually tracked, assume it matched at the paragraph average rate
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
  }, [streak, story.content, stopSession, startSession]);
  // Keep ref in sync so submitSentence (memoized) always calls the latest version
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

  return (
    <div
      className={`flex flex-1 h-full bg-amber-50 overflow-hidden ${isMobile ? 'flex-col' : 'flex-row'}`}
      style={{
        fontFamily: zhuyinActive
          ? "'BpmfIansui', 'Iansui', 'Noto Sans TC', sans-serif"
          : "'Iansui', 'Noto Sans TC', sans-serif",
      }}
    >
      {/* LEFT: Story text panel */}
      <div className="flex flex-col bg-amber-50 flex-1 min-h-0 overflow-hidden">
        <div className="h-9 bg-white border-b border-gray-200 flex items-center px-2 gap-2">
          <div className="flex-1" />
          <FontSizeControl />
        </div>

        {/* Paragraph progress bar */}
        <ParagraphProgress
          statuses={lineStatuses}
          currentIndex={currentLineIndex}
          onSelectParagraph={(idx) => {
            if (lineStatuses[idx] === 'locked') return;
            handleSelectParagraph(idx);
          }}
        />

        <div className={`flex-1 ${isMobile ? 'p-4' : 'p-8 lg:p-16'} overflow-y-auto custom-scrollbar`}>
          <div className="max-w-3xl mx-auto space-y-20">
            {story.content.map((line, idx) => (
              <div
                key={idx}
                ref={idx === currentLineIndex ? activeLineRef : null}
              >
                <ParagraphCard
                  idx={idx}
                  line={line}
                  status={lineStatuses[idx]}
                  isCelebrating={celebratingIndex === idx}
                  currentLineIndex={currentLineIndex}
                  isAdvancing={isAdvancing}
                  fontSizePx={fontSizePx}
                  zhuyinLine={zhuyinLines ? zhuyinLines[idx] : null}
                  zhuyinActive={zhuyinActive}
                  isSessionActive={stt.isSessionActive}
                  isPreparing={stt.isPreparing}
                  isTtsSpeaking={isTtsSpeaking}
                  utteranceRef={utteranceRef}
                  ttsRafRef={ttsRafRef}
                  streamingUserInput={streamingUserInput}
                  lastDiffTokens={lastDiffTokens}
                  isAwaitingGemini={isAwaitingGemini}
                  retryCount={retryCount}
                  paragraphSummary={paragraphSummaries[idx] ?? null}
                  completedParagraphs={completedParagraphs}
                  storyLength={story.content.length}
                  lineResults={lineResults}
                  onSelectParagraph={handleSelectParagraph}
                  onTtsToggle={handleTtsToggle}
                  onStartSession={startSession}
                  onStopSession={stopSession}
                  onSubmitSentence={submitSentence}
                  onRetryParagraph={handleRetryParagraph}
                  onRetrySentence={handleRetrySentence}
                  retrySentenceIdx={retrySentenceInfo?.paragraphIdx === idx ? retrySentenceInfo.sentenceIdx : undefined}
                  onAdvanceParagraph={advanceParagraph}
                  setIsTtsSpeaking={setIsTtsSpeaking}
                  setIsTtsPaused={setIsTtsPaused}
                  storyContent={story.content}
                />
              </div>
            ))}

            {/* Final report button — shown after all paragraphs are completed */}
            {completedParagraphs.size === story.content.length && (
              <div className="mt-8 flex justify-center">
                <button
                  onClick={handleFinish}
                  className="px-6 py-2.5 rounded-full text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg transition-all active:scale-95"
                >
                  觀看總結報告
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Mic error */}
        {micError && (
          <div className="flex-shrink-0 px-4 py-2 bg-rose-50">
            <span className="text-xs text-rose-500">{micError}</span>
          </div>
        )}
      </div>

      {/* Resizable divider - hidden on mobile */}
      {!isMobile && (
        <div
          onMouseDown={onDividerMouseDown}
          onTouchStart={onDividerTouchStart}
          className="w-1 flex-shrink-0 bg-gray-200 hover:bg-accent cursor-col-resize transition-colors"
        />
      )}

      {/* RIGHT: Feedback panel */}
      <TutorFeedbackPanel
        width={rightPanelWidth}
        isMobile={isMobile}
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

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #30363d; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #4b5563; }
      `}</style>
    </div>
  );
};

export default LiveTutor;
