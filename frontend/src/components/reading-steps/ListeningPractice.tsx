/**
 * ListeningPractice — Issue #251 / #764 / #1956
 *
 * Three-phase listening comprehension exercise:
 *   Phase 1: Play story text via Azure TTS (zh-TW), paragraph by paragraph
 *   Phase 2: Student retells what they heard (voice or text input)
 *   Phase 3: Show AI evaluation with score and feedback
 *
 * Refactored (#1956): Orchestrator only.
 *   - TTS state machine → useTTSEngine
 *   - Phase 2 Q/A UI → ListeningQuestionPanel
 *   - Phase 3 results → ListeningScoring
 */

import React, { useState, useCallback } from 'react';
import { Story } from '../../types';
import { evaluateListeningRetelling, ListeningEvaluateResponse } from '../../services/learningApi';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { useAuth } from '../../contexts/AuthContext';
import { useZhuyin } from '../../context/ZhuyinContext';
import { isToolboxMode } from '../../services/learningStorageScope';
import ToolboxCompletionActions from '../tools/ToolboxCompletionActions';
import { useTTSEngine } from './listening/useTTSEngine';
import ListeningQuestionPanel from './listening/ListeningQuestionPanel';
import ListeningScoring from './listening/ListeningScoring';
import NextStepFooter from '../learning/NextStepFooter';
import StepActionBar from '../learning/StepActionBar';

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

