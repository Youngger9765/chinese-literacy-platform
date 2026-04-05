import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Story, ReadingAttempt, LiveMessage, DiffToken } from '../../../types';
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
import {
  extractPracticeChars,
} from '../../../utils/liveTutorHelpers';
import { useResizablePanel } from '../../../hooks/useResizablePanel';
import { useLiveTutorSpeech } from '../../../hooks/useLiveTutorSpeech';
import { useTtsPlayback } from '../../../hooks/useTtsPlayback';
import { LineResult } from './helpers';
import ParagraphCard from './ParagraphCard';
import FeedbackPanel from './FeedbackPanel';

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

// Per-paragraph summary type (used by storage + state)
type ParagraphSummaryData = {
  feedback: string;
  matchRate: number;
  wrongCount: number;
  missingCount: number;
  tier: number;
  geminiPending: boolean;
};

const LiveTutor: React.FC<LiveTutorProps> = ({
  story,
  rightPanelWidth,
  onPanelWidthChange,
  onFinish,
  onCancel,
  onParagraphComplete,
  initialCompletedParagraphs,
}) => {
  const { token } = useAuth();
  const isMobile = useIsMobile();
  const { px: fontSizePx } = useFontSize();
  const [currentLineIndex, setCurrentLineIndex] = useState(() => {
    try {
      const raw = localStorage.getItem(`liveTutor_progress_${story.id}`);
      if (raw) { const p = JSON.parse(raw); return p.currentLineIndex ?? 0; }
    } catch {}
    return 0;
  });
  const [isPreparing, setIsPreparing] = useState(false);          // STT initializing
  const [isSessionActive, setIsSessionActive] = useState(false);  // mic actively recording
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [micError, setMicError] = useState('');
  const [streamingUserInput, setStreamingUserInput] = useState('');

  // ── localStorage persistence for reading progress ──────────────────────────
  const storageKey = `liveTutor_progress_${story.id}`;
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
  const [speakingProgress, setSpeakingProgress] = useState(0); // char index cursor during recording
  const [realtimeDiffTokens, setRealtimeDiffTokens] = useState<DiffToken[] | null>(null); // real-time LCS overlay
  // Per-paragraph summary: keyed by lineIndex
  const [paragraphSummaries, setParagraphSummaries] = useState<Record<number, ParagraphSummaryData>>(
    savedProgress.current?.paragraphSummaries ?? {}
  );
  // Convenience: current paragraph's summary
  const paragraphSummary = paragraphSummaries[currentLineIndex] ?? null;

  // Hybrid eval: per-sentence (分期付款) tracking
  const geminiGenRef = useRef(0); // generation counter — replaces AbortController
  const geminiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentenceTargetsRef = useRef<string[]>([]);
  const sentenceResultsRef = useRef<Array<LocalEvalResult | null>>([]);
  const nextSentenceIdxRef = useRef(0);
  const lastFinalResultIdxRef = useRef(-1);
  const streakRef = useRef(0); // mirrors streak for use in STT callbacks

  // Progressive unlock state — track which paragraphs have passed evaluation.
  const [completedParagraphs, setCompletedParagraphs] = useState<Set<number>>(
    savedProgress.current?.completedParagraphs
      ? new Set(savedProgress.current.completedParagraphs)
      : initialCompletedParagraphs ?? new Set<number>()
  );
  // Celebration animation: shows briefly when a new paragraph is unlocked
  const [celebratingIndex, setCelebratingIndex] = useState<number | null>(null);

  const isAdvancingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const evaluateAndRespondRef = useRef<any>(null);

  const sentenceStartTimeRef = useRef(0);
  const lastDiffTimeRef = useRef(0);

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
  const stt = useLiveTutorSpeech({
    targetText: story.content[currentLineIndex] || '',
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
      setMessages(prev => [...prev, {
        id: 'ready-' + Date.now(),
        role: 'model' as const,
        text: '準備好了，請開始朗讀！',
        type: 'feedback' as const,
      }]);
    },
  });

  // Expose STT state/methods with the same names used by the original code
  const startSession = stt.startSession;
  const stopSession = stt.stopSession;

  // Keep component-level state in sync with the hook's internal state
  // (isPreparing, isSessionActive come from stt directly)

  /* ---- scroll helpers ---- */
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamingUserInput]);

  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentLineIndex]);

  /* ---- pre-warm mic permission on mount (eliminates delay on first startSession) ---- */
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

  /* ---- keep streakRef in sync for use in STT callbacks ---- */
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
    // Don't clear paragraphSummaries — they persist across paragraph navigation
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
      geminiGenRef.current++; // invalidate any in-flight Gemini eval
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
    // Save per-paragraph reading to history (#909)
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
      // Last paragraph — finish
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
      setMessages(prev => [...prev,
        { id: Date.now().toString(), role: 'user', text: cleaned, type: 'transcription' },
        { id: (Date.now() + 1).toString(), role: 'model', text: capFeedback, type: 'feedback' },
      ]);
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

  /* ---- submitSentence wrapper — calls stt.submitSentence then evaluates ---- */
  const submitSentence = useCallback(async () => {
    const { transcript, rawStt, durationMs } = stt.submitSentence();
    if (transcript) {
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
      {/* LEFT: Story text panel — completely static, no dynamic text changes */}
      <div className="flex flex-col bg-amber-50 flex-1 min-h-0 overflow-hidden">
        <div className="h-9 bg-white border-b border-gray-200 flex items-center px-2 gap-2">
          <div className="h-full px-4 flex items-center bg-amber-50 border-t-2 border-t-accent border-x border-x-gray-200 text-xs text-gray-800 gap-2">
            {processZhuyin(story.filename)}
          </div>
          <div className="flex-1" />
          <FontSizeControl />
        </div>

        {/* Paragraph progress bar */}
        <ParagraphProgress
          statuses={lineStatuses}
          currentIndex={currentLineIndex}
          onSelectParagraph={(idx) => {
            if (lineStatuses[idx] === 'locked') return;
            stopSession();
            setRetryCount(0);
            setCurrentLineIndex(idx);
          }}
        />

        <div className={`flex-1 ${isMobile ? 'p-4' : 'p-8 lg:p-16'} overflow-y-auto custom-scrollbar`}>
          <div className="max-w-3xl mx-auto space-y-20">
            {story.content.map((line, idx) => {
              const isCelebrating = celebratingIndex === idx;
              const status = lineStatuses[idx];

              return (
                <ParagraphCard
                  key={idx}
                  idx={idx}
                  line={line}
                  status={status}
                  isCelebrating={isCelebrating}
                  currentLineIndex={currentLineIndex}
                  stt={stt}
                  fontSizePx={fontSizePx}
                  zhuyinActive={zhuyinActive}
                  zhuyinLines={zhuyinLines}
                  completedParagraphs={completedParagraphs}
                  paragraphSummaries={paragraphSummaries}
                  isAdvancing={isAdvancing}
                  isAwaitingGemini={isAwaitingGemini}
                  isTtsSpeaking={isTtsSpeaking}
                  utteranceRef={utteranceRef}
                  ttsRafRef={ttsRafRef}
                  speakCurrentParagraph={speakCurrentParagraph}
                  streamingUserInput={streamingUserInput}
                  lastDiffTokens={lastDiffTokens}
                  activeLineRef={activeLineRef}
                  story={story}
                  lineResults={lineResults}
                  retryCount={retryCount}
                  startSession={startSession}
                  stopSession={stopSession}
                  submitSentence={submitSentence}
                  advanceParagraph={advanceParagraph}
                  setCurrentLineIndex={setCurrentLineIndex}
                  setRetryCount={setRetryCount}
                  setParagraphSummaries={setParagraphSummaries}
                  setRealtimeDiffTokens={setRealtimeDiffTokens}
                  setLastDiffTokens={setLastDiffTokens}
                  setIsTtsSpeaking={setIsTtsSpeaking}
                  setIsTtsPaused={setIsTtsPaused}
                />
              );
            })}

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

      <FeedbackPanel
        scrollRef={scrollRef}
        stt={stt}
        currentLineIndex={currentLineIndex}
        story={story}
        completedParagraphs={completedParagraphs}
        retryCount={retryCount}
        streamingUserInput={streamingUserInput}
        rightPanelDiffTokens={rightPanelDiffTokens}
        paragraphSummary={paragraphSummary}
        micError={micError}
        isMobile={isMobile}
        rightPanelWidth={rightPanelWidth}
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
