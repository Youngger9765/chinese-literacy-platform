import React, { useState, useEffect } from 'react';
import { DiffToken } from '../../../types';
import { formatTime } from '../../../utils/formatTime';

interface LiveTutorControlsProps {
  // Session state
  isSessionActive: boolean;
  isPreparing: boolean;
  isTtsLoading: boolean;
  isTtsSpeaking: boolean;
  isTtsPaused: boolean;
  isAdvancing: boolean;
  isAwaitingGemini: boolean;
  /** P1 Round 4: true while submitSentence async flow is in progress (double-submit guard). */
  isSubmittingSentence?: boolean;
  // Content state
  streamingUserInput: string;
  lastDiffTokens: DiffToken[] | null;
  retryCount: number;
  ttsError: string | null;
  completedCount: number;
  totalLines: number;
  hasParagraphSummary: boolean;
  showFeedback: boolean;
  // Callbacks
  onStartSession: () => void;
  onSubmitSentence: () => void;
  onSpeakCurrentParagraph: () => void;
  onPauseResumeTts: () => void;
  onStopTts: () => void;
  onFinish: () => void;
  onToggleFeedback: () => void;
}

/**
 * LiveTutorControls — fixed bottom CTA bar for LiveTutor.
 * Renders the correct button state based on session phase.
 *
 * Recording state (isSessionActive): pulsing red mic + elapsed timer + green 完成 button.
 * Button is always green (gradient); opacity-50 when no speech yet, full when speech detected.
 */
const LiveTutorControls: React.FC<LiveTutorControlsProps> = ({
  isSessionActive,
  isPreparing,
  isTtsLoading,
  isTtsSpeaking,
  isTtsPaused,
  isAdvancing,
  isAwaitingGemini,
  isSubmittingSentence = false,
  streamingUserInput,
  lastDiffTokens,
  retryCount,
  ttsError,
  completedCount,
  totalLines,
  hasParagraphSummary,
  showFeedback,
  onStartSession,
  onSubmitSentence,
  onSpeakCurrentParagraph,
  onPauseResumeTts,
  onStopTts,
  onFinish,
  onToggleFeedback,
}) => {
  const isAllDone = completedCount === totalLines;

  /* ── Recording timer: counts up while isSessionActive ── */
  const [recordingSecs, setRecordingSecs] = useState(0);
  useEffect(() => {
    if (!isSessionActive) { setRecordingSecs(0); return; }
    const id = setInterval(() => setRecordingSecs(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [isSessionActive]);

  // canSubmit: has speech OR has a previous diff (retry scenario). isAwaitingGemini blocks double-submit.
  const canSubmit = !isSubmittingSentence && !isAwaitingGemini && (!!streamingUserInput || !!lastDiffTokens);

  return (
    <div
      className="fixed bottom-16 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
      style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}
    >
      <div className="max-w-md mx-auto pointer-events-auto flex flex-col items-center gap-3">

        {/* All paragraphs done — final report */}
        {isAllDone ? (
          <button
            onClick={onFinish}
            className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
            style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
          >
            <span>觀看總結報告</span>
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>

        ) : isSessionActive ? (
          /* ── Recording state: pulsing mic + timer + green 完成 button ── */
          <div className="w-full flex flex-col items-center gap-2">
            {/* Pulsing mic indicator + timer */}
            <div className="flex items-center gap-3">
              <span className="relative flex h-6 w-6 items-center justify-center flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-300 opacity-60" />
                <span className="relative material-symbols-outlined text-xl text-red-500" style={{ fontVariationSettings: "'FILL' 1" }}>mic</span>
              </span>
              <span className="font-mono tabular-nums text-lg font-bold text-red-600">{formatTime(recordingSecs)}</span>
            </div>
            {/* Submit button — always green; opacity-50 until speech detected */}
            <button
              onClick={onSubmitSentence}
              disabled={isSubmittingSentence || isAwaitingGemini}
              className={`w-full h-14 rounded-full font-headline font-bold text-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98] text-white
                ${canSubmit ? 'shadow-[0_12px_48px_rgba(0,105,71,0.3)]' : 'opacity-50 cursor-not-allowed'}`}
              style={{ background: 'linear-gradient(135deg, #006947, #34d399)' }}
            >
              <span className="material-symbols-outlined text-xl">check_circle</span>
              {isSubmittingSentence ? '評分中…' : '完成'}
            </button>
            <p className="text-xs text-on-surface-variant">隨時可以停止，按「完成」即送出評分</p>
          </div>

        ) : isPreparing ? (
          <button
            disabled
            className="w-full h-14 rounded-full font-headline font-bold text-lg bg-surface-container-high text-on-surface-variant cursor-wait flex items-center justify-center gap-2"
          >
            <div className="w-4 h-4 border-2 border-on-surface-variant border-t-transparent rounded-full animate-spin" />
            準備中...
          </button>

        ) : isTtsLoading ? (
          /* TTS loading */
          <div className="w-full flex gap-3">
            <button
              disabled
              title="載入中..."
              className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-high text-on-surface-variant cursor-wait flex items-center justify-center gap-2"
            >
              <div className="w-4 h-4 border-2 border-on-surface-variant border-t-transparent rounded-full animate-spin" />
              載入中...
            </button>
            <button
              onClick={onStartSession}
              className="flex-1 h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-3 animate-pulse"
              style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
            >
              <span
                className="material-symbols-outlined text-2xl"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                mic
              </span>
              {retryCount > 0 ? '再試一次' : '開始朗讀'}
            </button>
          </div>

        ) : isTtsSpeaking ? (
          /* TTS playing */
          <div className="w-full flex gap-3">
            <button
              onClick={onPauseResumeTts}
              className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-accent/10 text-accent hover:bg-accent/15 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <span
                className="material-symbols-outlined text-xl"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {isTtsPaused ? 'play_arrow' : 'pause'}
              </span>
              {isTtsPaused ? '繼續' : '暫停'}
            </button>
            <button
              onClick={onStopTts}
              className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <span
                className="material-symbols-outlined text-xl"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                stop
              </span>
              停止
            </button>
          </div>

        ) : hasParagraphSummary && !isAdvancing ? (
          /* After evaluation — feedback toggle */
          <button
            type="button"
            onClick={onToggleFeedback}
            className="px-4 py-2 rounded-full bg-surface-container-lowest shadow-sm text-sm font-medium text-on-surface-variant hover:bg-surface-container-low transition-all"
          >
            {showFeedback ? '隱藏回饋' : '查看朗讀回饋'}
          </button>

        ) : !isAdvancing ? (
          /* Idle — AI朗讀 + 開始朗讀 */
          <div className="w-full flex gap-3">
            {ttsError ? (
              <button
                onClick={onSpeakCurrentParagraph}
                title={ttsError}
                className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-tertiary-container/30 text-tertiary border border-tertiary/30 hover:bg-tertiary-container/50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-xl">refresh</span>
                重試朗讀
              </button>
            ) : (
              <button
                onClick={onSpeakCurrentParagraph}
                className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <span
                  className="material-symbols-outlined text-xl"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  volume_up
                </span>
                AI 朗讀
              </button>
            )}
            <button
              onClick={onStartSession}
              className="flex-1 h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-3 animate-pulse"
              style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
            >
              <span
                className="material-symbols-outlined text-2xl"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                mic
              </span>
              {retryCount > 0 ? '再試一次' : '開始朗讀'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default LiveTutorControls;
