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
}

const TtsSpeedPicker: React.FC<Props> = ({ className, onChange, size = 'md' }) => {
  const sm = size === 'sm';
  const [rate, setRate] = useState<number>(() => getTtsPlaybackRate());

  const pick = (value: number) => {
    setTtsPlaybackRate(value);
    // Read back rather than trusting the input: setTtsPlaybackRate drops an
    // out-of-range value, and the button must not claim a rate that is not
    // in effect.
    const applied = getTtsPlaybackRate();
    setRate(applied);
    onChange?.(applied);
  };

  return (
    <div
      role="group"
      aria-label="朗讀速度"
      className={`flex items-center rounded-full bg-surface-container-lowest ${
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
            className={`${sm ? 'h-7 min-w-7 px-1.5 text-xs' : 'h-9 min-w-9 px-2 text-sm'} rounded-full font-headline transition-all active:scale-[0.98] ${
              active
                ? 'bg-accent text-white font-bold'
                : 'text-on-surface-variant hover:bg-surface-container-low'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

export default TtsSpeedPicker;
