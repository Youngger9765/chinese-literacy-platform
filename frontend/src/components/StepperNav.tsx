import React, { useState } from 'react';
import { AppView, Story, LearningSession } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';
import { ACTIVE_STEPS } from '../config/stepConfig';

interface StepperNavProps {
  currentView: AppView;
  session: LearningSession | null;
  selectedStory: Story | null;
  onNavigate: (view: AppView) => void;
}

type StepStatus = 'disabled' | 'idle' | 'active' | 'completed';

interface StepDef {
  step: number;
  label: string;
  view: AppView;
  needsStory: boolean;
}

/**
 * Steps are derived from the central ACTIVE_STEPS config so that reordering
 * or adding steps only requires editing stepConfig.ts.
 */
const steps: StepDef[] = ACTIVE_STEPS.map((s, i) => ({
  step: i + 1,
  label: s.label,
  view: s.view,
  needsStory: s.needsStory,
}));

function getStepStatus(
  stepDef: StepDef,
  currentView: AppView,
  session: LearningSession | null,
  selectedStory: Story | null,
): StepStatus {
  if (currentView === stepDef.view) return 'active';
  if (stepDef.needsStory && !selectedStory) return 'disabled';

  // Check completion based on session data
  const isCompleted = (() => {
    if (!session) return false;
    switch (stepDef.view) {
      case AppView.INTRO:          return session.introCompleted;
      case AppView.TUTOR:          return session.readingAttempt !== null;
      case AppView.VOCAB:          return session.vocabResult !== null;
      case AppView.DICTATION:      return session.dictationResult !== null;
      case AppView.COMPREHENSION:  return session.comprehensionResult !== null;
      case AppView.FULL_READING:   return session.fullReadingResult !== null;
      case AppView.REPORT:         return false; // destination step, never "completed"
      default:                     return false;
    }
  })();

  return isCompleted ? 'completed' : 'idle';
}

function getMiniSummary(stepDef: StepDef, session: LearningSession | null): string | null {
  if (!session) return null;
  switch (stepDef.view) {
    case AppView.TUTOR: {
      const a = session.readingAttempt;
      return a ? `${a.accuracy}% \u00B7 ${a.cpm} CPM` : null;
    }
    case AppView.VOCAB: {
      const v = session.vocabResult;
      return v ? `${v.practicedChars.length}/${v.totalChars} \u5B57` : null;
    }
    case AppView.COMPREHENSION: {
      const c = session.comprehensionResult;
      return c ? `${c.understoodCount}/${c.requiredCount} \u984C` : null;
    }
    case AppView.DICTATION: {
      const d = session.dictationResult;
      return d ? `${d.correctCount}/${d.totalWords} \u5C0D` : null;
    }
    case AppView.FULL_READING: {
      const f = session.fullReadingResult;
      return f ? `${Math.round(f.matchRate * 100)}%` : null;
    }
    default:
      return null;
  }
}

// -- Step badge sub-component --
const StepBadge: React.FC<{
  step: number;
  status: StepStatus;
  size?: 'sm' | 'md';
}> = ({ step, status, size = 'md' }) => {
  const sizeClasses = size === 'sm' ? 'w-6 h-6 text-xs' : 'w-7 h-7 text-sm';

  const styleMap: Record<StepStatus, string> = {
    disabled:  'bg-gray-200 text-gray-400',
    idle:      'bg-gray-200 text-gray-700',
    active:    'bg-accent text-white',
    completed: 'bg-emerald-500 text-white',
  };

  return (
    <span
      className={`${sizeClasses} rounded-full flex items-center justify-center font-bold shrink-0 ${styleMap[status]}`}
    >
      {status === 'completed' ? (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        step
      )}
    </span>
  );
};

// ── Desktop vertical sidebar ──────────────────────────────────────────────

