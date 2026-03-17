
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Story, ReadingAttempt, LiveMessage, DiffToken } from '../../types';
import { correctHomophones } from '../../utils/pinyin';
import { diffCharacters, normalizeForComparison, cleanChineseText } from '../../utils/textDiff';
import DiffDisplay from '../ui/DiffDisplay';
import { PolyphonicProcessor, buildZhuyinString } from '../zhuyin/polyphonicProcessor';
import ZhuyinToggle from '../ui/ZhuyinToggle';
import FontSizeControl, { useFontSize } from '../ui/FontSizeControl';
import { useIsMobile } from '../../hooks/useIsMobile';
import { READING_EXCELLENT, READING_PASS } from '../../utils/personaConfig';
import RecordingButton from '../recording/RecordingButton';
import ParagraphProgress, { ParagraphStatus } from './ParagraphProgress';

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
  const [lastDiffTokens, setLastDiffTokens] = useState<DiffToken[] | null>(null);
  const [showRecorder, setShowRecorder] = useState(false);

  // Progressive unlock state — track which paragraphs have been passed (>= READING_PASS)
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
   *  A paragraph is 'completed' only if it passed the READING_PASS threshold.
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

  /* ---- cleanup on unmount ---- */
  useEffect(() => {
    return () => {
      isSessionActiveRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (_) {}
      }
      window.speechSynthesis?.cancel();
    };
  }, []);

  /* ================================================================ */
  /*  Core: evaluate the student's reading and respond                */
  /* ================================================================ */

  const evaluateAndRespond = useCallback((rawTranscript: string, rawStt: string, durationMs: number, lineIdx: number) => {
    const targetText = story.content[lineIdx] || '';
    const cleaned = cleanChineseText(rawTranscript);

    if (!cleaned) return; // nothing to evaluate

    // Step 1: Homophone correction (strip punctuation from target so alignment
    // is purely between Chinese characters — STT never produces 「」！ etc.)
    const targetForAlignment = normalizeForComparison(targetText);
    const corrected = correctHomophones(cleaned, targetForAlignment);

    // Step 2: Diff analysis (LCS-based, replaces bag-of-words)
    const diffResult = diffCharacters(corrected, targetText, { useHomophone: true });
    const matchRate = diffResult.matchRate;

    // Step 3: Determine tier
    const isLastLine = lineIdx >= story.content.length - 1;
    let tier: 1 | 2 | 3;
    if (matchRate >= READING_EXCELLENT) tier = 1;
    else if (matchRate >= READING_PASS) tier = 2;
    else tier = 3;

    const shouldAdvance = tier <= 2 && !isLastLine;
    const shouldFinish = tier <= 2 && isLastLine;

    // Step 4: Display text
    const displayInput = corrected;

    // Step 5: Pick feedback
    let feedback: string;
    if (shouldFinish) {
      feedback = LAST_LINE_MESSAGE;
    } else {
      const newStreak = tier <= 2 ? streak + 1 : 0;
      if (tier <= 2 && newStreak >= 3 && newStreak < STREAK_MESSAGES.length && STREAK_MESSAGES[newStreak]) {
        feedback = STREAK_MESSAGES[newStreak];
      } else if (tier === 1) {
        feedback = pick(TIER1_POOL);
      } else if (tier === 2) {
        feedback = pick(TIER2_POOL);
      } else {
        feedback = pick(TIER3_POOL);
      }
      setStreak(newStreak);
    }

    // Step 6: CPM (only count correctly-read characters)
    const durationSec = Math.max(durationMs / 1000, 0.5);
    const cpm = Math.round((diffResult.correctCount / durationSec) * 60);

    // Step 7: Record line result
    const result: LineResult = { lineIndex: lineIdx, matchRate, cpm, durationMs, transcript: cleaned, diffTokens: diffResult.tokens };
    setLastDiffTokens(diffResult.tokens);
    setLineResults(prev => [...prev, result]);

    // Step 8: Debug logging
    console.group('%c[Evaluation]', 'color: cyan; font-weight: bold');
    console.log('Line:', lineIdx, '/', story.content.length - 1);
    console.log('Target:', targetText);
    console.log('STT:', rawStt);
    console.log('After homophone:', corrected);
    console.log('Match rate:', (matchRate * 100).toFixed(1) + '%', '→ Tier', tier);
    console.log('CPM:', cpm);
    console.log('Duration:', (durationMs / 1000).toFixed(1) + 's');
    console.log('Advance:', shouldAdvance, '| Finish:', shouldFinish);
    console.log('Feedback:', feedback);
    console.groupEnd();

    // Step 9: Commit messages
    const newMsgs: LiveMessage[] = [];
    newMsgs.push({ id: Date.now().toString(), role: 'user', text: displayInput, type: 'transcription' });
    newMsgs.push({ id: (Date.now() + 1).toString(), role: 'model', text: feedback, type: 'feedback' });
    setMessages(prev => [...prev, ...newMsgs]);
    setStreamingUserInput('');

    // Step 10: Advance, finish, or stay
    if (shouldAdvance && !isAdvancingRef.current) {
      isAdvancingRef.current = true;
      setIsAdvancing(true);
      stopSession(); // stop mic so student sees [系統朗讀][開始朗讀] for the next paragraph

      // Mark this paragraph as completed and notify parent
      const nextIdx = lineIdx + 1;
      setCompletedParagraphs(prev => {
        const updated = new Set(prev);
        updated.add(lineIdx);
        return updated;
      });
      onParagraphComplete?.(lineIdx);

      // Celebration animation for unlocking next paragraph
      setCelebratingIndex(nextIdx);
      setTimeout(() => setCelebratingIndex(null), 2000);

      setTimeout(() => {
        setCurrentLineIndex(nextIdx);
        isAdvancingRef.current = false;
        setIsAdvancing(false);
      }, 1500);
    } else if (shouldFinish) {
      stopSession();
      // Mark final paragraph as completed
      setCompletedParagraphs(prev => {
        const updated = new Set(prev);
        updated.add(lineIdx);
        return updated;
      });
      onParagraphComplete?.(lineIdx);

      setTimeout(() => {
        const allResults = [...lineResults, result];
        const avgMatchRate = allResults.reduce((s, r) => s + r.matchRate, 0) / allResults.length;
        const totalCorrectChars = allResults.reduce(
          (s, r) => s + r.diffTokens.filter(t => t.type === 'correct').length, 0
        );
        const totalDurationSec = allResults.reduce((s, r) => s + r.durationMs, 0) / 1000;
        const overallCpm = totalDurationSec > 0 ? Math.round((totalCorrectChars / totalDurationSec) * 60) : 0;
        onFinish({
          storyId: story.id, accuracy: Math.round(avgMatchRate * 100), fluency: overallCpm,
          cpm: overallCpm, mispronouncedWords: extractPracticeChars(allResults, story.content),
          transcription: allResults.map(r => r.transcript).join(' '), timestamp: Date.now(),
          lineBreakdown: allResults.map(r => ({
            lineIndex: r.lineIndex, matchRate: r.matchRate, cpm: r.cpm,
            transcript: r.transcript, diffTokens: r.diffTokens,
          })),
        });
      }, 2000);
    }
    // If tier 3 (retry), stay on same line — mic keeps listening
  }, [story, streak, lineResults, onFinish]);

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
        console.log('[SpeechRecognition] Auto-reconnecting…');
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

    recognition.start();
    // Note: isSessionActive & sentenceStartTimeRef are set in onstart once STT is truly ready
  };

  /** Submit the current sentence for evaluation. Recognition keeps running. */
  const submitSentence = useCallback(() => {
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
      evaluateAndRespondRef.current(transcript, rawStt, durationMs, currentLineIndexRef.current);
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
  };

  /** Use browser TTS to read the current paragraph aloud. */
  const speakCurrentParagraph = useCallback(() => {
    const text = story.content[currentLineIndex];
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setIsTtsPaused(false);

    const doSpeak = () => {
      const utterance = new SpeechSynthesisUtterance(text);
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

      utterance.onstart = () => setIsTtsSpeaking(true);
      utterance.onend = () => { setIsTtsSpeaking(false); setIsTtsPaused(false); };
      utterance.onerror = () => { setIsTtsSpeaking(false); setIsTtsPaused(false); };
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
      (s, r) => s + r.diffTokens.filter(t => t.type === 'correct').length, 0
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
      className={`flex ${isMobile ? 'flex-col' : 'flex-row'} flex-1 h-full bg-amber-50 overflow-hidden`}
      style={{
        fontFamily: zhuyinActive
          ? "'BpmfIansui', 'Iansui', 'Noto Sans TC', sans-serif"
          : "'Iansui', 'Noto Sans TC', sans-serif",
      }}
    >
      {/* CENTER: Editor - story text panel */}
      <div className={`flex flex-col bg-amber-50 ${isMobile ? 'h-[60vh]' : 'flex-1'}`}>
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
                      /* Lock icon for locked paragraphs */
                      <span className="w-5 h-5 rounded-full border-2 border-gray-300 flex items-center justify-center shrink-0">
                        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                      </span>
                    )}
                    <span className="text-xs text-gray-400 font-bold">第 {idx + 1} 段</span>
                    {/* Celebration label */}
                    {isCelebrating && (
                      <span className="ml-auto text-xs font-bold text-emerald-600 animate-bounce">
                        解鎖了！
                      </span>
                    )}
                    {/* Locked hint */}
                    {status === 'locked' && (
                      <span className="ml-auto text-[10px] text-gray-400">完成前一段後解鎖</span>
                    )}
                  </div>
                  <p
                    className={`leading-[3.5rem] lg:leading-[3.5rem] ${zhuyinActive ? 'tracking-[0.4em]' : ''} ${
                      status === 'current' ? 'text-gray-900 font-bold' : 'text-gray-600'
                    }`}
                    style={{ fontSize: fontSizePx }}
                  >
                    {/* Show blurred text for locked paragraphs */}
                    {status === 'locked' ? (
                      <span className="blur-sm select-none">{zhuyinLines ? zhuyinLines[idx] : line}</span>
                    ) : (
                      zhuyinLines ? zhuyinLines[idx] : line
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="h-7 bg-white border-t border-gray-200 flex items-center px-4 justify-between text-[10px] text-gray-500 uppercase">
          <div className="flex gap-4">
            <span>段 {currentLineIndex + 1} / {story.content.length}</span>
            <span>UTF-8</span>
          </div>
          <div className="flex gap-3">
            <span className={isSessionActive ? 'text-green-500 font-bold' : isPreparing ? 'text-yellow-500 font-bold' : 'text-gray-300'}>
              {isSessionActive ? '• LISTENING' : isPreparing ? '• PREPARING' : '• IDLE'}
            </span>
          </div>
        </div>
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

      {/* RIGHT: Interaction panel */}
      <div
        className={`bg-amber-50 flex flex-col min-h-0 ${isMobile ? 'flex-1' : 'flex-shrink-0 h-full'}`}
        style={isMobile ? undefined : { width: rightPanelWidth }}
      >
        <div className="h-9 flex-shrink-0 bg-white border-b border-gray-200 flex items-center px-4">
          <span className="text-[10px] font-black text-accent-light uppercase tracking-widest">
            Live Feedback
          </span>
        </div>

        {/* Chat area */}
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5 custom-scrollbar bg-gray-50"
        >
          {messages.map(m => (
            <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <span className="text-[9px] font-bold text-gray-300 mb-0.5 uppercase">
                {m.role === 'user' ? 'STUDENT' : 'TUTOR'}
              </span>
              <div
                className={`px-4 py-3 rounded-2xl text-lg max-w-[90%] shadow-lg leading-[2.6] ${
                  zhuyinActive ? 'tracking-[0.3em]' : ''
                } ${
                  m.role === 'user'
                    ? 'bg-accent text-white rounded-tr-none'
                    : 'bg-gray-100 text-gray-800 border border-gray-200 rounded-tl-none'
                }`}
              >
                {processZhuyin(m.text)}
              </div>
            </div>
          ))}

          {isSessionActive && !streamingUserInput && !isAdvancing && (
            <div className="flex flex-col items-start">
              <span className="text-[9px] font-bold text-green-500 mb-0.5 uppercase animate-pulse">
                LISTENING
              </span>
              <div className={`px-4 py-3 rounded-2xl text-lg bg-green-900/30 text-green-200 border border-green-700/30 rounded-tl-none leading-[2.6] ${zhuyinActive ? 'tracking-[0.3em]' : ''}`}>
                {processZhuyin(`請閱讀左側文章的第${currentLineIndex + 1}段：${story.content[currentLineIndex].slice(0, 5)}...`)}
              </div>
            </div>
          )}

          {streamingUserInput && (
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-bold text-accent mb-0.5 uppercase animate-pulse">
                LISTENING...
              </span>
              <div className={`px-4 py-3 rounded-2xl text-lg bg-accent/60 text-gray-800 rounded-tr-none max-w-[90%] border border-accent/30 leading-[2.6] ${zhuyinActive ? 'tracking-[0.3em]' : ''}`}>
                {processZhuyin(streamingUserInput)}
              </div>
            </div>
          )}

          {lastDiffTokens && !isAdvancing && !streamingUserInput && (
            <div className="flex flex-col items-start">
              <span className="text-[9px] font-bold text-gray-400 mb-0.5 uppercase">
                DIFF
              </span>
              <div className="px-4 py-3 rounded-2xl bg-white border border-gray-200 rounded-tl-none max-w-[95%]">
                <DiffDisplay tokens={lastDiffTokens} showLegend className="text-base" />
              </div>
            </div>
          )}

          {isAdvancing && (
            <div className="flex flex-col items-start">
              <span className="text-[9px] font-bold text-accent mb-0.5 uppercase animate-pulse">
                NEXT...
              </span>
              <div className={`px-4 py-3 rounded-2xl text-lg bg-gray-100 text-accent-light border border-accent-hover/30 rounded-tl-none leading-[2.6] ${zhuyinActive ? 'tracking-[0.3em]' : ''}`}>
                {processZhuyin('正在前往下一段...')}
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex-shrink-0 p-3 bg-white border-t border-gray-200 space-y-2">
          <div className={`min-h-[3rem] p-2 rounded-lg bg-black/40 border border-gray-200 text-base text-accent-light overflow-hidden leading-[2.6] ${zhuyinActive ? 'tracking-[0.3em]' : ''}`}>
            {streamingUserInput ? processZhuyin(streamingUserInput) : (
              <span className="text-gray-800 italic">
                {processZhuyin(isPreparing ? '正在準備語音辨識...' : isSessionActive ? '正在聆聽您的朗讀...' : '點擊「開始朗讀」開始')}
              </span>
            )}
          </div>

          {micError && <div className="text-[10px] text-rose-400 px-1">{micError}</div>}

          <div className="flex gap-2">
            {isPreparing ? (
              <>
                {/* 系統朗讀 disabled while mic is initializing */}
                <button
                  disabled
                  aria-label="系統朗讀（準備中，暫不可用）"
                  className="flex-1 py-3 rounded-xl font-bold text-base flex items-center justify-center gap-2 bg-gray-300 text-gray-500 cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" />
                  </svg>
                  {processZhuyin('系統朗讀')}
                </button>
                <button
                  disabled
                  aria-label="正在準備語音辨識"
                  aria-busy="true"
                  className="flex-1 py-3 rounded-xl font-bold text-base flex items-center justify-center gap-2 bg-gray-300 text-gray-600 cursor-wait"
                >
                  <div className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                  {processZhuyin('準備中...')}
                </button>
              </>
            ) : isSessionActive ? (
              <button
                onClick={submitSentence}
                disabled={isAdvancing || !streamingUserInput}
                aria-label={isAdvancing ? '請稍候，正在處理' : '完成這段朗讀'}
                className={`flex-1 py-3 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all shadow active:scale-95 ${
                  isAdvancing || !streamingUserInput
                    ? 'bg-gray-300 text-gray-400 cursor-not-allowed opacity-50'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
                {processZhuyin(isAdvancing ? '請稍候...' : '完成這段')}
              </button>
            ) : isTtsSpeaking ? (
              <>
                {/* 暫停 / 繼續 */}
                <button
                  onClick={isTtsPaused ? resumeTts : pauseTts}
                  aria-label={isTtsPaused ? '繼續系統朗讀' : '暫停系統朗讀'}
                  className={`flex-1 py-3 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all shadow active:scale-95 ${
                    isTtsPaused
                      ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                      : 'bg-amber-700 hover:bg-amber-600 text-white'
                  }`}
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    {isTtsPaused
                      ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 9v6m4-6v6" />
                    }
                  </svg>
                  {processZhuyin(isTtsPaused ? '繼續' : '暫停')}
                </button>
                {/* 停止 */}
                <button
                  onClick={stopTts}
                  aria-label="停止系統朗讀"
                  className="flex-1 py-3 rounded-xl font-bold text-base flex items-center justify-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-800 transition-all shadow active:scale-95"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 10h6v4H9z" />
                  </svg>
                  {processZhuyin('停止')}
                </button>
              </>
            ) : (
              <>
                {/* 系統朗讀 */}
                <button
                  onClick={speakCurrentParagraph}
                  aria-label="播放這段的系統示範朗讀"
                  className="flex-1 py-3 rounded-xl font-bold text-base flex items-center justify-center gap-2 bg-gray-200 hover:bg-gray-300 text-gray-800 transition-all shadow active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" />
                  </svg>
                  {processZhuyin('系統朗讀')}
                </button>
                {/* 開始朗讀 */}
                <button
                  onClick={startSession}
                  disabled={isAdvancing}
                  aria-label={isAdvancing ? '請稍候，正在處理' : '開始朗讀這段，啟動語音辨識'}
                  className={`flex-1 py-3 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all shadow active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
                    isAdvancing
                      ? 'bg-gray-300 text-gray-400 cursor-not-allowed opacity-50'
                      : 'bg-accent hover:bg-accent-hover text-white'
                  }`}
                >
                  <div className="w-2.5 h-2.5 bg-white rounded-full" aria-hidden="true" />
                  {processZhuyin(isAdvancing ? '請稍候...' : '開始朗讀')}
                </button>
              </>
            )}
          </div>

          {/* Optional recording for student self-review */}
          <div className="border-t border-gray-100 pt-2">
            <button
              onClick={() => setShowRecorder(prev => !prev)}
              aria-label={showRecorder ? '收起錄音重聽功能' : '展開錄音重聽功能'}
              aria-expanded={showRecorder}
              aria-controls="recorder-panel"
              className="w-full flex items-center justify-between px-2 py-1 text-xs text-gray-400 hover:text-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 rounded"
            >
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm7 8a1 1 0 0 1 1 1 8 8 0 0 1-7 7.938V21h2a1 1 0 0 1 0 2H9a1 1 0 0 1 0-2h2v-1.062A8 8 0 0 1 4 12a1 1 0 0 1 2 0 6 6 0 0 0 12 0 1 1 0 0 1 1-1z" />
                </svg>
                錄音重聽（選用）
              </span>
              <svg
                className={`w-3.5 h-3.5 transition-transform ${showRecorder ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showRecorder && (
              <div id="recorder-panel" className="pt-2 pb-1">
                <RecordingButton maxDurationSeconds={60} label="錄下這段朗讀，完成後可重聽" />
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {/* 上一段 — only navigate back to completed or current paragraphs */}
            <button
              onClick={() => {
                const prevIdx = currentLineIndex - 1;
                if (prevIdx >= 0 && (lineStatuses[prevIdx] === 'completed' || lineStatuses[prevIdx] === 'current')) {
                  stopSession();
                  setCurrentLineIndex(prevIdx);
                }
              }}
              disabled={currentLineIndex === 0}
              aria-label={currentLineIndex === 0 ? '已是第一段' : `返回第 ${currentLineIndex} 段`}
              className={`flex-1 py-3 rounded-lg text-base font-bold border border-gray-200 leading-[2.6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
                zhuyinActive ? 'tracking-[0.2em]' : ''
              } ${
                currentLineIndex === 0
                  ? 'bg-gray-300 text-gray-300 cursor-not-allowed'
                  : 'bg-gray-300 hover:bg-gray-200 text-gray-600'
              }`}
            >
              {processZhuyin('上一段')}
            </button>

            {/* 下一段 / 觀看總結報告 — gated by paragraph completion */}
            {(() => {
              const isLastLine = currentLineIndex === story.content.length - 1;
              const allDone = completedParagraphs.size === story.content.length;
              const nextUnlocked = !isLastLine && maxUnlockedIndex > currentLineIndex;

              if (isLastLine) {
                // Last paragraph: only show finish button when all paragraphs are done
                return (
                  <button
                    onClick={handleFinish}
                    disabled={!allDone}
                    aria-label={!allDone ? '請完成所有段落後查看總結報告' : '查看朗讀總結報告'}
                    className={`flex-1 py-3 rounded-lg text-base font-bold border border-gray-200 leading-[2.6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${zhuyinActive ? 'tracking-[0.2em]' : ''} ${
                      allDone
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        : 'bg-gray-300 text-gray-300 cursor-not-allowed'
                    }`}
                  >
                    {processZhuyin('觀看總結報告')}
                  </button>
                );
              }

              // Non-last paragraph: next paragraph is unlocked only if current is completed
              return (
                <button
                  onClick={() => {
                    if (nextUnlocked) {
                      stopSession();
                      setCurrentLineIndex(prev => prev + 1);
                    }
                  }}
                  disabled={!nextUnlocked}
                  aria-label={!nextUnlocked ? '請先完成此段朗讀才能繼續（正確率需達 60%）' : `前往第 ${currentLineIndex + 2} 段`}
                  className={`flex-1 py-3 rounded-lg text-base font-bold border border-gray-200 leading-[2.6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${zhuyinActive ? 'tracking-[0.2em]' : ''} ${
                    nextUnlocked
                      ? 'bg-gray-300 hover:bg-gray-200 text-gray-600'
                      : 'bg-gray-300 text-gray-300 cursor-not-allowed'
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
              className={`w-full py-1.5 rounded-lg text-base font-bold text-gray-400 hover:text-gray-600 transition-colors leading-[2.6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${zhuyinActive ? 'tracking-[0.2em]' : ''}`}
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
