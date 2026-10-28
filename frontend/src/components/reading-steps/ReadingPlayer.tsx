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
import TtsSpeedPicker from './TtsSpeedPicker';

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
   *
   * `sm`（#3397）：讀全文-做記號的主題是「標記」，mentor 認為放在底部的大顆
   * 播放鍵＋速度列偏離主題。`sm` 是退居次要位置用的尺寸 —— 淡色底、不用主
   * CTA 的漸層，看得出能按，但不會跟「完成標記」搶誰是主角。
   */
  size?: 'sm' | 'md' | 'lg';
  /**
   * #3023: show the demo-voice speed picker while idle. On by default,
   * because this component IS the demo-audio surface for the guest/QR path
   * (GuestReadingPage -> FullTextAnnotate -> here) -- and that path is the
   * 課後學習扶助 audience the too-fast report came from. Pass false only
   * from a caller that already renders its own picker.
   */
  showSpeed?: boolean;
  /**
   * #3397（第二階段）：這顆現在跟 ❓不懂／💛重要／QR 全文 擠在同一條工具列，
   * 慢/稍慢/正常三顆攤開的 TtsSpeedPicker 會把 390px 寬的列擠到換行甚至溢出。
   * 收成一顆按鈕、點了才展開。只有這個工具列會用；預設 false 保留舊行為。
   */
  compactSpeed?: boolean;
}

const BTN_BASE =
  'flex items-center justify-center gap-1.5 rounded-full font-headline font-bold ' +
  'transition-all active:scale-[0.97] disabled:opacity-50 whitespace-nowrap';

const BTN_SIZE: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-11 px-5 text-base',
  // h-14 / text-xl = 「完成標記」那顆的尺寸，兩顆並排才等高
  lg: 'h-14 px-6 text-xl',
};

/**
 * 待機那顆（播放全文）要跟主 CTA **等寬**，owner 2026-08-26:「兩個按鈕的大小要
 * 一樣並且置中」。播放中的暫停/停止是次要動作，維持自身寬度 —— 三顆都撐成
 * `w-44` 會塞不進 `max-w-md` 那條列，反而被迫換行。
 */
const IDLE_WIDTH: Record<'sm' | 'md' | 'lg', string> = { sm: '', md: '', lg: 'w-44' };

/** 主要（播放／繼續）按鈕的配色。`sm` 用淡色底，其餘維持主 CTA 漸層。 */
const PRIMARY_STYLE = {
  sm: { className: 'bg-accent/10 text-accent hover:bg-accent/15', style: undefined },
  gradient: {
    className: 'text-white hover:brightness-110',
    style: { background: 'linear-gradient(135deg, #564ABF, #9D93FF)' },
  },
} as const;

const ReadingPlayer: React.FC<ReadingPlayerProps> = ({
  showSpeed = true,
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
  compactSpeed = false,
}) => {
  const BTN = `${BTN_BASE} ${BTN_SIZE[size]}`;
  const ICON = `material-symbols-outlined ${size === 'sm' ? 'text-base' : 'text-xl'}`;
  const primary = size === 'sm' ? PRIMARY_STYLE.sm : PRIMARY_STYLE.gradient;
  // Paused counts as active: the audio is still loaded and stop must stay
  // reachable, otherwise a paused reading can only be ended by leaving the page.
  const isActive = isPlaying || isPaused;

  return (
    <div
      className={`flex items-center ${size === 'sm' ? 'gap-1.5' : 'gap-2'} ${className}`}
      data-testid="reading-player"
      role="group"
      aria-label="全文朗讀播放控制"
    >
      {!isActive && (
        <button
          type="button"
          onClick={onPlay}
          disabled={isLoading}
          className={`${BTN} ${IDLE_WIDTH[size]} ${primary.className} ${
            size === 'sm' ? '' : 'shadow-[0_6px_24px_rgba(86,74,191,0.28)]'
          }`}
          style={primary.style}
        >
          <span className={ICON} aria-hidden="true">
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
          <span className={ICON} aria-hidden="true">
            pause
          </span>
          <span>暫停</span>
        </button>
      )}

      {isPaused && (
        <button
          type="button"
          onClick={onResume}
          className={`${BTN} ${primary.className}`}
          style={primary.style}
        >
          <span className={ICON} aria-hidden="true">
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
          <span className={ICON} aria-hidden="true">
            stop
          </span>
          <span>停止</span>
        </button>
      )}

      {/* #3023: only while idle -- changing the rate mid-utterance needs the
          audio restarted to take effect, and restarting under the student is
          worse than making them choose before they press play. */}
      {showSpeed && !isActive && (
        <TtsSpeedPicker size={size === 'sm' ? 'sm' : 'md'} compact={compactSpeed} />
      )}
    </div>
  );
};

export default ReadingPlayer;
