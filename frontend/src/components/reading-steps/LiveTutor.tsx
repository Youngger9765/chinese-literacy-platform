
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Story, ReadingAttempt, LiveMessage, DiffToken } from '../../types';
import { correctHomophones, isHomophone } from '../../utils/pinyin';
import { diffCharacters, normalizeForComparison, cleanChineseText } from '../../utils/textDiff';
import DiffDisplay from '../ui/DiffDisplay';
import { PolyphonicProcessor, buildZhuyinString } from '../zhuyin/polyphonicProcessor';
import ZhuyinToggle from '../ui/ZhuyinToggle';
import FontSizeControl, { useFontSize } from '../ui/FontSizeControl';
import { useIsMobile } from '../../hooks/useIsMobile';
import { READING_EXCELLENT, READING_PASS } from '../../utils/personaConfig';
import RecordingButton from '../recording/RecordingButton';
import ParagraphProgress, { ParagraphStatus } from './ParagraphProgress';
import { evaluateReading } from '../../services/learningApi';
import { useAuth } from '../../contexts/AuthContext';
import {
  localEvaluateParagraph,
  splitIntoSentences,
  getReadingPassThreshold,
  type LocalEvalResult,
} from '../../utils/localEval';

/* ------------------------------------------------------------------ */
/*  Canned response pools — randomly selected to avoid repetition     */
/* ------------------------------------------------------------------ */

const TIER1_POOL = [
  '唸得很棒！下一段。',
  '真厲害！下一段。',
  '讀得好清楚！下一段。',
  '好棒喔！下一段。',
  '很流利呢！下一段。',
  '讀得很棒！下一段。',
];

const TIER2_POOL = [
  '唸得不錯！下一段。',
  '很好！下一段。',
  '不錯不錯！下一段。',
  '加油，繼續下一段！',
  '很好！繼續加油！',
  '讀得不錯喔！下一段。',
];

const TIER3_POOL = [
  '還差一點點，再試一次！',
  '沒關係，再念一遍看看。',
  '加油！再念一次。',
  '再試一次，你可以的！',
  '慢慢來，再唸一遍。',
  '不要急，再讀一次喔。',
  '別灰心，再念一次！',
  '仔細看一看，再念一遍。',
];

const STREAK_MESSAGES = [
  '', // 0 streak — unused
  '', // 1 streak — just use normal pool
  '', // 2 streak — just use normal pool
  '連續三段都唸對了，好厲害！',
  '連續四段了！你好棒！',
  '五段都對！你是朗讀小達人！',
];

const LAST_LINE_MESSAGE = '全部唸完了！你好棒，辛苦了！';

const pick = (pool: string[]) => pool[Math.floor(Math.random() * pool.length)];

/* ------------------------------------------------------------------ */
/*  Moving cursor helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * Greedy forward match: count how many normalized target chars have been
 * covered by the interim transcript. Homophone-aware.
 */
function calcSpeakingProgress(interim: string, target: string): number {
  const s = Array.from(normalizeForComparison(interim));
  const t = Array.from(normalizeForComparison(target));
  let j = 0;
  for (let i = 0; i < s.length && j < t.length; i++) {
    if (s[i] === t[j] || isHomophone(s[i], t[j])) j++;
  }
  return j;
}

/**
 * Map a count of normalized (punctuation-stripped) matched chars back to
 * the corresponding index in the original target string.
 * Returns the index of the first character not yet covered (cursor position).
 */
function normalizedToOrigIdx(target: string, normalizedProgress: number): number {
  let norm = 0;
  for (let i = 0; i < target.length; i++) {
    if (norm >= normalizedProgress) return i;
    if (!/[「」『』，。！？：；、\s]/.test(target[i])) norm++;
  }
  return target.length;
}

const IS_PUNCT = /[「」『』，。！？：；、\s]/;

/**
 * Render the original paragraph with diff annotations below each character.
 * Punctuation is kept as-is. For each content char, consume the next
 * non-extra diff token and apply colored underline / sub-text.
 *
 * Rendering rules (below the original char):
 *   correct  → no annotation
 *   forgiven → blue dotted underline
 *   missing  → gray dashed underline + reduced opacity (char was skipped)
 *   wrong    → red solid underline + small red spoken char below
 *   extra    → skipped (no target position)
 */
function renderLineWithDiff(
  originalLine: string,
  tokens: DiffToken[],
  fontSizePx: string | number,
  extraClass: string,
): React.ReactNode {
  let tokenIdx = 0;

  const chars = Array.from(originalLine).map((ch, i) => {
    if (IS_PUNCT.test(ch)) {
      return <span key={i} className="text-gray-400">{ch}</span>;
    }

    // Skip extra tokens — they have no target position
    while (tokenIdx < tokens.length && tokens[tokenIdx].type === 'extra') tokenIdx++;
    const token = tokens[tokenIdx++];

    if (!token || token.type === 'correct') {
      return <span key={i}>{ch}</span>;
    }
    if (token.type === 'forgiven') {
      return (
        <span key={i} className="inline-flex flex-col items-center border-b-2 border-dotted border-sky-400">
          {ch}
        </span>
      );
    }
    if (token.type === 'missing') {
      return (
        <span key={i} className="inline-flex flex-col items-center opacity-40 border-b-2 border-dashed border-gray-400">
          {ch}
        </span>
      );
    }
    if (token.type === 'wrong') {
      return (
        <span
          key={i}
          className="inline-flex flex-col items-center border-b-2 border-red-500"
          title={`讀成「${token.char}」，應是「${ch}」`}
        >
          <span>{ch}</span>
          <span className="text-red-500 leading-none" style={{ fontSize: `calc(${fontSizePx} * 0.55)` }}>
            {token.char}
          </span>
        </span>
      );
    }
    return <span key={i}>{ch}</span>;
  });

  return (
    <p className={`leading-[4rem] ${extraClass}`} style={{ fontSize: fontSizePx }}>
      {chars}
    </p>
  );
}

