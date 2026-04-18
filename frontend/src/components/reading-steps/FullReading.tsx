import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Story, FullReadingResult, DiffToken } from '../../types';
import { cleanChineseText } from '../../utils/textDiff';
import { analyzeFluency } from '../../utils/fluencyAnalyzer';
import DiffDisplay from '../ui/DiffDisplay';
import { useZhuyin } from '../../context/ZhuyinContext';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { useTtsPlayback } from '../../hooks/useTtsPlayback';
import { cancelTts } from '../../services/ttsApi';
import { getReadingHistory, type ReadingHistoryPoint } from '../../services/learningApi';
import { saveReadingHistory } from '../../services/readingHistoryApi';
import { scopedStepStorageKey } from '../../services/learningStorageScope';
import { useAuth } from '../../contexts/AuthContext';
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';

/* ------------------------------------------------------------------ */

import { splitZhuyinChars } from '../../utils/zhuyinUtils';
import { displayIdxForProgress } from '../../utils/ttsHighlight';

/* ------------------------------------------------------------------ */

interface FullReadingProps {
  story: Story;
  onFinish: (result: FullReadingResult) => void;
  onBack: () => void;
}

const FullReading: React.FC<FullReadingProps> = ({ story, onFinish, onBack }) => {
  const { token } = useAuth();
  const storageKey = scopedStepStorageKey('fullReading_progress_', story.id);

  type SavedResult = { matchRate: number; feedback: string; diffTokens: DiffToken[]; cpm: number; durationMs: number; errorBreakdown: { correct: number; wrong: number; missing: number; extra: number } };
  const loadSaved = (): { result: SavedResult; transcript: string } | null => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  };
  const savedProgress = useRef(loadSaved());

  const [isPreparing, setIsPreparing]           = useState(false);
  const [isSessionActive, setIsSessionActive]   = useState(false);
  const [streamingTranscript, setStreamingTranscript] = useState(() => savedProgress.current?.transcript ?? '');
  const [micError, setMicError]                 = useState('');
  const [result, setResult]                     = useState<SavedResult | null>(() => savedProgress.current?.result ?? null);
  const { zhuyinActive, processZhuyin } = useZhuyin();

  const isSessionActiveRef        = useRef(false);
  const recognitionRef            = useRef<any>(null);
  const currentTranscriptRef      = useRef('');
  const accumulatedTranscriptRef  = useRef('');
  const startTimeRef              = useRef<number>(0);

  const fullText = useMemo(() => story.content.join(''), [story.content]);

  /* ---- TTS playback (Cloud TTS + cursor animation, same as LiveTutor) ---- */
  const [speakingProgress, setSpeakingProgress] = useState(0);
  const [currentTtsParagraph, setCurrentTtsParagraph] = useState(-1);
  const tts = useTtsPlayback(setSpeakingProgress, () => {});

  /* Speak paragraph by paragraph to track which paragraph is highlighted */
  const ttsQueueRef = useRef<string[]>([]);
  const ttsQueueIdxRef = useRef(0);

  const speakNextInQueue = useCallback(() => {
    const idx = ttsQueueIdxRef.current;
    const queue = ttsQueueRef.current;
    if (idx >= queue.length) {
      setCurrentTtsParagraph(-1);
      setSpeakingProgress(0);
      return;
    }
    setCurrentTtsParagraph(idx);
    setSpeakingProgress(0);
    tts.speakText(queue[idx]);
  }, [tts]);

  const speakFullStory = useCallback(() => {
    ttsQueueRef.current = [...story.content];
    ttsQueueIdxRef.current = 0;
    speakNextInQueue();
  }, [story.content, speakNextInQueue]);

  // When TTS finishes a paragraph, advance to next
  const prevTtsSpeaking = useRef(false);
  useEffect(() => {
    if (prevTtsSpeaking.current && !tts.isTtsSpeaking && currentTtsParagraph >= 0) {
      ttsQueueIdxRef.current += 1;
      speakNextInQueue();
    }
    prevTtsSpeaking.current = tts.isTtsSpeaking;
  }, [tts.isTtsSpeaking, currentTtsParagraph, speakNextInQueue]);

  const stopTtsAll = useCallback(() => {
    tts.stopTts();
    ttsQueueRef.current = [];
    ttsQueueIdxRef.current = 0;
    setCurrentTtsParagraph(-1);
    setSpeakingProgress(0);
  }, [tts]);

  const isTtsPlaying = tts.isTtsSpeaking || currentTtsParagraph >= 0;

  /* ---- Reading history for progress curve ---- */
  const [readingHistory, setReadingHistory] = useState<ReadingHistoryPoint[]>([]);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  useEffect(() => {
    if (!token || !story.id) return;
    getReadingHistory(token, String(story.id)).then(setReadingHistory).catch(() => {});
  }, [token, story.id, historyRefreshKey]);

  /* ---- Save reading attempt to dedicated reading_history table (#909) ---- */
  const savedResultRef = useRef(false);
  useEffect(() => {
    if (!result || savedResultRef.current || !token) return;
    savedResultRef.current = true;
    const durationSec = (result.durationMs || 0) / 1000;
    if (durationSec > 0) {
      saveReadingHistory(
        {
          lesson_id: String(story.id),
          reading_type: 'full',
          cpm: result.cpm || 0,
          accuracy: Math.round((result.matchRate || 0) * 100),
          duration_seconds: durationSec,
        },
        token,
      )
        .then(() => setHistoryRefreshKey(k => k + 1))
        .catch((err) => console.error('Failed to save reading history:', err));
    }
  }, [result, token, story.id]);

  /* ---- Audio recorder (for student playback review) ---- */
  const audioRecorder = useAudioRecorder(120);

  /* ---- localStorage persistence ---- */
  useEffect(() => {
    if (!result) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ result, transcript: streamingTranscript }));
    } catch {}
  }, [result, streamingTranscript, storageKey]);

  const zhuyinLines = useMemo(() => {
    if (!zhuyinActive) return null;
    return story.content.map((line) => processZhuyin(line));
  }, [story.content, zhuyinActive, processZhuyin]);

  /* ---- Cleanup ---- */
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(s => s.getTracks().forEach(t => t.stop()))
      .catch(() => {});
    return () => {
      isSessionActiveRef.current = false;
      if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch (_) {} }
      cancelTts();
      tts.stopTts();
    };
  }, []);

  /* ---- STT ---- */
  const startSession = () => {
    if (isSessionActiveRef.current) return;
    stopTtsAll();
    setIsPreparing(true);
    setMicError('');
    setResult(null);

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicError('您的瀏覽器不支援語音辨識，請使用 Chrome 瀏覽器。');
      setIsPreparing(false); return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'cmn-Hant-TW';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsPreparing(false);
      if (!isSessionActiveRef.current) {
        startTimeRef.current = Date.now();
        isSessionActiveRef.current = true;
        setIsSessionActive(true);
      }
    };

    recognition.onresult = (event: any) => {
      let sessionTranscript = '';
      for (let i = 0; i < event.results.length; i++) sessionTranscript += event.results[i][0].transcript;
      const full = accumulatedTranscriptRef.current + sessionTranscript;
      currentTranscriptRef.current = full;
      setStreamingTranscript(cleanChineseText(full));
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        setMicError('請允許麥克風權限後再試一次。');
        isSessionActiveRef.current = false; setIsSessionActive(false); setIsPreparing(false);
      } else if (event.error === 'audio-capture') {
        setMicError('找不到麥克風，請確認麥克風已連接後再試一次。');
        isSessionActiveRef.current = false; setIsSessionActive(false); setIsPreparing(false);
      }
    };

    recognition.onend = () => {
      if (isSessionActiveRef.current) {
        accumulatedTranscriptRef.current = currentTranscriptRef.current;
        try { recognition.start(); } catch (_) {}
      } else {
        setIsSessionActive(false); setIsPreparing(false); recognitionRef.current = null;
      }
    };

    recognitionRef.current = recognition;
    currentTranscriptRef.current = '';
    accumulatedTranscriptRef.current = '';
    setStreamingTranscript('');
    recognition.start();
    audioRecorder.startRecording().catch(() => {});
  };

  const stopSession = useCallback(() => {
    isSessionActiveRef.current = false;
    setIsSessionActive(false); setIsPreparing(false);
    if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch (_) {} recognitionRef.current = null; }
    currentTranscriptRef.current = '';
    accumulatedTranscriptRef.current = '';
    setStreamingTranscript('');
    audioRecorder.stopRecording();
  }, [audioRecorder]);

  /* ---- Submit & evaluate ---- */
  const submitReading = useCallback(() => {
    const transcript = currentTranscriptRef.current;
    const durationMs = Date.now() - startTimeRef.current;
    stopSession();
    if (!transcript.trim()) { setMicError('未偵測到語音，請再試一次。'); return; }

    const fluency = analyzeFluency({
      spoken: cleanChineseText(transcript),
      target: fullText,
      durationMs,
    });

    setResult({
      matchRate: fluency.accuracy,
      feedback: fluency.feedback,
      diffTokens: fluency.diffTokens,
      cpm: fluency.cpm,
      durationMs: fluency.durationMs,
      errorBreakdown: fluency.errorBreakdown,
    });
    setStreamingTranscript(cleanChineseText(transcript));
  }, [fullText, stopSession]);

  const percent = result ? Math.round(result.matchRate * 100) : 0;

  /* ---- Render paragraph text with optional TTS highlighting ---- */
  const renderParagraph = (line: string, idx: number) => {
    const zhuyinLine = zhuyinLines ? zhuyinLines[idx] : null;
    const isTtsHighlighting = isTtsPlaying && idx === currentTtsParagraph;

    if (isTtsHighlighting) {
      const displayText = (zhuyinActive && typeof zhuyinLine === 'string') ? zhuyinLine : line;
      const chars = splitZhuyinChars(displayText);
      // Use displayIdxForProgress so symbols stripped by _cleanForTts (~~~, ──, …)
      // don't consume TTS progress budget — fixes highlight lag (Issue #1110).
      const splitIdx = displayIdxForProgress(displayText, speakingProgress);
      return (
        <>
          {speakingProgress > 0 && (
            <span className="text-accent font-bold">{chars.slice(0, splitIdx).join('')}</span>
          )}
          <span className={speakingProgress > 0 ? 'opacity-30' : 'opacity-90'}>
            {chars.slice(splitIdx).join('')}
          </span>
        </>
      );
    }

    // Finished TTS paragraphs stay fully colored
    if (isTtsPlaying && currentTtsParagraph > idx) {
      return <span className="text-accent font-bold">{zhuyinLine ?? line}</span>;
    }

    return <>{zhuyinLine ?? line}</>;
  };

  /* ================================================================ */
  /*  JSX                                                             */
  /* ================================================================ */

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

          {/* Full text card */}
          <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 md:p-10 mt-4">
            {/* Instructions */}
            {!result && !isSessionActive && !isPreparing && !isTtsPlaying && (
              <div className="mb-8 pb-6 border-b border-surface-container-high">
                <p className="text-lg font-headline font-bold text-on-surface leading-relaxed">
                  從頭到尾讀完整篇文章，不要中斷！
                </p>
                <p className="text-sm text-on-surface-variant mt-1">
                  標準比逐段朗讀寬鬆，放輕鬆自然地讀吧
                </p>
              </div>
            )}

            {/* Recording indicator */}
            {isSessionActive && (
              <div className="mb-6 flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
                <span className="text-sm font-headline font-bold text-emerald-700 uppercase tracking-wider">聆聽中</span>
              </div>
            )}

            {/* TTS playing indicator */}
            {isTtsPlaying && !isSessionActive && (
              <div className="mb-6 flex items-center gap-2">
                <span className="material-symbols-outlined text-accent text-lg animate-pulse" style={{ fontVariationSettings: "'FILL' 1" }}>volume_up</span>
                <span className="text-sm font-headline font-bold text-accent uppercase tracking-wider">AI 朗讀中</span>
              </div>
            )}

            {/* Paragraphs */}
            <div className="space-y-10">
              {story.content.map((line, idx) => (
                <div key={idx} className="flex gap-4 items-start">
                  <span className="text-xs font-headline font-bold text-on-surface-variant/40 pt-2 select-none shrink-0 w-6 text-right">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <p className={`text-xl md:text-2xl text-on-surface leading-[3rem] md:leading-[3.5rem] ${zhuyinActive ? 'tracking-[0.4em]' : ''}`}>
                    {renderParagraph(line, idx)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Live transcript card */}
          {isSessionActive && streamingTranscript && (
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 mt-6">
              <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-3">即時辨識</p>
              <p className="text-lg text-on-surface leading-relaxed">{streamingTranscript}</p>
            </div>
          )}

          {isSessionActive && !streamingTranscript && (
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 mt-6">
              <p className="text-base text-on-surface-variant leading-relaxed">請開始朗讀上方課文…</p>
            </div>
          )}

          {/* ── Result section ──────────────────────────────────────── */}
          {result && (
            <div className="mt-6 space-y-6">
              {/* Score */}
              <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-8 flex flex-col items-center gap-4">
                <div className={`w-28 h-28 rounded-full flex items-center justify-center border-4 ${
                  percent >= 80 ? 'border-emerald-500'
                  : percent >= 60 ? 'border-amber-500'
                  : 'border-tertiary'
                }`}>
                  <span className={`text-3xl font-headline font-black ${
                    percent >= 80 ? 'text-emerald-700'
                    : percent >= 60 ? 'text-amber-700'
                    : 'text-tertiary'
                  }`}>{percent}%</span>
                </div>
                <p className={`text-base font-headline font-bold text-center ${
                  percent >= 80 ? 'text-emerald-700'
                  : percent >= 60 ? 'text-amber-700'
                  : 'text-on-surface-variant'
                }`}>
                  {result.feedback}
                </p>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-surface-container-low p-5 rounded-3xl flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-xl text-emerald-700">speed</span>
                  </div>
                  <div>
                    <div className="font-headline text-on-surface-variant font-bold text-xs uppercase tracking-wider">語速</div>
                    <div className="text-lg font-headline font-bold text-on-surface mt-0.5">{result.cpm} 字/分</div>
                  </div>
                </div>
                <div className="bg-surface-container-low p-5 rounded-3xl flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-xl text-accent">verified</span>
                  </div>
                  <div>
                    <div className="font-headline text-on-surface-variant font-bold text-xs uppercase tracking-wider">準確度</div>
                    <div className="text-lg font-headline font-bold text-on-surface mt-0.5">{percent}%</div>
                  </div>
                </div>
              </div>

              {/* Transcript */}
              {streamingTranscript && (
                <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
                  <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-3">你說的</p>
                  <p className="text-base text-on-surface leading-relaxed line-clamp-6">{streamingTranscript}</p>
                </div>
              )}

              {/* Diff display */}
              {result.diffTokens && result.diffTokens.length > 0 && (
                <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
                  <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-3">逐字比對</p>
                  <DiffDisplay tokens={result.diffTokens} showLegend className="text-lg" />
                </div>
              )}

              {/* Audio playback */}
              {audioRecorder.audioUrl && (
                <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
                  <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-3">重聽錄音</p>
                  <audio src={audioRecorder.audioUrl} controls className="w-full h-10" aria-label="播放您的朗讀錄音" />
                </div>
              )}

              {/* Reading progress curve (#909) */}
              {readingHistory.length >= 1 && (
                <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
                  <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-3">
                    朗讀進步曲線
                    {readingHistory.length >= 2 && (() => {
                      const first = readingHistory[0]?.cpm;
                      const last = readingHistory[readingHistory.length - 1]?.cpm;
                      if (first && last && first > 0) {
                        const pct = Math.round(((last - first) / first) * 100);
                        return pct > 0
                          ? <span className="ml-1 text-emerald-600">▲{pct}%</span>
                          : pct < 0 ? <span className="ml-1 text-tertiary">▼{Math.abs(pct)}%</span> : null;
                      }
                      return null;
                    })()}
                  </p>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={readingHistory.map((h, i) => ({
                      attempt: `第${i + 1}次`,
                      cpm: h.cpm,
                      accuracy: h.accuracy,
                    }))}>
                      <XAxis dataKey="attempt" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="cpm" tick={{ fontSize: 11 }} width={32} />
                      <Tooltip
                        formatter={(value: number, name: string) => [
                          name === 'cpm' ? `${value} 字/分` : `${value}%`,
                          name === 'cpm' ? '語速' : '準確度',
                        ]}
                      />
                      <ReferenceLine yAxisId="cpm" y={90} stroke="#ef4444" strokeDasharray="6 3" label={{ value: '目標 90', position: 'right', fill: '#ef4444', fontSize: 10 }} />
                      <Line yAxisId="cpm" type="monotone" dataKey="cpm" stroke="#564ABF" strokeWidth={2.5} dot={{ r: 3, fill: '#564ABF' }} name="cpm" />
                      <Line yAxisId="cpm" type="monotone" dataKey="accuracy" stroke="#006947" strokeWidth={2} dot={{ r: 3, fill: '#006947' }} strokeDasharray="4 2" name="accuracy" />
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="text-xs text-on-surface-variant text-center mt-2">
                    本篇已練習 {readingHistory.length} 次
                  </p>
                </div>
              )}
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

      {/* ── Fixed bottom CTA ──────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
           style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
        <div className="max-w-md mx-auto pointer-events-auto flex flex-col items-center gap-3">

          {result ? (
            <>
              <button
                onClick={() => { try { localStorage.removeItem(storageKey); } catch {} savedResultRef.current = false; setResult(null); setStreamingTranscript(''); audioRecorder.clearRecording(); }}
                className="w-full h-12 rounded-full font-headline font-bold text-base text-on-surface bg-surface-container-lowest shadow-editorial hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">refresh</span>
                再讀一次
              </button>
              <button
                onClick={() => { try { localStorage.removeItem(storageKey); } catch {} onFinish({ matchRate: result.matchRate, feedback: result.feedback, diffTokens: result.diffTokens, transcript: streamingTranscript, cpm: result.cpm, durationMs: result.durationMs, errorBreakdown: result.errorBreakdown }); }}
                className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
              >
                <span>查看報告</span>
                <span className="material-symbols-outlined text-xl">arrow_forward</span>
              </button>
            </>
          ) : isPreparing ? (
            <button disabled className="w-full h-14 rounded-full font-headline font-bold text-lg bg-surface-container-high text-on-surface-variant cursor-wait flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-on-surface-variant border-t-transparent rounded-full animate-spin" />
              準備中...
            </button>
          ) : isSessionActive ? (
            <button
              onClick={submitReading}
              disabled={!streamingTranscript}
              className={`w-full h-14 rounded-full font-headline font-bold text-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${
                streamingTranscript
                  ? 'text-white shadow-[0_12px_48px_rgba(0,105,71,0.3)]'
                  : 'bg-surface-container-high text-on-surface-variant cursor-not-allowed'
              }`}
              style={streamingTranscript ? { background: 'linear-gradient(135deg, #006947, #34d399)' } : undefined}
            >
              <span className="material-symbols-outlined text-xl">check</span>
              完成朗讀
            </button>
          ) : isTtsPlaying ? (
            /* TTS playing — show pause/stop controls */
            <div className="w-full flex gap-3">
              <button
                onClick={tts.isTtsPaused ? tts.resumeTts : tts.pauseTts}
                className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-accent/10 text-accent hover:bg-accent/15 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {tts.isTtsPaused ? 'play_arrow' : 'pause'}
                </span>
                {tts.isTtsPaused ? '繼續' : '暫停'}
              </button>
              <button
                onClick={stopTtsAll}
                className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>stop</span>
                停止
              </button>
            </div>
          ) : (
            /* Idle — AI朗讀 + 開始朗讀 side by side */
            <div className="w-full flex gap-3">
              <button
                onClick={speakFullStory}
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
                開始朗讀
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Background decoration */}
      <div className="fixed top-0 right-0 -z-10 w-96 h-96 bg-accent/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-0 left-0 -z-10 w-96 h-96 bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #b0ada6; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #797770; }
      `}</style>
    </div>
  );
};

export default FullReading;
