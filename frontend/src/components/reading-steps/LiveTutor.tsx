
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Story, ReadingAttempt, LiveMessage } from '../../types';
import { correctHomophones } from '../../utils/pinyin';
import { PolyphonicProcessor, buildZhuyinString } from '../zhuyin/polyphonicProcessor';

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
  '好的，繼續下一段！',
  '唸得可以喔！下一段。',
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
/*  Text processing helpers                                           */
/* ------------------------------------------------------------------ */

const cleanChineseText = (text: string) => {
  if (!text) return '';
  return text
    .replace(/([\u4e00-\u9fa5！，。？：；（）])\s+([\u4e00-\u9fa5！，。？：；（）])/g, '$1$2')
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2')
    .trim();
};

/* ---- Arabic numeral → Chinese numeral conversion ---- */

const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/**
 * Convert an integer to Chinese numeral string.
 * e.g. 4000 → "四千",  12 → "十二",  305 → "三百零五"
 */
const intToChinese = (num: number): string => {
  if (num === 0) return '零';
  let n = num;
  let result = '';

  // 億
  if (n >= 100_000_000) {
    result += intToChinese(Math.floor(n / 100_000_000)) + '億';
    n %= 100_000_000;
    if (n > 0 && n < 10_000_000) result += '零';
  }
  // 萬
  if (n >= 10_000) {
    result += intToChinese(Math.floor(n / 10_000)) + '萬';
    n %= 10_000;
    if (n > 0 && n < 1_000) result += '零';
  }
  // 千
  if (n >= 1_000) {
    result += CHINESE_DIGITS[Math.floor(n / 1_000)] + '千';
    n %= 1_000;
    if (n > 0 && n < 100) result += '零';
  }
  // 百
  if (n >= 100) {
    result += CHINESE_DIGITS[Math.floor(n / 100)] + '百';
    n %= 100;
    if (n > 0 && n < 10) result += '零';
  }
  // 十
  if (n >= 10) {
    const tens = Math.floor(n / 10);
    // Skip leading 一 only for 10-19 at the top level (十二, not 一十二)
    if (tens > 1 || result.length > 0) {
      result += CHINESE_DIGITS[tens];
    }
    result += '十';
    n %= 10;
  }
  // 個位
  if (n > 0) {
    result += CHINESE_DIGITS[n];
  }
  return result;
};

/** Replace all Arabic numeral sequences in text with Chinese equivalents. */
const normalizeNumbers = (text: string): string =>
  text.replace(/\d+/g, (m) => intToChinese(parseInt(m, 10)));

const normalizeForComparison = (text: string) =>
  normalizeNumbers(cleanChineseText(text)).replace(/[「」『』，。！？：；、\s]/g, '');

/**
 * Compute character-frequency match rate between spoken (after homophone
 * correction) and target text.  Returns 0–1.
 */
const computeMatchRate = (spokenRaw: string, targetRaw: string): number => {
  const spoken = normalizeForComparison(spokenRaw);
  const target = normalizeForComparison(targetRaw);
  if (!target) return 0;
  if (!spoken) return 0;

  const spokenFreq: Record<string, number> = {};
  for (const ch of spoken) spokenFreq[ch] = (spokenFreq[ch] || 0) + 1;

  let matched = 0;
  for (const ch of target) {
    if (spokenFreq[ch] && spokenFreq[ch] > 0) {
      matched++;
      spokenFreq[ch]--;
    }
  }

  return matched / target.length;
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
}