const ListeningPractice: React.FC<ListeningPracticeProps> = ({ story, onFinish, onBack }) => {
  const { token } = useAuth();
  const { zhuyinActive, processZhuyin } = useZhuyin();

  const [phase, setPhase] = useState<Phase>('play');
  const [retelling, setRetelling] = useState('');
  const [retellMode, setRetellMode] = useState<'text' | 'voice'>('text');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<ListeningEvaluateResponse | null>(null);

  const paragraphs = story.content;
  const fullText = story.content.join('\n');
  const zh = (text: string) => zhuyinActive ? processZhuyin(text) : text;

  // ── TTS Engine (Phase 1) ───────────────────────────────────────────
  const tts = useTTSEngine(paragraphs, () => setPhase('retell'));

  const {
    status: speechStatus, isSupported: speechSupported,
    errorMessage: speechError, startListening, stopListening, clearTranscript,
  } = useSpeechRecognition('zh-TW', (finalText) => {
    setRetelling((prev) => (prev ? prev + ' ' + finalText : finalText).trim());
  });

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
      const result = await evaluateListeningRetelling(token, {
        storyTitle: story.title,
        originalText: fullText,
        studentRetelling: trimmed,
      });
      setEvalResult(result);
      setPhase('results');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'AI 評估失敗，請稍後再試。');
    } finally {
      setIsEvaluating(false);
    }
  }, [retelling, token, story.title, fullText]);

  // ── Phase 3: Results ───────────────────────────────────────────────
  const handleFinish = useCallback(() => {
    if (!evalResult) return;
    onFinish({
      score: evalResult.score,
      keyPointsCovered: evalResult.key_points_covered,
      keyPointsMissed: evalResult.key_points_missed,
      feedback: evalResult.feedback,
    });
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
                      {tts.playRate === 0.7 ? '慢速' : tts.playRate === 0.85 ? '標準' : '快速'}
                    </span>
                    <input
                      type="range" min="0.7" max="1.1" step="0.2" value={tts.playRate}
                      onChange={(e) => { tts.setPlayRate(parseFloat(e.target.value)); if (tts.isPlaying || tts.isPaused) tts.handleStop(); }}
                      disabled={tts.isPlaying}
                      className="w-24 h-2 bg-surface-container-high rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                    />
                  </div>

                  {/* Paragraph progress */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-headline font-bold text-on-surface-variant">
                      第 {tts.paragraphIdx + 1} / {paragraphs.length} 段
                    </span>
                    {tts.isPlaying && tts.ttsProgress && (
                      <div className="w-20 h-2 bg-surface-container-high rounded-full overflow-hidden">
                        <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${tts.ttsProgress.progress * 100}%` }} />
                      </div>
                    )}
                  </div>

                  {/* Status badge */}
                  {tts.isPlaying && (
                    <span className="flex items-center gap-1.5 text-sm font-headline font-bold text-accent animate-pulse">
                      <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>volume_up</span>
                      播放中
                    </span>
                  )}
                  {tts.isPaused && <span className="text-sm font-headline font-bold text-on-surface-variant">已暫停</span>}
                  {tts.isBetweenParagraphs && <span className="text-sm font-headline font-bold text-emerald-600">段落完成</span>}
                  {tts.isAllDone && <span className="text-sm font-headline font-bold text-emerald-600">全部播完</span>}
                </div>

                {/* Progress dots */}
                {paragraphs.length > 1 && (
                  <div className="flex gap-1 mt-3">
                    {paragraphs.map((_, i) => (
                      <div key={i} className={`flex-1 h-2 rounded-full transition-colors ${
                        i < tts.paragraphIdx ? 'bg-accent/50'
                        : i === tts.paragraphIdx ? (tts.isPlaying || tts.isPaused || tts.isBetweenParagraphs ? 'bg-accent' : 'bg-accent/70')
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
                      idx === tts.paragraphIdx && (tts.isPlaying || tts.isBetweenParagraphs || tts.isPaused)
                        ? 'bg-accent/5'
                        : idx < tts.paragraphIdx ? 'opacity-40' : ''
                    }`}>
                      <span className="text-xs font-headline font-bold text-on-surface-variant/40 pt-2 select-none shrink-0 w-6 text-right">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <p className={`text-xl md:text-2xl text-on-surface leading-[2rem] md:leading-[2.2rem] ${zhuyinActive ? 'tracking-[0.15em]' : ''}`}>
                        {zh(line)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {tts.ttsError && (
                <div className="mt-4 px-5 py-3 bg-tertiary-container/20 rounded-2xl">
                  <span className="text-sm text-tertiary">{tts.ttsError}</span>
                </div>
              )}
            </>
          )}

          {/* ── Phase 2: Retell ───────────────────────────────────── */}
          {phase === 'retell' && (
            <ListeningQuestionPanel
              retelling={retelling}
              setRetelling={setRetelling}
              retellMode={retellMode}
              setRetellMode={setRetellMode}
              speechStatus={speechStatus}
              speechSupported={speechSupported}
              speechError={speechError}
              submitError={submitError}
              isEvaluating={isEvaluating}
              onVoiceToggle={handleVoiceToggle}
              onSubmit={handleSubmitRetelling}
              onStopListening={stopListening}
            />
          )}

          {/* ── Phase 3: Results ──────────────────────────────────── */}
          {phase === 'results' && evalResult && (
            <ListeningScoring evalResult={evalResult} />
          )}
        </div>
      </div>

      {/* ── Fixed bottom CTA ──────────────────────────────────────── */}
      <StepActionBar layout="stack-center">
          {phase === 'play' && (
            <>
              {tts.isIdle && (
                <div className="w-full flex gap-3">
                  <button onClick={tts.handleProceedToRetell}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-xl">skip_next</span>
                    跳過
                  </button>
                  <button onClick={tts.handlePlay}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-3 animate-pulse"
                    style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}>
                    <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
                    播放課文
                  </button>
                </div>
              )}
              {tts.isPlaying && (
                <div className="w-full flex gap-3">
                  <button onClick={tts.handlePause}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-accent/10 text-accent hover:bg-accent/15 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>pause</span>
                    暫停
                  </button>
                  <button onClick={tts.handleStop}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>stop</span>
                    停止
                  </button>
                </div>
              )}
              {tts.isPaused && (
                <div className="w-full flex gap-3">
                  <button onClick={tts.handleResume}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-lg text-white active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}>
                    <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
                    繼續
                  </button>
                  <button onClick={tts.handleStop}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>stop</span>
                    停止
                  </button>
                </div>
              )}
              {tts.isBetweenParagraphs && (
                <button onClick={tts.handleContinueNext}
                  className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}>
                  <span className="material-symbols-outlined text-xl">play_arrow</span>
                  繼續下一段
                </button>
              )}
              {tts.isAllDone && (
                <>
                  <button onClick={tts.handleReplay}
                    className="w-full h-12 rounded-full font-headline font-bold text-base text-on-surface bg-surface-container-lowest shadow-editorial hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-lg">refresh</span>
                    重聽
                  </button>
                  <button onClick={tts.handleProceedToRetell}
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
            isToolboxMode() ? (
              <ToolboxCompletionActions
                onRetry={() => {
                  // Toolbox retry: reset eval state + put student back at the play stage.
                  setEvalResult(null);
                  setRetelling('');
                  tts.handleStop();
                  setPhase('play');
                }}
                className="w-full"
              />
            ) : (
              <NextStepFooter onNext={handleFinish} />
            )
          )}
      </StepActionBar>

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
