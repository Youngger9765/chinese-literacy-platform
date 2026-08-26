/**
 * ReadingPlayer — the play / pause / stop control bar for 讀全文-做記號.
 *
 * Deliberately dumb: it owns no audio. Two very different engines drive it and
 * neither can be swapped for the other:
 *
 *   - a signed-in student gets useFullTextTtsQueue, which walks paragraph by
 *     paragraph so the page can highlight and scroll along with the reading;
 *   - a QR-code visitor has no session, and POST /api/tts/synthesize returns
 *     401 to anonymous callers on purpose (it bills us per call). They get the
 *     pre-generated whole-lesson mp3 through the public /assets proxy instead,
 *     which is one file and therefore has no paragraph boundaries to follow.
 *
 * Keeping the engine out of here is what lets both cases share one control bar
 * and one set of tests.
 */
import React from 'react';

export interface ReadingPlayerProps {
  isPlaying: boolean;
  isPaused: boolean;
  /** Start from the beginning. */
  onPlay: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  /** Shown while idle, e.g. 「播放全文」. */
  idleLabel?: string;
  /** True while the first audio bytes are still on their way. */
  isLoading?: boolean;
  className?: string;
  /**
   * 按鈕尺寸。`lg` 是給底部那條動作列用的（#2941）——
   * 它跟主 CTA「完成標記」並排，同高同字級才不會看起來一大一小。
   */
  size?: 'md' | 'lg';
}

const BTN_BASE =
  'flex items-center justify-center gap-1.5 rounded-full font-headline font-bold ' +
  'transition-all active:scale-[0.97] disabled:opacity-50 whitespace-nowrap';

const BTN_SIZE: Record<'md' | 'lg', string> = {
  md: 'h-11 px-5 text-base',
  // h-14 / text-xl = 「完成標記」那顆的尺寸，兩顆並排才等高
  lg: 'h-14 px-6 text-xl',
};

/**
 * 待機那顆（播放全文）要跟主 CTA **等寬**，owner 2026-08-26:「兩個按鈕的大小要
 * 一樣並且置中」。播放中的暫停/停止是次要動作，維持自身寬度 —— 三顆都撐成
 * `w-44` 會塞不進 `max-w-md` 那條列，反而被迫換行。
 */
const IDLE_WIDTH: Record<'md' | 'lg', string> = { md: '', lg: 'w-44' };

const ReadingPlayer: React.FC<ReadingPlayerProps> = ({
  isPlaying,
  isPaused,
  onPlay,
  onPause,
  onResume,
  onStop,
  idleLabel = '播放全文',
  isLoading = false,
  className = '',
  size = 'md',
}) => {
  const BTN = `${BTN_BASE} ${BTN_SIZE[size]}`;
  // Paused counts as active: the audio is still loaded and stop must stay
  // reachable, otherwise a paused reading can only be ended by leaving the page.
  const isActive = isPlaying || isPaused;

  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      data-testid="reading-player"
      role="group"
      aria-label="全文朗讀播放控制"
    >
      {!isActive && (
        <button
          type="button"
          onClick={onPlay}
          disabled={isLoading}
          className={`${BTN} ${IDLE_WIDTH[size]} text-white shadow-[0_6px_24px_rgba(86,74,191,0.28)] hover:brightness-110`}
          style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
        >
          <span className="material-symbols-outlined text-xl" aria-hidden="true">
            {isLoading ? 'hourglass_top' : 'play_arrow'}
          </span>
          <span>{isLoading ? '準備中…' : idleLabel}</span>
        </button>
      )}

      {isPlaying && (
        <button
          type="button"
          onClick={onPause}
          className={`${BTN} bg-surface-container-high text-on-surface hover:brightness-95`}
        >
          <span className="material-symbols-outlined text-xl" aria-hidden="true">
            pause
          </span>
          <span>暫停</span>
        </button>
      )}

      {isPaused && (
        <button
          type="button"
          onClick={onResume}
          className={`${BTN} text-white hover:brightness-110`}
          style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
        >
          <span className="material-symbols-outlined text-xl" aria-hidden="true">
            play_arrow
          </span>
          <span>繼續</span>
        </button>
      )}

      {isActive && (
        <button
          type="button"
          onClick={onStop}
          className={`${BTN} bg-surface-container-high text-on-surface-variant hover:brightness-95`}
        >
          <span className="material-symbols-outlined text-xl" aria-hidden="true">
            stop
          </span>
          <span>停止</span>
        </button>
      )}
    </div>
  );
};

export default ReadingPlayer;
