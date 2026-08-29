/**
 * StepFooterNav — persistent bottom action bar for the learning flow.
 *
 * Renders a fixed bar at the viewport bottom so students can advance to
 * the next step without scrolling back to the top ImmersiveTopBar.
 *
 * Layout: [← 上一步] | [step N / total · label ████░░░] | [下一步 →]
 *
 * Mirrors the prev/next logic from ImmersiveTopBar (AppShell.tsx) so the
 * two navs are always in sync.  Hides in toolbox mode (#1460).
 *
 * Issue #2082 (A9 — in-place next nav, professor demo feedback 2026-06-04).
 */
import React, { useMemo } from 'react';
import { useCurrentStepId } from '../../hooks/useCurrentStepId';
import { stepPath } from '../../config/stepPath';
import { useNavigate } from 'react-router-dom';
import { useLearningNav } from '../../contexts/LearningNavContext';
import { useStepSequence } from '../../hooks/useStepSequence';
import { useAppView } from '../../hooks/useAppView';
import { isToolboxMode } from '../../services/learningStorageScope';
import { stepNeighbours } from '../../config/stepNeighbours';
import { STEP_REGISTRY, resolveStepId } from '../../config/stepConfig';

const StepFooterNav: React.FC = () => {
  const navigate = useNavigate();
  const { selectedStory, session } = useLearningNav();
  const currentView = useAppView();
  // ⚠️ 比對步驟一律用**帶輪次**的 key（`full-text-annotate#7wavn`）。
  //    `currentView` 只反映路徑段，多文本課三個輪次的路徑段一樣，
  //    於是 `stepNeighbours` 永遠命中第一個同名步驟 ——
  //    active 圓圈與上一步／下一步三輪共用一顆（2026-08-25 staging 實測）。
  const currentStepKey = useCurrentStepId(String(currentView));
  const inToolbox = isToolboxMode();

  const activeSteps = useStepSequence(selectedStory ?? null);
  // #2905 — see config/stepNeighbours.ts. -1 no longer means "nowhere".
  const nav = useMemo(() => stepNeighbours(activeSteps, currentStepKey), [activeSteps, currentStepKey]);
  const currentStepIndex = nav.index;
  const totalSteps = activeSteps.length;
  const { current: currentStep, prev: prevStep, next: nextStep } = nav;

  const completedSet = new Set(session?.completedSteps ?? []);



  const handleNav = (step: (typeof activeSteps)[number] | null) => {
    if (!step || !selectedStory) return;
    navigate(stepPath(selectedStory.id, step.id));
  };

  // #2905: the bar used to vanish whenever the URL step was not in this lesson's
  // sequence (`currentStepIndex < 0`). Lesson 20011 has no 聚光燈, so
  // /learn/20011/spotlight rendered with no bottom bar in the DOM at all.
  // Being off-sequence is exactly when a student most needs a way out, so the
  // bar now renders as long as there is somewhere to go.
  if (inToolbox || !selectedStory || (!prevStep && !nextStep)) {
    return null;
  }

  // Progress fraction (0–1) based on completed steps
  const completedCount = activeSteps.filter((s) => completedSet.has(s.id)).length;
  const progressFraction = totalSteps > 0 ? completedCount / totalSteps : 0;

  return (
    <div
      role="navigation"
      aria-label="步驟底部導航"
      className="shrink-0 z-40 h-16 flex items-center justify-between px-3 md:px-6 gap-2 bg-white/95 backdrop-blur-sm border-t border-gray-200 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]"
    >
      {/* Left: Previous step */}
      <button
        type="button"
        onClick={() => handleNav(prevStep)}
        disabled={!prevStep}
        aria-label={prevStep ? `上一步：${prevStep.label}` : '已是第一步'}
        className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent whitespace-nowrap"
      >
        <span className="material-symbols-outlined text-base leading-none">chevron_left</span>
        <span className="hidden sm:inline">上一步</span>
      </button>

      {/* Center: compact progress indicator */}
      <div className="flex-1 flex flex-col items-center gap-1 min-w-0 px-2">
        <span className="text-xs text-gray-500 font-medium truncate max-w-full leading-none">
          {/* Off-sequence (#2905): no 「第 N / M 步」, because this step is not one
              of this lesson's N. Naming it is still useful — the student can see
              where they are — so the label comes from the registry. */}
          {currentStep ? (
            <>
              第 {currentStepIndex + 1}&nbsp;/&nbsp;{totalSteps} 步&nbsp;·&nbsp;
              <span className="text-accent font-semibold">{currentStep.label}</span>
            </>
          ) : (
            <span className="text-accent font-semibold">
              {STEP_REGISTRY[resolveStepId(currentView)]?.label ?? ''}
            </span>
          )}
        </span>
        {/* Thin progress bar */}
        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-500"
            style={{ width: `${progressFraction * 100}%` }}
            role="progressbar"
            aria-valuenow={Math.round(progressFraction * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`完成 ${completedCount} / ${totalSteps} 步`}
          />
        </div>
      </div>

      {/* Right: Next step — primary accent button */}
      <button
        type="button"
        onClick={() => handleNav(nextStep)}
        disabled={!nextStep}
        aria-label={nextStep ? `下一步：${nextStep.label}` : '已是最後一步'}
        className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 whitespace-nowrap active:scale-95"
      >
        <span className="hidden sm:inline">下一步</span>
        <span className="material-symbols-outlined text-base leading-none">chevron_right</span>
      </button>
    </div>
  );
};

export default StepFooterNav;
