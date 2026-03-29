
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
import { cancelTts } from '../../services/ttsApi';

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
 * Look-ahead cursor: for each spoken char, try matching the current target
 * position first. On mismatch, look ahead up to LOOK_AHEAD target positions
 * to handle substitutions (e.g. 而且 vs 並且) and rare chars (e.g. 賁).
 * Spoken chars that don't match anything are treated as extra and skipped.
 */
const LOOK_AHEAD = 3;

function calcSpeakingProgress(interim: string, target: string): number {
  const s = Array.from(normalizeForComparison(interim));
  const t = Array.from(normalizeForComparison(target));
  let j = 0;
  for (let i = 0; i < s.length && j < t.length; i++) {
    if (s[i] === t[j] || isHomophone(s[i], t[j])) {
      j++;
    } else {
      // Look ahead: can this spoken char match a nearby target position?
      // Handles substitutions (而且→並且) and STT-impossible chars (賁→噴)
      let found = false;
      for (let k = 1; k <= LOOK_AHEAD && j + k < t.length; k++) {
        if (s[i] === t[j + k] || isHomophone(s[i], t[j + k])) {
          j = j + k + 1; // skip mismatched target chars + advance past match
          found = true;
          break;
        }
      }
      // If not found, spoken char is extra — skip it (j stays)
    }
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

    if (!token) {
      return <span key={i}>{ch}</span>;
    }
    if (token.type === 'correct' || token.type === 'forgiven') {
      return <span key={i} className="text-green-600">{ch}</span>;
    }
    if (token.type === 'unread') {
      return <span key={i} className="text-gray-300">{ch}</span>;
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
 * Build real-time overlay tokens from diffCharacters output.
 * 1. Filter out "extra" tokens (spoken chars with no target position)
 * 2. Find the cursor: index of last correct/wrong/forgiven token
 * 3. Mark everything after the cursor as "unread"
 */
function buildRealtimeOverlay(diffTokens: DiffToken[]): DiffToken[] {
  // Keep only target-side tokens (correct, wrong, missing, forgiven)
  const targetTokens = diffTokens.filter(t => t.type !== 'extra');

  // Find cursor: last position where student has spoken (correct, wrong, or forgiven)
  let cursor = -1;
  for (let i = targetTokens.length - 1; i >= 0; i--) {
    if (targetTokens[i].type === 'correct' || targetTokens[i].type === 'wrong' || targetTokens[i].type === 'forgiven') {
      cursor = i;
      break;
    }
  }

  // Mark tokens after cursor as "unread"
  return targetTokens.map((t, i) => {
    if (i > cursor && t.type === 'missing') {
      return { ...t, type: 'unread' as const };
    }
    return t;
  });
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
  // Per-paragraph summary type (used by storage + state)
  type ParagraphSummaryData = {
    feedback: string;
    matchRate: number;
    wrongCount: number;
    missingCount: number;
    tier: number;
    geminiPending: boolean;
  };

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
  const [zhuyinEnabled, setZhuyinEnabled] = useState(true);
  const [zhuyinReady, setZhuyinReady] = useState(false);
  const [isTtsSpeaking, setIsTtsSpeaking] = useState(false);
  const [isTtsPaused, setIsTtsPaused] = useState(false);
  const [isTtsLoading, setIsTtsLoading] = useState(false); // true while fetch is in-flight, before audio starts
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
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(320);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  // Strong ref to TTS utterance — prevents Chrome GC bug where a local utterance
  // gets collected mid-playback, silencing onend/onboundary callbacks.
  const utteranceRef = useRef<SpeechSynthesisUtterance | HTMLAudioElement | null>(null);
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

  // ── Save progress to localStorage whenever key state changes ──────────────
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        lineResults,
        paragraphSummaries: Object.fromEntries(
          Object.entries(paragraphSummaries).map(([k, v]) => [k, { ...v, geminiPending: false }])
        ),
        completedParagraphs: Array.from(completedParagraphs),
        currentLineIndex,
      }));
    } catch {}
  }, [lineResults, paragraphSummaries, completedParagraphs, currentLineIndex, storageKey]);

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
    setRealtimeDiffTokens(null);
    // Don't clear paragraphSummaries — they persist across paragraph navigation
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

    const totalSentences = sentenceTargetsRef.current.length;
    if (sentResults.length > 0 && sentResults.length >= Math.ceil(totalSentences / 2)) {
      // Compute overall from per-sentence results (only if majority captured)
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
      // Incomplete sentence results or no isFinal events — whole-paragraph local eval
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

    // Count errors from diff tokens
    const wrongCount = localDiffTokens.filter(t => t.type === 'wrong').length;
    const missingCount = localDiffTokens.filter(t => t.type === 'missing').length;

    // Stop recognition so the summary card is visible and action buttons work
    stopSession();

    // Show local summary immediately (Gemini will update it)
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

        // Update summary with Gemini feedback
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

        // If Gemini upgrades to PASS, update the result
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
        // Gemini failed — local summary stands, just mark as done
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

      // Real-time LCS diff overlay: compare full transcript against target
      const targetText = story.content[currentLineIndexRef.current] || '';
      const rawDiff = diffCharacters(fullTranscript, targetText, { useHomophone: true });
      const overlayTokens = buildRealtimeOverlay(rawDiff.tokens);
      // Highwater mark: once a char is correct/wrong/forgiven, never revert to unread.
      // This prevents "jumping" when STT interim transcript fluctuates.
      setRealtimeDiffTokens(prev => {
        if (!prev) return overlayTokens;
        return overlayTokens.map((t, i) => {
          const old = prev[i];
          if (!old) return t;
          // If previously committed (correct/wrong/forgiven/missing), keep it
          // unless new result is also committed (allows correction on re-read)
          if (old.type !== 'unread' && t.type === 'unread') return old;
          return t;
        });
      });
      // Also update cursor for progress bar / other consumers
      const readChars = overlayTokens.filter(t => t.type !== 'unread').length;
      setSpeakingProgress(prev => Math.max(prev, readChars));

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
      console.warn('[STT] onerror:', event.error, '| sessionActive:', isSessionActiveRef.current);
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
      console.log('[STT] onend | sessionActive:', isSessionActiveRef.current, '| accumulated:', accumulatedTranscriptRef.current.slice(-20));
      if (isSessionActiveRef.current) {
        // Browser/API timed out — seamlessly reconnect.
        // Chrome sometimes throws InvalidStateError if start() is called
        // immediately inside onend (engine not fully cleaned up yet).
        // A 150ms delay lets Chrome finish teardown before we restart.
        accumulatedTranscriptRef.current = currentTranscriptRef.current;
        lastFinalResultIdxRef.current = -1; // reset — reconnect resets event.results indices
        setTimeout(() => {
          if (!isSessionActiveRef.current) return; // user stopped during the delay
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
    setStreamingUserInput('');
    setSpeakingProgress(0);
    setRealtimeDiffTokens(null);

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
    setRealtimeDiffTokens(null);
  };

  /** Use Cloud TTS Neural2 to read the current paragraph aloud.
   *  Falls back to Web Speech API inside ttsApi if backend is unavailable.
   *  Drives the cursor animation using time-based rAF (~4.2 chars/sec).
   */
  const speakCurrentParagraph = useCallback(() => {
    const text = story.content[currentLineIndex];
    if (!text) return;
    cancelTts();
    setIsTtsPaused(false);
    setIsTtsLoading(true); // show loading state while network fetch is in-flight

    const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

    const stopTtsAnimation = () => {
      if (ttsRafRef.current !== null) {
        cancelAnimationFrame(ttsRafRef.current);
        ttsRafRef.current = null;
      }
    };

    const startCursorAnimation = () => {
      setIsTtsLoading(false); // audio started — no longer loading
      setIsTtsSpeaking(true);
      setSpeakingProgress(0);
      setRealtimeDiffTokens(null);
      ttsStartTimeRef.current = performance.now();
      ttsTotalCharsRef.current = Array.from(text).length;
      const MS_PER_CHAR = 240; // ~4.2 chars/sec — tuned for Neural2 zh-TW at rate 0.9
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

    const onSpeechEnd = () => {
      stopTtsAnimation();
      setIsTtsLoading(false);
      setIsTtsSpeaking(false);
      setIsTtsPaused(false);
    };

    // Try Cloud TTS first via <audio> element for better control
    fetch(`${API_BASE}/api/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`TTS ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (blob.size === 0) throw new Error('Empty TTS audio');
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        utteranceRef.current = audio as unknown as SpeechSynthesisUtterance;
        audio.onplay = startCursorAnimation;
        audio.onended = onSpeechEnd;
        audio.onerror = onSpeechEnd;
        return audio.play();
      })
      .catch(() => {
        // Fallback: Web Speech API
        if (!window.speechSynthesis) { onSpeechEnd(); return; }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utteranceRef.current = utterance;
        utterance.lang = 'zh-TW';
        utterance.rate = 1.0;
        const voices = window.speechSynthesis.getVoices();
        const preferred =
          voices.find(v => v.name.includes('Google') && v.name.includes('Taiwan')) ||
          voices.find(v => v.lang === 'zh-TW') ||
          voices.find(v => v.lang.startsWith('zh'));
        if (preferred) utterance.voice = preferred;
        utterance.onstart = startCursorAnimation;
        utterance.onboundary = (e) => { setSpeakingProgress(e.charIndex); };
        utterance.onend = onSpeechEnd;
        utterance.onerror = onSpeechEnd;

        const doSpeak = () => window.speechSynthesis.speak(utterance);
        if (window.speechSynthesis.getVoices().length === 0) {
          window.speechSynthesis.onvoiceschanged = () => {
            window.speechSynthesis.onvoiceschanged = null;
            doSpeak();
          };
        } else {
          doSpeak();
        }
      });
  }, [story.content, currentLineIndex]);

  const pauseTts = () => {
    // Pause <audio> element if playing via Cloud TTS
    const ua = utteranceRef.current;
    if (ua && ua instanceof HTMLAudioElement) {
      ua.pause();
    } else {
      window.speechSynthesis?.pause();
    }
    setIsTtsPaused(true);
  };
  const resumeTts = () => {
    const ua = utteranceRef.current;
    if (ua && ua instanceof HTMLAudioElement) {
      ua.play().catch(() => {});
    } else {
      window.speechSynthesis?.resume();
    }
    setIsTtsPaused(false);
  };
  const stopTts = () => {
    if (ttsRafRef.current !== null) {
      cancelAnimationFrame(ttsRafRef.current);
      ttsRafRef.current = null;
    }
    const ua = utteranceRef.current;
    if (ua && ua instanceof HTMLAudioElement) {
      ua.pause();
      ua.currentTime = 0;
    }
    cancelTts();
    setIsTtsLoading(false);
    setIsTtsSpeaking(false);
    setIsTtsPaused(false);
  };

  /* ================================================================ */
  /*  Finish / manual nav                                             */
  /* ================================================================ */

  const handleFinish = () => {
    stopSession();
    // Clear localStorage — progress is complete, will be sent to backend
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
    // After refresh: fall back to last saved result for current paragraph
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
                    {/* Inline action buttons — system read + start/submit/retry */}
                    {status !== 'locked' && !isAdvancing && (
                      <div className="ml-auto flex items-center gap-2">
                        {/* System demo — available on all non-locked paragraphs */}
                        <button
                          onClick={() => {
                            if (idx !== currentLineIndex) { stopSession(); setRetryCount(0); setCurrentLineIndex(idx); }
                            if (isTtsSpeaking) {
                              if (utteranceRef.current) { const _u = utteranceRef.current; if (_u instanceof HTMLAudioElement) { _u.onended = null; _u.onerror = null; _u.pause(); } else { (_u as SpeechSynthesisUtterance).onend = null; (_u as SpeechSynthesisUtterance).onerror = null; (_u as SpeechSynthesisUtterance).onboundary = null; } utteranceRef.current = null; }
                              if (ttsRafRef.current !== null) { cancelAnimationFrame(ttsRafRef.current); ttsRafRef.current = null; }
                              cancelTts();
                              setIsTtsLoading(false); setIsTtsSpeaking(false); setIsTtsPaused(false);
                            } else {
                              // Speak this paragraph's text via speakCurrentParagraph
                              // (navigating to that line first if needed)
                              if (idx === currentLineIndex) {
                                speakCurrentParagraph();
                              } else {
                                // Brief inline fallback for non-current paragraphs (demo mode)
                                const text = story.content[idx];
                                if (text) {
                                  cancelTts();
                                  setIsTtsLoading(true); // loading while ttsApi module + fetch in-flight
                                  import('../../services/ttsApi').then(({ speakText: sp }) => {
                                    setIsTtsLoading(false);
                                    setIsTtsSpeaking(true);
                                    sp(text).finally(() => { setIsTtsSpeaking(false); setIsTtsPaused(false); });
                                  }).catch(() => { setIsTtsLoading(false); });
                                }
                              }
                            }
                          }}
                          disabled={isTtsLoading || (idx === currentLineIndex && (isSessionActive || isPreparing))}
                          className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all ${
                            isTtsLoading || (idx === currentLineIndex && (isSessionActive || isPreparing))
                              ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                              : isTtsSpeaking && idx === currentLineIndex
                                ? 'bg-red-100 hover:bg-red-200 text-red-600'
                                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                          }`}
                          aria-label={isTtsLoading ? '載入中' : isTtsSpeaking && idx === currentLineIndex ? '停止朗讀' : 'AI 示範朗讀'}
                          aria-busy={isTtsLoading}
                        >
                          {isTtsLoading ? (
                            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                          ) : isTtsSpeaking && idx === currentLineIndex ? (
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="4" height="12" rx="1" /><rect x="14" y="6" width="4" height="12" rx="1" /></svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" /></svg>
                          )}
                          {isTtsLoading ? '載入中...' : isTtsSpeaking && idx === currentLineIndex ? '停止' : 'AI 朗讀'}
                        </button>
                        {/* A/B test: Web Speech API button for comparison */}
                        <button
                          onClick={() => {
                            const text = story.content[idx];
                            if (!text) return;
                            if (window.speechSynthesis.speaking) {
                              window.speechSynthesis.cancel();
                              return;
                            }
                            const utt = new SpeechSynthesisUtterance(text);
                            utt.lang = 'zh-TW';
                            utt.rate = 0.9;
                            const voices = window.speechSynthesis.getVoices();
                            const best = voices.find(v => v.name.includes('Google') && v.name.includes('Taiwan'))
                              || voices.find(v => v.lang === 'zh-TW');
                            if (best) utt.voice = best;
                            window.speechSynthesis.speak(utt);
                          }}
                          disabled={idx === currentLineIndex && (isSessionActive || isPreparing)}
                          className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 ${
                            idx === currentLineIndex && (isSessionActive || isPreparing) ? 'opacity-40 cursor-not-allowed' : ''
                          }`}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" /></svg>
                          瀏覽器朗讀
                        </button>
                        {/* Start / Submit / Retry — context-dependent */}
                        {idx === currentLineIndex ? (
                          // Current paragraph: show session controls
                          isPreparing ? (
                            <button disabled className="px-4 py-2 rounded-lg text-sm font-bold bg-gray-200 text-gray-400 cursor-wait flex items-center gap-1.5">
                              <div className="w-2.5 h-2.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                              準備中...
                            </button>
                          ) : isSessionActive ? (
                            <button
                              onClick={submitSentence}
                              disabled={isAwaitingGemini || (!streamingUserInput && !lastDiffTokens)}
                              className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all shadow active:scale-95 ${
                                isAwaitingGemini || (!streamingUserInput && !lastDiffTokens)
                                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                              }`}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                              完成
                            </button>
                          ) : !paragraphSummaries[idx] ? (
                            <button
                              onClick={startSession}
                              className="px-4 py-2 rounded-lg text-sm font-bold bg-accent hover:bg-accent-hover text-white flex items-center gap-1.5 transition-all shadow active:scale-95"
                            >
                              <span className="w-2 h-2 rounded-full bg-white" />
                              {retryCount > 0 ? '再試一次' : '開始朗讀'}
                            </button>
                          ) : null
                        ) : (
                          // Non-current paragraph: show "開始朗讀" to switch + start
                          <button
                            onClick={() => {
                              stopSession(); setRetryCount(0); setCurrentLineIndex(idx);
                            }}
                            className="px-4 py-2 rounded-lg text-sm font-bold bg-accent hover:bg-accent-hover text-white flex items-center gap-1.5 transition-all shadow active:scale-95"
                          >
                            <span className="w-2 h-2 rounded-full bg-white" />
                            開始朗讀
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Paragraph text — STATIC: text and colors never change during reading.
                      Only show plain text at all times. Background highlight is on the container above. */}
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

                  {/* Bottom-of-paragraph controls — complete + stop (visible while recording this paragraph) */}
                  {idx === currentLineIndex && isSessionActive && (
                    <div className="mt-4 flex items-center justify-end gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
                      <span className="text-xs text-green-600 font-medium mr-auto">聆聽中</span>
                      <button
                        onClick={stopSession}
                        className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                      >
                        停止朗讀
                      </button>
                      <button
                        onClick={submitSentence}
                        disabled={isAwaitingGemini || (!streamingUserInput && !lastDiffTokens)}
                        className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 transition-all shadow active:scale-95 ${
                          isAwaitingGemini || (!streamingUserInput && !lastDiffTokens)
                            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                        完成
                      </button>
                    </div>
                  )}

                  {/* Inline summary card — persists below each evaluated paragraph (actions only, no diff) */}
                  {(() => {
                    const summary = paragraphSummaries[idx];
                    if (!summary) return null;
                    return (
                      <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-gray-50 to-white border border-gray-200 shadow-sm space-y-3">
                        <p className="text-base font-bold text-gray-800">
                          {summary.geminiPending && <span className="text-blue-400 animate-pulse mr-1">AI 分析中...</span>}
                          {summary.feedback}
                        </p>
                        <div className="flex gap-4 text-sm">
                          <span className="text-green-600 font-medium">
                            正確率 {Math.round(summary.matchRate * 100)}%
                          </span>
                          {summary.wrongCount > 0 && (
                            <span className="text-red-500">念錯 {summary.wrongCount} 字</span>
                          )}
                          {summary.missingCount > 0 && (
                            <span className="text-gray-400">漏字 {summary.missingCount} 字</span>
                          )}
                        </div>
                        {/* Action buttons */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              if (idx !== currentLineIndex) {
                                stopSession(); setRetryCount(0); setCurrentLineIndex(idx);
                              }
                              setParagraphSummaries(prev => { const next = { ...prev }; delete next[idx]; return next; });
                              setRealtimeDiffTokens(null);
                              setLastDiffTokens(null);
                              // startSession after state settles — use setTimeout for non-current paragraphs
                              if (idx === currentLineIndex) { startSession(); }
                              else { setTimeout(() => startSession(), 100); }
                            }}
                            className="flex-1 py-2 rounded-lg text-sm font-bold border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 transition-all"
                          >
                            重練這段
                          </button>
                          {/* 下一段 — show when not yet advanced, OR when revisiting a completed paragraph */}
                          {idx < story.content.length - 1 && (
                            <button
                              onClick={() => {
                                if (!completedParagraphs.has(idx)) {
                                  advanceParagraph(idx, lineResults);
                                } else {
                                  // Already completed — just move to next paragraph
                                  setCurrentLineIndex(idx + 1);
                                }
                              }}
                              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                                summary.tier <= 2
                                  ? 'bg-accent hover:bg-accent-hover text-white'
                                  : 'border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-600'
                              }`}
                            >
                              下一段
                            </button>
                          )}
                          {idx >= story.content.length - 1 && !completedParagraphs.has(idx) && (
                            <button
                              onClick={() => advanceParagraph(idx, lineResults)}
                              className="flex-1 py-2 rounded-lg text-sm font-bold bg-accent hover:bg-accent-hover text-white transition-all"
                            >
                              完成朗讀
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}

            {/* Final report button — shown after all paragraphs are completed */}
            {completedParagraphs.size === story.content.length && (
              <div className="mt-8 flex justify-center">
                <button
                  onClick={handleFinish}
                  className="px-8 py-3 rounded-xl text-base font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg transition-all active:scale-95"
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
          onTouchStart={(e) => {
            isDraggingRef.current = true;
            dragStartXRef.current = e.touches[0].clientX;
            dragStartWidthRef.current = rightPanelWidth;
            document.body.style.userSelect = 'none';
          }}
          className="w-1 flex-shrink-0 bg-gray-200 hover:bg-accent cursor-col-resize transition-colors"
        />
      )}

      {/* RIGHT: Feedback panel — progress, live transcript, diff results */}
      <div
        className={`bg-gray-50 flex flex-col min-h-0 border-l border-gray-200 ${isMobile ? 'flex-1' : 'flex-shrink-0 h-full'}`}
        style={isMobile ? undefined : { width: rightPanelWidth }}
      >
        {/* Header */}
        <div className="h-9 shrink-0 bg-white border-b border-gray-200 flex items-center px-4 gap-2">
          <span className="text-[10px] font-black text-accent-light uppercase tracking-widest">朗讀回饋</span>
          <div className="flex-1" />
          <span className={`text-[10px] font-bold ${isSessionActive ? 'text-green-500' : isPreparing ? 'text-yellow-500' : 'text-gray-300'}`}>
            {isSessionActive ? '● 聆聽中' : isPreparing ? '● 準備中' : '● 待機'}
          </span>
        </div>

        {/* Content */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 custom-scrollbar">

          {/* Progress info */}
          <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-1">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">朗讀進度</p>
            <p className="text-sm font-bold text-gray-700">
              第 {currentLineIndex + 1} 段 / 共 {story.content.length} 段
            </p>
            <p className="text-xs text-gray-500">
              已完成 {completedParagraphs.size} 段
              {retryCount > 0 && <span className="ml-2 text-amber-500">重試 {retryCount} 次</span>}
            </p>
          </div>

          {/* Live transcript — shown while recording */}
          {isSessionActive && (
            <div className="space-y-1">
              <p className="text-[9px] font-bold text-accent-light uppercase tracking-widest animate-pulse">即時辨識</p>
              <div className="bg-accent/10 border border-accent/20 rounded-xl px-3 py-2.5 text-sm text-gray-800 leading-relaxed min-h-[2.5rem]">
                {streamingUserInput || <span className="text-gray-400">請開始朗讀…</span>}
              </div>
            </div>
          )}

          {/* Diff result — shown after evaluation completes for current paragraph */}
          {!isSessionActive && rightPanelDiffTokens && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">逐字比對</p>
                {paragraphSummary?.geminiPending && (
                  <span className="text-[9px] text-blue-400 font-bold animate-pulse">AI 精算中…</span>
                )}
              </div>
              <div className="bg-white border border-gray-200 rounded-xl px-3 py-3">
                <DiffDisplay tokens={rightPanelDiffTokens} showLegend className="text-base" />
              </div>
            </div>
          )}

          {/* Idle state — no recording yet */}
          {!isSessionActive && !rightPanelDiffTokens && !paragraphSummary && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
              <p className="text-sm text-gray-500 leading-relaxed">
                按左側「開始朗讀」後，回饋結果會顯示在這裡
              </p>
            </div>
          )}

        </div>

        {/* Mic error */}
        {micError && (
          <div className="flex-shrink-0 px-4 py-2 bg-rose-50 border-t border-rose-100">
            <span className="text-xs text-rose-500">{micError}</span>
          </div>
        )}
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
