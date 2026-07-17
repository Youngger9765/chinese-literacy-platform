import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DiffToken } from '../../../types';
import { formatTime } from '../../../utils/formatTime';
import { EvalProgress } from '../EvalProgress';

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
  /**
   * Painpoint 2: current mic error string (from LiveTutor.micError state).
   * When set and no session is active, show prominent card + allow-mic button.
   */
  micError?: string;
  /**
   * Painpoint 3: object URL of the just-recorded audio blob.
   * Passed from LiveTutor via paragraphRecorder.audioUrl during recordingPendingReview.
   */
  recordingAudioUrl?: string | null;
  // Content state
  lastDiffTokens: DiffToken[] | null;
  retryCount: number;
  ttsError: string | null;
  completedCount: number;
  totalLines: number;
  // Callbacks
  onStartSession: () => void;
  /** Pause recording and show 評估 / 重錄 choice. */
  onFinishRecording: () => void;
  /** Submit pending recording for scoring. */
  onConfirmEvaluate: () => void;
  /** Discard pending recording and record again. */
  onConfirmRerecord: () => void;
  /** Discard pending recording and return to idle (restore prior eval if any). */
  onConfirmCancel: () => void;
  onSpeakCurrentParagraph: () => void;
  onPauseResumeTts: () => void;
  onStopTts: () => void;
  onFinish: () => void;
  /** Issue #2532: 完成所有段落後「再讀一次」重錄整課（比照全文朗讀）。 */
  onReadAgain?: () => void;
  /** Painpoint 2: trigger getUserMedia to prompt browser permission dialog. */
  onRequestMicPermission?: () => void;
}

