import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Story } from '../../types';
import { correctHomophones } from '../../utils/pinyin';
import { PolyphonicProcessor, buildZhuyinString } from '../zhuyin/polyphonicProcessor';

/* ---- Text helpers (same normalisation as LiveTutor) ---- */

const cleanChineseText = (text: string) => {
  if (!text) return '';
  return text
    .replace(/([\u4e00-\u9fa5！，。？：；（）])\s+([\u4e00-\u9fa5！，。？：；（）])/g, '$1$2')
    .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2')
    .trim();
};

const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const intToChinese = (num: number): string => {
  if (num === 0) return '零';
  let n = num; let result = '';
  if (n >= 100_000_000) { result += intToChinese(Math.floor(n / 100_000_000)) + '億'; n %= 100_000_000; if (n > 0 && n < 10_000_000) result += '零'; }
  if (n >= 10_000) { result += intToChinese(Math.floor(n / 10_000)) + '萬'; n %= 10_000; if (n > 0 && n < 1_000) result += '零'; }
  if (n >= 1_000) { result += CHINESE_DIGITS[Math.floor(n / 1_000)] + '千'; n %= 1_000; if (n > 0 && n < 100) result += '零'; }
  if (n >= 100) { result += CHINESE_DIGITS[Math.floor(n / 100)] + '百'; n %= 100; if (n > 0 && n < 10) result += '零'; }
  if (n >= 10) { const tens = Math.floor(n / 10); if (tens > 1 || result.length > 0) result += CHINESE_DIGITS[tens]; result += '十'; n %= 10; }
  if (n > 0) result += CHINESE_DIGITS[n];
  return result;
};
const normalizeNumbers = (text: string) => text.replace(/\d+/g, m => intToChinese(parseInt(m, 10)));
const normalizeForComparison = (text: string) =>
  normalizeNumbers(cleanChineseText(text)).replace(/[「」『』，。！？：；、\s]/g, '');

const computeMatchRate = (spokenRaw: string, targetRaw: string): number => {
  const spoken = normalizeForComparison(spokenRaw);
  const target = normalizeForComparison(targetRaw);
  if (!target || !spoken) return 0;
  const freq: Record<string, number> = {};
  for (const ch of spoken) freq[ch] = (freq[ch] || 0) + 1;
  let matched = 0;
  for (const ch of target) { if (freq[ch] && freq[ch] > 0) { matched++; freq[ch]--; } }
  return matched / target.length;
};

/* ------------------------------------------------------------------ */

interface FullReadingProps {
  story: Story;
  rightPanelWidth: number;
  onPanelWidthChange: (w: number) => void;
  onFinish: () => void;
  onBack: () => void;
}

