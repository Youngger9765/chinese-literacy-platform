/**
 * TtsSpeedPicker — how fast the AI demo voice reads (#3023).
 *
 * Teachers running 課後學習扶助 reported the demo reads too fast. Measured on
 * prod the voice is 273 字/分 while the worksheet's own reading_benchmark
 * puts the top student band at ＞231, so the model is faster than the best
 * band the same worksheet defines.
 *
 * This sits inline with the AI 朗讀 button on purpose: a speed setting buried
 * in a preferences page is a setting a 10-year-old never finds, and the
 * report came from the reading step.
 *
 * The choice is per browser (localStorage), so one student slowing down
 * does not slow the class -- which is what "different students need
 * different speeds" actually asks for.
 */
import React, { useState } from 'react';
import { TTS_RATE_OPTIONS, getTtsPlaybackRate, setTtsPlaybackRate } from '../../utils/ttsRate';

interface Props {
  className?: string;
  /** Fires after a new rate is persisted, e.g. to restart playback. */
  onChange?: (rate: number) => void;
  /**
   * #3397: `sm` 給讀全文-做記號用 —— 那一步的主角是標記，速度列只是附屬，
   * 預設尺寸跟主按鈕一樣大會搶走注意力（mentor 回饋）。
   */
  size?: 'md' | 'sm';
  /**
   * #3397（第二階段）—— owner 追加需求：播放全文／速度再搬進跟 QR 全文同一條
   * 工具列。那條列已經有 ❓不懂／💛重要／復原／清除全部，慢/稍慢/正常三顆攤開
   * 在 390px 寬會把其他按鈕擠到換行甚至溢出。收成一顆按鈕，顯示目前的速度，
   * 點開才展開完整選項；選了自動收回。只有讀全文-做記號的工具列會傳這個，
   * 預設 `false` 保留每一個既有呼叫端的原樣（重點朗讀的 AI 朗讀列、其餘單測）。
   */
  compact?: boolean;
}

const TtsSpeedPicker: React.FC<Props> = ({ className, onChange, size = 'md', compact = false }) => {
  const sm = size === 'sm';
  const [rate, setRate] = useState<number>(() => getTtsPlaybackRate());
  const [open, setOpen] = useState(false);

  const pick = (value: number) => {
    setTtsPlaybackRate(value);
    // Read back rather than trusting the input: setTtsPlaybackRate drops an
    // out-of-range value, and the button must not claim a rate that is not
    // in effect.
    const applied = getTtsPlaybackRate();
    setRate(applied);
    onChange?.(applied);
    // Picking a rate is the natural "I'm done" signal — collapse back so the
    // toolbar doesn't stay wide after the student made their choice.
    if (compact) setOpen(false);
  };

  if (compact && !open) {
    const current =
      TTS_RATE_OPTIONS.find((opt) => opt.value === rate) ?? TTS_RATE_OPTIONS[TTS_RATE_OPTIONS.length - 1];
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        // 這是 disclosure（展開同一列的兄弟按鈕），不是 popup（獨立浮層、有
        // 自己的鍵盤模型）。code review 抓到：`aria-haspopup` 會讓螢幕報讀器
        // 錯誤預告使用者「會跳出選單」，只留 `aria-expanded` 才對應實際行為。
        aria-expanded={false}
        aria-label="朗讀速度"
        className={`flex shrink-0 items-center gap-1 h-8 px-2.5 whitespace-nowrap rounded-full border border-outline-variant/40 bg-surface-container-lowest text-sm font-headline text-on-surface-variant transition-all active:scale-[0.98] ${className ?? ''}`}
      >
        <span className="material-symbols-outlined text-sm" aria-hidden="true">
          speed
        </span>
        <span>{current.label}</span>
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="朗讀速度"
      // shrink-0（#3478）：手機上被「開始朗讀」等兄弟元素擠壓時，語速列不能縮，否則字會變直排。
      className={`flex shrink-0 items-center rounded-full bg-surface-container-lowest ${
        sm ? 'gap-0.5 px-1.5 border border-outline-variant/40' : 'gap-1 px-2 shadow-editorial'
      } ${className ?? ''}`}
    >
      <span className={`material-symbols-outlined ${sm ? 'text-sm' : 'text-base'} text-on-surface-variant`} aria-hidden="true">
        speed
      </span>
      {TTS_RATE_OPTIONS.map((opt) => {
        const active = opt.value === rate;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => pick(opt.value)}
            aria-pressed={active}
            // The accessible name carries the group label too: a screen
            // reader user tabbing straight onto "慢" needs to know what is
            // slow. aria-pressed (not colour alone) carries which is active.
            aria-label={`朗讀速度 ${opt.label}`}
            // whitespace-nowrap（#3478）：390px 上「稍慢」「正常」不換行成直排。
            className={`${sm ? 'h-7 min-w-7 px-1.5 text-xs' : 'h-9 min-w-9 px-2 text-sm'} whitespace-nowrap rounded-full font-headline transition-all active:scale-[0.98] ${
              active
                ? 'bg-accent text-white font-bold'
                : 'text-on-surface-variant hover:bg-surface-container-low'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
      {compact && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="收起朗讀速度選單"
          className={`${sm ? 'h-7 w-7' : 'h-9 w-9'} flex items-center justify-center rounded-full text-on-surface-variant transition-all hover:bg-surface-container-low active:scale-[0.98]`}
        >
          <span className="material-symbols-outlined text-sm" aria-hidden="true">
            close
          </span>
        </button>
      )}
    </div>
  );
};

export default TtsSpeedPicker;
