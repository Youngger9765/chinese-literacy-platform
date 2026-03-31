import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Story, FullReadingResult, DiffToken } from '../../types';
import { cleanChineseText } from '../../utils/textDiff';
import { analyzeFluency } from '../../utils/fluencyAnalyzer';
import DiffDisplay from '../ui/DiffDisplay';
import { PolyphonicProcessor, buildZhuyinString } from '../zhuyin/polyphonicProcessor';
import ZhuyinToggle from '../ui/ZhuyinToggle';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { speakText as azureSpeakText, cancelTts } from '../../services/ttsApi';

/* ------------------------------------------------------------------ */

interface FullReadingProps {
  story: Story;
  rightPanelWidth: number;
  onPanelWidthChange: (w: number) => void;
  onFinish: (result: FullReadingResult) => void;
  onBack: () => void;
}

const FullReading: React.FC<FullReadingProps> = ({ story, rightPanelWidth, onPanelWidthChange, onFinish, onBack }) => {
  const isMobile = useIsMobile();
  const storageKey = `fullReading_progress_${story.id}`;

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
  const [isTtsSpeaking, setIsTtsSpeaking]       = useState(false);
  const [isTtsPaused, setIsTtsPaused]           = useState(false);
  const [isTtsLoading, setIsTtsLoading]         = useState(false); // true while TTS is buffering before playback starts
  const [streamingTranscript, setStreamingTranscript] = useState(() => savedProgress.current?.transcript ?? '');
  const [micError, setMicError]                 = useState('');
  const [result, setResult]                     = useState<SavedResult | null>(() => savedProgress.current?.result ?? null);
  const [zhuyinEnabled, setZhuyinEnabled]       = useState(true);
  const [zhuyinReady, setZhuyinReady]           = useState(false);

  const isSessionActiveRef        = useRef(false);
  const recognitionRef            = useRef<any>(null);
  const currentTranscriptRef      = useRef('');
  const accumulatedTranscriptRef  = useRef('');
  const isDraggingRef             = useRef(false);
  const dragStartXRef             = useRef(0);
  const dragStartWidthRef         = useRef(0);
  const startTimeRef              = useRef<number>(0);

  const zhuyinActive = zhuyinReady && zhuyinEnabled;
  const fullText = useMemo(() => story.content.join(''), [story.content]);

  /* ---- Audio recorder (for student playback review) ---- */
  const audioRecorder = useAudioRecorder(120);

  /* ---- localStorage persistence ---- */
  useEffect(() => {
    if (!result) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ result, transcript: streamingTranscript }));
    } catch {}
  }, [result, streamingTranscript, storageKey]);

  /* ---- Zhuyin ---- */
  useEffect(() => {
    PolyphonicProcessor.instance.loadPolyphonicData()
      .then(() => setZhuyinReady(true))
      .catch(err => console.error('Failed to load zhuyin data:', err));
  }, []);

  const processZhuyin = useCallback((text: string): string => {
    if (!zhuyinActive) return text;
    try { return buildZhuyinString(PolyphonicProcessor.instance.process(text)); }
    catch { return text; }
  }, [zhuyinActive]);

  const zhuyinLines = useMemo(() => {
    if (!zhuyinActive) return null;
    try { return story.content.map(line => buildZhuyinString(PolyphonicProcessor.instance.process(line))); }
    catch { return null; }
  }, [story.content, zhuyinActive]);

  /* ---- Resizable panel ---- */
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

  /* ---- Cleanup ---- */
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(s => s.getTracks().forEach(t => t.stop()))
      .catch(() => {});
    return () => {
      isSessionActiveRef.current = false;
      if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch (_) {} }
      cancelTts();
    };
  }, []);

  /* ---- TTS: read full story via Azure TTS ---- */
  const speakFullStory = useCallback(() => {
    cancelTts();
    setIsTtsPaused(false);
    setIsTtsSpeaking(true);
    azureSpeakText(fullText)
      .then(() => { setIsTtsSpeaking(false); setIsTtsPaused(false); })
      .catch(() => { setIsTtsSpeaking(false); setIsTtsPaused(false); });
  }, [fullText]);

  const pauseTts = () => { cancelTts(); setIsTtsPaused(true); };
  const resumeTts = () => {
    setIsTtsPaused(false);
    setIsTtsSpeaking(true);
    azureSpeakText(fullText)
      .then(() => { setIsTtsSpeaking(false); setIsTtsPaused(false); })
      .catch(() => { setIsTtsSpeaking(false); setIsTtsPaused(false); });
  };
  const stopTts = () => { cancelTts(); setIsTtsSpeaking(false); setIsTtsPaused(false); };

  /* ---- STT ---- */
  const startSession = () => {
    if (isSessionActiveRef.current) return;
    cancelTts();
    setIsTtsSpeaking(false);
    setIsTtsPaused(false);
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
    // Also start audio recording so student can replay
    audioRecorder.startRecording().catch(() => {
      // Recording is best-effort; STT continues even if recorder fails
    });
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

  return (
    <div
      className={`flex ${isMobile ? 'flex-col' : 'flex-row'} flex-1 h-full bg-amber-50 overflow-hidden`}
      style={{
        fontFamily: zhuyinActive
          ? "'BpmfIansui', 'Iansui', 'Noto Sans TC', sans-serif"
          : "'Iansui', 'Noto Sans TC', sans-serif",
      }}
    >
      {/* LEFT: Full story text */}
      <div className={`flex flex-col bg-amber-50 min-w-0 ${isMobile ? 'h-[60vh]' : 'flex-1'}`}>
        {/* Tab bar */}
        <div className="h-9 bg-white border-b border-gray-200 flex items-center px-2 gap-2 shrink-0">
          <div className="h-full px-4 flex items-center bg-amber-50 border-t-2 border-accent border-x border-gray-200 text-xs text-gray-800">
            {story.filename}
          </div>
          <div className="flex-1" />
          <ZhuyinToggle enabled={zhuyinEnabled} ready={zhuyinReady} onToggle={() => setZhuyinEnabled(!zhuyinEnabled)} />
        </div>

        {/* All paragraphs */}
        <div className={`flex-1 ${isMobile ? 'p-4' : 'p-8 lg:p-16'} overflow-y-auto custom-scrollbar`}>
          <div className="max-w-3xl mx-auto space-y-20">
            {story.content.map((line, idx) => (
              <div
                key={idx}
                className="rounded-2xl px-6 py-12 border-b border-gray-200 last:border-b-0 hover:bg-white/30 transition-all"
              >
                <p className={`text-2xl lg:text-3xl text-gray-800 leading-[3.5rem] lg:leading-[3.5rem] ${zhuyinActive ? 'tracking-[0.4em]' : ''}`}>
                  {zhuyinLines ? zhuyinLines[idx] : line}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Status bar */}
        <div className="h-7 bg-white border-t border-gray-200 flex items-center px-4 text-[10px] text-gray-500 uppercase shrink-0">
          <span>共 {story.content.length} 段 · {story.title}</span>
          <div className="flex-1" />
          <span className={isSessionActive ? 'text-green-500 font-bold' : isPreparing ? 'text-yellow-500 font-bold' : 'text-gray-300'}>
            {isSessionActive ? '• LISTENING' : isPreparing ? '• PREPARING' : '• IDLE'}
          </span>
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

      {/* RIGHT: Recording panel */}
      <div
        className={`bg-amber-50 flex flex-col min-h-0 ${isMobile ? 'flex-1' : 'flex-shrink-0 h-full'}`}
        style={isMobile ? undefined : { width: rightPanelWidth }}
      >
        {/* Header */}
        <div className="h-9 shrink-0 bg-white border-b border-gray-200 flex items-center px-4">
          <span className="text-[10px] font-black text-accent-light uppercase tracking-widest">全文朗讀</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-gray-50">

          {/* Instructions */}
          {!result && !isSessionActive && !isPreparing && (
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <p className="text-base font-bold text-gray-800 leading-relaxed mb-2">
                你剛才一段一段練習過了，現在試著從頭到尾讀完整篇文章，不要中斷！
              </p>
              <p className="text-base text-gray-600 leading-relaxed">
                請從頭到尾朗讀整篇課文。讀完後按「完成朗讀」送出。
              </p>
              <p className="text-sm text-gray-400 mt-2">
                標準比逐段朗讀寬鬆，放輕鬆自然地讀吧！
              </p>
            </div>
          )}

          {/* Live transcript */}
          {isSessionActive && streamingTranscript && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-bold text-accent-light uppercase animate-pulse">LISTENING...</span>
              <div className="bg-accent/20 border border-accent/30 rounded-xl px-3 py-2.5 text-base text-gray-800 leading-relaxed">
                {streamingTranscript}
              </div>
            </div>
          )}

          {isSessionActive && !streamingTranscript && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-bold text-green-500 uppercase animate-pulse">LISTENING</span>
              <div className="bg-green-900/20 border border-green-700/30 rounded-xl px-3 py-2.5 text-base text-gray-600 leading-relaxed">
                請朗讀左側課文，從頭到尾…
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-4">
                <div className={`w-24 h-24 rounded-full flex items-center justify-center border-4 ${
                  percent >= 80 ? 'border-emerald-500 text-emerald-800'
                  : percent >= 60 ? 'border-amber-500 text-amber-800'
                  : 'border-red-500/60 text-red-300'
                }`}>
                  <span className="text-2xl font-black">{percent}%</span>
                </div>
                <p className={`text-sm font-bold text-center ${
                  percent >= 80 ? 'text-emerald-800'
                  : percent >= 60 ? 'text-amber-800'
                  : 'text-gray-600'
                }`}>
                  {result.feedback}
                </p>
              </div>

              {streamingTranscript && (
                <div className="bg-white border border-gray-200 rounded-xl px-3 py-2.5">
                  <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-widest">你說的</p>
                  <p className="text-xs text-gray-600 leading-relaxed line-clamp-6">{streamingTranscript}</p>
                </div>
              )}

              {result.diffTokens && result.diffTokens.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl px-3 py-2.5">
                  <p className="text-[10px] text-gray-500 mb-2 uppercase tracking-widest">逐字比對</p>
                  <DiffDisplay tokens={result.diffTokens} showLegend className="text-lg" />
                </div>
              )}

              {/* Audio playback — let student re-listen to their reading */}
              {audioRecorder.audioUrl && (
                <div className="bg-white border border-gray-200 rounded-xl px-3 py-2.5">
                  <p className="text-[10px] text-gray-500 mb-2 uppercase tracking-widest">重聽錄音</p>
                  <audio src={audioRecorder.audioUrl} controls className="w-full h-9" aria-label="播放您的朗讀錄音" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="shrink-0 p-3 bg-white border-t border-gray-200 space-y-2">
          {micError && <div className="text-[10px] text-rose-400 px-1 pb-1">{micError}</div>}

          {result ? (
            <div className="space-y-2">
              <button
                onClick={() => { try { localStorage.removeItem(storageKey); } catch {} setResult(null); setStreamingTranscript(''); audioRecorder.clearRecording(); }}
                aria-label="重新開始全文朗讀"
                className="w-full py-3 rounded-xl text-base font-bold bg-gray-200 hover:bg-gray-300 text-gray-800 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
              >
                再試一次
              </button>
              <button
                onClick={() => { /* Keep completion record — only clear on explicit redo */ onFinish({ matchRate: result.matchRate, feedback: result.feedback, diffTokens: result.diffTokens, transcript: streamingTranscript, cpm: result.cpm, durationMs: result.durationMs, errorBreakdown: result.errorBreakdown }); }}
                aria-label="完成全文朗讀，查看學習報告"
                className="w-full py-3 rounded-xl text-base font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all flex items-center justify-center gap-2 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
              >
                查看報告
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          ) : isPreparing ? (
            <button disabled aria-label="正在準備語音辨識" aria-busy="true" className="w-full py-3 rounded-xl text-base font-bold bg-gray-300 text-gray-500 cursor-wait flex items-center justify-center gap-2">
              <div className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
              準備中...
            </button>
          ) : isSessionActive ? (
            <button
              onClick={submitReading}
              disabled={!streamingTranscript}
              aria-label={!streamingTranscript ? '請先開始朗讀' : '完成朗讀並送出'}
              className={`w-full py-3 rounded-xl text-base font-bold transition-all flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
                streamingTranscript
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95'
                  : 'bg-gray-300 text-gray-400 cursor-not-allowed'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
              完成朗讀
            </button>
          ) : isTtsSpeaking ? (
            <div className="flex gap-2">
              {/* 暫停 / 繼續 */}
              <button
                onClick={isTtsPaused ? resumeTts : pauseTts}
                aria-label={isTtsPaused ? '繼續系統朗讀' : '暫停系統朗讀'}
                className={`flex-1 py-3 rounded-xl text-base font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
                  isTtsPaused
                    ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                    : 'bg-amber-700 hover:bg-amber-600 text-white'
                }`}
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  {isTtsPaused
                    ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 9v6m4-6v6" />
                  }
                </svg>
                {isTtsPaused ? '繼續' : '暫停'}
              </button>
              {/* 停止 */}
              <button
                onClick={stopTts}
                aria-label="停止系統朗讀"
                className="flex-1 py-3 rounded-xl text-base font-bold bg-gray-200 hover:bg-gray-300 text-gray-800 transition-all flex items-center justify-center gap-1.5 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 10h6v4H9z" />
                </svg>
                停止
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={speakFullStory}
                disabled={isTtsLoading}
                aria-label={isTtsLoading ? '載入中' : '播放全文系統示範朗讀'}
                aria-busy={isTtsLoading}
                className={`flex-1 py-3 rounded-xl text-base font-bold transition-all flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
                  isTtsLoading
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-200 hover:bg-gray-300 text-gray-800 active:scale-95'
                }`}
              >
                {isTtsLoading ? (
                  <div className="w-3.5 h-3.5 flex-shrink-0 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                ) : (
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" />
                  </svg>
                )}
                {isTtsLoading ? '載入中...' : '系統朗讀'}
              </button>
              <button
                onClick={startSession}
                aria-label="開始全文朗讀，啟動語音辨識"
                className="flex-1 py-3 rounded-xl text-base font-bold bg-accent hover:bg-accent-hover text-white transition-all flex items-center justify-center gap-1.5 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
              >
                <div className="w-2.5 h-2.5 bg-white rounded-full" aria-hidden="true" />
                開始朗讀
              </button>
            </div>
          )}

          <button
            onClick={onBack}
            aria-label="返回生字練習"
            className="w-full py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
          >
            ← 返回生字練習
          </button>
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

export default FullReading;