/**
 * Extract Chinese characters the student actually missed on their LAST attempt
 * per paragraph. Characters present in the target but absent from the
 * (homophone-corrected) spoken transcript are collected.
 *
 * Using only the last attempt per line is fair: if the student retried and
 * eventually read the paragraph well, we don't penalise earlier stumbles.
 */
const extractPracticeChars = (results: LineResult[], content: string[]): string[] => {
  // Keep only the last result for each lineIndex
  const lastByLine = new Map<number, LineResult>();
  for (const r of results) {
    lastByLine.set(r.lineIndex, r); // later entry overwrites earlier
  }

  const chars = new Set<string>();
  for (const r of lastByLine.values()) {
    const targetText = content[r.lineIndex] || '';
    const targetNorm = normalizeForComparison(targetText);
    const spokenNorm = normalizeForComparison(
      correctHomophones(r.transcript, targetNorm),
    );

    // Build spoken character frequency map
    const spokenFreq: Record<string, number> = {};
    for (const ch of spokenNorm) {
      if (/[\u4e00-\u9fa5]/.test(ch)) spokenFreq[ch] = (spokenFreq[ch] || 0) + 1;
    }

    // Collect target characters that were not (fully) spoken
    for (const ch of targetNorm) {
      if (/[\u4e00-\u9fa5]/.test(ch)) {
        if (!spokenFreq[ch] || spokenFreq[ch] <= 0) {
          chars.add(ch);
        } else {
          spokenFreq[ch]--;
        }
      }
    }
  }
  return Array.from(chars).slice(0, 12);
};

/* ------------------------------------------------------------------ */
/*  Per-line result tracking                                          */
/* ------------------------------------------------------------------ */

