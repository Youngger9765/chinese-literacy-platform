import React, { useState } from 'react';
import { AppView, Story, LearningSession } from '../types';
import { useIsMobile } from '../hooks/useIsMobile';

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

const steps: StepDef[] = [
  { step: 1, label: '簡介',    view: AppView.INTRO,         needsStory: true  },
  { step: 2, label: '逐段朗讀', view: AppView.TUTOR,         needsStory: true  },
  { step: 3, label: '課文理解', view: AppView.COMPREHENSION, needsStory: true  },
  { step: 4, label: '生字練習', view: AppView.VOCAB,         needsStory: true  },
  { step: 5, label: '聽寫練習', view: AppView.DICTATION,     needsStory: true  },
  { step: 6, label: '全文朗讀', view: AppView.FULL_READING,  needsStory: true  },
  { step: 7, label: '報告',    view: AppView.REPORT,        needsStory: false },
];

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

// -- Circle sub-component --
const StepCircle: React.FC<{
  step: number;
  status: StepStatus;
  size?: 'sm' | 'md';
}> = ({ step, status, size = 'md' }) => {
  const sizeClasses = size === 'sm' ? 'w-5 h-5 text-[10px]' : 'w-5 h-5 text-[10px]';

  const styleMap: Record<StepStatus, string> = {
    disabled:  'bg-gray-200 text-gray-400',
    idle:      'bg-gray-200 text-gray-900',
    active:    'bg-accent text-white',
    completed: 'bg-emerald-500 text-white',
  };

  return (
    <span
      className={`${sizeClasses} rounded-full flex items-center justify-center font-bold shrink-0 ${styleMap[status]}`}
    >
      {status === 'completed' ? (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        step
      )}
    </span>
  );
};

// -- Active circle for desktop (inverted colors) --
const DesktopActiveCircle: React.FC<{ step: number }> = ({ step }) => (
  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 bg-white text-accent">
    {step}
  </span>
);

const StepperNav: React.FC<StepperNavProps> = ({
  currentView,
  session,
  selectedStory,
  onNavigate,
}) => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isMobile = useIsMobile();

  const handleNavigate = (view: AppView) => {
    onNavigate(view);
    setMobileNavOpen(false);
  };

  if (isMobile) {
    return (
      <nav className="flex items-center gap-1 text-xs font-medium relative">
        {/* Compact step circles */}
        {steps.map((stepDef) => {
          const status = getStepStatus(stepDef, currentView, session, selectedStory);
          return (
            <button
              key={stepDef.view}
              onClick={() => { if (status !== 'disabled') handleNavigate(stepDef.view); }}
              className="shrink-0 transition-colors"
            >
              <StepCircle step={stepDef.step} status={status} size="sm" />
            </button>
          );
        })}

        {/* Hamburger */}
        <button
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
          className="ml-1 p-1 rounded hover:bg-gray-100 transition-colors"
        >
          <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Dropdown */}
        {mobileNavOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMobileNavOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[180px]">
              {/* Home button */}
              <button
                onClick={() => handleNavigate(AppView.HOME)}
                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${
                  currentView === AppView.HOME ? 'bg-accent/10 text-accent font-bold' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                首頁
              </button>

              {/* Step items */}
              {steps.map((stepDef) => {
                const status = getStepStatus(stepDef, currentView, session, selectedStory);
                const summary = status === 'completed' ? getMiniSummary(stepDef, session) : null;
                const isActive = status === 'active';
                const isDisabled = status === 'disabled';
                return (
                  <button
                    key={stepDef.view}
                    onClick={() => { if (!isDisabled) handleNavigate(stepDef.view); }}
                    disabled={isDisabled}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${
                      isActive ? 'bg-accent/10 text-accent font-bold'
                      : isDisabled ? 'text-gray-300 cursor-not-allowed'
                      : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <StepCircle step={stepDef.step} status={status} size="sm" />
                    <span className="flex flex-col">
                      <span>{stepDef.label}</span>
                      {summary && (
                        <span className="text-[10px] text-emerald-600 font-normal">{summary}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Avatar */}
        <div className="ml-2 flex items-center gap-1 pl-2 border-l border-gray-200">
          <div className="w-6 h-6 rounded-full bg-gray-200"></div>
        </div>
      </nav>
    );
  }

  // -- Desktop layout --
  return (
    <nav className="flex items-center gap-1 text-sm font-medium">
      {/* Home */}
      <button
        onClick={() => onNavigate(AppView.HOME)}
        className={`px-2 py-1 rounded transition-colors ${
          currentView === AppView.HOME
            ? 'bg-accent text-white'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
        }`}
      >
        首頁
      </button>

      <span className="text-gray-300 select-none">&middot;</span>

      {/* Steps 1-6 */}
      {steps.map((stepDef, i, arr) => {
        const status = getStepStatus(stepDef, currentView, session, selectedStory);
        const summary = status === 'completed' ? getMiniSummary(stepDef, session) : null;
        const isActive = status === 'active';
        const isDisabled = status === 'disabled';

        return (
          <React.Fragment key={stepDef.view}>
            <button
              onClick={() => !isDisabled && onNavigate(stepDef.view)}
              className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                isActive
                  ? 'bg-accent text-white'
                  : isDisabled
                  ? 'text-gray-400 cursor-not-allowed'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              {isActive ? (
                <DesktopActiveCircle step={stepDef.step} />
              ) : (
                <StepCircle step={stepDef.step} status={status} />
              )}
              <span className="hidden md:flex md:items-center md:gap-1">
                <span>{stepDef.label}</span>
                {summary && (
                  <span className="text-[10px] text-emerald-600 font-normal">{summary}</span>
                )}
              </span>
            </button>
            {i < arr.length - 1 && (
              <span className="text-gray-300 select-none">&middot;</span>
            )}
          </React.Fragment>
        );
      })}

      {/* User avatar */}
      <div className="ml-3 flex items-center pl-3 border-l border-gray-200">
        <div className="w-6 h-6 rounded-full bg-gray-200"></div>
      </div>
    </nav>
  );
};

export default StepperNav;