const LiveTutor: React.FC<LiveTutorProps> = ({
  story,
  rightPanelWidth,
  onPanelWidthChange,
  onFinish,
  onCancel,
}) => {
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
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
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

    // Step 2: Match rate
    const matchRate = computeMatchRate(corrected, targetText);

    // Step 3: Determine tier
    const isLastLine = lineIdx >= story.content.length - 1;
    let tier: 1 | 2 | 3;
    if (matchRate >= 0.8) tier = 1;
    else if (matchRate >= 0.6) tier = 2;
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

    // Step 6: CPM
    const targetChars = normalizeForComparison(targetText).length;
    const durationSec = Math.max(durationMs / 1000, 0.5);
    const cpm = Math.round((targetChars / durationSec) * 60);

    // Step 7: Record line result
    const result: LineResult = { lineIndex: lineIdx, matchRate, cpm, durationMs, transcript: cleaned };
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
      setTimeout(() => {
        setCurrentLineIndex(prev => prev + 1);
        isAdvancingRef.current = false;
        setIsAdvancing(false);
      }, 1500);
    } else if (shouldFinish) {
      stopSession();
      setTimeout(() => {
        const allResults = [...lineResults, result];
        const avgMatchRate = allResults.reduce((s, r) => s + r.matchRate, 0) / allResults.length;
        const totalChars = allResults.reduce(
          (s, r) => s + normalizeForComparison(story.content[r.lineIndex] || '').length, 0
        );
        const totalDurationSec = allResults.reduce((s, r) => s + r.durationMs, 0) / 1000;
        const overallCpm = totalDurationSec > 0 ? Math.round((totalChars / totalDurationSec) * 60) : 0;
        onFinish({
          storyId: story.id, accuracy: Math.round(avgMatchRate * 100), fluency: overallCpm,
          cpm: overallCpm, mispronouncedWords: extractPracticeChars(allResults, story.content),
          transcription: allResults.map(r => r.transcript).join(' '), timestamp: Date.now(),
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
    const totalChars = lineResults.reduce(
      (s, r) => s + normalizeForComparison(story.content[r.lineIndex] || '').length, 0
    );
    const totalDurationSec = lineResults.reduce((s, r) => s + r.durationMs, 0) / 1000;
    const overallCpm = totalDurationSec > 0 ? Math.round((totalChars / totalDurationSec) * 60) : 0;
    onFinish({
      storyId: story.id, accuracy: Math.round(avgMatchRate * 100), fluency: overallCpm,
      cpm: overallCpm, mispronouncedWords: extractPracticeChars(lineResults, story.content),
      transcription: lineResults.map(r => r.transcript).join(' '), timestamp: Date.now(),
    });
  };

  /* ================================================================ */
  /*  JSX                                                             */
  /* ================================================================ */

  return (
    <div
      className="flex flex-1 h-full bg-[#0d1117] overflow-hidden"
      style={{
        fontFamily: zhuyinActive
          ? "'BpmfIansui', 'Iansui', 'Noto Sans TC', sans-serif"
          : "'Iansui', 'Noto Sans TC', sans-serif",
      }}
    >
      {/* CENTER: Editor */}
      <div className="flex-1 flex flex-col bg-[#0d1117]">
        <div className="h-9 bg-[#161b22] border-b border-[#30363d] flex items-center px-2 gap-2">
          <div className="h-full px-4 flex items-center bg-[#0d1117] border-t-2 border-indigo-500 border-x border-[#30363d] text-xs text-slate-200 gap-2">
            {processZhuyin(story.filename)}
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setZhuyinEnabled(!zhuyinEnabled)}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              zhuyinEnabled && zhuyinReady
                ? 'bg-indigo-600/80 text-white hover:bg-indigo-500'
                : 'bg-[#30363d] text-slate-400 hover:bg-[#3d444d]'
            }`}
            title={zhuyinEnabled ? '隱藏注音' : '顯示注音'}
          >
            注音 {zhuyinEnabled ? 'ON' : 'OFF'}
          </button>
        </div>

        <div className="flex-1 p-8 lg:p-16 overflow-y-auto custom-scrollbar">
          <div className="max-w-3xl mx-auto space-y-12">
            {story.content.map((line, idx) => (
              <div
                key={idx}
                ref={idx === currentLineIndex ? activeLineRef : null}
                className={`transition-all duration-700 rounded-2xl p-8 border ${
                  idx === currentLineIndex
                    ? 'bg-indigo-500/5 border-indigo-500/40 shadow-[0_0_40px_rgba(99,102,241,0.1)] scale-[1.03]'
                    : 'opacity-40 border-transparent'
                }`}
              >
                <p
                  className={`text-2xl lg:text-3xl leading-[2.6] ${
                    idx === currentLineIndex ? 'text-white font-bold' : 'text-slate-400'
                  }`}
                >
                  {zhuyinLines ? zhuyinLines[idx] : line}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="h-7 bg-[#161b22] border-t border-[#30363d] flex items-center px-4 justify-between text-[10px] text-slate-500 uppercase">
          <div className="flex gap-4">
            <span>段 {currentLineIndex + 1} / {story.content.length}</span>
            <span>UTF-8</span>
          </div>
          <div className="flex gap-3">
            <span className={isSessionActive ? 'text-green-500 font-bold' : isPreparing ? 'text-yellow-500 font-bold' : 'text-slate-700'}>
              {isSessionActive ? '• LISTENING' : isPreparing ? '• PREPARING' : '• IDLE'}
            </span>
          </div>
        </div>
      </div>

      {/* Resizable divider */}
      <div
        onMouseDown={onDividerMouseDown}
        className="w-1 flex-shrink-0 bg-[#30363d] hover:bg-indigo-500 cursor-col-resize transition-colors"
      />

      {/* RIGHT: Interaction panel */}
      <div className="flex-shrink-0 bg-[#0d1117] flex flex-col h-full min-h-0" style={{ width: rightPanelWidth }}>
        <div className="h-9 flex-shrink-0 bg-[#161b22] border-b border-[#30363d] flex items-center px-4">
          <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">
            Live Feedback
          </span>
        </div>

        {/* Chat area */}
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/10"
        >
          {messages.map(m => (
            <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <span className="text-[9px] font-bold text-slate-700 mb-0.5 uppercase">
                {m.role === 'user' ? 'STUDENT' : 'TUTOR'}
              </span>
              <div
                className={`px-3 py-2 rounded-2xl text-sm max-w-[90%] shadow-lg ${
                  zhuyinActive ? 'leading-[2.4]' : 'leading-relaxed'
                } ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-tr-none'
                    : 'bg-[#21262d] text-slate-200 border border-[#30363d] rounded-tl-none'
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
              <div className={`px-3 py-2 rounded-2xl text-sm bg-green-900/30 text-green-200 border border-green-700/30 rounded-tl-none ${zhuyinActive ? 'leading-[2.4]' : ''}`}>
                {processZhuyin('請朗讀上方的段落')}
              </div>
            </div>
          )}

          {streamingUserInput && (
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-bold text-indigo-500 mb-0.5 uppercase animate-pulse">
                LISTENING...
              </span>
              <div className={`px-3 py-2 rounded-2xl text-sm bg-indigo-600/60 text-indigo-100 rounded-tr-none max-w-[90%] border border-indigo-500/30 ${zhuyinActive ? 'leading-[2.4]' : ''}`}>
                {processZhuyin(streamingUserInput)}
              </div>
            </div>
          )}

          {isAdvancing && (
            <div className="flex flex-col items-start">
              <span className="text-[9px] font-bold text-indigo-500 mb-0.5 uppercase animate-pulse">
                NEXT...
              </span>
              <div className={`px-3 py-2 rounded-2xl text-sm bg-[#21262d] text-indigo-300 border border-indigo-900/30 rounded-tl-none ${zhuyinActive ? 'leading-[2.4]' : ''}`}>
                {processZhuyin('正在前往下一段...')}
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex-shrink-0 p-3 bg-[#161b22] border-t border-[#30363d] space-y-2">
          <div className={`h-10 p-2 rounded-lg bg-black/40 border border-[#30363d] text-xs text-indigo-300 overflow-hidden ${zhuyinActive ? 'leading-[2.4]' : ''}`}>
            {streamingUserInput ? processZhuyin(streamingUserInput) : (
              <span className="text-slate-800 italic">
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
                  className="flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 bg-slate-900 text-slate-700 cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" />
                  </svg>
                  {processZhuyin('系統朗讀')}
                </button>
                <button
                  disabled
                  className="flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 bg-slate-800 text-slate-400 cursor-wait"
                >
                  <div className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                  {processZhuyin('準備中...')}
                </button>
              </>
            ) : isSessionActive ? (
              <button
                onClick={submitSentence}
                disabled={isAdvancing || !streamingUserInput}
                className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow active:scale-95 ${
                  isAdvancing || !streamingUserInput
                    ? 'bg-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
                {processZhuyin(isAdvancing ? '請稍候...' : '完成這段')}
              </button>
            ) : isTtsSpeaking ? (
              <>
                {/* 暫停 / 繼續 */}
                <button
                  onClick={isTtsPaused ? resumeTts : pauseTts}
                  className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow active:scale-95 ${
                    isTtsPaused
                      ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                      : 'bg-amber-700 hover:bg-amber-600 text-white'
                  }`}
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  className="flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200 transition-all shadow active:scale-95"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  className="flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200 transition-all shadow active:scale-95"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" />
                  </svg>
                  {processZhuyin('系統朗讀')}
                </button>
                {/* 開始朗讀 */}
                <button
                  onClick={startSession}
                  disabled={isAdvancing}
                  className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow active:scale-95 ${
                    isAdvancing
                      ? 'bg-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  }`}
                >
                  <div className="w-2.5 h-2.5 bg-white rounded-full" />
                  {processZhuyin(isAdvancing ? '請稍候...' : '開始朗讀')}
                </button>
              </>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => {
                stopSession();
                setCurrentLineIndex(prev => Math.max(0, prev - 1));
              }}
              disabled={currentLineIndex === 0}
              className={`flex-1 py-2 rounded-lg text-xs font-bold border border-[#30363d] ${
                zhuyinActive ? 'leading-[2.4]' : ''
              } ${
                currentLineIndex === 0
                  ? 'bg-slate-900 text-slate-700 cursor-not-allowed'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-400'
              }`}
            >
              {processZhuyin('上一段')}
            </button>
            <button
              onClick={() => {
                if (currentLineIndex < story.content.length - 1) {
                  stopSession();
                  setCurrentLineIndex(prev => prev + 1);
                } else {
                  handleFinish();
                }
              }}
              className={`flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg text-xs font-bold border border-[#30363d] ${zhuyinActive ? 'leading-[2.4]' : ''}`}
            >
              {processZhuyin(currentLineIndex === story.content.length - 1 ? '觀看總結報告' : '下一段')}
            </button>
          </div>

          {isSessionActive && (
            <button
              onClick={stopSession}
              className={`w-full py-1.5 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-400 transition-colors ${zhuyinActive ? 'leading-[2.4]' : ''}`}
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