interface LineResult {
  lineIndex: number;
  matchRate: number;
  cpm: number;
  durationMs: number;
  transcript: string;
  diffTokens: DiffToken[];
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
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
  const { token } = useAuth();
  const isMobile = useIsMobile();
  const { px: fontSizePx } = useFontSize();
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [isPreparing, setIsPreparing] = useState(false);          // STT initializing
  const [isSessionActive, setIsSessionActive] = useState(false);  // mic actively recording
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [micError, setMicError] = useState('');
  const [streamingUserInput, setStreamingUserInput] = useState('');
  const [lineResults, setLineResults] = useState<LineResult[]>([]);
  const [streak, setStreak] = useState(0);
  const [zhuyinEnabled, setZhuyinEnabled] = useState(true);
  const [zhuyinReady, setZhuyinReady] = useState(false);
  const [isTtsSpeaking, setIsTtsSpeaking] = useState(false);
  const [isTtsPaused, setIsTtsPaused] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false); // legacy — kept for status bar compat
  const [isAwaitingGemini, setIsAwaitingGemini] = useState(false);
  const [lastDiffTokens, setLastDiffTokens] = useState<DiffToken[] | null>(null);
  const [showRecorder, setShowRecorder] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [speakingProgress, setSpeakingProgress] = useState(0); // char index cursor during recording

  // Hybrid eval: per-sentence (分期付款) tracking
  const geminiAbortRef = useRef<AbortController | null>(null);
  const sentenceTargetsRef = useRef<string[]>([]);
  const sentenceResultsRef = useRef<Array<LocalEvalResult | null>>([]);
  const nextSentenceIdxRef = useRef(0);
  const lastFinalResultIdxRef = useRef(-1);
  const streakRef = useRef(0); // mirrors streak for use in STT callbacks

  // Progressive unlock state — track which paragraphs have passed evaluation.
  const [completedParagraphs, setCompletedParagraphs] = useState<Set<number>>(
    initialCompletedParagraphs ?? new Set<number>()
  );
  // Celebration animation: shows briefly when a new paragraph is unlocked
  const [celebratingIndex, setCelebratingIndex] = useState<number | null>(null);

  const isAdvancingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(320);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  // Strong ref to TTS utterance — prevents Chrome GC bug where a local utterance
  // gets collected mid-playback, silencing onend/onboundary callbacks.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // rAF loop for TTS cursor animation — Chrome's onboundary doesn't fire per-char for Chinese.
  const ttsRafRef = useRef<number | null>(null);
  const ttsStartTimeRef = useRef<number>(0);
  const ttsTotalCharsRef = useRef<number>(0);
  const isSessionActiveRef = useRef(false);   // true while recording
  const sentenceStartTimeRef = useRef(0);     // when current sentence reading began
  const currentTranscriptRef = useRef('');     // full transcript (accumulated + current session)
  const rawSttRef = useRef('');               // raw STT output for logging
  const accumulatedTranscriptRef = useRef(''); // transcript preserved across auto-reconnects
  const currentLineIndexRef = useRef(0);      // mirrors currentLineIndex for async callbacks
  const evaluateAndRespondRef = useRef<any>(null);

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

  /* ---- initialize polyphonic processor for zhuyin ---- */
  useEffect(() => {
    PolyphonicProcessor.instance.loadPolyphonicData()
      .then(() => setZhuyinReady(true))
      .catch((err) => console.error('Failed to load zhuyin data:', err));
  }, []);

  /** Whether zhuyin rendering is active */
  const zhuyinActive = zhuyinReady && zhuyinEnabled;

  /** Process a Chinese text string through the polyphonic processor for zhuyin rendering */
  const processZhuyin = useCallback((text: string): string => {
    if (!zhuyinActive) return text;
    try {
      const processed = PolyphonicProcessor.instance.process(text);
      return buildZhuyinString(processed);
    } catch {
      return text;
    }
  }, [zhuyinActive]);

  /** Pre-process each story line through the polyphonic processor for zhuyin rendering */
  const zhuyinLines = useMemo(() => {
    if (!zhuyinActive) return null;
    try {
      return story.content.map((line) => {
        const processed = PolyphonicProcessor.instance.process(line);
        return buildZhuyinString(processed);
      });
    } catch {
      return null;
    }
  }, [story.content, zhuyinActive]);

  /** Compute completed/current/locked status for each paragraph.
   *  A paragraph is 'completed' only if it passed evaluation.
   *  Paragraphs beyond the current unlocked index are 'locked'. */
  const lineStatuses = useMemo<ParagraphStatus[]>(() => {
    return story.content.map((_, idx) => {
      if (completedParagraphs.has(idx)) return 'completed';
      if (idx === currentLineIndex) return 'current';
      return 'locked';
    });
  }, [story.content, completedParagraphs, currentLineIndex]);

  /** Highest paragraph index that is unlocked (either completed or currently active). */
  const maxUnlockedIndex = useMemo(() => {
    // All completed paragraphs + current one
    let max = currentLineIndex;
    for (const idx of completedParagraphs) {
      if (idx > max) max = idx;
    }
    return max;
  }, [completedParagraphs, currentLineIndex]);

  /* ---- resizable right panel ---- */
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = dragStartXRef.current - e.clientX;
      onPanelWidthChange(Math.max(240, Math.min(600, dragStartWidthRef.current + delta)));
    };
    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current) return;
      const delta = dragStartXRef.current - e.touches[0].clientX;
      onPanelWidthChange(Math.max(240, Math.min(600, dragStartWidthRef.current + delta)));
    };
    const onTouchEnd = () => {
      isDraggingRef.current = false;
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  const onDividerMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = rightPanelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

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
  }, [currentLineIndex, story.content]);

  /* ---- cleanup on unmount ---- */
  useEffect(() => {
    return () => {
      isSessionActiveRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (_) {}
      }
      if (ttsRafRef.current !== null) {
        cancelAnimationFrame(ttsRafRef.current);
        ttsRafRef.current = null;
      }
      window.speechSynthesis?.cancel();
      geminiAbortRef.current?.abort();
    };
  }, []);

  /* ================================================================ */
  /*  Core: evaluate the student's reading and respond                */
  /* ================================================================ */

  /* ---- Helper: advance or finish after a successful paragraph ---- */
  const advanceParagraph = useCallback((lineIdx: number, allLineResults: LineResult[]) => {
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
  }, [story, onFinish, onParagraphComplete]);

  /* ---- Hybrid evaluation: local first, Gemini only on FAIL ---- */
  const evaluateAndRespond = useCallback(async (rawTranscript: string, rawStt: string, durationMs: number, lineIdx: number) => {
    const targetText = story.content[lineIdx] || '';
    const cleaned = cleanChineseText(rawTranscript);
    if (!cleaned) return;

    // ── Phase 1: local eval (instant, <1ms) ─────────────────────────────────
    // Prefer accumulated per-sentence results from isFinal events.
    // Fall back to whole-paragraph local eval if no isFinal events captured.
    const sentResults = sentenceResultsRef.current.filter(Boolean) as LocalEvalResult[];

    let localTier: 1 | 2 | 3;
    let localDiffTokens: DiffToken[];
    let localFeedback: string;
    let localMatchRate: number;
    let localCpm: number;

    if (sentResults.length > 0) {
      // Compute overall from per-sentence results
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
      // No isFinal events — whole-paragraph local eval
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

    // ── Phase 2: local PASS → advance immediately, no Gemini ─────────────────
    if (localTier <= 2) {
      const newStreak = streak + 1;
      let effectiveFeedback = localFeedback;
      if (newStreak >= 3 && newStreak < STREAK_MESSAGES.length && STREAK_MESSAGES[newStreak]) {
        effectiveFeedback = STREAK_MESSAGES[newStreak];
      } else if (!effectiveFeedback) {
        effectiveFeedback = localTier === 1 ? pick(TIER1_POOL) : pick(TIER2_POOL);
      }
      setStreak(newStreak);
      setRetryCount(0);
      setMessages(prev => [...prev,
        { id: Date.now().toString(), role: 'user', text: cleaned, type: 'transcription' },
        { id: (Date.now() + 1).toString(), role: 'model', text: effectiveFeedback, type: 'feedback' },
      ]);
      setStreamingUserInput('');
      const passResult: LineResult = { lineIndex: lineIdx, matchRate: localMatchRate, cpm: localCpm, durationMs, transcript: cleaned, diffTokens: localDiffTokens };
      const allResults = [...lineResults, passResult];
      setLineResults(allResults);
      advanceParagraph(lineIdx, allResults);
      return; // Gemini NOT called
    }

    // ── Phase 3: local FAIL → show local result, try Gemini upgrade ──────────
    setRetryCount(prev => prev + 1);
    const failFeedback = localFeedback || pick(TIER3_POOL);
    setMessages(prev => [...prev,
      { id: Date.now().toString(), role: 'user', text: cleaned, type: 'transcription' },
      { id: (Date.now() + 1).toString(), role: 'model', text: failFeedback, type: 'feedback' },
    ]);
    setStreamingUserInput('');
    const localResult: LineResult = { lineIndex: lineIdx, matchRate: localMatchRate, cpm: localCpm, durationMs, transcript: cleaned, diffTokens: localDiffTokens };
    const allResultsWithLocal = [...lineResults, localResult];
    setLineResults(allResultsWithLocal);

    // Async Gemini upgrade (homophone rescue)
    setIsAwaitingGemini(true);
    setIsAnalyzing(true); // keep status bar in sync
    geminiAbortRef.current?.abort();
    geminiAbortRef.current = new AbortController();

    const timeoutId = setTimeout(() => geminiAbortRef.current?.abort(), 5000);

    evaluateReading(cleaned, targetText, durationMs, token ?? undefined, geminiAbortRef.current.signal)
      .then(gemini => {
        clearTimeout(timeoutId);
        setIsAwaitingGemini(false);
        setIsAnalyzing(false);
        setLastDiffTokens(gemini.diff_tokens);

        if (gemini.tier <= 2) {
          // Gemini upgraded to PASS (homophone rescue)
          const upgradeFeedback = gemini.feedback || '好消息，你過了！';
          setMessages(prev => [...prev,
            { id: Date.now().toString(), role: 'model', text: upgradeFeedback, type: 'feedback' },
          ]);
          setStreak(prev => prev + 1);
          setRetryCount(0);
          const geminiResult: LineResult = {
            lineIndex: lineIdx,
            matchRate: gemini.adjusted_match_rate,
            cpm: Math.round(gemini.cpm ?? localCpm),
            durationMs,
            transcript: cleaned,
            diffTokens: gemini.diff_tokens,
          };
          // Replace the local result we just added with the Gemini result
          setLineResults(prev => [...prev.slice(0, -1), geminiResult]);
          advanceParagraph(lineIdx, [...lineResults, geminiResult]);
        }
        // Gemini confirms FAIL: diff colors updated (setLastDiffTokens above), retry stays
      })
      .catch(err => {
        clearTimeout(timeoutId);
        setIsAwaitingGemini(false);
        setIsAnalyzing(false);
        if (err.name !== 'AbortError') {
          console.warn('[LiveTutor] Gemini eval failed, local result stands:', err);
        }
        // Local result already displayed — no UX change
      });
  }, [story, streak, lineResults, onFinish, onParagraphComplete, retryCount, token, advanceParagraph]);

  // Sync refs so async callbacks (onend) always see latest values
  evaluateAndRespondRef.current = evaluateAndRespond;
  currentLineIndexRef.current = currentLineIndex;

  /* ================================================================ */
  /*  Web Speech API — continuous session                              */
  /*  – Recognition starts once and stays open across sentences        */
  /*  – continuous = true  → never cuts off on pauses                  */
  /*  – auto-reconnects on browser/API timeout                         */
  /*  – user clicks 完成這段 to submit; recognition keeps running      */
  /* ================================================================ */

  const startSession = () => {
    if (isSessionActiveRef.current) return;
    // Null out TTS callbacks before cancel() so any async onend/onerror from
    // the previous utterance cannot stomp on the STT cursor position.
    if (utteranceRef.current) {
      utteranceRef.current.onstart = null;
      utteranceRef.current.onboundary = null;
      utteranceRef.current.onend = null;
      utteranceRef.current.onerror = null;
      utteranceRef.current = null;
    }
    if (ttsRafRef.current !== null) {
      cancelAnimationFrame(ttsRafRef.current);
      ttsRafRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setIsTtsSpeaking(false);
    setIsTtsPaused(false);
    setIsPreparing(true);
    setMicError('');

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicError('您的瀏覽器不支援語音辨識，請使用 Chrome 瀏覽器。');
      setIsPreparing(false);
      return;
    }

    // Note: mic permission is pre-warmed on mount. If not yet granted,
    // recognition.start() will trigger the browser permission dialog and
    // onerror('not-allowed') handles denial.

    const recognition = new SpeechRecognition();
    recognition.lang = 'cmn-Hant-TW';  // BCP 47: Mandarin, Traditional script, Taiwan
    recognition.continuous = true;       // KEEP listening — never cut off on pauses
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsPreparing(false);
      if (!isSessionActiveRef.current) {
        // First start — set accurate sentence timer & show "ready" signal
        sentenceStartTimeRef.current = Date.now();
        isSessionActiveRef.current = true;
        setIsSessionActive(true);
        setMessages(prev => [...prev, {
          id: 'ready-' + Date.now(),
          role: 'model' as const,
          text: '準備好了，請開始朗讀！',
          type: 'feedback' as const,
        }]);
      }
      // On reconnects / submitSentence restarts, isSessionActiveRef is already true → no-op
    };

    recognition.onresult = (event: any) => {
      // Build transcript from this recognition session's results
      let sessionTranscript = '';
      for (let i = 0; i < event.results.length; i++) {
        sessionTranscript += event.results[i][0].transcript;
      }
      // Combine with transcript accumulated from previous sessions (auto-reconnects)
      const fullTranscript = accumulatedTranscriptRef.current + sessionTranscript;
      rawSttRef.current = fullTranscript;
      currentTranscriptRef.current = fullTranscript;
      setStreamingUserInput(cleanChineseText(fullTranscript));

      // Update moving cursor: map interim transcript progress onto original target chars
      const targetText = story.content[currentLineIndexRef.current] || '';
      const normProgress = calcSpeakingProgress(fullTranscript, targetText);
      setSpeakingProgress(normalizedToOrigIdx(targetText, normProgress));

      // ── 分期付款: per-sentence local eval on isFinal events ────────────────
      // Each isFinal chunk is mapped to the next un-evaluated sentence target.
      // Result diffTokens are accumulated so the student sees progressive colors.
      for (let i = lastFinalResultIdxRef.current + 1; i < event.results.length; i++) {
        if (!event.results[i].isFinal) break; // non-final → stop (results are ordered)
        lastFinalResultIdxRef.current = i;
        const sentIdx = nextSentenceIdxRef.current;
        const sentTargets = sentenceTargetsRef.current;
        if (sentIdx >= sentTargets.length) continue; // extra speech after all sentences

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
        // Accumulate tokens for progressive display in the right panel
        setLastDiffTokens(prev => prev ? [...prev, ...localResult.diffTokens] : localResult.diffTokens);
      }
    };

    recognition.onerror = (event: any) => {
      console.warn('SpeechRecognition error:', event.error);
      if (event.error === 'not-allowed') {
        setMicError('請允許麥克風權限後再試一次。');
        isSessionActiveRef.current = false;
        setIsSessionActive(false);
        setIsPreparing(false);
      } else if (event.error === 'audio-capture') {
        setMicError('找不到麥克風，請確認麥克風已連接後再試一次。');
        isSessionActiveRef.current = false;
        setIsSessionActive(false);
        setIsPreparing(false);
      }
      // Other errors (no-speech, network, aborted) → onend will handle reconnect
    };

    recognition.onend = () => {
      if (isSessionActiveRef.current) {
        // Browser/API timed out — seamlessly reconnect
        if (import.meta.env.DEV) {
          console.log('[SpeechRecognition] Auto-reconnecting…');
        }
        accumulatedTranscriptRef.current = currentTranscriptRef.current;
        try { recognition.start(); } catch (_) {}
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
    setStreamingUserInput('');
    setSpeakingProgress(0);

    recognition.start();
    // Note: isSessionActive & sentenceStartTimeRef are set in onstart once STT is truly ready
  };

  /** Submit the current sentence for evaluation. Recognition keeps running. */
  const submitSentence = useCallback(async () => {
    const transcript = currentTranscriptRef.current;
    const rawStt = rawSttRef.current;
    const durationMs = Date.now() - sentenceStartTimeRef.current;

    // Reset transcript for next sentence & restart recognition (near-instant)
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (_) {}
      currentTranscriptRef.current = '';
      rawSttRef.current = '';
      accumulatedTranscriptRef.current = '';
      setStreamingUserInput('');
      setLastDiffTokens(null);
      sentenceStartTimeRef.current = Date.now();
      // Immediately restart — onend will also try but catch silently
      if (isSessionActiveRef.current) {
        try { recognitionRef.current.start(); } catch (_) {}
      }
    }

    if (transcript) {
      await evaluateAndRespondRef.current(transcript, rawStt, durationMs, currentLineIndexRef.current);
    }
  }, []);

  /** Stop the entire session (for navigation / story switching / finishing). */
  const stopSession = () => {
    isSessionActiveRef.current = false;
    setIsSessionActive(false);
    setIsPreparing(false);
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (_) {}
      recognitionRef.current = null;
    }
    currentTranscriptRef.current = '';
    rawSttRef.current = '';
    accumulatedTranscriptRef.current = '';
    setStreamingUserInput('');
    setSpeakingProgress(0);
  };

  /** Use browser TTS to read the current paragraph aloud. */
  const speakCurrentParagraph = useCallback(() => {
    const text = story.content[currentLineIndex];
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setIsTtsPaused(false);

    const doSpeak = () => {
      const utterance = new SpeechSynthesisUtterance(text);
      // Hold a strong ref — prevents Chrome GC bug where the utterance object
      // is collected before onend/onboundary fire.
      utteranceRef.current = utterance;
      utterance.lang = 'zh-TW';
      utterance.rate = 1.0;

      // Prefer Google Taiwan, fall back to any zh-TW, then any zh
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find(v => v.name.includes('Google') && v.name.includes('Taiwan')) ||
        voices.find(v => v.name.includes('Google') && v.lang === 'zh-TW') ||
        voices.find(v => v.lang === 'zh-TW') ||
        voices.find(v => v.lang.startsWith('zh'));
      if (preferred) utterance.voice = preferred;

      utterance.onstart = () => {
        setIsTtsSpeaking(true);
        setSpeakingProgress(0);
        // Chrome's onboundary doesn't fire per-character for Chinese TTS.
        // Drive the cursor with a time-based rAF loop instead (~4 chars/sec).
        ttsStartTimeRef.current = performance.now();
        ttsTotalCharsRef.current = Array.from(text).length;
        const MS_PER_CHAR = 240; // ~4.2 chars/sec — tuned for zh-TW Google TTS at rate 1.0
        const animate = () => {
          const elapsed = performance.now() - ttsStartTimeRef.current;
          const pos = Math.min(Math.floor(elapsed / MS_PER_CHAR), ttsTotalCharsRef.current);
          setSpeakingProgress(pos);
          if (pos < ttsTotalCharsRef.current) {
            ttsRafRef.current = requestAnimationFrame(animate);
          }
        };
        ttsRafRef.current = requestAnimationFrame(animate);
      };
      // onboundary still used if it fires — provides more accurate positions.
      utterance.onboundary = (e) => { setSpeakingProgress(e.charIndex); };
      const stopTtsAnimation = () => {
        if (ttsRafRef.current !== null) {
          cancelAnimationFrame(ttsRafRef.current);
          ttsRafRef.current = null;
        }
      };
      // Note: do NOT call setSpeakingProgress(0) here — if STT is active, that
      // would reset the cursor position that the student has already advanced.
      utterance.onend = () => { stopTtsAnimation(); utteranceRef.current = null; setIsTtsSpeaking(false); setIsTtsPaused(false); };
      utterance.onerror = () => { stopTtsAnimation(); utteranceRef.current = null; setIsTtsSpeaking(false); setIsTtsPaused(false); };
      window.speechSynthesis.speak(utterance);
    };

    // If voices not yet loaded, wait for them then speak
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        doSpeak();
      };
    } else {
      doSpeak();
    }
  }, [story.content, currentLineIndex]);

  const pauseTts = () => {
    window.speechSynthesis?.pause();
    setIsTtsPaused(true);
  };
  const resumeTts = () => {
    window.speechSynthesis?.resume();
    setIsTtsPaused(false);
  };
  const stopTts = () => {
    if (ttsRafRef.current !== null) {
      cancelAnimationFrame(ttsRafRef.current);
      ttsRafRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setIsTtsSpeaking(false);
    setIsTtsPaused(false);
  };

  /* ================================================================ */
  /*  Finish / manual nav                                             */
  /* ================================================================ */

  const handleFinish = () => {
    stopSession();
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

  return (
    <div
      className="flex flex-col flex-1 h-full bg-amber-50 overflow-hidden"
      style={{
        fontFamily: zhuyinActive
          ? "'BpmfIansui', 'Iansui', 'Noto Sans TC', sans-serif"
          : "'Iansui', 'Noto Sans TC', sans-serif",
      }}
    >
      {/* CENTER: Editor - story text panel */}
      <div className="flex flex-col bg-amber-50 flex-1 min-h-0 overflow-hidden">
        <div className="h-9 bg-white border-b border-gray-200 flex items-center px-2 gap-2">
          <div className="h-full px-4 flex items-center bg-amber-50 border-t-2 border-accent border-x border-gray-200 text-xs text-gray-800 gap-2">
            {processZhuyin(story.filename)}
          </div>
          <div className="flex-1" />
          <FontSizeControl />
          <ZhuyinToggle enabled={zhuyinEnabled} ready={zhuyinReady} onToggle={() => setZhuyinEnabled(!zhuyinEnabled)} />
        </div>

        {/* Paragraph progress bar */}
        <ParagraphProgress
          statuses={lineStatuses}
          currentIndex={currentLineIndex}
          onSelectParagraph={(idx) => {
            // Only allow navigating to completed or current paragraphs (not locked)
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

              // Compute diff tokens for this paragraph:
              // – current paragraph: use live lastDiffTokens
              // – completed paragraphs: use last recorded result
              let paragraphDiffTokens: DiffToken[] | null = null;
              if (idx === currentLineIndex && lastDiffTokens) {
                paragraphDiffTokens = lastDiffTokens;
              } else if (status === 'completed') {
                for (let i = lineResults.length - 1; i >= 0; i--) {
                  if (lineResults[i].lineIndex === idx) {
                    paragraphDiffTokens = lineResults[i].diffTokens;
                    break;
                  }
                }
              }

              return (
                <div
                  key={idx}
                  ref={idx === currentLineIndex ? activeLineRef : null}
                  className={`transition-all duration-700 rounded-2xl px-8 py-12 border ${
                    isCelebrating
                      ? 'bg-emerald-50 border-emerald-400 shadow-[0_0_40px_rgba(16,185,129,0.25)] scale-[1.04]'
                      : status === 'current'
                        ? 'bg-accent/5 border-accent/40 shadow-[0_0_40px_rgba(99,102,241,0.1)] scale-[1.03]'
                        : status === 'completed'
                          ? 'opacity-60 bg-emerald-50/50 border-emerald-200/50'
                          : 'opacity-20 border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {/* Status indicator */}
                    {status === 'completed' && (
                      <span className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    )}
                    {status === 'current' && (
                      <span className="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0">
                        <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                      </span>
                    )}
                    {status === 'locked' && (
                      <span className="w-5 h-5 rounded-full border-2 border-gray-300 flex items-center justify-center shrink-0">
                        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                      </span>
                    )}
                    <span className="text-xs text-gray-400 font-bold">第 {idx + 1} 段</span>
                    {isCelebrating && (
                      <span className="ml-auto text-xs font-bold text-emerald-600 animate-bounce">
                        解鎖了！
                      </span>
                    )}
                    {status === 'locked' && (
                      <span className="ml-auto text-[10px] text-gray-400">完成前一段後解鎖</span>
                    )}
                    {/* Gemini correction in progress indicator */}
                    {idx === currentLineIndex && isAwaitingGemini && paragraphDiffTokens && (
                      <span className="ml-auto text-[10px] text-blue-400 font-bold animate-pulse">AI 精算中…</span>
                    )}
                  </div>

                  {/* Paragraph text — 3-mode: diff | cursor | plain */}
                  {paragraphDiffTokens && !isSessionActive ? (
                    /* Mode 3: diff annotations below each char (only after recording stops) */
                    renderLineWithDiff(
                      line,
                      paragraphDiffTokens,
                      fontSizePx,
                      `${zhuyinActive ? 'tracking-[0.4em]' : ''} ${status === 'current' ? 'font-bold' : ''}`,
                    )
                  ) : idx === currentLineIndex && isTtsSpeaking ? (
                    /* Mode 2b: TTS playing — highlight active sentence */
                    (() => {
                      const sentences = splitIntoSentences(line);
                      // build cumulative char offsets so we can map speakingProgress → sentence index
                      let offset = 0;
                      const offsets = sentences.map(s => { const start = offset; offset += s.length; return start; });
                      // active sentence = last one whose start offset <= speakingProgress
                      let activeSentIdx = 0;
                      for (let si = offsets.length - 1; si >= 0; si--) {
                        if (offsets[si] <= speakingProgress) { activeSentIdx = si; break; }
                      }
                      return (
                        <p
                          className={`leading-[3.5rem] ${zhuyinActive ? 'tracking-[0.4em]' : ''} font-bold`}
                          style={{ fontSize: fontSizePx }}
                        >
                          {sentences.map((sent, si) => (
                            <span
                              key={si}
                              className={si === activeSentIdx
                                ? 'bg-sky-200/70 rounded-sm text-gray-900'
                                : 'text-gray-400'}
                            >{sent}</span>
                          ))}
                        </p>
                      );
                    })()
                  ) : idx === currentLineIndex && isSessionActive ? (
                    /* Mode 2a: moving cursor while recording (STT) */
                    <p
                      className={`leading-[3.5rem] ${zhuyinActive ? 'tracking-[0.4em]' : ''} font-bold`}
                      style={{ fontSize: fontSizePx }}
                    >
                      {Array.from(line).map((ch, charIdx) => (
                        <span
                          key={charIdx}
                          className={
                            charIdx < speakingProgress
                              ? 'text-gray-400'
                              : charIdx === speakingProgress
                                ? 'text-gray-900 bg-yellow-200/80 rounded-sm px-px'
                                : 'text-gray-800'
                          }
                        >{ch}</span>
                      ))}
                    </p>
                  ) : (
                    /* Mode 1: idle / plain text */
                    <p
                      className={`leading-[3.5rem] lg:leading-[3.5rem] ${zhuyinActive ? 'tracking-[0.4em]' : ''} ${
                        status === 'current' ? 'text-gray-900 font-bold' : 'text-gray-600'
                      }`}
                      style={{ fontSize: fontSizePx }}
                    >
                      {status === 'locked' ? (
                        <span className="blur-sm select-none">{zhuyinLines ? zhuyinLines[idx] : line}</span>
                      ) : (
                        zhuyinLines ? zhuyinLines[idx] : line
                      )}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom controls bar */}
        <div className="flex-shrink-0 bg-white border-t border-gray-200 px-4 py-3 space-y-2">
          {/* Status + primary action buttons */}
          <div className="flex items-center gap-2">
            {/* Status dot */}
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              isAwaitingGemini ? 'bg-blue-400 animate-pulse' :
              isSessionActive ? 'bg-green-400 animate-pulse' :
              isPreparing ? 'bg-yellow-400 animate-pulse' :
              'bg-gray-300'
            }`} />
            <span className={`text-xs font-medium mr-auto ${
              isAwaitingGemini ? 'text-blue-500' :
              isSessionActive ? 'text-green-600' :
              isPreparing ? 'text-yellow-600' :
              'text-gray-400'
            }`}>
              {isAwaitingGemini ? 'AI 精算中...' : isSessionActive ? '聆聽中' : isPreparing ? '準備中...' : '點擊「開始朗讀」'}
            </span>

            {/* System demo button — toggles play/stop */}
            <button
              onClick={isTtsSpeaking ? () => {
                if (utteranceRef.current) {
                  utteranceRef.current.onend = null;
                  utteranceRef.current.onerror = null;
                  utteranceRef.current.onboundary = null;
                  utteranceRef.current = null;
                }
                if (ttsRafRef.current !== null) {
                  cancelAnimationFrame(ttsRafRef.current);
                  ttsRafRef.current = null;
                }
                window.speechSynthesis?.cancel();
                setIsTtsSpeaking(false);
                setIsTtsPaused(false);
              } : speakCurrentParagraph}
              disabled={isSessionActive || isPreparing || isAdvancing}
              aria-label={isTtsSpeaking ? '停止系統朗讀' : '播放這段的系統示範朗讀'}
              className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-all ${
                isSessionActive || isPreparing || isAdvancing
                  ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                  : isTtsSpeaking
                    ? 'bg-red-100 hover:bg-red-200 text-red-600'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
            >
              {isTtsSpeaking ? (
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="4" height="12" rx="1" />
                  <rect x="14" y="6" width="4" height="12" rx="1" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" />
                </svg>
              )}
              {processZhuyin(isTtsSpeaking ? '停止' : '系統朗讀')}
            </button>

            {/* Primary: Start / Submit / Retry */}
            {isPreparing ? (
              <button disabled className="px-4 py-2 rounded-lg text-sm font-bold bg-gray-200 text-gray-400 cursor-wait flex items-center gap-1.5">
                <div className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                {processZhuyin('準備中...')}
              </button>
            ) : isSessionActive ? (
              <button
                onClick={submitSentence}
                disabled={isAdvancing || isAwaitingGemini || (!streamingUserInput && !lastDiffTokens)}
                aria-label="完成這段朗讀"
                className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all shadow active:scale-95 ${
                  isAdvancing || isAwaitingGemini || (!streamingUserInput && !lastDiffTokens)
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
                {processZhuyin('完成')}
              </button>
            ) : retryCount > 0 ? (
              <button
                onClick={startSession}
                aria-label="再試一次"
                className="px-4 py-2 rounded-lg text-sm font-bold bg-amber-500 hover:bg-amber-400 text-white flex items-center gap-1.5 transition-all shadow active:scale-95"
              >
                {processZhuyin('再試一次')}
              </button>
            ) : (
              <button
                onClick={startSession}
                aria-label="開始朗讀這段，啟動語音辨識"
                className="px-4 py-2 rounded-lg text-sm font-bold bg-accent hover:bg-accent-hover text-white flex items-center gap-1.5 transition-all shadow active:scale-95"
              >
                <span className="w-2 h-2 rounded-full bg-white" />
                {processZhuyin('開始朗讀')}
              </button>
            )}
          </div>

          {micError && <div className="text-[10px] text-rose-400">{micError}</div>}

          {/* Navigation */}
          <div className="flex gap-2">
            <button
              onClick={() => {
                const prevIdx = currentLineIndex - 1;
                if (prevIdx >= 0 && (lineStatuses[prevIdx] === 'completed' || lineStatuses[prevIdx] === 'current')) {
                  stopSession();
                  setRetryCount(0);
                  setCurrentLineIndex(prevIdx);
                }
              }}
              disabled={currentLineIndex === 0}
              aria-label={currentLineIndex === 0 ? '已是第一段' : `返回第 ${currentLineIndex} 段`}
              className={`flex-1 py-2 rounded-lg text-sm font-bold border border-gray-200 ${
                currentLineIndex === 0 ? 'bg-gray-100 text-gray-300 cursor-not-allowed' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
              }`}
            >
              {processZhuyin('上一段')}
            </button>

            {(() => {
              const isLastLine = currentLineIndex === story.content.length - 1;
              const allDone = completedParagraphs.size === story.content.length;
              const nextUnlocked = !isLastLine && maxUnlockedIndex > currentLineIndex;
              if (isLastLine) {
                return (
                  <button
                    onClick={handleFinish}
                    disabled={!allDone}
                    aria-label={!allDone ? '請完成所有段落後查看總結報告' : '查看朗讀總結報告'}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold border border-gray-200 ${
                      allDone ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                    }`}
                  >
                    {processZhuyin('觀看總結報告')}
                  </button>
                );
              }
              return (
                <button
                  onClick={() => { if (nextUnlocked) { stopSession(); setRetryCount(0); setCurrentLineIndex(prev => prev + 1); } }}
                  disabled={!nextUnlocked}
                  aria-label={!nextUnlocked ? '請先完成此段朗讀才能繼續' : `前往第 ${currentLineIndex + 2} 段`}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold border border-gray-200 ${
                    nextUnlocked ? 'bg-gray-100 hover:bg-gray-200 text-gray-600' : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                  }`}
                >
                  {processZhuyin('下一段')}
                </button>
              );
            })()}
          </div>

          {isSessionActive && (
            <button
              onClick={stopSession}
              aria-label="停止目前的朗讀練習"
              className="w-full py-1 rounded-lg text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              {processZhuyin('停止朗讀')}
            </button>
          )}
        </div>
      </div>

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
