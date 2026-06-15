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
  /** P1 Round 4: true while confirmEvaluate async flow is in progress (double-submit guard). */
  isSubmittingSentence?: boolean;
  /** True after 完成: recording paused, awaiting 評估 or 重錄. */
  recordingPendingReview?: boolean;
  /** AnalyserNode: true once mic volume crossed threshold this session. */
  hasDetectedAudio?: boolean;
  /** 0–1 mic volume for recording indicator bars. */
  volumeLevel?: number;
  // Content state
  lastDiffTokens: DiffToken[] | null;
  retryCount: number;
  ttsError: string | null;
  completedCount: number;
  totalLines: number;
  hasParagraphSummary: boolean;
  showFeedback: boolean;
  // Callbacks
  onStartSession: () => void;
  /** Pause recording and show 評估 / 重錄 choice. */
  onFinishRecording: () => void;
  /** Submit pending recording for scoring. */
  onConfirmEvaluate: () => void;
  /** Discard pending recording and record again. */
  onConfirmRerecord: () => void;
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
 * After 完成: 評估 / 重錄 — only 評估 triggers API scoring.
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
  recordingPendingReview = false,
  hasDetectedAudio = false,
  volumeLevel = 0,
  lastDiffTokens,
  retryCount,
  ttsError,
  completedCount,
  totalLines,
  hasParagraphSummary,
  showFeedback,
  onStartSession,
  onFinishRecording,
  onConfirmEvaluate,
  onConfirmRerecord,
  onSpeakCurrentParagraph,
  onPauseResumeTts,
  onStopTts,
  onFinish,
  onToggleFeedback,
}) => {
  const isAllDone = completedCount === totalLines;

  const isRecordingOrSubmitting =
    isSessionActive || isSubmittingSentence || recordingPendingReview;

  /* ── Recording timer: counts up while recording (hidden once 完成 is tapped) ── */
  const [recordingSecs, setRecordingSecs] = useState(0);
  useEffect(() => {
    if (!isSessionActive || isSubmittingSentence || recordingPendingReview) {
      setRecordingSecs(0);
      return;
    }
    const id = setInterval(() => setRecordingSecs(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [isSessionActive, isSubmittingSentence, recordingPendingReview]);

  // canSubmit: mic picked up audio, or min recording time, or retry with prior diff.
  const canSubmit =
    !isSubmittingSentence &&
    !isAwaitingGemini &&
    (hasDetectedAudio || recordingSecs >= 2 || !!lastDiffTokens);

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

        ) : isRecordingOrSubmitting ? (
          <div className="w-full flex flex-col items-center gap-2">
            {isSessionActive && !isSubmittingSentence && !recordingPendingReview && (
              <div className="flex items-center gap-3">
                <span className="relative flex h-6 w-6 items-center justify-center flex-shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-300 opacity-60" />
                  <span className="relative material-symbols-outlined text-xl text-red-500" style={{ fontVariationSettings: "'FILL' 1" }}>mic</span>
                </span>
                <div
                  className="flex items-end gap-0.5 h-4"
                  aria-label={`音量 ${Math.round(volumeLevel * 100)}%`}
                >
                  {[0.15, 0.35, 0.55, 0.75].map((threshold) => (
                    <div
                      key={threshold}
                      className={`w-1 rounded-sm transition-colors ${
                        volumeLevel >= threshold ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                      style={{ height: `${8 + threshold * 16}px` }}
                    />
                  ))}
                </div>
                <span className="font-mono tabular-nums text-lg font-bold text-red-600">{formatTime(recordingSecs)}</span>
              </div>
            )}
            {recordingPendingReview && !isSubmittingSentence ? (
              <>
                <p className="text-sm text-on-surface-variant text-center">
                  錄音已暫停。滿意再送評估，不滿意可重錄。
                </p>
                <div className="w-full flex gap-3">
                  <button
                    type="button"
                    onClick={onConfirmRerecord}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-xl">replay</span>
                    重錄
                  </button>
                  <button
                    type="button"
                    onClick={onConfirmEvaluate}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(0,105,71,0.3)] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #006947, #34d399)' }}
                  >
                    <span className="material-symbols-outlined text-xl">check_circle</span>
                    評估
                  </button>
                </div>
              </>
            ) : isSubmittingSentence ? (
              <button
                type="button"
                disabled
                className="w-full h-14 rounded-full font-headline font-bold text-xl transition-all flex items-center justify-center gap-2 text-white opacity-80 cursor-wait shadow-[0_12px_48px_rgba(0,105,71,0.3)]"
                style={{ background: 'linear-gradient(135deg, #006947, #34d399)' }}
              >
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                評分中…
              </button>
            ) : (
              <button
                type="button"
                onClick={onFinishRecording}
                disabled={!canSubmit}
                className={`w-full h-14 rounded-full font-headline font-bold text-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98] text-white disabled:opacity-50 disabled:cursor-not-allowed
                  ${canSubmit ? 'shadow-[0_12px_48px_rgba(0,105,71,0.3)]' : ''}`}
                style={{ background: 'linear-gradient(135deg, #006947, #34d399)' }}
              >
                <span className="material-symbols-outlined text-xl">check_circle</span>
                完成
              </button>
            )}
            {isSessionActive && !isSubmittingSentence && !recordingPendingReview && (
              <p className="text-xs text-on-surface-variant">按「完成」暫停錄音，確認後再送評估</p>
            )}
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
