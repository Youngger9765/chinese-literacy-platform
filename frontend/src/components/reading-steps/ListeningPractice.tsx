/**
 * ListeningPractice — Issue #251 / #764
 *
 * Three-phase listening comprehension exercise:
 *   Phase 1: Play story text via Azure TTS (zh-TW), paragraph by paragraph
 *   Phase 2: Student retells what they heard (voice or text input)
 *   Phase 3: Show AI evaluation with score and feedback
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Story } from '../../types';
import { evaluateListeningRetelling, ListeningEvaluateResponse } from '../../services/learningApi';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useAuth } from '../../contexts/AuthContext';
import { useZhuyin } from '../../context/ZhuyinContext';
import { speakTextWithProgress, cancelTts, TtsProgressInfo } from '../../services/ttsApi';
import { encourageAccuracy } from '../../utils/encouragement';

export interface ListeningResult {
  score: number;
  keyPointsCovered: string[];
  keyPointsMissed: string[];
  feedback: string;
}

interface ListeningPracticeProps {
  story: Story;
  onFinish: (result: ListeningResult) => void;
  onBack: () => void;
}

type Phase = 'play' | 'retell' | 'results';
type PlayState = 'idle' | 'playing' | 'paused' | 'done';
type ParagraphPlayState = 'idle' | 'playing' | 'between' | 'done';

function createSpeaker(text: string, _rate: number) {
  const start = (
    onEnd: () => void,
    onError: (e: string) => void,
    onProgress: (info: TtsProgressInfo) => void,
  ) => {
    speakTextWithProgress(text, onProgress)
      .then(onEnd)
      .catch((err: Error) => onError(err?.message ?? 'speech error'));
  };
  return { start, cancel: () => cancelTts() };
}

function scoreColour(score: number): string {
  if (score >= 80) return 'text-emerald-700';
  if (score >= 60) return 'text-amber-700';
  return 'text-tertiary';
}

const ListeningPractice: React.FC<ListeningPracticeProps> = ({ story, onFinish, onBack }) => {
  const { token } = useAuth();
  const { zhuyinActive, processZhuyin } = useZhuyin();

  const [phase, setPhase] = useState<Phase>('play');
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [playRate, setPlayRate] = useState(0.85);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [ttsProgress, setTtsProgress] = useState<TtsProgressInfo | null>(null);
  const speakerRef = useRef<ReturnType<typeof createSpeaker> | null>(null);

  const paragraphs = story.content;
  const [paragraphIdx, setParagraphIdx] = useState(0);
  const [paragraphPlayState, setParagraphPlayState] = useState<ParagraphPlayState>('idle');

  const [retelling, setRetelling] = useState('');
  const [retellMode, setRetellMode] = useState<'text' | 'voice'>('text');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<ListeningEvaluateResponse | null>(null);

  const {
    status: speechStatus, isSupported: speechSupported,
    errorMessage: speechError, startListening, stopListening, clearTranscript,
  } = useSpeechRecognition('zh-TW', (finalText) => {
    setRetelling((prev) => (prev ? prev + ' ' + finalText : finalText).trim());
  });

  useEffect(() => { return () => { speakerRef.current?.cancel(); }; }, []);

  const fullText = story.content.join('\n');
  const zh = (text: string) => zhuyinActive ? processZhuyin(text) : text;
  // ── Phase 1: Playback ──────────────────────────────────────────────
  const playParagraph = useCallback((idx: number) => {
    const text = paragraphs[idx];
    if (!text) return;
    setTtsError(null); setTtsProgress(null);
    setPlayState('playing'); setParagraphPlayState('playing');
    const speaker = createSpeaker(text, playRate);
    speakerRef.current = speaker;
    speaker.start(
      () => {
        setPlayState('done'); setTtsProgress(null);
        if (idx >= paragraphs.length - 1) setParagraphPlayState('done');
        else setParagraphPlayState('between');
      },
      (errMsg) => { setTtsError(`播放發生錯誤：${errMsg}`); setPlayState('idle'); setTtsProgress(null); setParagraphPlayState('idle'); },
      (info) => setTtsProgress(info),
    );
  }, [paragraphs, playRate]);

  const handlePlay = useCallback(() => playParagraph(paragraphIdx), [playParagraph, paragraphIdx]);
  const handleContinueNext = useCallback(() => {
    const next = paragraphIdx + 1;
    if (next >= paragraphs.length) { setParagraphPlayState('done'); return; }
    setParagraphIdx(next);
    // Brief delay lets React commit the new paragraphIdx before TTS starts,
    // ensuring highlight state stays in sync with the playing paragraph.
    setTimeout(() => playParagraph(next), 50);
  }, [paragraphIdx, paragraphs.length, playParagraph]);
  const handlePause = useCallback(() => { cancelTts(); setPlayState('paused'); setTtsProgress(null); }, []);
  const handleResume = useCallback(() => playParagraph(paragraphIdx), [playParagraph, paragraphIdx]);
  const handleStop = useCallback(() => { speakerRef.current?.cancel(); setPlayState('idle'); setTtsProgress(null); setParagraphPlayState('idle'); setParagraphIdx(0); }, []);
  const handleReplay = useCallback(() => { speakerRef.current?.cancel(); setParagraphIdx(0); setParagraphPlayState('idle'); setPlayState('idle'); setTtsProgress(null); setTimeout(() => playParagraph(0), 100); }, [playParagraph]);
  const handleProceedToRetell = useCallback(() => { speakerRef.current?.cancel(); setPhase('retell'); }, []);

  const isPlaying = playState === 'playing';
  const isPaused = playState === 'paused';
  const isIdle = playState === 'idle' && paragraphPlayState === 'idle';
  const isAllDone = paragraphPlayState === 'done';
  const isBetweenParagraphs = paragraphPlayState === 'between';

  // ── Phase 2: Retelling ─────────────────────────────────────────────
  const handleVoiceToggle = useCallback(() => {
    if (speechStatus === 'listening') stopListening();
    else { clearTranscript(); setRetellMode('voice'); startListening(); }
  }, [speechStatus, startListening, stopListening, clearTranscript]);

  const handleSubmitRetelling = useCallback(async () => {
    const trimmed = retelling.trim();
    if (!trimmed) { setSubmitError('請先說出或輸入你的覆述內容。'); return; }
    if (!token) { setSubmitError('請先登入再提交。'); return; }
    setSubmitError(null); setIsEvaluating(true);
    try {
      const result = await evaluateListeningRetelling(token, { storyTitle: story.title, originalText: fullText, studentRetelling: trimmed });
      setEvalResult(result); setPhase('results');
    } catch (err) { setSubmitError(err instanceof Error ? err.message : 'AI 評估失敗，請稍後再試。'); }
    finally { setIsEvaluating(false); }
  }, [retelling, token, story.title, fullText]);

  // ── Phase 3: Results ───────────────────────────────────────────────
  const handleFinish = useCallback(() => {
    if (!evalResult) return;
    onFinish({ score: evalResult.score, keyPointsCovered: evalResult.key_points_covered, keyPointsMissed: evalResult.key_points_missed, feedback: evalResult.feedback });
  }, [evalResult, onFinish]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 h-full bg-surface overflow-hidden relative">
      <div className="flex-1 overflow-y-auto pb-48 custom-scrollbar">
        <div className="max-w-4xl mx-auto px-6 md:px-16 pt-4">

          {/* ── Phase 1: Play ─────────────────────────────────────── */}
          {phase === 'play' && (
            <>
              {/* Playback controls bar */}
              <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-5 mb-6 mt-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  {/* Speed control */}
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-on-surface-variant text-xl">speed</span>
                    <span className="text-sm font-headline font-bold text-on-surface-variant">
                      {playRate === 0.7 ? '慢速' : playRate === 0.85 ? '標準' : '快速'}
                    </span>
                    <input
                      type="range" min="0.7" max="1.1" step="0.2" value={playRate}
                      onChange={(e) => { setPlayRate(parseFloat(e.target.value)); if (isPlaying || isPaused) handleStop(); }}
                      disabled={isPlaying}
                      className="w-24 h-2 bg-surface-container-high rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                    />
                  </div>

                  {/* Paragraph progress */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-headline font-bold text-on-surface-variant">
                      第 {paragraphIdx + 1} / {paragraphs.length} 段
                    </span>
                    {isPlaying && ttsProgress && (
                      <div className="w-20 h-2 bg-surface-container-high rounded-full overflow-hidden">
                        <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${ttsProgress.progress * 100}%` }} />
                      </div>
                    )}
                  </div>

                  {/* Status badge */}
                  {isPlaying && (
                    <span className="flex items-center gap-1.5 text-sm font-headline font-bold text-accent animate-pulse">
                      <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>volume_up</span>
                      播放中
                    </span>
                  )}
                  {isPaused && <span className="text-sm font-headline font-bold text-on-surface-variant">已暫停</span>}
                  {isBetweenParagraphs && <span className="text-sm font-headline font-bold text-emerald-600">段落完成</span>}
                  {isAllDone && <span className="text-sm font-headline font-bold text-emerald-600">全部播完</span>}
                </div>

                {/* Progress dots */}
                {paragraphs.length > 1 && (
                  <div className="flex gap-1 mt-3">
                    {paragraphs.map((_, i) => (
                      <div key={i} className={`flex-1 h-2 rounded-full transition-colors ${
                        i < paragraphIdx ? 'bg-accent/50'
                        : i === paragraphIdx ? (isPlaying || isPaused || isBetweenParagraphs ? 'bg-accent' : 'bg-accent/70')
                        : 'bg-surface-container-high'
                      }`} />
                    ))}
                  </div>
                )}
              </div>

              {/* Story text card — paragraph cards */}
              <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 md:p-10">
                <div className="space-y-8">
                  {paragraphs.map((line, idx) => (
                    <div key={idx} className={`flex gap-4 items-start rounded-2xl px-4 py-3 -mx-4 transition-all ${
                      idx === paragraphIdx && (isPlaying || isBetweenParagraphs || isPaused)
                        ? 'bg-accent/5'
                        : idx < paragraphIdx ? 'opacity-40' : ''
                    }`}>
                      <span className="text-xs font-headline font-bold text-on-surface-variant/40 pt-2 select-none shrink-0 w-6 text-right">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <p className={`text-xl md:text-2xl text-on-surface leading-[3rem] md:leading-[3.5rem] ${zhuyinActive ? 'tracking-[0.4em]' : ''}`}>
                        {zh(line)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {ttsError && (
                <div className="mt-4 px-5 py-3 bg-tertiary-container/20 rounded-2xl">
                  <span className="text-sm text-tertiary">{ttsError}</span>
                </div>
              )}
            </>
          )}

          {/* ── Phase 2: Retell ───────────────────────────────────── */}
          {phase === 'retell' && (
            <>
              <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 md:p-8 mt-4 mb-6">
                <div className="flex items-center gap-3 mb-4">
                  <span className="material-symbols-outlined text-accent text-2xl">record_voice_over</span>
                  <h2 className="font-headline font-bold text-on-surface text-lg">用自己的話覆述</h2>
                </div>
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  試著說出你剛才聽到的課文重點。不需要一字不差，用自己的話表達你記得的內容就可以。
                </p>
              </div>

              {/* Input mode toggle */}
              <div className="flex bg-surface-container-high rounded-full p-1.5 mb-6">
                <button
                  onClick={() => { if (speechStatus === 'listening') stopListening(); setRetellMode('text'); }}
                  className={`flex-1 px-5 py-3 rounded-full text-sm font-headline font-bold transition-all ${
                    retellMode === 'text' ? 'bg-surface-container-lowest text-accent shadow-sm' : 'text-on-surface-variant'
                  }`}
                >
                  鍵盤輸入
                </button>
                <button
                  onClick={() => setRetellMode('voice')}
                  disabled={!speechSupported}
                  className={`flex-1 px-5 py-3 rounded-full text-sm font-headline font-bold transition-all ${
                    retellMode === 'voice' ? 'bg-surface-container-lowest text-accent shadow-sm' : 'text-on-surface-variant'
                  } ${!speechSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  語音輸入
                </button>
              </div>

              {retellMode === 'text' && (
                <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
                  <textarea
                    value={retelling}
                    onChange={(e) => setRetelling(e.target.value)}
                    placeholder="在這裡輸入你記得的課文內容..."
                    rows={6}
                    maxLength={2000}
                    className="w-full px-4 py-3 border-2 border-surface-container-high rounded-2xl text-on-surface text-base placeholder-on-surface-variant/40 resize-none focus:outline-none focus:border-accent bg-transparent"
                  />
                  <p className="text-xs text-right text-on-surface-variant mt-2">{retelling.length} / 2000</p>
                </div>
              )}

              {retellMode === 'voice' && (
                <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-8 flex flex-col items-center gap-4">
                  <button
                    onClick={handleVoiceToggle}
                    className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-all ${
                      speechStatus === 'listening'
                        ? 'bg-tertiary hover:brightness-110 animate-pulse'
                        : 'bg-accent hover:brightness-110'
                    }`}
                  >
                    <span className="material-symbols-outlined text-white text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                      {speechStatus === 'listening' ? 'stop' : 'mic'}
                    </span>
                  </button>
                  <p className="text-sm text-on-surface-variant">
                    {speechStatus === 'listening' ? '正在聆聽，點擊停止...' : '點擊麥克風開始說話'}
                  </p>
                  {retelling && (
                    <div className="w-full bg-surface-container-low rounded-2xl p-4 mt-2">
                      <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-2">已記錄</p>
                      <p className="text-base text-on-surface leading-relaxed">{retelling}</p>
                    </div>
                  )}
                  {speechError && <p className="text-sm text-tertiary">{speechError}</p>}
                </div>
              )}

              {submitError && (
                <div className="mt-4 px-5 py-3 bg-tertiary-container/20 rounded-2xl">
                  <span className="text-sm text-tertiary">{submitError}</span>
                </div>
              )}
            </>
          )}

          {/* ── Phase 3: Results ──────────────────────────────────── */}
          {phase === 'results' && evalResult && (
            <>
              {/* Feedback card — Issue #1094: 學生端不顯示分數，只保留鼓勵文字 + AI 回饋 */}
              <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-8 mt-4 flex flex-col items-center gap-4">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center ${
                  evalResult.score >= 80 ? 'bg-emerald-100' : evalResult.score >= 60 ? 'bg-amber-100' : 'bg-tertiary-container/30'
                }`}>
                  <span className="material-symbols-outlined text-4xl" aria-hidden="true">
                    {evalResult.score >= 80 ? 'celebration' : evalResult.score >= 60 ? 'thumb_up' : 'favorite'}
                  </span>
                </div>
                <p className={`text-lg font-headline font-bold ${scoreColour(evalResult.score)}`}>{encourageAccuracy(evalResult.score)}</p>
                <p className="text-sm text-on-surface-variant text-center leading-relaxed">{evalResult.feedback}</p>
              </div>

              {/* Key points */}
              {evalResult.key_points_covered.length > 0 && (
                <div className="bg-emerald-50 rounded-3xl p-6 mt-6">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-emerald-600">check_circle</span>
                    <span className="font-headline font-bold text-emerald-700 text-sm">提到的重點</span>
                  </div>
                  <ul className="space-y-2">
                    {evalResult.key_points_covered.map((p, i) => (
                      <li key={i} className="text-sm text-emerald-800 leading-relaxed">• {p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {evalResult.key_points_missed.length > 0 && (
                <div className="bg-tertiary-container/10 rounded-3xl p-6 mt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-tertiary">info</span>
                    <span className="font-headline font-bold text-tertiary text-sm">遺漏的重點</span>
                  </div>
                  <ul className="space-y-2">
                    {evalResult.key_points_missed.map((p, i) => (
                      <li key={i} className="text-sm text-on-surface leading-relaxed">• {p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Fixed bottom CTA ──────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
           style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
        <div className="max-w-md mx-auto pointer-events-auto flex flex-col items-center gap-3">

          {phase === 'play' && (
            <>
              {isIdle && (
                <div className="w-full flex gap-3">
                  <button onClick={handleProceedToRetell}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-xl">skip_next</span>
                    跳過
                  </button>
                  <button onClick={handlePlay}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-3 animate-pulse"
                    style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}>
                    <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
                    播放課文
                  </button>
                </div>
              )}
              {isPlaying && (
                <div className="w-full flex gap-3">
                  <button onClick={handlePause}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-accent/10 text-accent hover:bg-accent/15 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>pause</span>
                    暫停
                  </button>
                  <button onClick={handleStop}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>stop</span>
                    停止
                  </button>
                </div>
              )}
              {isPaused && (
                <div className="w-full flex gap-3">
                  <button onClick={handleResume}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-lg text-white active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}>
                    <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
                    繼續
                  </button>
                  <button onClick={handleStop}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>stop</span>
                    停止
                  </button>
                </div>
              )}
              {isBetweenParagraphs && (
                <button onClick={handleContinueNext}
                  className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}>
                  <span className="material-symbols-outlined text-xl">play_arrow</span>
                  繼續下一段
                </button>
              )}
              {isAllDone && (
                <>
                  <button onClick={handleReplay}
                    className="w-full h-12 rounded-full font-headline font-bold text-base text-on-surface bg-surface-container-lowest shadow-editorial hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-lg">refresh</span>
                    重聽
                  </button>
                  <button onClick={handleProceedToRetell}
                    className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}>
                    開始覆述
                    <span className="material-symbols-outlined text-xl">arrow_forward</span>
                  </button>
                </>
              )}
            </>
          )}

          {phase === 'retell' && (
            <button onClick={handleSubmitRetelling} disabled={isEvaluating || !retelling.trim()}
              className={`w-full h-14 rounded-full font-headline font-bold text-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${
                isEvaluating || !retelling.trim()
                  ? 'bg-surface-container-high text-on-surface-variant cursor-not-allowed'
                  : 'text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)]'
              }`}
              style={!isEvaluating && retelling.trim() ? { background: 'linear-gradient(135deg, #564ABF, #9D93FF)' } : undefined}>
              {isEvaluating ? (
                <><div className="w-4 h-4 border-2 border-on-surface-variant border-t-transparent rounded-full animate-spin" /> AI 評估中...</>
              ) : (
                <><span className="material-symbols-outlined text-xl">check</span> 送出覆述</>
              )}
            </button>
          )}

          {phase === 'results' && (
            <button onClick={handleFinish}
              className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}>
              繼續下一步
              <span className="material-symbols-outlined text-xl">arrow_forward</span>
            </button>
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

export default ListeningPractice;