/**
 * LiveTutorControls — fixed bottom CTA bar for LiveTutor.
 * Renders the correct button state based on session phase.
 *
 * Recording state (isSessionActive): pulsing red mic + elapsed timer + green 完成 button.
 * After 完成: 評估 / 重錄 / 取消 / ▶播放 — only 評估 triggers API scoring.
 *
 * Painpoints fixed (2266):
 *   P1 — isAwaitingGemini shows "評估中…（約 15 秒）" full-width banner.
 *   P2 — micError shows a prominent card with a 允許麥克風 button.
 *   P3 — recordingPendingReview row adds ▶ 播放 button to review recording.
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
  micError,
  recordingAudioUrl,
  lastDiffTokens,
  retryCount,
  ttsError,
  completedCount,
  totalLines,
  onStartSession,
  onFinishRecording,
  onConfirmEvaluate,
  onConfirmRerecord,
  onConfirmCancel,
  onSpeakCurrentParagraph,
  onPauseResumeTts,
  onStopTts,
  onFinish,
  onReadAgain,
  onRequestMicPermission,
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

  /* ── Painpoint 3: playback state for the recorded audio ── */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlayingBack, setIsPlayingBack] = useState(false);

  /** Stop playback synchronously — used both by the toggle button and before
   *  delegating 取消/重錄 so that clearRecording() doesn't revoke a live URL.
   *  NOTE: declared BEFORE the reset useEffect below — that effect lists
   *  stopPlaybackSync in its deps, so a TDZ ReferenceError crashes the whole
   *  逐段朗讀 step if this const is declared after it (Issue #2279 regression). */
  const stopPlaybackSync = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlayingBack(false);
  }, []);

  // Reset playback state when pending review ends
  useEffect(() => {
    if (!recordingPendingReview) {
      stopPlaybackSync();
    }
  }, [recordingPendingReview, stopPlaybackSync]);

  const handlePlayback = useCallback(() => {
    if (!recordingAudioUrl) return;
    if (isPlayingBack) {
      stopPlaybackSync();
      return;
    }
    const audio = new Audio(recordingAudioUrl);
    audioRef.current = audio;
    audio.onended = () => {
      setIsPlayingBack(false);
      audioRef.current = null;
    };
    audio.onerror = () => {
      setIsPlayingBack(false);
      audioRef.current = null;
    };
    audio.play().catch(() => {
      setIsPlayingBack(false);
      audioRef.current = null;
    });
    setIsPlayingBack(true);
  }, [recordingAudioUrl, isPlayingBack, stopPlaybackSync]);

  /* 評估進度改用共用 <EvalProgress>（duration 動態 + 緩動漸近 + snap，#2396）—
     舊版假掃描步驟（EVAL_STEPS 固定 minMs）已移除。 */

  return (
    <div
      className="fixed bottom-16 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
      style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}
    >
      <div className="max-w-md mx-auto pointer-events-auto flex flex-col items-center gap-3">

        {/* ── Painpoint 2: mic error prominent card — shown above other buttons ── */}
        {micError && !isSessionActive && !isSubmittingSentence && !recordingPendingReview && (
          <div className="w-full p-4 rounded-2xl bg-amber-50 border border-amber-300 shadow-md flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-amber-600 shrink-0 mt-0.5">mic_off</span>
              <div className="flex-1">
                <p className="text-sm font-bold text-amber-800">麥克風需要授權</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  請點擊下方按鈕，在瀏覽器彈出視窗中選擇「允許」以開啟麥克風。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onRequestMicPermission ?? onStartSession}
              className="w-full h-11 rounded-full font-headline font-bold text-base bg-amber-600 text-white hover:bg-amber-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>mic</span>
              允許麥克風
            </button>
          </div>
        )}

        {/* All paragraphs done — 再讀一次 + 觀看總結報告（Issue #2532）*/}
        {isAllDone ? (
          <div className="w-full flex gap-3">
            {onReadAgain && (
              <button
                type="button"
                onClick={onReadAgain}
                className="h-14 px-6 rounded-full font-headline font-bold text-base bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest active:scale-[0.98] transition-all flex items-center justify-center gap-2 shrink-0"
              >
                <span className="material-symbols-outlined text-lg">refresh</span>
                再讀一次
              </button>
            )}
            <button
              onClick={onFinish}
              className="flex-1 h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
              style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
            >
              <span>觀看總結報告</span>
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </div>

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
                  錄音已暫停。滿意請按評估；想再錄按重錄；不要這次錄音請按取消。
                </p>
                {/* Painpoint 3: playback row above action buttons */}
                {recordingAudioUrl && (
                  <button
                    type="button"
                    onClick={handlePlayback}
                    className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-bold bg-surface-container-high text-on-surface hover:bg-surface-container-highest active:scale-[0.98] transition-all"
                  >
                    <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>
                      {isPlayingBack ? 'stop_circle' : 'play_circle'}
                    </span>
                    {isPlayingBack ? '停止播放' : '▶ 播放錄音'}
                  </button>
                )}
                <div className="w-full flex gap-2">
                  <button
                    type="button"
                    onClick={() => { stopPlaybackSync(); onConfirmCancel(); }}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-base bg-surface-container-lowest shadow-editorial text-on-surface-variant hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-lg">close</span>
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => { stopPlaybackSync(); onConfirmRerecord(); }}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-base bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-lg">replay</span>
                    重錄
                  </button>
                  <button
                    type="button"
                    onClick={onConfirmEvaluate}
                    className="flex-1 h-14 rounded-full font-headline font-bold text-lg text-white shadow-[0_12px_48px_rgba(0,105,71,0.3)] active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
                    style={{ background: 'linear-gradient(135deg, #006947, #34d399)' }}
                  >
                    <span className="material-symbols-outlined text-lg">check_circle</span>
                    評估
                  </button>
                </div>
              </>
            ) : isSubmittingSentence ? (
              /* 評估進度：共用 EvalProgress（duration 動態 + 緩動漸近 + snap，#2396） */
              <EvalProgress active={isSubmittingSentence} recordingMs={recordingSecs * 1000} />
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
