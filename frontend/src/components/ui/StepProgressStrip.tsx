/**
 * StepProgressStrip — horizontal scrollable strip showing learning step status.
 *
 * Shared by MyAssignments and LearningHistoryPage.
 * Each step bubble shows: completed (amber), current (blue), or pending (gray).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

export interface ProgressStep {
  id: string;
  label: string;
}

interface StepProgressStripProps {
  steps: ProgressStep[];
  completedSteps: Set<string>;
  currentStepPath?: string | null;
}

const StepProgressStrip: React.FC<StepProgressStripProps> = ({
  steps,
  completedSteps,
  currentStepPath = null,
}) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollControls = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const maxLeft = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(maxLeft - el.scrollLeft > 4);
  }, []);

  useEffect(() => {
    updateScrollControls();
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollControls, { passive: true });
    window.addEventListener('resize', updateScrollControls);
    return () => {
      el.removeEventListener('scroll', updateScrollControls);
      window.removeEventListener('resize', updateScrollControls);
    };
  }, [steps.length, updateScrollControls]);

  const scrollByDirection = (dir: 'left' | 'right') => {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = Math.max(180, Math.floor(el.clientWidth * 0.65));
    el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
    window.setTimeout(updateScrollControls, 180);
  };

  return (
    <div className="relative">
      <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-10 bg-gradient-to-r from-white to-transparent z-[1]" />
      <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-white to-transparent z-[1]" />

      <button
        type="button"
        onClick={() => scrollByDirection('left')}
        aria-label="向左查看關卡"
        disabled={!canScrollLeft}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full border border-gray-300 bg-white/95 shadow-sm hover:bg-white hover:shadow transition-all flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <svg className="w-4 h-4 text-gray-700" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M11.78 15.53a.75.75 0 0 1-1.06 0l-5-5a.75.75 0 0 1 0-1.06l5-5a.75.75 0 1 1 1.06 1.06L7.31 10l4.47 4.47a.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
        </svg>
      </button>

      <div ref={scrollerRef} className="overflow-x-auto pb-1 px-8">
        <div className="flex gap-1.5 min-w-max">
          {steps.map((step) => {
            const isDone = completedSteps.has(step.id);
            const isCurrent = !isDone && currentStepPath === step.id;
            return (
              <div
                key={step.id}
                title={step.label}
                className={`min-w-[84px] min-h-[40px] rounded-md border px-2 py-1 flex items-center justify-center transition-colors ${
                  isDone
                    ? 'bg-amber-100 border-amber-200 text-amber-800'
                    : isCurrent
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-gray-50 border-gray-200 text-gray-500'
                }`}
              >
                <span className="text-[11px] leading-tight font-medium text-center whitespace-normal break-words">
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={() => scrollByDirection('right')}
        aria-label="向右查看關卡"
        disabled={!canScrollRight}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full border border-gray-300 bg-white/95 shadow-sm hover:bg-white hover:shadow transition-all flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <svg className="w-4 h-4 text-gray-700" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M8.22 4.47a.75.75 0 0 1 1.06 0l5 5a.75.75 0 0 1 0 1.06l-5 5a.75.75 0 1 1-1.06-1.06L12.69 10 8.22 5.53a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
};

export default StepProgressStrip;
