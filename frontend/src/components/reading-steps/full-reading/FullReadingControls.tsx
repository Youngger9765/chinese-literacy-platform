/**
 * FullReadingControls — Fixed bottom CTA buttons for FullReading (Issue #1960).
 *
 * Extracted from FullReading.tsx to own the state-machine button rendering:
 *   idle       → AI 朗讀 + 開始朗讀
 *   preparing  → 準備中... (disabled)
 *   recording  → 完成朗讀 (enabled when transcript ready)
 *   ttsPlaying → 暫停/繼續 + 停止
 *   result     → 再讀一次 + 下一關  (or ToolboxCompletionActions)
 */

import React from 'react';
import ToolboxCompletionActions from '../../tools/ToolboxCompletionActions';

export type ControlState = 'idle' | 'preparing' | 'recording' | 'ttsPlaying' | 'result';

export interface FullReadingControlsProps {
  state: ControlState;
  /** Called when user clicks AI 朗讀 */
  onSpeak: () => void;
  /** Called when user clicks 開始朗讀 */
  onStartSession: () => void;
  /** Called when user clicks 完成朗讀 */
  onSubmit: () => void;
  /** Called when user clicks 停止 (TTS) */
  onStopTts: () => void;
  /** Called when user clicks 暫停 (TTS playing, not paused) */
  onPauseTts: () => void;
  /** Called when user clicks 繼續 (TTS paused) */
  onResumeTts: () => void;
  /** Called when user clicks 再讀一次 */
  onRetry: () => void;
  /** Called when user clicks 下一關 */
  onFinish: () => void;
  /** Whether TTS is currently paused (toggle text 暫停 ↔ 繼續) */
  isTtsPaused: boolean;
  /** Whether any STT transcript exists (enables 完成朗讀 button) */
  sessionTranscriptReady: boolean;
  /** When true, shows ToolboxCompletionActions instead of 再讀一次 / 下一關 */
  inToolbox: boolean;
}

const FullReadingControls: React.FC<FullReadingControlsProps> = ({
  state,
  onSpeak,
  onStartSession,
  onSubmit,
  onStopTts,
  onPauseTts,
  onResumeTts,
  onRetry,
  onFinish,
  isTtsPaused,
  sessionTranscriptReady,
  inToolbox,
}) => {
  return (
    <div
      className="fixed bottom-0 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
      style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}
    >
      <div className="max-w-md mx-auto pointer-events-auto flex flex-col items-center gap-3">
        {state === 'result' ? (
          inToolbox ? (
            <ToolboxCompletionActions onRetry={onRetry} className="w-full" />
          ) : (
            <>
              <button
                onClick={onRetry}
                className="w-full h-12 rounded-full font-headline font-bold text-base text-on-surface bg-surface-container-lowest shadow-editorial hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">refresh</span>
                再讀一次
              </button>
              <button
                onClick={onFinish}
                className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
              >
                <span>下一關</span>
                <span className="material-symbols-outlined text-xl">arrow_forward</span>
              </button>
            </>
          )
        ) : state === 'preparing' ? (
          <button
            disabled
            className="w-full h-14 rounded-full font-headline font-bold text-lg bg-surface-container-high text-on-surface-variant cursor-wait flex items-center justify-center gap-2"
          >
            <div className="w-4 h-4 border-2 border-on-surface-variant border-t-transparent rounded-full animate-spin" />
            準備中...
          </button>
        ) : state === 'recording' ? (
          <button
            onClick={onSubmit}
            disabled={!sessionTranscriptReady}
            className={`w-full h-14 rounded-full font-headline font-bold text-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${
              sessionTranscriptReady
                ? 'text-white shadow-[0_12px_48px_rgba(0,105,71,0.3)]'
                : 'bg-surface-container-high text-on-surface-variant cursor-not-allowed'
            }`}
            style={sessionTranscriptReady ? { background: 'linear-gradient(135deg, #006947, #34d399)' } : undefined}
          >
            <span className="material-symbols-outlined text-xl">check</span>
            完成朗讀
          </button>
        ) : state === 'ttsPlaying' ? (
          <div className="w-full flex gap-3">
            <button
              onClick={isTtsPaused ? onResumeTts : onPauseTts}
              className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-accent/10 text-accent hover:bg-accent/15 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                {isTtsPaused ? 'play_arrow' : 'pause'}
              </span>
              {isTtsPaused ? '繼續' : '暫停'}
            </button>
            <button
              onClick={onStopTts}
              className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>stop</span>
              停止
            </button>
          </div>
        ) : (
          /* idle */
          <div className="w-full flex gap-3">
            <button
              onClick={onSpeak}
              className="flex-1 h-14 rounded-full font-headline font-bold text-lg bg-surface-container-lowest shadow-editorial text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>volume_up</span>
              AI 朗讀
            </button>
            <button
              onClick={onStartSession}
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
  );
};

export default FullReadingControls;
