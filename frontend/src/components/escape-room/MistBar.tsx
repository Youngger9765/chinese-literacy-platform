import React from 'react';
import { motionClass } from '../pk/motionClass';

interface MistBarProps {
  distance: number;
  maxDistance?: number;
  reducedMotion: boolean;
  message?: string | null;
}

const MistBar: React.FC<MistBarProps> = ({ distance, maxDistance = 100, reducedMotion, message }) => {
  const safeMax = Math.max(maxDistance, 1);
  const progress = Math.min(100, Math.max(0, (distance / safeMax) * 100));

  return (
    <section className="rounded-2xl border border-slate-300 bg-slate-100/90 p-3 shadow-sm" aria-label="迷霧距離">
      <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-700">
        <span>迷霧距離</span>
        <span aria-live="polite">還有 {Math.max(0, safeMax - distance)} 格空間</span>
      </div>
      <progress
        className={`mt-2 h-3 w-full overflow-hidden rounded-full accent-slate-500 ${motionClass(reducedMotion, 'transition-all duration-700')}`}
        data-testid="mist-fill"
        data-motion={reducedMotion ? 'static' : 'animated'}
        value={progress}
        max="100"
        aria-label={`迷霧距離 ${Math.round(progress)}%`}
      />
      <p className="mt-2 text-xs text-slate-600">{message ?? '霧中有破碎的字跡，保持專心就能推開它'}</p>
    </section>
  );
};

export default MistBar;