const FullReading: React.FC<FullReadingProps> = ({ story, rightPanelWidth, onPanelWidthChange, onFinish, onBack }) => {
  const [isPreparing, setIsPreparing]           = useState(false);
  const [isSessionActive, setIsSessionActive]   = useState(false);
  const [isTtsSpeaking, setIsTtsSpeaking]       = useState(false);
  const [isTtsPaused, setIsTtsPaused]           = useState(false);
  const [streamingTranscript, setStreamingTranscript] = useState('');
  const [micError, setMicError]                 = useState('');
  const [result, setResult]                     = useState<{ matchRate: number; feedback: string } | null>(null);
  const [zhuyinEnabled, setZhuyinEnabled]       = useState(true);
  const [zhuyinReady, setZhuyinReady]           = useState(false);

  const isSessionActiveRef        = useRef(false);
  const recognitionRef            = useRef<any>(null);
  const currentTranscriptRef      = useRef('');
  const accumulatedTranscriptRef  = useRef('');
  const isDraggingRef             = useRef(false);
  const dragStartXRef             = useRef(0);
  const dragStartWidthRef         = useRef(0);

  const zhuyinActive = zhuyinReady && zhuyinEnabled;
  const fullText = useMemo(() => story.content.join(''), [story.content]);

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

  /* ---- Cleanup ---- */
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(s => s.getTracks().forEach(t => t.stop()))
      .catch(() => {});
    return () => {
      isSessionActiveRef.current = false;
      if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch (_) {} }
      window.speechSynthesis?.cancel();
    };
  }, []);

  /* ---- TTS: read full story ---- */
  const speakFullStory = useCallback(() => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setIsTtsPaused(false);

    const doSpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find(v => v.name.includes('Google') && v.name.includes('Taiwan')) ||
        voices.find(v => v.name.includes('Google') && v.lang === 'zh-TW') ||
        voices.find(v => v.lang === 'zh-TW') ||
        voices.find(v => v.lang.startsWith('zh'));

      const utterances = story.content.map(paragraph => {
        const u = new SpeechSynthesisUtterance(paragraph);
        u.lang = 'zh-TW'; u.rate = 1.0;
        if (preferred) u.voice = preferred;
        return u;
      });
      utterances[0].onstart = () => setIsTtsSpeaking(true);
      utterances[utterances.length - 1].onend = () => { setIsTtsSpeaking(false); setIsTtsPaused(false); };
      utterances[utterances.length - 1].onerror = () => { setIsTtsSpeaking(false); setIsTtsPaused(false); };
      utterances.forEach(u => window.speechSynthesis.speak(u));
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.onvoiceschanged = null; doSpeak(); };
    } else {
      doSpeak();
    }
  }, [story.content]);

  const pauseTts = () => { window.speechSynthesis?.pause(); setIsTtsPaused(true); };
  const resumeTts = () => { window.speechSynthesis?.resume(); setIsTtsPaused(false); };
  const stopTts = () => { window.speechSynthesis?.cancel(); setIsTtsSpeaking(false); setIsTtsPaused(false); };

  /* ---- STT ---- */
  const startSession = () => {
    if (isSessionActiveRef.current) return;
    window.speechSynthesis?.cancel();
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
      if (!isSessionActiveRef.current) { isSessionActiveRef.current = true; setIsSessionActive(true); }
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
  };

  const stopSession = useCallback(() => {
    isSessionActiveRef.current = false;
    setIsSessionActive(false); setIsPreparing(false);
    if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch (_) {} recognitionRef.current = null; }
    currentTranscriptRef.current = '';
    accumulatedTranscriptRef.current = '';
    setStreamingTranscript('');
  }, []);

  /* ---- Submit & evaluate ---- */
  const submitReading = useCallback(() => {
    const transcript = currentTranscriptRef.current;
    stopSession();
    if (!transcript.trim()) { setMicError('未偵測到語音，請再試一次。'); return; }

    const targetNorm = normalizeForComparison(fullText);
    const corrected = correctHomophones(cleanChineseText(transcript), targetNorm);
    const matchRate = computeMatchRate(corrected, fullText);

    const feedback =
      matchRate >= 0.75 ? '太流利了！全文朗讀表現非常棒！' :
      matchRate >= 0.55 ? '讀得不錯！繼續練習會更好！' :
      '再練習練習，下次一定更流利！';

    setResult({ matchRate, feedback });
    setStreamingTranscript(cleanChineseText(transcript));
  }, [fullText, stopSession]);

  const percent = result ? Math.round(result.matchRate * 100) : 0;

  return (
    <div
      className="flex flex-1 h-full bg-[#0d1117] overflow-hidden"
      style={{
        fontFamily: zhuyinActive
          ? "'BpmfIansui', 'Iansui', 'Noto Sans TC', sans-serif"
          : "'Iansui', 'Noto Sans TC', sans-serif",
      }}
    >
      {/* LEFT: Full story text */}
      <div className="flex-1 flex flex-col bg-[#0d1117] min-w-0">
        {/* Tab bar */}
        <div className="h-9 bg-[#161b22] border-b border-[#30363d] flex items-center px-2 gap-2 shrink-0">
          <div className="h-full px-4 flex items-center bg-[#0d1117] border-t-2 border-indigo-500 border-x border-[#30363d] text-xs text-slate-200">
            {story.filename}
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setZhuyinEnabled(!zhuyinEnabled)}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${
              zhuyinEnabled && zhuyinReady
                ? 'bg-indigo-600/80 text-white hover:bg-indigo-500'
                : 'bg-[#30363d] text-slate-400 hover:bg-[#3d444d]'
            }`}
          >
            注音 {zhuyinEnabled ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* All paragraphs */}
        <div className="flex-1 p-8 lg:p-16 overflow-y-auto custom-scrollbar">
          <div className="max-w-3xl mx-auto space-y-10">
            {story.content.map((line, idx) => (
              <div
                key={idx}
                className="rounded-2xl p-6 border border-transparent hover:border-[#30363d] hover:bg-[#161b22]/30 transition-all"
              >
                <p className="text-2xl lg:text-3xl leading-[2.6] text-slate-200">
                  {zhuyinLines ? zhuyinLines[idx] : line}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Status bar */}
        <div className="h-7 bg-[#161b22] border-t border-[#30363d] flex items-center px-4 text-[10px] text-slate-500 uppercase shrink-0">
          <span>共 {story.content.length} 段 · {story.title}</span>
          <div className="flex-1" />
          <span className={isSessionActive ? 'text-green-500 font-bold' : isPreparing ? 'text-yellow-500 font-bold' : 'text-slate-700'}>
            {isSessionActive ? '• LISTENING' : isPreparing ? '• PREPARING' : '• IDLE'}
          </span>
        </div>
      </div>

      {/* Resizable divider */}
      <div
        onMouseDown={onDividerMouseDown}
        className="w-1 flex-shrink-0 bg-[#30363d] hover:bg-indigo-500 cursor-col-resize transition-colors"
      />

      {/* RIGHT: Recording panel */}
      <div
        className="flex-shrink-0 bg-[#0d1117] flex flex-col h-full min-h-0"
        style={{ width: rightPanelWidth }}
      >
        {/* Header */}
        <div className="h-9 shrink-0 bg-[#161b22] border-b border-[#30363d] flex items-center px-4">
          <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">全文朗讀</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/10">

          {/* Instructions */}
          {!result && !isSessionActive && !isPreparing && (
            <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                請從頭到尾朗讀整篇課文。讀完後按「完成朗讀」送出。
              </p>
              <p className="text-[10px] text-slate-600 mt-2">
                標準比逐段朗讀寬鬆，放輕鬆自然地讀吧！
              </p>
            </div>
          )}

          {/* Live transcript */}
          {isSessionActive && streamingTranscript && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-bold text-indigo-400 uppercase animate-pulse">LISTENING...</span>
              <div className="bg-indigo-600/20 border border-indigo-500/30 rounded-xl px-3 py-2.5 text-sm text-indigo-200 leading-relaxed">
                {streamingTranscript}
              </div>
            </div>
          )}

          {isSessionActive && !streamingTranscript && (
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-bold text-green-500 uppercase animate-pulse">LISTENING</span>
              <div className="bg-green-900/20 border border-green-700/30 rounded-xl px-3 py-2.5 text-sm text-green-300">
                請朗讀左側課文，從頭到尾…
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-4">
                <div className={`w-24 h-24 rounded-full flex items-center justify-center border-4 ${
                  percent >= 75 ? 'border-emerald-500 text-emerald-300'
                  : percent >= 55 ? 'border-amber-500 text-amber-300'
                  : 'border-red-500/60 text-red-300'
                }`}>
                  <span className="text-2xl font-black">{percent}%</span>
                </div>
                <p className={`text-sm font-bold text-center ${
                  percent >= 75 ? 'text-emerald-300'
                  : percent >= 55 ? 'text-amber-300'
                  : 'text-slate-400'
                }`}>
                  {result.feedback}
                </p>
              </div>

              {streamingTranscript && (
                <div className="bg-[#161b22] border border-[#30363d] rounded-xl px-3 py-2.5">
                  <p className="text-[10px] text-slate-500 mb-1 uppercase tracking-widest">你說的</p>
                  <p className="text-xs text-slate-400 leading-relaxed line-clamp-6">{streamingTranscript}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="shrink-0 p-3 bg-[#161b22] border-t border-[#30363d] space-y-2">
          {micError && <div className="text-[10px] text-rose-400 px-1 pb-1">{micError}</div>}

          {result ? (
            <div className="space-y-2">
              <button
                onClick={() => { setResult(null); setStreamingTranscript(''); }}
                className="w-full py-2.5 rounded-xl text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 transition-all active:scale-95"
              >
                再試一次
              </button>
              <button
                onClick={onFinish}
                className="w-full py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all flex items-center justify-center gap-2 active:scale-95"
              >
                查看報告
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          ) : isPreparing ? (
            <button disabled className="w-full py-2.5 rounded-xl text-xs font-bold bg-slate-800 text-slate-500 cursor-wait flex items-center justify-center gap-2">
              <div className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
              準備中...
            </button>
          ) : isSessionActive ? (
            <button
              onClick={submitReading}
              disabled={!streamingTranscript}
              className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                streamingTranscript
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95'
                  : 'bg-slate-800 text-slate-600 cursor-not-allowed'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
              完成朗讀
            </button>
          ) : isTtsSpeaking ? (
            <div className="flex gap-2">
              {/* 暫停 / 繼續 */}
              <button
                onClick={isTtsPaused ? resumeTts : pauseTts}
                className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 ${
                  isTtsPaused
                    ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                    : 'bg-amber-700 hover:bg-amber-600 text-white'
                }`}
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 transition-all flex items-center justify-center gap-1.5 active:scale-95"
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 10h6v4H9z" />
                </svg>
                停止
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={speakFullStory}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 transition-all flex items-center justify-center gap-1.5 active:scale-95"
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072" />
                </svg>
                系統朗讀
              </button>
              <button
                onClick={startSession}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all flex items-center justify-center gap-1.5 active:scale-95"
              >
                <div className="w-2.5 h-2.5 bg-white rounded-full" />
                開始朗讀
              </button>
            </div>
          )}

          <button
            onClick={onBack}
            className="w-full py-1.5 rounded-lg text-xs text-slate-600 hover:text-slate-400 transition-colors"
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
