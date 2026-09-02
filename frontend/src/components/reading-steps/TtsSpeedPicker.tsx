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
}

const TtsSpeedPicker: React.FC<Props> = ({ className, onChange }) => {
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
      className={`flex items-center gap-1 rounded-full bg-surface-container-lowest shadow-editorial px-2 ${className ?? ''}`}
    >
      <span className="material-symbols-outlined text-base text-on-surface-variant" aria-hidden="true">
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
            className={`h-9 min-w-9 px-2 rounded-full font-headline text-sm transition-all active:scale-[0.98] ${
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
