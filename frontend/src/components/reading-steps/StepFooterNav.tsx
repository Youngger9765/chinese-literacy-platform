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
import { useNavigate } from 'react-router-dom';
import { useLearningNav } from '../../contexts/LearningNavContext';
import { useStepSequence } from '../../hooks/useStepSequence';
import { useAppView } from '../../hooks/useAppView';
import { isToolboxMode } from '../../services/learningStorageScope';

const StepFooterNav: React.FC = () => {
  const navigate = useNavigate();
  const { selectedStory, session } = useLearningNav();
  const currentView = useAppView();
  const inToolbox = isToolboxMode();

  const activeSteps = useStepSequence(selectedStory ?? null);
  const currentStepIndex = activeSteps.findIndex((s) => s.view === currentView);
  const totalSteps = activeSteps.length;
  const currentStep = currentStepIndex >= 0 ? activeSteps[currentStepIndex] : null;

  const completedSet = new Set(session?.completedSteps ?? []);
  const allNonReportDone = activeSteps
    .filter((s) => s.id !== 'report')
    .every((s) => completedSet.has(s.id));

  // Mirror the same locking logic as ImmersiveTopBar (#1094)
  const prevStep = useMemo(() => {
    for (let i = currentStepIndex - 1; i >= 0; i--) {
      const s = activeSteps[i];
      if (!(s.id === 'report' && !allNonReportDone)) return s;
    }
    return null;
  }, [activeSteps, currentStepIndex, allNonReportDone]);

  const nextStep = useMemo(() => {
    for (let i = currentStepIndex + 1; i < activeSteps.length; i++) {
      const s = activeSteps[i];
      if (!(s.id === 'report' && !allNonReportDone)) return s;
    }
    return null;
  }, [activeSteps, currentStepIndex, allNonReportDone]);

  const handleNav = (step: (typeof activeSteps)[number] | null) => {
    if (!step || !selectedStory) return;
    navigate(`/learn/${selectedStory.id}/${step.id}`);
  };

  // Don't render outside the learning flow, in toolbox mode, or when no story
  if (inToolbox || !selectedStory || currentStepIndex < 0 || !currentStep) {
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
          第 {currentStepIndex + 1}&nbsp;/&nbsp;{totalSteps} 步&nbsp;·&nbsp;
          <span className="text-accent font-semibold">{currentStep.label}</span>
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