const DesktopSidebar: React.FC<StepperNavProps> = ({
  currentView,
  session,
  selectedStory,
  onNavigate,
}) => {
  return (
    <nav
      aria-label="學習步驟導覽"
      className="hidden md:flex flex-col w-52 shrink-0 bg-white border-r border-gray-200 overflow-y-auto py-4 gap-1"
    >
      {/* Story title */}
      {selectedStory && (
        <div className="px-4 pb-3 border-b border-gray-100 mb-1">
          <p className="text-[11px] text-gray-400 uppercase tracking-wider font-semibold mb-0.5">目前課文</p>
          <p className="text-xs font-semibold text-gray-700 line-clamp-2 leading-snug">
            {selectedStory.title}
          </p>
        </div>
      )}

      {/* Step list */}
      {steps.map((stepDef) => {
        const status = getStepStatus(stepDef, currentView, session, selectedStory);
        const summary = status === 'completed' ? getMiniSummary(stepDef, session) : null;
        const isActive = status === 'active';
        const isDisabled = status === 'disabled';

        return (
          <button
            key={stepDef.view}
            onClick={() => !isDisabled && onNavigate(stepDef.view)}
            disabled={isDisabled}
            aria-current={isActive ? 'step' : undefined}
            aria-label={`步驟 ${stepDef.step}：${stepDef.label}（${isActive ? '目前' : isDisabled ? '未解鎖' : status === 'completed' ? '已完成' : '未完成'}）`}
            className={`mx-2 flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
              isActive
                ? 'bg-accent/10 text-accent'
                : isDisabled
                ? 'text-gray-300 cursor-not-allowed'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <StepBadge step={stepDef.step} status={status} size="md" />
            <span className="flex flex-col min-w-0">
              <span className={`text-sm leading-tight ${isActive ? 'font-semibold' : 'font-medium'}`}>
                {stepDef.label}
              </span>
              {summary && (
                <span className="text-[11px] text-emerald-600 font-normal mt-0.5">{summary}</span>
              )}
            </span>
          </button>
        );
      })}
    </nav>
  );
};

// ── Mobile compact bar + bottom sheet overlay ─────────────────────────────

const MobileStepBar: React.FC<StepperNavProps> = ({
  currentView,
  session,
  selectedStory,
  onNavigate,
}) => {
  const [open, setOpen] = useState(false);

  const currentStepDef = steps.find((s) => s.view === currentView);
  const currentStatus = currentStepDef
    ? getStepStatus(currentStepDef, currentView, session, selectedStory)
    : 'idle';

  const handleNavigate = (view: AppView) => {
    onNavigate(view);
    setOpen(false);
  };

  return (
    <>
      {/* Compact top bar — mobile only */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {currentStepDef ? (
            <>
              <StepBadge step={currentStepDef.step} status={currentStatus} size="sm" />
              <span className="text-sm font-semibold text-gray-800 truncate">
                {currentStepDef.label}
              </span>
              <span className="text-xs text-gray-400 shrink-0">
                {currentStepDef.step} / {steps.length}
              </span>
            </>
          ) : (
            <span className="text-sm text-gray-500">選擇步驟</span>
          )}
        </div>

        <button
          onClick={() => setOpen(true)}
          aria-label="展開所有步驟"
          aria-expanded={open}
          aria-haspopup="dialog"
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Bottom sheet overlay */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label="學習步驟清單"
            aria-modal="true"
            className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-2xl max-h-[80vh] flex flex-col"
          >
            {/* Sheet handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>

            {/* Sheet header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <div>
                <h2 className="text-base font-semibold text-gray-900">學習步驟</h2>
                {selectedStory && (
                  <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{selectedStory.title}</p>
                )}
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="關閉"
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Step list */}
            <nav
              aria-label="學習步驟導覽"
              className="overflow-y-auto py-3 px-3 flex flex-col gap-1"
            >
              {steps.map((stepDef) => {
                const status = getStepStatus(stepDef, currentView, session, selectedStory);
                const summary = status === 'completed' ? getMiniSummary(stepDef, session) : null;
                const isActive = status === 'active';
                const isDisabled = status === 'disabled';

                return (
                  <button
                    key={stepDef.view}
                    onClick={() => !isDisabled && handleNavigate(stepDef.view)}
                    disabled={isDisabled}
                    aria-current={isActive ? 'step' : undefined}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      isActive
                        ? 'bg-accent/10 text-accent'
                        : isDisabled
                        ? 'text-gray-300 cursor-not-allowed'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <StepBadge step={stepDef.step} status={status} size="sm" />
                    <span className="flex flex-col">
                      <span className={`text-base leading-snug ${isActive ? 'font-semibold' : 'font-medium'}`}>
                        {stepDef.label}
                      </span>
                      {summary && (
                        <span className="text-xs text-emerald-600 font-normal mt-0.5">{summary}</span>
                      )}
                    </span>
                    {isActive && (
                      <span className="ml-auto text-xs font-medium bg-accent/10 text-accent px-2 py-0.5 rounded-full shrink-0">
                        目前
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        </>
      )}
    </>
  );
};

// ── Main export ───────────────────────────────────────────────────────────

/**
 * StepperNav — vertical sidebar on desktop, compact bar + bottom sheet on mobile.
 *
 * Desktop (md+): fixed-width left column (208px / w-52) with numbered step rows.
 * Mobile (<md): slim top bar showing current step + hamburger; tapping opens a
 * bottom sheet with the full step list.
 *
 * This component is rendered OUTSIDE the header. It lives as a sibling to the
 * main learning content area (see LearningAppShell in AppShell.tsx).
 */
const StepperNav: React.FC<StepperNavProps> = (props) => {
  const isMobile = useIsMobile();

  if (isMobile) {
    return <MobileStepBar {...props} />;
  }

  return <DesktopSidebar {...props} />;
};

export default StepperNav;
